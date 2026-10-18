import { REPORT_STORAGE } from '../domain/campaignConfig';
import { ZAP, type ZapEvidence } from '../domain/zap';
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const messageId = { type: 'string', pattern: '^[0-9]{1,16}$' };
export const zapSchema = object({ state: { enum: ['disabled', 'completed', 'incomplete', 'error'] },
  reason: { enum: ['disabled', 'none', 'queue_pending', 'message_missing', 'correlation_mismatch', 'limit', 'unavailable'] },
  sessionId: { type: ['string', 'null'], pattern: REPORT_STORAGE.uuidPattern },
  messageIds: { type: 'array', maxItems: 1, uniqueItems: true, items: messageId },
  alerts: { type: 'array', maxItems: ZAP.maximumAlerts, items: object({ fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' }, messageId, pluginId: messageId,
    risk: { type: 'integer', minimum: 0, maximum: 3 }, confidence: { type: 'integer', minimum: 0, maximum: 4 } }) } });
export function assertZapEvidence(value: ZapEvidence): void {
  if (value.state === 'completed') {
    if (!value.sessionId || value.reason !== 'none' || value.messageIds.length !== 1 || value.alerts.some(alert => !value.messageIds.includes(alert.messageId))) throw Error('Invalid ZAP correlation');
  } else if (value.alerts.length || value.messageIds.length || value.reason === 'none') throw Error('Unfinished ZAP evidence');
  if (value.state === 'disabled' && (value.sessionId !== null || value.reason !== 'disabled')) throw Error('Invalid disabled ZAP');
  if (new Set(value.alerts.map(alert => JSON.stringify(alert))).size !== value.alerts.length) throw Error('Duplicate ZAP alert');
}
