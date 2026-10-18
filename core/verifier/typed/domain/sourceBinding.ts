import type { SastMetadata } from './sastMapping';
import type { Scope, TrialGrant, TrialRequest } from './types';
import type { Pair } from './campaignTypes';
import type { Values } from './types';

export const SOURCE_TRIAL = Object.freeze({ rootId: 'selected-source', profileId: 'anonymous', controlId: 'source-normal', candidateId: 'source-candidate',
  ttlMs: 90_000, timeoutMs: 15_000, maxTrials: 2, maxConcurrency: 1, retainedReports: 16 });
export interface SourceTrialOptions {
  readonly sourceDir: string; readonly finding: SastMetadata; readonly origin: string;
  readonly normalValues: Values; readonly candidateValues: Values; readonly expectedJson: Values;
  readonly expectedStatus: number; readonly useZap: boolean; readonly authorized: true;
}
export interface SourceRun {
  readonly state: 'source_binding_failed' | 'control_failed' | 'completed' | 'incomplete';
  readonly finding: SastMetadata; readonly target: Pick<Scope, 'sourceRootId' | 'origin' | 'route' | 'method'>;
  readonly assurance: 'static-source-only'; readonly runtimeSource: 'unverified'; readonly pair: Pair;
}
export interface SourceReport extends SourceRun {
  readonly schemaVersion: number; readonly reportId: string; readonly createdAt: string; readonly applicationVersion: string;
}

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
export function assertSourceTarget(finding: SastMetadata, scope: Pick<Scope, 'route' | 'method'>): void {
  const mapping = finding.routeMapping;
  const route = mapping.routes[0];
  if (mapping.status !== 'mapped' || mapping.routes.length !== 1 || !route || route.parameterized || encodeURI(route.path) !== route.path || route.path.includes('%') ||
      route.path !== scope.route || route.method !== scope.method) throw new SourceBindingError();
}
export function assertBindingScope(expected: Scope, actual: Scope, input: TrialRequest): void {
  if (actual.sourceRootId !== expected.sourceRootId || actual.origin !== expected.origin ||
      actual.route !== expected.route || actual.method !== expected.method ||
      input.url !== expected.origin + expected.route || input.method !== expected.method) throw new SourceBindingError();
}
