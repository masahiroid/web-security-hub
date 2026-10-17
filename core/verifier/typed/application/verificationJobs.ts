import type { Progress, Report, RunOptions, SavedReport } from '../domain/campaignTypes';
import { JOB_LIMITS } from '../domain/campaignConfig';
export interface JobView { readonly jobId: string; readonly state: 'running' | 'finished' | 'failed'; readonly progress: Progress | null; readonly report: Report | null }
export interface VerificationService { run(options: RunOptions, controls: { signal: AbortSignal; onProgress: (progress: Progress) => undefined }): Promise<{ report: Report; saved: SavedReport }> }
interface Job { readonly owner: string; readonly controller: AbortController; readonly view: { jobId: string; state: JobView['state']; progress: Progress | null; report: Report | null }; completion: Promise<void> }
export function createVerificationJobs(service: VerificationService, createId: () => string) {
  const jobs = new Map<string, Job>();
  let closing = false;
  const owned = (id: string, owner: string) => { const job = jobs.get(id); if (!job || job.owner !== owner) throw Error('Unknown verification job'); return job; };
  return {
    start(owner: string, options: RunOptions): JobView {
      if (closing || [...jobs.values()].filter(job => job.view.state === 'running').length >= JOB_LIMITS.active) throw Error('Verifier busy');
      while (jobs.size >= JOB_LIMITS.retained) {
        const oldest = [...jobs].find(([, job]) => job.view.state !== 'running');
        if (!oldest) throw Error('Verifier busy'); jobs.delete(oldest[0]);
      }
      const jobId = createId(); const controller = new AbortController();
      const view: Job['view'] = { jobId, state: 'running', progress: null, report: null };
      const job: Job = { owner, controller, view, completion: Promise.resolve() }; jobs.set(jobId, job);
      job.completion = service.run(options, { signal: controller.signal, onProgress: progress => { view.progress = progress; } })
        .then(result => { view.report = result.report; view.state = 'finished'; })
        .catch(() => { view.state = 'failed'; });
      return Object.freeze({ ...view });
    },
    get(id: string, owner: string): JobView { return Object.freeze({ ...owned(id, owner).view }); },
    cancel(id: string, owner: string): void { owned(id, owner).controller.abort(); },
    async close() { closing = true; for (const job of jobs.values()) job.controller.abort(); await Promise.allSettled([...jobs.values()].map(job => job.completion)); }
  };
}
