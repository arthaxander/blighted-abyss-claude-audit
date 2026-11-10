import { enemies } from '../data/enemies';
import { getTrashEnemyPool } from './enemyPools';
import { generateRoomChoices, ROOM_TYPES } from './roomGeneration';
import { isStrongEnemy, LEVEL_ONE_TUNINGS, PRODUCTION_LEVEL_ONE_TUNING } from './levelOneProgression';

const location = 'Гоблинские Норы';
const locationEnemies = enemies.filter(enemy => enemy.location === location && !enemy.boss);
const bossEnemy = enemies.find(enemy => enemy.location === location && enemy.boss);

describe('level-one progression contract', () => {
  test.each([0, 1, 6])('production excludes strong enemies after %i completed combats', completedCombatRooms => {
    const pool = getTrashEnemyPool({ nonBossEnemies: locationEnemies, selectedLocation: location, completedCombatRooms });
    expect(pool.some(isStrongEnemy)).toBe(false);
  });

  test('the eighth combat may use the full authored pool', () => {
    const pool = getTrashEnemyPool({ nonBossEnemies: locationEnemies, selectedLocation: location, completedCombatRooms: 7 });
    expect(pool.some(isStrongEnemy)).toBe(true);
  });

  test('boss is impossible before 14 and eligible in the next choice window', () => {
    const context = completedCombatRooms => ({ locationName: location, state: { completedCombatRooms }, rng: () => 0, bossEnemy, hasBossEnemy: true, buildFightEncounter: () => ({ enemies: [] }) });
    expect(generateRoomChoices(context(13)).choices.some(choice => choice.roomType === ROOM_TYPES.BOSS)).toBe(false);
    expect(generateRoomChoices(context(14)).choices.some(choice => choice.roomType === ROOM_TYPES.BOSS)).toBe(true);
  });

  test('legacy tuning remains a distinct simulator-only configuration', () => {
    expect(PRODUCTION_LEVEL_ONE_TUNING).toBe(LEVEL_ONE_TUNINGS.production_7_14);
    expect(LEVEL_ONE_TUNINGS.legacy_5_10).toMatchObject({ strongEnemyUnlock: 5, bossUnlock: 10 });
  });
});
