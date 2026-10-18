import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import * as contracts from '../../contracts';
import { createFixtureVerificationService, defaultRunOptions } from './fixtureService';
import { renderReport } from './reportHtml';
import { createVerificationJobs } from '../application/verificationJobs';
import { CAMPAIGN } from '../domain/campaignConfig';
import { HTTP_STATUS, LIMITS, TRANSPORT } from '../domain/config';
import { createSastSampleRoute } from './sastSampleRoute';
import { createZapRuntimeRoute } from './zapRuntimeRoute';
import { DATA_ROOT } from '../../../paths';
export const VERIFIER_API = Object.freeze({ base: '/api/verifier', session: '/session', sastSample: '/sast-sample', jobs: '/jobs', job: '/jobs/:jobId', cancel: '/jobs/:jobId/cancel', html: '/jobs/:jobId/report.html', cookie: 'wsh_verifier', tokenBytes: 32, cookieSuffixBytes: 8, sessions: 32, sessionTtlMs: 1_800_000 });
const remoteLoopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function createVerifierRouter({ applicationVersion, dataRoot }: { applicationVersion: string; dataRoot?: string }) {
  const router = express.Router();
  const jobs = createVerificationJobs(createFixtureVerificationService({ applicationVersion, ...(dataRoot === undefined ? {} : { dataRoot }) }), randomUUID);
  const sastSample = createSastSampleRoute({ dataRoot: dataRoot ?? DATA_ROOT, applicationVersion });
  const zapRuntime = createZapRuntimeRoute(dataRoot ?? DATA_ROOT);
  const sessions = new Map<string, number>();
  const cookieName = `${VERIFIER_API.cookie}_${randomBytes(VERIFIER_API.cookieSuffixBytes).toString('hex')}`;
  router.use((req, res, next) => {
    const host = req.headers.host;
    const allowedHost = TRANSPORT.loopbackHosts.some(name => host === `${name}:${req.socket.localPort}`);
    if (!allowedHost || !remoteLoopback.has(req.socket.remoteAddress ?? '') || req.headers.origin && req.headers.origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') return void res.sendStatus(HTTP_STATUS.forbidden);
    if (req.method !== 'GET' && req.headers.origin !== `http://${host}`) return void res.sendStatus(HTTP_STATUS.forbidden);
    res.set('Cache-Control', 'no-store'); next();
  });
  function cookie(req: express.Request) { return (req.headers.cookie ?? '').split(/;\s*/).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1); }
  router.get(VERIFIER_API.session, (req, res) => {
    const now = Date.now(); for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
    let token = cookie(req);
    if (!token || !sessions.has(token)) {
      if (sessions.size >= VERIFIER_API.sessions) return void res.sendStatus(HTTP_STATUS.capacity);
      token = randomBytes(VERIFIER_API.tokenBytes).toString('hex');
    }
    res.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', path: VERIFIER_API.base, maxAge: VERIFIER_API.sessionTtlMs });
    sessions.set(token, now + VERIFIER_API.sessionTtlMs);
    res.json({ defaults: defaultRunOptions(), limits: { candidates: CAMPAIGN.maximumCandidates, trials: CAMPAIGN.maximumTrials, ttlMs: CAMPAIGN.maximumTtlMs } });
  });
  router.use((req, res, next) => { const token = cookie(req); if (!token || (sessions.get(token) ?? 0) <= Date.now()) return void res.sendStatus(HTTP_STATUS.unauthorized); res.locals.verifierOwner = token; next(); });
  router.use(VERIFIER_API.sastSample, sastSample.router);
  router.use('/zap-runtime', zapRuntime.router);
  const owner = (res: express.Response): string => String(res.locals.verifierOwner);
  const jobId = (req: express.Request): string => req.params.jobId ?? '';
  router.post(VERIFIER_API.jobs, express.json({ limit: LIMITS.jsonPayloadBytes }), (req, res) => {
    let options;
    try { options = contracts.validate('runOptions', req.body as unknown); } catch { return void res.status(HTTP_STATUS.badRequest).json({ error: 'invalid_options' }); }
    try { res.status(HTTP_STATUS.ok).json(jobs.start(owner(res), options)); } catch { res.status(HTTP_STATUS.conflict).json({ error: 'busy' }); }
  });
  router.get(VERIFIER_API.job, (req, res) => { try { res.json(jobs.get(jobId(req), owner(res))); } catch { res.sendStatus(HTTP_STATUS.notFound); } });
  router.post(VERIFIER_API.cancel, (req, res) => { try { jobs.cancel(jobId(req), owner(res)); res.json({ accepted: true }); } catch { res.sendStatus(HTTP_STATUS.notFound); } });
  router.get(VERIFIER_API.html, (req, res) => {
    try {
      const report = jobs.get(jobId(req), owner(res)).report;
      if (!report) return void res.sendStatus(HTTP_STATUS.conflict);
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.set('Content-Disposition', `inline; filename="verification-${report.reportId}.html"`);
      res.type('html').send(renderReport(report));
    } catch { res.sendStatus(HTTP_STATUS.notFound); }
  });
  router.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(HTTP_STATUS.badRequest).json({ error: 'invalid_request' }); });
  return { router, close: async () => { await Promise.all([jobs.close(), sastSample.close(), zapRuntime.close()]); } };
}
