'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto'); const http = require('node:http');
const { createZapEvidence } = require('../core/verifier/generated/adapters/zapEvidence');
const { correlateZapMessage } = require('../core/verifier/generated/domain/zapCorrelation');
const { createZapApi } = require('../core/verifier/generated/adapters/zapApi');
const { collectZap } = require('../core/verifier/generated/adapters/collectZap');
const { ZAP } = require('../core/verifier/generated/domain/zap');
const contracts = require('../core/verifier/contracts');
const correlation = { jobId: 'job', trialId: 'trial', seedId: 'seed-a', requestId: 'request-a', authProfileId: 'learner-a' };
const observation = { ...correlation, dispatched: true, outcome: 'completed' };
const target = { url: 'http://127.0.0.1:4181/inspect', method: 'POST' };
const headers = (fields = correlation, url = target.url, method = target.method) => `${method} ${url} HTTP/1.1\r\n${Object.entries(fields).map(([key, value]) => `${{jobId:'x-verifier-job-id',trialId:'x-verifier-trial-id',seedId:'x-verifier-seed-id',requestId:'x-verifier-request-id',authProfileId:'x-verifier-profile-id'}[key]}: ${value}`).join('\r\n')}\r\n\r\n`;
function fixture({ messages = [{ id: '1', type: '1', requestHeader: headers() }], alerts = [], queue = '0', override = {} } = {}) {
  const calls = [];
  const responses = {
    [ZAP.endpoints.queue]: { recordsToScan: queue }, [ZAP.endpoints.messageCount]: { numberOfMessages: String(messages.length) },
    [ZAP.endpoints.messages]: { messages }, [ZAP.endpoints.alertCount]: { numberOfAlerts: String(alerts.length) }, [ZAP.endpoints.alerts]: { alerts }, ...override
  };
  const api = { get: async (path, params) => { calls.push({path, params}); if (!Object.hasOwn(responses, path)) throw Error('Unexpected API action'); return structuredClone(responses[path]); } };
  return { calls, port: createZapEvidence(api, 'http://127.0.0.1:8090', randomUUID()) };
}
const alert = (messageId = '1', param = 'label') => ({ messageId, pluginId: '10037', risk: 'Low', confidence: 'Medium', param, evidence: 'secret body', url: 'http://private.test', attack: 'private value' });

test('ZAP associates alerts by five identities and message ID, deduplicates and redacts raw values', async () => {
  const x = fixture({ messages: [{id:'1',type:'1',requestHeader:headers()}, {id:'2',type:'1',requestHeader:headers({...correlation,requestId:'request-b',seedId:'seed-b',authProfileId:'learner-b'})}, {id:'3',type:'0',requestHeader:headers(correlation, 'http://127.0.0.1:4181/','GET')}],
    alerts: [alert(), alert(), alert('1','second'), alert('2')] });
  const result = contracts.validate('zapEvidence', await x.port.collect(observation, target, new AbortController().signal));
  assert.equal(result.state, 'completed'); assert.deepEqual([...result.messageIds], ['1']); assert.equal(result.alerts.length, 2);
  assert(result.alerts.every(a => a.messageId === '1' && a.risk === 1 && a.confidence === 2));
  for (const value of ['secret body', 'private value', 'private.test', 'label', 'second']) assert(!JSON.stringify(result).includes(value));
  assert(x.calls.every(call => Object.values(ZAP.endpoints).includes(call.path) && !/action/.test(call.path)));
});

test('same URL with a different seed/profile or an old request never supplies evidence', async () => {
  for (const changes of [{requestId:'old-request'}, {seedId:'other-seed'}, {authProfileId:'learner-b'}, {trialId:'other-trial'}, {jobId:'other-job'}]) {
    const x=fixture({messages:[{id:'1',type:'1',requestHeader:headers({...correlation,...changes})}],alerts:[alert()]});
    const result=await x.port.collect(observation,target,AbortSignal.timeout(500));
    assert.equal(result.state,'incomplete');assert.equal(result.alerts.length,0);assert.equal(result.messageIds.length,0);
  }
});

test('wrong route/method/origin, duplicate headers and duplicated message ownership fail closed', async () => {
  for(const header of [headers(correlation,'http://127.0.0.1:4181/other'),headers(correlation,'http://127.0.0.1:4182/inspect'),headers(correlation,target.url,'GET'),headers().replace('\r\n\r\n','\r\nx-verifier-request-id: request-a\r\n\r\n')]){
    assert.equal(correlateZapMessage(header,correlation,target),'invalid');
  }
  const x=fixture({messages:[{id:'1',type:'1',requestHeader:headers()},{id:'2',type:'1',requestHeader:headers()}]});
  assert.equal((await x.port.collect(observation,target,new AbortController().signal)).state,'incomplete');
});

test('queue cancellation, missing messages, invalid data, size limits and undispatched trials are explicit', async () => {
  const controller=new AbortController();const x=fixture({queue:'1'});const pending=x.port.collect(observation,target,controller.signal);controller.abort();
  assert.equal((await pending).state,'incomplete');
  assert.equal((await fixture({messages:[]}).port.collect(observation,target,AbortSignal.timeout(500))).reason,'message_missing');
  assert.equal((await fixture({override:{[ZAP.endpoints.messageCount]:{numberOfMessages:String(ZAP.maximumMessages+1)}}}).port.collect(observation,target,new AbortController().signal)).reason,'limit');
  assert.equal((await fixture({alerts:[{...alert(),risk:'UNKNOWN'}]}).port.collect(observation,target,new AbortController().signal)).state,'error');
  assert.equal((await fixture().port.collect({...observation,dispatched:false},target,new AbortController().signal)).state,'incomplete');
});

test('ZAP schemas reject mixed messages, premature completion, raw fields, duplicate alerts and invalid ranks', async () => {
  const good=await fixture({alerts:[alert()]}).port.collect(observation,target,new AbortController().signal);
  for(const mutate of [r=>r.alerts[0].messageId='other',r=>r.alerts[0].risk=4,r=>r.alerts[0].body='secret',r=>r.alerts.push(r.alerts[0]),r=>r.state='incomplete',r=>r.messageIds=[]]){
    const value=structuredClone(good);mutate(value);assert.throws(()=>contracts.validate('zapEvidence',value));
  }
});

test('an uncooperative evidence port is bounded by cancellation without publishing its late response', async () => {
  const controller=new AbortController();let entered;const started=new Promise(resolve=>entered=resolve);
  const pending=collectZap({proxy:'http://127.0.0.1:8090',collect:()=>{entered();return new Promise(()=>{});}},observation,target,controller.signal,contracts);
  await started;controller.abort();assert.equal((await pending).state,'incomplete');
});

test('the ZAP API adapter rejects non-local origins, mutations, redirects and oversized responses', async t => {
  for(const origin of ['https://127.0.0.1:8090','http://localhost:8090','http://127.0.0.1:8090/path'])assert.throws(()=>createZapApi(origin,'key'));
  let redirected=0;const other=http.createServer((_q,r)=>{redirected++;r.end('{}');});await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  const server=http.createServer((req,res)=>{
    assert.equal(req.headers['x-zap-api-key'],'private-key');
    if(req.url.includes('version')){res.writeHead(302,{Location:`http://127.0.0.1:${other.address().port}/`});res.end();}
    else res.end(' '.repeat(ZAP.apiBytes+1));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await new Promise(resolve=>{other.close(resolve);other.closeAllConnections();});});
  const api=createZapApi(`http://127.0.0.1:${server.address().port}`,'private-key');const signal=new AbortController().signal;
  await assert.rejects(api.get('/JSON/core/action/newSession/',{},signal));
  await assert.rejects(api.get(ZAP.endpoints.version,{},signal));assert.equal(redirected,0);
  await assert.rejects(api.get(ZAP.endpoints.queue,{},signal));
});

// A zero queue can precede history publication or a newly registered task.
test('transient missing history and restarted passive queues are retried within the same deadline', async () => {
  let messages = 0; let queue = 0; let alertReads = 0;
  const api = { get: async endpoint => {
    if (endpoint === ZAP.endpoints.queue) return { recordsToScan: ++queue === 5 ? '1' : '0' };
    if (endpoint === ZAP.endpoints.messageCount) return { numberOfMessages: '1' };
    if (endpoint === ZAP.endpoints.messages) return { messages: ++messages === 1 ? [] : [{ id: '1', type: '1', requestHeader: headers() }] };
    if (endpoint === ZAP.endpoints.alertCount) return { numberOfAlerts: '1' };
    if (endpoint === ZAP.endpoints.alerts) { alertReads++; return { alerts: [alert()] }; }
    throw Error('Unexpected endpoint');
  } };
  const result = await createZapEvidence(api, 'http://127.0.0.1:8090', randomUUID()).collect(observation, target, AbortSignal.timeout(3000));
  assert.equal(result.state, 'completed'); assert(messages >= 2); assert.equal(alertReads, 2); assert.equal(result.alerts.length, 1);
});
