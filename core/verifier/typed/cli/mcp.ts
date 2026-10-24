import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DATA_ROOT, PROJECT_ROOT } from '../../../paths';
import { createMcpToolkit } from '../application/mcpToolkit';
import { createVexReview } from '../application/vexReview';
import { CLI_EXIT } from '../domain/campaignConfig';
import { createMcpRunners } from '../adapters/mcpRunners';
import { createMcpServer } from '../adapters/mcpServer';
import { redirectConsoleToStderr } from '../adapters/stdoutGuard';
import { createVexEvidenceCatalog, readStoredReport } from '../adapters/vexEvidence';
import { createVexStore } from '../adapters/vexStore';
import { MCP_USAGE, parseMcpArguments } from './mcpArguments';
import type { McpCommand } from './mcpArguments';

function applicationVersion(): string {
  const metadata: unknown = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const version = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'version') : undefined;
  if (typeof version !== 'string') throw new Error('Missing application version');
  return version;
}
/** Serves the verification tools over stdio until the client disconnects or the process is told to stop. */
export async function main(argv: readonly string[]): Promise<number> {
  redirectConsoleToStderr();
  let command: McpCommand;
  try { command = parseMcpArguments(argv); } catch { process.stderr.write(MCP_USAGE); return CLI_EXIT.usage; }
  if (command.kind === 'help') { process.stderr.write(MCP_USAGE); return CLI_EXIT.success; }
  const version = applicationVersion();
  const evidence = createVexEvidenceCatalog(DATA_ROOT);
  const toolkit = createMcpToolkit({ grants: command.grants, runners: createMcpRunners({ applicationVersion: version, dataRoot: DATA_ROOT }), evidence,
    reports: { read: (kind, reportId) => readStoredReport(DATA_ROOT, kind, reportId) }, vex: createVexReview({ store: createVexStore(DATA_ROOT), evidence, now: () => new Date(), id: randomUUID }),
    now: Date.now, id: randomUUID });
  const server = createMcpServer(toolkit, command.grants, version);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>(resolve => { transport.onclose = resolve; });
  const stop = (): void => { void server.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  await server.connect(transport);
  process.stderr.write(`web-security-hub MCP server ready (run=${command.grants.run}, codeSnippets=${command.grants.codeSnippets}, vex=${command.grants.vex})\n`);
  await closed;
  await toolkit.close();
  return CLI_EXIT.success;
}
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exit(code); }, (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(CLI_EXIT.incomplete); });
