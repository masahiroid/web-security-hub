import { GeneticEvaluationError } from '../domain/geneticCampaignTypes';
import { createGeneticSearch } from './geneticSearch';
import { compoundInitial, compoundSpace, GENETIC_FIXTURE } from '../domain/geneticFixtureConfig';
import { compoundOracle } from '../domain/compoundOracle';
import { individual } from '../domain/geneticEvolution';
import { POINTS } from '../domain/config';
import type { GeneticCampaignPorts, GeneticCampaignReport, GeneticExecution, GeneticFixtureOptions, GeneticReproduction, GeneticSession } from '../domain/geneticCampaignTypes';
import type { GeneticSearchReport } from './geneticSearch';
import type { GeneticStop, Individual } from '../domain/geneticTypes';

const completedSearch = new Set<GeneticStop>(['generation_limit', 'stagnation', 'trial_budget', 'diversity_exhausted']);
function winner(search: GeneticSearchReport, executions: readonly GeneticExecution[]): Individual | undefined {
  return search.generations.flatMap(generation => generation.individuals).find(entry => entry.fitness.eligible && executions.some(execution =>
    execution.individualId === entry.individual.id && execution.pair.candidate?.assessment.result === 'reproduced'))?.individual;
}
/** Owns use-case sequencing; adapters own servers, credentials, transport and storage. */
export async function runGeneticCampaign(ports: GeneticCampaignPorts, options: GeneticFixtureOptions, signal: AbortSignal): Promise<GeneticCampaignReport> {
  const started = ports.now();
  const deadline = started + options.settings.ttlMs;
  const expiry = new AbortController();
  const timer = setTimeout(() => expiry.abort(), options.settings.ttlMs);
  const combined = AbortSignal.any([signal, expiry.signal]);
  const interrupted = (): GeneticStop | null => signal.aborted ? 'cancelled' : combined.aborted || ports.now() >= deadline ? 'deadline' : null;
  let session: GeneticSession | undefined;
  let search: GeneticSearchReport | null = null;
  let sourceDigest: string | null = null;
  let state: GeneticStop = 'error';
  let trials = 0;
  let executions: readonly GeneticExecution[] = [];
  let reproduction: GeneticReproduction = Object.freeze({ state: 'not_attempted', seed: null, sourceDigest: null, execution: null });
  try {
    combined.throwIfAborted();
    const searchBudget = options.settings.maxTrials >= GENETIC_FIXTURE.reproductionTrials * 2 ? options.settings.maxTrials - GENETIC_FIXTURE.reproductionTrials : options.settings.maxTrials;
    session = await ports.start(options.mode, combined, deadline, searchBudget);
    sourceDigest = session.sourceDigest;
    const remaining = Math.floor(deadline - ports.now());
    if (remaining <= 0) { state = interrupted() ?? 'deadline'; }
    else {
      search = await createGeneticSearch(session, ports.now, GENETIC_FIXTURE.coveragePoints)({
        settings: { ...options.settings, maxTrials: searchBudget, ttlMs: remaining }, space: compoundSpace,
        initial: compoundInitial(options.settings.population), signal: combined,
      });
      state = search.stop;
    }
    await session.close();
    trials = session.trials; executions = session.executions;
    session = undefined;
    const discovered = search && completedSearch.has(state) ? winner(search, executions) : undefined;
    if (discovered && !interrupted() && options.settings.maxTrials - trials >= GENETIC_FIXTURE.reproductionTrials) {
      const replay = individual(`replay-${discovered.id}`, discovered.generation, discovered.seed, 'elite', [discovered.id], compoundSpace);
      reproduction = Object.freeze({ state: 'inconclusive', seed: replay.seed, sourceDigest: null, execution: null });
      session = await ports.start(options.mode, combined, deadline, GENETIC_FIXTURE.reproductionTrials);
      const result = await session.evaluate(replay, { signal: combined, deadline });
      const execution = session.executions[0] ?? null;
      const previousJobs = new Set(executions.map(entry => entry.pair.candidate?.observation.jobId));
      const valid = result.feedback.controlPassed && result.observation.outcome === 'completed' && result.evidence.state === 'verified' && result.feedback.oracle !== 'inconclusive' && result.feedback.zap !== 'incomplete';
      const independent = valid && session.sourceDigest === sourceDigest && !previousJobs.has(result.observation.jobId) &&
        result.evidence.state === 'verified' && result.feedback.instrumentation === 'verified' && result.observation.outcome === 'completed' &&
        result.evidence.events.some(event => event.point === POINTS.commit && compoundOracle(event.profile, true) === 'violated');
      const reproduced = independent && result.assessment.result === 'reproduced' && !interrupted();
      reproduction = Object.freeze({ state: reproduced ? 'reproduced' : valid && session.sourceDigest === sourceDigest ? 'not_reproduced' : 'inconclusive',
        seed: replay.seed, sourceDigest: session.sourceDigest, execution });
      if (session.sourceDigest !== sourceDigest || result.evidence.state === 'source_mismatch') state = 'source_changed';
      else if (result.observation.outcome === 'timeout') state = 'timeout';
      else if (!result.feedback.controlPassed) state = 'control_failed';
      else if (result.feedback.zap === 'incomplete') state = 'zap_incomplete';
      else if (!valid) state = 'unverified_evidence';
    }
  } catch (error: unknown) { state = interrupted() ?? (error instanceof GeneticEvaluationError ? error.stop : 'error'); }
  finally {
    try {
      if (session) {
        await session.close(); trials += session.trials;
        if (!search) executions = session.executions;
      }
    } catch { state = 'error'; }
    clearTimeout(timer);
  }
  state = interrupted() ?? state;
  if (interrupted() && reproduction.state === 'reproduced') reproduction = Object.freeze({ ...reproduction, state: 'inconclusive' });
  return Object.freeze({ schemaVersion: GENETIC_FIXTURE.reportVersion, reportId: ports.reportId(), applicationVersion: ports.applicationVersion,
    createdAt: new Date(started).toISOString(), options, state, sourceDigest, search, executions, reproduction, trials, draft: true, vexStatus: 'under_investigation' });
}
