import express from 'express';
import { randomUUID } from 'node:crypto';
import { HTTP_STATUS, LIMITS } from '../domain/config';
import { VEX_STORAGE } from '../domain/vexConfig';
import { VexRuleError } from '../domain/vexRules';
import { createVexReview } from '../application/vexReview';
import { createVexEvidenceCatalog } from './vexEvidence';
import { createVexStore } from './vexStore';
import type { VexReview } from '../application/vexReview';

const uuid = new RegExp(VEX_STORAGE.uuidPattern);
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VexRuleError('expected_object'); return value as Record<string, unknown>; }
/** Local review API. It sits behind the verifier session checks; nothing here sends data off this machine. */
export function createVexRoute({ dataRoot, review = createVexReview({ store: createVexStore(dataRoot), evidence: createVexEvidenceCatalog(dataRoot), now: () => new Date(), id: randomUUID }) }:
  { dataRoot: string; review?: VexReview }) {
  const router = express.Router();
  const json = express.json({ limit: LIMITS.jsonPayloadBytes });
  const param = (req: express.Request, name: string): string => { const value: unknown = req.params[name]; return typeof value === 'string' && uuid.test(value) ? value : ''; };
  const guard = (operation: (req: express.Request) => Promise<unknown>) => (req: express.Request, res: express.Response) => {
    operation(req).then(result => { if (!res.headersSent) res.json(result); }).catch((error: unknown) => {
      if (res.headersSent) return;
      if (error instanceof VexRuleError) return void res.status(error.code.endsWith('_not_found') ? HTTP_STATUS.notFound : HTTP_STATUS.invalidInput).json({ error: error.code });
      res.status(HTTP_STATUS.notFound).json({ error: 'not_found' });
    });
  };
  router.get('/evidence', guard(async () => ({ evidence: await review.listEvidence() })));
  router.post('/suggest', json, guard(async req => {
    const refs: unknown = record(req.body).evidence;
    if (!Array.isArray(refs)) throw new VexRuleError('evidence');
    return { status: await review.suggest(refs.map(ref => { const value = record(ref); return { kind: value.kind as 'sample', reportId: String(value.reportId) }; })) };
  }));
  router.get('/drafts', guard(async () => ({ drafts: await review.list() })));
  router.post('/drafts', json, guard(async req => { const body = record(req.body); return review.createDraft({ author: body.author, role: body.role }); }));
  router.get('/drafts/:draftId', guard(async req => review.get(param(req, 'draftId'))));
  router.post('/drafts/:draftId/statements', json, guard(async req => review.saveStatement(param(req, 'draftId'), record(req.body).statement)));
  router.post('/drafts/:draftId/statements/:statementId', json, guard(async req => review.saveStatement(param(req, 'draftId'), record(req.body).statement, param(req, 'statementId'))));
  router.post('/drafts/:draftId/statements/:statementId/delete', json, guard(async req => review.removeStatement(param(req, 'draftId'), param(req, 'statementId'))));
  router.post('/drafts/:draftId/approve', json, guard(async req => review.approve(param(req, 'draftId'), record(req.body).approver)));
  router.post('/drafts/:draftId/revise', json, guard(async req => review.revise(param(req, 'draftId'))));
  router.post('/drafts/:draftId/export', json, guard(async req => ({ document: (await review.exportDocument(param(req, 'draftId'))).document })));
  router.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(HTTP_STATUS.badRequest).json({ error: 'invalid_request' }); });
  return { router };
}
