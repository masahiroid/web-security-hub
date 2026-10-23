export interface MobileDriver { readonly [key: string]: unknown }
export class MobileSession {
  constructor(options: { platform: 'ios' | 'android'; deviceName: string; platformVersion: string | undefined; app: string | undefined; bundleId: string | undefined; log: (line: string) => void });
  start(): Promise<MobileDriver>;
  stop(): Promise<void>;
}
