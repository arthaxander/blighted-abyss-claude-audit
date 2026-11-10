export const GOBLIN_SUBLOCATION_IDS = Object.freeze({
  RAT_RIDERS: 'goblin-rat-riders',
  RAT_MATRIARCHS: 'goblin-rat-matriarchs',
  PYROMANCERS: 'goblin-pyromancers',
  CURSED_RUBBLE: 'goblin-cursed-rubble',
});

export const GOBLIN_SUBLOCATIONS = Object.freeze([
  Object.freeze({
    id: GOBLIN_SUBLOCATION_IDS.RAT_RIDERS,
    name: 'Крысиные проходы',
    effectId: 'rat-riders',
    effectSummary: 'Все противники начинают бой с 15% шкалы хода. Крысиные противники — с 30% вместо 15%.',
    preferredStrongEnemies: Object.freeze(['Крысиный всадник']),
    cursedChance: 0.15,
    lootKeywords: Object.freeze(['Крыс', 'крыси']),
  }),
  Object.freeze({
    id: GOBLIN_SUBLOCATION_IDS.RAT_MATRIARCHS,
    name: 'Материнское логово',
    effectId: 'rat-matriarchs',
    effectSummary: 'Герой всегда начинает бой с [Кровотечением] на 2 хода. Во время боя может появиться Чумная крыса — максимум 2 раза.',
    preferredStrongEnemies: Object.freeze(['Крысиный матриарх']),
    cursedChance: 0.2,
    lootKeywords: Object.freeze(['Крыс', 'кров']),
  }),
  Object.freeze({
    id: GOBLIN_SUBLOCATION_IDS.PYROMANCERS,
    name: 'Пламенные коридоры',
    effectId: 'pyromancers',
    effectSummary: 'Герой начинает бой с 3 [Обугливания]. Один раз за бой в случайный момент может получить [Поджог].',
    preferredStrongEnemies: Object.freeze(['Гоблин-огнепоклонник']),
    cursedChance: 0.2,
    lootKeywords: Object.freeze(['Огн', 'пепел', 'Закопч', 'костр']),
  }),
  Object.freeze({
    id: GOBLIN_SUBLOCATION_IDS.CURSED_RUBBLE,
    name: 'Проклятые завалы',
    effectId: 'cursed-rubble',
    effectSummary: 'Срабатывание [Кровотечения] у героя и разрушение его Щита заполняют шкалу хода противников.',
    preferredStrongEnemies: Object.freeze([]),
    cursedChance: 0.4,
    lootKeywords: Object.freeze(['Проклят', 'Оскверн', 'Искаж', 'Эссенция']),
  }),
]);

export const MINES_SUBLOCATION_IDS = Object.freeze({
  OVERSEER: 'mines-overseer-shaft',
  SUPPORT: 'mines-support-galleries',
  SURVEYOR: 'mines-blind-workings',
  CURSED: 'mines-cursed-rift',
});

export const MINES_SUBLOCATIONS = Object.freeze([
  Object.freeze({
    id: MINES_SUBLOCATION_IDS.OVERSEER,
    name: 'Надзорный забой',
    effectId: 'mines-last-shift',
    effectSummary: 'Когда здоровье обычного врага впервые падает до 50% или ниже, он получает +20% шкалы хода (если выжил).',
    preferredStrongEnemies: Object.freeze(['Старший надзиратель']),
    cursedChance: 0.15,
    lootKeywords: Object.freeze(['Шахт', 'Надзор']),
  }),
  Object.freeze({
    id: MINES_SUBLOCATION_IDS.SUPPORT,
    name: 'Крепёжные галереи',
    effectId: 'mines-fortified-galleries',
    effectSummary: 'Пока хоть один враг имеет Щит, остальные враги без Щита получают на 20% меньше прямого массового урона.',
    preferredStrongEnemies: Object.freeze(['Мастер крепей']),
    cursedChance: 0.15,
    lootKeywords: Object.freeze(['Креп', 'Щит']),
  }),
  Object.freeze({
    id: MINES_SUBLOCATION_IDS.SURVEYOR,
    name: 'Слепые выработки',
    effectId: 'mines-black-markings',
    effectSummary: 'В начале боя два случайных обычных противника получают по одному случайному усилению на 2 хода.',
    preferredStrongEnemies: Object.freeze(['Забывший маркшейдер']),
    cursedChance: 0.15,
    lootKeywords: Object.freeze(['Жил', 'Рун']),
  }),
  Object.freeze({
    id: MINES_SUBLOCATION_IDS.CURSED,
    name: 'Заражённый разлом',
    effectId: 'mines-clinging-curse',
    effectSummary: 'Первый дебафф каждого типа от проклятого врага по каждой цели действует на 1 ход дольше; заряды и мгновенные эффекты не усиливаются.',
    preferredStrongEnemies: Object.freeze([]),
    cursedChance: 0.6,
    lootKeywords: Object.freeze(['Искаж', 'Оскверн', 'Эссенц']),
  }),
]);

const LEGACY_SUBLOCATIONS = Object.freeze([
  Object.freeze({ id: 'forgotten-crypt', name: 'Забытая крипта', effectId: null, effectSummary: 'Особое правило ещё не определено.', preferredStrongEnemies: Object.freeze([]), cursedChance: 0.2, lootKeywords: Object.freeze([]) }),
  Object.freeze({ id: 'flooded-grotto', name: 'Затопленный грот', effectId: null, effectSummary: 'Особое правило ещё не определено.', preferredStrongEnemies: Object.freeze([]), cursedChance: 0.2, lootKeywords: Object.freeze([]) }),
  Object.freeze({ id: 'ashen-shrine', name: 'Пепельное святилище', effectId: null, effectSummary: 'Особое правило ещё не определено.', preferredStrongEnemies: Object.freeze([]), cursedChance: 0.2, lootKeywords: Object.freeze([]) }),
  Object.freeze({ id: 'lost-mine', name: 'Затерянная шахта', effectId: null, effectSummary: 'Особое правило ещё не определено.', preferredStrongEnemies: Object.freeze([]), cursedChance: 0.2, lootKeywords: Object.freeze([]) }),
]);

export const getSublocationCatalogForLocation = locationId =>
  locationId === 'Гоблинские Норы' ? GOBLIN_SUBLOCATIONS
    : locationId === 'Шахты Тления' ? MINES_SUBLOCATIONS
    : LEGACY_SUBLOCATIONS;

export const getSublocationIdsForLocation = locationId =>
  getSublocationCatalogForLocation(locationId).map(entry => entry.id);

export const getSublocationDefinition = (locationId, sublocationId) =>
  getSublocationCatalogForLocation(locationId).find(entry => entry.id === sublocationId) || null;

export const isRatRelatedEnemy = enemy =>
  /крыс/i.test(String(enemy?.name || ''));

// Flat initiative scale: 1000 = one full turn meter. Opening tempo never changes Speed.
export const RAT_RIDERS_START_METER = Object.freeze({ other: 150, rat: 300 });

export const applySublocationEnemyModifiers = (locationId, sublocationId, enemies = []) => {
  const definition = getSublocationDefinition(locationId, sublocationId);
  if (!definition || definition.effectId !== 'rat-riders') return enemies.map(enemy => ({ ...enemy }));
  return enemies.map(enemy => {
    const bonus = isRatRelatedEnemy(enemy) ? RAT_RIDERS_START_METER.rat : RAT_RIDERS_START_METER.other;
    // Keep the helper idempotent if encounter blueprints are decorated more than once.
    if (enemy.expeditionSublocationStartingMeterBonus === bonus) return { ...enemy };
    return {
      ...enemy,
      startingTurnMeterBonus: Math.max(0, Number(enemy.startingTurnMeterBonus) || 0) + bonus,
      expeditionSublocationStartingMeterBonus: bonus,
    };
  });
};

