import { API } from './config.js';
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid response'); return value as JsonObject; }
export async function request(url: string, body?: unknown): Promise<JsonObject> {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw Error(response.status === 409 ? 'busy' : 'request_failed');
  return object(await response.json() as unknown);
}
export const jobUrl = (id: string) => `${API.jobs}/${encodeURIComponent(id)}`;
