'use strict';
// Explicit maintainer command; never runs during ordinary startup or local builds.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
function run(command,args) {
  const result = spawnSync(command,args,{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} failed (${result.status})`);
}
function walk(dir) {
  const files=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())files.push(...walk(file)); else if(entry.isFile())files.push(file);
  }
  return files;
}
function main() {
  if(process.platform!=='darwin')throw new Error('Signing must run on macOS.');
  const app=path.resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'src-tauri/target/release/bundle/macos/Web Security Hub.app');
  const identity=process.env.APPLE_SIGNING_IDENTITY || JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src-tauri/tauri.conf.json'),'utf8')).bundle?.macOS?.signingIdentity;
  const profile=process.env.WSH_NOTARY_PROFILE;
  const password=process.env.APPLE_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const accountAuth=Boolean(process.env.APPLE_ID&&password&&process.env.APPLE_TEAM_ID);
  const auth=profile?['--keychain-profile',profile]:accountAuth?['--apple-id',process.env.APPLE_ID,'--password',password,'--team-id',process.env.APPLE_TEAM_ID]:[];
  const signOnly=process.argv.includes('--sign-only');
  if(!identity||(!auth.length&&!signOnly))throw new Error('Configure a local signing identity and either WSH_NOTARY_PROFILE or Apple authentication environment variables. No credentials should be committed.');
  if(!app.endsWith('.app')||!fs.existsSync(app))throw new Error('Build the .app before signing.');
  const entitlements=path.resolve(__dirname,'../src-tauri/entitlements.plist');
  const nodeEntitlements=path.resolve(__dirname,'../src-tauri/node-entitlements.plist');
  // Sign each embedded Mach-O first, including Node and native Node modules.
  for(const file of walk(app)) {
    const fd=fs.openSync(file,'r'); const header=Buffer.alloc(4); const bytes=fs.readSync(fd,header,0,4,0); fs.closeSync(fd);
    if(bytes!==4||!['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(header.toString('hex')))continue;
    const type=spawnSync('file',['-b',file],{encoding:'utf8'});
    if(type.status!==0)throw new Error(`Cannot inspect ${file}`);
    if(!type.stdout.includes('Mach-O'))continue;
    const args=['--force','--sign',identity,'--timestamp','--options','runtime'];
    if(path.basename(file)==='web-security-node')args.push('--entitlements',nodeEntitlements);
    else if(path.basename(file)==='web-security-hub-desktop')args.push('--entitlements',entitlements);
    run('codesign',[...args,file]);
  }
  run('codesign',['--force','--sign',identity,'--timestamp','--options','runtime','--entitlements',entitlements,app]);
  run('codesign',['--verify','--deep','--strict','--verbose=2',app]);
  if(signOnly){console.log(`Signed and verified app: ${app}`);return;}
  const out=path.resolve(__dirname,'../artifacts/desktop');fs.mkdirSync(out,{recursive:true});
  const stage=fs.mkdtempSync(path.join(out,'dmg-stage-'));
  const dmg=path.join(out,`Web Security Hub_${require('../package.json').version}_${process.arch}_signed.dmg`);
  try {
    const archive=path.join(stage,'notarization.zip');
    run('ditto',['-c','-k','--keepParent',app,archive]);
    run('xcrun',['notarytool','submit',archive,...auth,'--wait']);
    run('xcrun',['stapler','staple',app]);run('xcrun',['stapler','validate',app]);
    fs.unlinkSync(archive);
    run('ditto',[app,path.join(stage,path.basename(app))]);fs.symlinkSync('/Applications',path.join(stage,'Applications'));
    run('hdiutil',['create','-volname','Web Security Hub','-srcfolder',stage,'-ov','-format','UDZO',dmg]);
    run('codesign',['--force','--sign',identity,'--timestamp',dmg]);
    run('xcrun',['notarytool','submit',dmg,...auth,'--wait']);
    run('xcrun',['stapler','staple',dmg]);run('xcrun',['stapler','validate',dmg]);
    const hash=crypto.createHash('sha256').update(fs.readFileSync(dmg)).digest('hex');
    fs.writeFileSync(dmg+'.sha256',`${hash}  ${path.basename(dmg)}\n`);
    console.log(`Signed and notarized: ${dmg}`);
  } finally {fs.rmSync(stage,{recursive:true,force:true});}
}
try{main();}catch(e){console.error(e.message);process.exitCode=1;}
