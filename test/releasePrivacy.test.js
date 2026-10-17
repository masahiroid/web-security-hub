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
