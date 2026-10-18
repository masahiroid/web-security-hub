import { validate } from '../../contracts';
import type { SastMetadata } from '../domain/sastMapping';

const keys = ['ruleId', 'findingInstanceId', 'sourceDigest', 'relativePath', 'sourceSpan', 'routeMapping'] as const;
export function readSastMetadata(item: unknown): SastMetadata | null {
  if (!item || typeof item !== 'object') return null;
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (!descriptor || !('value' in descriptor)) return null;
    data[key] = descriptor.value;
  }
  try { return validate('sastMetadata', data); } catch { return null; }
}
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
const label = { mapped: 'One declared route', ambiguous: 'Multiple candidate routes', unavailable: 'Route mapping unavailable' };
export function sastMetadataHtml(item: unknown): string {
  const metadata = readSastMetadata(item); if (!metadata) return '';
  const { routeMapping: mapping, sourceSpan: span } = metadata;
  const routes = mapping.routes.map(route => `<li><code>${escape(route.method)} ${escape(route.path)}</code> · registration line ${route.registrationLine}</li>`).join('');
  return `<details><summary>${label[mapping.status]}</summary><p>Instance: <code>${metadata.findingInstanceId}</code><br>SHA-256: <code>${metadata.sourceDigest}</code><br>Span: ${span.startLine}:${span.startColumn}–${span.endLine}:${span.endColumn} (UTF-16, end exclusive)<br>Mapping reason: ${escape(mapping.reason)}</p><ul>${routes}</ul><p>File-local static attribution only. No execution is authorized and runtime reachability is not established.</p></details>`;
}
export function sastMetadataMarkdown(item: unknown): string[] {
  const metadata = readSastMetadata(item); if (!metadata) return [];
  const { routeMapping: mapping, sourceSpan: span } = metadata;
  return [`- Finding instance: \`${metadata.findingInstanceId}\``, `- Source SHA-256: \`${metadata.sourceDigest}\``, `- Span: ${span.startLine}:${span.startColumn}–${span.endLine}:${span.endColumn} (UTF-16, end exclusive)`, `- Static mapping: ${mapping.status} / ${mapping.reason}`, ...mapping.routes.map(route => `- Candidate route: \`${route.method} ${route.path}\` (registration line ${route.registrationLine})`), '- File-local static attribution only; no execution authorization or runtime reachability evidence.', ''];
}
export function sastSarifMetadata(item: unknown) {
  const metadata = readSastMetadata(item); if (!metadata) return {};
  return { partialFingerprints: { 'webSecurityHubInstance/v1': metadata.findingInstanceId }, properties: { sourceDigest: metadata.sourceDigest, staticRouteMapping: metadata.routeMapping } };
}
export function sastSarifLocation(item: unknown) {
  const metadata = readSastMetadata(item); if (!metadata) return null;
  const span = metadata.sourceSpan;
  return { physicalLocation: { artifactLocation: { uri: metadata.relativePath.split('/').map(encodeURIComponent).join('/') }, region: { startLine: span.startLine, startColumn: span.startColumn, endLine: span.endLine, endColumn: span.endColumn } } };
}
