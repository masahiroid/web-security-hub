'use strict';
const fs = require('fs');
const path = require('path');

const { SITES_DIR } = require('./paths');

function sitesDir() {
  return SITES_DIR;
}

function siteDir(siteId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(siteId)) throw new Error(`invalid site id: ${siteId}`);
  return path.join(SITES_DIR, path.basename(siteId));
}

function listSites() {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs
    .readdirSync(SITES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_template')
    .map((e) => e.name)
    .filter((id) => fs.existsSync(path.join(SITES_DIR, id, 'site.config.json')));
}

/** Groups site ids by their configured `folder` (unfoldered sites under `''`). */
function listSitesByFolder() {
  const groups = {};
  for (const id of listSites()) {
    const cfg = readSiteConfig(id);
    const folder = cfg.folder || '';
    (groups[folder] ||= []).push({ id, displayName: cfg.displayName, labels: cfg.labels || [] });
  }
  return groups;
}

function readSiteConfig(siteId) {
  const file = path.join(siteDir(siteId), 'site.config.json');
  if (!fs.existsSync(file)) throw new Error(`site not found: ${siteId}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A deep copy of submitted data without keys that would rewrite a prototype, at any depth. */
function withoutUnsafeKeys(value) {
  if (Array.isArray(value)) return value.map(withoutUnsafeKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !UNSAFE_KEYS.has(key)).map(([key, entry]) => [key, withoutUnsafeKeys(entry)]));
}

/**
 * Recursively merges `incoming` onto `base`, keyed field by field, so that a
 * partial update (e.g. from a UI form that only knows about a subset of
 * site.config.json's fields) doesn't silently erase fields it doesn't know
 * about (manualFormsPath, scenarioExpansion, crawl.dryRun, etc.).
 */
function mergeSiteConfig(base, incoming) {
  if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  const out = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    // Keys that would rewrite an object's prototype are never merged.
    if (UNSAFE_KEYS.has(key)) continue;
    const baseValue = base?.[key];
    const bothPlainObjects =
      value && typeof value === 'object' && !Array.isArray(value) && baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue);
    out[key] = bothPlainObjects ? mergeSiteConfig(baseValue, value) : withoutUnsafeKeys(value);
  }
  return out;
}

function writeSiteConfig(siteId, config) {
  const dir = siteDir(siteId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'site.config.json'), JSON.stringify({ ...config, id: siteId }, null, 2) + '\n', 'utf8');
}

/** Parses a simple KEY=VALUE .env file (no external dependency). */
function readEnvFile(siteId) {
  const file = path.join(siteDir(siteId), '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const idx = s.indexOf('=');
    if (idx <= 0) continue;
    let value = s.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[s.slice(0, idx).trim()] = value;
  }
  return out;
}

/** Merges given keys into the site's .env file, preserving any keys not being updated. */
function writeEnvFile(siteId, updates) {
  const dir = siteDir(siteId);
  fs.mkdirSync(dir, { recursive: true });
  const current = readEnvFile(siteId);
  const merged = { ...current, ...updates };
  const body =
    Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('\n') + '\n';
  fs.writeFileSync(path.join(dir, '.env'), body, 'utf8');
}

function toBool(v, fallback) {
  if (v === undefined || v === null) return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

/**
 * Resolves non-secret client-certificate paths (site.config.json) plus the
 * secret passphrase (.env SECRET_CLIENT_CERT_PASSPHRASE, via the same
 * SECRET_ convention as core/scenario/variables.js) into the shape Playwright's
 * `browserContext.clientCertificates` expects.
 */
function buildClientCert(dir, clientCert, env) {
  if (!clientCert?.certPath || !clientCert?.keyPath) return undefined;
  return {
    origin: clientCert.origin,
    certPath: path.resolve(dir, clientCert.certPath),
    keyPath: path.resolve(dir, clientCert.keyPath),
    passphrase: env.SECRET_CLIENT_CERT_PASSPHRASE || undefined,
  };
}

/**
 * Builds a RunnerConfig (see core/runner/formRunner.js) from a site's
 * site.config.json + .env, resolving all relative paths to absolute ones.
 */
function buildRunnerConfig(siteId) {
  const cfg = readSiteConfig(siteId);
  const env = readEnvFile(siteId);
  const dir = siteDir(siteId);
  const crawl = cfg.crawl || {};

  const login = cfg.login?.loginUrl || env.LOGIN_USER
    ? {
        loginUrl: cfg.login?.loginUrl,
        username: env.LOGIN_USER || '',
        password: env.LOGIN_PASS || '',
        usernameSelector: cfg.login?.usernameSelector,
        passwordSelector: cfg.login?.passwordSelector,
        submitSelector: cfg.login?.submitSelector,
      }
    : undefined;

  // Lazily required to avoid a load-order issue: scenario/siteScenario.js itself
  // requires this module (siteConfig.js) for readSiteConfig/readEnvFile.
  const { resolveScenarioSteps } = require('./scenario/siteScenario');
  const rawSteps = Array.isArray(cfg.scenario?.steps) ? cfg.scenario.steps : [];
  const scenario = {
    login: login
      ? {
          url: login.loginUrl,
          username: login.username,
          password: login.password,
          usernameSelector: login.usernameSelector,
          passwordSelector: login.passwordSelector,
          submitSelector: login.submitSelector,
        }
      : undefined,
    steps: resolveScenarioSteps(siteId, rawSteps),
    dataSource: cfg.scenario?.dataSource,
  };

  const httpCredentials = cfg.basicAuth?.enabled
    ? { username: env.BASIC_USER || '', password: env.BASIC_PASS || '' }
    : undefined;

  const outputDir = path.resolve(dir, cfg.outputDir || '.golden-master');
  const ruleSpecDir = path.resolve(dir, cfg.ruleSpecDir || 'rule-spec');
  const manualFormsPath = cfg.manualFormsPath ? path.resolve(dir, cfg.manualFormsPath) : undefined;
  const sessionId = `session-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;

  return {
    runnerConfig: {
      siteId,
      url: cfg.baseUrl,
      engine: cfg.browser?.engine || 'chromium',
      device: cfg.browser?.device,
      clientCert: buildClientCert(dir, cfg.browser?.clientCert, env),
      storageStatePath: (() => {
        const p = require('./scenario/authSession').storageStatePath(siteId);
        return fs.existsSync(p) ? p : undefined;
      })(),
      ai: { enabled: toBool(cfg.ai?.assertionsEnabled, false), locale: cfg.ai?.locale || 'ja' },
      headful: toBool(crawl.headful, false),
      dryRun: toBool(crawl.dryRun, false),
      maxCasesPerForm: crawl.maxCasesPerForm ?? 25,
      normalOnlyPairwise: toBool(crawl.normalOnlyPairwise, false),
      fastFail: toBool(crawl.fastFail, true),
      maxDepth: crawl.maxDepth ?? 3,
      maxPages: crawl.maxPages ?? 30,
      outputDir: path.join(outputDir, sessionId),
      ruleSpecDir,
      manualFormsPath,
      httpCredentials,
      login,
      scenario,
      scenarioExpansion: cfg.scenarioExpansion || [],
    },
    outputBaseDir: outputDir,
    sessionId,
  };
}

module.exports = {
  sitesDir,
  siteDir,
  listSites,
  listSitesByFolder,
  readSiteConfig,
  writeSiteConfig,
  mergeSiteConfig,
  readEnvFile,
  writeEnvFile,
  buildRunnerConfig,
};
