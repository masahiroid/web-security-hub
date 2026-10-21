import { LLM_LIMITS } from '../domain/llmConfig';
import { validateLoopbackEndpoint } from '../domain/llmSettings';
import { LlmError } from '../domain/llmTypes';
import type { LlmCompletion, LlmProvider, LlmRequest } from '../domain/llmTypes';
import type { Scalar } from '../domain/types';

/** Deterministic hill-climbing stand-in: neighbours of the best observed candidates. No network, no model. */
export function createMockProvider(): LlmProvider {
  return {
    async complete({ context }: LlmRequest): Promise<LlmCompletion> {
      const candidates: { values: Record<string, Scalar> }[] = [];
      for (const entry of context.feedback.slice(0, 3)) {
        for (const gene of context.space) {
          const current = entry.values[gene.field];
          const index = current === undefined ? -1 : gene.values.indexOf(current);
          for (const next of [gene.values[index + 1], gene.values[index - 1]]) {
            if (next !== undefined && index >= 0) candidates.push({ values: { ...entry.values, [gene.field]: next } });
          }
        }
      }
      return { text: JSON.stringify({ candidates: candidates.slice(0, context.maxProposals) }), promptTokens: null, completionTokens: null };
    },
  };
}
async function readBounded(response: Response, maximum: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new LlmError('transport');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new LlmError('oversized'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
/** OpenAI-compatible chat endpoint on numeric loopback (e.g. llama.cpp server). Sends only the prompt; no credentials. */
export function createLocalProvider(endpoint: string, model: string, fetcher: typeof fetch = fetch): LlmProvider {
  const url = new URL(LLM_LIMITS.chatPath, validateLoopbackEndpoint(endpoint));
  return {
    async complete(request: LlmRequest): Promise<LlmCompletion> {
      let body: string;
      try {
        const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: request.signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, temperature: 0, max_tokens: request.maxTokens, stream: false,
            messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }],
            response_format: { type: 'json_schema', json_schema: { name: 'candidates', strict: true, schema: request.schema } } }) });
        if (!response.ok) throw new LlmError('transport');
        body = await readBounded(response, request.maxBytes * 2 + LLM_LIMITS.envelopeBytes);
      } catch (error: unknown) {
        if (error instanceof LlmError) throw error;
        throw new LlmError(request.signal.aborted ? 'timeout' : 'transport');
      }
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { throw new LlmError('invalid_json'); }
      const choice = record(Array.isArray(record(parsed)?.choices) ? (record(parsed)?.choices as unknown[])[0] : null);
      const message = record(choice?.message);
      if (!choice || !message) throw new LlmError('invalid_shape');
      if (choice.finish_reason === 'length') throw new LlmError('truncated');
      if (choice.finish_reason === 'content_filter' || typeof message.refusal === 'string' && message.refusal) throw new LlmError('refused');
      if (typeof message.content !== 'string') throw new LlmError('invalid_shape');
      const usage = record(record(parsed)?.usage);
      return { text: message.content, promptTokens: count(usage?.prompt_tokens), completionTokens: count(usage?.completion_tokens) };
    },
  };
}
