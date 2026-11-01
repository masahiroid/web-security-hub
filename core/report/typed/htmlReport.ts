import { statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { readCaseGroups, readFormFields, readRuns, type Assignment } from './sessionData';
import { escapeHtml, formatTimestamp, kindOfCase, pathOf, shortSelector } from './text';

/**
 * Generates a site-agnostic HTML report purely from a session directory's
 * generic artifacts (forms.json / test-cases.json / runs.jsonl / screenshots).
 * Carries no site-specific knowledge, so it works unchanged for any site.
 */

/** Renders report.html from a session directory and writes it there. Returns the output path. */
export function writeHtmlReport(sessionDir: string): string {
  const fieldTypes = new Map<string, string>();
  for (const field of readFormFields(join(sessionDir, 'forms.json'))) {
    if (field.selector && field.type) fieldTypes.set(field.selector, field.type);
  }
  const groups = readCaseGroups(join(sessionDir, 'test-cases.json'));
  const runs = readRuns(join(sessionDir, 'runs.jsonl'));

  const isCheckboxAssignment = (selector: string, assignment: Assignment): boolean => {
    const type = fieldTypes.get(selector);
    if (type === 'checkbox' || type === 'radio') return true;
    return (assignment.value === 'on' || assignment.value === 'off') && /\[\]?\d*\]?/.test(selector);
  };

  const relativeScreenshot = (file: string | undefined): string | null => {
    if (!file) return null;
    const rel = relative(sessionDir, file);
    return rel.startsWith('..') ? join('screenshots', basename(file)) : rel;
  };

  let totalCases = 0;
  let totalOk = 0;
  const sectionsHtml: string[] = [];
  const cardsHtml: string[] = [];

  groups.forEach((group, groupIndex) => {
    const okCount = group.cases.filter(testCase => runs.get(testCase.id)?.ok).length;
    totalCases += group.cases.length;
    totalOk += okCount;
    const anchor = `form-${groupIndex + 1}`;
    const pct = group.cases.length ? Math.round((100 * okCount) / group.cases.length) : 0;

    cardsHtml.push(`
      <a class="card" href="#${anchor}">
        <div class="card-top">
          <span class="card-title">${escapeHtml(pathOf(group.url))}</span>
          <span class="card-pass">${okCount}/${group.cases.length}</span>
        </div>
        <div class="card-bar"><div class="card-bar-fill" style="width:${pct}%"></div></div>
      </a>`);

    const rows = group.cases.map(testCase => {
      const kind = kindOfCase(testCase.name);
      const run = runs.get(testCase.id);
      const chips: string[] = [];
      let checkboxesOn = 0;
      let checkboxTotal = 0;
      for (const [selector, assignment] of testCase.assignments) {
        if (selector.startsWith('__')) continue;
        if (isCheckboxAssignment(selector, assignment)) {
          checkboxTotal++;
          if (assignment.value === 'on') checkboxesOn++;
          continue;
        }
        const shown = assignment.value === '' ? '(empty)' : assignment.value;
        const title = `${shortSelector(selector)} = ${assignment.value}\n${assignment.rationale ?? ''}`.trim();
        chips.push(
          `<span class="chip chip-${assignment.kind}" title="${escapeHtml(title)}">` +
            `<span class="chip-label">${escapeHtml(shortSelector(selector))}</span>` +
            `<span class="chip-value">${escapeHtml(shown)}</span></span>`,
        );
      }
      const checkboxes = checkboxTotal ? `<span class="cb">${checkboxesOn}/${checkboxTotal} ON</span>` : '&mdash;';
      const result =
        run?.ok === undefined
          ? '<span class="pill pill-skip">—</span>'
          : run.ok
            ? '<span class="pill pill-ok">PASS</span>'
            : `<span class="pill pill-fail" title="${escapeHtml(run.error ?? '')}">FAIL</span>`;
      const screenshot = relativeScreenshot(run?.screenshotPath);
      const screenshotCell = screenshot
        ? `<a class="shot" href="${escapeHtml(screenshot)}" target="_blank" rel="noopener" title="Open screenshot">🖼</a>`
        : '&mdash;';
      return `
        <tr>
          <td class="c-id"><span class="dot dot-${kind}"></span>${escapeHtml(testCase.id)}</td>
          <td class="c-name">${escapeHtml(testCase.name)}</td>
          <td class="c-fields">${chips.join('') || '&mdash;'}</td>
          <td class="c-cb">${checkboxes}</td>
          <td class="c-res">${result}</td>
          <td class="c-shot">${screenshotCell}</td>
        </tr>`;
    });

    sectionsHtml.push(`
    <section id="${anchor}">
      <div class="sec-head">
        <h2>${escapeHtml(pathOf(group.url))}</h2>
        <span class="sec-count">${group.cases.length} cases &middot; ${okCount} PASS</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th class="c-id">Case ID</th><th class="c-name">Kind</th>
            <th class="c-fields">Generated inputs</th><th class="c-cb">Checkboxes</th>
            <th class="c-res">Result</th><th class="c-shot">Screen</th>
          </tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    </section>`);
  });

  const generatedAt = formatTimestamp(statSync(sessionDir).mtime);
  const firstGroup = groups[0];
  const seedUrl = firstGroup ? pathOf(firstGroup.url).replace(/\/[^/]*$/, '/') : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golden Master Report ${escapeHtml(basename(sessionDir))}</title>
<style>
:root{--ink:#1b2a2e;--ink-soft:#47585c;--paper:#f4f3ee;--raised:#fbfaf6;--line:#d9d6cb;
--accent:#2f6f62;--accent-soft:#e1ece8;--ok:#2e8b57;--ok-soft:#e3f1e8;--warn:#c08a2e;
--warn-soft:#f8ecd6;--fail:#c0463c;--fail-soft:#f8e3e1;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
--serif:ui-serif,"Iowan Old Style",Georgia,serif;
--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#e7ede9;--ink-soft:#a8b6b1;
--paper:#10171a;--raised:#182225;--line:#2c3a3d;--accent:#6fb8a6;--accent-soft:#1d3630;
--ok:#5cc98a;--ok-soft:#163828;--warn:#e0ac52;--warn-soft:#3a2e15;--fail:#e18077;--fail-soft:#3a1e1c;}}
:root[data-theme="dark"]{--ink:#e7ede9;--ink-soft:#a8b6b1;--paper:#10171a;--raised:#182225;
--line:#2c3a3d;--accent:#6fb8a6;--accent-soft:#1d3630;--ok:#5cc98a;--ok-soft:#163828;
--warn:#e0ac52;--warn-soft:#3a2e15;--fail:#e18077;--fail-soft:#3a1e1c;}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.5;margin:0}
.wrap{max-width:1180px;margin:0 auto;padding:44px 24px 80px}
header.rh{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-family:var(--serif);font-weight:500;font-size:28px;margin:4px 0 2px}
.meta{font-size:14px;color:var(--ink-soft)}
.meta strong{color:var(--ink);font-variant-numeric:tabular-nums}
nav.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:28px 0 40px}
.card{display:flex;flex-direction:column;gap:8px;background:var(--raised);border:1px solid var(--line);
border-radius:6px;padding:14px 16px;text-decoration:none;color:inherit;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-1px)}
.card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.card-title{font-family:var(--mono);font-size:12px;word-break:break-all}
.card-pass{font-family:var(--mono);font-size:13px;color:var(--ok);white-space:nowrap;font-variant-numeric:tabular-nums}
.card-bar{height:4px;background:var(--line);border-radius:2px;overflow:hidden}
.card-bar-fill{height:100%;background:var(--ok)}
section{margin-bottom:44px;scroll-margin-top:16px}
.sec-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:10px}
.sec-head h2{font-family:var(--serif);font-weight:500;font-size:19px;margin:0;word-break:break-all}
.sec-count{font-size:12px;color:var(--ink-soft);margin-left:auto;font-variant-numeric:tabular-nums}
.table-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:13px;background:var(--raised)}
thead th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-soft);
font-weight:600;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
tbody td{padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--accent-soft)}
.c-id{font-family:var(--mono);white-space:nowrap;font-size:12px}
.c-name{white-space:nowrap;font-size:12px;color:var(--ink-soft)}
.c-cb{white-space:nowrap;font-family:var(--mono);font-size:12px;color:var(--ink-soft)}
.c-fields{min-width:340px}.c-shot{text-align:center}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px}
.dot-normal{background:var(--ok)}.dot-boundary{background:var(--warn)}.dot-abnormal{background:var(--fail)}
.chip{display:inline-flex;align-items:baseline;gap:5px;background:var(--paper);border:1px solid var(--line);
border-radius:4px;padding:2px 7px;margin:2px 4px 2px 0;font-family:var(--mono);font-size:11.5px;max-width:230px}
.chip-label{color:var(--ink-soft);flex-shrink:0}
.chip-value{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip-abnormal{border-color:var(--fail);background:var(--fail-soft)}
.chip-boundary{border-color:var(--warn);background:var(--warn-soft)}
.pill{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:600;padding:3px 9px;border-radius:99px}
.pill-ok{background:var(--ok-soft);color:var(--ok)}
.pill-fail{background:var(--fail-soft);color:var(--fail)}
.pill-skip{background:var(--line);color:var(--ink-soft)}
.shot{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:4px;
text-decoration:none;font-size:14px;border:1px solid var(--line);background:var(--paper)}
.shot:hover{border-color:var(--accent);background:var(--accent-soft)}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-soft)}
</style>
</head>
<body>
<div class="wrap">
  <header class="rh">
    <div class="eyebrow">Golden Master Test Report</div>
    <h1>${escapeHtml(seedUrl || 'Test results')}</h1>
    <div class="meta">${groups.length} forms &middot; <strong>${totalCases}</strong> cases total &middot; <strong>${totalOk}</strong> PASS &middot; ${escapeHtml(generatedAt)}</div>
  </header>
  <nav class="cards">${cardsHtml.join('')}</nav>
  ${sectionsHtml.join('')}
  <footer>session: <code>${escapeHtml(basename(sessionDir))}</code> &middot; auto-generated from test-cases.json / runs.jsonl / screenshots &middot; 🖼 opens the per-case screenshot</footer>
</div>
</body>
</html>`;

  const output = join(sessionDir, 'report.html');
  writeFileSync(output, html, 'utf8');
  return output;
}
