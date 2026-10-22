/** OpenVEX 0.2.0 protocol vocabulary and bounded review policy. */
export const OPENVEX = Object.freeze({
  context: 'https://openvex.dev/ns/v0.2.0',
  statuses: Object.freeze(['not_affected', 'affected', 'fixed', 'under_investigation'] as const),
  justifications: Object.freeze(['component_not_present', 'vulnerable_code_not_present', 'vulnerable_code_not_in_execute_path',
    'vulnerable_code_cannot_be_controlled_by_adversary', 'inline_mitigations_already_exist'] as const),
  idPrefix: 'urn:uuid:',
});
export const VEX_LIMITS = Object.freeze({
  schemaVersion: 1,
  statementsPerDraft: 64, productsPerStatement: 16, evidencePerStatement: 16, draftsRetained: 64,
  nameCharacters: 128, textCharacters: 2_000, identityCharacters: 200, productIdCharacters: 512,
  namePattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$', sha256Pattern: '^[0-9a-f]{64}$', purlPrefix: 'pkg:',
  maximumBytes: 1_048_576,
});
export const VEX_STORAGE = Object.freeze({
  segments: Object.freeze(['artifacts', 'private', 'vex']), draftFile: 'draft.json', exportFile: 'openvex.json',
  directoryMode: 0o700, fileMode: 0o600, uuidPattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
});
export const VEX_TOOLING = 'Web Security Hub';
