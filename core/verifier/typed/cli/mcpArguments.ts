import { parseArgs } from 'node:util';
import { NO_GRANTS } from '../domain/mcpPolicy';
import type { McpGrants } from '../domain/mcpPolicy';

export const MCP_USAGE = `Web Security Hub MCP server (stdio)
npm run verifier:mcp -- [--allow-run] [--allow-code-snippets] [--allow-vex]
  (no flags)            Report summaries and job status only / 要約と状態の参照だけ
  --allow-run           Let the client start sample verifications and genetic searches / 検証と探索の開始を許可
  --allow-code-snippets Let the client read exact candidate values / 具体的な候補値の参照を許可
  --allow-vex           Let the client write VEX drafts and export approved documents / VEXドラフトの作成と承認済み文書の取得を許可
Approval of VEX documents is never available here. Stdout carries only the protocol; logs go to stderr.
承認は常に画面で人が行います。標準出力にはプロトコルだけが流れ、ログは標準エラーへ出ます。
`;
export type McpCommand = { readonly kind: 'help' } | { readonly kind: 'serve'; readonly grants: McpGrants };
/** Grants come only from the person starting the server; unknown options are rejected. */
export function parseMcpArguments(argv: readonly string[]): McpCommand {
  const { values } = parseArgs({ args: [...argv], strict: true, allowPositionals: false, options: {
    help: { type: 'boolean' }, 'allow-run': { type: 'boolean' }, 'allow-code-snippets': { type: 'boolean' }, 'allow-vex': { type: 'boolean' } } });
  if (values.help) return { kind: 'help' };
  return { kind: 'serve', grants: Object.freeze({ ...NO_GRANTS, run: values['allow-run'] === true, codeSnippets: values['allow-code-snippets'] === true, vex: values['allow-vex'] === true }) };
}
