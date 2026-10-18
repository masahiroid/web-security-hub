import type { Control, Handle, Method, Profile, RegistryPort, Result, Seed } from './types';
export type ScenarioId = 'boundary' | 'ownership' | 'workflow';
export type Mode = 'baseline' | 'changed' | 'fixed';
export interface RunOptions { readonly schemaVersion: number; readonly mode: Mode; readonly scenario: ScenarioId | 'all'; readonly randomSeed: number; readonly maxCandidates: number; readonly maxTrials: number; readonly ttlMs: number }
export interface Candidate { readonly seed: Seed; readonly parentSeedId: string; readonly mutation: 'baseline' | 'boundary' | 'missing-field' | 'unicode' | 'profile'; readonly authProfileId: string }
export interface Scenario { readonly id: ScenarioId; readonly route: string; readonly method: Method; readonly baseSeed: Seed; readonly normalProfileId: string; readonly candidateProfiles: readonly string[]; readonly allowedFields: readonly string[]; readonly expectedJson: Readonly<Record<string, string | boolean>> }
export interface Pair { readonly state: 'completed' | 'control_failed'; readonly control: Result; readonly candidate: Result | null }
export type CampaignState = 'completed' | 'cancelled' | 'expired' | 'timeout' | 'budget_exhausted' | 'control_failed' | 'source_changed' | 'error';
export interface Execution { readonly candidateId: string; readonly control: Result; readonly candidate: Result | null }
export interface ScenarioReport { readonly scenarioId: ScenarioId; readonly method: Method; readonly route: string; readonly plan: readonly Candidate[]; readonly executions: readonly Execution[] }
export interface Totals { readonly planned: number; readonly executed: number; readonly trials: number; readonly reproduced: number; readonly observedNoIssue: number; readonly inconclusive: number }
export interface Report { readonly schemaVersion: number; readonly reportId: string; readonly createdAt: string; readonly applicationVersion: string; readonly mode: Mode; readonly sourceDigest: string | null; readonly executionKind: 'direct-http'; readonly prngAlgorithm: string; readonly options: RunOptions; readonly state: CampaignState; readonly scenarios: readonly ScenarioReport[]; readonly totals: Totals; readonly draft: true; readonly vexStatus: 'under_investigation' }
export interface SavedReport { readonly reportId: string; readonly jsonFile: string; readonly htmlFile: string }
export interface ReportStore { save(report: Report): Promise<SavedReport>; read(reportId: string): Promise<Report> }
export interface JobStatus { readonly schemaVersion: number; readonly jobId: string; readonly state: 'active' | 'cancelled' | 'expired'; readonly trials: number; readonly running: number; readonly expiresAt: number; readonly maxTrials: number; readonly maxConcurrency: number }
export interface CampaignRegistry extends RegistryPort { create(scope: unknown): Handle; cancel(handle: Handle): void; dispose(handle: Handle): void; status(handle: Handle): JobStatus }
export interface PairRunner { runPair(handle: Handle, input: { url: string; method: Method; authProfileId: string; seed: Seed }): Promise<Pair> }
export interface Runtime { readonly origin: string; readonly sourceDigest: string; currentSourceDigest(signal: AbortSignal): Promise<string>; readEvidence(correlation: Parameters<import('./types').EvidencePort['read']>[0]): Promise<unknown>; close(): Promise<void> }
export interface Progress { readonly scenarioId: ScenarioId; readonly candidateId: string; readonly executed: number; readonly planned: number }
export interface ScenarioCatalog { readonly profiles: readonly Profile[]; readonly control: Control }
