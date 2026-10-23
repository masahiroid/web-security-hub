import type { RunnerConfig } from '../siteConfig';
import type { JsonStore } from '../store/jsonStore';
export function runFormGeneration(config: RunnerConfig, store: JsonStore, log: (line: string) => void): Promise<Record<string, unknown>>;
