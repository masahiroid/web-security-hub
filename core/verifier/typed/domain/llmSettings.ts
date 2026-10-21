import { TRANSPORT } from './config';
import { LLM_LIMITS } from './llmConfig';
import type { LlmMode, LlmSettings } from './llmTypes';

const KEYS = ['version', 'mode', 'endpoint', 'model', 'candidateRatio', 'maxCalls', 'maxRetries', 'maxOutputBytes', 'maxResponseTokens', 'maxTotalTokens', 'timeoutMs'];
const MODES: readonly LlmMode[] = ['disabled', 'mock', 'local'];
function bounded(input: unknown, minimum: number, maximum: number, integer = true): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < minimum || input > maximum || integer && !Number.isInteger(input)) throw Error('Invalid LLM setting range');
  return input;
}
/** Only an explicit numeric loopback HTTP origin is accepted; remote sending is not supported. */
export function validateLoopbackEndpoint(input: unknown): string {
  if (typeof input !== 'string' || input.length > LLM_LIMITS.maximumEndpointLength) throw Error('Invalid LLM endpoint');
  const url = new URL(input);
  if (url.protocol !== TRANSPORT.protocol || !TRANSPORT.loopbackHosts.includes(url.hostname) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') throw Error('LLM endpoint must be a numeric loopback HTTP origin');
  return url.origin;
}
export function validateLlmSettings(input: unknown): LlmSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected LLM settings object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !KEYS.includes(key)) || KEYS.some(key => !Object.hasOwn(value, key))) throw Error('Unexpected LLM settings fields');
  const mode = MODES.find(candidate => candidate === value.mode);
  if (value.version !== LLM_LIMITS.version || !mode) throw Error('Unsupported LLM settings');
  if (typeof value.model !== 'string' || value.model.length > LLM_LIMITS.maximumModelLength || mode === 'local' && !value.model) throw Error('Invalid LLM model');
  if (mode === 'local' ? value.endpoint === null : value.endpoint !== null) throw Error('LLM endpoint does not match mode');
  return Object.freeze({
    version: LLM_LIMITS.version, mode, endpoint: value.endpoint === null ? null : validateLoopbackEndpoint(value.endpoint), model: value.model,
    candidateRatio: bounded(value.candidateRatio, 0, 1, false), maxCalls: bounded(value.maxCalls, 0, LLM_LIMITS.maximumCalls),
    maxRetries: bounded(value.maxRetries, 0, LLM_LIMITS.maximumRetries), maxOutputBytes: bounded(value.maxOutputBytes, 1, LLM_LIMITS.maximumOutputBytes),
    maxResponseTokens: bounded(value.maxResponseTokens, 1, LLM_LIMITS.maximumResponseTokens),
    maxTotalTokens: bounded(value.maxTotalTokens, 1, LLM_LIMITS.maximumTotalTokens), timeoutMs: bounded(value.timeoutMs, 1, LLM_LIMITS.maximumTimeoutMs),
  });
}
