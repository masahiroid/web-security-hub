import type { Request } from 'express';

/** The message of any thrown value, as the JSON error responses report it. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/** A named route parameter; Express 5 gives plain strings for named segments. */
export function param(request: Request, name: string): string {
  const value: unknown = request.params[name];
  return typeof value === 'string' ? value : '';
}
/** A wildcard route parameter ("{*name}"), joined back into a relative path; empty when absent. */
export function wildcard(request: Request, name: string): string {
  const value: unknown = request.params[name];
  return Array.isArray(value) ? value.map(String).join('/') : '';
}
/** The JSON body as an object; anything else counts as an empty body. */
export function bodyOf(request: Request): Readonly<Record<string, unknown>> {
  const body: unknown = request.body;
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const queryText = (request: Request, name: string): string | undefined => {
  const value: unknown = request.query[name];
  return typeof value === 'string' ? value : undefined;
};
