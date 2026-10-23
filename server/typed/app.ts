import express from 'express';
import { createVerifierRouter } from '../../core/verifier/generated/adapters/verifierRouter';
import { SERVER } from './config';
import { PACKAGE_INFO } from './packageInfo';
import { PUBLIC_DIRECTORY, TRAINING_DIRECTORY } from './paths';
import { createAiReviewRoutes } from './routes/aiReview';
import { createAuthSessionRoutes } from './routes/authSession';
import { createControlRoutes } from './routes/control';
import { createExploreRoutes } from './routes/explore';
import { createMobileRoutes } from './routes/mobile';
import { createPipelineRoutes } from './routes/pipeline';
import { createReplayRoutes } from './routes/replay';
import { createReportRoutes } from './routes/report';
import { createScenarioRecorderRoutes } from './routes/scenarioRecorder';
import { createSecurityRoutes } from './routes/security';
import { createSitesRoutes } from './routes/sites';
import { createStaticReportsRoutes } from './routes/staticReports';
import { createSystemInfoRoutes } from './routes/systemInfo';
import { createTestCasesRoutes } from './routes/testCases';
import { createTestGenerationRoutes } from './routes/testGeneration';

/** Builds the application: the verification API, every assessment API under /api, and the screens. */
export function createServerApp(): express.Express {
  const app = express();
  const verifier = createVerifierRouter({ applicationVersion: PACKAGE_INFO.version });
  app.use('/api/verifier', verifier.router);
  app.set('closeVerifier', verifier.close);
  app.use(express.json({ limit: SERVER.jsonLimit }));
  for (const routes of [createSitesRoutes, createSecurityRoutes, createTestGenerationRoutes, createPipelineRoutes, createReplayRoutes, createTestCasesRoutes,
    createReportRoutes, createAiReviewRoutes, createStaticReportsRoutes, createScenarioRecorderRoutes, createAuthSessionRoutes, createExploreRoutes,
    createMobileRoutes, createSystemInfoRoutes, createControlRoutes]) app.use('/api', routes());
  app.use('/training', express.static(TRAINING_DIRECTORY));
  app.use(express.static(PUBLIC_DIRECTORY));
  app.get('/', (_request, response) => { response.sendFile('index.html', { root: PUBLIC_DIRECTORY }); });
  return app;
}
/** The port from PORT when it is a valid port number, otherwise the default. */
export function resolvePort(value: string | undefined = process.env.PORT): number {
  const port = value === undefined || value === '' ? Number.NaN : Number(value);
  return Number.isInteger(port) && port >= 0 && port <= SERVER.maximumPort ? port : SERVER.defaultPort;
}
/** Listens on loopback only and exposes the listener so the stop and restart controls can close this exact server. */
export function startServer(app: express.Express, port: number = resolvePort()): void {
  const httpServer = app.listen(port, SERVER.host, () => { console.log(`Web Security Hub listening on http://localhost:${port}`); });
  app.set('httpServer', httpServer);
}
