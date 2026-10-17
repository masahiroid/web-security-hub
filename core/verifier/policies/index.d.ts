import type { CampaignRegistry } from '../typed/domain/campaignTypes';
export function createRegistry(options: { roots: Readonly<Record<string, string>>; authProfileIds: readonly string[]; now?: () => number }): CampaignRegistry;
