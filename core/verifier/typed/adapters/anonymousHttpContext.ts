import { request, type ClientRequest } from 'node:http';
import { LIMITS, TRANSPORT } from '../domain/config';
import type { Method } from '../domain/types';

export interface WireResponse {
  status(): number; headers(): Record<string, string>; body(): Promise<Buffer>; dispose(): Promise<void>;
}
export interface WireRequest {
  method: Method; headers: Record<string, string>; timeout: number; params?: Record<string, string>; data?: string;
  maxRedirects: number; maxRetries: number; failOnStatusCode: boolean;
}
export interface TrialContext {
  fetch(url: string, options: WireRequest): Promise<WireResponse>;
  dispose(options: { reason: string }): Promise<void>;
}
export class ResponseLimitError extends Error {
  constructor(readonly status: number) { super('HTTP response inspection limit'); }
}
/** One anonymous request context: no cookies, automatic redirects or retries; bound bytes before buffering. */
export function createAnonymousHttpContext(origin: string, proxy?: string): TrialContext {
  let closed = false; const active = new Set<ClientRequest>();
  return {
    fetch(input, options) {
      if (closed || options.maxRedirects || options.maxRetries) return Promise.reject(Error('HTTP context unavailable'));
      const target = new URL(input); if (target.origin !== origin || target.protocol !== 'http:') return Promise.reject(Error('HTTP target denied'));
      for (const [key, value] of Object.entries(options.params ?? {})) target.searchParams.set(key, value);
      const endpoint = proxy ? new URL(proxy) : target;
      return new Promise<WireResponse>((resolve, reject) => {
        let settled = false;
        const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
        const req = request({ hostname: endpoint.hostname.replace(/^\[|\]$/g, ''), port: endpoint.port,
          method: options.method, path: proxy ? target.href : target.pathname + target.search,
          headers: { Accept: TRANSPORT.jsonContentType, ...options.headers, Host: target.host, Connection: 'close' } }, response => {
          const status = response.statusCode ?? 0; const chunks: Buffer[] = []; let bytes = 0;
          response.on('error', fail);
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > LIMITS.responseInspectionBytes) { const error = new ResponseLimitError(status); fail(error); response.destroy(error); req.destroy(error); }
            else chunks.push(chunk);
          });
          response.on('end', () => {
            if (settled) return; settled = true;
            const body = Buffer.concat(chunks); const headers = Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
            resolve({ status: () => status, headers: () => headers, body: async () => body, dispose: async () => {} });
          });
        });
        active.add(req); req.once('error', fail);
        const timer = setTimeout(() => { const error = Error('HTTP request timeout'); error.name = 'TimeoutError'; req.destroy(error); }, options.timeout);
        req.once('close', () => { clearTimeout(timer); active.delete(req); });
        if (options.data !== undefined) req.end(options.data); else req.end();
      });
    },
    async dispose() { closed = true; for (const req of active) req.destroy(Error('HTTP trial finished')); active.clear(); }
  };
}
