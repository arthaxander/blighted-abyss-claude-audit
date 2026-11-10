import { enemies } from '../data/enemies';
import { createCursedEncounter, createGoblinNestsEncounter, getCursedEnemyPool, getTrashEnemyPool, GOBLIN_LOCATION } from './enemyPools';
import { isStrongEnemy } from './levelOneProgression';

describe('expedition depth encounter policy', () => {
  const locationEnemies = enemies.filter(enemy => enemy.location === GOBLIN_LOCATION && !enemy.boss);
  test('required Strong encounter uses an authored production Strong template and roster', () => {
    const pool = getTrashEnemyPool({ nonBossEnemies: locationEnemies, selectedLocation: GOBLIN_LOCATION, completedCombatRooms: Number.MAX_SAFE_INTEGER });
    const encounter = createGoblinNestsEncounter(pool, () => 0, { completedCombatRooms: Number.MAX_SAFE_INTEGER, requireStrong: true });
    expect(encounter.encounterStrength).toBe('strong');
    expect(encounter.encounterTemplateKey).toBeTruthy();
    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.enemies.filter(isStrongEnemy)).toHaveLength(1);
  });
  test('Cursed encounter remains exactly one enemy and has no Strong composition', () => {
    const encounter = createCursedEncounter(getCursedEnemyPool(locationEnemies), () => 0);
    expect(encounter.enemies).toHaveLength(1);
    expect(encounter.cursedEnemy).toBe(true);
    expect(encounter.encounterStrength).toBeUndefined();
  });
});
