import type { OPENVEX } from './vexConfig';

export type VexStatus = typeof OPENVEX.statuses[number];
export type VexJustification = typeof OPENVEX.justifications[number];
/** Where the status comes from: what the correlated evidence shows, or an explicit claim by the reviewer. */
export type VexBasis = 'evidence' | 'reviewer';
export type EvidenceKind = 'sample' | 'genetic' | 'source';
export type EvidenceObservation = 'reproduced' | 'not_reproduced' | 'inconclusive';
/** Facts re-derived from a stored report; a reviewer can name a report but cannot choose its observation. */
export interface EvidenceRef { readonly kind: EvidenceKind; readonly reportId: string; readonly observation: EvidenceObservation; readonly sourceDigest: string | null; readonly createdAt: string }
export interface VexProduct { readonly id: string; readonly sha256?: string }
export interface VexStatementInput {
  readonly vulnerability: string; readonly description?: string; readonly products: readonly VexProduct[]; readonly status: VexStatus; readonly basis: VexBasis;
  readonly justification?: VexJustification; readonly impactStatement?: string; readonly statusNotes?: string; readonly actionStatement?: string;
  readonly evidence: readonly { readonly kind: EvidenceKind; readonly reportId: string }[];
}
export interface VexStatement extends Omit<VexStatementInput, 'evidence'> { readonly statementId: string; readonly timestamp: string; readonly evidence: readonly EvidenceRef[] }
export interface VexReview { readonly state: 'draft' | 'approved'; readonly approvedBy: string | null; readonly approvedAt: string | null }
export interface VexDraft {
  readonly schemaVersion: number; readonly draftId: string; readonly createdAt: string; readonly updatedAt: string;
  /** Stable across revisions of the same document; `version` increases with each revision. */
  readonly documentId: string; readonly version: number;
  readonly author: string; readonly role: string | null; readonly statements: readonly VexStatement[]; readonly review: VexReview;
}
export interface OpenVexDocument {
  readonly '@context': string; readonly '@id': string; readonly author: string; readonly role?: string; readonly timestamp: string; readonly version: number; readonly tooling: string;
  readonly statements: readonly Readonly<Record<string, unknown>>[];
}
