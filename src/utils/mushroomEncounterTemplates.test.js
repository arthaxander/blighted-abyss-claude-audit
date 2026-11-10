import { enemies } from '../data/enemies';
import {
  FUNGAL_LOCATION,
  MUSHROOM_ENCOUNTER_FAMILIES,
  MUSHROOM_FUNGAL_STRONG_TEMPLATES,
  MUSHROOM_FUNGAL_TEMPLATES,
  MUSHROOM_NORMAL_STRONG_TEMPLATES,
  MUSHROOM_NORMAL_TEMPLATES,
  createMushroomCavesEncounter,
  getTrashEnemyPool,
} from './enemyPools';

const ordinaryNormal = new Set([
  'Троглодит-копейщик',
  'Троглодит-заклинатель змей',
  'Троглодит-шаман',
]);
const ordinaryFungal = new Set([
  'Троглодит-заражённый',
  'Троглодит-споровик',
]);
const strongNormal = new Set(['Костестраж', 'Змеиный двоеглав']);
const strongFungal = new Set(['Одичавший троглодит']);

const fungalNonBoss = enemies.filter(enemy => enemy.location === FUNGAL_LOCATION && !enemy.boss);
const fullPool = getTrashEnemyPool({
  nonBossEnemies: fungalNonBoss,
  selectedLocation: FUNGAL_LOCATION,
  completedCombatRooms: 7,
});

const names = encounter => encounter.enemies.map(enemy => enemy.name);
const count = (list, name) => list.filter(entry => entry === name).length;

describe('Mushroom Caves authored encounter templates', () => {
  test('all authored packs contain exactly three primary enemies and never mix encounter families', () => {
    const allTemplates = [
      ...MUSHROOM_NORMAL_TEMPLATES,
      ...MUSHROOM_FUNGAL_TEMPLATES,
      ...MUSHROOM_NORMAL_STRONG_TEMPLATES,
      ...MUSHROOM_FUNGAL_STRONG_TEMPLATES,
    ];

    allTemplates.forEach(template => {
      expect(template.names).toHaveLength(3);
      const allowed = template.family === MUSHROOM_ENCOUNTER_FAMILIES.NORMAL
        ? new Set([...ordinaryNormal, ...strongNormal])
        : new Set([...ordinaryFungal, ...strongFungal]);
      expect(template.names.every(name => allowed.has(name))).toBe(true);
    });
  });

  test('ordinary fungal templates allow infected swarms but never triple Spore carriers', () => {
    expect(MUSHROOM_FUNGAL_TEMPLATES.some(template =>
      count(template.names, 'Троглодит-заражённый') === 3
    )).toBe(true);
    expect(MUSHROOM_FUNGAL_TEMPLATES.some(template =>
      count(template.names, 'Троглодит-споровик') === 3
    )).toBe(false);
  });

  test('strong templates contain exactly one Strong enemy and forbid double Feral tempo loops', () => {
    MUSHROOM_NORMAL_STRONG_TEMPLATES.forEach(template => {
      expect(template.names.filter(name => strongNormal.has(name))).toHaveLength(1);
    });
    MUSHROOM_FUNGAL_STRONG_TEMPLATES.forEach(template => {
      expect(template.names.filter(name => strongFungal.has(name))).toHaveLength(1);
      expect(count(template.names, 'Одичавший троглодит')).toBe(1);
    });
    expect(MUSHROOM_NORMAL_STRONG_TEMPLATES.some(template =>
      template.names.includes('Костестраж') && template.names.includes('Змеиный двоеглав')
    )).toBe(false);
  });

  test('before Strong unlock the encounter is an approved ordinary trio', () => {
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: fungalNonBoss,
      selectedLocation: FUNGAL_LOCATION,
      completedCombatRooms: 0,
    });
    const encounter = createMushroomCavesEncounter(earlyPool, () => 0, { completedCombatRooms: 0 });

    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterStrength).toBe('normal');
    expect(names(encounter)).toEqual([
      'Троглодит-копейщик',
      'Троглодит-заклинатель змей',
      'Троглодит-шаман',
    ]);
  });

  test('ordinary authored duplicate packs can deliberately use two Snake Callers', () => {
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: fungalNonBoss,
      selectedLocation: FUNGAL_LOCATION,
      completedCombatRooms: 0,
    });
    // Normal ordinary weights occupy 12/18 total. 0.52 lands on the low-weight
    // Spearman + double Snake Caller template.
    const encounter = createMushroomCavesEncounter(earlyPool, () => 0.52, { completedCombatRooms: 0 });
    expect(names(encounter)).toEqual([
      'Троглодит-копейщик',
      'Троглодит-заклинатель змей',
      'Троглодит-заклинатель змей',
    ]);
  });

  test('after Strong unlock authored packs can include one Feral but never a second one', () => {
    const encounter = createMushroomCavesEncounter(fullPool, () => 0.999999, { completedCombatRooms: 7 });
    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterFamily).toBe(MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL);
    expect(encounter.encounterStrength).toBe('strong');
    expect(names(encounter)).toEqual([
      'Одичавший троглодит',
      'Троглодит-споровик',
      'Троглодит-споровик',
    ]);
    expect(count(names(encounter), 'Одичавший троглодит')).toBe(1);
  });

  test('missing Strong definitions cannot produce an incomplete encounter', () => {
    const ordinaryOnly = fullPool.filter(enemy => !strongNormal.has(enemy.name) && !strongFungal.has(enemy.name));
    const encounter = createMushroomCavesEncounter(ordinaryOnly, () => 0.999999, { completedCombatRooms: 14 });
    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterStrength).toBe('normal');
    expect(names(encounter).some(name => strongNormal.has(name) || strongFungal.has(name))).toBe(false);
  });
});
