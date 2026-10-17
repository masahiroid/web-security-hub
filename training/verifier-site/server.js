'use strict';
// Isolated, fake-data fixture. Never mount on a production/public server.
const express = require('express');
const crypto = require('crypto');
const { FIXTURE, HTTP_STATUS, POINTS, LIMITS } = require('../../core/verifier/generated/domain/config');
const { createFixtureLedger } = require('../../core/verifier/generated/adapters/fixtureLedger');
const { recordOracle, boundaryOracle } = require('../../core/verifier/generated/domain/businessOracle');
const { sourceFingerprint, sourceFingerprintSync } = require('../../core/verifier/generated/adapters/sourceFingerprint');
const SOURCE_FILES = Object.freeze([
  { name: 'fixture-routes', file: __filename },
  ...['domain/config', 'domain/businessOracle', 'adapters/fixtureLedger', 'adapters/sourceFingerprint'].map(name => ({ name, file: require.resolve(`../../core/verifier/generated/${name}`) }))
]);
// Captured at module load: changing disk bytes must not silently relabel an already loaded server.
const sourceDigest = sourceFingerprintSync(SOURCE_FILES);
function createFixture({ instrumentation = true, evidenceCapacity } = {}) {
  const app = express();
  const controlToken = crypto.randomBytes(FIXTURE.controlTokenBytes).toString('hex');
  const sessions = new Map();
  let mode = FIXTURE.initialMode;
  let events = [];
  let commits = [];
  const ledger = createFixtureLedger({ sourceDigest, instrumentation, ...(evidenceCapacity === undefined ? {} : { capacity: evidenceCapacity }) });
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|\[::1\]):\d+$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) return res.sendStatus(HTTP_STATUS.forbidden);
    res.set('Cache-Control', 'no-store'); next();
  });
  app.use(express.json({ limit: FIXTURE.jsonLimit }));
  app.use((req, res, next) => { res.once('finish', () => ledger.finish(req.headers)); next(); });
  app.post(FIXTURE.routes.control, (req, res) => {
    const supplied = crypto.createHash('sha256').update(String(req.headers[FIXTURE.controlHeader] || '')).digest();
    const expected = crypto.createHash('sha256').update(controlToken).digest();
    if (!crypto.timingSafeEqual(supplied, expected)) return res.sendStatus(HTTP_STATUS.forbidden);
    if (req.body.action === 'reset' && FIXTURE.modes.includes(req.body.mode)) { mode = req.body.mode; sessions.clear(); events = []; commits = []; ledger.reset(); }
    else if (req.body.action !== 'evidence') return res.sendStatus(HTTP_STATUS.badRequest);
    res.json({ mode, sourceDigest, instrumentation: instrumentation ? 'verified' : 'unavailable', events, commits });
  });
  app.post(FIXTURE.routes.session, (req, res) => {
    if (!FIXTURE.roles.includes(req.body.profile)) return res.sendStatus(HTTP_STATUS.badRequest);
    if (sessions.size >= FIXTURE.sessionCapacity) return res.sendStatus(HTTP_STATUS.capacity);
    const token = crypto.randomBytes(FIXTURE.sessionTokenBytes).toString('hex');
    sessions.set(token, { profile: req.body.profile, confirmed: new Set() });
    res.set('Set-Cookie', `fixture=${token}; HttpOnly; SameSite=Strict; Path=/`).json({ profile: req.body.profile });
  });
  app.use((req, res, next) => { req.session = sessions.get((req.headers.cookie || '').match(/(?:^|;\s*)fixture=([a-f0-9]+)/)?.[1]); next(); });
  function owner(id) { return Object.hasOwn(FIXTURE.records, id) ? FIXTURE.records[id] : undefined; }
  function trace(req, point, oracle, recordId = req.params.id || null) {
    ledger.record(req.headers, point, req.session?.profile || FIXTURE.anonymous, recordId, oracle, mode);
  }
  function denied(req, res, status) { trace(req, POINTS.blocked, 'passed'); res.sendStatus(status); return false; }
  function authorized(req, res) {
    if (!req.session || req.session.profile === FIXTURE.anonymous) { return denied(req, res, HTTP_STATUS.unauthorized); }
    if (!owner(req.params.id)) { return denied(req, res, HTTP_STATUS.notFound); }
    if (mode !== FIXTURE.changedMode && req.session.profile !== FIXTURE.admin && req.session.profile !== owner(req.params.id)) { return denied(req, res, HTTP_STATUS.forbidden); }
    return true;
  }
  function event(req, point) {
    if (instrumentation && events.length < LIMITS.evidenceEvents) events.push({ evidenceId: crypto.randomUUID(), point, profile: req.session.profile, recordId: req.params.id, sourceDigest, mode });
  }
  app.get(FIXTURE.routes.record, (req, res) => {
    if (!authorized(req, res)) return;
    event(req, POINTS.read);
    trace(req, POINTS.read, recordOracle(req.session.profile, owner(req.params.id), null));
    res.json({ id: req.params.id, owner: owner(req.params.id), value: FIXTURE.syntheticValue });
  });
  app.post(FIXTURE.routes.confirm, (req, res) => {
    if (!authorized(req, res)) return;
    req.session.confirmed.add(req.params.id);
    trace(req, POINTS.confirm, recordOracle(req.session.profile, owner(req.params.id), null)); res.json({ confirmed: true });
  });
  app.post(FIXTURE.routes.complete, (req, res) => {
    if (!authorized(req, res)) return;
    if (mode !== FIXTURE.changedMode && !req.session.confirmed.has(req.params.id)) { trace(req, POINTS.blocked, 'passed'); return res.status(HTTP_STATUS.conflict).json({ completed: false }); }
    if (commits.length >= LIMITS.evidenceEvents) return res.sendStatus(HTTP_STATUS.capacity);
    const evidenceId = crypto.randomUUID();
    const violation = req.session.profile !== FIXTURE.admin && req.session.profile !== owner(req.params.id) || !req.session.confirmed.has(req.params.id);
    const commitOracle = recordOracle(req.session.profile, owner(req.params.id), req.session.confirmed.has(req.params.id));
    req.session.confirmed.delete(req.params.id);
    commits.push({ evidenceId, profile: req.session.profile, recordId: req.params.id, violation, mode, sourceDigest });
    trace(req, POINTS.commit, commitOracle);
    event(req, POINTS.commit); res.json({ completed: true, evidenceId });
  });
  app.post(FIXTURE.routes.boundary, (req, res) => {
    const { participants, label } = req.body;
    const valid = Number.isInteger(participants) && participants >= FIXTURE.participantsMinimum && participants <= FIXTURE.participantsMaximum && typeof label === 'string' && [...label.normalize(FIXTURE.normalization)].length >= FIXTURE.labelMinimum && [...label.normalize(FIXTURE.normalization)].length <= FIXTURE.labelMaximum;
    trace(req, POINTS.boundary, boundaryOracle(participants, label, valid), null);
    res.status(valid ? HTTP_STATUS.ok : HTTP_STATUS.invalidInput).json({ accepted: valid });
  });
  app.use((err, req, res, next) => res.status(HTTP_STATUS.badRequest).json({ error: 'Invalid fixture request' }));
  return { app, controlToken, sourceDigest, readEvidence: correlation => ledger.read(correlation), currentSourceDigest: signal => sourceFingerprint(SOURCE_FILES, signal) };
}
if (require.main === module) createFixture().app.listen(FIXTURE.port, FIXTURE.host, () => console.log(`Verifier fixture: http://${FIXTURE.host}:${FIXTURE.port} (synthetic data only)`));
module.exports = { createFixture };
