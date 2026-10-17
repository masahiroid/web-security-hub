import { CONTRACT_VERSION, FIXTURE, HTTP_STATUS } from '../domain/config';
import { CAMPAIGN } from '../domain/campaignConfig';
import type { Scenario, ScenarioCatalog } from '../domain/campaignTypes';
export function fixtureCatalog(scenario: Scenario, origin: string): ScenarioCatalog {
  const session = (profile: string) => ({ route: FIXTURE.routes.session, method: 'POST' as const, values: { profile }, expectedStatus: HTTP_STATUS.ok });
  const profiles = [
    ...FIXTURE.roles.map(profileId => ({ schemaVersion: CONTRACT_VERSION, profileId, origin, setup: [session(profileId)] })),
    { schemaVersion: CONTRACT_VERSION, profileId: CAMPAIGN.normalProfile, origin, setup: [session(CAMPAIGN.owner), { route: FIXTURE.routes.confirm.replace(':id', CAMPAIGN.targetRecord), method: 'POST' as const, values: {}, expectedStatus: HTTP_STATUS.ok }] }
  ];
  return { profiles, control: { schemaVersion: CONTRACT_VERSION, origin, route: scenario.route, method: scenario.method, seed: scenario.baseSeed, authProfileId: scenario.normalProfileId, expectedStatus: HTTP_STATUS.ok, expectedJson: scenario.expectedJson } };
}
