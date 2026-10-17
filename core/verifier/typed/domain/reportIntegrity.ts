import type { Report } from './campaignTypes';
import type { ContractsPort, Result } from './types';
import { CAMPAIGN } from './campaignConfig';
import { summarizeReports } from './reportSummary';
export function assertReportIntegrity(report: Report, contracts: ContractsPort): void {
  if (!Number.isFinite(Date.parse(report.createdAt)) || report.mode !== report.options.mode) throw Error('Invalid report metadata');
  const totals = summarizeReports(report.scenarios, report.totals.trials);
  if (Object.entries(totals).some(([key, value]) => Reflect.get(report.totals, key) !== value) || report.totals.trials > report.options.maxTrials) throw Error('Invalid report totals');
  const check = (result: Result) => {
    contracts.validate('feedback', result.feedback);
    const expected = contracts.assess(result.feedback);
    const assessmentMatches = Object.entries(expected).every(([key, value]) => Array.isArray(value) ? JSON.stringify(value) === JSON.stringify(Reflect.get(result.assessment, key)) : value === Reflect.get(result.assessment, key));
    if (result.feedback.seedId !== result.observation.seedId || result.feedback.outcome !== result.observation.outcome || result.feedback.status !== result.observation.status || !assessmentMatches) throw Error('Invalid assessment identity');
    if (result.feedback.oracle !== 'inconclusive' && result.feedback.oracle !== result.evidence.oracle) throw Error('Oracle evidence mismatch');
    if (result.evidence.state !== 'verified' && (result.feedback.instrumentation !== 'unavailable' || result.feedback.oracle !== 'inconclusive')) throw Error('Unverified result');
    if (result.evidence.state === 'verified' && (result.evidence.sourceDigest !== report.sourceDigest || result.feedback.sourceDigest !== report.sourceDigest || result.feedback.instrumentation !== 'verified' || result.feedback.reachability !== result.evidence.reachability || !result.evidence.events.length || JSON.stringify(result.feedback.evidenceIds) !== JSON.stringify(result.evidence.events.map(event => event.evidenceId)))) throw Error('Evidence build mismatch');
    if (result.evidence.state !== 'verified' && (result.evidence.events.length || result.feedback.evidenceIds.length || result.evidence.sourceDigest !== null)) throw Error('Unverified evidence data');
    for (const event of result.evidence.events) {
      if (event.mode !== report.mode || event.sourceDigest !== report.sourceDigest || ['jobId', 'trialId', 'seedId', 'requestId', 'authProfileId'].some(key => Reflect.get(event, key) !== Reflect.get(result.observation, key))) throw Error('Evidence identity mismatch');
    }
  };
  if (report.totals.trials < report.totals.executed * CAMPAIGN.trialsPerPair || report.state === 'completed' && report.totals.executed !== report.totals.planned) throw Error('Incomplete execution marked complete');
  const seen = new Set<string>();
  for (const scenario of report.scenarios) {
    if (scenario.plan.length > report.options.maxCandidates || report.options.scenario !== 'all' && scenario.scenarioId !== report.options.scenario) throw Error('Scenario outside run options');
    if (seen.has(scenario.scenarioId)) throw Error('Duplicate scenario'); seen.add(scenario.scenarioId);
    for (const planned of scenario.plan) contracts.validate('seed', planned.seed);
    const plans = new Map(scenario.plan.map(candidate => [candidate.seed.seedId, candidate]));
    if (plans.size !== scenario.plan.length) throw Error('Duplicate candidate');
    const executed = new Set<string>();
    for (const execution of scenario.executions) {
      const plan = plans.get(execution.candidateId);
      if (!plan || executed.has(execution.candidateId)) throw Error('Execution outside plan'); executed.add(execution.candidateId);
      check(execution.control);
      if (execution.candidate) {
        check(execution.candidate);
        if (execution.candidate.observation.seedId !== execution.candidateId || execution.candidate.observation.authProfileId !== plan.authProfileId) throw Error('Candidate identity mismatch');
      }
    }
  }
}
