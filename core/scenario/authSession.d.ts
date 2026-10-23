export class AuthSessionCapture {
  constructor();
  status(): Record<string, unknown>;
  start(options: { siteId: string; startUrl: string | undefined }): Promise<Record<string, unknown>>;
  stop(): Promise<Record<string, unknown>>;
  cancel(): Promise<Record<string, unknown>>;
}
export function hasStorageState(siteId: string): boolean;
