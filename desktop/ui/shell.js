'use strict';
async function connect() {
  try {
    const state = await window.__TAURI__.core.invoke('backend_status');
    if (state.error) throw new Error(state.error);
    if (!state.url) { setTimeout(connect, 350); return; }
    // Top-level navigation avoids third-party-cookie restrictions in WebKit.
    window.location.replace(state.url);
  } catch (e) { document.getElementById('status').textContent = `起動できませんでした / Could not start\n${e.message || e}`; }
}
connect();
