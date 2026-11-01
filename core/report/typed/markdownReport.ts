import { statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readCaseGroups, readRuns } from './sessionData';
import { escapeMarkdownCell as cell, formatTimestamp, kindOfCase, pathOf, shortSelector } from './text';

/**
 * Generates a Markdown rendering of the same session data used by the HTML
 * report (test-cases.json / runs.jsonl), for pasting into a PR description,
 * Slack, or an issue tracker.
 */

/** Renders report.md from a session directory and writes it there. Returns the output path. */
export function writeMarkdownReport(sessionDir: string): string {
  const groups = readCaseGroups(join(sessionDir, 'test-cases.json'));
  const runs = readRuns(join(sessionDir, 'runs.jsonl'));

  let totalCases = 0;
  let totalOk = 0;
  const sections: string[] = [];

  for (const group of groups) {
    const okCount = group.cases.filter(testCase => runs.get(testCase.id)?.ok).length;
    totalCases += group.cases.length;
    totalOk += okCount;

    const rows = group.cases.map(testCase => {
      const run = runs.get(testCase.id);
      const result = run?.ok === undefined ? 'SKIP' : run.ok ? 'PASS' : 'FAIL';
      const inputs = testCase.assignments
        .filter(([selector]) => !selector.startsWith('__'))
        .map(([selector, assignment]) => `${shortSelector(selector)}=${assignment.value === '' ? '(empty)' : assignment.value}`)
        .join(', ');
      const error = run && !run.ok ? run.error ?? '' : '';
      return `| ${cell(testCase.id)} | ${cell(testCase.name)} | ${kindOfCase(testCase.name)} | ${result} | ${cell(inputs)} | ${cell(error)} |`;
    });

    sections.push([
      `### ${pathOf(group.url)}`,
      '',
      `${group.cases.length} cases · ${okCount} PASS`,
      '',
      '| Case ID | Name | Kind | Result | Inputs | Error |',
      '|---|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n'));
  }

  const generatedAt = formatTimestamp(statSync(sessionDir).mtime);
  const markdown = [
    '# Precision Test Platform — Test Report',
    '',
    `session: \`${basename(sessionDir)}\` · ${groups.length} forms · ${totalCases} cases total · ${totalOk} PASS · ${generatedAt}`,
    '',
    ...sections,
  ].join('\n');

  const output = join(sessionDir, 'report.md');
  writeFileSync(output, markdown, 'utf8');
  return output;
}
