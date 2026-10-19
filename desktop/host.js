'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const { defaultDataDir, inspectEnvironment, installBrowser } = require('./environment');
// Set before loading any application modules so packaged resources remain read-only.
process.env.WEB_SECURITY_HUB_DATA_DIR ||= defaultDataDir();
process.env.WEB_SECURITY_HUB_MANAGED = '1';
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.WEB_SECURITY_HUB_PACKAGED === '1') process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.env.WEB_SECURITY_HUB_DATA_DIR, 'browsers');
const express = require('express');
async function createHost({ port = 0 } = {}) {
  const app = express(); const token = crypto.randomBytes(32).toString('hex');
  const cookieName = `wsh_${token.slice(0, 12)}`;
  let sampleServer; let busy = false; let log = []; let installError = null; let state = null;
  // Loopback binding plus a random session cookie, Host and Origin checks prevent
  // a visited website from issuing privileged local installation / filesystem requests.
  app.use((req, res, next) => {
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) return res.sendStatus(403);
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.sendStatus(403);
    if (req.path === '/__desktop/auth' && req.query.token === token) {
      res.set('Cache-Control', 'no-store'); res.cookie(cookieName, token, { httpOnly: true, sameSite: 'lax', path: '/' }); res.set('Referrer-Policy', 'no-referrer');
      return res.type('html').send('<!doctype html><meta charset="utf-8"><title>Starting</title><script>location.replace("/welcome")</script>');
    }
    if (!(req.headers.cookie || '').split(/;\s*/).includes(`${cookieName}=${token}`)) return res.sendStatus(401);
    res.set('Cache-Control', 'no-store'); next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use('/desktop', express.static(path.join(__dirname, 'welcome')));
  app.get('/welcome', (req, res) => res.sendFile(path.join(__dirname, 'welcome/index.html')));
  app.get('/api/desktop/state', async (req, res) => {
    try { if (!state) state = await inspectEnvironment(); res.json({ ...state, busy, log, installError, sampleRunning: Boolean(sampleServer) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/desktop/check', async (req, res) => {
    try { state = await inspectEnvironment(); res.json(state); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/desktop/install', (req, res) => {
    if (busy) return res.status(409).json({ error: 'Installation already running' });
    busy = true; log = []; installError = null;
    res.json({ accepted: true });
    installBrowser(s => { log.push(s); log = log.slice(-160); })
      .then(async () => { state = await inspectEnvironment(); })
      .catch(e => { installError = e.message; })
      .finally(() => { busy = false; });
  });
  app.post('/api/desktop/training', async (req, res) => {
    try {
      const mode = req.body?.mode;
      if (mode && !['baseline', 'changed', 'fixed', 'reset'].includes(mode)) throw new Error('Invalid training mode');
      if (!sampleServer) {
        const sample = require('../training/sample-site/server');
        sample.set('trainingHubUrl', origin + '/welcome');
        const candidate = sample.listen(4180, '127.0.0.1');
        try { await once(candidate, 'listening'); sampleServer = candidate; }
        catch (e) { candidate.close(); throw new Error(`Training port 4180 is in use. Close the other training server and retry. (${e.code})`, { cause: e }); }
      }
      require('../scripts/training').setup({ reset: Boolean(req.body?.resetConfig) });
      if (mode) {
        const response = await fetch(`http://127.0.0.1:4180/__training/${mode === 'reset' ? 'reset' : 'mode'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
        if (!response.ok) throw new Error('Could not set training mode');
      }
      const current = await (await fetch('http://127.0.0.1:4180/__training/state')).json();
      res.json({ ok: true, sampleUrl: 'http://127.0.0.1:4180', mode: current.mode });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/desktop/paths', (req, res) => res.json({ sourceBefore: path.resolve(__dirname, '../training/sast/before'), sourceAfter: path.resolve(__dirname, '../training/sast/after'), dataDir: process.env.WEB_SECURITY_HUB_DATA_DIR }));
  app.get('/training/:file', (req, res, next) => {
    if (!/^[A-Za-z0-9_.-]+\.html$/.test(req.params.file)) return next();
    const file = path.join(__dirname, '../docs/training', req.params.file);
    if (!fs.existsSync(file)) return next();
    const lang = req.params.file.includes('.ja.') ? 'ja' : 'en';
    let html = fs.readFileSync(file, 'utf8');
    if (/^README(?:\.ja)?\.html$/.test(req.params.file)) html = require('./courseRenderer').renderDesktopCourse(html, { lang, origin, port: server.address().port });
    else html = html.replace('<main>', '<main><p><a href="/welcome">← ホーム / Home</a></p>');
    html += '<link rel="stylesheet" href="/desktop/reader.css"><script src="/desktop/reader.js"></script>';
    res.type('html').send(html);
  });
  app.get('/', (req, res) => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    res.type('html').send(html.replace('</body>', '<script src="/desktop/bridge.js"></script></body>'));
  });
  app.use(require('../server'));
  const server = app.listen(port, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, url: `${origin}/__desktop/auth?token=${token}`, async close() {
    await require('../server').get('closeVerifier')?.();
    for (const s of [sampleServer, server].filter(Boolean)) { s.closeAllConnections?.(); await new Promise(r => s.close(r)); }
  } };
}
if (require.main === module) {
  let host;
  createHost().then(h => { host = h; console.log(`WSH_READY ${JSON.stringify({ url: h.url })}`); }).catch(e => { console.error(e); process.exit(1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await host?.close(); process.exit(0); });
  // Tauri pipes its stdin; when the parent exits unexpectedly do not leave a server behind.
  if (process.env.WEB_SECURITY_HUB_PACKAGED === '1') { process.stdin.resume(); process.stdin.on('end', async () => { await host?.close(); process.exit(0); }); }
}
module.exports = { createHost };
