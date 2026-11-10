// Authored Ruins of the Restless roster. Deliberately kept separate from Level 1/Forest.
const LOCATION = 'Руины Неупокоенных';
const normal = (name, portraitKey, maxHp, attack, magAtk, speed, physDef, magicDef, abilityNames, roleDescription) => ({
  name, portraitKey, location: LOCATION, maxHp, hp: maxHp, attack, magAtk, speed, physDef, magicDef,
  mana: magAtk > attack ? 100 : 0, roomRole: 'normalEnemy', roleDescription, abilityNames,
  loot: [], silverReward: 0,
});
const strong = (name, portraitKey, maxHp, attack, magAtk, speed, physDef, magicDef, abilityNames, roleDescription) => ({
  ...normal(name, portraitKey, maxHp, attack, magAtk, speed, physDef, magicDef, abilityNames, roleDescription),
  roomRole: 'strongEnemy', encounterPhase: 'late',
});
const elite = (name, portraitKey, maxHp, attack, magAtk, speed, physDef, magicDef, abilityNames, roleDescription) => ({
  ...normal(name, portraitKey, maxHp, attack, magAtk, speed, physDef, magicDef, abilityNames, roleDescription),
  roomRole: 'cursedEnemy', encounterPhase: 'elite', miniBoss: true, cursed: true,
  skipWarpedAutoAbilities: true, authoredStats: true,
});
const summon = (name, portraitKey, maxHp, attack, speed, abilityNames, roleDescription, extra = {}) => ({
  ...normal(name, portraitKey, maxHp, attack, 0, speed, 6, 6, abilityNames, roleDescription),
  roomRole: 'summon', summonOnly: true, summoned: true, rewardBearing: false, ...extra,
});

export const RESTLESS_RUINS_ENEMIES = [
  normal('Глашатай мёртвого марша', 'dead_march_herald', 205, 7, 23, 128, 4, 2,
    ['Призыв павшей когорты', 'Погребальная дробь'], 'Продвигает ход союзников и готовит их следующий навык к Эху.'),
  normal('Сдвоенный бастион', 'twin_bastion', 310, 22, 1, 112, 9, 3,
    ['Несокрушимый строй', 'Сдвоенный таран'], 'Прикрывает союзников Щитом и Защитой союзников.'),
  normal('Заклинатель двух душ', 'two_soul_conjurer', 210, 8, 25, 131, 3, 2,
    ['Погребальный холод', 'Два голоса зимы'], 'Накладывает Обморожение и готовит следующий навык к Эху.'),
  normal('Всадник последнего похода', 'last_march_rider', 225, 24, 1, 145, 5, 2,
    ['Загробный галоп', 'Последний натиск'], 'Контроль шкалы хода и физический добивающий удар.'),
  normal('Раздробленный копейщик', 'shattered_spearman', 260, 23, 1, 118, 7, 2,
    ['Скрещённые копья', 'Клятва павших'], 'Усиливается после гибели союзников.'),
  strong('Двутелый дуэлянт', 'twin_duelist', 340, 29, 1, 145, 7, 2,
    ['Четыре клинка', 'Приговор двух душ', 'Согласие двух душ'], 'Четыре удара с нарастающим шансом критического попадания.'),
  strong('Знаменосец павшей когорты', 'fallen_cohort_standard_bearer', 390, 24, 1, 118, 9, 3,
    ['Знамя павшей когорты', 'Когорта не падёт', 'Под павшим знаменем'], 'Призывает атакующую ауру-знамя, защищает союзников Бессмертием.'),
  strong('Сшиватель душ', 'soul_stitcher', 310, 7, 28, 134, 5, 3,
    ['Сшить заново', 'Покинутая оболочка'], 'Даёт всем союзникам Перерождение и временно становится спектральным.'),
  elite('Осадный урод — Осквернение', 'defiled_siege_abomination', 1110, 37, 1, 120, 20, 8,
    ['Пролом строя', 'Мясной таран', 'Кровавая инерция'], 'Неостановимая подготовленная атака через собственное Кровотечение.'),
  elite('Кристальный мертвострел — Искажение', 'distorted_crystal_deadshot', 1030, 32, 1, 146, 20, 25,
    ['Пристрелочный скол', 'Преломлённый выстрел', 'Кристаллическая память'], 'Запоминает предотвращённый прямой урон и возвращает его следующей стрелой.'),
  {
    ...strong('Легион Погребённых', 'buried_legion', 1950, 34, 1, 135, 16, 5,
      ['Отделение шеренги', 'Приказ на прорыв', 'Восстановить строй', 'Последняя шеренга', 'Последний приказ'],
      'Двухфазный босс-призыватель; на 50% здоровья собирает погребённых солдат обратно.'),
    roomRole: 'boss', encounterPhase: 'boss', boss: true, authoredStats: true, _legionPhase: 1,
    guaranteedLoot: [], silverReward: 0,
  },
  summon('Погребённый щитоносец', 'buried_shieldbearer', 180, 17, 110,
    ['Удар погребённого щитоносца'], 'Пока жив, уменьшает прямой урон по Легиону на 20%.',
    { physDef: 9, magicDef: 2, ruinsLegionSoldier: true }),
  summon('Погребённый рубака', 'buried_swordsman', 145, 20, 125,
    ['Удар погребённого рубаки'], '150% физической атаки по одной цели.',
    { physDef: 5, magicDef: 2, ruinsLegionSoldier: true }),
  summon('Знамя павшей когорты', 'fallen_cohort_banner', 150, 0, 0, [],
    'Неподвижная уничтожаемая аура: +25% прямого урона живым союзникам.',
    { physDef: 6, magicDef: 2, nonActingSummon: true, nonBlocking: true, noPositiveEffects: true, ruinsBanner: true }),
];
