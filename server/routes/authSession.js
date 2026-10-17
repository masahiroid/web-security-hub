'use strict';

const express = require('express');
const { AuthSessionCapture, hasStorageState } = require('../../core/scenario/authSession');
const { readSiteConfig } = require('../../core/siteConfig');

const router = express.Router();
const capture = new AuthSessionCapture();

router.get('/auth-session/status', (req, res) => res.json(capture.status()));

router.get('/sites/:id/auth-session/saved', (req, res) => {
  try {
    res.json({ saved: hasStorageState(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/auth-session/start', async (req, res) => {
  try {
    const { siteId, authorized } = req.body || {};
    if (!authorized) throw new Error('explicit authorization is required before opening a login session');
    if (typeof siteId !== 'string' || !siteId.trim()) throw new Error('siteId is required');
    const site = readSiteConfig(siteId.trim());
    res.json(await capture.start({ siteId: siteId.trim(), startUrl: site.baseUrl }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/auth-session/stop', async (req, res) => {
  try {
    res.json(await capture.stop());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/auth-session/cancel', async (req, res) => {
  try {
    res.json(await capture.cancel());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
