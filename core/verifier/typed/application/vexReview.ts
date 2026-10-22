import { VEX_LIMITS, VEX_TOOLING } from '../domain/vexConfig';
import { VexRuleError, buildDocument, canonicalJson, checkStatement, parseIdentity, parseStatementInput, suggestStatus } from '../domain/vexRules';
import type { EvidenceKind, EvidenceRef, OpenVexDocument, VexDraft, VexStatement, VexStatus } from '../domain/vexTypes';

export interface VexStore {
  save(draft: VexDraft): Promise<void>;
  load(draftId: string): Promise<VexDraft>;
  list(): Promise<readonly VexDraft[]>;
  saveExport(draftId: string, document: OpenVexDocument): Promise<string>;
}
export interface EvidenceCatalog {
  list(): Promise<readonly EvidenceRef[]>;
  /** Re-derives the observation from the stored report; null when the report does not exist. */
  resolve(kind: EvidenceKind, reportId: string): Promise<EvidenceRef | null>;
}
export interface VexPorts { readonly store: VexStore; readonly evidence: EvidenceCatalog; now(): Date; id(): string; readonly tooling?: string }
/**
 * Review workflow for OpenVEX documents: evidence suggests, a named person decides, and only an approved draft is exported.
 * Absence of findings never produces not_affected; the reviewer may assert it explicitly with a justification.
 */
export function createVexReview({ store, evidence, now, id, tooling = VEX_TOOLING }: VexPorts) {
  const stamp = () => now().toISOString();
  async function editable(draftId: string): Promise<VexDraft> {
    const draft = await store.load(draftId);
    if (draft.review.state === 'approved') throw new VexRuleError('draft_approved');
    return draft;
  }
  async function resolveEvidence(refs: readonly { kind: EvidenceKind; reportId: string }[]): Promise<readonly EvidenceRef[]> {
    const resolved: EvidenceRef[] = [];
    for (const ref of refs) {
      const found = await evidence.resolve(ref.kind, ref.reportId);
      if (!found) throw new VexRuleError('evidence_not_found');
      resolved.push(found);
    }
    return resolved;
  }
  const touch = (draft: VexDraft, statements: readonly VexStatement[]): VexDraft => Object.freeze({ ...draft, statements: Object.freeze([...statements]), updatedAt: stamp() });
  return {
    listEvidence: () => evidence.list(),
    /** Suggestion only: the caller still has to supply the product, vulnerability ID and, for affected, an action. */
    async suggest(refs: readonly { kind: EvidenceKind; reportId: string }[]): Promise<VexStatus> { return suggestStatus(await resolveEvidence(refs)); },
    async createDraft(input: { author: unknown; role?: unknown }): Promise<VexDraft> {
      const author = parseIdentity(input.author, 'author');
      const role = input.role === undefined || input.role === '' ? null : parseIdentity(input.role, 'role');
      const existing = await store.list();
      if (existing.length >= VEX_LIMITS.draftsRetained) throw new VexRuleError('too_many_drafts');
      const created = stamp();
      const draft: VexDraft = Object.freeze({ schemaVersion: VEX_LIMITS.schemaVersion, draftId: id(), documentId: id(), version: 1, createdAt: created, updatedAt: created,
        author, role, statements: Object.freeze([]), review: Object.freeze({ state: 'draft' as const, approvedBy: null, approvedAt: null }) });
      await store.save(draft); return draft;
    },
    /** A new revision of an approved document keeps its document ID and raises the version. */
    async revise(draftId: string): Promise<VexDraft> {
      const base = await store.load(draftId);
      if (base.review.state !== 'approved') throw new VexRuleError('draft_not_approved');
      const created = stamp();
      const draft: VexDraft = Object.freeze({ ...base, draftId: id(), version: base.version + 1, createdAt: created, updatedAt: created,
        review: Object.freeze({ state: 'draft' as const, approvedBy: null, approvedAt: null }) });
      await store.save(draft); return draft;
    },
    async saveStatement(draftId: string, input: unknown, statementId?: string): Promise<VexDraft> {
      const draft = await editable(draftId);
      const parsed = parseStatementInput(input);
      const refs = await resolveEvidence(parsed.evidence);
      checkStatement(parsed, refs);
      if (statementId === undefined && draft.statements.length >= VEX_LIMITS.statementsPerDraft) throw new VexRuleError('too_many_statements');
      if (statementId !== undefined && !draft.statements.some(entry => entry.statementId === statementId)) throw new VexRuleError('statement_not_found');
      const statement: VexStatement = Object.freeze({ ...parsed, statementId: statementId ?? id(), timestamp: stamp(), evidence: Object.freeze(refs) });
      const next = touch(draft, statementId === undefined ? [...draft.statements, statement] : draft.statements.map(entry => entry.statementId === statementId ? statement : entry));
      await store.save(next); return next;
    },
    async removeStatement(draftId: string, statementId: string): Promise<VexDraft> {
      const draft = await editable(draftId);
      if (!draft.statements.some(entry => entry.statementId === statementId)) throw new VexRuleError('statement_not_found');
      const next = touch(draft, draft.statements.filter(entry => entry.statementId !== statementId));
      await store.save(next); return next;
    },
    /** Approval is a named person's decision over every statement; it freezes the draft. */
    async approve(draftId: string, approver: unknown): Promise<VexDraft> {
      const draft = await editable(draftId);
      const approvedBy = parseIdentity(approver, 'approver');
      if (!draft.statements.length) throw new VexRuleError('no_statements');
      // Evidence is re-read so a report removed or changed since drafting cannot support an approval.
      for (const statement of draft.statements) {
        const refs = await resolveEvidence(statement.evidence);
        if (canonicalJson(refs) !== canonicalJson(statement.evidence)) throw new VexRuleError('evidence_changed');
        checkStatement(statement, refs);
      }
      const approvedAt = stamp();
      const next: VexDraft = Object.freeze({ ...draft, updatedAt: approvedAt, review: Object.freeze({ state: 'approved' as const, approvedBy, approvedAt }) });
      await store.save(next); return next;
    },
    async exportDocument(draftId: string): Promise<{ document: OpenVexDocument; file: string }> {
      const draft = await store.load(draftId);
      const document = buildDocument(draft, draft.documentId, draft.version, tooling, draft.review.approvedAt ?? stamp());
      return { document, file: await store.saveExport(draftId, document) };
    },
    get: (draftId: string) => store.load(draftId),
    list: () => store.list(),
  };
}
export type VexReview = ReturnType<typeof createVexReview>;
