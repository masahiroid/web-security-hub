import { CONTRACT_VERSION, FIXTURE } from './config';
import { CAMPAIGN, SCENARIO_IDS } from './campaignConfig';
import type { Scenario, ScenarioId } from './campaignTypes';
const route = (pattern: string) => pattern.replace(':id', CAMPAIGN.targetRecord);
export function fixtureScenarios(selection: ScenarioId | 'all'): readonly Scenario[] {
  const definitions: readonly Scenario[] = [
    { id: 'boundary', route: FIXTURE.routes.boundary, method: 'POST', baseSeed: { schemaVersion: CONTRACT_VERSION, seedId: 'boundary-base', values: { participants: FIXTURE.participantsMinimum, label: CAMPAIGN.baselineLabel }, omitFields: [], rationale: 'Valid fixture boundary control' }, normalProfileId: CAMPAIGN.owner, candidateProfiles: [CAMPAIGN.owner], allowedFields: ['participants', 'label'], expectedJson: { accepted: true } },
    { id: 'ownership', route: route(FIXTURE.routes.record), method: 'GET', baseSeed: { schemaVersion: CONTRACT_VERSION, seedId: 'ownership-base', values: {}, omitFields: [], rationale: 'Synthetic record ownership control' }, normalProfileId: CAMPAIGN.owner, candidateProfiles: FIXTURE.roles, allowedFields: [], expectedJson: { owner: CAMPAIGN.owner } },
    { id: 'workflow', route: route(FIXTURE.routes.complete), method: 'POST', baseSeed: { schemaVersion: CONTRACT_VERSION, seedId: 'workflow-base', values: {}, omitFields: [], rationale: 'Confirmed synthetic commit control' }, normalProfileId: CAMPAIGN.normalProfile, candidateProfiles: [CAMPAIGN.normalProfile, ...FIXTURE.roles], allowedFields: [], expectedJson: { completed: true } }
  ];
  return Object.freeze(definitions.filter(scenario => selection === 'all' ? SCENARIO_IDS.includes(scenario.id) : scenario.id === selection));
}
