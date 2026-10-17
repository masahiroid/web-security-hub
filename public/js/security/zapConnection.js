'use strict';
import { api } from '../api.js'; import { $ } from '../dom.js';
export function currentZapConfig() { return { enabled: $('useZap').checked, baseUrl: $('zapBaseUrl').value.trim(), proxyUrl: $('zapProxyUrl').value.trim() }; }
export function wireZapConnection() { $('checkZap').addEventListener('click', async () => { const status = $('zapStatus'); status.textContent = '確認中…'; try { const result = await api('/security/zap-status', { method: 'POST', body: JSON.stringify({ zap: currentZapConfig() }) }); status.textContent = `接続済み: ZAP ${result.version}`; } catch (error) { status.textContent = error.message; } }); }
