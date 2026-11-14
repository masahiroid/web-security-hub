import type { CodegenExpectation, FormCodegenItem } from '../../codegen/typed/playwright';
import { executeCase, testCaseHasAbnormalAssignment, type CaseSession, type CaseSettings } from './caseExecutor';
import { expandScenarios, isAllNormal } from './scenarioExpansion';
import type { FieldSemantic, FieldValue, Log, RunnerConstraints, RunnerField, RunnerForm, RunnerStore, ScenarioExpansionEntry, SemanticProvider, TestCase } from './types';

/** At most this many assignment hints are kept per run summary. */
const MAX_ASSIGNMENT_HINTS = 20;

/** Rule Spec rules resolved against one form. */
export interface SpecBinding {
  readonly constraintOverrides: ReadonlyMap<string, RunnerConstraints>;
  readonly extraValues: ReadonlyMap<string, readonly FieldValue[]>;
  readonly combinations: readonly unknown[];
  readonly expectations: readonly CodegenExpectation[];
  readonly appliedRules: readonly string[];
}

export interface CombinationResult {
  readonly cases: TestCase[];
  readonly dropped: number;
  readonly added: number;
}

/** Value generation and Rule Spec ports (implemented by core/values and core/spec). */
export interface FormProcessorDependencies {
  generateValues(field: RunnerField, semantic: FieldSemantic | undefined): FieldValue[];
  mergeValues(values: readonly FieldValue[], extra: readonly FieldValue[]): FieldValue[];
  buildTestCases(fieldValues: ReadonlyMap<string, readonly FieldValue[]>, maxCases: number): TestCase[];
  applyCombinationConstraints(cases: readonly TestCase[], combinations: readonly unknown[], fieldValues: ReadonlyMap<string, readonly FieldValue[]>, maxCases: number): CombinationResult;
  bindSpecsToForm(form: RunnerForm, specs: readonly unknown[]): SpecBinding;
}

export interface ProcessSettings extends CaseSettings {
  readonly maxCasesPerForm: number;
  readonly normalOnlyPairwise?: boolean | undefined;
  readonly scenarioExpansion?: readonly ScenarioExpansionEntry[] | undefined;
  readonly dryRun?: boolean | undefined;
  /** Stop a form's remaining cases after a normal/boundary case fails; on unless set to false. */
  readonly fastFail?: boolean | undefined;
}

export interface RunSummary {
  readonly formUrl: string;
  readonly caseId: string;
  readonly caseName: string;
  readonly ok: boolean;
  readonly resultUrl: string;
  readonly screenshotPath: string | undefined;
  readonly error: string | undefined;
  readonly errorMessages: readonly string[];
  readonly assignmentHints: readonly string[];
}

export interface ExecutionTotals {
  readonly executed: number;
  readonly ok: number;
  readonly ng: number;
  readonly summaries: RunSummary[];
}

export interface ProcessedForm {
  readonly item: FormCodegenItem & { readonly form: RunnerForm; readonly cases: TestCase[] };
  readonly execution: ExecutionTotals;
}

export type ProcessForm = (
  form: RunnerForm,
  specs: readonly unknown[],
  llm: SemanticProvider,
  cfg: ProcessSettings,
  session: CaseSession,
  store: RunnerStore,
  log: Log,
) => Promise<ProcessedForm>;

/**
 * One form's pipeline: Rule Spec binding -> semantic inference -> value generation ->
 * pairwise cases -> scenario expansion -> optional execution in a live browser.
 * The form's fields are updated in place with spec constraints and inferred meanings.
 */
export function createFormProcessor(deps: FormProcessorDependencies): ProcessForm {
  return async function processForm(form, specs, llm, cfg, session, store, log) {
    const binding = specs.length ? deps.bindSpecsToForm(form, specs) : undefined;
    if (binding && binding.appliedRules.length) {
      log(`  Rule Spec applied: ${binding.appliedRules.length} rules / ${binding.expectations.length} expectations`);
      for (const f of form.fields) {
        const ov = binding.constraintOverrides.get(f.selector);
        if (ov) f.constraints = { ...f.constraints, ...ov, source: 'spec' };
      }
    }

    let semantics: readonly FieldSemantic[] = [];
    try {
      log(`  Running AI semantic inference: ${llm.name}`);
      semantics = await llm.inferFieldSemantics(form.fields, '');
      log(`  AI semantic inference done: ${semantics.length} fields`);
      for (const s of semantics) {
        const f = form.fields.find((x) => x.selector === s.selector);
        if (f) f.semantic = s.semantic;
      }
    } catch (e) {
      log(`  WARNING: LLM inference failed (continuing with fallback): ${e instanceof Error ? e.message : String(e)}`);
    }

    const fieldValues = new Map<string, FieldValue[]>();
    for (const f of form.fields) {
      let vals = deps.generateValues(f, semantics.find((s) => s.selector === f.selector));
      const extra = binding?.extraValues.get(f.selector);
      if (extra && extra.length) vals = deps.mergeValues(vals, extra);
      if (cfg.normalOnlyPairwise) {
        const normalOnly = vals.filter((v) => v.kind === 'normal');
        vals = normalOnly.length ? normalOnly : vals.slice(0, 1);
      }
      fieldValues.set(f.selector, vals);
    }

    let cases = deps.buildTestCases(fieldValues, cfg.maxCasesPerForm);
    if (!cfg.normalOnlyPairwise && binding && binding.combinations.length) {
      const r = deps.applyCombinationConstraints(cases, binding.combinations, fieldValues, cfg.maxCasesPerForm);
      cases = r.cases;
      log(`  Combination constraints: dropped ${r.dropped} / added ${r.added}`);
    } else if (cfg.normalOnlyPairwise && binding?.combinations.length) {
      log('  Combination constraints: skipped (normalOnlyPairwise=true)');
    }

    cases = expandScenarios(form, fieldValues, cases, cfg.maxCasesPerForm, cfg.scenarioExpansion);
    cases = pruneOptionalAssignmentsForNormal(form, cases);
    log(`  ${cases.length} test cases`);
    await store.saveTestCases(form.url, cases);

    const item = { form, cases, expectations: binding?.expectations ?? [] };
    if (cfg.dryRun) {
      log('  dryRun=true, skipping execution (values only)');
      return { item, execution: { executed: 0, ok: 0, ng: 0, summaries: [] } };
    }
    return { item, execution: await runCases(form, cases, cfg, session, store, log) };
  };
}

async function runCases(form: RunnerForm, cases: readonly TestCase[], cfg: ProcessSettings, session: CaseSession, store: RunnerStore, log: Log): Promise<ExecutionTotals> {
  let executed = 0;
  let ok = 0;
  let ng = 0;
  const summaries: RunSummary[] = [];
  let i = 0;
  for (const tc of cases) {
    i++;
    const result = await executeCase(session, cfg, form, tc, log);
    executed++;
    if (result.ok) ok++;
    else ng++;
    summaries.push({
      formUrl: form.url,
      caseId: tc.id,
      caseName: tc.name,
      ok: result.ok,
      resultUrl: result.resultUrl,
      screenshotPath: result.screenshotPath,
      error: result.error,
      errorMessages: result.errorMessages,
      assignmentHints: Object.entries(tc.assignments)
        .slice(0, MAX_ASSIGNMENT_HINTS)
        .map(([selector, v]) => `${selector}=${v.value} (${v.kind})`),
    });
    await store.saveRunResult(form.url, result);
    log(`    [${i}/${cases.length}] ${tc.name} -> ${result.ok ? 'OK' : 'NG'} ${result.error ?? ''}`);
    if ((cfg.fastFail ?? true) && !result.ok && !testCaseHasAbnormalAssignment(tc)) {
      log('    fastFail: NG on a normal/boundary case, stopping remaining cases for this form');
      break;
    }
  }
  return { executed, ok, ng, summaries };
}

/** All-normal cases keep only required fields, so optional fields do not mask a required-field failure. */
function pruneOptionalAssignmentsForNormal(form: RunnerForm, cases: readonly TestCase[]): TestCase[] {
  const requiredSelectors = new Set(form.fields.filter((f) => !!f.constraints?.required).map((f) => f.selector));
  if (!requiredSelectors.size) return [...cases];
  return cases.map((tc) => {
    if (!isAllNormal(tc)) return tc;
    const filtered = Object.fromEntries(Object.entries(tc.assignments).filter(([selector]) => requiredSelectors.has(selector)));
    return Object.keys(filtered).length ? { ...tc, assignments: filtered } : tc;
  });
}
