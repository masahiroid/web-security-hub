'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const os=require('os');const path=require('path');const {ensureDesktopConfig}=require('../scripts/desktop-config');
test('first-run desktop config uses anonymous templates and preserves private local configuration',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsh-config-'));
 try{
  for(const name of ['tauri.conf.example.json','entitlements.example.plist','node-entitlements.example.plist'])fs.copyFileSync(path.resolve('src-tauri',name),path.join(dir,name));
  ensureDesktopConfig(dir);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'tauri.conf.json'))).identifier,'com.example.websecurityhub');
  const config=path.join(dir,'tauri.conf.json'),entitlements=path.join(dir,'entitlements.plist');
  fs.writeFileSync(config,'private-local-identity');fs.writeFileSync(entitlements,'private-local-entitlements');
  ensureDesktopConfig(dir);assert.equal(fs.readFileSync(config,'utf8'),'private-local-identity');assert.equal(fs.readFileSync(entitlements,'utf8'),'private-local-entitlements');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('source environment requires Node 24 or later', () => {
 const {isSupportedNode}=require('../desktop/environment');
 for(const version of ['20.19.0','22.19.0','22.23.4','23.11.0','invalid'])assert.equal(isSupportedNode(version),false,version);
 for(const version of ['24.0.0','24.22.1','v24.21.0','25.0.0'])assert.equal(isSupportedNode(version),true,version);
});
