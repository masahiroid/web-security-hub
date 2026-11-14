import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import type { LoginConfig } from '../../crawler/typed/login';
import { gotoWithLogin } from '../../crawler/typed/login';
import { extractErrorTextHints, extractErrors, MAX_ERROR_MESSAGES, normalizePathForCompare, normalizeSelectorForRuntime, sha1 } from './runtimeSelectors';
import type { CaseResult, Log, PreStep, RunnerForm, TestCase } from './types';

/** Drives one browser page through one test case: preSteps -> fill -> submit -> screenshot -> error detection. */

/** Wait for the page to settle after submit. */
const SUBMIT_SETTLE_TIMEOUT_MS = 12_000;
/** Wait for a pre-step target that earlier steps may still be rendering. */
const PRE_STEP_ATTACH_TIMEOUT_MS = 8_000;
const PRE_STEP_ACTION_TIMEOUT_MS = 5_000;
const PRE_STEP_FILE_TIMEOUT_MS = 8_000;
const STEP_PAUSE_MS = 200;
const DOM_SETTLE_TIMEOUT_MS = 3_000;
const GATE_CLICK_TIMEOUT_MS = 3_000;
const GATE_NETWORK_IDLE_TIMEOUT_MS = 5_000;
/** Consent/interstitial pages advanced at most this many times before filling. */
const MAX_READY_STEPS = 6;
/** Target selectors sampled when checking whether the case's fields are reachable. */
const REACHABILITY_SAMPLE = 20;
/** Checkboxes inspected for consent labels on a gate page. */
const MAX_GATE_CHECKBOXES = 8;
const SHOT_FORM_PART_LENGTH = 48;
const SHOT_HASH_LENGTH = 8;
/** Selectors with this prefix are generator metadata, not page fields. */
const METADATA_SELECTOR_PREFIX = '__gm_';
const NOT_IN_OPTIONS = '__not_in_options__';
const CONSENT_TEXT = /(agree|consent|同意|規約)/i;
const GATE_CLICK_FALLBACKS: readonly string[] = [
  'button:has-text("次へ")',
  'button:has-text("進む")',
  'button:has-text("同意")',
  'button:has-text("Next")',
  'button:has-text("Continue")',
  'input[type="submit"]',
  'button[type="submit"]',
];

export interface CaseSession {
  newPage(): Promise<Page>;
}

export interface CaseSettings {
  readonly outputDir: string;
  readonly login?: LoginConfig | undefined;
}

export function testCaseHasAbnormalAssignment(tc: TestCase): boolean {
  return Object.values(tc.assignments).some((v) => v.kind === 'abnormal');
}

const ignore = (): void => {};

/** Executes one test case: fill, submit, capture screenshot/DOM, detect errors. */
export async function executeCase(session: CaseSession, cfg: CaseSettings, form: RunnerForm, tc: TestCase, log: Log): Promise<CaseResult> {
  const page = await session.newPage();
  try {
    const expectsError = testCaseHasAbnormalAssignment(tc);
    log(`      case-start: ${tc.id} open=${form.url}`);
    await gotoWithLogin(page, form.url, cfg.login, ignore);
    await runPreSteps(page, form.preSteps, log);
    await ensureCaseReady(page, form, tc, log);
    const beforeSubmitUrl = page.url();
    const applied = await applyAssignments(page, tc);
    log(`      case-fill: ${tc.id} applied=${applied}/${Object.keys(tc.assignments).length}`);

    if (form.submitSelector) {
      const submit = normalizeSelectorForRuntime(form.submitSelector);
      log(`      case-submit: ${tc.id} selector=${submit}`);
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: SUBMIT_SETTLE_TIMEOUT_MS }).catch(ignore),
        page.click(submit).catch(ignore),
      ]);
    }
    log(`      case-after-submit: ${tc.id} at=${page.url()}`);

    const shotDir = join(cfg.outputDir, 'screenshots');
    mkdirSync(shotDir, { recursive: true });
    const shot = join(shotDir, `${buildRunShotName(form, tc.id)}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(ignore);

    const html = await page.content();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const missingRequired = await detectMissingRequiredFields(page, form);
    const transitionErrors = expectsError ? [] : detectTransitionAnomalies(page, form, beforeSubmitUrl);
    const applyErrors = Object.keys(tc.assignments).length > 0 && applied === 0 ? ['no input value was applied'] : [];
    const allErrors = Array.from(
      new Set([...extractErrors(html), ...extractErrorTextHints(bodyText), ...missingRequired, ...transitionErrors, ...applyErrors]),
    ).slice(0, MAX_ERROR_MESSAGES);

    // Abnormal input is expected to be rejected, so it never fails the case by itself.
    const ok = expectsError ? true : allErrors.length === 0;
    return { testCaseId: tc.id, resultUrl: page.url(), domHash: sha1(html), errorMessages: allErrors, screenshotPath: shot, ok, error: ok ? undefined : allErrors.join('; ') };
  } catch (e) {
    return { testCaseId: tc.id, resultUrl: page.url(), domHash: '', errorMessages: [], ok: false, error: errorMessage(e) };
  } finally {
    await page.close().catch(ignore);
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && e.message != null) return String(e.message);
  return String(e);
}

async function applyAssignments(page: Page, tc: TestCase): Promise<number> {
  let applied = 0;
  const processedRadioGroups = new Set<string>();
  for (const [selector, gv] of Object.entries(tc.assignments)) {
    if (selector.startsWith(METADATA_SELECTOR_PREFIX)) continue;
    try {
      const runtimeSelector = normalizeSelectorForRuntime(selector);
      const el = page.locator(runtimeSelector).first();
      if (!(await el.count().catch(() => 0))) continue;
      const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => 'input');
      if (tag === 'select') {
        if (gv.value === NOT_IN_OPTIONS) continue;
        const selected = await el.selectOption(gv.value).catch((): string[] => []);
        if (selected.length > 0) applied++;
        continue;
      }
      const type = await el.getAttribute('type').catch(() => null);
      if (type === 'checkbox') {
        if (await applyCheckbox(el, gv.value)) applied++;
      } else if (type === 'radio') {
        const radioGroup = await el.getAttribute('name').catch(() => null);
        const radioKey = `radio:${radioGroup || runtimeSelector}`;
        if (processedRadioGroups.has(radioKey)) continue;
        processedRadioGroups.add(radioKey);
        if (await applyRadio(el, gv.value)) applied++;
      } else {
        const filled = await el.fill(gv.value).then(() => true).catch(() => false);
        if (filled) applied++;
      }
    } catch {
      // An unfillable field is still worth recording as evidence, so continue.
    }
  }
  return applied;
}

async function applyCheckbox(el: Locator, value: string): Promise<boolean> {
  if (value === 'off') {
    await el.uncheck({ force: true }).catch(ignore);
    return !(await el.isChecked().catch(() => false));
  }
  await el.check({ force: true }).catch(ignore);
  return el.isChecked().catch(() => false);
}

async function applyRadio(el: Locator, value: string): Promise<boolean> {
  if (!value || value === 'off' || value === NOT_IN_OPTIONS) return false;
  if (value === 'on') {
    await el.check({ force: true }).catch(ignore);
    if (await el.isChecked().catch(() => false)) return true;
  }
  const selectedByValue = await el.evaluate(clickRadioInGroup, value).catch(() => false);
  if (selectedByValue) return true;
  await el.check({ force: true }).catch(ignore);
  return el.isChecked().catch(() => false);
}

/** Runs in the page: clicks the radio with the given value in the node's group (hidden/custom radios included). */
function clickRadioInGroup(node: Element, targetValue: string): boolean {
  const input = node as HTMLInputElement;
  const root: ParentNode = input.form ?? document;
  if (input.name) {
    // CSS.escape is missing in some older engines.
    const hasEscape = typeof CSS !== 'undefined' && typeof CSS.escape === 'function';
    const escapedName = hasEscape ? CSS.escape(input.name) : input.name.replace(/["\\]/g, '\\$&');
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escapedName}"]`));
    const target = radios.find((r) => r.value === targetValue);
    if (target) {
      target.click();
      return !!target.checked;
    }
  }
  if (input.value === targetValue) {
    input.click();
    return !!input.checked;
  }
  return false;
}

/**
 * Runs a form's declarative preSteps (radio / check / uncheck / click / setFile) before filling,
 * so wizard-style forms that hide their fields behind an initial choice become fillable.
 */
async function runPreSteps(page: Page, preSteps: readonly PreStep[] | undefined, log: Log): Promise<void> {
  if (!Array.isArray(preSteps) || !preSteps.length) return;
  for (const step of preSteps) {
    const runtimeSelector = normalizeSelectorForRuntime(step.selector);
    try {
      // A step may depend on DOM the previous step revealed; wait for it rather than a fixed delay.
      const target = page.locator(runtimeSelector).first();
      await target.waitFor({ state: 'attached', timeout: PRE_STEP_ATTACH_TIMEOUT_MS });

      if (step.action === 'radio') {
        await selectRadioByValue(page, runtimeSelector, step.value);
      } else if (step.action === 'check') {
        await target.check({ force: true, timeout: PRE_STEP_ACTION_TIMEOUT_MS });
      } else if (step.action === 'uncheck') {
        await target.uncheck({ force: true, timeout: PRE_STEP_ACTION_TIMEOUT_MS });
      } else if (step.action === 'click') {
        await target.click({ force: true, timeout: PRE_STEP_ACTION_TIMEOUT_MS });
      } else if (step.action === 'setFile') {
        if (step.path === undefined) throw new Error('setFile needs a path');
        await target.setInputFiles(step.path, { timeout: PRE_STEP_FILE_TIMEOUT_MS });
        const fileCount = await target.evaluate((el) => (el as HTMLInputElement).files?.length ?? 0).catch(() => -1);
        if (fileCount !== 1) log(`      pre-step warning: setFile ${step.selector} — expected 1 file attached, found ${fileCount}`);
      }
      await page.waitForTimeout(STEP_PAUSE_MS).catch(ignore);
      await page.waitForLoadState('domcontentloaded', { timeout: DOM_SETTLE_TIMEOUT_MS }).catch(ignore);
    } catch (e) {
      log(`      pre-step failed: ${step.action} ${step.selector} (${errorMessage(e)})`);
    }
  }
}

async function selectRadioByValue(page: Page, selector: string, value: string | undefined): Promise<void> {
  const loc = page.locator(selector).first();
  if (!(await loc.count().catch(() => 0))) return;
  await loc.evaluate(clickRadioInGroup, value ?? '').catch(ignore);
}

async function detectMissingRequiredFields(page: Page, form: RunnerForm): Promise<string[]> {
  const missing: string[] = [];
  const checkedRadioGroups = new Set<string>();
  for (const field of form.fields) {
    if (!field.constraints?.required) continue;
    try {
      const el = page.locator(normalizeSelectorForRuntime(field.selector)).first();
      if (!(await el.count().catch(() => 0))) continue;
      if (field.type === 'checkbox') {
        if (!(await el.isChecked().catch(() => false))) missing.push(`required-missing:${field.selector}`);
      } else if (field.type === 'radio') {
        const name = field.name || field.selector;
        if (checkedRadioGroups.has(name)) continue;
        checkedRadioGroups.add(name);
        const anyChecked = await page
          .locator(`input[type="radio"][name="${name.replace(/["\\]/g, '\\$&')}"]`)
          .evaluateAll((nodes) => nodes.some((n) => (n as HTMLInputElement).checked))
          .catch(() => false);
        if (!anyChecked) missing.push(`required-missing:${name}`);
      } else {
        const value = await el.inputValue().catch(() => '');
        if (!value) missing.push(`required-missing:${field.selector}`);
      }
    } catch {
      // best-effort check
    }
  }
  return missing;
}

/** A submit that leaves the page on the same path is treated as blocked client-side. */
function detectTransitionAnomalies(page: Page, form: RunnerForm, beforeSubmitUrl: string): string[] {
  if (!form.submitSelector) return [];
  if (normalizePathForCompare(page.url()) !== normalizePathForCompare(beforeSubmitUrl)) return [];
  return ['no-transition-after-submit'];
}

export function buildRunShotName(form: RunnerForm, caseId: string): string {
  const pathPart = normalizePathForCompare(form.url).replace(/^\/+/, '').replace(/[^a-zA-Z0-9_-]+/g, '-') || 'root';
  const formPart = (form.formSelector || 'form').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, SHOT_FORM_PART_LENGTH) || 'form';
  const fieldShape = form.fields
    .map((f) => `${f.selector}:${f.type}`)
    .sort((a, b) => a.localeCompare(b))
    .join('|');
  const shapeHash = createHash('sha1').update(fieldShape).digest('hex').slice(0, SHOT_HASH_LENGTH);
  return `${pathPart}-${formPart}-${shapeHash}-${caseId}`;
}

/** Advances past generic consent/interstitial pages until the case's target fields are reachable. */
async function ensureCaseReady(page: Page, form: RunnerForm, tc: TestCase, log: Log): Promise<void> {
  const selectors = Object.keys(tc.assignments).map((s) => normalizeSelectorForRuntime(s));
  if (!selectors.length) return;
  const seenStates = new Set<string>();

  for (let step = 0; step < MAX_READY_STEPS; step++) {
    if (await hasReachableTarget(page, selectors)) {
      if (step > 0) log(`      ready-ok: ${tc.id} step=${step} at=${page.url()}`);
      return;
    }

    const stateKey = await page
      .evaluate(() => `${location.pathname}${location.search}|input:${!!document.querySelector('input[type="text"], select, textarea')}`)
      .catch(() => `${normalizePathForCompare(page.url())}|unknown`);
    if (seenStates.has(stateKey)) {
      log(`      ready-stop: ${tc.id} same-state-loop`);
      break;
    }
    seenStates.add(stateKey);

    const before = page.url();
    await advancePreconditionStep(page, form.submitSelector);
    const after = page.url();
    log(`      ready-advance: ${tc.id} from=${before} to=${after}`);

    const changed = normalizePathForCompare(before) !== normalizePathForCompare(after);
    if (!changed && !(await hasReachableTarget(page, selectors))) {
      log(`      ready-stop: ${tc.id} unchanged-and-unreachable`);
      break;
    }
  }
}

async function hasReachableTarget(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const s of selectors.slice(0, REACHABILITY_SAMPLE)) {
    const loc = page.locator(s).first();
    const visible = await loc.isVisible().catch(async () => (await loc.count().catch(() => 0)) > 0);
    if (visible) return true;
  }
  return false;
}

/** Checks any consent-labeled checkbox, then clicks the first visible, enabled next-like control. */
async function advancePreconditionStep(page: Page, submitSelector: string | undefined): Promise<void> {
  const checks = page.locator('input[type="checkbox"]');
  const n = await checks.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, MAX_GATE_CHECKBOXES); i++) {
    const cb = checks.nth(i);
    const text = await cb
      .evaluate((node) => {
        const input = node as HTMLInputElement;
        const id = input.id || '';
        const root = input.ownerDocument || document;
        const label = id ? root.querySelector(`label[for="${id.replace(/(["\\])/g, '\\$1')}"]`) : null;
        return `${input.name || ''} ${id} ${label?.textContent || ''}`.trim();
      })
      .catch(() => '');
    if (!CONSENT_TEXT.test(text)) continue;
    if (!(await cb.isChecked().catch(() => false))) await cb.check({ force: true }).catch(ignore);
  }

  const clickCandidates = [submitSelector, ...GATE_CLICK_FALLBACKS].filter((s): s is string => !!s);
  for (const sel of clickCandidates) {
    const target = page.locator(sel).first();
    if (!(await target.count().catch(() => 0))) continue;
    if (!(await target.isVisible().catch(() => false))) continue;
    if (!(await target.isEnabled().catch(() => true))) continue;
    await target.click({ force: true, timeout: GATE_CLICK_TIMEOUT_MS }).catch(ignore);
    await page.waitForTimeout(STEP_PAUSE_MS).catch(ignore);
    await page.waitForLoadState('domcontentloaded', { timeout: DOM_SETTLE_TIMEOUT_MS }).catch(ignore);
    await page.waitForLoadState('networkidle', { timeout: GATE_NETWORK_IDLE_TIMEOUT_MS }).catch(ignore);
    break;
  }
}
