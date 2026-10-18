'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-sast-'));
process.env.WEB_SECURITY_HUB_DATA_DIR = temporary;
const { createStaticFileAnalysis } = require('../core/verifier/generated/adapters/staticFileAnalysis');
const { SAST_MAPPING } = require('../core/verifier/generated/domain/sastMapping');
const { validate } = require('../core/verifier/contracts');
const { scanStatic } = require('../core/security/staticScanner');
const { persistStaticReport, renderSarif, renderHtml } = require('../core/security/staticReport');
const prelude = "const express=require('express'); const app=express();\n";
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
function analyze(source, { extension = '.js', relative = `src/example${extension}`, occurrence = 0 } = {}) {
  const matches = [...source.matchAll(/\beval\s*\(/g)]; const match = matches[occurrence]; assert(match);
  return createStaticFileAnalysis(Buffer.from(source), relative).at('SAST-DANGEROUS-EVAL', match.index, match.index + match[0].length);
}
const json = value => JSON.parse(JSON.stringify(value));
test('SAST instance identity is stable across copies/path separators, separates same-line hits, and changes with source bytes', () => {
  const source = `${prelude}app.post('/calc',(req,res)=>{eval(req.body.a);eval(req.body.b);});`;
  const first = analyze(source); const second = analyze(source, { occurrence: 1 });
  assert.match(first.findingInstanceId, /^sast-[a-f0-9]{64}$/); assert.notEqual(first.findingInstanceId, second.findingInstanceId);
  assert.equal(first.findingInstanceId, analyze(source, { relative: 'src\\example.js' }).findingInstanceId);
  assert.equal(first.findingInstanceId, analyze(source).findingInstanceId);
  assert.notEqual(first.findingInstanceId, analyze(source + '\n').findingInstanceId);
  assert.notEqual(first.findingInstanceId, analyze(source, { relative: 'other.js' }).findingInstanceId);
  assert.equal(first.sourceDigest, crypto.createHash('sha256').update(source).digest('hex'));
  assert(Object.isFrozen(first) && Object.isFrozen(first.routeMapping.routes));
});
test('UTF-16 offsets and one-based/exclusive columns preserve CRLF and non-BMP source', () => {
  const source = `${prelude}\r\napp.post('/x',(q,s)=>{ const emoji='😀';eval(q.body.x);});`;
  const result = analyze(source); const start = source.indexOf('eval('); const line = source.slice(0, start).split('\n').at(-1);
  assert.equal(result.sourceSpan.startLine, 3); assert.equal(result.sourceSpan.startColumn, line.length + 1);
  assert.equal(result.sourceSpan.endOffset, start + 'eval('.length); assert.equal(result.sourceSpan.encoding, 'utf16');
  assert.equal(result.sourceSpan.endColumn - result.sourceSpan.startColumn, 'eval('.length);
});
test('literal registrations, static router mounts and local helper calls resolve without executing source', () => {
  const marker = path.join(temporary, 'must-not-execute');
  const source = `${prelude}require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad');
const router=express.Router();function helper(x){return eval(x)}
function handle(req,res){res.json(helper(req.body.x))}router.post('/calc',handle);app.use('/api',router);module.exports=app;`;
  const result = analyze(source); assert.equal(result.routeMapping.status, 'mapped');
  assert.deepEqual(result.routeMapping.routes.map(route => [route.method, route.path]), [['POST', '/api/calc']]);
  assert.equal(result.routeMapping.executable, false); assert(!fs.existsSync(marker));
});
test('ESM default Express and named Router imports are supported as static declarations', () => {
  const source = "import express, {Router as makeRouter} from 'express';const app=express();const router=makeRouter();router.post('/x',(q,s)=>s.send(eval(q.body.x)));app.use('/v1',router);";
  assert.deepEqual(analyze(source, { extension: '.mjs' }).routeMapping.routes.map(route => route.path), ['/v1/x']);
});
test('shared handlers and repeated router mounts remain ambiguous; duplicate endpoints do not collapse registrations', () => {
  for (const registrations of ["app.get('/a',shared);app.post('/b',shared);", "const r=express.Router();r.post('/x',shared);app.use('/a',r);app.use('/b',r);", "app.post('/x',shared);app.post('/x',shared);"]) {
    const result = analyze(`${prelude}function shared(q,s){s.send(eval(q.body.x));}${registrations}`);
    assert.equal(result.routeMapping.status, 'ambiguous'); assert.equal(result.routeMapping.routes.length, 2); assert.equal(result.routeMapping.executable, false);
  }
});
test('middleware prefixes remain scoped across mounts, segment boundaries and parameters', () => {
  const source = `${prelude}const r=express.Router();function guard(q,s,next){eval(q.body.x);next();}
app.use('/api/one',guard);r.get('/one',(q,s)=>s.end());r.get('/two',(q,s)=>s.end());app.use('/api',r);app.get('/apix/one',(q,s)=>s.end());`;
  const result = analyze(source); assert.equal(result.routeMapping.status, 'mapped'); assert.equal(result.routeMapping.routes[0].path, '/api/one');
  const parameterized = analyze(`${prelude}app.post('/items/:id',(q,s)=>s.send(eval(q.body.x)));`);
  assert.equal(parameterized.routeMapping.routes[0].parameterized, true); assert.equal(parameterized.routeMapping.executable, false);
});
test('dynamic/computed/chained/conditional/aliased registrations never become executable or uniquely mapped', () => {
  const examples = ["app.post(routeName,shared);", "app['post']('/b',shared);", "app.route('/b').post(shared);", "if(enabled)app.post('/b',shared);", "const alias=app;alias.post('/b',shared);", "register(app);", "app.use(prefix,router);", "const alias=shared;app.post('/b',alias);"];
  for (const tail of examples) {
    const result = analyze(`${prelude}const router=express.Router();function shared(q,s){s.send(eval(q.body.x))}app.post('/known',shared);${tail}`);
    assert.equal(result.routeMapping.status, 'unavailable', tail); assert.equal(result.routeMapping.executable, false);
    if (tail.includes('prefix')) assert(!result.routeMapping.routes.some(route => route.path === '/'));
  }
});
test('helper escapes, shadowing and uninvoked nested functions are not borrowed from another route', () => {
  for (const tail of ["app.post('/b',(q,s)=>Promise.resolve().then(shared));", "app.post('/b',(shared,s)=>shared());", "shared=other;", "module.exports=shared;"]) {
    const result = analyze(`${prelude}function shared(q,s){s.send(eval(q.body.x))}app.post('/a',shared);${tail}`);
    assert.equal(result.routeMapping.status, 'unavailable', tail);
  }
  const nested = analyze(`${prelude}app.post('/x',(q,s)=>{ function neverCalled(){eval(q.body.x)}s.end();});`);
  assert.equal(nested.routeMapping.status, 'unavailable'); assert.equal(nested.routeMapping.routes.length, 0);
  const defaults = analyze(`${prelude}function shared(x){return eval(x)}function h(q,s,arg=shared(q.body.x)){s.end()}app.post('/x',h);`);
  assert.equal(defaults.routeMapping.status, 'mapped');
});
test('comments, strings and lookalike APIs retain findings without pretending to be executable Express code', () => {
  for (const body of ["/* eval(req.body.x) */res.end();", "res.send('eval(req.body.x)');"]) {
    const result = analyze(`${prelude}app.post('/x',(req,res)=>{${body}});`);
    assert.equal(result.routeMapping.reason, 'non_code_finding'); assert.equal(result.routeMapping.routes.length, 0);
  }
  const fake = analyze("const app=customServer();app.post('/x',(q,s)=>s.send(eval(q.body.x))); ");
  assert.equal(fake.routeMapping.status, 'unavailable');
});
test('unsupported languages, factory registration and parse errors are explicit and do not remove legacy findings', () => {
  assert.equal(analyze('function f(x:string){return eval(x)}', { extension: '.ts' }).routeMapping.reason, 'unsupported_language');
  assert.equal(analyze(`${prelude}app.post('/x', =>eval(x))`).routeMapping.reason, 'parse_error');
  assert.equal(analyze("const express=require('express');function factory(){const app=express();app.post('/x',(q,s)=>s.send(eval(q.body.x)));return app;}").routeMapping.status, 'unavailable');
});
test('cyclic mounts and AST/output budgets return analysis_limit instead of a partial unique result', () => {
  const cycle = analyze(`${prelude}const r=express.Router();r.post('/x',(q,s)=>s.send(eval(q.body.x)));app.use('/api',r);r.use('/again',r);`);
  assert.equal(cycle.routeMapping.reason, 'analysis_limit');
  const huge = analyze(`${prelude}const a=[${'0,'.repeat(SAST_MAPPING.maximumNodes)}];app.post('/x',(q,s)=>s.send(eval(q.body.x)));`);
  assert.equal(huge.routeMapping.reason, 'analysis_limit');
});
test('SAST contract rejects span/path tampering, fake unique conclusions and execution flags', () => {
  const original = analyze(`${prelude}app.post('/x',(q,s)=>s.send(eval(q.body.x)));`);
  for (const mutate of [m => {m.sourceSpan.endOffset=m.sourceSpan.startOffset;}, m=>{m.relativePath='../outside.js';}, m=>{m.routeMapping.routes=[];}, m=>{m.routeMapping.executable=true;}, m=>{m.routeMapping.routes[0].path='//outside';}, m=>{m.sourceDigest='bad';}]) {
    const value = json(original); mutate(value); assert.throws(() => validate('sastMetadata',value));
  }
});
test('scanner/report integration keeps legacy rule IDs, separate instances, metadata in JSON/HTML/Markdown/SARIF', () => {
  const root = fs.mkdtempSync(path.join(temporary,'project-'));
  fs.writeFileSync(path.join(root,'routes.js'), `${prelude}app.post('/one',(q,s)=>s.send(eval(q.body.x)));app.post('/two',(q,s)=>s.send(eval(q.body.y)));`);
  fs.writeFileSync(path.join(root,'old.py'), 'result = eval(user_input)\n');
  const scan = scanStatic({sourceDir:root}); assert.equal(scan.findings.length,3);
  assert(scan.findings.every(item=>item.id==='SAST-DANGEROUS-EVAL'&&item.ruleId===item.id));
  assert.equal(new Set(scan.findings.map(item=>item.findingInstanceId)).size,3);
  const output=persistStaticReport(scan);const id=output.runId;
  const report=JSON.parse(fs.readFileSync(path.join(temporary,'artifacts/static-scans',id,'sast-result.json'),'utf8'));
  assert.equal(report.findings.length,3);assert.equal(report.findings.find(item=>item.location.startsWith('old.py')).routeMapping.reason,'unsupported_language');
  for(const file of ['report.html','report.md','report.sarif']) assert(fs.readFileSync(path.join(temporary,'artifacts/static-scans',id,file),'utf8').includes(scan.findings[0].findingInstanceId));
  const sarif=renderSarif(report);assert.equal(sarif.runs[0].tool.driver.rules.length,1);
  assert(sarif.runs[0].results.every(item=>item.ruleId==='SAST-DANGEROUS-EVAL'&&item.partialFingerprints['webSecurityHubInstance/v1']));
  assert.equal(sarif.runs[0].columnKind,'utf16CodeUnits');assert(sarif.runs[0].results.every(item=>item.locations[0].physicalLocation.region.startColumn>0));
  const legacy={...report,findings:[{id:'OLD',title:'<unsafe>',severity:'low',location:'old.js:2',evidence:'example',remediation:'fix'}]};
  assert(!renderHtml(legacy).includes('<unsafe>'));assert.equal(renderSarif(legacy).runs[0].results[0].ruleId,'OLD');
});
