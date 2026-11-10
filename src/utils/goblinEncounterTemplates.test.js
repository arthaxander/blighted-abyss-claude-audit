import { enemies } from '../data/enemies';
import {
  GOBLIN_LOCATION,
  GOBLIN_NORMAL_TEMPLATES,
  GOBLIN_STRONG_TEMPLATES,
  createGoblinNestsEncounter,
  getTrashEnemyPool,
} from './enemyPools';

const ordinaryNames = new Set([
  'Крысомант из Нор',
  'Гоблин-палач',
  'Гоблин-Потрошитель',
  'Гоблин-арбалетчик',
  'Гоблин-Ткач',
]);
const strongNames = new Set([
  'Крысиный матриарх',
  'Крысиный всадник',
  'Гоблин-огнепоклонник',
]);
const forbiddenDuplicateNames = [
  'Крысомант из Нор',
  'Гоблин-палач',
  'Гоблин-Ткач',
];

const goblinNonBoss = enemies.filter(enemy => enemy.location === GOBLIN_LOCATION && !enemy.boss);
const fullPool = getTrashEnemyPool({
  nonBossEnemies: goblinNonBoss,
  selectedLocation: GOBLIN_LOCATION,
  completedCombatRooms: 7,
});

const names = encounter => encounter.enemies.map(enemy => enemy.name);
const count = (list, name) => list.filter(entry => entry === name).length;

describe('Goblin Nests authored encounter templates', () => {
  test('map approach excludes Strong enemies regardless of accumulated wins or stale requireStrong', () => {
    for (const completedCombatRooms of [0, 7, 100]) {
      const pool = getTrashEnemyPool({ nonBossEnemies: goblinNonBoss, selectedLocation: GOBLIN_LOCATION,
        completedCombatRooms, expeditionRegion: 'approach' });
      expect(pool.every(enemy => ordinaryNames.has(enemy.name))).toBe(true);
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const encounter = createGoblinNestsEncounter(fullPool, () => roll, {
          completedCombatRooms, expeditionRegion: 'approach', requireStrong: true,
        });
        expect(encounter.enemies).toHaveLength(3);
        expect(names(encounter).every(name => ordinaryNames.has(name))).toBe(true);
      }
    }
  });
  test.each(['sublocation', 'depth'])('%s retains Strong enemies including Matriarch', expeditionRegion => {
    const encounter = createGoblinNestsEncounter(fullPool, () => 0, { requireStrong: true, expeditionRegion });
    expect(names(encounter)).toContain('Крысиный матриарх');
  });
  test('all authored packs contain exactly three primary enemies', () => {
    [...GOBLIN_NORMAL_TEMPLATES, ...GOBLIN_STRONG_TEMPLATES].forEach(template => {
      expect(template.names).toHaveLength(3);
      expect(template.names.every(name => ordinaryNames.has(name) || strongNames.has(name))).toBe(true);
    });
  });

  test('Ratmancer, Executioner, and Weaver never duplicate in authored packs', () => {
    [...GOBLIN_NORMAL_TEMPLATES, ...GOBLIN_STRONG_TEMPLATES].forEach(template => {
      forbiddenDuplicateNames.forEach(name => {
        expect(count(template.names, name)).toBeLessThanOrEqual(1);
      });
    });
  });

  test('only Crossbowman and Ripper have authored duplicate packs', () => {
    const duplicateTemplates = GOBLIN_NORMAL_TEMPLATES.filter(template =>
      new Set(template.names).size < template.names.length
    );
    expect(duplicateTemplates).toHaveLength(2);
    duplicateTemplates.forEach(template => {
      const duplicated = template.names.find(name => count(template.names, name) === 2);
      expect(['Гоблин-арбалетчик', 'Гоблин-Потрошитель']).toContain(duplicated);
    });
  });

  test('before Strong unlock only ordinary goblins can appear and encounter size is three', () => {
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: goblinNonBoss,
      selectedLocation: GOBLIN_LOCATION,
      completedCombatRooms: 0,
    });
    const encounter = createGoblinNestsEncounter(earlyPool, () => 0, { completedCombatRooms: 0 });

    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterStrength).toBe('normal');
    expect(names(encounter)).toEqual([
      'Гоблин-палач',
      'Гоблин-арбалетчик',
      'Гоблин-Ткач',
    ]);
    expect(names(encounter).every(name => ordinaryNames.has(name))).toBe(true);
  });

  test('Strong templates contain exactly one Strong enemy', () => {
    GOBLIN_STRONG_TEMPLATES.forEach(template => {
      expect(template.names.filter(name => strongNames.has(name))).toHaveLength(1);
    });
  });

  test('late authored encounter can use the Ratmancer tempo engine but never a second Strong enemy', () => {
    const encounter = createGoblinNestsEncounter(fullPool, () => 0.999999, { completedCombatRooms: 7 });
    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterStrength).toBe('strong');
    expect(names(encounter)).toEqual([
      'Гоблин-огнепоклонник',
      'Крысомант из Нор',
      'Гоблин-Ткач',
    ]);
    expect(names(encounter).filter(name => strongNames.has(name))).toHaveLength(1);
  });

  test('Matriarch plus Ratmancer exists as an authored rat-pack synergy without duplicate Ratmancers', () => {
    const ratTemplates = GOBLIN_STRONG_TEMPLATES.filter(template =>
      template.names.includes('Крысиный матриарх') && template.names.includes('Крысомант из Нор')
    );
    expect(ratTemplates.length).toBeGreaterThan(0);
    ratTemplates.forEach(template => {
      expect(count(template.names, 'Крысомант из Нор')).toBe(1);
      expect(template.names.filter(name => strongNames.has(name))).toHaveLength(1);
    });
  });

  test('missing Strong definitions falls back to a complete ordinary trio', () => {
    const ordinaryOnly = fullPool.filter(enemy => !strongNames.has(enemy.name));
    const encounter = createGoblinNestsEncounter(ordinaryOnly, () => 0.999999, { completedCombatRooms: 14 });

    expect(encounter.enemies).toHaveLength(3);
    expect(encounter.encounterStrength).toBe('normal');
    expect(names(encounter).every(name => ordinaryNames.has(name))).toBe(true);
  });
});

