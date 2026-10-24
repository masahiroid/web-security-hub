import { VEX_STORAGE } from './vexConfig';
import type { EvidenceKind } from './vexTypes';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
/** Aggregate facts only: no inputs, values, identifiers of trials or evidence. Safe to give a connected AI by default. */
export interface ReportSummary { readonly kind: EvidenceKind; readonly reportId: string; readonly createdAt: string | null; readonly state: string | null; readonly facts: Readonly<Record<string, string | number | boolean | null>> }
export function summarizeReport(kind: EvidenceKind, input: unknown): ReportSummary | null {
  const report = record(input);
  const reportId = text(report.reportId);
  if (!reportId || !new RegExp(VEX_STORAGE.uuidPattern).test(reportId)) return null;
  const base = { kind, reportId, createdAt: text(report.createdAt), state: text(report.state) };
  if (kind === 'genetic') {
    const search = record(report.search);
    return Object.freeze({ ...base, facts: Object.freeze({ mode: text(record(report.options).mode), method: text(record(report.options).method), reproduction: text(record(report.reproduction).state),
      trials: count(report.trials), generations: array(search.generations).length, llmCalls: array(search.proposals).filter(entry => record(entry).outcome === 'proposed').length }) });
  }
  if (kind === 'sample') {
    const totals = record(report.totals);
    return Object.freeze({ ...base, facts: Object.freeze({ mode: text(report.mode), executed: count(totals.executed), trials: count(totals.trials), reproduced: count(totals.reproduced), observedNoIssue: count(totals.observedNoIssue), inconclusive: count(totals.inconclusive) }) });
  }
  return Object.freeze({ ...base, facts: Object.freeze({ assurance: text(report.assurance) }) });
}
/** Exact inputs and candidate values: shared only when the person starting the server granted code snippets. */
export function reportDetails(kind: EvidenceKind, input: unknown, maximum: number): Readonly<Record<string, unknown>> {
  const report = record(input);
  if (kind === 'genetic') {
    const reproduction = record(report.reproduction);
    const generations = array(record(report.search).generations).slice(-maximum).map(generation => {
      const entry = record(generation);
      return { index: count(entry.index), best: count(entry.bestScore), candidates: array(entry.individuals).slice(0, maximum).map(item => { const candidate = record(item); const individual = record(candidate.individual);
        return { operator: text(individual.operator), values: record(record(individual.seed).values), score: count(record(candidate.fitness).score) }; }) };
    });
    return Object.freeze({ reproducedValues: reproduction.state === 'reproduced' ? record(record(reproduction.seed).values) : null, generations });
  }
  if (kind === 'sample') {
    const rows = array(report.scenarios).flatMap(scenario => array(record(scenario).executions).map(execution => {
      const entry = record(execution); const candidate = record(entry.candidate ?? entry.control);
      return { candidate: text(entry.candidateId), profile: text(record(candidate.observation).authProfileId), status: count(record(candidate.observation).status), result: text(record(candidate.assessment).result) };
    }));
    return Object.freeze({ candidates: rows.slice(0, maximum) });
  }
  return Object.freeze({});
}
