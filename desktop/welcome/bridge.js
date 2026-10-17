'use strict';
// Keep report/manual links inside the desktop content area; the native Home
// navigation remains available even after visiting a report or a sample page.
document.addEventListener('click', event => {
  const link = event.target.closest('a[target="_blank"]');
  if (link && new URL(link.href).origin === location.origin) link.removeAttribute('target');
}, true);

window.addEventListener('load', async () => {
  const fixture = new URLSearchParams(location.search).get('trainingScan');
  if (!['before','after'].includes(fixture)) return;
  const response = await fetch('/api/desktop/paths');
  if (!response.ok) return;
  const paths = await response.json();
  document.querySelector('[data-tab="static"]').click();
  document.getElementById('sourceDir').value = fixture === 'before' ? paths.sourceBefore : paths.sourceAfter;
}, { once: true });

const home = document.createElement('a');
home.href = '/welcome'; home.textContent = '← ホーム / Home';
home.className = 'desktop-home';
document.body.prepend(home);
