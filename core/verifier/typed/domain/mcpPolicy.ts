/** Vocabulary and limits of the MCP (Model Context Protocol) surface. Grants are chosen by the person who starts the server, never by the client. */
export const MCP_SERVER = Object.freeze({ name: 'web-security-hub', title: 'Web Security Hub verification', protocolVersion: '2025-06-18' });
export const MCP_TOOLS = Object.freeze({
  listReports: 'list_reports', getReportSummary: 'get_report_summary', getReportDetails: 'get_report_details',
  startSampleVerification: 'start_sample_verification', startGeneticSearch: 'start_genetic_search', getJobStatus: 'get_job_status', cancelJob: 'cancel_job',
  vexSuggestStatus: 'vex_suggest_status', vexCreateDraft: 'vex_create_draft', vexSaveStatement: 'vex_save_statement', vexListDrafts: 'vex_list_drafts', vexExportDocument: 'vex_export_document',
});
export type McpToolName = typeof MCP_TOOLS[keyof typeof MCP_TOOLS];
/** What the person starting the server permits. Every field is off by default: a server with no flags can only read summaries. */
export interface McpGrants { readonly run: boolean; readonly codeSnippets: boolean; readonly vex: boolean }
export const NO_GRANTS: McpGrants = Object.freeze({ run: false, codeSnippets: false, vex: false });
/** Which permission a tool needs; null means metadata only. */
export const TOOL_GRANTS: Readonly<Record<McpToolName, keyof McpGrants | null>> = Object.freeze({
  list_reports: null, get_report_summary: null, get_job_status: null, cancel_job: null,
  get_report_details: 'codeSnippets', start_sample_verification: 'run', start_genetic_search: 'run',
  vex_suggest_status: null, vex_create_draft: 'vex', vex_save_statement: 'vex', vex_list_drafts: null, vex_export_document: 'vex',
});
export type RateClass = 'read' | 'start' | 'write';
export const TOOL_RATE_CLASS: Readonly<Record<McpToolName, RateClass>> = Object.freeze({
  list_reports: 'read', get_report_summary: 'read', get_report_details: 'read', get_job_status: 'read', cancel_job: 'write', vex_suggest_status: 'read', vex_list_drafts: 'read',
  start_sample_verification: 'start', start_genetic_search: 'start', vex_create_draft: 'write', vex_save_statement: 'write', vex_export_document: 'write',
});
export const MCP_LIMITS = Object.freeze({
  windowMs: 60_000,
  callsPerWindow: Object.freeze({ read: 60, write: 30, start: 6 } as Readonly<Record<RateClass, number>>),
  listDefault: 20, listMaximum: 50, maximumReportDetails: 20,
  activeJobs: 1, retainedJobs: 8, maximumTrials: 1_000, minimumTrials: 2, maximumSeed: 4_294_967_295,
  identifierCharacters: 80, textCharacters: 2_000, statementsReturned: 64,
});
export type McpRefusalCode = 'grant_required' | 'rate_limited' | 'unknown_job' | 'busy' | 'not_found' | 'invalid_input' | 'not_approved' | 'failed';
/** An expected refusal that the client should see as a tool error, with a stable code and no internals. */
export class McpToolError extends Error { constructor(readonly code: McpRefusalCode, message: string) { super(message); } }
const REFUSAL_TEXT: Readonly<Record<McpRefusalCode, string>> = Object.freeze({
  grant_required: 'This permission was not granted when the server was started.', rate_limited: 'Too many calls; try again later.', unknown_job: 'No such job.',
  busy: 'Another job is running.', not_found: 'Not found.', invalid_input: 'The input was not accepted.', not_approved: 'The draft has not been approved by a reviewer.', failed: 'The operation could not be completed.',
});
export const refusal = (code: McpRefusalCode, detail?: string): McpToolError => new McpToolError(code, detail ? `${REFUSAL_TEXT[code]} ${detail}` : REFUSAL_TEXT[code]);
/** A fixed-window call counter per class of tool, so a client cannot flood the verifier or the disk. */
export function createRateLimiter(now: () => number, limits: Readonly<Record<RateClass, number>> = MCP_LIMITS.callsPerWindow, windowMs: number = MCP_LIMITS.windowMs) {
  const windows = new Map<RateClass, { start: number; count: number }>();
  return {
    /** Counts one call; false when the class's allowance for the current window is used up. */
    take(rateClass: RateClass): boolean {
      const time = now();
      const current = windows.get(rateClass);
      const entry = !current || time - current.start >= windowMs ? { start: time, count: 0 } : current;
      if (entry.count >= limits[rateClass]) { windows.set(rateClass, entry); return false; }
      entry.count++; windows.set(rateClass, entry); return true;
    },
  };
}
export function requireGrant(grants: McpGrants, tool: McpToolName): void {
  const needed = TOOL_GRANTS[tool];
  if (needed && !grants[needed]) throw refusal('grant_required', `Needs the "${needed}" permission.`);
}
