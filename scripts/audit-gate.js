'use strict';
// Dependency audit gate. Production dependencies must be clean; the full tree
// (including development tools) fails on any advisory except the narrowly
// scoped, expiring exceptions below. Anything new, at any severity, fails.
const { spawnSync } = require('child_process');

/**
 * Accepted advisories. Each entry names one advisory in one install path and
 * stops being accepted on `expires`, so it cannot be forgotten.
 */
const ACCEPTED = [
  {
    advisory: 'GHSA-27r3-jxmh-p828',
    path: 'node_modules/appium-xcuitest-driver/node_modules/body-parser',
    expires: '2026-12-31',
    reason: 'Copy bundled inside a development-only iOS driver; not part of any shipped build and not replaceable by overrides.'
  }
];

/** Returns advisory findings (advisory id + install path) from `npm audit --json` output. */
function findings(report) {
  const out = [];
  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      if (typeof via === 'string') continue;
      const advisory = String(via.url || '').split('/').pop() || String(via.source);
      for (const nodePath of vulnerability.nodes || []) out.push({ advisory, path: nodePath, name: via.name });
    }
  }
  return out;
}

/** Splits findings into rejected ones and accepted ones, honouring expiry. */
function evaluate(report, accepted, today) {
  const rejected = [];
  const used = [];
  for (const item of findings(report)) {
    const rule = accepted.find(entry => entry.advisory === item.advisory && entry.path === item.path);
    if (rule && today <= rule.expires) used.push({ ...item, expires: rule.expires });
    else rejected.push({ ...item, expired: Boolean(rule) });
  }
  return { rejected, used };
}

function main() {
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  let report;
  try { report = JSON.parse(run.stdout); } catch { console.error('Could not read the audit report.'); return 2; }
  if (report.error) { console.error(`Audit failed: ${report.error.summary || report.error.code}`); return 2; }
  const { rejected, used } = evaluate(report, ACCEPTED, new Date().toISOString().slice(0, 10));
  for (const item of used) console.log(`Accepted until ${item.expires}: ${item.advisory} at ${item.path}`);
  for (const item of rejected) console.error(`${item.expired ? 'Expired exception' : 'Advisory'}: ${item.advisory} (${item.name}) at ${item.path}`);
  return rejected.length ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { findings, evaluate, ACCEPTED };
