'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { sessionsDir } = require('../lib/sessionPaths');

const router = express.Router();

router.get('/sites/:id/sessions', (req, res) => {
  try {
    const dir = sessionsDir(req.params.id);
    const sessions = fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort()
          .reverse()
      : [];
    res.json({ sessions });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Serves any file inside one session directory (report.html, generated.spec.ts,
// screenshots/*.png, ...) — scoped strictly under that site's output dir.
router.get('/sites/:id/sessions/:sessionId/{*filePath}', (req, res) => {
  try {
    const base = path.join(sessionsDir(req.params.id), req.params.sessionId);
    const rel = req.params.filePath?.join('/') || 'report.html';
    const target = path.normalize(path.join(base, rel));
    if (!target.startsWith(`${path.normalize(base)}${path.sep}`)) {
      res.status(400).json({ error: 'invalid path' });
      return;
    }
    if (!fs.existsSync(target)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.sendFile(path.relative(base, target), { root: base });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
