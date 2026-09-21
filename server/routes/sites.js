'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { listSites, listSitesByFolder, readSiteConfig, writeSiteConfig, mergeSiteConfig, writeEnvFile, siteDir } = require('../../core/siteConfig');
const { normalizeStoredScenario } = require('../../core/scenario/siteScenario');
const { listSecretVariableNames, secretEnvKey } = require('../../core/scenario/variables');
const { listSharedSteps, writeSharedSteps } = require('../../core/scenario/sharedSteps');
const { listDataSets, readDataSet, writeDataSet } = require('../../core/scenario/dataDriven');

const router = express.Router();

router.get('/sites', (req, res) => {
  const sites = listSites().map((id) => {
    const cfg = readSiteConfig(id);
    return { id, displayName: cfg.displayName, baseUrl: cfg.baseUrl, folder: cfg.folder || '', labels: cfg.labels || [] };
  });
  res.json({ sites });
});

router.get('/sites-by-folder', (req, res) => {
  res.json({ folders: listSitesByFolder() });
});

router.get('/sites/:id', (req, res) => {
  try {
    res.json({ config: readSiteConfig(req.params.id) });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Create or update a site's non-secret config. Merges onto any existing config so a
// partial submission (e.g. from a UI form that only knows a subset of fields) doesn't
// erase fields the caller didn't mention (manualFormsPath, scenarioExpansion, crawl.dryRun, ...).
router.put('/sites/:id', (req, res) => {
  try {
    const { credentials, ...incoming } = req.body || {};
    let existing = {};
    try {
      existing = readSiteConfig(req.params.id);
    } catch {
      existing = {};
    }
    if (Object.prototype.hasOwnProperty.call(incoming, 'scenario')) incoming.scenario = normalizeStoredScenario(incoming.scenario);
    const config = mergeSiteConfig(existing, incoming);
    writeSiteConfig(req.params.id, config);
    if (credentials && typeof credentials === 'object') {
      writeEnvFile(req.params.id, credentials);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update only credentials (never echoed back in plaintext by any GET route).
router.post('/sites/:id/credentials', (req, res) => {
  try {
    writeEnvFile(req.params.id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/sites/:id/credentials/status', (req, res) => {
  const { readEnvFile } = require('../../core/siteConfig');
  try {
    const env = readEnvFile(req.params.id);
    res.json({
      hasLoginUser: Boolean(env.LOGIN_USER),
      hasLoginPass: Boolean(env.LOGIN_PASS),
      hasBasicUser: Boolean(env.BASIC_USER),
      hasBasicPass: Boolean(env.BASIC_PASS),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/sites/:id/rule-specs', (req, res) => {
  try {
    const cfg = readSiteConfig(req.params.id);
    const dir = path.resolve(siteDir(req.params.id), cfg.ruleSpecDir || 'rule-spec');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(ya?ml|json)$/i.test(f)) : [];
    res.json({ dir, files });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Standard variables come back with their values; secret variable *names* only
// (never values) so a GET can safely be used to populate a form.
router.get('/sites/:id/variables', (req, res) => {
  try {
    const cfg = readSiteConfig(req.params.id);
    res.json({ standard: cfg.variables || {}, secretNames: listSecretVariableNames(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// body: { standard?: { NAME: value }, secrets?: { NAME: value } }
router.put('/sites/:id/variables', (req, res) => {
  try {
    const { standard, secrets } = req.body || {};
    if (standard !== undefined) {
      if (typeof standard !== 'object' || Array.isArray(standard)) throw new Error('standard variables must be an object');
      const existing = (() => {
        try {
          return readSiteConfig(req.params.id);
        } catch {
          return {};
        }
      })();
      writeSiteConfig(req.params.id, mergeSiteConfig(existing, { variables: standard }));
    }
    if (secrets !== undefined) {
      if (typeof secrets !== 'object' || Array.isArray(secrets)) throw new Error('secret variables must be an object');
      const updates = {};
      for (const [name, value] of Object.entries(secrets)) updates[secretEnvKey(name)] = value;
      writeEnvFile(req.params.id, updates);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/sites/:id/shared-steps', (req, res) => {
  try {
    res.json({ groups: listSharedSteps(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/sites/:id/shared-steps', (req, res) => {
  try {
    writeSharedSteps(req.params.id, (req.body || {}).groups || []);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/sites/:id/data-sets', (req, res) => {
  try {
    res.json({ names: listDataSets(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/sites/:id/data-sets/:name', (req, res) => {
  try {
    res.json({ rows: readDataSet(req.params.id, req.params.name) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/sites/:id/data-sets/:name', (req, res) => {
  try {
    writeDataSet(req.params.id, req.params.name, (req.body || {}).rows || []);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
