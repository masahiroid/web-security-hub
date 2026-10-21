import express from 'express';
import { randomBytes } from 'node:crypto';
import { FIXTURE, HTTP_STATUS, LIMITS, POINTS } from '../domain/config';
import { GENETIC_FIXTURE } from '../domain/geneticFixtureConfig';
import { compoundOracle } from '../domain/compoundOracle';
import { createFixtureLedger } from './fixtureLedger';
import { sourceFingerprint, sourceFingerprintSync } from './sourceFingerprint';
import type { Mode } from '../domain/campaignTypes';
import type { FixtureInstance } from './fixtureRuntime';

const SOURCE_FILES = Object.freeze([
  { name: 'compound-fixture', file: __filename },
  ...['../domain/config', '../domain/geneticConfig', '../domain/geneticGenome', '../domain/geneticFixtureConfig',
    '../domain/compoundOracle', './fixtureLedger', './sourceFingerprint'].map(name => ({ name, file: require.resolve(name) })),
]);
const loadedDigest = sourceFingerprintSync(SOURCE_FILES);
export interface CompoundFixture extends FixtureInstance { businessState(): Readonly<{ ownerCommits: number; guestCommits: number }> }
export interface CompoundFixtureOptions { readonly initialMode: Mode; readonly instrumentation?: boolean; readonly evidenceCapacity?: number }
/** Isolated synthetic fixture. Never mounted by the public or desktop application. */
export function createCompoundFixture({ initialMode, instrumentation = true, evidenceCapacity }: CompoundFixtureOptions): CompoundFixture {
  if (!FIXTURE.modes.includes(initialMode)) throw Error('Invalid compound mode');
  const app = express();
  const sessions = new Map<string, string>();
  let ownerCommits = 0; let guestCommits = 0;
  const ledger = createFixtureLedger({ sourceDigest: loadedDigest, instrumentation, ...(evidenceCapacity === undefined ? {} : { capacity: evidenceCapacity }) });
  app.use((req, res, next) => {
    if (req.headers.host !== `${FIXTURE.host}:${req.socket.localPort}` || req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return void res.sendStatus(HTTP_STATUS.forbidden);
    res.set('Cache-Control', 'no-store');
    res.once('finish', () => ledger.finish(req.headers));
    next();
  });
  app.use(express.json({ limit: LIMITS.jsonPayloadBytes }));
  app.post(GENETIC_FIXTURE.sessionRoute, (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || !('profile' in body) ||
        body.profile !== GENETIC_FIXTURE.owner && body.profile !== GENETIC_FIXTURE.guest) return void res.sendStatus(HTTP_STATUS.badRequest);
    if (sessions.size >= FIXTURE.sessionCapacity) return void res.sendStatus(HTTP_STATUS.capacity);
    const token = randomBytes(FIXTURE.sessionTokenBytes).toString('hex');
    sessions.set(token, body.profile);
    res.cookie(GENETIC_FIXTURE.cookie, token, { httpOnly: true, sameSite: 'strict' }).json({ profile: body.profile });
  });
  app.post(GENETIC_FIXTURE.route, (req, res) => {
    const token = (req.headers.cookie ?? '').split(/;\s*/).find(part => part.startsWith(`${GENETIC_FIXTURE.cookie}=`))?.slice(GENETIC_FIXTURE.cookie.length + 1);
    const actor = token ? sessions.get(token) ?? FIXTURE.anonymous : FIXTURE.anonymous;
    const body: unknown = req.body;
    const value = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const valid = GENETIC_FIXTURE.fields.every(field => {
      const entry: unknown = Reflect.get(value, field);
      return typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= GENETIC_FIXTURE.maximumValue;
    }) && Object.keys(value).length === GENETIC_FIXTURE.fields.length;
    const x = valid && Reflect.get(value, 'x') === GENETIC_FIXTURE.challenge.x;
    const y = x && Reflect.get(value, 'y') === GENETIC_FIXTURE.challenge.y;
    const z = y && Reflect.get(value, 'z') === GENETIC_FIXTURE.challenge.z;
    // Only the intentionally changed variant omits authorization after the synthetic challenge.
    const committed = valid && (actor === GENETIC_FIXTURE.owner || actor === GENETIC_FIXTURE.guest && initialMode === FIXTURE.changedMode && z);
    const trace = (point: Parameters<typeof ledger.record>[1], commit = false) => ledger.record(req.headers, point, actor, null, compoundOracle(actor, commit), initialMode);
    // Mutate the synthetic business state before emitting any commit evidence.
    if (committed) { if (actor === GENETIC_FIXTURE.owner) ownerCommits++; else guestCommits++; }
    if (x) trace(POINTS.boundary);
    if (y) trace(POINTS.confirm);
    if (committed) trace(POINTS.commit, true);
    else if (!x) trace(POINTS.blocked);
    res.status(committed ? HTTP_STATUS.ok : HTTP_STATUS.invalidInput).json({ accepted: committed, completed: committed, confirmed: y });
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(HTTP_STATUS.badRequest).json({ error: 'Invalid compound request' }); });
  return { app, sourceDigest: loadedDigest, businessState: () => Object.freeze({ ownerCommits, guestCommits }),
    currentSourceDigest: signal => sourceFingerprint(SOURCE_FILES, signal), readEvidence: correlation => ledger.read(correlation) };
}
