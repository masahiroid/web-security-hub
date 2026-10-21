import type { GenomeSpace } from './geneticGenome';
import type { Scalar } from './types';

export type LlmMode = 'disabled' | 'mock' | 'local' | 'remote';
/** Operational policy; the model never receives URLs, credentials, files or shell access. */
export interface LlmSettings {
  readonly version: 'llm-v1';
  readonly mode: LlmMode;
  /** Numeric loopback HTTP origin for mode "local"; null otherwise. */
  readonly endpoint: string | null;
  /** Explicit consent to send redacted prompts to a non-loopback https origin; only valid for mode "remote". */
  readonly sendPermission: boolean;
  /** Name of the environment variable holding the API key; the key itself is never stored or reported. */
  readonly apiKeyEnv: string | null;
  /** Price per million tokens in one caller-chosen currency unit; zero for local runtimes. */
  readonly pricing: Readonly<{ inputPerMillion: number; outputPerMillion: number }>;
  /** Hard spend ceiling in the same currency unit; required to be positive for remote. */
  readonly maxCost: number;
  readonly model: string;
  /** Share of the non-elite slots offered to the model; distinct from GA crossover/mutation rates. */
  readonly candidateRatio: number;
  readonly maxCalls: number;
  readonly maxRetries: number;
  readonly maxOutputBytes: number;
  readonly maxResponseTokens: number;
  readonly maxTotalTokens: number;
  readonly timeoutMs: number;
}
/** Redacted feedback: typed gene values and aggregate scores only. */
export interface LlmFeedback { readonly values: Readonly<Record<string, Scalar>>; readonly score: number; readonly reachability: number | null }
export interface LlmContext { readonly space: GenomeSpace; readonly feedback: readonly LlmFeedback[]; readonly maxProposals: number }
export interface LlmRequest {
  readonly system: string; readonly prompt: string; readonly schema: Readonly<Record<string, unknown>>;
  readonly context: LlmContext; readonly maxTokens: number; readonly maxBytes: number; readonly signal: AbortSignal;
}
export interface LlmCompletion { readonly text: string; readonly promptTokens: number | null; readonly completionTokens: number | null }
export interface LlmProvider { complete(request: LlmRequest): Promise<LlmCompletion> }
/** Stable, non-sensitive rejection codes; raw model output is never recorded. */
export type LlmRejection = 'oversized' | 'invalid_json' | 'invalid_shape' | 'too_many' | 'unknown_field' | 'invalid_value' |
  'truncated' | 'refused' | 'transport' | 'timeout' | 'call_budget' | 'token_budget' | 'cost_budget' | 'empty';
export class LlmError extends Error { constructor(readonly code: LlmRejection) { super(`LLM response rejected: ${code}`); } }
