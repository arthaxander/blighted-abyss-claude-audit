import {
  WITHERING_FOREST_LOCATION,
  WITHERING_FOREST_NORMAL_TEMPLATES,
  WITHERING_FOREST_STRONG_TEMPLATES,
  createWitheringForestEncounter,
  getTrashEnemyPool,
} from './enemyPools';

const normalNames = [
  'Ведьма Лепестков',
  'Эльфийская лучница',
  'Терновый страж',
  'Тень чащи',
  'Сеятель Гнуса',
];
const strongNames = ['Жнец лесов', 'Совиный друид', 'Друид-медведь'];
const blueprint = (name, strong = false) => ({
  name,
  location: WITHERING_FOREST_LOCATION,
  roomRole: strong ? 'strongEnemy' : 'normalEnemy',
  ...(strong ? { encounterPhase: 'late' } : {}),
});
const fullPool = [
  ...normalNames.map(name => blueprint(name)),
  ...strongNames.map(name => blueprint(name, true)),
];

const names = encounter => encounter.enemies.map(enemy => enemy.name);
const canonical = list => [...list].sort((a, b) => a.localeCompare(b, 'ru')).join('|');

describe('Withering Forest authored encounter templates', () => {
  test('ordinary and strong tables contain only exact three-primary-enemy packs', () => {
    expect(WITHERING_FOREST_NORMAL_TEMPLATES).toHaveLength(12);
    expect(WITHERING_FOREST_STRONG_TEMPLATES).toHaveLength(12);
    [...WITHERING_FOREST_NORMAL_TEMPLATES, ...WITHERING_FOREST_STRONG_TEMPLATES].forEach(template => {
      expect(template.names).toHaveLength(3);
      const counts = template.names.reduce((map, name) => ({ ...map, [name]: (map[name] || 0) + 1 }), {});
      expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2);
      expect(template.key).toBe(canonical(template.names));
    });
  });

  test('before strong unlock, only the five ordinary blueprints enter the Forest trash pool', () => {
    const early = getTrashEnemyPool({
      nonBossEnemies: fullPool,
      selectedLocation: WITHERING_FOREST_LOCATION,
      completedCombatRooms: 6,
    });
    expect(early.map(enemy => enemy.name).sort()).toEqual([...normalNames].sort());
  });

  test('at seven completed combats strong blueprints become eligible', () => {
    const late = getTrashEnemyPool({
      nonBossEnemies: fullPool,
      selectedLocation: WITHERING_FOREST_LOCATION,
      completedCombatRooms: 7,
    });
    expect(late.map(enemy => enemy.name).sort()).toEqual([...normalNames, ...strongNames].sort());
  });

  test('ordinary Forest fight is exactly one approved weighted template', () => {
    const encounter = createWitheringForestEncounter(fullPool, () => 0, { completedCombatRooms: 0 });
    expect(names(encounter)).toEqual(['Ведьма Лепестков', 'Эльфийская лучница', 'Терновый страж']);
    expect(encounter.encounterStrength).toBe('normal');
    expect(encounter.enemies).toHaveLength(3);
  });

  test('duplicate-authorized ordinary template can contain two Archers but never three', () => {
    const ordinaryOnly = fullPool.filter(enemy => !enemy.encounterPhase);
    // 0.84 lands in the authored double-Archer portion of the ordinary weight table.
    const encounter = createWitheringForestEncounter(ordinaryOnly, () => 0.84, { completedCombatRooms: 0 });
    const counts = names(encounter).reduce((map, name) => ({ ...map, [name]: (map[name] || 0) + 1 }), {});
    expect(Math.max(...Object.values(counts))).toBe(2);
    expect(WITHERING_FOREST_NORMAL_TEMPLATES.some(template => template.key === encounter.encounterTemplateKey)).toBe(true);
  });

  test('after unlock, a strong pack has exactly one strong enemy and two authored ordinary partners', () => {
    const encounter = createWitheringForestEncounter(fullPool, () => 0.999999, { completedCombatRooms: 7 });
    expect(names(encounter)).toEqual(['Друид-медведь', 'Эльфийская лучница', 'Тень чащи']);
    expect(encounter.encounterStrength).toBe('strong');
    expect(names(encounter).filter(name => strongNames.includes(name))).toHaveLength(1);
  });

  test('missing strong definitions cannot leak an incomplete strong pack', () => {
    const ordinaryOnly = fullPool.filter(enemy => !enemy.encounterPhase);
    const encounter = createWitheringForestEncounter(ordinaryOnly, () => 0.999999, { completedCombatRooms: 14 });
    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterStrength).toBe('normal');
    expect(names(encounter).every(name => normalNames.includes(name))).toBe(true);
  });

  test('previous played unordered triple is excluded when alternatives exist', () => {
    const first = createWitheringForestEncounter(fullPool, () => 0, { completedCombatRooms: 0 });
    const second = createWitheringForestEncounter(fullPool, () => 0, {
      completedCombatRooms: 0,
      previousTemplateKey: first.encounterTemplateKey,
    });
    expect(second.encounterTemplateKey).not.toBe(first.encounterTemplateKey);
    expect(canonical(names(second))).toBe(second.encounterTemplateKey);
  });
});
