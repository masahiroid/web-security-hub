import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ZAP, ZAP_RISK, ZAP_CONFIDENCE, zapUnavailable, type ZapAlert, type ZapEvidence, type ZapPort } from '../domain/zap';
import { correlateZapMessage } from '../domain/zapCorrelation';
import { jsonObject, zapCount, type ZapApi } from './zapApi';

/** API reads only; it never resets sessions, removes alerts or starts active scans. */
export function createZapEvidence(api: ZapApi, proxy: string, sessionId: string): ZapPort {
  return { proxy, async collect(observation, input, signal): Promise<ZapEvidence> {
    if (!observation.dispatched || observation.outcome !== 'completed') return zapUnavailable('incomplete', 'unavailable', sessionId);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(ZAP.passiveMs)]);
    try {
      while (zapCount((await api.get(ZAP.endpoints.queue, {}, bounded)).recordsToScan)) await delay(ZAP.pollMs, undefined, { signal: bounded });
      const count = zapCount((await api.get(ZAP.endpoints.messageCount, {}, bounded)).numberOfMessages);
      if (count > ZAP.maximumMessages) return zapUnavailable('incomplete', 'limit', sessionId);
      const messages = (await api.get(ZAP.endpoints.messages, { start: '0', count: String(ZAP.maximumMessages) }, bounded)).messages;
      if (!Array.isArray(messages) || messages.length > ZAP.maximumMessages) throw Error('Invalid message list');
      const ids: string[] = [];
      for (const item of messages as unknown[]) {
        const message = jsonObject(item);
        if (zapCount(message.type) === ZAP.temporaryHistoryType) continue;
        if (zapCount(message.type) !== ZAP.proxyHistoryType) continue;
        if (typeof message.requestHeader !== 'string') throw Error('Missing message header');
        const match = correlateZapMessage(message.requestHeader, observation, input);
        if (match === 'invalid') return zapUnavailable('incomplete', 'correlation_mismatch', sessionId);
        if (match === 'match') ids.push(String(zapCount(message.id)));
      }
      if (ids.length !== 1) return zapUnavailable('incomplete', ids.length ? 'correlation_mismatch' : 'message_missing', sessionId);
      const alertCount = zapCount((await api.get(ZAP.endpoints.alertCount, {}, bounded)).numberOfAlerts);
      if (alertCount > ZAP.maximumAlerts) return zapUnavailable('incomplete', 'limit', sessionId);
      const raw = (await api.get(ZAP.endpoints.alerts, { start: '0', count: String(ZAP.maximumAlerts) }, bounded)).alerts;
      if (!Array.isArray(raw) || raw.length > ZAP.maximumAlerts) throw Error('Invalid alert list');
      const alerts: ZapAlert[] = []; const seen = new Set<string>();
      for (const item of raw as unknown[]) {
        let alert = jsonObject(item);
        if (alert.messageId === undefined) alert = jsonObject((await api.get(ZAP.endpoints.alert, { id: String(zapCount(alert.id)) }, bounded)).alert);
        const messageId = String(zapCount(alert.messageId)); if (!ids.includes(messageId)) continue;
        const pluginId = String(zapCount(alert.pluginId)); const risk = typeof alert.risk === 'string' && Object.hasOwn(ZAP_RISK, alert.risk) ? ZAP_RISK[alert.risk]! : zapCount(alert.riskcode);
        const confidence = typeof alert.confidence === 'string' && Object.hasOwn(ZAP_CONFIDENCE, alert.confidence) ? ZAP_CONFIDENCE[alert.confidence]! : zapCount(alert.confidence);
        if (risk > 3 || confidence > 4) throw Error('Invalid alert rank');
        // Do not expose parameter values, URLs, bodies or alert evidence strings.
        const fingerprint = createHash('sha256').update(JSON.stringify([messageId, pluginId, risk, confidence, String(alert.alertRef ?? ''), String(alert.param ?? '')])).digest('hex');
        if (!seen.has(fingerprint)) { seen.add(fingerprint); alerts.push(Object.freeze({ fingerprint, messageId, pluginId, risk, confidence })); }
      }
      if (zapCount((await api.get(ZAP.endpoints.queue, {}, bounded)).recordsToScan)) return zapUnavailable('incomplete', 'queue_pending', sessionId);
      return Object.freeze({ state: 'completed', reason: 'none', sessionId, messageIds: Object.freeze(ids), alerts: Object.freeze(alerts) });
    } catch { return zapUnavailable(bounded.aborted ? 'incomplete' : 'error', bounded.aborted ? 'queue_pending' : 'unavailable', sessionId); }
  } };
}
