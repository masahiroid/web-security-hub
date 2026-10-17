import { text, type Label } from './config.js';
import { object, type JsonObject } from './client.js';
export function get(id: string): HTMLElement { const element = document.getElementById(id); if (!element) throw Error('Missing verifier element'); return element; }
export function field(id: string): HTMLInputElement | HTMLSelectElement { const element = get(id); if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) throw Error('Missing verifier field'); return element; }
export function translate(root: HTMLElement): void { root.querySelectorAll<HTMLElement>('[data-vlabel]').forEach(element => { const key = element.dataset.vlabel; if (key) element.textContent = text(key as Label); }); }
export function renderReport(value: unknown): void {
  const report = object(value); const totals = object(report.totals);
  get('verifierSummary').textContent = `${text('summary')}: ${String(totals.executed)} / ${String(totals.reproduced)} / ${String(totals.inconclusive)}`;
  get('verifierEvidence').textContent = JSON.stringify(report.scenarios, null, 2);
  const tbody = get('verifierRows'); tbody.replaceChildren();
  if (!Array.isArray(report.scenarios)) throw Error('Invalid scenarios');
  const resultText = (key: unknown) => typeof key === 'string' && ['reproduced', 'no_issue_observed_in_scope', 'under_investigation', 'observed', 'not_observed', 'unavailable'].includes(key) ? text(key as Label) : String(key ?? '—');
  const rows: { values: unknown[]; reproduced: boolean; execution: JsonObject }[] = [];
  for (const rawScenario of report.scenarios) {
    const scenario = object(rawScenario); if (!Array.isArray(scenario.executions)) continue;
    for (const rawExecution of scenario.executions) {
      const execution = object(rawExecution); const candidate: JsonObject = object(execution.candidate ?? execution.control); const observation = object(candidate.observation); const assessment = object(candidate.assessment); const feedback = object(candidate.feedback);
      rows.push({ values: [execution.candidateId, observation.authProfileId, observation.status, resultText(assessment.result), resultText(feedback.reachability)], reproduced: assessment.result === 'reproduced', execution });
    }
  }
  for (const entry of rows.sort((left, right) => Number(right.reproduced) - Number(left.reproduced))) {
    const row = document.createElement('tr'); row.tabIndex = 0;
    for (const value of entry.values) { const cell = document.createElement('td'); cell.textContent = String(value ?? '—'); row.append(cell); }
    if (entry.reproduced) row.classList.add('verifier-reproduced');
    const inspect = () => { get('verifierEvidence').textContent = JSON.stringify(entry.execution, null, 2); document.querySelector<HTMLButtonElement>('[data-vpage=verifierEvidencePage]')?.click(); };
    row.addEventListener('click', inspect); row.addEventListener('keydown', event => { if (event.key === 'Enter') inspect(); }); tbody.append(row);
  }
}
