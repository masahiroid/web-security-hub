'use strict';
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const http = require('node:http');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-sast-ui-'));
process.env.WEB_SECURITY_HUB_DATA_DIR = temporary;
const { chromium } = require('playwright'); const { createHost } = require('../desktop/host');
const root = path.resolve(__dirname, '..');
const SETTINGS = Object.freeze({ viewport: { width: 1440, height: 968 }, overviewViewport: { width: 1440, height: 1200 }, expectedFindings: 3 });
(async () => {
  const sourceDirectory = path.join(temporary, 'source'); fs.mkdirSync(sourceDirectory);
  fs.copyFileSync(path.join(root, 'core/verifier/generated/adapters/sastFixtureApp.js'), path.join(sourceDirectory, 'app.js'));
  const target = http.createServer(require('../core/verifier/generated/adapters/sastFixtureApp'));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const targetOrigin = `http://127.0.0.1:${target.address().port}`;
  const host = await createHost(); const browser = await chromium.launch(); const errors = []; const checks = [];
  try {
    const page = await browser.newPage({ viewport: SETTINGS.viewport, reducedMotion: 'reduce' }); page.on('pageerror', error => errors.push(error.message));
    await page.goto(host.url); await page.goto(host.origin + '/'); await page.click('[data-tab=static]'); await page.locator('#panel-static.active').waitFor();
    for (const language of ['ja', 'en']) {
      await page.selectOption('#languageSelect', language); await page.waitForFunction(value => document.documentElement.lang === value, language);
      await page.click('[aria-controls=panel-static-controls-page-0]');
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
      await page.click('[aria-controls=panel-static-controls-page-1]'); await page.click('#runSastBinding');
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
      const sampleBase = `${host.origin}/api/verifier/sast-sample/reports/${sample.reportId}`;
      assert.equal((await page.request.get(sampleBase + '/report.json')).status(), 200);
      assert.equal((await page.request.get(sampleBase + '/report.html')).status(), 200);
      await page.click('[aria-controls=panel-static-controls-page-0]'); await page.fill('#sourceDir', sourceDirectory);
      const targetScanResponse = page.waitForResponse(value => value.url().endsWith('/api/security/static-scan') && value.request().method() === 'POST');
      await page.click('#runStatic'); assert.equal((await (await targetScanResponse).json()).findings.length, 1);
      await page.click('[aria-controls=panel-static-controls-page-3]');
      await page.fill('#sastNormalValues', '{"label":"normal"}'); await page.fill('#sastCandidateValues', '{"label":""}');
      await page.click('[aria-controls=panel-static-controls-page-2]'); await page.fill('#sastOrigin', targetOrigin); await page.check('#sastTargetAuthorized');
      await page.locator('#sastTargetSettings').screenshot({path:path.join(root,`docs/training/images/sast-target-settings-${language}.png`),animations:'disabled'});
      const trialResponse = page.waitForResponse(value => value.url().endsWith('/api/verifier/sast-sample/target') && value.request().method() === 'POST');
      await page.click('#runSastTarget'); const trial = await (await trialResponse).json();
      assert.equal(trial.state, 'completed'); assert.equal(trial.pair.control.observation.status, 200); assert.equal(trial.pair.candidate.observation.status, 422);
      await page.waitForFunction(() => !document.getElementById('runSastTarget').disabled);
      const json = await (await page.request.get(`${host.origin}/api/verifier/sast-sample/reports/${trial.reportId}/report.json`)).json();
      assert.equal(json.finding.findingInstanceId, trial.finding.findingInstanceId);
      await page.setViewportSize(SETTINGS.overviewViewport); await page.locator('#sastBindingResult .sast-metadata summary').click();
      await page.locator('#sastBindingResult').screenshot({path:path.join(root,`docs/training/images/sast-target-${language}.png`),animations:'disabled'});
      await page.locator('#sastBindingResult button').filter({hasText:'HTML'}).click();
      await page.frameLocator('#sastBindingResult iframe').locator('h1').filter({hasText:'Source verification'}).waitFor();
      await page.locator('#sastBindingResult button').filter({hasText:'HTML'}).click();
      if (process.env.WSH_VERIFY_REAL_ZAP === '1') {
        await page.click('[aria-controls=panel-static-controls-page-4]');
        if (!(await page.locator('#sastUseZap').isEnabled())) {
          const installed = page.waitForResponse(value => value.url().endsWith('/api/verifier/zap-runtime/install'), {timeout:600000});
          await page.click('#installSastZap'); assert.equal((await installed).status(),200);
        }
        await page.waitForFunction(() => !document.getElementById('sastUseZap').disabled); await page.check('#sastUseZap');
        await page.locator('#sastZapEnvironment').screenshot({path:path.join(root,`docs/training/images/sast-zap-setup-${language}.png`),animations:'disabled'});
        await page.click('[aria-controls=panel-static-controls-page-1]');
        const zapResponse = page.waitForResponse(value => value.url().endsWith('/api/verifier/sast-sample') && value.request().method() === 'POST', {timeout:180000});
        await page.click('#runSastBinding'); const zap = await (await zapResponse).json(); assert.equal(zap.state,'completed');
        assert.equal(zap.pair.control.zap.state,'completed'); assert.equal(zap.pair.candidate.zap.state,'completed');
        assert.notDeepEqual(zap.pair.control.zap.messageIds,zap.pair.candidate.zap.messageIds);
        await page.waitForFunction(() => !document.getElementById('runSastBinding').disabled);
        await page.locator('#sastBindingResult .sast-metadata summary').click();
        await page.locator('#sastBindingResult').screenshot({path:path.join(root,`docs/training/images/sast-zap-${language}.png`),animations:'disabled'});
        await page.click('[aria-controls=panel-static-controls-page-4]'); await page.uncheck('#sastUseZap');
      }
      for (const viewport of [{width:960,height:648},{width:1280,height:768},SETTINGS.viewport]) {
        await page.setViewportSize(viewport); assert(await page.evaluate(() => document.body.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight));
      }
      checks.push(`${language}: mapping, IDs, SARIF, help, source/target trials, private JSON/HTML, retained inputs, three viewports${process.env.WSH_VERIFY_REAL_ZAP === '1' ? ', GUI install and real ZAP' : ''}`);
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
    manifest.images = manifest.images.filter(item => !item.step.startsWith('sast-mapping') && !['sast-binding','sast-target','sast-target-settings', ...(process.env.WSH_VERIFY_REAL_ZAP === '1' ? ['sast-zap','sast-zap-setup'] : [])].includes(item.step));
    for (const lang of ['ja', 'en']) for (const detail of [false, true]) {
      const step = detail ? 'sast-mapping-detail' : 'sast-mapping';
      manifest.images.push({ lang, step, file: `docs/training/images/${step}-${lang}.png`,
        appVersion: require('../package.json').version, development: Number(require('../package.json').version.split('.')[0]) < 3, targetVersion: '3.0.0',
        capturedAt: fs.statSync(path.join(root, `docs/training/images/${step}-${lang}.png`)).mtime.toISOString(),
        viewport: SETTINGS.overviewViewport });
    }
    for (const lang of ['ja', 'en']) manifest.images.push({ lang, step: 'sast-binding', file: `docs/training/images/sast-binding-${lang}.png`,
      appVersion: require('../package.json').version, development: Number(require('../package.json').version.split('.')[0]) < 3, targetVersion: '3.0.0',
      capturedAt: fs.statSync(path.join(root, `docs/training/images/sast-binding-${lang}.png`)).mtime.toISOString(), viewport: SETTINGS.overviewViewport });
    for (const lang of ['ja','en']) for (const step of ['sast-target','sast-target-settings', ...(process.env.WSH_VERIFY_REAL_ZAP === '1' ? ['sast-zap','sast-zap-setup'] : [])]) manifest.images.push({lang,step,file:`docs/training/images/${step}-${lang}.png`,appVersion:require('../package.json').version,development:Number(require('../package.json').version.split('.')[0]) < 3,targetVersion:'3.0.0',capturedAt:fs.statSync(path.join(root,`docs/training/images/${step}-${lang}.png`)).mtime.toISOString(),viewport:SETTINGS.overviewViewport});
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ checks, escaped: true, browserErrors: errors }, null, 2));
  } finally { await browser.close(); await host.close(); await new Promise(resolve => {target.close(resolve);target.closeAllConnections();}); fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
