import type { ScenarioReport, Totals } from './campaignTypes';
export function summarizeReports(scenarios: readonly ScenarioReport[], trials: number): Totals {
  let executed = 0; let reproduced = 0; let observedNoIssue = 0; let inconclusive = 0;
  for (const scenario of scenarios) for (const execution of scenario.executions) {
    if (execution.candidate) executed++;
    switch (execution.candidate?.assessment.result) {
      case 'reproduced': reproduced++; break;
      case 'no_issue_observed_in_scope': observedNoIssue++; break;
      default: inconclusive++; break;
    }
  }
  return Object.freeze({ planned: scenarios.reduce((count, scenario) => count + scenario.plan.length, 0), executed, trials, reproduced, observedNoIssue, inconclusive });
}
