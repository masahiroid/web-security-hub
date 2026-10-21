import type { LlmSettings } from './llmTypes';

export const LLM_LIMITS = Object.freeze({
  version: 'llm-v1' as const,
  maximumCalls: 100, maximumRetries: 5, maximumOutputBytes: 65_536, maximumResponseTokens: 8_192,
  maximumTotalTokens: 1_000_000, maximumTimeoutMs: 300_000, maximumModelLength: 128, maximumEndpointLength: 256,
  feedbackEntries: 8, chatPath: '/v1/chat/completions', tokenEstimateBytes: 4, envelopeBytes: 4_096,
});
export function defaultLlmSettings(): LlmSettings {
  return Object.freeze({ version: LLM_LIMITS.version, mode: 'disabled', endpoint: null, model: '', candidateRatio: 0.25,
    maxCalls: 8, maxRetries: 1, maxOutputBytes: 16_384, maxResponseTokens: 1_024, maxTotalTokens: 20_000, timeoutMs: 30_000 });
}
