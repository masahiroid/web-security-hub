import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { escapeHtml, escapeMarkdownCell as cell, formatTimestamp } from './text';

/** One test result recovered from Playwright's list reporter. */
export interface ReplayResult {
  readonly id: string | undefined;
  readonly title: string;
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly duration: string;
}

export interface ReplaySummary {
  readonly results: readonly ReplayResult[];
  readonly exitCode: number | null;
  readonly baseUrl: string;
}

const LIST_LINE = /^\s*(✓|✘|-)\s+\d+\s+(.+?)\s+\(([^)]+)\)\s*$/;
const CASE_SUFFIX = /\/\s*((?:case|page)-\d+)\s*$/;

/**
 * Parses Playwright's default "list" reporter output (what `playwright test`
 * prints to stdout with no reporter configured) into per-test pass/fail
 * results, keyed back to our own case-XXX / page-XXX ids where the test
 * title ends in "/ case-XXX" or "/ page-XXX" (see core/codegen/playwright.js
 * — every generated test's title is suffixed with its case id for exactly
 * this purpose).
 */
export function parseListReporterLines(lines: readonly string[]): ReplayResult[] {
  const results: ReplayResult[] = [];
  for (const line of lines) {
    const match = LIST_LINE.exec(line);
    if (!match) continue;
    const [, symbol, fullTitle = '', duration = ''] = match;
    const breadcrumb = fullTitle.split(' › ');
    results.push({
      id: CASE_SUFFIX.exec(fullTitle)?.[1],
      title: breadcrumb[breadcrumb.length - 1] || fullTitle,
      ok: symbol === '✓',
      skipped: symbol === '-',
      duration,
    });
  }
  return results;
}

/** Renders replay-report.html + replay-report.md into sessionDir. Returns both paths. */
export function writeReplayReport(sessionDir: string, { results, exitCode, baseUrl }: ReplaySummary): { htmlPath: string; mdPath: string } {
  const total = results.length;
  const passed = results.filter(result => result.ok).length;
  const generatedAt = formatTimestamp(new Date());

  const rows = results
    .map(
      result => `
        <tr>
          <td class="c-id">${escapeHtml(result.id || '—')}</td>
          <td class="c-name">${escapeHtml(result.title)}</td>
          <td class="c-res">${result.skipped ? '<span class="pill pill-skip">SKIP</span>' : result.ok ? '<span class="pill pill-ok">PASS</span>' : '<span class="pill pill-fail">FAIL</span>'}</td>
          <td class="c-cb">${escapeHtml(result.duration || '')}</td>
        </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Replay Report ${escapeHtml(basename(sessionDir))}</title>
<style>
:root{--ink:#1b2a2e;--ink-soft:#47585c;--paper:#f4f3ee;--raised:#fbfaf6;--line:#d9d6cb;
--accent:#2f6f62;--accent-soft:#e1ece8;--ok:#2e8b57;--ok-soft:#e3f1e8;--fail:#c0463c;--fail-soft:#f8e3e1;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--serif:ui-serif,"Iowan Old Style",Georgia,serif;
--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#e7ede9;--ink-soft:#a8b6b1;
--paper:#10171a;--raised:#182225;--line:#2c3a3d;--accent:#6fb8a6;--accent-soft:#1d3630;
--ok:#5cc98a;--ok-soft:#163828;--fail:#e18077;--fail-soft:#3a1e1c;}}
:root[data-theme="dark"]{--ink:#e7ede9;--ink-soft:#a8b6b1;--paper:#10171a;--raised:#182225;
--line:#2c3a3d;--accent:#6fb8a6;--accent-soft:#1d3630;--ok:#5cc98a;--ok-soft:#163828;
--fail:#e18077;--fail-soft:#3a1e1c;}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.5;margin:0}
.wrap{max-width:900px;margin:0 auto;padding:44px 24px 80px}
header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-family:var(--serif);font-weight:500;font-size:26px;margin:4px 0 2px}
.meta{font-size:14px;color:var(--ink-soft)}
table{border-collapse:collapse;width:100%;font-size:13px;background:var(--raised);border:1px solid var(--line);border-radius:6px;overflow:hidden}
thead th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-soft);
font-weight:600;padding:10px 14px;border-bottom:1px solid var(--line)}
tbody td{padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
.c-id{font-family:var(--mono);white-space:nowrap;font-size:12px}
.pill{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px}
.pill-ok{background:var(--ok-soft);color:var(--ok)}
.pill-fail{background:var(--fail-soft);color:var(--fail)}
.pill-skip{background:var(--line);color:var(--ink-soft)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">Precision Test Platform — Replay Report</div>
    <h1>${passed}/${total} PASS</h1>
    <div class="meta">exit code <strong>${exitCode}</strong>${baseUrl ? ` &middot; BASE_URL=${escapeHtml(baseUrl)}` : ''} &middot; ${escapeHtml(generatedAt)}</div>
  </header>
  <table>
    <thead><tr><th>Case ID</th><th>Title</th><th>Result</th><th>Duration</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`;

  const markdown = [
    '# Replay Report',
    '',
    `session: \`${basename(sessionDir)}\` · ${passed}/${total} PASS · exit=${exitCode}${baseUrl ? ` · BASE_URL=${baseUrl}` : ''} · ${generatedAt}`,
    '',
    '| Case ID | Title | Result | Duration |',
    '|---|---|---|---|',
    ...results.map(result => `| ${cell(result.id || '')} | ${cell(result.title)} | ${result.skipped ? 'SKIP' : result.ok ? 'PASS' : 'FAIL'} | ${cell(result.duration || '')} |`),
    '',
  ].join('\n');

  const htmlPath = join(sessionDir, 'replay-report.html');
  const mdPath = join(sessionDir, 'replay-report.md');
  writeFileSync(htmlPath, html, 'utf8');
  writeFileSync(mdPath, markdown, 'utf8');
  return { htmlPath, mdPath };
}
