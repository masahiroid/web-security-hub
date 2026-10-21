import './siteManager.js';
import './pipeline.js';
import './replay.js';
import './caseEditor.js';
import './securityApp.js';
import { refreshSiteList } from './siteManager.js';
import { $ } from './dom.js';
import { initializeI18n } from './i18n.js';
document.querySelectorAll('nav.tabs button[data-tab]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('nav.tabs button[data-tab]').forEach((b) => b.classList.toggle('active', b === button)); document.querySelectorAll('main .panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${button.dataset.tab}`)); if (button.dataset.tab === 'replay') import('./replay.js').then(({ loadReplaySessions }) => loadReplaySessions()); }));
$('settingsBtn').addEventListener('click', async () => { $('settingsModal').hidden = false; const r = await fetch('/api/system-info'); $('systemInfoBody').textContent = JSON.stringify(await r.json(), null, 2); });
$('closeSettingsBtn').addEventListener('click', () => { $('settingsModal').hidden = true; });
refreshSiteList().catch(() => {});
initializeI18n().catch(() => {});

import "./workspace.js";

import "./help.js";

import "/generated/verifier/main.js";
import "/generated/genetic/main.js";

if (new URLSearchParams(location.search).get("workspace") === "verifier") document.querySelector("[data-tab=verifier]").click();

import "/generated/security/sourceBindingDemo.js";

import "/generated/security/sourceTargetControls.js";
