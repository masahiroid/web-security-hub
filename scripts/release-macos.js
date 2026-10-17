'use strict';
const {spawnSync}=require('child_process');const path=require('path');
function run(script,args=[],env=process.env){const r=spawnSync(process.execPath,[path.join(__dirname,script),...args],{stdio:'inherit',env});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${script} failed (${r.status})`);}
try {
 if(!process.env.APPLE_SIGNING_IDENTITY)process.env.APPLE_SIGNING_IDENTITY=JSON.parse(require('fs').readFileSync(path.resolve(__dirname,'../src-tauri/tauri.conf.json'),'utf8')).bundle?.macOS?.signingIdentity || '';
 if(process.platform!=='darwin')throw Error('Run the release build on macOS.');
 if(!process.env.APPLE_SIGNING_IDENTITY||!(process.env.WSH_NOTARY_PROFILE||(process.env.APPLE_ID&&(process.env.APPLE_PASSWORD||process.env.APPLE_APP_SPECIFIC_PASSWORD)&&process.env.APPLE_TEAM_ID)))throw Error('Configure a local signing identity and notarization profile or Apple authentication environment variables first.');
 run('check-release-content.js');
 // Use the Keychain-profile signing path once, after packaging all sidecars.
 const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('APPLE_'))delete env[k];
 run('desktop.js',['build','--bundles','app','--','--locked'],env);
 run('check-release-content.js',['--bundle']);
 run('sign-macos.js');
}catch(e){console.error(e.message);process.exitCode=1;}
