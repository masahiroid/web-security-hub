import { geneticText, stopLabel, type GeneticLabel } from './config.js';
import { object, type JsonObject } from '../verifier/client.js';
import { get } from '../verifier/view.js';

const fixed = (value: unknown, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : geneticText('unavailable');
const label = (key: string): string => geneticText(key as GeneticLabel);
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
function head(columns: readonly string[]): void {
  const row = document.createElement('tr');
  for (const column of columns) { const cell = document.createElement('th'); cell.textContent = column; row.append(cell); }
  get('geneticHead').replaceChildren(row);
}
function addRow(values: readonly unknown[], detail: unknown, highlight = false): void {
  const row = document.createElement('tr'); row.tabIndex = 0;
  for (const value of values) { const cell = document.createElement('td'); cell.textContent = String(value ?? geneticText('unavailable')); row.append(cell); }
  if (highlight) row.classList.add('verifier-reproduced');
  const inspect = () => { get('geneticEvidence').textContent = JSON.stringify(detail, null, 2); document.querySelector<HTMLButtonElement>('[data-vpage=geneticEvidencePage]')?.click(); };
  row.addEventListener('click', inspect); row.addEventListener('keydown', event => { if (event.key === 'Enter') inspect(); });
  get('geneticRows').append(row);
}
function renderRun(report: JsonObject): void {
  const reproduction = String(report.reproduction);
  get('geneticSummary').textContent = `${label('outcome')}: ${label(reproduction)} · ${label('trialsUsed')}: ${String(report.trials)} / ${String(report.maxTrials)} · ${label('stop')}: ${stopLabel(report.state)}`;
  head([label('generation'), label('best'), label('unique'), label('fromModel')]);
  for (const raw of array(report.generations)) {
    const generation = object(raw); const individuals = array(generation.individuals).map(object);
    addRow([generation.index, fixed(generation.bestScore), generation.uniqueGenomes, individuals.filter(entry => entry.operator === 'llm').length], { generation: generation.index, individuals });
  }
  get('geneticEvidence').textContent = JSON.stringify({ reproducedSeed: report.reproducedSeed, proposals: report.proposals }, null, 2);
}
const methodName = (value: unknown) => value === 'rules' ? label('rulesM') : value === 'ga' ? label('gaM') : label('gaLlmM');
function renderCompare(report: JsonObject): void {
  get('geneticSummary').textContent = `${label('trialsUsed')}: ${String(report.maxTrials)} · seeds: ${array(report.seeds).join(', ')}${report.completed === false ? ` · ${label('incomplete')}` : ''}`;
  head([label('methodCol'), label('modeCol'), label('runs'), label('rate'), label('median'), label('points'), label('duplicates'), label('elapsed'), label('tokens')]);
  for (const raw of array(report.summaries)) {
    const summary = object(raw);
    addRow([methodName(summary.method), label(String(summary.mode)), `${String(summary.validRuns)} / ${String(summary.runs)}`, summary.validRuns === 0 ? geneticText('unavailable') : `${String(summary.reproduced)} / ${String(summary.validRuns)}`, fixed(summary.medianTrialsToFirstViolation, 0),
      fixed(summary.meanSemanticPoints, 1), fixed(summary.meanDuplicates, 1), fixed(summary.meanElapsedMs, 0), summary.totalTokens], summary, summary.mode === 'fixed' && Number(summary.reproduced) > 0);
  }
  get('geneticEvidence').textContent = JSON.stringify(report.runs, null, 2);
}
export function renderGenetic(value: unknown): void {
  const report = object(value);
  get('geneticRows').replaceChildren();
  if (report.kind === 'compare') renderCompare(report); else renderRun(report);
}
