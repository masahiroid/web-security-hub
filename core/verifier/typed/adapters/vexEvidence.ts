import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { VEX_LIMITS, VEX_STORAGE } from '../domain/vexConfig';
import type { EvidenceKind, EvidenceObservation, EvidenceRef } from '../domain/vexTypes';
import type { EvidenceCatalog } from '../application/vexReview';
import { privateDirectory } from './privateDirectory';
import { readPrivateJson } from './privateJson';

const LOCATIONS: Readonly<Record<EvidenceKind, readonly string[]>> = Object.freeze({
  sample: ['artifacts', 'private', 'verifier'], genetic: ['artifacts', 'private', 'genetic-verifier'], source: ['artifacts', 'private', 'source-verifier'],
});
const COMPLETED_SEARCH = ['generation_limit', 'stagnation', 'trial_budget', 'diversity_exhausted'];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/**
 * Observations come from the stored report, never from the reviewer. Source-only reports are always inconclusive:
 * they carry no loaded-code attestation. A report that stopped early or timed out is inconclusive, not "not reproduced".
 */
export function summarizeReport(kind: EvidenceKind, input: unknown): EvidenceRef | null {
  const report = object(input);
  const reportId = report.reportId; const createdAt = report.createdAt;
  if (typeof reportId !== 'string' || !new RegExp(VEX_STORAGE.uuidPattern).test(reportId) || typeof createdAt !== 'string') return null;
  const digest = typeof report.sourceDigest === 'string' && new RegExp(VEX_LIMITS.sha256Pattern).test(report.sourceDigest) ? report.sourceDigest : null;
  let observation: EvidenceObservation = 'inconclusive';
  if (kind === 'sample') {
    const totals = object(report.totals);
    if (report.state === 'completed' && typeof totals.reproduced === 'number') {
      observation = totals.reproduced > 0 ? 'reproduced' : totals.inconclusive === 0 ? 'not_reproduced' : 'inconclusive';
    }
  } else if (kind === 'genetic') {
    const reproduction = object(report.reproduction).state;
    if (reproduction === 'reproduced') observation = 'reproduced';
    else if (typeof report.state === 'string' && COMPLETED_SEARCH.includes(report.state) && (reproduction === 'not_reproduced' || reproduction === 'not_attempted')) observation = 'not_reproduced';
  }
  return Object.freeze({ kind, reportId, observation, sourceDigest: digest, createdAt });
}
export function createVexEvidenceCatalog(dataRoot: string): EvidenceCatalog {
  async function read(kind: EvidenceKind, reportId: string): Promise<EvidenceRef | null> {
    if (!new RegExp(VEX_STORAGE.uuidPattern).test(reportId)) return null;
    const base = await privateDirectory(dataRoot, LOCATIONS[kind]);
    try { return summarizeReport(kind, await readPrivateJson(join(base, reportId), 'report.json', VEX_LIMITS.maximumBytes * 4)); } catch { return null; }
  }
  return {
    async list() {
      const found: EvidenceRef[] = [];
      for (const kind of Object.keys(LOCATIONS) as EvidenceKind[]) {
        const base = await privateDirectory(dataRoot, LOCATIONS[kind]);
        for (const entry of await readdir(base, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const summary = await read(kind, entry.name); if (summary) found.push(summary);
        }
      }
      return found.sort((left, right) => left.createdAt < right.createdAt ? 1 : -1);
    },
    resolve: read,
  };
}
