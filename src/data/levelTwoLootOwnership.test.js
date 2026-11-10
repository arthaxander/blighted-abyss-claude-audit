import { getEnemyBlueprintByName } from './enemies';
import {
  findItemData,
  getCraftingRecipes,
  getTreasureEquipmentPoolsForLocation,
  getTreasurePoolNamesForLocation,
  rollTreasureLoot,
} from './items';
import {
  BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION,
  COMMON_LEVEL_TWO_CONSUMABLES,
  COMMON_LEVEL_TWO_EQUIPMENT,
  COMMON_LEVEL_TWO_MATERIALS,
  CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
  GUILD_CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
  RARE_LOCATION_CRAFT_LEVEL_TWO_EQUIPMENT,
  EPIC_BOSS_CRAFT_LEVEL_TWO_EQUIPMENT,
  LEVEL_TWO_LOOT_LOCATIONS,
  LOCATION_LEVEL_TWO_CONSUMABLES,
  LOCATION_LEVEL_TWO_EQUIPMENT,
  LOCATION_LEVEL_TWO_MATERIALS,
  LEVEL_TWO_CONSUMABLE_ENEMY_CHANCES,
  LEVEL_TWO_PRIMORDIAL_DROP_CHANCES,
  PRIMORDIAL_LEVEL_TWO_EQUIPMENT,
  rollLevelTwoConsumable,
  rollLevelTwoPrimordial,
} from './levelTwoLootOwnership';
import { getLootOwnershipForLocation } from './lootOwnership';
import {
  COMMON_LEVEL_ONE_EQUIPMENT,
  COMMON_LEVEL_ONE_MATERIALS,
  LOCATION_LEVEL_ONE_EQUIPMENT,
  LOCATION_LEVEL_ONE_MATERIALS,
} from './levelOneLootOwnership';
import { createEncounterRewardRoster, resolveEncounterRewards } from '../utils/encounterRewards';

const FOREST = LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST;
const RUINS = LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS;
const MINES = LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY;
const ALL_L2_MATERIALS = new Set([
  ...COMMON_LEVEL_TWO_MATERIALS,
  ...Object.values(LOCATION_LEVEL_TWO_MATERIALS).flat(),
  ...Object.values(BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION),
]);
const FOREST_ORDINARY_REWARD_NAMES = new Set([
  ...COMMON_LEVEL_TWO_MATERIALS,
  ...LOCATION_LEVEL_TWO_MATERIALS[FOREST],
  ...COMMON_LEVEL_TWO_CONSUMABLES,
  ...LOCATION_LEVEL_TWO_CONSUMABLES[FOREST],
  ...COMMON_LEVEL_TWO_EQUIPMENT,
  ...LOCATION_LEVEL_TWO_EQUIPMENT[FOREST],
  ...PRIMORDIAL_LEVEL_TWO_EQUIPMENT[FOREST],
]);

describe('Level 2 loot ownership foundation', () => {
  test('uses the authored shared materials, location materials, and approved L2 boss catalysts', () => {
    expect(COMMON_LEVEL_TWO_MATERIALS).toEqual([
      'Сумрачный сплав',
      'Выделанная кожа Бездны',
      'Глубинное полотно',
      'Рунические чернила',
      'Кровяной мох',
    ]);
    expect(COMMON_LEVEL_TWO_CONSUMABLES).toEqual([
      'Зелье здоровья',
      'Защитный настой',
      'Очищающий состав',
    ]);
    expect(LOCATION_LEVEL_TWO_CONSUMABLES).toEqual({
      [FOREST]: ['Настой горькой живицы', 'Настой последней весны', 'Свиток цепких корней', 'Западня хищных побегов'],
      [RUINS]: ['Погребальная печать', 'Свиток Развеивания'],
      [MINES]: ['Огненная западня'],
    });
    expect(LOCATION_LEVEL_TWO_MATERIALS).toEqual({
      [FOREST]: ['Чёрная сердцевина', 'Горькая живица', 'Цветок последней весны'],
      [RUINS]: ['Эфирный прах', 'Погребальный воск', 'Осколки погребальных печатей'],
      [MINES]: ['Тлеющий шлак', 'Шахтная соль', 'Горючий битум'],
    });
    expect(BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION).toEqual({
      [FOREST]: 'Ветвь Архонта',
      [RUINS]: 'Эфирная кость',
      [MINES]: 'Тлеющий рог',
    });
    expect(COMMON_LEVEL_TWO_EQUIPMENT).toEqual([
      'Клинок должника',
      'Жезл встречных формул',
      'Лук пристрелки',
      'Щит третьей заплаты',
      'Шлем чужого сигнала',
      'Кираса последнего в строю',
      'Куртка сорванного ритуала',
      'Обруч незаконченного приказа',
      'Сапоги загонщика',
      'Жетон интенданта',
    ]);
    expect(LOCATION_LEVEL_TWO_EQUIPMENT).toEqual({
      [FOREST]: [
        'Лук вязких жил',
        'Фокус остановленного сока',
        'Покров поздней весны',
        'Амулет горькой росы',
        'Перстень цепкого плюща',
        'Перстень живых шрамов',
        'Сосуд украденного прилива',
        'Маска лесного часового',
        'Щит цепких корней',
        'Сапоги проросшей тропы',
        'Кольцо опавшего часа',
      ],
      [RUINS]: [
        'Гладиус незаживших ран',
        'Лук сорванного построения',
        'Щит неумолкшего марша',
        'Кираса уцелевшего знаменосца',
        'Посох двух голосов',
        'Перстень погребального строя',
        'Шлем вечного часового',
        'Поножи сбитого марша',
        'Медальон неотпетого',
        'Мундир погребального дозора',
        'Кольцо чужой смены',
        'Перстень последней шеренги',
      ],
      [MINES]: [
        'Молот последней смены',
        'Скипетр выжженной жилы',
        'Кираса чужой вины',
        'Сапоги чёрного пласта',
        'Каска последней крепи',
        'Фонарь чёрной жилы',
        'Амулет слепящего золота',
        'Сапоги вспыхнувшей жилы',
        'Куртка уцелевшего забойщика',
        'Каска глухого забоя',
        'Перстень ненасытной жилы',
        'Амулет стёртого имени',
      ],
    });
    expect(RARE_LOCATION_CRAFT_LEVEL_TWO_EQUIPMENT).toEqual({
      [FOREST]: ['Амулет цепкой живицы'],
      [RUINS]: ['Зеркало третьего голоса'],
      [MINES]: ['Щит тлеющей жилы'],
    });
    expect(EPIC_BOSS_CRAFT_LEVEL_TWO_EQUIPMENT).toEqual([
      'Лук последнего цветения',
      'Амулет последнего отзвука',
      'Посох выжженной памяти',
    ]);
    expect(GUILD_CRAFT_ONLY_LEVEL_TWO_EQUIPMENT).toEqual([
      'Шлем глубинного дозора',
      'Кираса глубинного дозора',
      'Сапоги глубинного дозора',
    ]);
    expect(CRAFT_ONLY_LEVEL_TWO_EQUIPMENT).toEqual([
      ...Object.values(RARE_LOCATION_CRAFT_LEVEL_TWO_EQUIPMENT).flat(),
      ...EPIC_BOSS_CRAFT_LEVEL_TWO_EQUIPMENT,
      ...GUILD_CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
    ]);
    expect(PRIMORDIAL_LEVEL_TWO_EQUIPMENT).toEqual({
      [FOREST]: ['Венец Раны Великого Корня'],
      [RUINS]: ['Печатка Всецаря'],
      [MINES]: ['Меч Гордыни'],
    });
  });

  test('registers level-two materials as resources without inventing unfinished rarity metadata', () => {
    [...ALL_L2_MATERIALS].forEach(name => {
      expect(findItemData(name)).toEqual(expect.objectContaining({ name, type: 'material' }));
    });
    ['Ветвь Архонта', 'Эфирная кость', 'Тлеющий рог'].forEach(name => {
      expect(findItemData(name)).toEqual(expect.objectContaining({ name, sourceTier: 'rareCatalyst' }));
    });
  });

  test('Forest ownership never falls back to level-one material or equipment pools', () => {
    const ownership = getLootOwnershipForLocation(FOREST);
    expect(ownership.abyssLevel).toBe(2);
    expect(ownership.commonMaterials).toEqual(COMMON_LEVEL_TWO_MATERIALS);
    expect(ownership.locationMaterials).toEqual(LOCATION_LEVEL_TWO_MATERIALS[FOREST]);
    expect(ownership.commonEquipment).toEqual(COMMON_LEVEL_TWO_EQUIPMENT);
    expect(ownership.locationEquipment).toEqual(LOCATION_LEVEL_TWO_EQUIPMENT[FOREST]);
    expect(ownership.commonConsumables).toEqual(COMMON_LEVEL_TWO_CONSUMABLES);
    expect(ownership.locationConsumables).toEqual(LOCATION_LEVEL_TWO_CONSUMABLES[FOREST]);
    expect(ownership.craftOnlyEquipment).toEqual(CRAFT_ONLY_LEVEL_TWO_EQUIPMENT);

    const levelOneNames = new Set([
      ...COMMON_LEVEL_ONE_MATERIALS,
      ...Object.values(LOCATION_LEVEL_ONE_MATERIALS).flat(),
      ...COMMON_LEVEL_ONE_EQUIPMENT,
      ...Object.values(LOCATION_LEVEL_ONE_EQUIPMENT).flat(),
    ]);
    expect(ownership.commonMaterials).toContain('Кровяной мох');
    [...ownership.commonMaterials, ...ownership.locationMaterials]
      .filter(name => name !== 'Кровяной мох')
      .forEach(name => {
        expect(levelOneNames.has(name)).toBe(false);
      });
  });

  test('Forest combat rewards include authored loot and basic field supplies', () => {
    const roster = createEncounterRewardRoster([
      { id: 'forest-normal', name: 'Ведьма Лепестков', location: FOREST, silverReward: 25 },
    ]);
    const allowed = new Set([...FOREST_ORDINARY_REWARD_NAMES, 'Простая склянка', 'Простая ткань', 'Кровяной мох']);
    for (let index = 0; index < 30; index += 1) {
      let state = index + 1;
      const rng = () => ((state = state * 48271 % 0x7fffffff) / 0x7fffffff);
      const reward = resolveEncounterRewards({ roster, location: FOREST }, rng);
      expect(reward.items.length).toBeGreaterThan(0);
      reward.items.forEach(item => expect(allowed.has(item.name)).toBe(true));
    }
  });


  test('Ruins and Mines use their authored local materials on the level-two pool', () => {
    for (const location of [RUINS, MINES]) {
      const ownership = getLootOwnershipForLocation(location);
      expect(ownership.abyssLevel).toBe(2);
      expect(ownership.commonMaterials).toEqual(COMMON_LEVEL_TWO_MATERIALS);
      expect(ownership.locationMaterials).toEqual(LOCATION_LEVEL_TWO_MATERIALS[location]);
      expect(ownership.commonEquipment).toEqual(COMMON_LEVEL_TWO_EQUIPMENT);
      expect(ownership.locationEquipment).toEqual(LOCATION_LEVEL_TWO_EQUIPMENT[location]);
      expect(ownership.commonConsumables).toEqual(COMMON_LEVEL_TWO_CONSUMABLES);
      expect(ownership.locationConsumables).toEqual(LOCATION_LEVEL_TWO_CONSUMABLES[location]);
      expect(ownership.craftOnlyEquipment).toEqual(CRAFT_ONLY_LEVEL_TWO_EQUIPMENT);
    }
  });

  test('ordinary Ruins and Mines rewards never include their epic, primordial, or guild-craft-only equipment', () => {
    for (const location of [RUINS, MINES]) {
      const roster = createEncounterRewardRoster([
        { id: location, name: 'Манекен II уровня', location, silverReward: 25 },
      ]);
      const forbidden = new Set([
        ...CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
        ...(PRIMORDIAL_LEVEL_TWO_EQUIPMENT[location] || []),
      ]);
      for (let index = 0; index < 30; index += 1) {
        let state = index + 17;
        const rng = () => ((state = state * 48271 % 0x7fffffff) / 0x7fffffff);
        const reward = resolveEncounterRewards({ roster, location }, rng);
        reward.items.forEach(item => expect(forbidden.has(item.name)).toBe(false));
      }
    }
  });

  test('registers the full Forest item catalog while keeping epic and primordial out of ordinary combat drops', () => {
    const ordinary = LOCATION_LEVEL_TWO_EQUIPMENT[FOREST];
    [...ordinary, ...CRAFT_ONLY_LEVEL_TWO_EQUIPMENT, ...PRIMORDIAL_LEVEL_TWO_EQUIPMENT[FOREST]].forEach(name => {
      expect(findItemData(name)).toEqual(expect.objectContaining({ name, type: 'equipment' }));
    });
    expect(ordinary).not.toContain('Лук последнего цветения');
    expect(ordinary).not.toContain('Венец Раны Великого Корня');
    expect(getLootOwnershipForLocation(FOREST).rollPrimordial('boss', () => 0)).toEqual({
      name: 'Венец Раны Великого Корня',
      quantity: 1,
    });
  });

  test('level-two treasure pools never fall back to level-one equipment', () => {
    for (const location of [FOREST, RUINS, MINES]) {
      const poolNames = new Set(getTreasurePoolNamesForLocation(location));
      const equipmentPools = getTreasureEquipmentPoolsForLocation(location);

      expect(equipmentPools.common.map(item => item.name)).toEqual(COMMON_LEVEL_TWO_EQUIPMENT);
      expect(equipmentPools.location.map(item => item.name)).toEqual(LOCATION_LEVEL_TWO_EQUIPMENT[location]);

      [...COMMON_LEVEL_TWO_EQUIPMENT, ...LOCATION_LEVEL_TWO_EQUIPMENT[location]]
        .forEach(name => expect(poolNames.has(name)).toBe(true));

      expect(poolNames.has('Зелье здоровья')).toBe(true);
      expect(poolNames.has('Защитный настой')).toBe(true);
      expect(poolNames.has('Очищающий состав')).toBe(true);
      expect(poolNames.has('Усиленное зелье щита')).toBe(false);
      expect(poolNames.has('Настой горькой живицы')).toBe(location === FOREST);
      expect(poolNames.has('Настой последней весны')).toBe(location === FOREST);
      expect(poolNames.has('Свиток цепких корней')).toBe(location === FOREST);
      expect(poolNames.has('Западня хищных побегов')).toBe(location === FOREST);
      expect(poolNames.has('Погребальная печать')).toBe(location === RUINS);
      expect(poolNames.has('Огненная западня')).toBe(location === MINES);
      expect(poolNames.has('Малое зелье здоровья')).toBe(false);
      expect(poolNames.has('Малое зелье щита')).toBe(false);

      [
        ...COMMON_LEVEL_ONE_EQUIPMENT,
        ...Object.values(LOCATION_LEVEL_ONE_EQUIPMENT).flat(),
        ...CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
        ...(PRIMORDIAL_LEVEL_TWO_EQUIPMENT[location] || []),
      ].forEach(name => expect(poolNames.has(name)).toBe(false));
    }
  });

  test('Level 2 encounter rewards actually include the replacement consumable roll', () => {
    const roster = createEncounterRewardRoster([
      { id: 'forest-potion-drop', name: 'Ведьма Лепестков', location: FOREST, silverReward: 25 },
    ]);
    const sequenceRng = values => {
      let index = 0;
      return () => values[Math.min(index++, values.length - 1)];
    };

    const reward = resolveEncounterRewards(
      { roster, location: FOREST },
      sequenceRng([0, 0, 0.99, 0.99, 0.05])
    );

    expect(reward.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Зелье здоровья', quantity: 1 }),
    ]));
    expect(reward.items.some(item => item.name === 'Малое зелье здоровья')).toBe(false);
    expect(reward.items.some(item => item.name === 'Малое зелье щита')).toBe(false);
  });

  test('Level 2 drop chances follow common, then location-scoped consumables with no cross-zone contamination', () => {
    expect(LEVEL_TWO_CONSUMABLE_ENEMY_CHANCES).toEqual({
      'Зелье здоровья': 0.10,
      'Защитный настой': 0.05,
      'Очищающий состав': 0.05,
      'Настой горькой живицы': 0.05,
      'Настой последней весны': 0.05,
      'Свиток цепких корней': 0.05,
      'Западня хищных побегов': 0.05,
      'Погребальная печать': 0.05,
      'Свиток Развеивания': 0.05,
      'Огненная западня': 0.05,
    });
    for (const location of [FOREST, RUINS, MINES]) {
      expect(rollLevelTwoConsumable(location, () => 0.09999)?.name).toBe('Зелье здоровья');
      expect(rollLevelTwoConsumable(location, () => 0.10)?.name).toBe('Защитный настой');
      expect(rollLevelTwoConsumable(location, () => 0.15)?.name).toBe('Очищающий состав');
    }
    expect(rollLevelTwoConsumable(FOREST, () => 0.20)?.name).toBe('Настой горькой живицы');
    expect(rollLevelTwoConsumable(FOREST, () => 0.35)?.name).toBe('Западня хищных побегов');
    expect(rollLevelTwoConsumable(FOREST, () => 0.40)).toBeNull();
    expect(rollLevelTwoConsumable(RUINS, () => 0.20)?.name).toBe('Погребальная печать');
    expect(rollLevelTwoConsumable(MINES, () => 0.20)?.name).toBe('Огненная западня');
    expect(rollLevelTwoConsumable(RUINS, () => 0.25)?.name).toBe('Свиток Развеивания');
    expect(rollLevelTwoConsumable(RUINS, () => 0.30)).toBeNull();
    expect(rollLevelTwoConsumable(MINES, () => 0.25)).toBeNull();
    expect(getLootOwnershipForLocation(FOREST).rollConsumable(() => 0.20)?.name).toBe('Настой горькой живицы');
    expect(getLootOwnershipForLocation(RUINS).rollConsumable(() => 0.20)?.name).toBe('Погребальная печать');
    expect(getLootOwnershipForLocation(MINES).rollConsumable(() => 0.20)?.name).toBe('Огненная западня');
  });

  test('level-two primordial drops use the approved L1-equivalent source chances', () => {
    expect(LEVEL_TWO_PRIMORDIAL_DROP_CHANCES).toEqual(expect.objectContaining({
      ordinary: 0.0004,
      strong: 0.0015,
      boss: 0.035,
    }));

    const sequenceRng = values => {
      let index = 0;
      return () => values[Math.min(index++, values.length - 1)];
    };

    expect(rollLevelTwoPrimordial(FOREST, 'boss', sequenceRng([0.034999, 0]))).toEqual({
      name: 'Венец Раны Великого Корня',
      quantity: 1,
    });
    expect(rollLevelTwoPrimordial(FOREST, 'boss', sequenceRng([0.035, 0]))).toBeNull();

    expect(rollLevelTwoPrimordial(RUINS, 'strong', sequenceRng([0.001499, 0]))).toEqual({
      name: 'Печатка Всецаря',
      quantity: 1,
    });
    expect(rollLevelTwoPrimordial(RUINS, 'strong', sequenceRng([0.0015, 0]))).toBeNull();

    expect(rollLevelTwoPrimordial(MINES, 'ordinary', sequenceRng([0.000399, 0]))).toEqual({
      name: 'Меч Гордыни',
      quantity: 1,
    });
    expect(rollLevelTwoPrimordial(MINES, 'ordinary', sequenceRng([0.0004, 0]))).toBeNull();
  });

  test('level-two treasure and secret rooms use the level-two primordial pool', () => {
    const sequenceRng = values => {
      let index = 0;
      return () => values[Math.min(index++, values.length - 1)];
    };

    expect(rollTreasureLoot(FOREST, 0, 0, {
      primordialSource: 'treasureRoom',
      rng: sequenceRng([0, 0.004999, 0]),
    })).toEqual([{ name: 'Венец Раны Великого Корня', quantity: 1 }]);

    expect(rollTreasureLoot(RUINS, 0, 0, {
      primordialSource: 'secretRoom',
      rng: sequenceRng([0, 0.005999, 0]),
    })).toEqual([{ name: 'Печатка Всецаря', quantity: 1 }]);

    expect(rollTreasureLoot(MINES, 0, 0, {
      primordialSource: 'treasureRoom',
      rng: sequenceRng([0, 0.005, 0]),
    })).toEqual([]);
  });

  test('guild crafting exposes only the resolved level-two recipes', () => {
    const recipes = new Map(getCraftingRecipes().map(recipe => [recipe.name, recipe.ingredients]));

    expect(recipes.get('Амулет цепкой живицы')).toEqual([
      { name: 'Чёрная сердцевина', quantity: 3 },
      { name: 'Горькая живица', quantity: 5 },
      { name: 'Глубинное полотно', quantity: 3 },
    ]);
    expect(recipes.get('Зеркало третьего голоса')).toEqual([
      { name: 'Эфирный прах', quantity: 6 },
      { name: 'Сумрачный сплав', quantity: 4 },
      { name: 'Глубинное полотно', quantity: 3 },
    ]);
    expect(recipes.get('Щит тлеющей жилы')).toEqual([
      { name: 'Тлеющий шлак', quantity: 6 },
      { name: 'Сумрачный сплав', quantity: 5 },
      { name: 'Выделанная кожа Бездны', quantity: 2 },
    ]);
    expect(recipes.get('Лук последнего цветения')).toEqual([
      { name: 'Ветвь Архонта', quantity: 1 },
      { name: 'Выделанная кожа Бездны', quantity: 3 },
      { name: 'Горькая живица', quantity: 4 },
      { name: 'Цветок последней весны', quantity: 2 },
    ]);
    expect(recipes.get('Амулет последнего отзвука')).toEqual([
      { name: 'Эфирная кость', quantity: 1 },
      { name: 'Глубинное полотно', quantity: 4 },
      { name: 'Выделанная кожа Бездны', quantity: 3 },
      { name: 'Сумрачный сплав', quantity: 2 },
    ]);
    expect(recipes.get('Посох выжженной памяти')).toEqual([
      { name: 'Тлеющий рог', quantity: 1 },
      { name: 'Сумрачный сплав', quantity: 4 },
      { name: 'Глубинное полотно', quantity: 3 },
      { name: 'Выделанная кожа Бездны', quantity: 2 },
    ]);
    expect(recipes.get('Шлем глубинного дозора')).toEqual([
      { name: 'Сумрачный сплав', quantity: 2 },
      { name: 'Глубинное полотно', quantity: 2 },
    ]);
    expect(recipes.get('Кираса глубинного дозора')).toEqual([
      { name: 'Сумрачный сплав', quantity: 3 },
      { name: 'Выделанная кожа Бездны', quantity: 2 },
      { name: 'Глубинное полотно', quantity: 1 },
    ]);
    expect(recipes.get('Сапоги глубинного дозора')).toEqual([
      { name: 'Сумрачный сплав', quantity: 1 },
      { name: 'Выделанная кожа Бездны', quantity: 2 },
      { name: 'Глубинное полотно', quantity: 1 },
    ]);
  });

  test('Bloom Archon guarantees exactly one Branch and rejects catalysts from other locations or levels', () => {
    const archon = getEnemyBlueprintByName('Архонт Цветения');
    expect(archon.guaranteedLoot).toEqual(['Ветвь Архонта']);
    const roster = createEncounterRewardRoster([{
      ...archon,
      guaranteedLoot: ['Ветвь Архонта', 'Ветвь Архонта', 'Сердце костра', 'Эфирная кость', 'Тлеющий рог'],
    }]);
    const reward = resolveEncounterRewards({ roster, location: FOREST }, () => 0.99);
    expect(reward.items.find(item => item.name === 'Ветвь Архонта')).toEqual({
      name: 'Ветвь Архонта',
      quantity: 1,
    });
    ['Сердце костра', 'Эфирная кость', 'Тлеющий рог'].forEach(name => {
      expect(reward.items.some(item => item.name === name)).toBe(false);
    });
  });
});
