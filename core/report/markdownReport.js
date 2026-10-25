'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Generates a Markdown rendering of the same session data used by
 * core/report/htmlReport.js (forms.json / test-cases.json / runs.jsonl),
 * for pasting into a PR description, Slack, or an issue tracker.
 */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || '');
  } catch {
    return url;
  }
}

function shortSelector(sel) {
  const m = sel.match(/name="([^"]+)"/);
  if (m) return m[1];
  return sel.replace(/^#/, '');
}

function kindOfCase(name) {
  if (name.includes('異常') || /abnormal/i.test(name)) return 'abnormal';
  if (name.includes('境界') || /boundary/i.test(name)) return 'boundary';
  return 'normal';
}

function mdEscape(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Renders report.md from a session directory and writes it there. Returns the output path. */
function writeMarkdownReport(sessionDir) {
  const groups = readJson(path.join(sessionDir, 'test-cases.json'), []);
  const runs = readJsonl(path.join(sessionDir, 'runs.jsonl'));
  const runById = new Map();
  for (const r of runs) if (r.testCaseId) runById.set(r.testCaseId, r);

  let totalCases = 0;
  let totalOk = 0;
  const sections = [];

  groups.forEach((g) => {
    const cases = g.cases ?? [];
    const okCount = cases.filter((c) => runById.get(c.id)?.ok).length;
    totalCases += cases.length;
    totalOk += okCount;

    const rows = cases.map((c) => {
      const run = runById.get(c.id);
      const kind = kindOfCase(c.name);
      const result = run?.ok === undefined ? 'SKIP' : run.ok ? 'PASS' : 'FAIL';
      const inputs = Object.entries(c.assignments ?? {})
        .filter(([sel]) => !sel.startsWith('__'))
        .map(([sel, a]) => `${shortSelector(sel)}=${a.value === '' ? '(empty)' : a.value}`)
        .join(', ');
      const error = run && !run.ok ? run.error ?? '' : '';
      return `| ${mdEscape(c.id)} | ${mdEscape(c.name)} | ${kind} | ${result} | ${mdEscape(inputs)} | ${mdEscape(error)} |`;
    });

    sections.push(
      [
        `### ${pathOf(g.url)}`,
        '',
        `${cases.length} cases · ${okCount} PASS`,
        '',
        '| Case ID | Name | Kind | Result | Inputs | Error |',
        '|---|---|---|---|---|---|',
        ...rows,
        '',
      ].join('\n'),
    );
  });

  const generatedAt = fs.statSync(sessionDir).mtime.toISOString().replace('T', ' ').slice(0, 19);
  const md = [
    `# Precision Test Platform — Test Report`,
    '',
    `session: \`${path.basename(sessionDir)}\` · ${groups.length} forms · ${totalCases} cases total · ${totalOk} PASS · ${generatedAt}`,
    '',
    ...sections,
  ].join('\n');

  const out = path.join(sessionDir, 'report.md');
  fs.writeFileSync(out, md, 'utf8');
  return out;
}

module.exports = { writeMarkdownReport };
