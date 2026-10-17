'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const os=require('os');const path=require('path');const {spawnSync}=require('child_process');
test('release check rejects force-added internal documents even when Git ignores them',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsh-private-docs-'));
 try{
  const git=args=>{const r=spawnSync('git',args,{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};git(['init','-q']);fs.writeFileSync(path.join(dir,'.gitignore'),'docs/internal/\n');fs.writeFileSync(path.join(dir,'README.md'),'Public usage guide\n');
  const check=()=>spawnSync(process.execPath,[path.resolve('scripts/check-release-content.js')],{cwd:dir,encoding:'utf8'});assert.equal(check().status,0);
  fs.mkdirSync(path.join(dir,'docs/internal'),{recursive:true});fs.writeFileSync(path.join(dir,'docs/internal/review.md'),'Private validation record\n');assert.equal(check().status,0);
  git(['add','-f','docs/internal/review.md']);const result=check();assert.equal(result.status,1);assert.match(result.stderr,/internal documentation must not be published/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('release history audit checks removed TypeScript files for credential patterns', () => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-ts-history-'));
 try {
  const git = args => {
   const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
   assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q']);
  const sourceFile = path.join(directory, 'removed.ts');
  const syntheticToken = 'ghp_' + 'A'.repeat(36);
  fs.writeFileSync(sourceFile, `export const testCredential = '${syntheticToken}';\n`);
  git(['add', 'removed.ts']);
  const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test'];
  git([...identity, 'commit', '-qm', 'Fixture source']);
  fs.unlinkSync(sourceFile);
  git(['add', '-u']);
  git([...identity, 'commit', '-qm', 'Remove fixture source']);
  const checker = path.resolve('scripts/check-release-content.js');
  assert.equal(spawnSync(process.execPath, [checker], { cwd: directory }).status, 0);
  const audited = spawnSync(process.execPath, [checker, '--history'], { cwd: directory, encoding: 'utf8' });
  assert.equal(audited.status, 1);
  assert.match(audited.stderr, /GitHub token in Git history/);
  assert.match(audited.stderr, /removed\.ts/);
 } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
