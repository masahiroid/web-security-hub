'use strict';
// Refresh the static-analysis examples without publishing the developer's source path.
const fs=require('fs');const path=require('path');const {chromium}=require('playwright');
const {root,startServers}=require('./training-runtime');
(async()=>{const close=await startServers();const browser=await chromium.launch();try{
 for(const lang of ['ja','en']){const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addInitScript(l=>localStorage.setItem('web-security-hub.locale',l),lang);const page=await context.newPage();await page.goto('http://127.0.0.1:4173');await page.waitForFunction(l=>document.documentElement.lang===l,lang);await page.click('[data-tab=static]');
 for(const stage of ['before','after']){await page.fill('#sourceDir',path.join(root,'training/sast',stage));await Promise.all([page.waitForResponse(r=>r.url().endsWith('/security/static-scan')&&r.request().method()==='POST'),page.click('#runStatic')]);await page.waitForSelector('#staticResult .scan-summary');await page.screenshot({path:path.join(root,`docs/training/images/${lang}/13-sast-${stage}.png`),animations:'disabled',mask:[page.locator('#sourceDir')],maskColor:'#dce3ea'});}
 await context.close();}
 const manifestPath=path.join(root,'docs/training/images/manifest.json');const manifest=JSON.parse(fs.readFileSync(manifestPath));manifest.privacy={maskedFields:['sourceDir'],refreshedAt:new Date().toISOString()};fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 }finally{await browser.close();await close();}})().catch(e=>{console.error(e);process.exitCode=1;});
