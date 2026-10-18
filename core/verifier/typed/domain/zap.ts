import type { Correlation, Observation, TrialRequest } from './types';

export const ZAP = Object.freeze({
  version: '2.17.0', heapMb: 512, cleanupRetries: 5, temporaryHistoryType: 0, proxyHistoryType: 1, startupMs: 90_000, shutdownMs: 10_000, apiTimeoutMs: 5_000,
  passiveMs: 15_000, pollMs: 200, maximumMessages: 256, maximumAlerts: 128,
  apiBytes: 4 * 1024 * 1024, downloadMs: 600_000, maximumArchiveBytes: 350 * 1024 * 1024,
  directoryMode: 0o700, fileMode: 0o600, keyBytes: 32, host: '127.0.0.1',
  endpoints: Object.freeze({ version: '/JSON/core/view/version/', session: '/JSON/core/view/sessionLocation/', messages: '/JSON/core/view/messages/',
    messageCount: '/JSON/core/view/numberOfMessages/', alerts: '/JSON/alert/view/alerts/',
    alert: '/JSON/alert/view/alert/', alertCount: '/JSON/alert/view/numberOfAlerts/', queue: '/JSON/pscan/view/recordsToScan/' })
});
export type ZapState = 'disabled' | 'completed' | 'incomplete' | 'error';
export type ZapReason = 'disabled' | 'none' | 'queue_pending' | 'message_missing' | 'correlation_mismatch' | 'limit' | 'unavailable';
export interface ZapAlert {
  readonly fingerprint: string; readonly messageId: string; readonly pluginId: string; readonly risk: number; readonly confidence: number;
}
export interface ZapEvidence {
  readonly state: ZapState; readonly reason: ZapReason; readonly sessionId: string | null;
  readonly messageIds: readonly string[]; readonly alerts: readonly ZapAlert[];
}
export interface ZapPort {
  readonly proxy: string;
  collect(observation: Observation, input: TrialRequest, signal: AbortSignal): Promise<ZapEvidence>;
}
export const CORRELATION_FIELDS: readonly (keyof Correlation)[] = ['jobId', 'trialId', 'seedId', 'requestId', 'authProfileId'];
export function zapUnavailable(state: ZapState, reason: ZapReason, sessionId: string | null = null): ZapEvidence {
  return Object.freeze({ state, reason, sessionId, messageIds: Object.freeze([]), alerts: Object.freeze([]) });
}

export const ZAP_RISK: Readonly<Record<string, number>> = Object.freeze({ Informational: 0, Low: 1, Medium: 2, High: 3 });
export const ZAP_CONFIDENCE: Readonly<Record<string, number>> = Object.freeze({ "False Positive": 0, Low: 1, Medium: 2, High: 3, Confirmed: 4 });
