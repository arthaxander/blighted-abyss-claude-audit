import { enemies } from '../data/enemies';
import {
  DESERTER_LOCATION,
  DESERTER_NORMAL_TEMPLATES,
  DESERTER_REINFORCEMENT_CONTROL_NAMES,
  DESERTER_STRONG_TEMPLATES,
  applyDeserterAlertModifier,
  createDeserterCampEncounter,
  getTrashEnemyPool,
} from './enemyPools';

const ordinaryNames = new Set([
  'Громила',
  'Чернокнижник',
  'Трюкач',
  'Дуэлянт',
  'Следопыт',
]);
const strongNames = new Set([
  'Аптекарь',
  'Заклинатель бурь',
  'Мастер алебарды',
]);
const controlNames = new Set(DESERTER_REINFORCEMENT_CONTROL_NAMES);

const deserterNonBoss = enemies.filter(enemy => enemy.location === DESERTER_LOCATION && !enemy.boss);
const fullPool = getTrashEnemyPool({
  nonBossEnemies: deserterNonBoss,
  selectedLocation: DESERTER_LOCATION,
  completedCombatRooms: 7,
});

const names = encounter => encounter.enemies.map(enemy => enemy.name);
const sequence = values => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

describe('Deserter Camp authored encounter templates', () => {
  test('all authored packs contain three unique primary enemies', () => {
    [...DESERTER_NORMAL_TEMPLATES, ...DESERTER_STRONG_TEMPLATES].forEach(template => {
      expect(template.names).toHaveLength(3);
      expect(new Set(template.names).size).toBe(3);
      expect(template.names.every(name => ordinaryNames.has(name) || strongNames.has(name))).toBe(true);
    });
  });

  test('normal templates contain no late/Strong Deserters', () => {
    DESERTER_NORMAL_TEMPLATES.forEach(template => {
      expect(template.names.every(name => ordinaryNames.has(name))).toBe(true);
    });
  });

  test('Strong templates contain exactly one late/Strong Deserter', () => {
    DESERTER_STRONG_TEMPLATES.forEach(template => {
      expect(template.names.filter(name => strongNames.has(name))).toHaveLength(1);
    });
  });

  test('before Strong unlock an authored encounter is exactly three ordinary Deserters', () => {
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: deserterNonBoss,
      selectedLocation: DESERTER_LOCATION,
      completedCombatRooms: 0,
    });
    const encounter = createDeserterCampEncounter(earlyPool, () => 0, { completedCombatRooms: 0 });

    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterStrength).toBe('normal');
    expect(names(encounter)).toEqual(['Громила', 'Следопыт', 'Трюкач']);
    expect(names(encounter).every(name => ordinaryNames.has(name))).toBe(true);
  });

  test('after Strong unlock an authored pack still contains only one Strong enemy', () => {
    const encounter = createDeserterCampEncounter(fullPool, () => 0.999999, { completedCombatRooms: 7 });

    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterStrength).toBe('strong');
    expect(names(encounter)).toEqual(['Мастер алебарды', 'Дуэлянт', 'Следопыт']);
    expect(names(encounter).filter(name => strongNames.has(name))).toHaveLength(1);
  });

  test('Reinforcement is the only path to a fourth Deserter and never adds a duplicate or late unit', () => {
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: deserterNonBoss,
      selectedLocation: DESERTER_LOCATION,
      completedCombatRooms: 6,
    });
    const base = createDeserterCampEncounter(earlyPool, () => 0, { completedCombatRooms: 6 });
    const result = applyDeserterAlertModifier({
      ...base,
      completedCombatRooms: 6,
      pool: earlyPool,
      // Alert II: trigger modifier, choose Reinforcement, then select the only safe candidate.
      rng: sequence([0, 0.99, 0]),
    });

    expect(result.alertModifier?.type).toBe('reinforcement');
    expect(result.enemies).toHaveLength(4);
    expect(new Set(result.enemies.map(enemy => enemy.name)).size).toBe(4);
    expect(result.enemies.filter(enemy => strongNames.has(enemy.name))).toHaveLength(0);
  });

  test('Reinforcement cannot create three simultaneous denial/control specialists', () => {
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: deserterNonBoss,
      selectedLocation: DESERTER_LOCATION,
      completedCombatRooms: 6,
    });
    const base = {
      enemies: [
        earlyPool.find(enemy => enemy.name === 'Громила'),
        earlyPool.find(enemy => enemy.name === 'Следопыт'),
        earlyPool.find(enemy => enemy.name === 'Трюкач'),
      ],
      miniBoss: false,
    };
    const result = applyDeserterAlertModifier({
      ...base,
      completedCombatRooms: 6,
      pool: earlyPool,
      rng: sequence([0, 0.99, 0]),
    });

    expect(result.enemies).toHaveLength(4);
    expect(result.enemies.map(enemy => enemy.name)).toContain('Дуэлянт');
    expect(result.enemies.map(enemy => enemy.name)).not.toContain('Чернокнижник');
    expect(result.enemies.filter(enemy => controlNames.has(enemy.name))).toHaveLength(2);
  });

  test('Reinforcement never grows an already four-enemy formation to five', () => {
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: deserterNonBoss,
      selectedLocation: DESERTER_LOCATION,
      completedCombatRooms: 6,
    });
    const four = earlyPool.slice(0, 4);
    const result = applyDeserterAlertModifier({
      enemies: four,
      completedCombatRooms: 6,
      pool: earlyPool,
      rng: sequence([0, 0.99, 0]),
    });

    expect(result.enemies).toHaveLength(4);
    expect(result.alertModifier).toBeNull();
  });
});
