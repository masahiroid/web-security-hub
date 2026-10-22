const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-vex-gui-'));
process.env.WEB_SECURITY_HUB_DATA_DIR = data;
const { chromium } = require(path.join(root, 'node_modules/playwright'));
const { createHost } = require(path.join(root, 'desktop/host'));
const settled = () => !document.getElementById('geneticRun').disabled && document.querySelectorAll('#geneticRows tr').length > 0;
async function runGenetic(page, mode) {
  await page.click('[data-tab=genetic]'); await page.waitForSelector('#geneticRun:not([disabled])');
  await page.selectOption('#geneticKind', 'run'); await page.selectOption('#geneticMode', mode); await page.selectOption('#geneticLlm', 'disabled'); await page.fill('#geneticTrials', '400');
  await page.click('#geneticRun'); await page.waitForFunction(settled, null, { timeout: 120000 });
}
let activePage;
(async () => {
  const host = await createHost(); const browser = await chromium.launch(); const errors = []; const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 768 }, reducedMotion: 'reduce' }); page.on('pageerror', error => errors.push(error.message)); activePage = page;
    await page.goto(host.url); await page.goto(host.origin + '/'); await page.waitForSelector('[data-tab=genetic]');
    await runGenetic(page, 'changed'); await runGenetic(page, 'fixed');
    for (const lang of ['ja', 'en']) {
      await page.selectOption('#languageSelect', lang); await page.waitForFunction(language => document.documentElement.lang === language, lang);
      await page.click('[data-tab=vex]'); await page.waitForSelector('#vexCreate');
      await page.waitForFunction(() => document.getElementById('vexDraftPick'));
      await page.fill('#vexAuthor', 'Reviewer A'); await page.fill('#vexRole', 'Security reviewer'); await page.click('#vexCreate');
      await page.waitForFunction(() => document.getElementById('vexSummary').textContent.includes('1'));
      await page.click('[data-vpage=vexStatementPage]');
      const options = await page.locator('#vexEvidence option').allTextContents();
      if (options.length < 2) throw Error(`Expected evidence options, got ${options.length}`);
      const reproducedOption = page.locator('#vexEvidence option', { hasText: /再現 ·|Reproduced ·/ }).first(); const notReproduced = page.locator('#vexEvidence option', { hasText: /再現せず|Not reproduced/ }).first();
      await page.fill('#vexVulnerability', 'CVE-2026-0001'); await page.fill('#vexProduct', 'pkg:npm/example-shop@1.2.3');
      // Evidence that did not reproduce cannot support "affected".
      await notReproduced.evaluate(option => { option.parentElement.querySelectorAll('option').forEach(item => { item.selected = item === option; }); });
      await page.selectOption('#vexStatusValue', 'affected'); await page.selectOption('#vexBasis', 'evidence'); await page.fill('#vexAction', 'Update to 1.2.4'); await page.click('#vexSave');
      await page.waitForFunction(() => /できませんでした|Could not complete/.test(document.getElementById('vexStatus').textContent));
      checks.push(`${lang}/affected without reproduced evidence: rejected`);
      await reproducedOption.evaluate(option => { option.parentElement.querySelectorAll('option').forEach(item => { item.selected = item === option; }); });
      await page.click('#vexSuggest'); await page.waitForFunction(() => /affected|影響あり/i.test(document.getElementById('vexStatus').textContent));
      await page.click('#vexSave'); await page.waitForFunction(() => document.querySelectorAll('#vexRows tr').length === 1);
      await page.fill('#vexVulnerability', 'WSH-2026-0002'); await page.selectOption('#vexStatusValue', 'not_affected'); await page.selectOption('#vexJustification', 'component_not_present');
      await page.evaluate(() => { document.querySelectorAll('#vexEvidence option').forEach(item => { item.selected = false; }); }); await page.click('#vexSave');
      await page.waitForFunction(() => document.querySelectorAll('#vexRows tr').length === 2);
      if (await page.locator('#vexExport').isEnabled()) throw Error('Export must wait for approval');
      await page.fill('#vexApprover', 'Reviewer B'); await page.click('#vexApprove'); await page.waitForFunction(() => !document.getElementById('vexExport').disabled);
      if (await page.locator('#vexSave').isEnabled()) throw Error('Approved draft must be read-only');
      await page.click('#vexExport'); await page.waitForFunction(() => document.getElementById('vexDocument').textContent.includes('openvex.dev'));
      const document = JSON.parse(await page.textContent('#vexDocument'));
      if (document.statements.length !== 2 || document.statements[0].status !== 'affected' || document.statements[1].status !== 'not_affected' || !/reviewer/.test(document.statements[1].status_notes)) throw Error('Unexpected document');
      checks.push(`${lang}/export: ${document.statements.map(statement => statement.status).join(', ')} (version ${document.version})`);
      await page.click('[data-vpage=vexDraftPage]'); await page.evaluate(() => { document.querySelector('#panel-vex .verifier-body')?.scrollTo(0, 0); });
      await page.screenshot({ path: path.join(root, `docs/training/images/vex-${lang}.png`), mask: [page.locator('#siteSelect:visible')] });
      for (const [width, height] of [[1440, 968], [1280, 768], [960, 648]]) {
        await page.setViewportSize({ width, height });
        for (const target of ['vexDraftPage', 'vexStatementPage', 'vexGuidePage', 'vexResultPage', 'vexDocumentPage']) {
          await page.locator(`[data-vpage=${target}]`).click();
          if (!await page.evaluate(() => document.body.scrollHeight <= innerHeight && document.body.scrollWidth <= innerWidth)) throw Error(`Viewport overflow ${width}x${height} ${target}`);
        }
      }
      await page.setViewportSize({ width: 1280, height: 768 }); await page.click('[data-vpage=vexDraftPage]'); await page.click('[data-vpage=vexResultPage]');
      await page.click('#vexRevise'); await page.waitForFunction(() => /2/.test(document.getElementById('vexSummary').textContent));
      checks.push(`${lang}/revise: version 2 draft`);
    }
    if (errors.length) throw Error(errors.join('\n'));
    const manifestFile = path.join(root, 'docs/training/images/manifest.json'); const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.images = manifest.images.filter(image => image.step !== 'vex');
    for (const lang of ['ja', 'en']) manifest.images.push({ lang, step: 'vex', file: `docs/training/images/vex-${lang}.png`, viewport: { width: 1280, height: 768 } });
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    fs.mkdirSync(path.join(root, 'artifacts/desktop'), { recursive: true });
    fs.writeFileSync(path.join(root, 'artifacts/desktop/vex-ui-verification.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(checks.join('\n'));
  } catch (error) {
    try { console.error('status:', await activePage.textContent('#vexStatus'), '| summary:', await activePage.textContent('#vexSummary'), '| rows:', await activePage.locator('#vexRows tr').count(), '| options:', await activePage.locator('#vexEvidence option').allTextContents()); } catch { /* page unavailable */ }
    throw error;
  } finally { await browser.close(); await host.close(); fs.rmSync(data, { recursive: true, force: true }); }
})().catch(async error => { console.error(error.message); if (activePage) { try { console.error('status:', await activePage.textContent('#vexStatus'), '| summary:', await activePage.textContent('#vexSummary')); } catch { /* page closed */ } } process.exitCode = 1; });
