'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(),'wsh-desktop-'));
  const root = path.resolve(__dirname,'..'); const runtimeRoot = process.argv.includes('--staged') ? path.join(root,'.desktop/runtime') : root; const evidence = { checks:[] };
  let browser; let host;
  const target = { 'darwin-arm64':'aarch64-apple-darwin','darwin-x64':'x86_64-apple-darwin','linux-arm64':'aarch64-unknown-linux-gnu','linux-x64':'x86_64-unknown-linux-gnu','win32-arm64':'aarch64-pc-windows-msvc','win32-x64':'x86_64-pc-windows-msvc' }[`${process.platform}-${process.arch}`];
  const hostNode = process.argv.includes('--staged') ? path.join(root,`src-tauri/binaries/web-security-node-${target}${process.platform === 'win32' ? '.exe' : ''}`) : process.execPath;
  const child = spawn(hostNode,[path.join(runtimeRoot,'desktop/host.js')],{cwd:runtimeRoot,env:{...process.env,WEB_SECURITY_HUB_DATA_DIR:data,WEB_SECURITY_HUB_PACKAGED:'1'},stdio:['pipe','pipe','pipe']});
  let stderr = ''; child.stderr.on('data',b => { stderr += b; });
  try {
    host = await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(new Error('Host startup timed out: ' + stderr)),20000);
      let output = '';
      child.stdout.on('data',b => {
        output += b.toString();
        const match = output.match(/WSH_READY (\{[^\n]+\})/);
        if (match) { clearTimeout(timeout); resolve(JSON.parse(match[1])); }
      });
      child.once('error',e => { clearTimeout(timeout); reject(e); });
      child.once('exit',code => { clearTimeout(timeout); reject(new Error(`Host exited: ${code} ${stderr}`)); });
    });
    const origin = new URL(host.url).origin;
    assert.equal((await fetch(origin+'/api/sites')).status,401);
    assert.equal((await fetch(origin+'/api/desktop/install',{method:'POST',headers:{Origin:'https://example.test'}})).status,403);
    evidence.checks.push('Unauthenticated and cross-origin local API requests rejected');
    browser = await chromium.launch();
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const page = await context.newPage();
    const request = context.request;
    const artifact = path.join(root,'artifacts/desktop'); fs.mkdirSync(artifact,{recursive:true});
    await page.goto(host.url);
    await page.waitForSelector('.check');
    assert.equal(await page.getAttribute('#openHub','aria-disabled'),'true');
    console.log('Cold start correctly reports missing private browser. Installing through GUI…');
    await page.click('#install');
    await page.waitForFunction(() => document.getElementById('openHub').getAttribute('aria-disabled') === 'false',null,{timeout:240000});
    await page.screenshot({path:path.join(artifact,'welcome-ja.png'),fullPage:true});
    const readyState = await (await request.get(origin + '/api/desktop/state')).json();
    evidence.node = readyState.checks.find(c => c.id === 'node').detail; evidence.runtime = process.argv.includes('--staged') ? 'packaged web runtime' : 'source';
    evidence.checks.push('Cold-start browser missing → GUI install → browser launch check ready');
    for (const lang of ['ja','en']) {
      await page.goto(origin + `/training/README${lang === 'ja' ? '.ja' : ''}.html`);
      assert(!(await page.locator('body').innerText()).includes('npm install'));
      await page.click('[data-start-training]');
      await page.waitForFunction(() => /ready:|準備ができました/.test(document.getElementById('courseStatus').textContent));
      await page.locator('[data-training-mode=changed]').first().click();
      await page.waitForFunction(() => /changed|変更版/.test(document.getElementById('courseStatus').textContent));
      await page.locator('[data-training-mode=fixed]').first().click();
      await page.waitForFunction(() => /fixed|修正版/.test(document.getElementById('courseStatus').textContent));
    }
    evidence.checks.push('Bilingual in-app course starts training and switches modes without shell commands');
    await page.goto(origin + '/welcome');
    await page.click('.home-nav button:nth-child(2)'); await page.click('#training'); await page.waitForSelector('#trainingControls:not([hidden])');
    assert(fs.existsSync(path.join(data,'sites/training-ja/.env')));
    await page.selectOption('#language','en');
    await page.screenshot({path:path.join(artifact,'welcome-en.png'),fullPage:true});
    await page.click('[data-mode=changed]'); await page.waitForFunction(() => document.getElementById('trainingStatus').textContent.includes('Changed'));
    assert.equal((await (await fetch('http://127.0.0.1:4180/__training/state')).json()).mode,'changed');
    await page.click('[data-mode=fixed]'); await page.waitForFunction(() => document.getElementById('trainingStatus').textContent.includes('Fixed'));
    evidence.checks.push('Training start, bilingual UI, mode switches and credentials stored outside application');
    await page.click('a[href="/?trainingScan=before"]');
    await page.waitForFunction(() => document.querySelector('#sourceDir').value.endsWith('training/sast/before'));
    await page.click('#runStatic'); await page.waitForSelector('#staticResult .scan-summary');
    assert(fs.readdirSync(path.join(data,'artifacts/static-scans')).length > 0);
    const saved = await page.locator('#staticResult a').filter({hasText:'HTML'}).getAttribute('href');
    assert.equal((await request.get(origin+saved)).status(),200);
    evidence.checks.push('SAST source prefilled without commands; report stored in user data and served successfully');
    const sourceInput = await page.inputValue('#sourceDir');
    const bindingResponse = page.waitForResponse(response => response.url().endsWith('/api/verifier/sast-sample'));
    await page.click('#runSastBinding'); const binding = await (await bindingResponse).json();
    assert.equal(binding.state, 'completed'); assert.equal(binding.pair.control.observation.status, 200);
    assert.equal(binding.pair.candidate.observation.status, 422); assert.equal(binding.pair.candidate.assessment.result, 'under_investigation');
    await page.waitForFunction(() => !document.getElementById('runSastBinding').disabled);
    assert.equal(await page.inputValue('#sourceDir'), sourceInput);
    evidence.checks.push('Packaged source/scope sample GUI: normal 200, candidate 422, under investigation, retained source input');
    await page.goto(origin+'/'); await page.selectOption('#siteSelect','training-en');
    await page.waitForFunction(() => document.getElementById('siteId').value === 'training-en');
    await page.fill('#maxCases','1'); await page.click('#saveSiteBtn');
    await page.waitForFunction(() => /Saved/.test(document.getElementById('saveSiteStatus').textContent));
    await page.click('[data-tab=testCases]'); await page.click('#runPipelineBtn');
    await page.waitForFunction(() => !document.getElementById('runPipelineBtn').disabled,null,{timeout:180000});
    assert(await page.locator('#pipelineResult a').count(),await page.locator('#pipelineStatus').innerText());
    const report = await page.locator('#pipelineResult a').first().getAttribute('href');
    const session = report.split('/')[5];
    await page.click('[data-tab=replay]'); await page.selectOption('#replaySession',session);
    await page.click('#panel-replay .workspace-tabs button:nth-child(2)'); await page.click('#loadCaseEditorBtn'); await page.waitForSelector('#caseEditorTables input');
    for (const [selector,value] of Object.entries({'#name':'Demo Learner','#contact':'learner@example.test','#participants':'5'})) await page.fill(`#caseEditorTables input[data-sel="${encodeURIComponent(selector)}"]`,value);
    await page.click('#saveCaseEditorBtn'); await page.waitForFunction(() => /Saved and regenerated/.test(document.getElementById('caseEditorStatus').textContent));
    await page.click('#panel-replay .workspace-tabs button:first-child');
    for (const button of ['#replayBaselineBtn','#replayRunBtn']) {
      await page.click(button); await page.waitForFunction(() => !document.getElementById('replayRunBtn').disabled,null,{timeout:180000});
      assert((await page.locator('#replayStatus').innerText()).includes('PASS'),await page.locator('#replayLog').innerText());
    }
    evidence.checks.push('Generate/edit/baseline/replay PASS from user-data sessions outside source tree, without npx');
    await context.close();
    evidence.verifiedAt = new Date().toISOString(); fs.writeFileSync(path.join(artifact,'verification.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence,null,2));
  } finally {
    await browser?.close();
    child.stdin.end();
    await new Promise(resolve => { if(child.exitCode !== null)return resolve(); child.once('exit',resolve); setTimeout(() => {child.kill('SIGTERM');resolve();},5000).unref(); });
    fs.rmSync(data,{recursive:true,force:true});
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
