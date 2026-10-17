const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(),'wsh-ui-'));
process.env.WEB_SECURITY_HUB_DATA_DIR = data;
const { chromium } = require(path.join(root,'node_modules/playwright'));
const { createHost } = require(path.join(root,'desktop/host'));
(async () => {
 const host = await createHost(); const browser = await chromium.launch(); const errors = []; const checks = [];
 try {
  const page = await browser.newPage({viewport:{width:1280,height:768},reducedMotion:'reduce'}); page.on('pageerror',error=>errors.push(error.message));
  await page.goto(host.url); await page.goto(host.origin+'/'); await page.click('[data-tab=verifier]');
  await page.waitForFunction(()=>!document.getElementById('verifierRun').disabled);
  for (const lang of ['ja','en']) {
   await page.selectOption('#languageSelect',lang); await page.waitForFunction(language=>document.documentElement.lang===language,lang);
   for (const mode of ['baseline','changed','fixed']) {
    await page.selectOption('#verifierMode',mode); await page.click('#verifierRun');
    await page.waitForFunction(()=>!document.getElementById('verifierRun').disabled&&document.querySelectorAll('#verifierRows tr').length>0);
    const count = await page.locator('#verifierRows tr').count(); const reproduced = await page.locator('#verifierRows .verifier-reproduced').count();
    if(count!==22||reproduced!==(mode==='changed'?4:0))throw Error('Incorrect UI verdicts '+lang+'/'+mode);
    if(mode==='changed') {
     await page.screenshot({path:path.join(root,`docs/training/images/verifier-results-${lang}.png`),mask:[page.locator('#siteSelect:visible')]});
     await page.click('#verifierDownload'); await page.frameLocator('#verifierReportReader').locator('h1').waitFor();
     if(await page.frameLocator('#verifierReportReader').locator('tbody tr').count()!==22)throw Error('In-app HTML report failed');
     await page.click('[data-vpage=verifierResultPage]');
    }
    checks.push(`${lang}/${mode}: ${count} candidates, ${reproduced} reproduced`);
   }
   await page.fill('#verifierSeed','43'); await page.click('#helpBtn'); await page.frameLocator('#helpReader').locator('h1').waitFor(); await page.click('#closeHelp');
   if(await page.inputValue('#verifierSeed')!=='43')throw Error('Help lost verifier inputs');
   for(const [width,height] of [[1440,968],[1280,768],[960,648]]) {
    await page.setViewportSize({width,height});
    for(const target of ['verifierGeneral','verifierAdvanced','verifierGuide','verifierResultPage','verifierEvidencePage']) {
     await page.locator(`[data-vpage=${target}]`).click();
     if(!await page.evaluate(()=>document.body.scrollHeight<=innerHeight&&document.body.scrollWidth<=innerWidth))throw Error('Viewport overflow');
    }
   }
   await page.setViewportSize({width:1280,height:768}); await page.click('[data-vpage=verifierGeneral]'); await page.click('[data-vpage=verifierResultPage]'); await page.fill('#verifierSeed','42');
  }
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(root,'artifacts/desktop/verifier-ui-verification.json'),JSON.stringify({checks,errors,layout:'JA/EN 1440x968,1280x768,960x648',inAppHtmlReport:true,helpPreservesInput:true},null,2));
  const manifestFile=path.join(root,'docs/training/images/manifest.json');const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  manifest.images=manifest.images.filter(image=>image.step!=='verifier-results');
  for(const lang of ['ja','en'])manifest.images.push({lang,step:'verifier-results',file:`docs/training/images/verifier-results-${lang}.png`,viewport:{width:1280,height:768}});
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  console.log(checks.join('\n'));
 } finally { await browser.close(); await host.close(); fs.rmSync(data,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1});
