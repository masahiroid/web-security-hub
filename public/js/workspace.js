// Keep workflow controls in a fixed desktop shell; long output scrolls locally.
const localized = (ja,en,fr=en) => ({ja,en,fr});
const labels = [];
function label(el, translations) { labels.push([el,translations]); return el; }
function subpages(panel, groups) {
  const nav = document.createElement('div'); nav.className='workspace-tabs'; nav.setAttribute('role','tablist');
  const body = document.createElement('div'); body.className='workspace-pages';
  groups.forEach(([translations,nodes], index) => {
    const page=document.createElement('div'); page.className='workspace-page'; page.hidden=index!==0;
    const button=label(document.createElement('button'),translations); button.type='button'; button.setAttribute('role','tab'); button.setAttribute('aria-selected',String(index===0));
    page.id=`${panel.id}-page-${index}`; button.setAttribute('aria-controls',page.id); page.setAttribute('role','tabpanel');
    button.onclick=()=>{ Array.from(body.children).forEach(p=>p.hidden=p!==page); Array.from(nav.children).forEach(b=>b.setAttribute('aria-selected',String(b===button))); };
    button.onkeydown=e=>{ if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); const buttons=[...nav.children]; const target=e.key==='Home'?0:e.key==='End'?buttons.length-1:(buttons.indexOf(button)+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length; buttons[target].click(); buttons[target].focus(); };
    nodes.forEach(n=>page.append(n)); nav.append(button); body.append(page);
  });
  panel.prepend(nav); nav.after(body);
}
const site=document.getElementById('panel-siteSetup');
const sets=[...site.querySelectorAll(':scope > fieldset')];
sets.forEach((el,i)=>el.id ||= `site-settings-${i}`);
for(const id of ['dynamic','replay']) document.querySelectorAll(`#panel-${id} > fieldset`).forEach((el,i)=>el.id ||= `${id}-settings-${i}`);
subpages(site,sets.map((s,i)=>[[localized('基本設定','General','Général'),localized('ログイン','Login','Connexion'),localized('Basic 認証','Basic auth'),localized('シナリオ','Scenario','Scénario'),localized('操作記録','Recorder','Enregistrement')][i],[s]]));
const save=document.createElement('div'); save.className='workspace-actionbar'; save.append(document.getElementById('saveSiteBtn'),document.getElementById('saveSiteStatus')); site.append(save);
for (const [id,resultIds] of [['dynamic',['dynamicResult']],['static',['staticResult','sastBindingResult']],['testCases',['pipelineLog','pipelineResult']],['replay',['replayLog','replayResult']]]) {
  const panel=document.getElementById(`panel-${id}`);
  const heading=panel.querySelector(':scope > h2');
  const controls=document.createElement('div'); controls.className='workspace-controls';
  const output=document.createElement('div'); output.className='workspace-output'; output.setAttribute('aria-label','Results');
  const caption=label(document.createElement('div'),localized('実行結果','Results','Résultats')); caption.className='output-caption'; output.append(caption);
  const empty=label(document.createElement('div'),localized('実行すると、ここに結果が表示されます。','Results will appear here after you run the task.','Les résultats apparaîtront ici après exécution.')); empty.className='output-empty'; output.append(empty);
  resultIds.forEach(id=>output.append(document.getElementById(id)));
  [...panel.childNodes].filter(n=>n!==heading).forEach(n=>controls.append(n));
  if(id==='dynamic') {
    const fieldsets=[...controls.querySelectorAll(':scope > fieldset')];
    const general=[...controls.childNodes].filter(n=>!fieldsets.includes(n));
    subpages(controls,[[localized('診断設定','Scan settings','Analyse'),general],[localized('ZAP','ZAP'),[fieldsets[0]]],[localized('認証・シナリオ','Authentication','Authentification'),[fieldsets[1]]]]);
  }
  const split=document.createElement('div'); split.className='workspace-split'; split.append(controls,output); panel.append(split);
}
const replay=document.querySelector('#panel-replay .workspace-controls');
const editor=replay.querySelector('fieldset:last-child');
subpages(replay,[[localized('実行設定','Run settings','Exécution'),[...replay.childNodes].filter(n=>n!==editor)],[localized('ケース編集','Case editor','Éditeur'),[editor]]]);
function translate(){ const lang=document.documentElement.lang.split('-')[0]; labels.forEach(([el,dict])=>el.textContent=dict[lang]||dict.en); }
new MutationObserver(translate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']}); translate();
