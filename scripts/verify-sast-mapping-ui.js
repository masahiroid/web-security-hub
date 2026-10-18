'use strict';
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-sast-ui-'));
process.env.WEB_SECURITY_HUB_DATA_DIR = temporary;
const { chromium } = require('playwright'); const { createHost } = require('../desktop/host');
const root = path.resolve(__dirname, '..');
const SETTINGS = Object.freeze({ viewport: { width: 1440, height: 968 }, overviewViewport: { width: 1440, height: 1200 }, expectedFindings: 3 });
(async () => {
  const host = await createHost(); const browser = await chromium.launch(); const errors = []; const checks = [];
  try {
    const page = await browser.newPage({ viewport: SETTINGS.viewport, reducedMotion: 'reduce' }); page.on('pageerror', error => errors.push(error.message));
    await page.goto(host.url); await page.goto(host.origin + '/'); await page.click('[data-tab=static]'); await page.locator('#panel-static.active').waitFor();
    for (const language of ['ja', 'en']) {
      await page.selectOption('#languageSelect', language); await page.waitForFunction(value => document.documentElement.lang === value, language);
      await page.fill('#sourceDir', path.join(root, 'training/sast/routes'));
      const response = page.waitForResponse(value => value.url().endsWith('/api/security/static-scan') && value.request().method() === 'POST');
      await page.click('#runStatic'); const result = await (await response).json(); assert.equal(result.findings.length, SETTINGS.expectedFindings);
      await page.locator('#staticResult .sast-metadata').first().waitFor(); assert.equal(await page.locator('#staticResult .sast-metadata').count(), SETTINGS.expectedFindings);
      const expected = { 'mapped.js': 'mapped', 'ambiguous.js': 'ambiguous', 'dynamic.js': 'unavailable' };
      for (const finding of result.findings) {
        assert.equal(finding.routeMapping.status, expected[finding.relativePath]); assert.equal(finding.ruleId, finding.id);
        const details = page.locator('#staticResult .sast-metadata').filter({ hasText: finding.findingInstanceId }); assert.equal(await details.count(), 1);
      }
      await page.setViewportSize(SETTINGS.overviewViewport);
      await page.locator('#staticResult').screenshot({ path: path.join(root, `docs/training/images/sast-mapping-${language}.png`), animations: 'disabled' });
      const mapped = result.findings.find(finding => finding.relativePath === 'mapped.js'); assert(mapped);
      const detail = page.locator('#staticResult .sast-metadata').filter({ hasText: mapped.findingInstanceId });
      await detail.locator('summary').click(); await detail.scrollIntoViewIfNeeded();
      assert((await detail.innerText()).includes('POST /api/calculate'));
      await detail.screenshot({ path: path.join(root, `docs/training/images/sast-mapping-detail-${language}.png`), animations: 'disabled' });
      if (language === 'en') assert((await page.locator('#staticResult').innerText()).includes('Dynamic code execution'));
      for (const viewport of [{ width: 960, height: 648 }, { width: 1280, height: 768 }, SETTINGS.viewport]) {
        await page.setViewportSize(viewport);
        assert(await page.evaluate(() => document.body.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight), `${language}: outer layout overflow`);
      }
      const original = await page.inputValue('#sourceDir'); await page.click('#helpBtn');
      const heading = page.frameLocator('#helpReader').locator('h1'); await heading.waitFor(); assert((await heading.innerText()).includes('SAST'));
      assert((await page.locator('#helpReader').getAttribute('src')).includes('SAST-MAPPING'));
      await page.click('#closeHelp'); assert.equal(await page.inputValue('#sourceDir'), original);
      const sarif = await page.request.get(host.origin + result.report.urls.sarif); assert.equal(sarif.status(), 200);
      const report = await sarif.json(); assert(report.runs[0].results.every(item => item.partialFingerprints['webSecurityHubInstance/v1']));
      const sampleResponse = page.waitForResponse(value => value.url().endsWith('/api/verifier/sast-sample') && value.request().method() === 'POST');
      await page.click('#runSastBinding');
      const sample = await (await sampleResponse).json(); assert.equal(sample.state, 'completed');
      assert.equal(sample.pair.control.observation.status, 200); assert.equal(sample.pair.candidate.observation.status, 422);
      assert.equal(sample.pair.candidate.assessment.result, 'under_investigation'); assert.equal(sample.runtimeSource, 'unverified');
      await page.waitForFunction(() => !document.getElementById('runSastBinding').disabled);
      assert.equal(await page.inputValue('#sourceDir'), original);
      assert.equal(await page.locator('#staticResult .sast-metadata').count(), SETTINGS.expectedFindings);
      assert((await page.locator('#sastBindingResult').innerText()).includes('POST /inspect'));
      await page.setViewportSize(SETTINGS.overviewViewport);
      for (const summary of await page.locator('#sastBindingResult summary').all()) await summary.click();
      await page.locator('#sastBindingResult').scrollIntoViewIfNeeded();
      await page.locator('#sastBindingResult').screenshot({ path: path.join(root, `docs/training/images/sast-binding-${language}.png`), animations: 'disabled' });
      for (const viewport of [{ width: 960, height: 648 }, { width: 1280, height: 768 }, SETTINGS.viewport]) {
        await page.setViewportSize(viewport);
        assert(await page.evaluate(() => document.body.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight), `${language}: source sample overflow`);
      }
      checks.push(`${language}: unique/ambiguous/unavailable metadata, individual IDs, SARIF, contextual guide, retained inputs, three viewports, source/scope sample 200/422 under investigation`);
    }
    const escaped = await page.evaluate(async () => {
      const { renderSastMetadata } = await import('/generated/security/sastMetadata.js');
      const html = renderSastMetadata({ findingInstanceId: 'sast-' + 'a'.repeat(64), sourceDigest: 'b'.repeat(64), routeMapping: { status: 'mapped', reason: 'unique_static_route', routes: [{ method: 'GET', path: '<img src=x onerror=alert(1)>', registrationLine: 1 }] } }, 'en');
      const container = document.createElement('div'); container.innerHTML = html;
      return container.querySelectorAll('img').length === 0 && container.textContent.includes('<img');
    });
    assert(escaped); assert.deepEqual(errors, []);
    const manifestPath = path.join(root, 'docs/training/images/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.images = manifest.images.filter(item => !item.step.startsWith('sast-mapping') && item.step !== 'sast-binding');
    for (const lang of ['ja', 'en']) for (const detail of [false, true]) {
      const step = detail ? 'sast-mapping-detail' : 'sast-mapping';
      manifest.images.push({ lang, step, file: `docs/training/images/${step}-${lang}.png`,
        appVersion: require('../package.json').version, development: true, targetVersion: '3.0.0',
        capturedAt: fs.statSync(path.join(root, `docs/training/images/${step}-${lang}.png`)).mtime.toISOString(),
        viewport: SETTINGS.overviewViewport });
    }
    for (const lang of ['ja', 'en']) manifest.images.push({ lang, step: 'sast-binding', file: `docs/training/images/sast-binding-${lang}.png`,
      appVersion: require('../package.json').version, development: true, targetVersion: '3.0.0',
      capturedAt: fs.statSync(path.join(root, `docs/training/images/sast-binding-${lang}.png`)).mtime.toISOString(), viewport: SETTINGS.overviewViewport });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ checks, escaped: true, browserErrors: errors }, null, 2));
  } finally { await browser.close(); await host.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
