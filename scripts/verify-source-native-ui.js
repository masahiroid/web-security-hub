'use strict';
const assert = require('node:assert/strict');
const POLICY = Object.freeze({ installMs: 600000, trialMs: 180000, normalStatus: 200, candidateStatus: 422 });
async function completed(page, route, button) {
  const response = page.waitForResponse(value => value.url().endsWith(route) && value.request().method() === 'POST', { timeout: POLICY.trialMs });
  await page.click(button); const result = await (await response).json();
  assert.equal(result.state, 'completed'); assert.equal(result.runtimeSource, 'unverified');
  assert.equal(result.pair.control.observation.status, POLICY.normalStatus);
  assert.equal(result.pair.candidate.observation.status, POLICY.candidateStatus);
  assert.equal(result.pair.candidate.assessment.result, 'under_investigation');
  await page.waitForFunction(selector => !document.querySelector(selector).disabled, button);
  return result;
}
function passive(result) {
  assert.equal(result.pair.control.zap.state, 'completed'); assert.equal(result.pair.candidate.zap.state, 'completed');
  assert.notDeepEqual(result.pair.control.zap.messageIds, result.pair.candidate.zap.messageIds);
  assert(result.pair.control.zap.alerts.some(alert => alert.pluginId === '10037'));
}
module.exports = async function verifySourceNative(page, language, sourceDirectory, targetOrigin) {
  await page.click('[data-tab=static]'); await page.click('[aria-controls=panel-static-controls-page-4]');
  if (await page.locator('#sastUseZap').isEnabled()) await page.uncheck('#sastUseZap');
  await page.click('[aria-controls=panel-static-controls-page-0]'); await page.fill('#sourceDir', 'retained-source-input');
  await page.click('[aria-controls=panel-static-controls-page-1]');
  const sample = await completed(page, '/api/verifier/sast-sample', '#runSastBinding');
  assert.equal(sample.pair.control.zap, undefined);
  assert.equal(await page.inputValue('#sourceDir'), 'retained-source-input');
  await page.click('#helpBtn'); await page.frameLocator('#helpReader').locator('h1').filter({ hasText: 'SAST' }).waitFor(); await page.click('#closeHelp');
  assert((await page.locator('#sastBindingResult').innerText()).includes('POST /inspect'));
  await page.click('[aria-controls=panel-static-controls-page-4]');
  if (!(await page.locator('#sastUseZap').isEnabled())) {
    const installed = page.waitForResponse(value => value.url().endsWith('/api/verifier/zap-runtime/install'), { timeout: POLICY.installMs });
    await page.click('#installSastZap'); assert.equal((await installed).status(), 200);
  }
  await page.waitForFunction(() => !document.getElementById('sastUseZap').disabled); await page.check('#sastUseZap');
  await page.click('[aria-controls=panel-static-controls-page-1]'); passive(await completed(page, '/api/verifier/sast-sample', '#runSastBinding'));
  await page.click('[aria-controls=panel-static-controls-page-0]'); await page.fill('#sourceDir', sourceDirectory);
  const scan = page.waitForResponse(value => value.url().endsWith('/api/security/static-scan') && value.request().method() === 'POST');
  await page.click('#runStatic'); assert.equal((await (await scan).json()).findings.length, 1);
  await page.click('[aria-controls=panel-static-controls-page-3]');
  await page.fill('#sastNormalValues', '{"label":"normal"}'); await page.fill('#sastCandidateValues', '{"label":""}');
  await page.click('[aria-controls=panel-static-controls-page-2]'); await page.fill('#sastOrigin', targetOrigin); await page.check('#sastTargetAuthorized');
  const target = await completed(page, '/api/verifier/sast-sample/target', '#runSastTarget'); passive(target);
  const report = await page.request.get(new URL(`/api/verifier/sast-sample/reports/${target.reportId}/report.json`, page.url()).href);
  assert.equal(report.status(), 200); assert.equal((await report.json()).finding.findingInstanceId, target.finding.findingInstanceId);
  await page.locator('#sastBindingResult button').filter({ hasText: 'HTML' }).click();
  await page.frameLocator('#sastBindingResult iframe').locator('h1').filter({ hasText: 'Source verification' }).waitFor();
  await page.locator('#sastBindingResult button').filter({ hasText: 'HTML' }).click();
  assert.equal(await page.inputValue('#sastOrigin'), targetOrigin);
  return `${language}/source: native sample, GUI engine install, real ZAP, authorized target, private JSON/HTML and help PASS`;
};
