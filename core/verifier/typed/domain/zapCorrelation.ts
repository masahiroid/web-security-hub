import { CORRELATION_FIELDS } from './zap';
import { TRANSPORT } from './config';
import type { Correlation, TrialRequest } from './types';

/** Duplicate/folded identity headers cannot be treated as a correlated message. */
export function correlateZapMessage(header: string, expected: Correlation, target: TrialRequest): 'match' | 'other' | 'invalid' {
  const lines = header.split(/\r?\n/); const first = lines.shift()?.match(/^(GET|POST)\s+(\S+)\s+HTTP\/\d(?:\.\d)?$/);
  const values = new Map<string, string>(); let invalid = false;
  for (const line of lines) {
    if (/^\s+\S/.test(line)) invalid = true;
    const index = line.indexOf(':'); if (index <= 0) continue;
    const name = line.slice(0, index).toLowerCase(); const value = line.slice(index + 1).trim();
    if (values.has(name) && Object.values(TRANSPORT.headers).some(header => header === name)) invalid = true;
    values.set(name, value);
  }
  if (values.get(TRANSPORT.headers.requestId) !== expected.requestId) return 'other';
  if (invalid || !first || first[1] !== target.method || CORRELATION_FIELDS.some(field => values.get(TRANSPORT.headers[field]) !== expected[field])) return 'invalid';
  try {
    const expectedUrl = new URL(target.url); const actual = new URL(first[2] ?? '', expectedUrl.origin);
    if (actual.origin !== expectedUrl.origin || actual.pathname !== expectedUrl.pathname || actual.hash || actual.username || actual.password) return 'invalid';
    return 'match';
  } catch { return 'invalid'; }
}
