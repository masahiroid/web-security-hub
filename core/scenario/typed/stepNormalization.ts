import { asRecord, type HealHint, type ScenarioStep, type StepCondition, type StoredScenario } from './types';

/** Validates and normalizes untrusted scenario steps into the portable step format. Pure: no I/O. */

export const ACTIONS: ReadonlySet<string> = new Set([
  'goto', 'click', 'fill', 'check', 'uncheck', 'select', 'wait',
  'back', 'forward', 'reload', 'setFile', 'download',
  'branch', 'loop', 'useSharedStep', 'aiAssert',
]);
/** Steps per list (each branch/loop body is a separate list). */
export const MAX_STEPS = 50;
/** aiAssert descriptions are cut to this many characters. */
export const MAX_AI_ASSERT_DESCRIPTION = 300;
export const MAX_LOOP_TIMES = 200;
/** branch/loop nesting depth. */
export const MAX_NESTING_DEPTH = 5;
export const DEFAULT_WAIT_MS = 500;
export const MAX_WAIT_MS = 10_000;
/** Class names kept in a heal hint. */
export const MAX_HINT_CLASSES = 3;

const HEAL_HINT_STRING_FIELDS = ['tag', 'id', 'dataTestId', 'name', 'type', 'role', 'ariaLabel', 'placeholder', 'text'] as const;

/** Same clamping as before: non-numeric or zero falls back to the default. */
export function clampWait(value: unknown): number {
  return Math.min(Math.max(Number(value) || DEFAULT_WAIT_MS, 0), MAX_WAIT_MS);
}

export function clampLoopTimes(value: unknown): number {
  return Math.min(Math.max(Number(value) || 0, 0), MAX_LOOP_TIMES);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeSteps(steps: unknown, depth = 0): ScenarioStep[] {
  if (steps === undefined) return [];
  if (!Array.isArray(steps)) throw new Error('scenario.steps must be an array');
  if (steps.length > MAX_STEPS) throw new Error(`scenario can contain at most ${MAX_STEPS} steps`);
  return steps.map((step: unknown, index) => normalizeStep(step, index, depth));
}

function normalizeStep(raw: unknown, index: number, depth: number): ScenarioStep {
  const n = index + 1;
  const step = asRecord(raw);
  if (!step) throw new Error(`scenario step ${n} must be an object`);
  const action = step['action'];
  if (typeof action !== 'string' || !ACTIONS.has(action)) throw new Error(`scenario step ${n} has an unsupported action`);

  switch (action) {
    case 'useSharedStep': {
      const name = step['name'];
      if (!nonEmptyString(name)) throw new Error(`scenario step ${n} requires a shared step name`);
      return { action, name: name.trim() };
    }
    case 'goto': {
      const url = step['url'];
      if (!nonEmptyString(url)) throw new Error(`scenario step ${n} requires url`);
      return { action, url: url.trim() };
    }
    case 'wait':
      return { action, value: clampWait(step['value']) };
    case 'back':
    case 'forward':
    case 'reload':
      return { action };
    case 'aiAssert': {
      const description = step['description'];
      if (!nonEmptyString(description)) throw new Error(`scenario step ${n} requires a description`);
      return { action, description: description.trim().slice(0, MAX_AI_ASSERT_DESCRIPTION) };
    }
    case 'setFile': {
      const selector = requireSelector(step, n);
      const filePath = step['path'];
      if (!nonEmptyString(filePath)) throw new Error(`scenario step ${n} requires path (relative to sites/<id>/fixtures)`);
      return { action, selector, path: filePath.trim(), ...healHintOf(step, n) };
    }
    case 'download': {
      const selector = requireSelector(step, n);
      const saveAs = step['saveAs'];
      return { action, selector, ...(nonEmptyString(saveAs) ? { saveAs: saveAs.trim() } : {}), ...healHintOf(step, n) };
    }
    case 'branch': {
      if (depth >= MAX_NESTING_DEPTH) throw new Error(`scenario step ${n}: branch/loop nesting exceeded max depth`);
      const condition = step['condition'];
      if (!condition || typeof condition !== 'object') throw new Error(`scenario step ${n} requires a condition object`);
      return {
        action,
        condition: normalizeCondition(condition as Record<string, unknown>, n),
        then: normalizeSteps(step['then'], depth + 1),
        else: normalizeSteps(step['else'], depth + 1),
      };
    }
    case 'loop':
      if (depth >= MAX_NESTING_DEPTH) throw new Error(`scenario step ${n}: branch/loop nesting exceeded max depth`);
      return { action, times: clampLoopTimes(step['times']), steps: normalizeSteps(step['steps'], depth + 1) };
    case 'fill':
    case 'select': {
      const selector = requireSelector(step, n);
      return { action, selector, value: String(step['value'] ?? ''), ...healHintOf(step, n) };
    }
    default: {
      // click, check, uncheck
      const selector = requireSelector(step, n);
      return { action: action as 'click' | 'check' | 'uncheck', selector, ...healHintOf(step, n) };
    }
  }
}

function requireSelector(step: Record<string, unknown>, n: number): string {
  const selector = step['selector'];
  if (!nonEmptyString(selector)) throw new Error(`scenario step ${n} requires selector`);
  return selector.trim();
}

function healHintOf(step: Record<string, unknown>, n: number): { healHint?: HealHint } {
  const healHint = normalizeHealHint(step['healHint'], n);
  return healHint ? { healHint } : {};
}

/** Keeps only known string fields and up to three class names; an empty hint is dropped. */
export function normalizeHealHint(raw: unknown, n: number): HealHint | undefined {
  if (raw === undefined || raw === null) return undefined;
  const hint = asRecord(raw);
  if (!hint) throw new Error(`scenario step ${n} healHint must be an object`);
  const out: HealHint = {};
  for (const field of HEAL_HINT_STRING_FIELDS) {
    const value = hint[field];
    if (typeof value === 'string' && value) out[field] = value;
  }
  const classes = hint['classes'];
  if (Array.isArray(classes)) out.classes = classes.filter((c): c is string => typeof c === 'string').slice(0, MAX_HINT_CLASSES);
  return Object.keys(out).length ? out : undefined;
}

function normalizeCondition(condition: Record<string, unknown>, n: number): StepCondition {
  const selector = condition['selector'];
  if (!nonEmptyString(selector)) throw new Error(`scenario step ${n} condition requires selector`);
  const normalized: StepCondition = { selector: selector.trim() };
  if (condition['exists'] !== undefined) normalized.exists = Boolean(condition['exists']);
  else if (condition['visible'] !== undefined) normalized.visible = Boolean(condition['visible']);
  else if (condition['equals'] !== undefined) normalized.equals = String(condition['equals']);
  else throw new Error(`scenario step ${n} condition requires exists, visible, or equals`);
  return normalized;
}

export function normalizeStoredScenario(scenario: unknown): StoredScenario | undefined {
  if (scenario === undefined || scenario === null) return undefined;
  const record = asRecord(scenario);
  if (!record) throw new Error('scenario must be an object');
  const dataSource = record['dataSource'];
  return { steps: normalizeSteps(record['steps']), dataSource: dataSource ? String(dataSource) : undefined };
}
