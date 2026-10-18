'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const express = require('express');
const { randomUUID } = require('node:crypto');
const { createStaticFileAnalysis } = require('../core/verifier/generated/adapters/staticFileAnalysis');
const { staticMatches } = require('../core/verifier/generated/domain/staticRules');
const { runSourceTarget } = require('../core/verifier/generated/adapters/sourceTargetService');
const { createSourceReportStore } = require('../core/verifier/generated/adapters/sourceReportStore');
const { renderSourceReport } = require('../core/verifier/generated/adapters/sourceReportHtml');
const { createVerifierRouter } = require('../core/verifier/generated/adapters/verifierRouter');
const contracts = require('../core/verifier/contracts');
const source = `const express=require('express');const app=express();app.post('/inspect',(req,res)=>{const unused={rejectUnauthorized:false};res.json({accepted:true});});module.exports=app;`;
async function setup(t, { handler } = {}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'wsh-target-'));await fs.writeFile(path.join(root,'app.js'),source);
  const bytes=Buffer.from(source),match=[...staticMatches(source)][0];const finding=createStaticFileAnalysis(bytes,'app.js').at(match.id,match.startOffset,match.endOffset);
  const hits=[];const target=http.createServer((req,res)=>{hits.push({url:req.url,method:req.method});if(handler)return handler(req,res);res.setHeader('content-type','application/json');res.end('{"accepted":true}');});
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${target.address().port}`;
  t.after(async()=>{await new Promise(resolve=>{target.close(resolve);target.closeAllConnections();});await fs.rm(root,{recursive:true,force:true});});
  const options={sourceDir:root,finding,origin,normalValues:{label:'private-control-canary'},candidateValues:{label:'private-candidate-canary'},expectedJson:{accepted:true},expectedStatus:200,useZap:false,authorized:true};
  return {root,hits,options,finding};
}
function report(result) { return {...result,schemaVersion:1,reportId:randomUUID(),createdAt:new Date().toISOString(),applicationVersion:'test'}; }

test('an explicit local target runs only the unique route and omits private input values',async t=>{
  const x=await setup(t);const result=await runSourceTarget(x.options,x.root,new AbortController().signal);
  assert.equal(result.state,'completed');assert.deepEqual(x.hits,[{url:'/inspect',method:'POST'},{url:'/inspect',method:'POST'}]);
  assert.equal(result.pair.candidate.assessment.result,'under_investigation');assert(!JSON.stringify(result).includes('private-control-canary'));assert(!JSON.stringify(result).includes(x.root));
  const value=contracts.validate('sourceReport',report(result));assert(Object.isFrozen(value));
});

test('unauthorized, non-loopback, changed source and extra options cannot send to a different target',async t=>{
  const x=await setup(t);
  for(const options of [{...x.options,authorized:false},{...x.options,origin:'http://example.test:4181'},{...x.options,origin:x.options.origin+'/inspect'},{...x.options,route:'/other'}])await assert.rejects(runSourceTarget(options,x.root,new AbortController().signal));
  await fs.appendFile(path.join(x.root,'app.js'),'\n// source changed');const result=await runSourceTarget(x.options,x.root,new AbortController().signal);
  assert.equal(result.state,'source_binding_failed');assert.equal(result.pair.candidate,null);assert.equal(x.hits.length,0);
});

test('private source reports round-trip without overwrites, reject tampering and escape HTML',async t=>{
  const x=await setup(t);const result=report(await runSourceTarget(x.options,x.root,new AbortController().signal));const store=createSourceReportStore(x.root);
  const saved=await store.save(result);const loaded=await store.read(result.reportId);assert.equal(loaded.reportId,result.reportId);
  await assert.rejects(store.save(result));await assert.rejects(store.read('../other'));
  if(process.platform!=='win32')assert.equal((await fs.stat(saved.jsonFile)).mode&0o777,0o600);
  const bad=structuredClone(result);bad.pair.candidate.observation.requestId=bad.pair.control.observation.requestId;assert.throws(()=>contracts.validate('sourceReport',bad));
  const fake=structuredClone(result);fake.pair.candidate.assessment.result='reproduced';assert.throws(()=>contracts.validate('sourceReport',fake));
  const unsafe={...result,applicationVersion:'<script>alert(1)</script>'};const html=renderSourceReport(unsafe);assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
  const folder=path.dirname(saved.jsonFile);const old=path.join(folder,'original.json');await fs.rename(saved.jsonFile,old);
  try {await fs.symlink(old,saved.jsonFile);}catch(error){if(process.platform==='win32'&&error.code==='EPERM')return;throw error;}
  await assert.rejects(store.read(result.reportId));
});

test('source target API saves owner-protected JSON/HTML and refuses unauthorized payloads',async t=>{
  const x=await setup(t);const app=express();const verifier=createVerifierRouter({applicationVersion:'test',dataRoot:x.root});app.use('/api/verifier',verifier.router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await verifier.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
  const session=await fetch(origin+'/api/verifier/session');const cookie=session.headers.get('set-cookie').split(';')[0];
  const post=(body,auth=cookie)=>fetch(origin+'/api/verifier/sast-sample/target',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:auth},body:JSON.stringify(body)});
  assert.equal((await post(x.options,'')).status,401);assert.equal((await post({...x.options,authorized:false})).status,400);
  const response=await post(x.options);assert.equal(response.status,200);const value=await response.json();assert.equal(value.state,'completed');assert(value.reportId);
  const base=origin+'/api/verifier/sast-sample/reports/'+value.reportId;
  assert.equal((await fetch(base+'/report.json',{headers:{Cookie:cookie}})).status,200);
  const html=await fetch(base+'/report.html',{headers:{Cookie:cookie}});assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/default-src 'none'/);
  const second=await fetch(origin+'/api/verifier/session');const other=second.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/report.json',{headers:{Cookie:other}})).status,404);
  assert(!JSON.stringify(value).includes('private-candidate-canary'));assert(!JSON.stringify(value).includes(x.root));
});

test('anonymous source verification bounds chunked response bytes before buffering and closes the connection',async t=>{
  let closed;const disconnected=new Promise(resolve=>closed=resolve);
  const x=await setup(t,{handler:(_req,res)=>{res.setHeader('content-type','application/json');res.on('close',closed);res.write('x'.repeat(65536));res.write('too large');}});
  const result=await runSourceTarget(x.options,x.root,new AbortController().signal);
  assert.equal(result.state,'control_failed');assert.equal(result.pair.control.observation.reason,'response_too_large');assert.equal(result.pair.candidate,null);assert.equal(x.hits.length,1);
  await disconnected;
});
