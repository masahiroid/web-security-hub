import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { request, type APIRequestContext } from 'playwright';
import { CONTRACT_VERSION, HTTP_STATUS, LIMITS, TRANSPORT } from '../domain/config';
import type { ContractsPort, Handle, Method, Observation, Profile, Reason, RegistryPort, TrialGrant, TrialRequest, Values } from '../domain/types';
import { routeAt } from './catalog';
export interface HttpTrialOptions { registry: RegistryPort; contracts: ContractsPort; handle: Handle; input: TrialRequest; profile: Profile; purpose: Observation['purpose']; timeoutMs: number; grant: TrialGrant }
// One responsibility: execute and close one isolated HTTP transport context.
export async function executeHttpTrial({ registry, contracts, handle, input, profile, purpose, timeoutMs, grant }: HttpTrialOptions) {
  const started = performance.now();
  const record: Observation = { schemaVersion: CONTRACT_VERSION, jobId: handle.jobId, trialId: grant.trialId, requestId: randomUUID(), seedId: grant.seed.seedId, authProfileId: input.authProfileId, purpose, executionKind: 'direct-http', outcome: 'error', reason: 'transport_error', status: null, durationMs: 0, dispatched: false, setupRequests: 0, redirect: 'none' };
  let context: APIRequestContext | undefined;
  let closePromise: Promise<void> | undefined;
  let stopReason: Reason | undefined;
  let body: unknown = null;
  let requestTimeoutReason: Reason = 'trial_timeout';
  function close() {
    if (context && !closePromise) closePromise = context.dispose({ reason: 'Verifier trial finished' });
    closePromise?.catch(() => {});
    return closePromise;
  }
  function stop(reason: Reason) { stopReason ??= reason; close(); }
  function jobAborted() {
    let state: string;
    try { state = registry.status(handle).state; } catch { state = 'disposed'; }
    stop(state === 'cancelled' ? 'job_cancelled' : state === 'disposed' ? 'job_disposed' : 'job_expired');
  }
  grant.signal.addEventListener('abort', jobAborted, { once: true });
  const timer = setTimeout(() => stop('trial_timeout'), timeoutMs);
  function assertRunning() {
    if (grant.signal.aborted && !stopReason) jobAborted();
    if (stopReason) throw Error('Trial interrupted');
  }
  async function send(url: string, method: Method, values: Values, headers: Record<string, string>) {
    assertRunning();
    const trialRemaining = timeoutMs - (performance.now() - started);
    const jobRemaining = grant.expiresAt - Date.now();
    requestTimeoutReason = jobRemaining <= trialRemaining ? 'job_expired' : 'trial_timeout';
    const remaining = Math.min(trialRemaining, jobRemaining);
    if (remaining <= 0) { stop(requestTimeoutReason); assertRunning(); }
    if (!context) throw Error('Request context missing');
    return context.fetch(url, {
      method, ...(method === 'GET'
        ? { params: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])), headers }
        : { data: JSON.stringify(values), headers: { 'Content-Type': TRANSPORT.jsonContentType, ...headers } }),
      maxRedirects: TRANSPORT.maxRedirects, maxRetries: TRANSPORT.maxRetries, failOnStatusCode: false, timeout: remaining
    });
  }
  try {
    assertRunning();
    context = await request.newContext({ ignoreHTTPSErrors: false });
    assertRunning();
    for (const step of profile.setup) {
      record.setupRequests++;
      const response = await send(routeAt(profile.origin, step.route), step.method, step.values, {});
      const status = response.status(); await response.dispose();
      if (status !== step.expectedStatus) { record.reason = 'setup_failed'; throw Error('Setup failed'); }
    }
    assertRunning(); record.dispatched = true;
    const correlation = Object.fromEntries(Object.entries(TRANSPORT.headers).map(([field, header]) => [header, record[field as keyof typeof TRANSPORT.headers]]));
    const response = await send(input.url, input.method, grant.seed.values, correlation);
    record.status = response.status();
    const location = response.headers().location;
    if (record.status >= HTTP_STATUS.redirectMinimum && record.status < HTTP_STATUS.redirectLimit && location) {
      record.redirect = 'blocked'; record.reason = 'redirect_outside_scope';
      try { registry.assertRedirect(handle, new URL(location, input.url).href); record.redirect = 'not_followed'; record.reason = 'redirect_not_followed'; }
      catch { /* Never follow or disclose a redirect URL. */ }
    } else {
      const buffer = await response.body();
      if (buffer.length > LIMITS.responseInspectionBytes) record.reason = 'response_too_large';
      else {
        try { body = JSON.parse(buffer.toString('utf8')) as unknown; } catch { /* Non-JSON is still an HTTP observation. */ }
        record.outcome = 'completed'; record.reason = 'none';
      }
    }
    await response.dispose(); assertRunning();
  } catch (error: unknown) {
    if (!stopReason && error instanceof Error && error.name === 'TimeoutError') stop(requestTimeoutReason);
  } finally {
    clearTimeout(timer); grant.signal.removeEventListener('abort', jobAborted);
    try { await close(); } catch { record.outcome = 'error'; record.reason = 'cleanup_failed'; }
    if (stopReason) { record.reason = stopReason; record.outcome = ['trial_timeout', 'job_expired'].includes(stopReason) ? 'timeout' : 'cancelled'; }
    record.durationMs = Math.max(0, performance.now() - started);
  }
  return { observation: contracts.validate('httpObservation', record), body, signal: grant.signal, expiresAt: grant.expiresAt };
}
