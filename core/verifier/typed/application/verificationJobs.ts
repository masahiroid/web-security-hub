import type { Progress, Report, RunOptions, SavedReport } from '../domain/campaignTypes';
import { JOB_LIMITS } from '../domain/campaignConfig';
export interface JobView<R = Report, P = Progress> { readonly jobId: string; readonly state: 'running' | 'finished' | 'failed'; readonly progress: P | null; readonly report: R | null }
export interface JobService<O, R, P> { run(options: O, controls: { signal: AbortSignal; onProgress: (progress: P) => undefined }): Promise<{ report: R; saved: unknown }> }
export type VerificationService = JobService<RunOptions, Report, Progress> & { run(options: RunOptions, controls: { signal: AbortSignal; onProgress: (progress: Progress) => undefined }): Promise<{ report: Report; saved: SavedReport }> };
interface Job<R, P> { readonly owner: string; readonly controller: AbortController; readonly view: { jobId: string; state: JobView<R, P>['state']; progress: P | null; report: R | null }; completion: Promise<void> }
/** Owner-scoped, bounded background jobs; the service decides what a job runs and reports. */
export function createVerificationJobs<O = RunOptions, R = Report, P = Progress>(service: JobService<O, R, P>, createId: () => string) {
  const jobs = new Map<string, Job<R, P>>();
  let closing = false;
  const owned = (id: string, owner: string) => { const job = jobs.get(id); if (!job || job.owner !== owner) throw Error('Unknown verification job'); return job; };
  return {
    start(owner: string, options: O): JobView<R, P> {
      if (closing || [...jobs.values()].filter(job => job.view.state === 'running').length >= JOB_LIMITS.active) throw Error('Verifier busy');
      while (jobs.size >= JOB_LIMITS.retained) {
        const oldest = [...jobs].find(([, job]) => job.view.state !== 'running');
        if (!oldest) throw Error('Verifier busy'); jobs.delete(oldest[0]);
      }
      const jobId = createId(); const controller = new AbortController();
      const view: Job<R, P>['view'] = { jobId, state: 'running', progress: null, report: null };
      const job: Job<R, P> = { owner, controller, view, completion: Promise.resolve() }; jobs.set(jobId, job);
      job.completion = service.run(options, { signal: controller.signal, onProgress: progress => { view.progress = progress; } })
        .then(result => { view.report = result.report; view.state = 'finished'; })
        .catch(() => { view.state = 'failed'; });
      return Object.freeze({ ...view });
    },
    get(id: string, owner: string): JobView<R, P> { return Object.freeze({ ...owned(id, owner).view }); },
    cancel(id: string, owner: string): void { owned(id, owner).controller.abort(); },
    async close() { closing = true; for (const job of jobs.values()) job.controller.abort(); await Promise.allSettled([...jobs.values()].map(job => job.completion)); }
  };
}
