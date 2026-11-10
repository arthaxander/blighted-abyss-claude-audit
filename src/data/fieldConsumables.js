// Shared catalogue: inventory metadata, recipes and combat payloads use the same entries.
const recipe = (...pairs) => pairs.map(([name, quantity = 1]) => ({ name, quantity }));

export const FIELD_CONSUMABLES = [
  {
    id: 'weakening_scroll', name: 'Свиток уязвимости', category: 'scroll',
    description: 'Усиливает ФА или МА героя на 25% на 2 хода, снижает соответствующую защиту выбранного врага на 25% на 2 хода, затем наносит ему 100% соответствующей атаки.',
    craft: recipe(['Простая ткань'], ['Простые чернила'], ['Кровяной мох']),
    combat: { type: 'tacticalScroll', target: 'enemy', kind: 'vulnerabilityStrike' },
  },
  {
    id: 'shield_fracture_scroll', name: 'Свиток кражи щита', category: 'scroll', abyssLevel: 2,
    description: 'Крадёт половину текущего [Щита] выбранной цели, передавая его герою на 2 хода. У остальных врагов разрушает половину [Щита]. Не наносит урон.',
    craft: recipe(['Глубинное полотно'], ['Рунические чернила'], ['Эфирный прах', 2]),
    combat: { type: 'tacticalScroll', target: 'enemy', kind: 'shieldTheft' },
  },
  {
    id: 'dispel_scroll', name: 'Свиток рассеивания', category: 'scroll', abyssLevel: 2,
    description: 'Снимает все снимаемые положительные эффекты с одной цели. Врождённые свойства и неснимаемые эффекты сохраняются.',
    craft: recipe(['Глубинное полотно'], ['Рунические чернила'], ['Тлеющий шлак', 2]),
    combat: { type: 'tacticalScroll', target: 'enemy', kind: 'dispelAll' },
  },
  {
    id: 'defensive_infusion', name: 'Защитный настой', category: 'medicine', abyssLevel: 2, chestChance: 0.15, enemyChance: 0.05,
    description: 'Даёт 35 [Щита] и [Оберег] (+25% магической защиты) на 2 хода. Используется без расходования основного действия.',
    craft: recipe(['Простая склянка'], ['Сумрачный сплав'], ['Глубинное полотно']),
    combat: { artId: 'reinforced_shield_potion', type: 'effects', target: 'self', effects: [
      { id: 'shield', duration: 2, value: 35 }, { id: 'magic_def_boost_minor', duration: 2 },
    ] },
  },
  {
    id: 'cleansing_compound', name: 'Очищающий состав', category: 'medicine', abyssLevel: 2, chestChance: 0.15, enemyChance: 0.05,
    description: 'Снимает один случайный снимаемый отрицательный эффект и даёт [Невосприимчивость] к новым отрицательным эффектам на 2 хода. Используется без расходования основного действия.',
    craft: recipe(['Простая склянка'], ['Глубинное полотно'], ['Эфирный прах']),
    combat: { artId: 'minor_cleanse_potion', type: 'cleanseGuard', target: 'self', cleanseCount: 1, protectionDuration: 2 },
  },
  {
    id: 'predatory_shoots_trap', name: 'Западня хищных побегов', category: 'trap', abyssLevel: 2, locationTag: 'withering_forest', chestChance: 0.12, enemyChance: 0.05,
    description: 'Перед действием активировавшего врага накладывает всем врагам [Зарастание] на 4 хода; активатор получает [Проклятие исцеления] на 2 хода и 50% большей ФА/МА установившего уроном Природы. При срабатывании герой получает +40% шкалы хода.',
    craft: recipe(['Выделанная кожа Бездны'], ['Горькая живица', 2], ['Чёрная сердцевина']),
    trap: { kind: 'predatoryShoots', turnMeterGain: 400, effects: [
      { id: 'overgrowth', duration: 4 }, { id: 'healing_curse', duration: 2 },
    ] },
  },
  {
    id: 'burial_seal_trap', name: 'Погребальная печать', category: 'trap', abyssLevel: 2, locationTag: 'restless_ruins', chestChance: 0.12, enemyChance: 0.05,
    description: 'При активации всем врагам накладывается [Магическая слабость] на 2 хода, активатору — [Уязвимость] на 2 хода. Призывает призрачного союзника (150 здоровья, скорость 100, 75% шкалы хода, МА равна 100% большей ФА/МА героя), который 2 своих хода атакует активатора, затем случайного живого врага.',
    craft: recipe(['Глубинное полотно'], ['Погребальный воск'], ['Осколки погребальных печатей', 2]),
    trap: { kind: 'burialSeal', effects: [
      { id: 'magic_def_penalty_minor', duration: 2 }, { id: 'vulnerability', duration: 2 },
    ] },
  },
  {
    id: 'fire_field_trap', name: 'Огненная западня', category: 'trap', abyssLevel: 2, locationTag: 'mines_of_decay', chestChance: 0.12, enemyChance: 0.05,
    description: 'При срабатывании наносит активатору 70% большей ФА/МА установившего, другим врагам — 35% от этого урона; активатор получает [Горение] на 2 хода.',
    craft: recipe(['Сумрачный сплав'], ['Шахтная соль'], ['Горючий битум', 2]),
    trap: { kind: 'fire', effects: [{ id: 'burn', duration: 2 }] },
  },
  {
    id: 'barbed_field_trap', name: 'Колючая западня', category: 'trap',
    description: 'Установка за ход. Перед следующим действием врага накладывает [Кровотечение] на 2 хода на всех врагов; активировавшему наносит 70% большей из ФА и МА. Одно срабатывание, не более одной подготовленной западни.',
    craft: recipe(['Металлические обломки', 3], ['Обрывки кожи']),
    trap: { kind: 'barbed', effects: [{ id: 'bleed', duration: 2 }] },
  },
  {
    id: 'binding_field_trap', name: 'Липкая западня', category: 'trap',
    description: 'Установка за ход. При срабатывании все враги теряют 15% шкалы хода и получают [Замедление] на 2 хода, кроме невосприимчивых к контролю. Активировавший получает два [Отравления] на 2 хода.',
    craft: recipe(['Обрывки кожи'], ['Слизь мохоспора'], ['Блуждающие споры']),
    trap: { kind: 'binding', effects: [{ id: 'speed_penalty_minor', duration: 2 }] },
  },
];

export const FIELD_CONSUMABLE_ITEM_DATA = FIELD_CONSUMABLES.map(entry => ({
  name: entry.name, type: 'consumable', category: entry.category, rarity: 'Обычная', stackSize: entry.category === 'medicine' ? 5 : 3,
  ...(entry.abyssLevel >= 2 ? {
    sourceTier: entry.locationTag ? 'location' : 'common',
    sourceTags: ['level2', entry.locationTag || 'common'],
  } : {}),
  description: entry.description, craft: entry.craft,
  ...(entry.chestChance ? { chestChance: entry.chestChance } : {}),
  ...(entry.enemyChance ? { enemyChance: entry.enemyChance } : {}),
  ...(entry.trap ? { usableInCombat: true } : {}),
}));
export const FIELD_CONSUMABLE_COMBAT_DATA = Object.fromEntries(FIELD_CONSUMABLES.map(entry => [entry.name, {
  ...(entry.combat || { type: 'preparedTrap', target: 'self', kind: entry.trap?.kind, turnMeterGain: entry.trap?.turnMeterGain || 0 }),
  description: entry.description,
}]));

// Floor 1 scrolls use simple ink; Floor 2 scrolls use runic ink and regional reagents.
export const ADDITIONAL_FIELD_RECIPES = [
  ['minor_defense', 'Малое зелье защиты', 'medicine', recipe(['Простая склянка'], ['Металлические обломки'])],
  ['minor_speed', 'Малое зелье скорости', 'medicine', recipe(['Простая склянка'], ['Кровяной мох'], ['Обрывки кожи'])],
  ['minor_antimagic', 'Малое зелье антимагии', 'medicine', recipe(['Простая склянка'], ['Пыльца серого спорника'])],
  ['minor_cleanse', 'Малое зелье очищения', 'medicine', recipe(['Простая склянка'], ['Кровяной мох'], ['Простая ткань'])],
  ['fireball', 'Свиток Огненного шара', 'scroll', recipe(['Простая ткань'], ['Простые чернила'], ['Пепел гоблинского перца', 2])],
  ['poison_cloud', 'Свиток Ядовитого облака', 'scroll', recipe(['Простая ткань'], ['Простые чернила'], ['Блуждающие споры', 2])],
  ['healing_scroll', 'Свиток Лечения', 'scroll', recipe(['Простая ткань'], ['Простые чернила'], ['Кровяной мох', 3])],
  ['ice_cone', 'Свиток Конус льда', 'scroll', recipe(['Простая ткань'], ['Простые чернила'], ['Сумеречный вереск', 2])],
  ['blood_touch', 'Свиток Кровавого касания', 'scroll', recipe(['Простая ткань'], ['Простые чернила'], ['Кровяной мох', 2], ['Обрывки кожи'])],
  ['level_two_heal', 'Зелье здоровья', 'medicine', recipe(['Простая склянка'], ['Кровяной мох', 3]), 2],
  ['last_spring', 'Настой последней весны', 'medicine', recipe(['Простая склянка'], ['Цветок последней весны']), 2],
  ['bitter_resin', 'Настой горькой живицы', 'medicine', recipe(['Простая склянка'], ['Горькая живица', 2]), 2],
  ['clinging_roots', 'Свиток цепких корней', 'scroll', recipe(['Глубинное полотно'], ['Рунические чернила'], ['Горькая живица', 2]), 2],
].map(([id, name, category, ingredients, abyssLevel = 1]) => ({ id, name, category, ingredients, abyssLevel }));
