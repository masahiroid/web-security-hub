#!/usr/bin/env node
'use strict';

/**
 * Re-runs a previously generated `generated.spec.ts` through Playwright's own
 * test runner, so a golden-master session can be replayed later (e.g. against
 * a new server build) instead of only ever running once at generation time.
 *
 * First run for a given session has no baseline screenshots yet, so pass
 * --update-snapshots to record them; subsequent runs without that flag compare
 * against the recorded baseline and fail on any pixel difference.
 *
 * Usage:
 *   node core/cli/replay.js <path-to-generated.spec.ts> [--update-snapshots] [-- <extra playwright args>]
 *   node core/cli/replay.js sites/<site>/.golden-master/<session>/generated.spec.ts --update-snapshots
 *   BASE_URL=https://new-server.example.com node core/cli/replay.js sites/<site>/.golden-master/<session>/generated.spec.ts
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { parseListReporterLines, writeReplayReport } = require('../report/replayReport');

function main() {
  const argv = process.argv.slice(2);
  const specArg = argv.find((a) => !a.startsWith('-'));
  const passthroughArgs = argv.filter((a) => a !== specArg);

  if (!specArg) {
    console.error('Usage: node core/cli/replay.js <path-to-generated.spec.ts> [--update-snapshots]');
    process.exit(1);
  }

  const specPath = path.resolve(process.cwd(), specArg);
  if (!fs.existsSync(specPath)) {
    console.error(`spec file not found: ${specPath}`);
    process.exit(1);
  }

  const sessionDir = path.dirname(specPath);
  const specFileName = path.basename(specPath);

  console.log(`[replay] session=${sessionDir}`);
  console.log(`[replay] running: node playwright/cli.js test ./${specFileName} ${passthroughArgs.join(' ')}`.trim());

  const capturedLines = [];
  const forward = (stream) => (chunk) => {
    const text = chunk.toString('utf8');
    stream.write(text);
    capturedLines.push(...text.split(/\r?\n/).filter(Boolean));
  };

  const child = spawn(process.execPath, [path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'test', `./${specFileName}`, ...passthroughArgs], {
    cwd: sessionDir,
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  child.stdout.on('data', forward(process.stdout));
  child.stderr.on('data', forward(process.stderr));

  child.on('close', (code) => {
    const results = parseListReporterLines(capturedLines);
    if (results.length) {
      const baseUrl = process.env.BASE_URL || '';
      const { htmlPath, mdPath } = writeReplayReport(sessionDir, { results, exitCode: code, baseUrl });
      console.log(`[replay] report written: ${htmlPath}`);
      console.log(`[replay] markdown report written: ${mdPath}`);
    }
    process.exit(code ?? 1);
  });
}

main();
