'use strict';
const path = require('path');
const { siteDir } = require('../siteConfig');

const DEFAULT_TIMEOUT = 15_000;
const MAX_LOOP_ITERATIONS = 200;
const MAX_DEPTH = 5;

/**
 * Minimal mobile counterpart to core/scenario/stepExecutor.js, driving a
 * WebdriverIO mobile session (core/mobile/mobileSession.js) instead of a
 * Playwright page. Selector strings follow WebdriverIO's own convention
 * (e.g. `~accessibilityId`, `-ios predicate string:...`, `android=...`,
 * plain XPath) — see https://webdriver.io/docs/selectors — this module does
 * not invent its own selector syntax.
 *
 * Deliberately smaller than the web step language for now: tap/fill/wait/
 * swipe/screenshot cover the actions needed to get a first mobile scenario
 * running end to end. branch/loop/setFile/download/self-healing/AI
 * assertions are not yet ported to this engine.
 */
async function runMobileSteps(driver, steps, ctx = {}) {
  const onProgress = ctx.onProgress || (() => {});
  const depth = ctx.depth || 0;
  if (depth > MAX_DEPTH) throw new Error('scenario nesting exceeded max depth');

  for (const step of steps || []) {
    if (!step || !step.action) continue;
    onProgress(`モバイルシナリオ: ${step.action}`);

    switch (step.action) {
      case 'tap':
        await driver.$(step.selector).click();
        break;
      case 'fill':
        await driver.$(step.selector).setValue(String(step.value ?? ''));
        break;
      case 'wait':
        await driver.pause(Math.min(Math.max(Number(step.value) || 500, 0), 10_000));
        break;
      case 'waitForSelector':
        await driver.$(step.selector).waitForDisplayed({ timeout: DEFAULT_TIMEOUT });
        break;
      case 'swipe': {
        const { fromX, fromY, toX, toY } = step;
        await driver.performActions([
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: fromX, y: fromY },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: 300, x: toX, y: toY },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ]);
        await driver.releaseActions();
        break;
      }
      case 'screenshot': {
        if (!ctx.siteId || !step.saveAs) break;
        const shotDir = path.join(siteDir(ctx.siteId), 'mobile-sessions', ctx.sessionId || 'session');
        const fs = require('fs');
        fs.mkdirSync(shotDir, { recursive: true });
        const base64 = await driver.takeScreenshot();
        fs.writeFileSync(path.join(shotDir, step.saveAs), base64, 'base64');
        break;
      }
      case 'loop': {
        const times = Math.min(Math.max(Number(step.times) || 0, 0), MAX_LOOP_ITERATIONS);
        for (let i = 0; i < times; i++) {
          await runMobileSteps(driver, step.steps, { ...ctx, depth: depth + 1 });
        }
        break;
      }
      default:
        throw new Error(`unsupported mobile step action: ${step.action}`);
    }
  }
}

module.exports = { runMobileSteps };
