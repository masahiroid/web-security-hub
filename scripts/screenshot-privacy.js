'use strict';
const path=require('path');const os=require('os');
async function privateScreenshot(page,options){
 const saved=await page.evaluate(prefixes=>[...document.querySelectorAll('.log')].map(el=>{const original=el.textContent;let text=original;for(const [prefix,label]of prefixes)text=text.split(prefix).join(label);el.textContent=text;return {id:el.id,text:original};}),[[path.resolve(__dirname,'..'),'[project]'],[os.homedir(),'[home]'],[os.tmpdir(),'[temp]']]);
 try{return await page.screenshot(options);}finally{await page.evaluate(saved=>saved.forEach(({id,text})=>{const el=document.getElementById(id);if(el)el.textContent=text;}),saved);}
}
module.exports={privateScreenshot};
