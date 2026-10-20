'use strict';
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { FILE_SERVING_LIMITS } = require('../lib/fileServingPolicy');
const fs = require('fs');
const path = require('path');
const { openSse } = require('../lib/sse');
const { siteDir, readSiteConfig } = require('../../core/siteConfig');
const { exploreSiteSession } = require('../services/exploreService');

const router = express.Router();

function exploreSessionsDir(siteId) {
  const cfg = readSiteConfig(siteId);
  return path.resolve(siteDir(siteId), cfg.outputDir || '.golden-master', '..', 'explore-sessions');
}

router.get('/sites/:id/explore/run', async (req, res) => {
  const stream = openSse(res);
  try {
    stream.send('done', await exploreSiteSession(req.params.id, (line) => stream.send('log', { line })));
  } catch (error) {
    stream.send('error', { message: error.message });
  } finally {
    stream.close();
  }
});

router.get('/sites/:id/explore-sessions', (req, res) => {
  try {
    const dir = exploreSessionsDir(req.params.id);
    const sessions = fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()
      : [];
    res.json({ sessions });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/sites/:id/explore-sessions/:sessionId/{*filePath}', rateLimit(FILE_SERVING_LIMITS), (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return res.status(400).json({ error: 'invalid session id' });
    const base = path.join(exploreSessionsDir(req.params.id), sessionId);
    const target = path.normalize(path.join(base, req.params.filePath?.join('/') || 'explore-report.html'));
    if (!target.startsWith(`${path.normalize(base)}${path.sep}`) || !fs.existsSync(target)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.sendFile(path.relative(base, target), { root: base });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
