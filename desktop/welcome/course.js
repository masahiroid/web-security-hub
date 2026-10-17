'use strict';
for (const button of document.querySelectorAll('[data-training-mode],[data-start-training]')) {
  button.addEventListener('click', async () => {
    const ja = document.documentElement.lang === 'ja';
    const status = document.getElementById('courseStatus');
    let local = button.nextElementSibling;
    if (!local?.classList.contains('course-action-status')) { local = document.createElement('span'); local.className = 'course-action-status'; local.setAttribute('role','status'); button.after(local); }
    const controls = document.querySelectorAll('[data-training-mode],[data-start-training]');
    controls.forEach(b => { b.disabled = true; }); status.textContent = ja ? '準備しています…' : 'Preparing…'; local.textContent = status.textContent;
    try {
      const body = button.dataset.trainingMode ? { mode: button.dataset.trainingMode } : {};
      const response = await fetch('/api/desktop/training', { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const names = ja ? { baseline:'基本版',changed:'変更版',fixed:'修正版' } : { baseline:'baseline',changed:'changed',fixed:'fixed' };
      status.textContent = (ja ? '研修環境の準備ができました：' : 'Training environment ready: ') + (names[data.mode] || data.mode);
      local.textContent = status.textContent;
    } catch(e) { status.textContent = e.message; local.textContent = e.message; }
    finally { controls.forEach(b => { b.disabled = false; }); }
  });
}
