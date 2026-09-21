'use strict';
const { readSiteConfig, readEnvFile } = require('../siteConfig');

const TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const SECRET_ENV_PREFIX = 'SECRET_';

/**
 * Standard (non-secret) variables live in site.config.json under `variables`.
 * Secret variables live in the site's .env file as SECRET_<NAME>=value, so
 * they never appear in site.config.json (which is treated as shareable/versionable),
 * following the same split already used for LOGIN_PASS / BASIC_PASS.
 */
function resolveVariables(siteId, overrides = {}) {
  const config = readSiteConfig(siteId);
  const env = readEnvFile(siteId);
  const standard = config.variables && typeof config.variables === 'object' ? config.variables : {};
  const secrets = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(SECRET_ENV_PREFIX)) secrets[key.slice(SECRET_ENV_PREFIX.length)] = value;
  }
  return { ...standard, ...secrets, ...overrides };
}

/** Lists secret variable names (without values) for a site, for UI display. */
function listSecretVariableNames(siteId) {
  const env = readEnvFile(siteId);
  return Object.keys(env)
    .filter((key) => key.startsWith(SECRET_ENV_PREFIX))
    .map((key) => key.slice(SECRET_ENV_PREFIX.length));
}

function secretEnvKey(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`invalid variable name: ${name}`);
  return `${SECRET_ENV_PREFIX}${name}`;
}

/** Replaces every {{NAME}} token found in `value` using `vars`. Unknown tokens are left as-is. */
function interpolate(value, vars) {
  if (typeof value !== 'string') return value;
  return value.replace(TOKEN_RE, (match, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match));
}

/** Deep-interpolates string fields of a plain object/array in place (returns a new structure). */
function interpolateDeep(input, vars) {
  if (typeof input === 'string') return interpolate(input, vars);
  if (Array.isArray(input)) return input.map((item) => interpolateDeep(item, vars));
  if (input && typeof input === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(input)) out[key] = interpolateDeep(value, vars);
    return out;
  }
  return input;
}

module.exports = { resolveVariables, listSecretVariableNames, secretEnvKey, interpolate, interpolateDeep };
