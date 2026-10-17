'use strict';
// Isolated, fake-data fixture. Never mount on a production/public server.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const sourceDigest = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
function createFixture({ instrumentation = true } = {}) {
  const app = express();
  const controlToken = crypto.randomBytes(32).toString('hex');
  const sessions = new Map();
  let mode = 'baseline';
  let events = [];
  let commits = [];
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|\[::1\]):\d+$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) return res.sendStatus(403);
    res.set('Cache-Control', 'no-store'); next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.post('/control', (req, res) => {
    const supplied = crypto.createHash('sha256').update(String(req.headers['x-fixture-control'] || '')).digest();
    const expected = crypto.createHash('sha256').update(controlToken).digest();
    if (!crypto.timingSafeEqual(supplied, expected)) return res.sendStatus(403);
    if (req.body.action === 'reset' && ['baseline', 'changed', 'fixed'].includes(req.body.mode)) { mode = req.body.mode; sessions.clear(); events = []; commits = []; }
    else if (req.body.action !== 'evidence') return res.sendStatus(400);
    res.json({ mode, sourceDigest, instrumentation: instrumentation ? 'verified' : 'unavailable', events, commits });
  });
  app.post('/session', (req, res) => {
    if (!['learner-a', 'learner-b', 'admin', 'anonymous'].includes(req.body.profile)) return res.sendStatus(400);
    if (sessions.size >= 1000) return res.sendStatus(429);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { profile: req.body.profile, confirmed: new Set() });
    res.set('Set-Cookie', `fixture=${token}; HttpOnly; SameSite=Strict; Path=/`).json({ profile: req.body.profile });
  });
  app.use((req, res, next) => { req.session = sessions.get((req.headers.cookie || '').match(/(?:^|;\s*)fixture=([a-f0-9]+)/)?.[1]); next(); });
  function owner(id) { return ({ 'record-a': 'learner-a', 'record-b': 'learner-b' })[id]; }
  function authorized(req, res) {
    if (!req.session || req.session.profile === 'anonymous') { res.sendStatus(401); return false; }
    if (!owner(req.params.id)) { res.sendStatus(404); return false; }
    if (mode !== 'changed' && req.session.profile !== 'admin' && req.session.profile !== owner(req.params.id)) { res.sendStatus(403); return false; }
    return true;
  }
  function event(req, point) {
    if (instrumentation && events.length < 10000) events.push({ evidenceId: crypto.randomUUID(), point, profile: req.session.profile, recordId: req.params.id, sourceDigest, mode });
  }
  app.get('/records/:id', (req, res) => {
    if (!authorized(req, res)) return;
    event(req, 'record-read');
    res.json({ id: req.params.id, owner: owner(req.params.id), value: 'synthetic-record' });
  });
  app.post('/records/:id/confirm', (req, res) => {
    if (!authorized(req, res)) return;
    req.session.confirmed.add(req.params.id); res.json({ confirmed: true });
  });
  app.post('/records/:id/complete', (req, res) => {
    if (!authorized(req, res)) return;
    if (mode !== 'changed' && !req.session.confirmed.has(req.params.id)) return res.status(409).json({ completed: false });
    if (commits.length >= 10000) return res.sendStatus(429);
    const evidenceId = crypto.randomUUID();
    const violation = req.session.profile !== 'admin' && req.session.profile !== owner(req.params.id) || !req.session.confirmed.has(req.params.id);
    req.session.confirmed.delete(req.params.id);
    commits.push({ evidenceId, profile: req.session.profile, recordId: req.params.id, violation, mode, sourceDigest });
    event(req, 'record-commit'); res.json({ completed: true, evidenceId });
  });
  app.post('/boundary', (req, res) => {
    const { participants, label } = req.body;
    const valid = Number.isInteger(participants) && participants >= 1 && participants <= 5 && typeof label === 'string' && [...label.normalize('NFC')].length >= 1 && [...label.normalize('NFC')].length <= 10;
    res.status(valid ? 200 : 422).json({ accepted: valid });
  });
  app.use((err, req, res, next) => res.status(400).json({ error: 'Invalid fixture request' }));
  return { app, controlToken, sourceDigest };
}
if (require.main === module) createFixture().app.listen(4181, '127.0.0.1', () => console.log('Verifier fixture: http://127.0.0.1:4181 (synthetic data only)'));
module.exports = { createFixture };
