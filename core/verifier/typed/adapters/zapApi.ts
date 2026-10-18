import { ZAP } from '../domain/zap';

export function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid ZAP response');
  return value as Record<string, unknown>;
}
export function zapCount(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number' || !/^\d+$/.test(String(value))) throw Error('Invalid ZAP count');
  const count = Number(value); if (!Number.isSafeInteger(count)) throw Error('Invalid ZAP count'); return count;
}
export interface ZapApi { get(path: string, params: Readonly<Record<string, string>>, signal: AbortSignal): Promise<Record<string, unknown>> }
/** Private owned loopback API only. No API key is included in public evidence. */
export function createZapApi(origin: string, key: string): ZapApi {
  const base = new URL(origin);
  if (base.hostname !== ZAP.host || base.protocol !== 'http:' || !base.port || base.origin !== origin) throw Error('Invalid owned ZAP origin');
  return { async get(path, params, signal) {
    if (!Object.values(ZAP.endpoints).some(endpoint => endpoint === path)) throw Error('ZAP operation denied');
    const url = new URL(path, origin); for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const response = await fetch(url, { headers: { 'X-ZAP-API-Key': key }, signal: AbortSignal.any([signal, AbortSignal.timeout(ZAP.apiTimeoutMs)]), redirect: 'error' });
    if (!response.ok || !response.body) throw Error('ZAP API unavailable');
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > ZAP.apiBytes) throw Error('ZAP API response limit'); parts.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); }
    const result = jsonObject(JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown);
    if (result.code) throw Error('ZAP API rejected request'); return result;
  } };
}
