import type { MobileDriver } from './mobileSession';
export function runMobileSteps(driver: MobileDriver, steps: readonly unknown[], context: { siteId: string; sessionId: string; onProgress: (line: string) => void }): Promise<unknown>;
