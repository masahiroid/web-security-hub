'use strict';
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const {chromium}=require('playwright');const {root,startServers,setMode}=require('./training-runtime');const {privateScreenshot}=require('./screenshot-privacy');
(async()=>{const close=await startServers();const browser=await chromium.launch();try{
 const file=path.join(root,'docs/training/images/manifest.json');const manifest=JSON.parse(fs.readFileSync(file));
 for(const lang of ['ja','en']){
  const session=manifest.runs.find(r=>r.lang===lang&&r.stage==='07-baseline').sessionId;
  const context=await browser.newContext({viewport:manifest.viewport,reducedMotion:'reduce'});await context.addInitScript(l=>localStorage.setItem('web-security-hub.locale',l),lang);const page=await context.newPage();await page.goto('http://127.0.0.1:4173');await page.waitForFunction(l=>document.documentElement.lang===l,lang);await page.selectOption('#siteSelect',`training-${lang}`);await page.click('[data-tab=replay]');await page.selectOption('#replaySession',session);
  for(const [name,button,mode,pass]of [['07-baseline','#replayBaselineBtn','baseline',true],['08-unchanged','#replayRunBtn','baseline',true],['09-changed','#replayRunBtn','changed',false],['10-fixed','#replayRunBtn','fixed',true]]){
   await setMode(mode);await page.click(button);await page.waitForFunction(()=>!document.getElementById('replayRunBtn').disabled,null,{timeout:180000});const status=await page.locator('#replayStatus').innerText();assert(pass?status.includes('PASS'):/差分あり|differences/.test(status),status);
   await privateScreenshot(page,{path:path.join(root,`docs/training/images/${lang}/${name}.png`),animations:'disabled'});
  }
  await context.close();console.log(`Replay captures refreshed: ${lang}`);
 }
 await setMode('baseline');manifest.privacy={...manifest.privacy,redactedLogPrefixes:['project','home','temp'],replayRefreshedAt:new Date().toISOString()};fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
 }finally{await browser.close();await close();}})().catch(e=>{console.error(e);process.exitCode=1;});
