// Existing SAST rule vocabulary and signatures. Fresh regex instances keep scans independent.
const rules = [
  [/\b(eval|Function)\s*\(/g, 'SAST-DANGEROUS-EVAL', '動的コード実行', 'high', 'A03', 'eval / Function は入力由来のコード実行につながります。', '動的実行を除去し、許可リストまたは安全なパーサーを使用してください。'],
  [/\b(child_process|execSync|spawnSync)\b/g, 'SAST-COMMAND-EXEC', 'コマンド実行 API', 'medium', 'A03', 'OS コマンド実行 API の参照を検出しました。', '外部入力をコマンド文字列へ連結せず、引数配列・許可リストを使用してください。'],
  [/\b(SELECT|INSERT|UPDATE|DELETE)\b[^\n]*\+|\$\{[^}]+\}[^\n]*\b(SELECT|INSERT|UPDATE|DELETE)\b/gi, 'SAST-SQL-CONCAT', 'SQL 文字列連結の疑い', 'high', 'A03', 'SQL 文の文字列連結・テンプレート展開を検出しました。', 'プレースホルダー付きのパラメータ化クエリを使用してください。'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(AKIA[0-9A-Z]{16}|sk_live_[0-9A-Za-z]+)\b/g, 'SAST-SECRET', 'ハードコードされた秘密情報の疑い', 'high', 'A02', '鍵・トークン形式の文字列を検出しました。', '秘密情報を即時ローテーションし、秘密情報ストアまたは環境変数へ移してください。'],
  [/\b(disableTlsCerts|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|rejectUnauthorized\s*:\s*false)\b/g, 'SAST-TLS-DISABLED', 'TLS 証明書検証の無効化', 'high', 'A02', 'TLS 証明書検証を無効にする設定を検出しました。', '証明書検証を有効にし、正しい CA を設定してください。'],
] as const;
export function* staticMatches(source: string) {
  for (const [signature, id, title, severity, owasp, evidence, remediation] of rules) {
    const regex = new RegExp(signature.source, signature.flags);
    for (const match of source.matchAll(regex)) yield { id, title, severity, owasp, evidence, remediation,
      startOffset: match.index, endOffset: match.index + match[0].length };
  }
}

/** Verify one known match without rescanning unrelated rules or searching beyond its start. */
export function matchesStaticRuleAt(source: string, ruleId: string, start: number, end: number): boolean {
  const rule = rules.find(item => item[1] === ruleId); if (!rule) return false;
  const regex = new RegExp(rule[0].source, rule[0].flags.replace('g', '') + 'y'); regex.lastIndex = start;
  const match = regex.exec(source); return Boolean(match && match.index === start && start + match[0].length === end);
}
