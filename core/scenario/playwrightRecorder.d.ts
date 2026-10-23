export class PlaywrightScenarioRecorder {
  constructor();
  status(): Record<string, unknown>;
  start(options: { siteId: string; includeInputValues?: unknown }): Promise<Record<string, unknown>>;
  stop(): Promise<Record<string, unknown>>;
}
