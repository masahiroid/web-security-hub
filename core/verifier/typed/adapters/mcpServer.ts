import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MCP_LIMITS, MCP_SERVER, MCP_TOOLS, McpToolError, TOOL_GRANTS, refusal } from '../domain/mcpPolicy';
import type { McpGrants, McpToolName } from '../domain/mcpPolicy';
import type { McpToolkit } from '../application/mcpToolkit';

const kind = z.enum(['sample', 'genetic', 'source']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const identifier = z.string().regex(UUID);
const mode = z.enum(['baseline', 'changed', 'fixed']).describe('baseline and fixed samples should not reproduce a violation; changed contains known ones');
const seed = z.number().int().min(0).max(MCP_LIMITS.maximumSeed).optional();
interface ToolDefinition { readonly title: string; readonly description: string; readonly shape: z.ZodRawShape; readonly readOnly: boolean }
const DEFINITIONS: Readonly<Record<McpToolName, ToolDefinition>> = Object.freeze({
  list_reports: { title: 'List saved reports', description: 'Lists saved verification reports with their kind, observation (reproduced, not_reproduced or inconclusive) and time. Metadata only.', readOnly: true,
    shape: { kind: kind.optional(), limit: z.number().int().min(1).max(MCP_LIMITS.listMaximum).optional() } },
  get_report_summary: { title: 'Summarize a report', description: 'Aggregate facts of one report: state, trial counts, reproduction state. No inputs or candidate values.', readOnly: true, shape: { kind, reportId: identifier } },
  get_report_details: { title: 'Report details with exact values', description: 'Exact synthetic candidate values and per-candidate results. Available only when the person who started this server allowed code snippets.', readOnly: true, shape: { kind, reportId: identifier } },
  start_sample_verification: { title: 'Start a sample verification', description: 'Runs the built-in sample verification in the background and returns a job handle. One job runs at a time.', readOnly: false,
    shape: { mode, scenario: z.enum(['all', 'boundary', 'ownership', 'workflow']).optional(), maxTrials: z.number().int().min(1).max(MCP_LIMITS.maximumTrials).optional(), randomSeed: seed } },
  start_genetic_search: { title: 'Start a genetic search', description: 'Runs the genetic search (or the fixed-rule baseline) on the built-in sample in the background and returns a job handle. Language models are never used.', readOnly: false,
    shape: { mode, method: z.enum(['ga', 'rules']).optional(), maxTrials: z.number().int().min(MCP_LIMITS.minimumTrials).max(MCP_LIMITS.maximumTrials).optional(), randomSeed: seed } },
  get_job_status: { title: 'Job status', description: 'State, progress and, when finished, an aggregate summary of a job started by this server.', readOnly: true, shape: { jobId: identifier } },
  cancel_job: { title: 'Cancel a job', description: 'Requests cancellation of a running job started by this server.', readOnly: false, shape: { jobId: identifier } },
  vex_suggest_status: { title: 'Suggest a VEX status', description: 'Suggests affected only when a selected report reproduced a violation, otherwise under_investigation. Never suggests not_affected or fixed.', readOnly: true,
    shape: { evidence: z.array(z.object({ kind, reportId: identifier })).max(MCP_LIMITS.listMaximum) } },
  vex_create_draft: { title: 'Create a VEX draft', description: 'Creates an empty OpenVEX draft. A named human reviewer must approve it in the app; approval is not available here.', readOnly: false,
    shape: { author: z.string().max(MCP_LIMITS.identifierCharacters * 2), role: z.string().max(MCP_LIMITS.identifierCharacters * 2).optional() } },
  vex_save_statement: { title: 'Save a VEX statement', description: 'Adds or replaces a statement in an unapproved draft. Fields: vulnerability, products [{id, sha256?}], status, basis (evidence|reviewer), justification, actionStatement, statusNotes, evidence [{kind, reportId}]. not_affected and fixed need the basis "reviewer".', readOnly: false,
    shape: { draftId: identifier, statement: z.record(z.string(), z.unknown()), statementId: identifier.optional() } },
  vex_list_drafts: { title: 'List VEX drafts', description: 'Lists drafts with version, state and statement count.', readOnly: true, shape: {} },
  vex_export_document: { title: 'Export an approved VEX document', description: 'Returns the OpenVEX document of a draft that a reviewer has approved. Refused for unapproved drafts.', readOnly: false, shape: { draftId: identifier } },
});
const INSTRUCTIONS = 'Verification tools for Web Security Hub. By default only report summaries and job status are available; running verifications, exact candidate values and VEX writing each need a permission given when the server was started. Results are measurements within a finite set of trials and do not prove safety. VEX approval is always done by a person in the app.';
/** Describes the tools and permissions in the protocol's own terms. Only tools whose permission was granted are offered. */
export function createMcpServer(toolkit: McpToolkit, grants: McpGrants, version: string): McpServer {
  const server = new McpServer({ name: MCP_SERVER.name, title: MCP_SERVER.title, version }, { instructions: INSTRUCTIONS });
  for (const name of Object.values(MCP_TOOLS)) {
    const needed = TOOL_GRANTS[name];
    if (needed && !grants[needed]) continue;
    const definition = DEFINITIONS[name];
    server.registerTool(name, { title: definition.title, description: definition.description, inputSchema: definition.shape,
      annotations: { readOnlyHint: definition.readOnly, destructiveHint: false, idempotentHint: definition.readOnly, openWorldHint: false } },
    async (input: Record<string, unknown>) => {
      try {
        const { structured } = await toolkit.tools[name](input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: { ...structured } };
      } catch (error: unknown) {
        const refused = error instanceof McpToolError ? error : refusal('failed');
        return { isError: true, content: [{ type: 'text' as const, text: refused.message }], structuredContent: { code: refused.code } };
      }
    });
  }
  return server;
}
