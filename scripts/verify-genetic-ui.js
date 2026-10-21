const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-gui-'));
process.env.WEB_SECURITY_HUB_DATA_DIR = data;
const { chromium } = require(path.join(root, 'node_modules/playwright'));
const { createHost } = require(path.join(root, 'desktop/host'));
const IDLE = '#geneticRun:not([disabled])';
const settled = () => !document.getElementById('geneticRun').disabled && document.querySelectorAll('#geneticRows tr').length > 0;
(async () => {
  const host = await createHost(); const browser = await chromium.launch(); const errors = []; const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 768 }, reducedMotion: 'reduce' }); page.on('pageerror', error => errors.push(error.message));
    await page.goto(host.url); await page.goto(host.origin + '/'); await page.click('[data-tab=genetic]'); await page.waitForSelector(IDLE);
    for (const lang of ['ja', 'en']) {
      await page.selectOption('#languageSelect', lang); await page.waitForFunction(language => document.documentElement.lang === language, lang);
      await page.selectOption('#geneticKind', 'run');
      for (const mode of ['baseline', 'changed', 'fixed']) {
        await page.selectOption('#geneticMode', mode); await page.selectOption('#geneticLlm', 'disabled'); await page.fill('#geneticTrials', '400'); await page.click('#geneticRun');
        await page.waitForFunction(settled);
        const generations = await page.locator('#geneticRows tr').count(); const summary = await page.textContent('#geneticSummary');
        const reproduced = /独立再現|Independently reproduced/.test(summary || '');
        if (generations < 1 || reproduced !== (mode === 'changed')) throw Error(`Incorrect GUI verdict ${lang}/${mode}: ${summary}`);
        if (mode === 'changed') await page.evaluate(() => { document.querySelector('#panel-genetic .verifier-body')?.scrollTo(0, 0); });
        if (mode === 'changed') await page.screenshot({ path: path.join(root, `docs/training/images/genetic-run-${lang}.png`), mask: [page.locator('#siteSelect:visible')] });
        checks.push(`${lang}/run/${mode}: ${generations} generations, reproduced=${reproduced}`);
      }
      await page.locator('#geneticRows tr').first().click(); if (!(await page.textContent('#geneticEvidence') || '').includes('individuals')) throw Error('Generation detail missing');
      await page.click('[data-vpage=geneticResultPage]');
      await page.selectOption('#geneticKind', 'compare'); await page.selectOption('#geneticLlm', 'mock'); await page.fill('#geneticTrials', '192'); await page.click('#geneticRun');
      await page.waitForFunction(settled, null, { timeout: 180000 });
      const rows = await page.locator('#geneticRows tr').count();
      const fixedFalse = await page.locator('#geneticRows .verifier-reproduced').count();
      if (rows !== 6 || fixedFalse !== 0) throw Error(`Incorrect comparison ${lang}: rows=${rows} falsePositives=${fixedFalse}`);
      await page.evaluate(() => { document.querySelector('#panel-genetic .verifier-body')?.scrollTo(0, 0); });
      await page.screenshot({ path: path.join(root, `docs/training/images/genetic-compare-${lang}.png`), mask: [page.locator('#siteSelect:visible')] });
      checks.push(`${lang}/compare: ${rows} summary rows, 0 false positives`);
      await page.fill('#geneticSeed', '43').catch(() => {});
      for (const [width, height] of [[1440, 968], [1280, 768], [960, 648]]) {
        await page.setViewportSize({ width, height });
        for (const target of ['geneticGeneral', 'geneticGuide', 'geneticResultPage', 'geneticEvidencePage']) {
          await page.locator(`[data-vpage=${target}]`).click();
          if (!await page.evaluate(() => document.body.scrollHeight <= innerHeight && document.body.scrollWidth <= innerWidth)) throw Error(`Viewport overflow ${width}x${height} ${target}`);
        }
      }
      await page.setViewportSize({ width: 1280, height: 768 }); await page.click('[data-vpage=geneticGeneral]'); await page.click('[data-vpage=geneticResultPage]');
    }
    await page.selectOption('#geneticKind', 'compare'); await page.click('#geneticRun'); await page.waitForFunction(() => !document.getElementById('geneticCancel').disabled);
    await page.click('#geneticCancel'); await page.waitForFunction(() => !document.getElementById('geneticRun').disabled);
    checks.push('cancel: returns to idle');
    if (errors.length) throw Error(errors.join('\n'));
    const manifestFile = path.join(root, 'docs/training/images/manifest.json'); const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.images = manifest.images.filter(image => !String(image.step).startsWith('genetic-'));
    for (const lang of ['ja', 'en']) for (const step of ['genetic-run', 'genetic-compare']) manifest.images.push({ lang, step, file: `docs/training/images/${step}-${lang}.png`, viewport: { width: 1280, height: 768 } });
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    fs.mkdirSync(path.join(root, 'artifacts/desktop'), { recursive: true });
    fs.writeFileSync(path.join(root, 'artifacts/desktop/genetic-ui-verification.json'), JSON.stringify({ checks, errors, layout: 'JA/EN 1440x968,1280x768,960x648' }, null, 2));
    console.log(checks.join('\n'));
  } finally { await browser.close(); await host.close(); fs.rmSync(data, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
