'use strict';
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { FILE_SERVING_LIMITS } = require('../lib/fileServingPolicy');
const fs = require('fs');
const path = require('path');
const { generateTestCases, OUTPUT_ROOT } = require('../../core/testing/testCaseGenerator');
const router = express.Router();
router.post('/test-cases/generate', async (req, res) => {
  try { res.json(await generateTestCases(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/test-sessions/:sessionId/{*filePath}', rateLimit(FILE_SERVING_LIMITS), (req, res) => {
  const id = req.params.sessionId;
  if (!/^session-\d+$/.test(id)) return res.status(400).json({ error: 'invalid session id' });
  const base = path.join(OUTPUT_ROOT, id); const target = path.normalize(path.join(base, req.params.filePath?.join('/') || 'report.html'));
  if (!target.startsWith(`${base}${path.sep}`) || !fs.existsSync(target)) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.relative(base, target), { root: base });
});
module.exports = router;
