import { asRecord, type SiteStore, type Variables } from './types';

/**
 * Standard variables live in site.config.json under `variables`; secret variables live in the
 * site's .env file as SECRET_<NAME>=value so they never appear in the shareable config.
 */

const TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SECRET_ENV_PREFIX = 'SECRET_';

export function secretEnvKey(name: string): string {
  if (!VARIABLE_NAME_RE.test(name)) throw new Error(`invalid variable name: ${name}`);
  return `${SECRET_ENV_PREFIX}${name}`;
}

/** Replaces every {{NAME}} token in a string using own properties of `vars`. Unknown tokens and non-strings are left as-is. */
export function interpolate<T>(value: T, vars: Variables): T | string {
  if (typeof value !== 'string') return value;
  return value.replace(TOKEN_RE, (match, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match));
}

/** Returns a new structure with every string inside plain objects/arrays interpolated. */
export function interpolateDeep(input: unknown, vars: Variables): unknown {
  if (typeof input === 'string') return interpolate(input, vars);
  if (Array.isArray(input)) return input.map((item: unknown) => interpolateDeep(item, vars));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) out[key] = interpolateDeep(value, vars);
    return out;
  }
  return input;
}

export interface VariableStore {
  resolveVariables(siteId: string, overrides?: Variables): Record<string, unknown>;
  listSecretVariableNames(siteId: string): string[];
}

export function createVariableStore(store: Pick<SiteStore, 'readSiteConfig' | 'readEnvFile'>): VariableStore {
  return {
    resolveVariables(siteId, overrides = {}) {
      const config = asRecord(store.readSiteConfig(siteId)) ?? {};
      const env = store.readEnvFile(siteId);
      const variables = config['variables'];
      const standard = variables && typeof variables === 'object' ? (variables as Record<string, unknown>) : {};
      const secrets: Record<string, string> = {};
      for (const [key, value] of Object.entries(env)) {
        if (key.startsWith(SECRET_ENV_PREFIX)) secrets[key.slice(SECRET_ENV_PREFIX.length)] = value;
      }
      return { ...standard, ...secrets, ...overrides };
    },
    listSecretVariableNames(siteId) {
      return Object.keys(store.readEnvFile(siteId))
        .filter((key) => key.startsWith(SECRET_ENV_PREFIX))
        .map((key) => key.slice(SECRET_ENV_PREFIX.length));
    },
  };
}
