import { join, resolve, sep } from 'node:path';
import type { Page } from 'playwright';
import type { LocatableStep, ResolvedLocator } from './locatorStrategy';
import { clampLoopTimes, clampWait, MAX_LOOP_TIMES, MAX_NESTING_DEPTH } from './stepNormalization';
import { asRecord, type SiteStore } from './types';

/**
 * Runs already expanded and interpolated scenario steps against a live page. Shared by every
 * execution path (prelude before crawling/generation, DAST replay) so step types exist once.
 */

export const DEFAULT_TIMEOUT_MS = 30_000;
const LOAD_STATE_TIMEOUT_MS = 5_000;
export const MAX_LOOP_ITERATIONS = MAX_LOOP_TIMES;
export const MAX_BRANCH_DEPTH = MAX_NESTING_DEPTH;
const FIXTURES_DIR = 'fixtures';
const DOWNLOADS_DIR = 'downloads';

const LOCATOR_ACTIONS: ReadonlySet<string> = new Set(['click', 'fill', 'check', 'uncheck', 'select', 'setFile', 'download']);

export interface HealEvent {
  action: string;
  originalSelector: string;
  usedSelector: string;
  strategy: string | undefined;
}

export interface AiVerdict {
  pass: boolean;
  reason: string;
  [key: string]: unknown;
}

export interface StepContext {
  siteId?: string | undefined;
  onProgress?: ((line: string) => void) | undefined;
  depth?: number | undefined;
  /** Receives one entry per step whose selector had to be healed. */
  healEvents?: HealEvent[] | undefined;
  /** Gates the aiAssert step, which calls the local Claude Code CLI. */
  ai?: { enabled?: boolean; locale?: string | undefined } | undefined;
  aiAssertions?: Array<Record<string, unknown>> | undefined;
}

export interface StepExecutorDeps {
  readonly store: Pick<SiteStore, 'siteDir'>;
  resolveWithHealing(page: Page, step: LocatableStep): Promise<ResolvedLocator>;
  assertWithClaudeCode(input: { description: string; page: Page; locale: string | undefined }): Promise<AiVerdict>;
}

export interface StepExecutor {
  runSteps(page: Page, steps: unknown, ctx?: StepContext): Promise<void>;
  resolveFixturePath(siteId: string, relativePath: string): string;
}

/** Evaluates a branch condition against the current page. */
export async function evaluateCondition(page: Page, condition: unknown): Promise<boolean> {
  const c = asRecord(condition);
  if (!c) return false;
  const selector = c['selector'];
  const locator = () => {
    if (typeof selector !== 'string' || !selector) throw new TypeError('condition requires a selector');
    return page.locator(selector);
  };
  if (c['exists'] !== undefined) {
    const count = await locator().count();
    return c['exists'] ? count > 0 : count === 0;
  }
  if (c['visible'] !== undefined) {
    const loc = locator();
    const visible = (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));
    return c['visible'] ? visible : !visible;
  }
  if (c['equals'] !== undefined) {
    const text = (await locator().first().textContent().catch(() => '')) || '';
    return text.trim() === String(c['equals']);
  }
  return false;
}

function str(value: unknown): string {
  return String(value ?? '');
}

export function createStepExecutor(deps: StepExecutorDeps): StepExecutor {
  /** Confines a scenario upload path to the site's fixtures directory. */
  function resolveFixturePath(siteId: string, relativePath: string): string {
    const fixturesDir = join(deps.store.siteDir(siteId), FIXTURES_DIR);
    const resolved = resolve(fixturesDir, relativePath);
    if (!resolved.startsWith(fixturesDir + sep) && resolved !== fixturesDir) {
      throw new Error(`file path escapes site fixtures directory: ${relativePath}`);
    }
    return resolved;
  }

  async function runSteps(page: Page, steps: unknown, ctx: StepContext = {}): Promise<void> {
    const onProgress = ctx.onProgress || (() => {});
    const depth = ctx.depth || 0;
    if (depth > MAX_BRANCH_DEPTH) throw new Error('scenario nesting exceeded max depth (branch/loop inside branch/loop)');

    for (const raw of Array.isArray(steps) ? (steps as unknown[]) : []) {
      const step = asRecord(raw);
      const action = step?.['action'];
      if (!step || !action) continue;
      onProgress(`シナリオ: ${String(action)}`);

      let resolved: ResolvedLocator | undefined;
      if (typeof action === 'string' && LOCATOR_ACTIONS.has(action)) {
        const target = step as unknown as LocatableStep;
        resolved = await deps.resolveWithHealing(page, target);
        if (resolved.healed) {
          onProgress(`シナリオ: 🩹 セレクタ自動修復 "${target.selector}" -> ${resolved.usedSelector}（${resolved.strategy}）`);
          ctx.healEvents?.push({ action, originalSelector: target.selector, usedSelector: resolved.usedSelector, strategy: resolved.strategy });
        }
      }
      const locator = () => {
        if (!resolved) throw new Error(`scenario step ${String(action)} has no resolved locator`);
        return resolved.locator;
      };

      switch (action) {
        case 'goto':
          if (step['url']) await page.goto(str(step['url']), { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
          break;
        case 'click':
          await locator().click();
          break;
        case 'fill':
          await locator().fill(str(step['value']));
          break;
        case 'check':
          await locator().check();
          break;
        case 'uncheck':
          await locator().uncheck();
          break;
        case 'select':
          await locator().selectOption(str(step['value']));
          break;
        case 'wait':
          await page.waitForTimeout(clampWait(step['value']));
          break;
        case 'back':
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
          break;
        case 'forward':
          await page.goForward({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
          break;
        case 'reload':
          await page.reload({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
          break;
        case 'setFile': {
          if (!ctx.siteId) throw new Error('setFile requires a siteId in scenario execution context');
          await locator().setInputFiles(resolveFixturePath(ctx.siteId, str(step['path'])));
          break;
        }
        case 'download': {
          const [download] = await Promise.all([page.waitForEvent('download', { timeout: DEFAULT_TIMEOUT_MS }), locator().click()]);
          const saveAs = step['saveAs'];
          if (saveAs && ctx.siteId) {
            await download.saveAs(join(deps.store.siteDir(ctx.siteId), DOWNLOADS_DIR, str(saveAs)));
          }
          break;
        }
        case 'aiAssert': {
          if (!ctx.ai?.enabled) {
            throw new Error(
              `aiAssert step requires AI assertions to be enabled (site.config.json "ai.assertionsEnabled": true) — this step shells out to the local Claude Code CLI per assertion, so it's opt-in, not automatic like every other step type`,
            );
          }
          const description = str(step['description']);
          const verdict = await deps.assertWithClaudeCode({ description, page, locale: ctx.ai.locale });
          onProgress(`シナリオ: 🤖 AIアサーション${verdict.pass ? '成功' : '失敗'} — ${description}（${verdict.reason}）`);
          ctx.aiAssertions?.push({ description, ...verdict });
          if (!verdict.pass) throw new Error(`AI assertion failed: "${description}" — ${verdict.reason}`);
          break;
        }
        case 'branch': {
          const matched = await evaluateCondition(page, step['condition']);
          await runSteps(page, matched ? step['then'] : step['else'], { ...ctx, depth: depth + 1 });
          break;
        }
        case 'loop': {
          const times = clampLoopTimes(step['times']);
          for (let i = 0; i < times; i++) {
            await runSteps(page, step['steps'], { ...ctx, depth: depth + 1 });
          }
          break;
        }
        default:
          break;
      }
      await page.waitForLoadState('domcontentloaded', { timeout: LOAD_STATE_TIMEOUT_MS }).catch(() => {});
    }
  }

  return { runSteps, resolveFixturePath };
}
