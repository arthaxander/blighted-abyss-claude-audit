import fs from 'node:fs';
import path from 'node:path';
import { ENEMY_PORTRAITS, COMBAT_ART_FALLBACKS, applyCombatArtFallback } from '../data/combatAssets';
import { LEVEL_TWO_LOCATIONS, LEVEL_TWO_PROGRESSION, WITHERING_FOREST_NAME } from '../data/locations';
import { prepareLevelTwoDungeonRun, prepareLevelTwoSelection } from './dungeonRunState';
import { isStrongPoolAvailable } from './levelOneProgression';
import { resolveRoomWeights, ROOM_TYPES } from './roomGeneration';

const portraitKeys = ['petal_witch', 'elven_archer', 'thorn_guard', 'thicket_shadow', 'gnat_sower', 'amber_gnat', 'forest_reaper', 'owl_druid', 'bear_druid', 'crystal_splitter', 'defiled_predator', 'bloom_archon'];

test('boss descent preserves the expedition and starts an independent level-two room counter', () => {
  const player = { name: 'Герой', hp: 17, maxHp: 100, runSilver: 91, runInventory: [{ name: 'Зелье' }], equipment: { weapon: { name: 'Клинок' } }, relics: { activeRelicId: 'x' }, currentLocation: 'Гоблинские Норы', expeditionPhase: 'boss-defeated', bossClearId: 'reward-1', portalStone: { acquiredFrom: 'boss' }, currentEnemies: [{}], roomGenerationState: { 'Гоблинские Норы': { completedCombatRooms: 14 } } };
  const next = prepareLevelTwoSelection(player);
  expect(next).toMatchObject({ name: 'Герой', hp: 17, maxHp: 100, runSilver: 91, runInventory: player.runInventory, equipment: player.equipment, relics: player.relics, abyssLevel: 2, expeditionPhase: 'level-selection', currentLocation: null, portalStone: null });
  expect(next.currentEnemies).toBeUndefined();
  expect(next.roomGenerationState[WITHERING_FOREST_NAME].completedCombatRooms).toBe(0);
});

test('a legacy boss save receives a stable clear identity for subsequent saves', () => {
  const legacy = prepareLevelTwoSelection({ currentLocation: 'Грибные Пещеры', portalStone: { acquiredFrom: 'boss' }, roomGenerationState: {} });
  expect(legacy.bossClearId).toBe('legacy-boss:Грибные Пещеры');
});

test('all three level-II routes remain on the same expedition without healing or wiping inventory', () => {
  expect(LEVEL_TWO_LOCATIONS.map(({ id, enabled }) => [id, enabled])).toEqual([
    ['withering_forest', true],
    ['restless_ruins', true],
    ['mines_of_decay', true],
  ]);
  const selection = prepareLevelTwoSelection({ abyssLevel: 1, hp: 17, runInventory: [{ name: 'Зелье' }], equipment: { weapon: { name: 'Клинок' } }, currentLocation: 'Гоблинские Норы', expeditionPhase: 'boss-defeated', bossClearId: 'boss-1', roomGenerationState: {} });
  for (const { name } of LEVEL_TWO_LOCATIONS) {
    const next = prepareLevelTwoDungeonRun(selection, name);
    expect(next).toMatchObject({ abyssLevel: 2, expeditionPhase: 'exploring', currentLocation: name, hp: 17, runInventory: selection.runInventory, equipment: selection.equipment });
    expect(next.expeditionMap.mainLayout.locationId).toBe(name);
    expect(next.roomGenerationState[name].completedCombatRooms).toBe(0);
    expect(prepareLevelTwoSelection({ ...next, expeditionPhase: 'boss-defeated' })).toBeNull();
  }
});

test('the existing 7/14 rules are level-local and do not expose an early boss', () => {
  expect(isStrongPoolAvailable(6, LEVEL_TWO_PROGRESSION)).toBe(false);
  expect(isStrongPoolAvailable(7, LEVEL_TWO_PROGRESSION)).toBe(true);
  expect(resolveRoomWeights({ state: { completedCombatRooms: 13, hasBossEnemy: true, progressionTuning: LEVEL_TWO_PROGRESSION } })[ROOM_TYPES.BOSS] || 0).toBe(0);
  expect(resolveRoomWeights({ state: { completedCombatRooms: 14, hasBossEnemy: true, progressionTuning: LEVEL_TWO_PROGRESSION } })[ROOM_TYPES.BOSS]).toBeGreaterThan(0);
});

test('all twelve forest portraits resolve to existing public WebP files and retain fallback handling', () => {
  expect(LEVEL_TWO_LOCATIONS).toHaveLength(3);
  portraitKeys.forEach(key => {
    expect(ENEMY_PORTRAITS[key]).toBe(`/assets/combat/portraits/enemies/withering_forest/${key}.webp`);
    expect(ENEMY_PORTRAITS[key]).not.toContain('/public/');
    expect(fs.existsSync(path.join('public', ENEMY_PORTRAITS[key]))).toBe(true);
  });
  const image = document.createElement('img');
  applyCombatArtFallback({ currentTarget: image }, COMBAT_ART_FALLBACKS.enemy);
  expect(image.src).toContain('/assets/combat/fallbacks/enemy.webp');
});
