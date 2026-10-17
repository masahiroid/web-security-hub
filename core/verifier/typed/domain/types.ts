export type Scalar = string | number | boolean | null;
export type Values = Readonly<Record<string, Scalar>>;
export type Method = 'GET' | 'POST';
export type Outcome = 'completed' | 'timeout' | 'cancelled' | 'error';
export type Oracle = 'passed' | 'violated' | 'inconclusive';
export type Reachability = 'observed' | 'not_observed' | 'unavailable';
export type Reason = 'none' | 'transport_error' | 'setup_failed' | 'redirect_outside_scope' | 'redirect_not_followed' | 'response_too_large' | 'cleanup_failed' | 'job_cancelled' | 'job_disposed' | 'job_expired' | 'trial_timeout';
export interface Seed { readonly schemaVersion: number; readonly seedId: string; readonly values: Values; readonly omitFields: readonly string[]; readonly rationale: string }
export interface TrialRequest { readonly url: string; readonly method: Method; readonly authProfileId: string; readonly seed: Seed }
export interface Scope { readonly schemaVersion: number; readonly sourceRootId: string; readonly origin: string; readonly route: string; readonly method: Method; readonly authProfileIds: readonly string[]; readonly allowedFields: readonly string[]; readonly ttlMs: number; readonly maxTrials: number; readonly maxConcurrency: number }
export interface Handle { readonly jobId: string; readonly capability: string }
export interface Correlation { readonly jobId: string; readonly trialId: string; readonly seedId: string; readonly requestId: string; readonly authProfileId: string }
export interface Observation extends Correlation { readonly schemaVersion: number; readonly purpose: 'control' | 'candidate'; readonly executionKind: 'direct-http'; outcome: Outcome; reason: Reason; status: number | null; durationMs: number; dispatched: boolean; setupRequests: number; redirect: 'none' | 'blocked' | 'not_followed' }
export interface Feedback { readonly schemaVersion: number; readonly seedId: string; readonly outcome: Outcome; readonly status: number | null; readonly durationMs: number; readonly instrumentation: 'verified' | 'unavailable'; readonly reachability: Reachability; readonly sourceDigest: string | null; readonly oracle: Oracle; readonly controlPassed: boolean; readonly evidenceIds: readonly string[]; readonly zap: 'disabled' }
export interface Assessment { readonly schemaVersion: number; readonly seedId: string; readonly result: 'reproduced' | 'no_issue_observed_in_scope' | 'under_investigation'; readonly vexStatus: 'under_investigation'; readonly draft: true; readonly evidenceIds: readonly string[] }
export interface Profile { readonly schemaVersion: number; readonly profileId: string; readonly origin: string; readonly setup: readonly { readonly route: string; readonly method: Method; readonly values: Values; readonly expectedStatus: number }[] }
export interface Control { readonly schemaVersion: number; readonly origin: string; readonly route: string; readonly method: Method; readonly seed: Seed; readonly expectedStatus: number; readonly expectedJson: Values; readonly authProfileId?: string }
export type EvidencePoint = 'guard-blocked' | 'record-read' | 'record-commit' | 'confirmation-recorded' | 'boundary-checked';
export interface ServerEvent extends Correlation { readonly evidenceId: string; readonly point: EvidencePoint; readonly profile: string; readonly recordId: string | null; readonly oracle: Oracle; readonly sourceDigest: string; readonly mode: string }
export interface Snapshot { readonly schemaVersion: number; readonly sourceDigest: string; readonly instrumentation: 'verified' | 'unavailable'; readonly complete: boolean; readonly events: readonly ServerEvent[] }
export type EvidenceState = 'disabled' | 'verified' | 'unavailable' | 'source_mismatch' | 'incomplete' | 'error';
export interface EvidenceResult { readonly state: EvidenceState; readonly reachability: Reachability; readonly sourceDigest: string | null; readonly oracle: Oracle; readonly events: readonly ServerEvent[] }
export interface Result { readonly observation: Readonly<Observation>; readonly feedback: Feedback; readonly assessment: Assessment; readonly evidence: EvidenceResult }
export interface TrialGrant { readonly trialId: string; readonly seed: Seed; readonly scope: Scope; readonly signal: AbortSignal; readonly expiresAt: number }
export interface RegistryPort {
  check(handle: Handle, input: TrialRequest): void;
  begin(handle: Handle, input: TrialRequest): TrialGrant;
  finish(handle: Handle, trialId: string): void;
  status(handle: Handle): { readonly state: string };
  assertRedirect(handle: Handle, url: string): void;
}
export interface Slice { readonly schemaVersion: number; readonly findingInstanceId: string; readonly sourceRootId: string; readonly relativePath: string; readonly sourceDigest: string; readonly startLine: number; readonly endLine: number; readonly mapping: 'verified' | 'ambiguous' | 'unavailable' }
export interface EvidenceSummary { readonly schemaVersion: number; readonly evidenceId: string; readonly seedId: string; readonly sourceDigest: string; readonly kind: 'server-event' | 'business-oracle' | 'http-observation'; readonly summary: string }
export interface ContractMap { scope: Scope; slice: Slice; evidence: EvidenceSummary; assessment: Assessment; runOptions: import('./campaignTypes').RunOptions; report: import('./campaignTypes').Report; jobStatus: import('./campaignTypes').JobStatus; seed: Seed; trialRequest: TrialRequest; profile: Profile; control: Control; httpObservation: Observation; feedback: Feedback; serverSnapshot: Snapshot }
export interface ContractsPort { validate<K extends keyof ContractMap>(name: K, input: unknown): ContractMap[K]; assess(input: Feedback): Assessment }
export interface EvidencePort {
  readonly expectedSourceDigest: string;
  currentSourceDigest(signal: AbortSignal): Promise<string>;
  read(correlation: Correlation, signal: AbortSignal): Promise<unknown>;
}
