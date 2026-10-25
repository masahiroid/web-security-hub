'use strict';
// Optional native integration check; no Apple credentials or personal settings.
const http = require('node:http'); const fs = require('fs'); const path = require('path'); const os = require('os'); const net = require('net');
const { spawn, spawnSync } = require('child_process'); const { chromium } = require('playwright');
const SETTINGS = Object.freeze({ startupMs: 60000, pollMs: 250, closeMs: 15000, expectedCandidates: 22, expectedViolations: 4, diagnosticChars: 64 * 1024 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(check, timeout, phase) { const end = Date.now()+timeout; while(Date.now()<end){ if(await check())return; await sleep(SETTINGS.pollMs); } throw Error(`Native verification timed out: ${phase}`); }
async function freePort() { const server=net.createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const port=server.address().port; await new Promise(resolve=>server.close(resolve)); return port; }
// WebView2 150+ ignores environment overrides in elevated hosts. Keep the
// documented machine-policy workaround inside disposable GitHub runners only.
// https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645
function ciDebugPolicy(executable, port) {
 if(process.env.GITHUB_ACTIONS!=='true')return ()=>{};
 const registry='HKLM\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
 const name=path.basename(executable);
 const elevated=spawnSync('powershell.exe',['-NoProfile','-Command','([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{encoding:'utf8'});
 if(elevated.status!==0)throw Error('Could not inspect CI elevation');
 if(elevated.stdout.trim()!=='True')return ()=>{};
 if(spawnSync('reg.exe',['query',registry,'/v',name],{stdio:'ignore'}).status===0)throw Error('Existing WebView policy must not be overwritten');
 const configured=spawnSync('reg.exe',['add',registry,'/v',name,'/t','REG_SZ','/d',`--remote-debugging-port=${port}`,'/f'],{stdio:'ignore'});
 if(configured.status!==0)throw Error('Could not configure disposable CI debugging policy');
 console.log('Elevated CI WebView policy configured for installed executable');
 return ()=>{if(spawnSync('reg.exe',['delete',registry,'/v',name,'/f'],{stdio:'ignore'}).status!==0)throw Error('Could not remove CI debugging policy');};
}
(async()=>{
 if(process.platform!=='win32')throw Error('Run this check on Windows');
 const bundle=path.resolve('src-tauri/target/release/bundle/nsis'); const name=fs.readdirSync(bundle).find(file=>file.endsWith('.exe')); if(!name)throw Error('Build NSIS first');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'wsh-native-')); const install=path.join(temporary,'app'); const checks=[]; let application; let browser; let target; let removePolicy=()=>{};
 try{
  const sourceDirectory=path.join(temporary,'source'); fs.mkdirSync(sourceDirectory);
  fs.copyFileSync(path.resolve('core/verifier/generated/adapters/sastFixtureApp.js'),path.join(sourceDirectory,'app.js'));
  target=http.createServer(require('../core/verifier/generated/adapters/sastFixtureApp'));
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  const targetOrigin=`http://127.0.0.1:${target.address().port}`;
  const installer=spawnSync(path.join(bundle,name),['/S',`/D=${install}`],{windowsVerbatimArguments:true,timeout:SETTINGS.startupMs}); if(installer.status!==0)throw Error('Installer failed');
  const executables=fs.readdirSync(install).filter(file=>file.endsWith('.exe')&&!/^(?:uninstall|web-security-node)/i.test(file)); if(executables.length!==1)throw Error('Installed application not found');
  checks.push('NSIS installation completed'); console.log(checks.at(-1));
  const executable=path.join(install,executables[0]); const port=await freePort();
  removePolicy=ciDebugPolicy(executable,port);
  application=spawn(executable,[],{env:{...process.env,WEB_SECURITY_HUB_DATA_DIR:path.join(temporary,'data'),WEBVIEW2_USER_DATA_FOLDER:path.join(temporary,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`},stdio:['ignore','ignore','pipe']});
  let startupError=''; application.stderr.setEncoding('utf8'); application.stderr.on('data',chunk=>{startupError=(startupError+chunk).slice(-SETTINGS.diagnosticChars);});
  await waitUntil(async()=>{try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);return r.ok;}catch{if(application.exitCode!==null)throw Error(`Native process exited before WebView startup (${application.exitCode})`);return false;}},SETTINGS.startupMs,'WebView debugging endpoint');
  console.log('Native WebView debugging endpoint ready');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`); const context=browser.contexts()[0]; if(!context)throw Error('Native WebView unavailable');
  let page; await waitUntil(async()=>{
   const pages=context.pages(); page=pages.find(value=>/127\.0\.0\.1/.test(value.url()));
   if(!page)for(const shell of pages){
    const status=await shell.locator('#status').textContent({timeout:SETTINGS.pollMs}).catch(()=>null);
    if(status?.includes('Could not start'))throw Error(`Installed app startup failed: ${status}\n${startupError}`);
   }
   return Boolean(page);
  },SETTINGS.startupMs,'local application page');
  console.log('Native local application page ready');
  await page.locator('#openVerifier').waitFor(); await page.click('#openVerifier'); await page.waitForFunction(()=>document.getElementById('panel-verifier')?.classList.contains('active'));
  for(const lang of ['ja','en']){
   await page.selectOption('#languageSelect',lang); await page.waitForFunction(language=>document.documentElement.lang===language,lang);
   for(const mode of ['baseline','changed','fixed']){
    await page.selectOption('#verifierMode',mode); await page.click('#verifierRun'); await page.waitForFunction(()=>!document.getElementById('verifierRun').disabled&&document.querySelectorAll('#verifierRows tr').length>0);
    const rows=await page.locator('#verifierRows tr').count();const reproduced=await page.locator('#verifierRows .verifier-reproduced').count();
    if(rows!==SETTINGS.expectedCandidates||reproduced!==(mode==='changed'?SETTINGS.expectedViolations:0))throw Error('Native verdict mismatch');
    if(mode==='changed'){await page.click('#verifierDownload');await page.frameLocator('#verifierReportReader').locator('h1').waitFor();await page.click('[data-vpage=verifierResultPage]');}
    checks.push(`${lang}/${mode}: native UI PASS`);
   }
   await page.fill('#verifierSeed','43'); await page.click('#helpBtn'); await page.frameLocator('#helpReader').locator('h1').waitFor(); await page.click('#closeHelp'); if(await page.inputValue('#verifierSeed')!=='43')throw Error('Native help lost inputs');
   checks.push(await require('./verify-source-native-ui')(page,lang,sourceDirectory,targetOrigin));
   await page.click('[data-tab=verifier]');
  }
  const close=spawnSync('powershell.exe',['-NoProfile','-Command','(Get-Process -Id $env:WSH_NATIVE_PID).CloseMainWindow()'],{env:{...process.env,WSH_NATIVE_PID:String(application.pid)},encoding:'utf8'}); if(close.status!==0)throw Error('Could not close owned window');
  await waitUntil(()=>application.exitCode!==null,SETTINGS.closeMs,'native application exit'); checks.push('Native app closed cleanly');
  const uninstaller=fs.readdirSync(install).find(file=>/^uninstall.*\.exe$/i.test(file)); if(!uninstaller)throw Error('Uninstaller missing');
  const removed=spawnSync(path.join(install,uninstaller),['/S'],{timeout:SETTINGS.startupMs}); if(removed.status!==0)throw Error('Uninstall failed');
  await waitUntil(()=>!fs.existsSync(executable),SETTINGS.closeMs,'NSIS uninstall'); checks.push('NSIS install and uninstall PASS');
  console.log(JSON.stringify({platform:'Windows x64',checks},null,2));
 }finally{
  if(application&&application.exitCode===null)spawnSync('taskkill',['/PID',String(application.pid),'/T','/F']);
  if(browser)await browser.close().catch(()=>{});
  if(target)await new Promise(resolve=>{target.close(resolve);target.closeAllConnections();});
  removePolicy();
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:SETTINGS.pollMs});
 }
})().catch(error=>{console.error(error.message);process.exitCode=1});
