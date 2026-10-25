'use strict';
// Read-only audit of the files a normal `git add` could publish. No file contents are printed.
const fs=require('fs');const {execFileSync}=require('child_process');
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
const issues=[];let checked=0;
const isInternalDoc=file=>/^(?:docs\/internal|\.internal)\//.test(file)||/\.internal\.(?:md|html)$/.test(file)||/^docs\/desktop\/(?:RELEASING|VALIDATION|DISTRIBUTION_PRIVACY)\.md$/.test(file)||/^docs\/training\/MAINTENANCE\.(?:md|html)$/.test(file);
const forbidden=/(^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:p12|pfx|p8|key|mobileprovision|provisionprofile))$/i;
const sensitive=[['private key',/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],['GitHub token',/\bgh[pousr]_[A-Za-z0-9]{30,}\b/],['AWS access key',/\bAKIA[A-Z0-9]{16}\b/],['Anthropic key',/\bsk-ant-api\d+-[A-Za-z0-9_-]{30,}/],['local absolute path',/\/(?:Users|Volumes)\/[^\s'"<>]+/]];
for(const file of files){
 if(isInternalDoc(file))issues.push({file,reason:'internal documentation must not be published'});
 if(/^src-tauri\/(?:tauri\.conf\.json|(?:node-)?entitlements\.plist)$/.test(file))issues.push({file,reason:'local desktop configuration; publish the example instead'});
 if(forbidden.test(file)&&!file.endsWith('.env.example'))issues.push({file,reason:'private credential file'});
 if(/^(?:artifacts|\.desktop|\.runtime|src-tauri\/(?:target|binaries))\//.test(file))issues.push({file,reason:'local build or run output'});
 let buffer;try{buffer=fs.readFileSync(file);}catch{continue;}if(buffer.includes(0)||/\.(?:png|jpe?g|gif|ico|icns|pdf|woff2?)$/i.test(file))continue;
 checked++;const text=buffer.toString('utf8');for(const [reason,pattern]of sensitive)if(pattern.test(text))issues.push({file,reason});
}
if(process.argv.includes('--history')) {
 const entries=execFileSync('git',['rev-list','--objects','--branches','--tags','--remotes'],{encoding:'utf8'}).trim().split('\n');let blobs=0;
 for(const entry of entries){const space=entry.indexOf(' ');if(space<0)continue;const oid=entry.slice(0,space),file=entry.slice(space+1);if(!/\.(?:js|ts|cts|mts|json|md|html|yml|yaml|sh|rs|toml|plist|txt|env|example)$/.test(file))continue;
  let value;try{value=execFileSync('git',['cat-file','blob',oid],{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']});}catch{continue;}blobs++;
  if(isInternalDoc(file))issues.push({file,reason:'internal documentation in Git history'});
  if(forbidden.test(file)&&!file.endsWith('.env.example'))issues.push({file,reason:'credential file in Git history'});
  for(const [reason,pattern]of sensitive)if(pattern.test(value))issues.push({file,reason:`${reason} in Git history`});
 }
 console.log(`Branch/tag/remote history: ${blobs} unique text blobs checked locally.`);
}
if(process.argv.includes('--bundle')) {
 const path=require('path');const bundle=path.resolve('src-tauri/target/release/bundle/macos/Web Security Hub.app');
 if(!fs.existsSync(bundle))issues.push({file:'macOS bundle',reason:'build the app before bundle audit'});
 else {
  let count=0;const prefixes=[Buffer.from(require('os').homedir()),Buffer.from(process.cwd())];
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()){count++;const bytes=fs.readFileSync(file);if(prefixes.some(prefix=>bytes.includes(prefix)))issues.push({file:path.relative(bundle,file),reason:'developer path embedded in bundle'});}}}
  walk(bundle);console.log(`macOS bundle: ${count} files checked for this machine's home/workspace paths.`);
  for(const forbiddenFile of ['Contents/Resources/runtime/scripts/sign-macos.js','Contents/Resources/runtime/docs/desktop','Contents/Resources/runtime/desktop/runtime','Contents/Resources/runtime/docs/internal','Contents/Resources/runtime/docs/training/MAINTENANCE.md','Contents/Resources/runtime/docs/training/MAINTENANCE.html'])if(fs.existsSync(path.join(bundle,forbiddenFile)))issues.push({file:forbiddenFile,reason:'maintainer-only content in runtime bundle'});
 }
}
if(issues.length){console.error(JSON.stringify({checked,issues},null,2));process.exitCode=1;}
else console.log(`Release content check: ${checked} text files checked; no configured credential/path patterns found. Images, arbitrary secrets and Git history still need review.`);
