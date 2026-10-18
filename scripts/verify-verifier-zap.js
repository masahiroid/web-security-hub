'use strict';
// Optional real-engine integration. Raw HTTP data and ZAP sessions are never uploaded.
const assert = require('node:assert/strict'); const fs = require('node:fs/promises'); const path = require('node:path'); const http = require('node:http'); const os = require('node:os'); const { spawn } = require('node:child_process');
const { DATA_ROOT, PROJECT_ROOT } = require('../core/paths');
const { installZapRuntime, readZapInstallation } = require('../core/verifier/generated/adapters/zapRuntimeInstall');
const { startOwnedZap } = require('../core/verifier/generated/adapters/ownedZapRuntime');
const { runSastFixture } = require('../core/verifier/generated/adapters/sastFixtureService');
const { createHttpRunner } = require('../core/verifier/generated/application/httpRunner');
const { createFixture } = require('../training/verifier-site/server'); const { createRegistry } = require('../core/verifier/policies'); const contracts = require('../core/verifier/contracts');
const { FIXTURE } = require('../core/verifier/generated/domain/config');
const SETTINGS = Object.freeze({ ttlMs: 60000, trialMs: 15000, maxTrials: 2, maxConcurrency: 1, cancelMs: 200 });
async function main() {
  const controller = new AbortController(); const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const checks = [];
  try {
    if (process.argv.slice(2).some(value => value !== '--install')) throw Error('Use --install only');
    if (process.argv.includes('--install')) await installZapRuntime(DATA_ROOT, controller.signal);
    assert(await readZapInstallation(DATA_ROOT), 'Install the managed engine first: --install');
    const sample = await runSastFixture(controller.signal, { useZap: true });
    assert.equal(sample.state, 'completed'); assert.equal(sample.pair.control.zap.state, 'completed'); assert.equal(sample.pair.candidate.zap.state, 'completed');
    assert(sample.pair.control.zap.alerts.some(alert => alert.pluginId === '10037'));
    assert.notDeepEqual(sample.pair.control.zap.messageIds, sample.pair.candidate.zap.messageIds);
    assert(sample.pair.candidate.zap.alerts.every(alert => sample.pair.candidate.zap.messageIds.includes(alert.messageId)));
    assert.equal(sample.pair.candidate.assessment.result, 'under_investigation');
    checks.push('Real owned ZAP: separate normal/candidate message IDs; positive passive alert; no same-URL alert inheritance');

    const fixture = createFixture({ initialMode: 'changed' }); const hits = [];
    const server = http.createServer((req, res) => { hits.push({method:req.method,url:req.url}); fixture.app(req,res); });
    await new Promise(resolve => server.listen(0, FIXTURE.host, resolve)); const origin = `http://${FIXTURE.host}:${server.address().port}`;
    const engine = await startOwnedZap(DATA_ROOT, controller.signal);
    const registry = createRegistry({ roots: { fixture: path.join(PROJECT_ROOT,'training/verifier-site') }, authProfileIds: ['learner-a','learner-b'] });
    const route = '/records/record-a'; const seed = seedId => ({schemaVersion:1,seedId,values:{},omitFields:[],rationale:'Known role separation test'});
    const handle = registry.create({schemaVersion:1,sourceRootId:'fixture',origin,route,method:'GET',authProfileIds:['learner-a','learner-b'],allowedFields:[],ttlMs:SETTINGS.ttlMs,maxTrials:SETTINGS.maxTrials,maxConcurrency:SETTINGS.maxConcurrency});
    try {
      let denied = false;
      try { const response = await fetch(engine.port.proxy + '/JSON/core/view/version/'); const body = await response.json(); denied = !response.ok || body.version === undefined; } catch { denied = true; }
      assert(denied, 'Owned API requires its private key');
      const profiles=['learner-a','learner-b'].map(profileId=>({schemaVersion:1,profileId,origin,setup:[{route:'/session',method:'POST',values:{profile:profileId},expectedStatus:200}]}));
      const runner=createHttpRunner({registry,contracts,zap:engine.port,profiles,timeoutMs:SETTINGS.trialMs,
        controls:[{schemaVersion:1,origin,route,method:'GET',authProfileId:'learner-a',seed:seed('role-normal'),expectedStatus:200,expectedJson:{owner:'learner-a'}}]});
      const pair=await runner.runPair(handle,{url:origin+route,method:'GET',authProfileId:'learner-b',seed:seed('role-other')});
      assert.equal(pair.state,'completed');assert.equal(pair.control.zap.state,'completed');assert.equal(pair.candidate.zap.state,'completed');
      assert.equal(pair.control.observation.authProfileId,'learner-a');assert.equal(pair.candidate.observation.authProfileId,'learner-b');
      assert.notDeepEqual(pair.control.zap.messageIds,pair.candidate.zap.messageIds);
      assert.notEqual(pair.control.zap.sessionId,sample.pair.control.zap.sessionId);
      assert(hits.every(hit=>hit.url==='/session'||hit.url===route), 'No ungranted wire requests');
      checks.push('Real same-URL A/B profiles: isolated setup/context/message identities; fresh session excludes previous alerts; no extra target routes');
    } finally { registry.dispose(handle);await engine.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}); }
    const interrupted=new AbortController();const timer=setTimeout(()=>interrupted.abort(),SETTINGS.cancelMs);
    try { await assert.rejects(startOwnedZap(DATA_ROOT,interrupted.signal)); } finally {clearTimeout(timer);}
    const sessions=await fs.readdir(path.join(DATA_ROOT,'artifacts/private/zap'));assert.equal(sessions.filter(name=>name.startsWith('session-')).length,0);
    checks.push('Startup cancellation terminates only owned Java process; all owned private session directories removed');
    const crashRoot=await fs.mkdtemp(path.join(os.tmpdir(),'wsh-zap-crash-'));
    const code=`const {readZapInstallation}=require('./core/verifier/generated/adapters/zapRuntimeInstall');const {startOwnedZap}=require('./core/verifier/generated/adapters/ownedZapRuntime');(async()=>{const i=await readZapInstallation(process.env.WSH_TEST_INSTALL_ROOT);const e=await startOwnedZap(process.env.WSH_TEST_SESSION_ROOT,new AbortController().signal,i);console.log('READY '+e.port.proxy);setInterval(()=>{},1000);})().catch(()=>process.exitCode=1);`;
    const parent=spawn(process.execPath,['-e',code],{cwd:PROJECT_ROOT,env:{...process.env,WSH_TEST_INSTALL_ROOT:DATA_ROOT,WSH_TEST_SESSION_ROOT:crashRoot},stdio:['ignore','pipe','ignore']});
    try {
      await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('Crash test startup timed out')),SETTINGS.ttlMs);parent.stdout.on('data',part=>{output+=part;if(output.includes('READY ')){clearTimeout(timeout);resolve();}});parent.once('exit',()=>{clearTimeout(timeout);reject(Error('Crash test parent exited before ready'));});});
      parent.kill('SIGKILL');await new Promise(resolve=>parent.once('exit',resolve));
      const until=Date.now()+SETTINGS.trialMs;let remaining=[];
      do {remaining=await fs.readdir(path.join(crashRoot,'artifacts/private/zap'));if(!remaining.length)break;await new Promise(resolve=>setTimeout(resolve,SETTINGS.cancelMs));}while(Date.now()<until);
      assert.equal(remaining.length,0,'Guardian removes private Java session after parent crash');
      checks.push('Forced parent crash: stdin watchdog terminates owned Java and removes its session');
    }finally{if(parent.exitCode===null&&parent.signalCode===null)parent.kill('SIGKILL');await fs.rm(crashRoot,{recursive:true,force:true});}

    console.log(JSON.stringify({checks},null,2));
  } finally {process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
