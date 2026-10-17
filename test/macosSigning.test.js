'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const os=require('os');const path=require('path');const vm=require('vm');
test('local signer limits Node JIT and staples the app before packaging, without sending credentials in arguments',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wsh-sign-plan-'));const app=path.join(temp,'Web Security Hub.app');const binaries=path.join(app,'Contents/MacOS');fs.mkdirSync(binaries,{recursive:true});
 for(const name of ['web-security-node','web-security-hub-desktop'])fs.writeFileSync(path.join(binaries,name),Buffer.from('cffaedfe','hex'));
 const calls=[];const processMock={platform:'darwin',arch:'arm64',argv:['node','sign-macos.js',app],env:{APPLE_SIGNING_IDENTITY:'TEST IDENTITY',WSH_NOTARY_PROFILE:'TEST PROFILE'}};
 try{
 vm.runInNewContext(fs.readFileSync(path.resolve('scripts/sign-macos.js'),'utf8'),{__dirname:path.join(temp,'scripts'),process:processMock,Buffer,console:{log(){},error(message){throw Error(message);}},require(name){
  if(name==='fs'&&process.platform==='win32')return {...fs,symlinkSync(){}};
  if(name==='../package.json')return {version:'1.0.0'};
  if(name==='child_process')return {spawnSync(command,args){calls.push({command,args});if(command==='ditto'&&args[0]==='-c')fs.writeFileSync(args.at(-1),'test-archive');if(command==='hdiutil')fs.writeFileSync(args.at(-1),'signed-test-image');return {status:0,stdout:command==='file'?'Mach-O 64-bit executable arm64':''};}};
  return require(name);
 }});
 assert.equal(processMock.exitCode,undefined);
 const node=calls.find(c=>c.command==='codesign'&&c.args.at(-1)===path.join(binaries,'web-security-node'));
 assert.equal(node.args[node.args.indexOf('--entitlements')+1],path.join(temp,'src-tauri/node-entitlements.plist'));
 const shell=calls.find(c=>c.command==='codesign'&&c.args.at(-1)===app);
 assert.equal(shell.args[shell.args.indexOf('--entitlements')+1],path.join(temp,'src-tauri/entitlements.plist'));
 assert(calls.findIndex(c=>c.command==='xcrun'&&c.args.join('|')===['stapler','staple',app].join('|'))<calls.findIndex(c=>c.command==='hdiutil'));
 assert.equal(calls.filter(c=>c.command==='xcrun'&&c.args[0]==='notarytool').length,2);
 for(const c of calls)if(c.command==='xcrun'&&c.args[0]==='notarytool'){assert(c.args.includes('--keychain-profile'));assert(!c.args.includes('--password'));}
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
