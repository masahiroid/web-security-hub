import type { FieldValue, RunnerForm, ScenarioExpansionEntry, TestCase } from './types';

/**
 * Config-driven test-case expansion. A site's `scenarioExpansion` entries
 * ({ urlPattern, triggerSelector, templates: [{ name, overrides }] }) add one case per
 * template when the pattern matches the form URL and the trigger field exists: the first
 * all-normal case with the template's selector->value overrides applied.
 *
 * Site-specific behavior belongs behind an explicit site.config.json flag, not URL/DOM sniffing.
 */
export function expandScenarios(
  form: RunnerForm,
  _fieldValues: ReadonlyMap<string, readonly FieldValue[]>,
  cases: readonly TestCase[],
  maxCases: number,
  scenarioExpansionConfig?: readonly ScenarioExpansionEntry[] | undefined,
): TestCase[] {
  const configs = scenarioExpansionConfig ?? [];
  if (!configs.length) return [...cases];

  const applicable = configs.filter((cfg) => {
    let re: RegExp;
    try {
      re = new RegExp(cfg.urlPattern, 'i');
    } catch {
      return false;
    }
    if (!re.test(form.url)) return false;
    return form.fields.some((f) => f.selector === cfg.triggerSelector);
  });
  if (!applicable.length) return [...cases];

  const normalBase = cases.find(isAllNormal) ?? cases[0];
  if (!normalBase) return [...cases];

  const forced: TestCase[] = [];
  let seq = 0;
  for (const cfg of applicable) {
    for (const tpl of cfg.templates) {
      seq++;
      const assignments: Record<string, FieldValue> = { ...normalBase.assignments };
      for (const [selector, value] of Object.entries(tpl.overrides || {})) {
        assignments[selector] = { fieldSelector: selector, kind: 'normal', value: String(value), rationale: `scenarioExpansion: ${tpl.name}` };
      }
      forced.push({ id: `case-scenario-${String(seq).padStart(3, '0')}`, name: tpl.name, assignments });
    }
  }

  return dedupeByAssignmentSignature([...forced, ...cases]).slice(0, maxCases);
}

/** True when the case assigns at least one value and every value is a normal one. */
export function isAllNormal(tc: TestCase): boolean {
  const kinds = Object.values(tc.assignments).map((v) => v.kind);
  return kinds.length > 0 && kinds.every((k) => k === 'normal');
}

function dedupeByAssignmentSignature(cases: readonly TestCase[]): TestCase[] {
  const out: TestCase[] = [];
  const seen = new Set<string>();
  for (const tc of cases) {
    const sig = Object.entries(tc.assignments)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v.kind}:${v.value}`)
      .join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(tc);
  }
  return out;
}
