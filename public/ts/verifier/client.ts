import { API } from './config.js';
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid response'); return value as JsonObject; }
export async function request(url: string, body?: unknown): Promise<JsonObject> {
  const response = await fetch(url, { signal: AbortSignal.timeout(API.requestMs), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw Error(response.status === 409 ? 'busy' : 'request_failed');
  return object(await response.json() as unknown);
}
export const jobUrl = (id: string) => `${API.jobs}/${encodeURIComponent(id)}`;
let session: Promise<JsonObject> | undefined;
export async function ensureSession(signal?: AbortSignal): Promise<JsonObject> {
  if (!session) {
    const operation = request(API.session); session = operation;
    void operation.finally(() => { if (session === operation) session = undefined; }).catch(() => {});
  }
  if (!signal) return session;
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(Error('Session interrupted')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
  try { return await Promise.race([session, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}
