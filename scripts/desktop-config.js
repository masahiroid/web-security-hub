'use strict';
const fs=require('fs');const path=require('path');
const files=['tauri.conf.json','entitlements.plist','node-entitlements.plist'];
function ensureDesktopConfig(directory=path.resolve(__dirname,'../src-tauri')) {
 for(const name of files){
  const extension=path.extname(name);const example=name.slice(0,-extension.length)+'.example'+extension;
  try {fs.copyFileSync(path.join(directory,example),path.join(directory,name),fs.constants.COPYFILE_EXCL);}
  catch(error){if(error.code!=='EEXIST')throw error;}
 }
}
if(require.main===module){ensureDesktopConfig();console.log('Local desktop configuration is ready; existing files were preserved.');}
module.exports={ensureDesktopConfig};
