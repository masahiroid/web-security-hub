'use strict';

const fs = require('fs');
const path = require('path');

const REPORT_ROOT = path.join(__dirname, '..', '..', 'artifacts', 'static-scans');

function createRunId(now = new Date()) {
  return `sast-${now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
}

function persistStaticReport(scan, now = new Date()) {
  const runId = createUniqueRunId(now);
  const runDir = path.join(REPORT_ROOT, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const report = { runId, generatedAt: now.toISOString(), sourceDir: scan.sourceDir, filesScanned: scan.filesScanned, summary: scan.summary, findings: scan.findings };
  fs.writeFileSync(path.join(runDir, 'sast-result.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'report.md'), renderMarkdown(report), 'utf8');
  fs.writeFileSync(path.join(runDir, 'report.html'), renderHtml(report), 'utf8');
  fs.writeFileSync(path.join(runDir, 'report.sarif'), JSON.stringify(renderSarif(report), null, 2) + '\n', 'utf8');
  return { runId, urls: { html: `/api/security/static-scans/${runId}/report.html`, markdown: `/api/security/static-scans/${runId}/report.md`, json: `/api/security/static-scans/${runId}/sast-result.json`, sarif: `/api/security/static-scans/${runId}/report.sarif` } };
}

function createUniqueRunId(now) {
  const base = createRunId(now);
  let candidate = base;
  let index = 2;
  while (fs.existsSync(path.join(REPORT_ROOT, candidate))) candidate = `${base}-${index++}`;
  return candidate;
}

function renderMarkdown(report) {
  const lines = ['# Web Security Hub — Static Analysis Report', '', `- Run: \`${report.runId}\``, `- Generated: ${report.generatedAt}`, `- Source directory: \`${report.sourceDir}\``, `- Files scanned: ${report.filesScanned}`, `- Findings: ${report.findings.length}`, '', '## Summary', '', '| Severity | Count |', '|---|---:|', ...Object.entries(report.summary).map(([severity, count]) => `| ${severity} | ${count} |`), '', '## Findings', ''];
  for (const item of report.findings) lines.push(`### ${item.severity.toUpperCase()} — ${item.title}`, '', `- Rule: \`${item.id}\``, `- OWASP: ${item.owasp?.id || 'UNMAPPED'} — ${item.owasp?.name || ''}`, `- Location: \`${item.location}\``, `- Evidence: ${item.evidence}`, `- Remediation: ${item.remediation}`, '');
  if (!report.findings.length) lines.push('No findings were reported.', '');
  return lines.join('\n');
}

function renderHtml(report) {
  const summary = Object.entries(report.summary).map(([severity, count]) => `<span class="severity ${escapeHtml(severity)}">${escapeHtml(severity)} ${count}</span>`).join(' ');
  const rows = report.findings.map((item) => `<tr><td><span class="severity ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></td><td><code>${escapeHtml(item.id)}</code><br>${escapeHtml(item.title)}</td><td>${escapeHtml(item.owasp?.id || 'UNMAPPED')}<br><small>${escapeHtml(item.owasp?.name || '')}</small></td><td><code>${escapeHtml(item.location)}</code></td><td>${escapeHtml(item.evidence)}<hr><strong>Remediation</strong><br>${escapeHtml(item.remediation)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Static Analysis Report ${escapeHtml(report.runId)}</title><style>body{font-family:system-ui,sans-serif;line-height:1.5;color:#1b2a2e;margin:2rem;max-width:1200px}code{font-family:ui-monospace,monospace;word-break:break-all}.meta{color:#57676b}.severity{display:inline-block;background:#68777d;color:#fff;border-radius:99px;padding:.1rem .5rem;font-size:.75rem;font-weight:700;text-transform:uppercase}.severity.critical,.severity.high{background:#b43030}.severity.medium{background:#bd7424}.severity.low{background:#547f9c}table{border-collapse:collapse;width:100%;margin-top:1rem}th,td{border:1px solid #d9d6cb;padding:.65rem;text-align:left;vertical-align:top}th{background:#e1ece8}hr{border:0;border-top:1px solid #d9d6cb;margin:.5rem 0}small{color:#57676b}</style></head><body><h1>Static Analysis Report</h1><p class="meta">Run <code>${escapeHtml(report.runId)}</code> · ${escapeHtml(report.generatedAt)} · ${report.filesScanned} files scanned · ${report.findings.length} findings</p><p class="meta">Source directory: <code>${escapeHtml(report.sourceDir)}</code></p><p>${summary}</p>${report.findings.length ? `<table><thead><tr><th>Severity</th><th>Rule</th><th>OWASP</th><th>Location</th><th>Evidence / remediation</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No findings were reported.</p>'}</body></html>`;
}

function renderSarif(report) {
  const rules = uniqueRules(report.findings).map((item) => ({ id: item.id, name: item.title, shortDescription: { text: item.title }, help: { text: item.remediation }, properties: { owasp: item.owasp?.id || 'UNMAPPED' } }));
  return { $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0', runs: [{ tool: { driver: { name: 'Web Security Hub SAST', informationUri: 'https://github.com/masahiroid/web-security-hub', rules } }, results: report.findings.map((item) => ({ ruleId: item.id, level: sarifLevel(item.severity), message: { text: `${item.evidence} Remediation: ${item.remediation}` }, locations: [sarifLocation(item.location)] })) }] };
}

function uniqueRules(findings) {
  const seen = new Set();
  return findings.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

function sarifLevel(severity) {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

function sarifLocation(location) {
  const match = /^(.*):(\d+)$/.exec(String(location));
  return { physicalLocation: { artifactLocation: { uri: match ? match[1] : String(location) }, region: match ? { startLine: Number(match[2]) } : undefined } };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

module.exports = { REPORT_ROOT, createRunId, persistStaticReport, renderMarkdown, renderHtml, renderSarif };
