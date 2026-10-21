import { LLM_LIMITS } from '../domain/llmConfig';
import { LLM_SYSTEM_PROMPT, buildPrompt, parseProposals, proposalSchema, redactFeedback } from '../domain/llmProposal';
import { LlmError } from '../domain/llmTypes';
import type { GenomeSpace } from '../domain/geneticGenome';
import type { GeneticProposer } from '../domain/geneticTypes';
import type { LlmProvider, LlmRejection, LlmSettings } from '../domain/llmTypes';

const estimate = (bytes: number) => Math.ceil(bytes / LLM_LIMITS.tokenEstimateBytes);
/** Bounded retry and explicit fallback: any model fault yields zero candidates and the GA continues. */
export function createLlmProposer(provider: LlmProvider, settings: LlmSettings, space: GenomeSpace): GeneticProposer {
  let calls = 0;
  let tokens = 0;
  let cost = 0;
  const { inputPerMillion, outputPerMillion } = settings.pricing;
  const priced = inputPerMillion > 0 || outputPerMillion > 0 || settings.mode === 'remote';
  const price = (input: number, output: number) => (input * inputPerMillion + output * outputPerMillion) / LLM_LIMITS.tokensPerPriceUnit;
  return {
    async propose({ generation, capacity, evaluated, signal }) {
      const maxProposals = Math.floor(capacity * settings.candidateRatio);
      const costBefore = cost;
      const record = (outcome: 'proposed' | 'fallback' | 'skipped', attempts: number, accepted: number, spent: number, rejection: LlmRejection | null) =>
        Object.freeze({ generation, outcome, attempts, accepted, tokens: spent, cost: cost - costBefore, rejection });
      if (settings.mode === 'disabled' || maxProposals < 1) return { seeds: [], record: record('skipped', 0, 0, 0, null) };
      const context = Object.freeze({ space, feedback: redactFeedback(evaluated), maxProposals });
      const prompt = buildPrompt(context);
      let spent = 0;
      let rejection: LlmRejection = 'transport';
      let attempts = 0;
      for (let attempt = 0; attempt <= settings.maxRetries && !signal.aborted; attempt++) {
        if (calls >= settings.maxCalls) { rejection = 'call_budget'; break; }
        if (tokens >= settings.maxTotalTokens) { rejection = 'token_budget'; break; }
        const maxTokens = Math.min(settings.maxResponseTokens, settings.maxTotalTokens - tokens);
        // Worst case: estimated prompt plus the full response allowance must fit the remaining ceiling.
        if (priced && cost + price(estimate(Buffer.byteLength(prompt)), maxTokens) > settings.maxCost) { rejection = 'cost_budget'; break; }
        calls++; attempts++;
        try {
          const completion = await provider.complete({ system: LLM_SYSTEM_PROMPT, prompt, schema: proposalSchema(maxProposals, space), context,
            maxTokens, maxBytes: settings.maxOutputBytes,
            signal: AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutMs)]) });
          const input = completion.promptTokens ?? estimate(Buffer.byteLength(prompt));
          const output = completion.completionTokens ?? estimate(Buffer.byteLength(completion.text));
          tokens += input + output; spent += input + output; cost += price(input, output);
          const seeds = parseProposals(completion.text, space, maxProposals, settings.maxOutputBytes);
          return { seeds, record: record('proposed', attempts, seeds.length, spent, null) };
        } catch (error: unknown) {
          rejection = error instanceof LlmError ? error.code : signal.aborted ? 'transport' : 'timeout';
        }
      }
      return { seeds: [], record: record('fallback', attempts, 0, spent, rejection) };
    },
  };
}
