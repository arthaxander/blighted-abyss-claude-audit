import { DEFAULT_RELIC_ID, RELIC_DEFINITIONS, ensureRelicState, grantAllRelics } from './relics';

describe('canonical relic discovery', () => {
  test('fresh state discovers only Recruit Seal', () => {
    expect(ensureRelicState()).toEqual({
      activeRelicId: DEFAULT_RELIC_ID,
      discoveredRelicIds: [DEFAULT_RELIC_ID],
      progress: { [DEFAULT_RELIC_ID]: { level: 1, xp: 0 } },
    });
  });

  test('a discovered level-zero relic does not require a progress record', () => {
    const state = ensureRelicState({ discoveredRelicIds: ['blood_amulet'] });
    expect(state.discoveredRelicIds).toEqual([DEFAULT_RELIC_ID, 'blood_amulet']);
    expect(state.progress.blood_amulet).toBeUndefined();
  });

  test('explicit discovery survives normalization with progress and active relic', () => {
    const saved = { activeRelicId: 'blood_amulet', discoveredRelicIds: ['ritual_blade', 'blood_amulet'], progress: { ritual_blade: { level: 2, xp: 37 } } };
    const hydrated = ensureRelicState(JSON.parse(JSON.stringify(saved)));
    expect(hydrated.activeRelicId).toBe('blood_amulet');
    expect(hydrated.discoveredRelicIds).toEqual(expect.arrayContaining([DEFAULT_RELIC_ID, 'ritual_blade', 'blood_amulet']));
    expect(hydrated.progress.ritual_blade).toEqual({ level: 2, xp: 37 });
  });

  test('old progress keys and active relic migrate to discovery', () => {
    const migrated = ensureRelicState({ activeRelicId: 'blood_amulet', progress: { ritual_blade: { level: 1, xp: 8 } } });
    expect(migrated.discoveredRelicIds).toEqual(expect.arrayContaining([DEFAULT_RELIC_ID, 'ritual_blade', 'blood_amulet']));
    expect(migrated.progress.ritual_blade).toEqual({ level: 1, xp: 8 });
  });

  test('grant-all discovers every authored relic without fabricating progress', () => {
    const granted = grantAllRelics();
    expect(granted.discoveredRelicIds).toEqual(RELIC_DEFINITIONS.map(relic => relic.id));
    expect(granted.discoveredRelicIds).toHaveLength(19);
    expect(Object.keys(granted.progress)).toEqual([DEFAULT_RELIC_ID]);
  });
});

test('unknown active relic safely normalizes to Recruit Seal', () => {
  const normalized = ensureRelicState({ activeRelicId: 'removed_relic', discoveredRelicIds: ['blood_amulet'] });
  expect(normalized.activeRelicId).toBe(DEFAULT_RELIC_ID);
  expect(normalized.discoveredRelicIds).toEqual([DEFAULT_RELIC_ID, 'blood_amulet']);
});
