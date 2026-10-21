import express from 'express';
import { randomUUID } from 'node:crypto';
import { createVerificationJobs } from '../application/verificationJobs';
import { HTTP_STATUS, LIMITS } from '../domain/config';
import { defaultGeneticFixtureSettings } from '../domain/geneticFixtureConfig';
import { defaultLlmSettings } from '../domain/llmConfig';
import { createGeneticFixtureService } from './geneticFixtureService';
import { validateGeneticFixtureOptions } from './geneticFixtureOptions';
import { validateComparisonOptions } from './geneticComparisonOptions';
import { compareView, runView } from './geneticView';
import type { GeneticJobReport } from './geneticView';
import type { GeneticFixtureOptions } from '../domain/geneticCampaignTypes';
import type { ComparisonOptions } from '../domain/geneticComparisonTypes';

type Request = { readonly kind: 'run'; readonly options: GeneticFixtureOptions } | { readonly kind: 'compare'; readonly options: ComparisonOptions };
export interface GeneticProgress { readonly done: number; readonly planned: number }
/** The GUI may choose only disabled, mock or loopback-local models; remote sending stays an explicit CLI decision. */
const GUI_LLM_MODES = ['disabled', 'mock', 'local'] as const;
const KEYS = ['kind', 'mode', 'method', 'randomSeed', 'maxTrials', 'llm'];
const LLM_KEYS = ['mode', 'endpoint', 'model', 'candidateRatio'];
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected object'); return value as Record<string, unknown>; }
export function parseGeneticRequest(input: unknown): Request {
  const body = record(input);
  const llm = record(body.llm);
  if (Object.keys(body).some(key => !KEYS.includes(key)) || Object.keys(llm).some(key => !LLM_KEYS.includes(key)) ||
      !GUI_LLM_MODES.some(mode => mode === llm.mode)) throw Error('Invalid genetic request');
  const model = { ...defaultLlmSettings(), mode: llm.mode, endpoint: llm.endpoint ?? null, model: llm.model ?? '', candidateRatio: llm.candidateRatio ?? defaultLlmSettings().candidateRatio };
  const defaults = defaultGeneticFixtureSettings();
  const settings = { ...defaults, randomSeed: body.randomSeed ?? defaults.randomSeed, maxTrials: body.maxTrials ?? defaults.maxTrials };
  if (body.kind === 'run') return { kind: 'run', options: validateGeneticFixtureOptions({ mode: body.mode, method: body.method ?? 'ga', settings, llm: model }) };
  if (body.kind === 'compare') return { kind: 'compare', options: validateComparisonOptions({ settings, llm: model }) };
  throw Error('Invalid genetic request kind');
}
export function createGeneticRoute({ dataRoot, applicationVersion }: { dataRoot: string; applicationVersion: string }) {
  const service = createGeneticFixtureService({ applicationVersion, dataRoot });
  const jobs = createVerificationJobs<Request, GeneticJobReport, GeneticProgress>({
    async run(request, { signal, onProgress }) {
      if (request.kind === 'run') { const { report, saved } = await service.run(request.options, { signal }); return { report: runView(report), saved }; }
      const { report, saved } = await service.compare(request.options, { signal, progress: (done, planned) => { onProgress({ done, planned }); } });
      return { report: compareView(report), saved };
    },
  }, randomUUID);
  const router = express.Router();
  const owner = (res: express.Response): string => String(res.locals.verifierOwner);
  const jobId = (req: express.Request): string => { const value: unknown = req.params.jobId; return typeof value === 'string' ? value : ''; };
  router.get('/defaults', (_req, res) => { const settings = defaultGeneticFixtureSettings(); res.json({ randomSeed: settings.randomSeed, maxTrials: settings.maxTrials, candidateRatio: defaultLlmSettings().candidateRatio }); });
  router.post('/jobs', express.json({ limit: LIMITS.jsonPayloadBytes }), (req, res) => {
    let request: Request;
    try { request = parseGeneticRequest(req.body as unknown); } catch { return void res.status(HTTP_STATUS.badRequest).json({ error: 'invalid_options' }); }
    try { res.json(jobs.start(owner(res), request)); } catch { res.status(HTTP_STATUS.conflict).json({ error: 'busy' }); }
  });
  router.get('/jobs/:jobId', (req, res) => { try { res.json(jobs.get(jobId(req), owner(res))); } catch { res.sendStatus(HTTP_STATUS.notFound); } });
  router.post('/jobs/:jobId/cancel', (req, res) => { try { jobs.cancel(jobId(req), owner(res)); res.json({ accepted: true }); } catch { res.sendStatus(HTTP_STATUS.notFound); } });
  return { router, close: () => jobs.close() };
}
