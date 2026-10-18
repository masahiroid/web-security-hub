const VIEW = Object.freeze({ maximumDisplayedRoutes: 8 });
const LABELS = {
  ja: { mapped: 'ルート対応：一意', ambiguous: 'ルート対応：複数候補', unavailable: 'ルート対応：解析できません', rule: 'ルールID', source: 'ソース', instance: '個別finding ID', digest: 'ソースSHA-256', span: '位置', line: '登録行', more: 'すべての候補はJSONレポートを参照してください。', notice: '同一ファイル内の静的な対応です。自動実行されず、実行時の到達を示す証拠ではありません。' },
  en: { mapped: 'Route mapping: one candidate', ambiguous: 'Route mapping: ambiguous', unavailable: 'Route mapping: unavailable', rule: 'Rule ID', source: 'Source', instance: 'Finding instance ID', digest: 'Source SHA-256', span: 'Span', line: 'Registration line', more: 'See the JSON report for all candidate routes.', notice: 'File-local static attribution only. This does not execute a request or establish runtime reachability.' }
};
const BINDING_NOTICE = { ja: '静的な対応は、許可済み試行の制約として照合します。実行時の到達を示す証拠ではありません。', en: 'Static attribution constrains separately authorized trials. It is not evidence of runtime reachability.' };
const REASONS: Record<string, readonly [string, string]> = {
  unique_static_route: ['静的な登録先が1件あります。', 'One static registration candidate.'],
  multiple_static_routes: ['同じコードに複数の登録先があり、1件に絞れません。', 'Shared code has multiple registration candidates.'],
  no_static_route: ['対応する静的ルート登録を確認できません。', 'No supported static route registration was found.'],
  unsupported_language: ['このファイル形式はルート解析の対象外です。', 'Route analysis does not support this file format.'],
  parse_error: ['対応するJavaScript構文として解析できません。', 'The file could not be parsed as supported JavaScript.'],
  analysis_limit: ['解析または結果サイズの上限に達しました。', 'An analysis or result-size limit was reached.'],
  unsupported_registration: ['未対応の登録・参照があり、対応を確定できません。', 'Unsupported registration or references prevent a unique conclusion.'],
  dynamic_registration: ['動的なルート名・登録には対応していません。', 'Dynamic route names or registrations are unsupported.'],
  non_code_finding: ['コメントや文字列等の指摘を実行コードに対応付けません。', 'This match is not attributed to executable code.']
};
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function paragraph(parent: HTMLElement, text: string): void { const p = document.createElement('p'); p.textContent = text; parent.append(p); }
export function sastFindingText(item: unknown, field: 'title' | 'evidence' | 'remediation', translate: (key: string) => string): string {
  if (!record(item)) return '';
  const fallback = typeof item[field] === 'string' ? item[field] : '';
  if (typeof item.ruleId !== 'string' || !item.ruleId.startsWith('SAST-')) return fallback;
  const key = `sast.${item.ruleId}.${field}`; const text = translate(key); return text === key ? fallback : text;
}
/** Build metadata with DOM text nodes; scanned paths never become HTML or links. */
export function renderSastMetadata(item: unknown, language: string, context: 'analysis' | 'binding' = 'analysis'): string {
  if (!record(item) || typeof item.findingInstanceId !== 'string' || !/^sast-[a-f0-9]{64}$/.test(item.findingInstanceId) || typeof item.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(item.sourceDigest) || !record(item.routeMapping)) return '';
  const mapping = item.routeMapping; const status = mapping.status;
  if (status !== 'mapped' && status !== 'ambiguous' && status !== 'unavailable') return '';
  const ja = language === 'ja'; const labels = LABELS[ja ? 'ja' : 'en'];
  const details = document.createElement('details'); details.className = 'sast-metadata';
  const summary = document.createElement('summary'); summary.textContent = labels[status]; details.append(summary);
  const reason = typeof mapping.reason === 'string' ? REASONS[mapping.reason] : undefined;
  if (reason) paragraph(details, reason[ja ? 0 : 1]);
  if (typeof item.relativePath === 'string') paragraph(details, `${labels.source}: ${item.relativePath}`);
  for (const [label, value] of [[labels.rule, typeof item.ruleId === 'string' ? item.ruleId : ''], [labels.instance, item.findingInstanceId], [labels.digest, item.sourceDigest]]) {
    const p = document.createElement('p'); p.append(`${label}: `); const code = document.createElement('code'); code.textContent = value ?? ''; p.append(code); details.append(p);
  }
  if (record(item.sourceSpan)) {
    const span = item.sourceSpan;
    if ([span.startLine, span.startColumn, span.endLine, span.endColumn].every(value => typeof value === 'number' && Number.isInteger(value) && value > 0)) paragraph(details, `${labels.span}: ${String(span.startLine)}:${String(span.startColumn)}–${String(span.endLine)}:${String(span.endColumn)} (UTF-16)`);
  }
  if (Array.isArray(mapping.routes)) {
    const list = document.createElement('ul');
    for (const route of (mapping.routes as unknown[]).slice(0, VIEW.maximumDisplayedRoutes)) {
      if (!record(route) || typeof route.method !== 'string' || typeof route.path !== 'string') continue;
      const row = document.createElement('li'); const code = document.createElement('code'); code.textContent = `${route.method} ${route.path}`; row.append(code);
      if (typeof route.registrationLine === 'number' && Number.isInteger(route.registrationLine)) row.append(` · ${labels.line} ${route.registrationLine}`);
      list.append(row);
    }
    details.append(list); if (mapping.routes.length > VIEW.maximumDisplayedRoutes) paragraph(details, labels.more);
  }
  paragraph(details, context === 'binding' ? BINDING_NOTICE[ja ? 'ja' : 'en'] : labels.notice); const container = document.createElement('div'); container.append(details); return container.innerHTML;
}
