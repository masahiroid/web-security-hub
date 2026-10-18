import express from 'express';
import { HTTP_STATUS, LIMITS } from '../domain/config';
import { runSastFixture } from './sastFixtureService';
import { DATA_ROOT } from '../../../paths';
import { randomUUID } from 'node:crypto';
import { validate } from '../../contracts';
import { createSourceReportStore } from './sourceReportStore';
import { renderSourceReport } from './sourceReportHtml';
import { runSourceTarget } from './sourceTargetService';
import { SOURCE_TRIAL } from '../domain/sourceBinding';
import { CONTRACT_VERSION } from '../domain/config';

/** One finite sample at a time; disconnect and shutdown cancel its owned runtime. */
export function createSastSampleRoute({ run = runSastFixture, dataRoot = DATA_ROOT, applicationVersion = 'development' }: { run?: typeof runSastFixture; dataRoot?: string; applicationVersion?: string } = {}) {
  let active: { controller: AbortController; completion: Promise<void> } | undefined;
  let closing = false;
  const router = express.Router();
  const store = createSourceReportStore(dataRoot); const owners = new Map<string, string>();
  async function save(result: Awaited<ReturnType<typeof runSastFixture>>, res: express.Response) {
    const report = validate('sourceReport', { ...result, schemaVersion: CONTRACT_VERSION, applicationVersion, reportId: randomUUID(), createdAt: new Date().toISOString() });
    await store.save(report); owners.set(report.reportId, String(res.locals.verifierOwner));
    while (owners.size > SOURCE_TRIAL.retainedReports) { const first = owners.keys().next().value; if (first) owners.delete(first); }
    return report;
  }
  function start(res: express.Response, operation: (signal: AbortSignal) => ReturnType<typeof runSastFixture>, error: string) {
    if (active || closing) { res.status(HTTP_STATUS.conflict).json({ error: 'busy' }); return; }
    const controller = new AbortController(); const cancel = () => controller.abort();
    res.once('close', cancel); const task = { controller, completion: Promise.resolve() }; active = task;
    task.completion = Promise.resolve().then(() => operation(controller.signal)).then(result => save(result, res))
      .then(result => { if (!res.destroyed) res.json(result); })
      .catch(() => { if (!res.destroyed) res.status(HTTP_STATUS.conflict).json({ error }); })
      .finally(() => { res.removeListener('close', cancel); if (active === task) active = undefined; });
  }
  router.post('/', express.json({ limit: LIMITS.jsonPayloadBytes }), (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'useZap') || 'useZap' in body && typeof body.useZap !== 'boolean') {
      res.status(HTTP_STATUS.badRequest).json({ error: 'invalid_options' }); return;
    }
    start(res, signal => run(signal, { dataRoot, useZap: 'useZap' in body && body.useZap === true }), 'sample_incomplete');
  });
  router.post('/target', express.json({ limit: LIMITS.jsonPayloadBytes }), (req, res) => {
    let options;
    try { options = validate('sourceTrialOptions', req.body as unknown); }
    catch { return void res.status(HTTP_STATUS.badRequest).json({ error: 'invalid_options' }); }
    start(res, signal => runSourceTarget(options, dataRoot, signal), 'verification_incomplete');
  });
  router.get('/reports/:reportId/:format', async (req, res) => {
    const id = req.params.reportId ?? ''; const format = req.params.format;
    if (!owners.has(id) || owners.get(id) !== String(res.locals.verifierOwner) || !['report.json', 'report.html'].includes(format ?? '')) return void res.sendStatus(HTTP_STATUS.notFound);
    try {
      const report = await store.read(id);
      if (format === 'report.json') res.json(report);
      else { res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'"); res.type('html').send(renderSourceReport(report)); }
    } catch { res.sendStatus(HTTP_STATUS.notFound); }
  });
  return { router, async close() { closing = true; active?.controller.abort(); await active?.completion; } };
}
