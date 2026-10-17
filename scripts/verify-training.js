'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const { scanStatic } = require('../core/security/staticScanner');
const { scanDynamic } = require('../core/security/dynamicScanner');
const { root, startServers, setMode, writeEvidence } = require('./training-runtime');
async function main() {
  const close = await startServers(); let browser;
  const evidence = { checks: [] };
  try {
    browser = await chromium.launch();
    for (const lang of ['ja', 'en']) {
      const context = await browser.newContext(); const page = await context.newPage();
      await page.goto(`http://127.0.0.1:4180/${lang}/apply`);
      assert.equal(new URL(page.url()).pathname, `/${lang}/login`);
      await page.fill('#email', 'learner@example.test'); await page.fill('#password', 'wrong'); await page.click('#sign-in');
      assert.equal(await page.locator('[role=alert]').count(), 1);
      await page.goto(`http://127.0.0.1:4180/${lang}/login`);
      await page.fill('#email', 'learner@example.test'); await page.fill('#password', 'training-only'); await page.click('#sign-in');
      assert.equal(new URL(page.url()).pathname, `/${lang}/dashboard`);
      await page.click('#apply-link');
      await page.fill('#name', 'Demo Learner'); await page.fill('#contact', 'learner@example.test'); await page.fill('#participants', '5');
      await page.click('#submit-application'); assert.equal(new URL(page.url()).pathname, `/${lang}/complete`);
      await setMode('changed'); await page.goto(`http://127.0.0.1:4180/${lang}/apply`);
      assert.equal(await page.getAttribute('#participants', 'max'), '3');
      const r = await context.request.post(`http://127.0.0.1:4180/${lang}/complete`, { form: { name: 'Demo', contact: 'learner@example.test', participants: '5', course: 'web' } });
      assert.equal(r.status(), 422);
      await setMode('fixed'); await page.reload(); assert.equal(await page.getAttribute('#participants', 'max'), '5');
      await setMode('baseline'); await context.close(); evidence.checks.push(`${lang}: authentication, valid submit, server-side changed limit, fixed limit`);
    }
    const before = scanStatic({ sourceDir: path.join(root, 'training/sast/before') });
    const after = scanStatic({ sourceDir: path.join(root, 'training/sast/after') });
    assert.deepEqual(before.findings.map(f => f.id).sort(), ['SAST-DANGEROUS-EVAL', 'SAST-SQL-CONCAT']);
    assert.equal(after.findings.length, 0); evidence.sast = { before: before.findings.map(f => f.id), after: [] };
    const scenario = { login: { url: 'http://127.0.0.1:4180/en/login', username: 'learner@example.test', password: 'training-only', usernameSelector: '#email', passwordSelector: '#password', submitSelector: '#sign-in' }, steps: [{ action: 'goto', url: 'http://127.0.0.1:4180/en/apply' }] };
    const results = {};
    for (const mode of ['baseline', 'changed', 'fixed']) {
      await setMode(mode);
      const result = await scanDynamic({ targetUrl: 'http://127.0.0.1:4180/en/apply', maxPages: 1, maxDepth: 0, scenario });
      results[mode] = result.findings.map(f => f.id);
    }
    assert(!results.baseline.includes('DAST-HEADER-CONTENT-SECURITY-POLICY'));
    assert(results.changed.includes('DAST-HEADER-CONTENT-SECURITY-POLICY'));
    assert.deepEqual(results.fixed, results.baseline); evidence.dast = results;
    evidence.checks.push('SAST expected rules disappear after fix; DAST CSP finding appears in changed mode and disappears after fix');
    const uiContext = await browser.newContext();
    const ui = await uiContext.newPage();
    let zapRequest;
    await ui.route('**/api/security/zap-status', route => {
      zapRequest = { method: route.request().method(), body: route.request().postDataJSON() };
      return route.fulfill({ json: { ok: true, version: 'request-contract-test' } });
    });
    await ui.goto('http://127.0.0.1:4173');
    await ui.click('[data-tab="dynamic"]');
    await ui.locator('#panel-dynamic [role="tablist"]').getByRole('tab', { name: 'ZAP', exact: true }).click();
    await ui.click('#checkZap');
    await ui.waitForFunction(() => document.querySelector('#zapStatus').textContent.includes('request-contract-test'));
    assert.equal(zapRequest.method, 'POST');
    assert.equal(zapRequest.body.zap.baseUrl, 'http://127.0.0.1:8090');
    await ui.click('[data-tab="about"]');
    assert.equal(await ui.locator('#panel-about a[href^="/training/"]').count(), 2);
    for (const file of ['README.ja.html', 'README.html']) {
      const response = await uiContext.request.get(`http://127.0.0.1:4173/training/${file}`);
      assert.equal(response.status(), 200);
    }
    await uiContext.close();
    evidence.checks.push('ZAP connection UI POST contract (mock response only); both browser manual entry points');
    evidence.verifiedAt = new Date().toISOString(); writeEvidence('verification.json', evidence);
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await browser?.close(); await close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
