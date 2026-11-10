export const LEVEL_ONE_LOCATIONS = Object.freeze({
  GOBLIN: 'Гоблинские Норы',
  FUNGAL: 'Грибные Пещеры',
  DESERTER: 'Лагерь Отступников',
});

export const COMMON_LEVEL_ONE_MATERIALS = Object.freeze([
  'Простая ткань', 'Обрывки кожи', 'Металлические обломки', 'Простая склянка', 'Кровяной мох', 'Простые чернила',
]);

export const LOCATION_LEVEL_ONE_MATERIALS = Object.freeze({
  [LEVEL_ONE_LOCATIONS.GOBLIN]: Object.freeze(['Крысиная шкура', 'Пепел гоблинского перца']),
  [LEVEL_ONE_LOCATIONS.FUNGAL]: Object.freeze(['Лазурный мицелий', 'Блуждающие споры', 'Спора светокапа', 'Слизь мохоспора', 'Пыльца серого спорника']),
  [LEVEL_ONE_LOCATIONS.DESERTER]: Object.freeze(['Сумеречный вереск', 'Черножильная руда']),
});

export const CURSED_ONLY_MATERIALS = Object.freeze(['Эссенция Проклятий']);
export const BOSS_MATERIAL_BY_LOCATION = Object.freeze({
  [LEVEL_ONE_LOCATIONS.GOBLIN]: 'Сердце костра',
  [LEVEL_ONE_LOCATIONS.FUNGAL]: 'Мерцающий узел',
  [LEVEL_ONE_LOCATIONS.DESERTER]: 'Сломанная клятва',
});

export const PRIMORDIAL_EQUIPMENT_BY_LOCATION = Object.freeze({
  [LEVEL_ONE_LOCATIONS.GOBLIN]: Object.freeze(['Кадило Отца Костров']),
  [LEVEL_ONE_LOCATIONS.FUNGAL]: Object.freeze(['Панцирь Змеиного Полубога']),
  [LEVEL_ONE_LOCATIONS.DESERTER]: Object.freeze(['Плащ Первого Предателя']),
});

export const PRIMORDIAL_DROP_CHANCES = Object.freeze({
  ordinary: 0.0004,
  strong: 0.0015,
  cursed: 0.003,
  chest: 0.001,
  treasureRoom: 0.005,
  secretRoom: 0.006,
  boss: 0.035,
  resourceRoom: 0,
});

export const rollLocationPrimordial = (locationName, source, rng = Math.random) => {
  const pool = PRIMORDIAL_EQUIPMENT_BY_LOCATION[locationName] || [];
  const chance = PRIMORDIAL_DROP_CHANCES[source] ?? 0;
  if (!pool.length || chance <= 0 || rng() >= chance) return null;
  const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
  return { name: pool[Math.floor(roll * pool.length)], quantity: 1 };
};

// Shared Treasure gear is deliberately short and faction-neutral.
export const COMMON_LEVEL_ONE_EQUIPMENT = Object.freeze([
  'Капюшон Искателя Знаков', 'Плащ Тусклого Оберега', 'Кольцо Переменчивой Искры',
  'Кольцо Тлеющего Отзвука', 'Амулет Трёх Искр', 'Железное Кольцо Караульного', 'Походные сапоги',
  'Натянутый охотничий лук', 'Амулет Ветерана Бездны',
]);

export const LOCATION_LEVEL_ONE_EQUIPMENT = Object.freeze({
  [LEVEL_ONE_LOCATIONS.GOBLIN]: Object.freeze([
    'Красный Колпак Старшего Крысолова', 'Тесак Гоблинского Мясника', 'Шипастый Щит Нор',
    'Посох Украденной Искры', 'Жезл Закопчённого Стекла', 'Мантия Погасшего Костра', 'Амулет Крысиной Жилы',
    'Крысиные обмотки',
  ]),
  [LEVEL_ONE_LOCATIONS.FUNGAL]: Object.freeze([
    'Грибная Маска Споровика', 'Хитиновый Панцирь Мясного Жука', 'Кольцо Туманного Мха',
    'Фокус Ледяного Спора', 'Молот Спорового Стража', 'Лук Спороносца',
  ]),
  [LEVEL_ONE_LOCATIONS.DESERTER]: Object.freeze([
    'Пепельная Маска Отступника', 'Куртка Мародёра', 'Щит Дозорного Гильдии', 'Алебарда Пограничного Дозора',
    'Капюшон Следопыта', 'Кольцо Меткой Тетивы', 'Булава Старого Сотника', 'Плащ разведчика', 'Полевой гримуар Отступника',
    'Сапоги перебежчика',
  ]),
});

export const CRAFT_ONLY_SIGNATURE_EQUIPMENT = Object.freeze([
  'Шипастый Щит Нор', 'Венец блуждающих спор', 'Булава Старого Сотника', 'Накидка Красного Костра', 'Мерцающая оболочка', 'Клятвопреступник',
]);

export const TREASURE_EQUIPMENT_SOURCE_WEIGHTS = Object.freeze({ common: 0.4, location: 0.6 });

export const selectTreasureEquipmentSource = ({ hasCommon = true, hasLocation = true } = {}, rng = Math.random) => {
  if (!hasLocation) return hasCommon ? 'common' : null;
  if (!hasCommon) return 'location';
  return rng() < TREASURE_EQUIPMENT_SOURCE_WEIGHTS.common ? 'common' : 'location';
};
