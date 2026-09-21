'use strict';
const path = require('path');
const { siteDir } = require('../siteConfig');
const { resolveWithHealing } = require('./locatorStrategy');

const LOCATOR_ACTIONS = new Set(['click', 'fill', 'check', 'uncheck', 'select', 'setFile', 'download']);

const DEFAULT_TIMEOUT = 30_000;
const MAX_LOOP_ITERATIONS = 200;
const MAX_BRANCH_DEPTH = 5;

/**
 * Resolves a scenario-relative upload path to an absolute path confined to the
 * site's fixtures directory, so a scenario step can never read arbitrary files
 * off the host (e.g. via `../../etc/passwd`).
 */
function resolveFixturePath(siteId, relativePath) {
  const fixturesDir = path.join(siteDir(siteId), 'fixtures');
  const resolved = path.resolve(fixturesDir, relativePath);
  if (!resolved.startsWith(fixturesDir + path.sep) && resolved !== fixturesDir) {
    throw new Error(`file path escapes site fixtures directory: ${relativePath}`);
  }
  return resolved;
}

/** Evaluates a branch/loop condition against the current page. */
async function evaluateCondition(page, condition) {
  if (!condition || typeof condition !== 'object') return false;
  const locator = condition.selector ? page.locator(condition.selector) : undefined;
  if (condition.exists !== undefined) {
    const count = await locator.count();
    return condition.exists ? count > 0 : count === 0;
  }
  if (condition.visible !== undefined) {
    const visible = (await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false));
    return condition.visible ? visible : !visible;
  }
  if (condition.equals !== undefined) {
    const text = (await locator.first().textContent().catch(() => '')) || '';
    return text.trim() === String(condition.equals);
  }
  return false;
}

/**
 * Runs a (already shared-step-expanded, variable-interpolated) list of
 * scenario steps against a live Playwright page. Shared by every execution
 * path (scenario prelude before crawling/generation, DAST scenario replay)
 * so new step types only need to be implemented once.
 *
 * @param {import('playwright').Page} page
 * @param {Array<object>} steps
 * @param {{siteId?: string, onProgress?: (line:string)=>void, depth?: number, healEvents?: Array}} [ctx]
 *   `healEvents`, if passed as an array, gets one entry pushed per step whose
 *   primary selector failed and had to be healed (see locatorStrategy.js) —
 *   pass one in from the caller to collect them across the whole run.
 */
async function runSteps(page, steps, ctx = {}) {
  const onProgress = ctx.onProgress || (() => {});
  const depth = ctx.depth || 0;
  if (depth > MAX_BRANCH_DEPTH) throw new Error('scenario nesting exceeded max depth (branch/loop inside branch/loop)');

  for (const step of steps || []) {
    if (!step || !step.action) continue;
    onProgress(`シナリオ: ${step.action}`);

    let resolved;
    if (LOCATOR_ACTIONS.has(step.action)) {
      resolved = await resolveWithHealing(page, step);
      if (resolved.healed) {
        onProgress(`シナリオ: 🩹 セレクタ自動修復 "${step.selector}" -> ${resolved.usedSelector}（${resolved.strategy}）`);
        ctx.healEvents?.push({ action: step.action, originalSelector: step.selector, usedSelector: resolved.usedSelector, strategy: resolved.strategy });
      }
    }

    switch (step.action) {
      case 'goto':
        if (step.url) await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
        break;
      case 'click':
        await resolved.locator.click();
        break;
      case 'fill':
        await resolved.locator.fill(String(step.value ?? ''));
        break;
      case 'check':
        await resolved.locator.check();
        break;
      case 'uncheck':
        await resolved.locator.uncheck();
        break;
      case 'select':
        await resolved.locator.selectOption(String(step.value ?? ''));
        break;
      case 'wait':
        await page.waitForTimeout(Math.min(Math.max(Number(step.value) || 500, 0), 10_000));
        break;
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }).catch(() => {});
        break;
      case 'forward':
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }).catch(() => {});
        break;
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
        break;
      case 'setFile': {
        if (!ctx.siteId) throw new Error('setFile requires a siteId in scenario execution context');
        const filePath = resolveFixturePath(ctx.siteId, step.path);
        await resolved.locator.setInputFiles(filePath);
        break;
      }
      case 'download': {
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: DEFAULT_TIMEOUT }), resolved.locator.click()]);
        if (step.saveAs && ctx.siteId) {
          const downloadsDir = path.join(siteDir(ctx.siteId), 'downloads');
          await download.saveAs(path.join(downloadsDir, step.saveAs));
        }
        break;
      }
      case 'branch': {
        const matched = await evaluateCondition(page, step.condition);
        await runSteps(page, matched ? step.then : step.else, { ...ctx, depth: depth + 1 });
        break;
      }
      case 'loop': {
        const times = Math.min(Math.max(Number(step.times) || 0, 0), MAX_LOOP_ITERATIONS);
        for (let i = 0; i < times; i++) {
          await runSteps(page, step.steps, { ...ctx, depth: depth + 1 });
        }
        break;
      }
      default:
        break;
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
  }
}

module.exports = { runSteps, resolveFixturePath, evaluateCondition, MAX_LOOP_ITERATIONS, MAX_BRANCH_DEPTH };
