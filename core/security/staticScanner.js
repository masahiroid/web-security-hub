'use strict';
const fs = require('fs');
const path = require('path');
const { finding } = require('./owasp');
const { createStaticFileAnalysis } = require('../verifier/generated/adapters/staticFileAnalysis');
const { staticMatches } = require('../verifier/generated/domain/staticRules');
const MAX_FILES = 3000, MAX_FILE_SIZE = 1024 * 1024;
const TEXT_EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml', '.env', '.properties', '.java', '.py', '.rb', '.php', '.go', '.cs', '.html', '.htm']);

function scanStatic({ sourceDir, onProgress = () => {} }) {
  const root = path.resolve(sourceDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('読み取り可能なソースディレクトリを指定してください');
  const files = collect(root); const findings = [];
  for (const file of files) {
    onProgress(`解析中: ${path.relative(root, file)}`);
    const bytes = fs.readFileSync(file); const content = bytes.toString('utf8'); const rel = path.relative(root, file); const lineOf = (idx) => content.slice(0, idx).split('\n').length;
    const analysis = createStaticFileAnalysis(bytes, rel);
    for (const match of staticMatches(content)) {
      const { startOffset, endOffset, ...details } = match;
      findings.push(finding({ ...details, location: `${rel}:${lineOf(startOffset)}`, ...analysis.at(details.id, startOffset, endOffset) }));
    }
  }
  return { sourceDir: root, scannedAt: new Date().toISOString(), filesScanned: files.length, findings, summary: summarize(findings) };
}
function collect(root) { const out = []; const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(e.name)) continue; const full = path.join(dir, e.name); if (e.isDirectory()) walk(full); else if (out.length < MAX_FILES && TEXT_EXT.has(path.extname(e.name).toLowerCase()) && fs.statSync(full).size <= MAX_FILE_SIZE) out.push(full); } }; walk(root); return out; }
function summarize(findings) { const out = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }; for (const f of findings) out[f.severity] = (out[f.severity] || 0) + 1; return out; }
module.exports = { scanStatic };
