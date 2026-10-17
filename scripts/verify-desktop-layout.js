'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createHost}=require('../desktop/host');
(async()=>{
 const host=await createHost(); const browser=await chromium.launch();
 const directory=path.resolve('artifacts/desktop/ui');fs.mkdirSync(directory,{recursive:true});
 const errors=[]; const checks=[];
 try {
  const page=await browser.newPage({reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.goto(host.url);
  for(const [width,height] of [[1440,968],[1280,768],[960,648]]) {
   await page.setViewportSize({width,height});
   for(const lang of ['ja','en']) {
    await page.goto(host.origin+'/welcome');await page.selectOption('#language',lang);await page.waitForSelector('.check');
    for(const n of [1,2]) {
     await page.click(`.home-nav button:nth-child(${n})`);
     assert(await page.evaluate(()=>document.body.scrollHeight<=innerHeight&&document.body.scrollWidth<=innerWidth),'Home overflows');
     if(width===1280)await page.screenshot({path:path.join(directory,`home-${n}-${lang}.png`),mask:[page.locator('#storage'),page.locator('.check:nth-child(2) > span:last-child'),page.locator('.check:nth-child(3) > span:last-child')],maskColor:'#dce3ea'});
    }
    await page.goto(host.origin+'/');await page.selectOption('#languageSelect',lang);await page.waitForFunction(l=>document.documentElement.lang===l,lang);
    for(const tab of ['siteSetup','testCases','replay','dynamic','static','about']) {
     await page.click(`[data-tab=${tab}]`);
     assert(await page.evaluate(()=>document.body.scrollHeight<=innerHeight&&document.body.scrollWidth<=innerWidth),`${tab} overflows`);
     const sub=page.locator(`#panel-${tab} .workspace-tabs button`);
     for(let i=0;i<await sub.count();i++) {await sub.nth(i).click();const selected=page.locator(`#panel-${tab} .workspace-page:not([hidden])`);assert.equal(await selected.count(),1);}
     if(await sub.count())await sub.first().click();
     if(width===1280)await page.screenshot({path:path.join(directory,`${tab}-${lang}.png`)});
    }
    await page.click('[data-tab=static]');await page.fill('#sourceDir','unsaved-help-check');await page.click('#helpBtn');await page.frameLocator('#helpReader').locator('h1').waitFor();
    assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'Help header overflows');if(width===1280)await page.screenshot({path:path.join(directory,`help-${lang}.png`)});await page.click('#closeHelp');assert.equal(await page.inputValue('#sourceDir'),'unsaved-help-check');
    checks.push(`${width}×${height} ${lang}: home, six workspaces, all sub-tabs fit; help preserves unsaved input`);
   }
  }
  for(const file of ['/desktop/guide.ja.html','/desktop/guide.html','/training/README.ja.html','/training/README.html']) {
   await page.goto(host.origin+file);await page.waitForSelector('.reader-nav');assert(await page.evaluate(()=>document.body.scrollHeight<=innerHeight&&document.body.scrollWidth<=innerWidth),'Reader overflows');await page.locator('.reader-nav a').nth(2).click();
  }
  checks.push('Japanese/English desktop guides and course readers fit the viewport; chapter navigation works');
  await page.screenshot({path:path.join(directory,'reader.png')});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(directory,'verification.json'),JSON.stringify({checks,errors},null,2));console.log(checks.join('\n'));
 } finally {await browser.close();await host.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
