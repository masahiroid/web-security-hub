// Keep the current workspace and unsaved form values while consulting the course.
const button=document.createElement('button');button.type='button';button.id='helpBtn';button.className='secondary';document.querySelector('header').append(button);
const overlay=document.createElement('div');overlay.className='help-overlay';overlay.hidden=true;
overlay.innerHTML='<section class="help-drawer" role="dialog" aria-modal="true" aria-labelledby="helpTitle"><div class="help-head"><h2 id="helpTitle"></h2><button type="button" id="closeHelp" class="secondary"></button></div><iframe title="Documentation" id="helpReader"></iframe></section>';
document.body.append(overlay);
const frame=document.getElementById('helpReader');const close=document.getElementById('closeHelp');let loadedDocument;
function translate(){const ja=document.documentElement.lang==='ja';button.textContent=ja?'マニュアル・ハンズオン':'Manual & hands-on';document.getElementById('helpTitle').textContent=button.textContent;close.textContent=ja?'閉じる':'Close';frame.title=button.textContent;}
let background=[];
function hide(){overlay.hidden=true;background.forEach(([el,inert])=>el.inert=inert);background=[];button.focus();}
button.onclick=()=>{translate();const lang=document.documentElement.lang==='ja'?'ja':'en';const documentName=document.getElementById('panel-genetic')?.classList.contains('active')?'GENETIC':document.getElementById('panel-verifier')?.classList.contains('active')?'VERIFIER':document.getElementById('panel-static')?.classList.contains('active')?'SAST-MAPPING':'README';const documentKey=`${documentName}:${lang}`;if(loadedDocument!==documentKey){frame.src=`/training/${documentName}${lang==='ja'?'.ja':''}.html`;loadedDocument=documentKey;}overlay.hidden=false;background=[...document.body.children].filter(el=>el!==overlay&&el instanceof HTMLElement).map(el=>[el,el.inert]);background.forEach(([el])=>el.inert=true);close.focus();};
close.onclick=hide;overlay.onclick=e=>{if(e.target===overlay)hide();};
function keyboard(e){if(overlay.hidden)return;if(e.key==='Escape'){e.preventDefault();hide();}if(e.key==='Tab'&&e.target===close&&e.shiftKey){e.preventDefault();frame.focus();}}
document.addEventListener('keydown',keyboard);
frame.addEventListener('load',()=>{try{frame.contentDocument.addEventListener('keydown',keyboard);}catch{/* External sample pages have their own navigation. */}});
new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});translate();
