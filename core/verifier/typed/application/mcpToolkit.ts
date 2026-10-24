import { MCP_LIMITS, MCP_TOOLS, McpToolError, TOOL_RATE_CLASS, createRateLimiter, refusal, requireGrant } from '../domain/mcpPolicy';
import type { McpGrants, McpToolName } from '../domain/mcpPolicy';
import { reportDetails, summarizeReport } from '../domain/mcpSummary';
import type { ReportSummary } from '../domain/mcpSummary';
import { VexRuleError } from '../domain/vexRules';
import type { EvidenceKind } from '../domain/vexTypes';
import { createVerificationJobs } from './verificationJobs';
import type { JobService, JobView } from './verificationJobs';
import type { EvidenceCatalog, VexReview } from './vexReview';

export interface SampleStart { readonly mode: 'baseline' | 'changed' | 'fixed'; readonly scenario: 'all' | 'boundary' | 'ownership' | 'workflow'; readonly maxTrials: number | undefined; readonly randomSeed: number | undefined }
export interface GeneticStart { readonly mode: 'baseline' | 'changed' | 'fixed'; readonly method: 'rules' | 'ga'; readonly maxTrials: number | undefined; readonly randomSeed: number | undefined }
export interface McpJobProgress { readonly done: number; readonly planned: number }
/** Runs the existing verification services; the toolkit never builds its own runner. Each returns the complete private report. */
export interface McpRunners {
  sample(input: SampleStart, controls: { signal: AbortSignal; onProgress: (progress: McpJobProgress) => undefined }): Promise<unknown>;
  genetic(input: GeneticStart, controls: { signal: AbortSignal }): Promise<unknown>;
}
export interface ReportReader { read(kind: EvidenceKind, reportId: string): Promise<unknown> }
export interface McpToolkitPorts {
  readonly grants: McpGrants; readonly runners: McpRunners; readonly evidence: EvidenceCatalog; readonly reports: ReportReader; readonly vex: VexReview;
  now(): number; id(): string;
}
export interface McpToolResult { readonly structured: Readonly<Record<string, unknown>> }
/** One tool: the protocol layer has already checked the input's shape; the tool still checks values. */
export type McpToolHandler = (input: Record<string, unknown>) => Promise<McpToolResult>;
type JobRequest = { readonly kind: 'sample'; readonly input: SampleStart } | { readonly kind: 'genetic'; readonly input: GeneticStart };
const isKind = (value: unknown): value is EvidenceKind => value === 'sample' || value === 'genetic' || value === 'source';
const asKind = (value: unknown): EvidenceKind => { if (!isKind(value)) throw refusal('invalid_input', 'Unknown report kind.'); return value; };
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw refusal('invalid_input', 'Expected an identifier.');
  return value;
};
const bounded = (value: unknown, minimum: number, maximum: number): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw refusal('invalid_input', `Expected an integer from ${minimum} to ${maximum}.`);
  return value;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/**
 * The tools a connected AI may call. Each call checks the grant chosen by the person who started the server, then a rate limit,
 * and only then uses the same services as the desktop app. Reviewer approval of VEX documents is deliberately not available here.
 */
export function createMcpToolkit(ports: McpToolkitPorts) {
  const limiter = createRateLimiter(ports.now);
  const jobs = createVerificationJobs<JobRequest, ReportSummary | null, McpJobProgress>({
    async run(request, controls) {
      const report = request.kind === 'sample'
        ? await ports.runners.sample(request.input, { signal: controls.signal, onProgress: progress => { controls.onProgress(progress); return undefined; } })
        : await ports.runners.genetic(request.input, { signal: controls.signal });
      return { report: summarizeReport(request.kind, report), saved: null };
    },
  } satisfies JobService<JobRequest, ReportSummary | null, McpJobProgress>, ports.id);
  // One owner: a handle can only come from this server's own start tools.
  const OWNER = 'mcp-client';
  const guarded = <Input, Output extends McpToolResult>(tool: McpToolName, operation: (input: Input) => Promise<Output>) => async (input: Input): Promise<Output> => {
    requireGrant(ports.grants, tool);
    if (!limiter.take(TOOL_RATE_CLASS[tool])) throw refusal('rate_limited');
    try { return await operation(input); }
    catch (error: unknown) {
      if (error instanceof McpToolError) throw error;
      if (error instanceof VexRuleError) throw refusal(error.code.endsWith('_not_found') ? 'not_found' : error.code === 'not_approved' ? 'not_approved' : 'invalid_input', `(${error.code})`);
      throw refusal('failed');
    }
  };
  const live = new Set<string>();
  const activeJobs = (): number => [...live].filter(id => { try { return jobs.get(id, OWNER).state === 'running'; } catch { return false; } }).length;
  /** Starts a job unless one is already running; only the toolkit's own start tools create handles. */
  const startJob = (request: JobRequest) => {
    if (activeJobs() >= MCP_LIMITS.activeJobs) throw refusal('busy');
    try { const job = jobs.start(OWNER, request); live.add(job.jobId); return job; } catch { throw refusal('busy'); }
  };
  const view = (job: JobView<ReportSummary | null, McpJobProgress>) => ({ jobId: job.jobId, state: job.state, progress: job.progress, result: job.report });
  const jobOf = (value: unknown): JobView<ReportSummary | null, McpJobProgress> => {
    const jobId = identifier(value);
    try { return jobs.get(jobId, OWNER); } catch { throw refusal('unknown_job'); }
  };
  const tools: Readonly<Record<McpToolName, McpToolHandler>> = {
    [MCP_TOOLS.listReports]: guarded(MCP_TOOLS.listReports, async (input: { kind?: unknown; limit?: unknown }) => {
      const kind = input.kind === undefined ? undefined : asKind(input.kind);
      const limit = bounded(input.limit, 1, MCP_LIMITS.listMaximum) ?? MCP_LIMITS.listDefault;
      const entries = (await ports.evidence.list()).filter(entry => !kind || entry.kind === kind).slice(0, limit);
      return { structured: { reports: entries.map(entry => ({ kind: entry.kind, reportId: entry.reportId, observation: entry.observation, createdAt: entry.createdAt })) } };
    }),
    [MCP_TOOLS.getReportSummary]: guarded(MCP_TOOLS.getReportSummary, async (input: { kind?: unknown; reportId?: unknown }) => {
      const kind = asKind(input.kind); const reportId = identifier(input.reportId);
      const summary = summarizeReport(kind, await ports.reports.read(kind, reportId));
      if (!summary) throw refusal('not_found');
      return { structured: { summary } };
    }),
    [MCP_TOOLS.getReportDetails]: guarded(MCP_TOOLS.getReportDetails, async (input: { kind?: unknown; reportId?: unknown }) => {
      const kind = asKind(input.kind); const reportId = identifier(input.reportId);
      const report = await ports.reports.read(kind, reportId);
      if (!summarizeReport(kind, report)) throw refusal('not_found');
      return { structured: { details: reportDetails(kind, report, MCP_LIMITS.maximumReportDetails) } };
    }),
    [MCP_TOOLS.startSampleVerification]: guarded(MCP_TOOLS.startSampleVerification, async (input: { mode?: unknown; scenario?: unknown; maxTrials?: unknown; randomSeed?: unknown }) => {
      const mode = input.mode === 'baseline' || input.mode === 'changed' || input.mode === 'fixed' ? input.mode : undefined;
      if (!mode) throw refusal('invalid_input', 'Choose baseline, changed or fixed.');
      const scenario = input.scenario === undefined ? 'all' : input.scenario === 'all' || input.scenario === 'boundary' || input.scenario === 'ownership' || input.scenario === 'workflow' ? input.scenario : undefined;
      if (!scenario) throw refusal('invalid_input', 'Unknown scenario.');
      const job = startJob({ kind: 'sample', input: { mode, scenario, maxTrials: bounded(input.maxTrials, 1, MCP_LIMITS.maximumTrials), randomSeed: bounded(input.randomSeed, 0, MCP_LIMITS.maximumSeed) } });
      return { structured: view(job) };
    }),
    [MCP_TOOLS.startGeneticSearch]: guarded(MCP_TOOLS.startGeneticSearch, async (input: { mode?: unknown; method?: unknown; maxTrials?: unknown; randomSeed?: unknown }) => {
      const mode = input.mode === 'baseline' || input.mode === 'changed' || input.mode === 'fixed' ? input.mode : undefined;
      if (!mode) throw refusal('invalid_input', 'Choose baseline, changed or fixed.');
      const method = input.method === undefined ? 'ga' : input.method === 'ga' || input.method === 'rules' ? input.method : undefined;
      if (!method) throw refusal('invalid_input', 'Unknown method.');
      const job = startJob({ kind: 'genetic', input: { mode, method, maxTrials: bounded(input.maxTrials, MCP_LIMITS.minimumTrials, MCP_LIMITS.maximumTrials), randomSeed: bounded(input.randomSeed, 0, MCP_LIMITS.maximumSeed) } });
      return { structured: view(job) };
    }),
    [MCP_TOOLS.getJobStatus]: guarded(MCP_TOOLS.getJobStatus, async (input: { jobId?: unknown }) => ({ structured: view(jobOf(input.jobId)) })),
    [MCP_TOOLS.cancelJob]: guarded(MCP_TOOLS.cancelJob, async (input: { jobId?: unknown }) => {
      const job = jobOf(input.jobId);
      jobs.cancel(job.jobId, OWNER);
      return { structured: { jobId: job.jobId, cancelRequested: true } };
    }),
    [MCP_TOOLS.vexSuggestStatus]: guarded(MCP_TOOLS.vexSuggestStatus, async (input: { evidence?: unknown }) => {
      const refs = Array.isArray(input.evidence) ? input.evidence.map(entry => ({ kind: asKind(object(entry).kind), reportId: identifier(object(entry).reportId) })) : [];
      if (refs.length > MCP_LIMITS.listMaximum) throw refusal('invalid_input');
      return { structured: { status: await ports.vex.suggest(refs), note: 'A suggestion only: the reviewer decides, and not affected or fixed are never suggested.' } };
    }),
    [MCP_TOOLS.vexCreateDraft]: guarded(MCP_TOOLS.vexCreateDraft, async (input: { author?: unknown; role?: unknown }) => {
      const draft = await ports.vex.createDraft({ author: input.author, ...(input.role === undefined ? {} : { role: input.role }) });
      return { structured: { draftId: draft.draftId, documentId: draft.documentId, version: draft.version, state: draft.review.state } };
    }),
    [MCP_TOOLS.vexSaveStatement]: guarded(MCP_TOOLS.vexSaveStatement, async (input: { draftId?: unknown; statement?: unknown; statementId?: unknown }) => {
      const draft = await ports.vex.saveStatement(identifier(input.draftId), input.statement, input.statementId === undefined ? undefined : identifier(input.statementId));
      return { structured: { draftId: draft.draftId, state: draft.review.state, statements: draft.statements.length } };
    }),
    [MCP_TOOLS.vexListDrafts]: guarded(MCP_TOOLS.vexListDrafts, async () => ({ structured: { drafts: (await ports.vex.list()).slice(0, MCP_LIMITS.statementsReturned)
      .map(draft => ({ draftId: draft.draftId, version: draft.version, state: draft.review.state, statements: draft.statements.length })) } })),
    [MCP_TOOLS.vexExportDocument]: guarded(MCP_TOOLS.vexExportDocument, async (input: { draftId?: unknown }) => {
      const draft = await ports.vex.get(identifier(input.draftId));
      if (draft.review.state !== 'approved') throw refusal('not_approved');
      return { structured: { document: (await ports.vex.exportDocument(draft.draftId)).document } };
    }),
  };
  return Object.freeze({ tools, close: () => jobs.close() });
}
export type McpToolkit = ReturnType<typeof createMcpToolkit>;
