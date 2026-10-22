import { OPENVEX, VEX_LIMITS } from './vexConfig';
import type { EvidenceObservation, EvidenceRef, OpenVexDocument, VexBasis, VexDraft, VexProduct, VexStatementInput, VexStatement, VexStatus } from './vexTypes';

export class VexRuleError extends Error { constructor(readonly code: string) { super(`VEX rule violated: ${code}`); } }
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VexRuleError('expected_object'); return value as Record<string, unknown>; };
function text(value: unknown, maximum: number, code: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new VexRuleError(code);
  return value.trim();
}
const optionalText = (value: unknown, maximum: number, code: string): string | undefined => value === undefined ? undefined : text(value, maximum, code);
function closed(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new VexRuleError('unknown_field');
}
/** Identities and notes the reviewer types: bounded single-purpose text, never executable content. */
export function parseIdentity(value: unknown, code: string): string { return text(value, VEX_LIMITS.identityCharacters, code); }
function parseProduct(input: unknown): VexProduct {
  const value = record(input); closed(value, ['id', 'sha256']);
  const id = text(value.id, VEX_LIMITS.productIdCharacters, 'product_id');
  if (!/^[^\s]+$/.test(id) || !(id.startsWith(VEX_LIMITS.purlPrefix) || /^[a-z][a-z0-9+.-]*:/i.test(id))) throw new VexRuleError('product_id');
  if (value.sha256 === undefined) return Object.freeze({ id });
  if (typeof value.sha256 !== 'string' || !new RegExp(VEX_LIMITS.sha256Pattern).test(value.sha256)) throw new VexRuleError('product_hash');
  return Object.freeze({ id, sha256: value.sha256 });
}
/** Untrusted statement input from a person or an API becomes a bounded, closed object. Status rules are checked separately. */
export function parseStatementInput(input: unknown): VexStatementInput {
  const value = record(input);
  closed(value, ['vulnerability', 'description', 'products', 'status', 'basis', 'justification', 'impactStatement', 'statusNotes', 'actionStatement', 'evidence']);
  const vulnerability = text(value.vulnerability, VEX_LIMITS.nameCharacters, 'vulnerability');
  if (!new RegExp(VEX_LIMITS.namePattern).test(vulnerability)) throw new VexRuleError('vulnerability');
  if (!Array.isArray(value.products) || !value.products.length || value.products.length > VEX_LIMITS.productsPerStatement) throw new VexRuleError('products');
  const status = OPENVEX.statuses.find(candidate => candidate === value.status);
  const basis: VexBasis | undefined = value.basis === 'evidence' || value.basis === 'reviewer' ? value.basis : undefined;
  if (!status || !basis) throw new VexRuleError('status');
  const justification = value.justification === undefined ? undefined : OPENVEX.justifications.find(candidate => candidate === value.justification);
  if (value.justification !== undefined && !justification) throw new VexRuleError('justification');
  const evidenceInput = value.evidence === undefined ? [] : value.evidence;
  if (!Array.isArray(evidenceInput) || evidenceInput.length > VEX_LIMITS.evidencePerStatement) throw new VexRuleError('evidence');
  const evidence = evidenceInput.map(entry => {
    const item = record(entry); closed(item, ['kind', 'reportId']);
    if (item.kind !== 'sample' && item.kind !== 'genetic' && item.kind !== 'source') throw new VexRuleError('evidence');
    if (typeof item.reportId !== 'string' || !new RegExp('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$').test(item.reportId)) throw new VexRuleError('evidence');
    return Object.freeze({ kind: item.kind, reportId: item.reportId });
  });
  const description = optionalText(value.description, VEX_LIMITS.textCharacters, 'description');
  const impactStatement = optionalText(value.impactStatement, VEX_LIMITS.textCharacters, 'impact_statement');
  const statusNotes = optionalText(value.statusNotes, VEX_LIMITS.textCharacters, 'status_notes');
  const actionStatement = optionalText(value.actionStatement, VEX_LIMITS.textCharacters, 'action_statement');
  return Object.freeze({ vulnerability, ...(description ? { description } : {}), products: Object.freeze(value.products.map(parseProduct)), status, basis,
    ...(justification ? { justification } : {}), ...(impactStatement ? { impactStatement } : {}), ...(statusNotes ? { statusNotes } : {}),
    ...(actionStatement ? { actionStatement } : {}), evidence: Object.freeze(evidence) });
}
/** What the evidence alone may suggest. It never suggests not_affected or fixed, and non-reproduction is not a verdict. */
export function suggestStatus(evidence: readonly EvidenceRef[]): VexStatus {
  return evidence.some(entry => entry.observation === 'reproduced') ? 'affected' : 'under_investigation';
}
const OBSERVATIONS: readonly EvidenceObservation[] = ['reproduced', 'not_reproduced', 'inconclusive'];
/** OpenVEX field requirements plus this product's rule: no status is derived from the absence of findings. */
export function checkStatement(statement: VexStatementInput, evidence: readonly EvidenceRef[]): void {
  const { status, basis } = statement;
  if (evidence.some(entry => !OBSERVATIONS.includes(entry.observation))) throw new VexRuleError('evidence');
  if (status === 'under_investigation') { if (statement.justification || statement.actionStatement) throw new VexRuleError('unexpected_field'); return; }
  if (status === 'affected') {
    if (!statement.actionStatement) throw new VexRuleError('action_statement_required');
    if (statement.justification) throw new VexRuleError('unexpected_field');
    if (basis === 'evidence' && !evidence.some(entry => entry.observation === 'reproduced')) throw new VexRuleError('evidence_does_not_support_affected');
    return;
  }
  if (basis === 'evidence') throw new VexRuleError('evidence_cannot_establish_status');
  if (status === 'not_affected' && !statement.justification) throw new VexRuleError('justification_required');
  if (status === 'fixed' && (statement.justification || statement.actionStatement)) throw new VexRuleError('unexpected_field');
}
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : 1).map(([key, entry]) => [key, sorted(entry)])) : value;
/** Stable JSON used to detect whether a re-export changed the document. */
export const canonicalJson = (value: unknown): string => JSON.stringify(sorted(value));
function exportStatement(statement: VexStatement): Readonly<Record<string, unknown>> {
  const reviewerNote = statement.basis === 'reviewer' && statement.status !== 'under_investigation'
    ? 'Asserted by the reviewer; no automated evidence establishes this status.' : undefined;
  const notes = [statement.statusNotes, reviewerNote].filter((entry): entry is string => !!entry).join(' ');
  return Object.freeze({
    vulnerability: { name: statement.vulnerability, ...(statement.description ? { description: statement.description } : {}) },
    timestamp: statement.timestamp,
    products: statement.products.map(product => ({ '@id': product.id, ...(product.sha256 ? { hashes: { 'sha-256': product.sha256 } } : {}) })),
    status: statement.status,
    ...(statement.justification ? { justification: statement.justification } : {}),
    ...(statement.impactStatement ? { impact_statement: statement.impactStatement } : {}),
    ...(statement.actionStatement ? { action_statement: statement.actionStatement, action_statement_timestamp: statement.timestamp } : {}),
    ...(notes ? { status_notes: notes } : {}),
  });
}
/** Only an approved draft with at least one statement becomes a document. */
export function buildDocument(draft: VexDraft, documentId: string, version: number, tooling: string, timestamp: string): OpenVexDocument {
  if (draft.review.state !== 'approved' || !draft.review.approvedBy || !draft.statements.length) throw new VexRuleError('not_approved');
  draft.statements.forEach(statement => checkStatement(statement, statement.evidence));
  return Object.freeze({ '@context': OPENVEX.context, '@id': `${OPENVEX.idPrefix}${documentId}`, author: draft.author, ...(draft.role ? { role: draft.role } : {}),
    timestamp, version, tooling, statements: Object.freeze(draft.statements.map(exportStatement)) });
}
