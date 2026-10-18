'use strict';
const fs = require('fs');
const path = require('path');
const { finding } = require('./owasp');
const { createStaticFileAnalysis } = require('../verifier/generated/adapters/staticFileAnalysis');
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
    const rules = [
      [/\b(eval|Function)\s*\(/g, 'SAST-DANGEROUS-EVAL', '動的コード実行', 'high', 'A03', 'eval / Function は入力由来のコード実行につながります。', '動的実行を除去し、許可リストまたは安全なパーサーを使用してください。'],
      [/\b(child_process|execSync|spawnSync)\b/g, 'SAST-COMMAND-EXEC', 'コマンド実行 API', 'medium', 'A03', 'OS コマンド実行 API の参照を検出しました。', '外部入力をコマンド文字列へ連結せず、引数配列・許可リストを使用してください。'],
      [/\b(SELECT|INSERT|UPDATE|DELETE)\b[^\n]*\+|\$\{[^}]+\}[^\n]*\b(SELECT|INSERT|UPDATE|DELETE)\b/gi, 'SAST-SQL-CONCAT', 'SQL 文字列連結の疑い', 'high', 'A03', 'SQL 文の文字列連結・テンプレート展開を検出しました。', 'プレースホルダー付きのパラメータ化クエリを使用してください。'],
      [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(AKIA[0-9A-Z]{16}|sk_live_[0-9A-Za-z]+)\b/g, 'SAST-SECRET', 'ハードコードされた秘密情報の疑い', 'high', 'A02', '鍵・トークン形式の文字列を検出しました。', '秘密情報を即時ローテーションし、秘密情報ストアまたは環境変数へ移してください。'],
      [/\b(disableTlsCerts|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|rejectUnauthorized\s*:\s*false)\b/g, 'SAST-TLS-DISABLED', 'TLS 証明書検証の無効化', 'high', 'A02', 'TLS 証明書検証を無効にする設定を検出しました。', '証明書検証を有効にし、正しい CA を設定してください。'],
    ];
    for (const [regex, id, title, severity, owasp, evidence, remediation] of rules) { let match; while ((match = regex.exec(content))) findings.push(finding({ id, title, severity, owasp, location: `${rel}:${lineOf(match.index)}`, evidence, remediation, ...analysis.at(id, match.index, match.index + match[0].length) })); }
  }
  return { sourceDir: root, scannedAt: new Date().toISOString(), filesScanned: files.length, findings, summary: summarize(findings) };
}
function collect(root) { const out = []; const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(e.name)) continue; const full = path.join(dir, e.name); if (e.isDirectory()) walk(full); else if (out.length < MAX_FILES && TEXT_EXT.has(path.extname(e.name).toLowerCase()) && fs.statSync(full).size <= MAX_FILE_SIZE) out.push(full); } }; walk(root); return out; }
function summarize(findings) { const out = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }; for (const f of findings) out[f.severity] = (out[f.severity] || 0) + 1; return out; }
module.exports = { scanStatic };
