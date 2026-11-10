export const LEVEL_TWO_LOOT_LOCATIONS = Object.freeze({
  WITHERING_FOREST: 'Лес Увядания',
  RESTLESS_RUINS: 'Руины Неупокоенных',
  MINES_OF_DECAY: 'Шахты Тления',
});

export const COMMON_LEVEL_TWO_MATERIALS = Object.freeze([
  'Сумрачный сплав',
  'Выделанная кожа Бездны',
  'Глубинное полотно',
  'Рунические чернила',
  'Кровяной мох', 
]);

export const COMMON_LEVEL_TWO_CONSUMABLES = Object.freeze([
  'Зелье здоровья',
  'Защитный настой',
  'Очищающий состав',
]);

export const LOCATION_LEVEL_TWO_CONSUMABLES = Object.freeze({
  [LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST]: Object.freeze([
    'Настой горькой живицы',
    'Настой последней весны',
    'Свиток цепких корней',
    'Западня хищных побегов',
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS]: Object.freeze(['Погребальная печать', 'Свиток Развеивания']),
  [LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY]: Object.freeze(['Огненная западня']),
});

// Preserve the Level 1 analogue enemy chances while replacing the weaker
// versions on Abyss Level 2. A single reward-bearing enemy can drop at most one.
export const LEVEL_TWO_CONSUMABLE_ENEMY_CHANCES = Object.freeze({
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

export const rollLevelTwoConsumable = (locationName, rng = Math.random) => {
  const pool = [
    ...COMMON_LEVEL_TWO_CONSUMABLES,
    ...(LOCATION_LEVEL_TWO_CONSUMABLES[locationName] || []),
  ];
  const roll = rng();
  let cumulative = 0;
  for (const name of pool) {
    // Keep authored probability boundaries exact. Repeated binary floating-point
    // addition made 0.10 + 0.05 slightly greater than 0.15, assigning the exact
    // 15% boundary to the preceding item.
    cumulative = Number((cumulative + (LEVEL_TWO_CONSUMABLE_ENEMY_CHANCES[name] || 0)).toFixed(10));
    if (roll < cumulative) return { name, quantity: 1 };
  }
  return null;
};

// Four newly added regional reagents retain working labels until the art/naming pass.
// Location materials feed deterministic craft routes for each authored L2 location.
export const LOCATION_LEVEL_TWO_MATERIALS = Object.freeze({
  [LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST]: Object.freeze([
    'Чёрная сердцевина',
    'Горькая живица',
    'Цветок последней весны',
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS]: Object.freeze([
    'Эфирный прах',
    'Погребальный воск',
    'Осколки погребальных печатей',
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY]: Object.freeze([
    'Тлеющий шлак',
    'Шахтная соль',
    'Горючий битум',
  ]),
});

export const BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION = Object.freeze({
  [LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST]: 'Ветвь Архонта',
  [LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS]: 'Эфирная кость',
  [LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY]: 'Тлеющий рог',
});

export const COMMON_LEVEL_TWO_EQUIPMENT = Object.freeze([
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

export const LOCATION_LEVEL_TWO_EQUIPMENT = Object.freeze({
  [LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST]: Object.freeze([
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
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS]: Object.freeze([
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
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY]: Object.freeze([
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
  ]),
});

export const RARE_LOCATION_CRAFT_LEVEL_TWO_EQUIPMENT = Object.freeze({
  [LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST]: Object.freeze([
    'Амулет цепкой живицы',
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS]: Object.freeze([
    'Зеркало третьего голоса',
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY]: Object.freeze([
    'Щит тлеющей жилы',
  ]),
});

export const EPIC_BOSS_CRAFT_LEVEL_TWO_EQUIPMENT = Object.freeze([
  'Лук последнего цветения',
  'Амулет последнего отзвука',
  'Посох выжженной памяти',
]);

export const GUILD_CRAFT_ONLY_LEVEL_TWO_EQUIPMENT = Object.freeze([
  'Шлем глубинного дозора',
  'Кираса глубинного дозора',
  'Сапоги глубинного дозора',
]);

export const CRAFT_ONLY_LEVEL_TWO_EQUIPMENT = Object.freeze([
  ...Object.values(RARE_LOCATION_CRAFT_LEVEL_TWO_EQUIPMENT).flat(),
  ...EPIC_BOSS_CRAFT_LEVEL_TWO_EQUIPMENT,
  ...GUILD_CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
]);

export const PRIMORDIAL_LEVEL_TWO_EQUIPMENT = Object.freeze({
  [LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST]: Object.freeze([
    'Венец Раны Великого Корня',
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS]: Object.freeze([
    'Печатка Всецаря',
  ]),
  [LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY]: Object.freeze([
    'Меч Гордыни',
  ]),
});

export const LEVEL_TWO_PRIMORDIAL_DROP_CHANCES = Object.freeze({
  ordinary: 0.0004,
  strong: 0.0015,
  cursed: 0.003,
  chest: 0.001,
  treasureRoom: 0.005,
  secretRoom: 0.006,
  boss: 0.035,
  resourceRoom: 0,
});

export const rollLevelTwoPrimordial = (locationName, source, rng = Math.random) => {
  const pool = PRIMORDIAL_LEVEL_TWO_EQUIPMENT[locationName] || [];
  const chance = LEVEL_TWO_PRIMORDIAL_DROP_CHANCES[source] ?? 0;
  if (!pool.length || chance <= 0 || rng() >= chance) return null;
  const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
  return { name: pool[Math.floor(roll * pool.length)], quantity: 1 };
};

export const LEVEL_TWO_MATERIAL_DEFINITIONS = Object.freeze([
  ...COMMON_LEVEL_TWO_MATERIALS
    .filter(name => name !== 'Кровяной мох')
    .map(name => ({
      name,
      type: 'material',
      sourceTier: 'common',
      sourceTags: ['level2', 'common'],
      intendedUse: 'crafting',
    })),
  ...LOCATION_LEVEL_TWO_MATERIALS[LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST].map(name => ({
    name,
    type: 'material',
    sourceTier: 'location',
    sourceTags: ['level2', 'withering_forest'],
    intendedUse: 'crafting',
  })),
  ...LOCATION_LEVEL_TWO_MATERIALS[LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS].map(name => ({
    name,
    type: 'material',
    sourceTier: 'location',
    sourceTags: ['level2', 'restless_ruins'],
    intendedUse: 'crafting',
  })),
  ...LOCATION_LEVEL_TWO_MATERIALS[LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY].map(name => ({
    name,
    type: 'material',
    sourceTier: 'location',
    sourceTags: ['level2', 'mines_of_decay'],
    intendedUse: 'crafting',
  })),
  {
    name: BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION[LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST],
    type: 'material',
    sourceTier: 'rareCatalyst',
    sourceTags: ['level2', 'withering_forest', 'boss'],
    intendedUse: 'crafting',
  },
  {
    name: BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION[LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS],
    type: 'material',
    sourceTier: 'rareCatalyst',
    sourceTags: ['level2', 'restless_ruins', 'boss'],
    intendedUse: 'crafting',
  },
  {
    name: BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION[LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY],
    type: 'material',
    sourceTier: 'rareCatalyst',
    sourceTags: ['level2', 'mines_of_decay', 'boss'],
    intendedUse: 'crafting',
  },
]);

export const isLevelTwoLootLocation = locationName =>
  Object.prototype.hasOwnProperty.call(LOCATION_LEVEL_TWO_MATERIALS, locationName);
