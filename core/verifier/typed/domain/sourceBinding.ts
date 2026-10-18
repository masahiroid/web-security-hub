import type { SastMetadata } from './sastMapping';
import type { Scope, TrialGrant, TrialRequest } from './types';

export interface SourceReader {
  read(sourceRootId: string, relativePath: string, signal: AbortSignal): Promise<Uint8Array>;
}
export interface TrialGuard {
  verify(grant: TrialGrant, input: TrialRequest, signal: AbortSignal): Promise<void>;
}
export class SourceBindingError extends Error {
  constructor() { super('Source binding could not be verified'); }
}
/** Static attribution is a constraint on a separately authorized scope, never a grant. */
export function assertSourceTarget(finding: SastMetadata, scope: Scope): void {
  const mapping = finding.routeMapping;
  const route = mapping.routes[0];
  if (mapping.status !== 'mapped' || mapping.routes.length !== 1 || !route || route.parameterized ||
      route.path !== scope.route || route.method !== scope.method) throw new SourceBindingError();
}
export function assertBindingScope(expected: Scope, actual: Scope, input: TrialRequest): void {
  if (actual.sourceRootId !== expected.sourceRootId || actual.origin !== expected.origin ||
      actual.route !== expected.route || actual.method !== expected.method ||
      input.url !== expected.origin + expected.route || input.method !== expected.method) throw new SourceBindingError();
}
