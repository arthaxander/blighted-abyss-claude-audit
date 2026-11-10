import { isStrongEnemy, isStrongPoolAvailable, PRODUCTION_LEVEL_ONE_TUNING } from './levelOneProgression';

export const GOBLIN_LOCATION = 'Гоблинские Норы';
export const FUNGAL_LOCATION = 'Грибные Пещеры';
export const DESERTER_LOCATION = 'Лагерь Отступников';
export const WITHERING_FOREST_LOCATION = 'Лес Увядания';
export const RESTLESS_RUINS_LOCATION = 'Руины Неупокоенных';
// TODO: Consider 'Руины Отступников' as a flavor variant or sub-location, not a runtime key.

export const isCursedRoomEnemy = (enemy) =>
  Boolean(enemy?.roomRole === 'cursedEnemy' || enemy?.miniBoss || enemy?.encounterPhase === 'elite');

export const MUSHROOM_ENCOUNTER_FAMILIES = Object.freeze({
  NORMAL: 'normal_troglodytes',
  FUNGAL: 'fungal_troglodytes',
});

export const EARLY_FUNGAL_FAMILY_MULTIPLIER = 0.7;

export const getEncounterProgressionPhase = (completedCombatRooms = 0, tuning = PRODUCTION_LEVEL_ONE_TUNING) => {
  if (completedCombatRooms >= tuning.roomPhaseLate) return 'late';
  if (completedCombatRooms >= tuning.roomPhaseMid) return 'mid';
  return 'early';
};

export const getTrashEnemyPool = ({ nonBossEnemies = [], selectedLocation, completedCombatRooms = 0, tuning = PRODUCTION_LEVEL_ONE_TUNING, expeditionRegion = null } = {}) => {
  const normalEnemies = nonBossEnemies.filter(enemy => !enemy?.summonOnly && !isCursedRoomEnemy(enemy));
  const phaseEligible = normalEnemies.filter(enemy => enemy.encounterPhase !== 'elite');

  if (selectedLocation === GOBLIN_LOCATION) {
    const earlyEnemies = phaseEligible.filter(enemy => !isStrongEnemy(enemy));
    if (expeditionRegion === 'approach') return earlyEnemies;
    if (!isStrongPoolAvailable(completedCombatRooms, tuning) && earlyEnemies.length > 0) return earlyEnemies;
    return phaseEligible;
  }

  if (
    selectedLocation === FUNGAL_LOCATION ||
    selectedLocation === DESERTER_LOCATION ||
    selectedLocation === WITHERING_FOREST_LOCATION ||
    selectedLocation === RESTLESS_RUINS_LOCATION ||
    selectedLocation === MINES_OF_DECAY_LOCATION
  ) {
    const earlyEnemies = phaseEligible.filter(enemy => !isStrongEnemy(enemy));
    if (!isStrongPoolAvailable(completedCombatRooms, tuning) && earlyEnemies.length > 0) return earlyEnemies;
    return phaseEligible;
  }

  return phaseEligible;
};

export const getCursedEnemyPool = (nonBossEnemies = []) =>
  nonBossEnemies.filter(enemy => !enemy?.summonOnly && isCursedRoomEnemy(enemy));

/** Canonical cursed-room encounter: exactly one authored primary enemy. */
export const createCursedEncounter = (
  nonBossEnemies = [],
  rng = Math.random,
  { weightOf = null } = {}
) => {
  const pool = getCursedEnemyPool(nonBossEnemies);
  if (pool.length === 0) return null;
  let enemy = null;
  if (typeof weightOf === 'function') {
    const weighted = pool.map(entry => ({
      entry,
      weight: Math.max(0, Number(weightOf(entry)) || 0),
    })).filter(item => item.weight > 0);
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (total > 0) {
      let roll = rng() * total;
      enemy = weighted.find(item => ((roll -= item.weight) <= 0))?.entry
        || weighted[weighted.length - 1]?.entry
        || null;
    }
  }
  if (!enemy) {
    const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    enemy = pool[index];
  }
  return { enemies: [enemy], miniBoss: Boolean(enemy.miniBoss), cursedEnemy: true };
};

const forestTemplate = (names, weight, strength = 'normal') => Object.freeze({
  names: Object.freeze(names),
  weight,
  strength,
  key: [...names].sort((a, b) => a.localeCompare(b, 'ru')).join('|'),
});

export const MINES_OF_DECAY_LOCATION = 'Шахты Тления';

// Curated three-enemy encounters. Strong packs always contain exactly one
// Strong and two normal enemies. These packs are staged, not selectable while
// the Level 2 Mines location remains disabled.
export const MINES_NORMAL_TEMPLATES = Object.freeze([
  forestTemplate(['Обугленный громила', 'Рудный носильщик', 'Закованный охранник'], 3),
  forestTemplate(['Шахтёр с киркой', 'Рудный носильщик', 'Тлеющий бык'], 3),
  forestTemplate(['Обугленный громила', 'Шахтёр с киркой', 'Закованный охранник'], 2),
  forestTemplate(['Тлеющий бык', 'Обугленный громила', 'Рудный носильщик'], 2),
  forestTemplate(['Шахтёр с киркой', 'Закованный охранник', 'Рудный носильщик'], 3),
  forestTemplate(['Тлеющий бык', 'Закованный охранник', 'Шахтёр с киркой'], 2),
  forestTemplate(['Обугленный громила', 'Обугленный громила', 'Рудный носильщик'], 1),
  forestTemplate(['Рудный носильщик', 'Шахтёр с киркой', 'Шахтёр с киркой'], 1),
]);
export const MINES_STRONG_TEMPLATES = Object.freeze([
  forestTemplate(['Старший надзиратель', 'Рудный носильщик', 'Шахтёр с киркой'], 3, 'strong'),
  forestTemplate(['Старший надзиратель', 'Тлеющий бык', 'Обугленный громила'], 2, 'strong'),
  forestTemplate(['Старший надзиратель', 'Шахтёр с киркой', 'Закованный охранник'], 2, 'strong'),
  forestTemplate(['Мастер крепей', 'Закованный охранник', 'Обугленный громила'], 3, 'strong'),
  forestTemplate(['Мастер крепей', 'Тлеющий бык', 'Рудный носильщик'], 2, 'strong'),
  forestTemplate(['Мастер крепей', 'Шахтёр с киркой', 'Закованный охранник'], 2, 'strong'),
  forestTemplate(['Забывший маркшейдер', 'Закованный охранник', 'Рудный носильщик'], 3, 'strong'),
  forestTemplate(['Забывший маркшейдер', 'Тлеющий бык', 'Шахтёр с киркой'], 2, 'strong'),
  forestTemplate(['Забывший маркшейдер', 'Обугленный громила', 'Закованный охранник'], 2, 'strong'),
]);
export const createMinesOfDecayEncounter = (
  pool = [],
  rng = Math.random,
  { completedCombatRooms = 0, tuning = PRODUCTION_LEVEL_ONE_TUNING,
    previousTemplateKey = null, requireStrong = false } = {}
) => {
  const byName = new Map(pool.filter(enemy =>
    enemy?.location === MINES_OF_DECAY_LOCATION && !enemy.summonOnly &&
    !isCursedRoomEnemy(enemy) && !enemy.boss
  ).map(enemy => [enemy.name, enemy]));
  const authored = requireStrong
    ? MINES_STRONG_TEMPLATES
    : isStrongPoolAvailable(completedCombatRooms, tuning)
      ? [...MINES_NORMAL_TEMPLATES, ...MINES_STRONG_TEMPLATES]
      : MINES_NORMAL_TEMPLATES;
  let candidates = authored.map(template => ({
    ...template, enemies: template.names.map(name => byName.get(name)),
  })).filter(template => template.enemies.every(Boolean));
  if (previousTemplateKey && candidates.length > 1) {
    const alternatives = candidates.filter(template => template.key !== previousTemplateKey);
    if (alternatives.length) candidates = alternatives;
  }
  const chosen = weightedPick(candidates, template => template.weight, rng);
  return chosen ? {
    enemies: [...chosen.enemies], miniBoss: false,
    encounterTemplateKey: chosen.key, encounterStrength: chosen.strength,
  } : null;
};

// Authored 15 Sep 2026 Forest packs. Anything not listed here is forbidden.
export const WITHERING_FOREST_NORMAL_TEMPLATES = Object.freeze([
  forestTemplate(['Ведьма Лепестков', 'Эльфийская лучница', 'Терновый страж'], 3),
  forestTemplate(['Ведьма Лепестков', 'Эльфийская лучница', 'Тень чащи'], 3),
  forestTemplate(['Ведьма Лепестков', 'Эльфийская лучница', 'Сеятель Гнуса'], 3),
  forestTemplate(['Ведьма Лепестков', 'Терновый страж', 'Тень чащи'], 2),
  forestTemplate(['Ведьма Лепестков', 'Тень чащи', 'Сеятель Гнуса'], 2),
  forestTemplate(['Эльфийская лучница', 'Терновый страж', 'Тень чащи'], 1),
  forestTemplate(['Эльфийская лучница', 'Терновый страж', 'Сеятель Гнуса'], 1),
  forestTemplate(['Эльфийская лучница', 'Тень чащи', 'Сеятель Гнуса'], 2),
  forestTemplate(['Эльфийская лучница', 'Эльфийская лучница', 'Ведьма Лепестков'], 2),
  forestTemplate(['Эльфийская лучница', 'Эльфийская лучница', 'Сеятель Гнуса'], 1),
  forestTemplate(['Тень чащи', 'Тень чащи', 'Ведьма Лепестков'], 1),
  forestTemplate(['Тень чащи', 'Тень чащи', 'Эльфийская лучница'], 1),
]);

export const WITHERING_FOREST_STRONG_TEMPLATES = Object.freeze([
  forestTemplate(['Жнец лесов', 'Ведьма Лепестков', 'Эльфийская лучница'], 3, 'strong'),
  forestTemplate(['Жнец лесов', 'Ведьма Лепестков', 'Тень чащи'], 2, 'strong'),
  forestTemplate(['Жнец лесов', 'Ведьма Лепестков', 'Терновый страж'], 1, 'strong'),
  forestTemplate(['Жнец лесов', 'Эльфийская лучница', 'Сеятель Гнуса'], 2, 'strong'),
  forestTemplate(['Совиный друид', 'Эльфийская лучница', 'Тень чащи'], 2, 'strong'),
  forestTemplate(['Совиный друид', 'Эльфийская лучница', 'Терновый страж'], 1, 'strong'),
  forestTemplate(['Совиный друид', 'Эльфийская лучница', 'Сеятель Гнуса'], 1, 'strong'),
  forestTemplate(['Совиный друид', 'Эльфийская лучница', 'Эльфийская лучница'], 1, 'strong'),
  forestTemplate(['Друид-медведь', 'Ведьма Лепестков', 'Эльфийская лучница'], 3, 'strong'),
  forestTemplate(['Друид-медведь', 'Ведьма Лепестков', 'Тень чащи'], 1, 'strong'),
  forestTemplate(['Друид-медведь', 'Эльфийская лучница', 'Сеятель Гнуса'], 2, 'strong'),
  forestTemplate(['Друид-медведь', 'Эльфийская лучница', 'Тень чащи'], 2, 'strong'),
]);

const resolveForestTemplate = (template, byName) => {
  const enemies = template.names.map(name => byName.get(name)).filter(Boolean);
  return enemies.length === template.names.length ? { ...template, enemies } : null;
};

export const createWitheringForestEncounter = (
  pool = [],
  rng = Math.random,
  { completedCombatRooms = 0, tuning = PRODUCTION_LEVEL_ONE_TUNING, previousTemplateKey = null, requireStrong = false } = {}
) => {
  const byName = new Map(pool.filter(enemy => enemy && !enemy.summonOnly && !isCursedRoomEnemy(enemy))
    .map(enemy => [enemy.name, enemy]));
  const authored = requireStrong
    ? [...WITHERING_FOREST_STRONG_TEMPLATES]
    : isStrongPoolAvailable(completedCombatRooms, tuning)
    ? [...WITHERING_FOREST_NORMAL_TEMPLATES, ...WITHERING_FOREST_STRONG_TEMPLATES]
    : [...WITHERING_FOREST_NORMAL_TEMPLATES];
  let candidates = authored.map(template => resolveForestTemplate(template, byName)).filter(Boolean);
  if (!candidates.length) return null;
  if (previousTemplateKey && candidates.length > 1) {
    const alternatives = candidates.filter(template => template.key !== previousTemplateKey);
    if (alternatives.length) candidates = alternatives;
  }
  const chosen = weightedPick(candidates, template => template.weight, rng);
  if (!chosen) return null;
  return {
    enemies: [...chosen.enemies],
    miniBoss: false,
    encounterTemplateKey: chosen.key,
    encounterStrength: chosen.strength,
  };
};


export const RESTLESS_RUINS_NORMAL_TEMPLATES = Object.freeze([
  forestTemplate(['Глашатай мёртвого марша', 'Сдвоенный бастион', 'Заклинатель двух душ'], 2),
  forestTemplate(['Глашатай мёртвого марша', 'Всадник последнего похода', 'Раздробленный копейщик'], 2),
  forestTemplate(['Сдвоенный бастион', 'Заклинатель двух душ', 'Раздробленный копейщик'], 2),
  forestTemplate(['Глашатай мёртвого марша', 'Заклинатель двух душ', 'Всадник последнего похода'], 2),
  forestTemplate(['Сдвоенный бастион', 'Всадник последнего похода', 'Раздробленный копейщик'], 3),
  forestTemplate(['Сдвоенный бастион', 'Глашатай мёртвого марша', 'Раздробленный копейщик'], 2),
  forestTemplate(['Заклинатель двух душ', 'Всадник последнего похода', 'Раздробленный копейщик'], 2),
  forestTemplate(['Сдвоенный бастион', 'Заклинатель двух душ', 'Всадник последнего похода'], 2),
]);
export const RESTLESS_RUINS_STRONG_TEMPLATES = Object.freeze([
  forestTemplate(['Двутелый дуэлянт', 'Сдвоенный бастион', 'Глашатай мёртвого марша'], 2, 'strong'),
  forestTemplate(['Двутелый дуэлянт', 'Заклинатель двух душ', 'Раздробленный копейщик'], 2, 'strong'),
  forestTemplate(['Знаменосец павшей когорты', 'Всадник последнего похода', 'Заклинатель двух душ'], 2, 'strong'),
  forestTemplate(['Знаменосец павшей когорты', 'Сдвоенный бастион', 'Раздробленный копейщик'], 2, 'strong'),
  forestTemplate(['Сшиватель душ', 'Раздробленный копейщик', 'Всадник последнего похода'], 2, 'strong'),
  forestTemplate(['Сшиватель душ', 'Глашатай мёртвого марша', 'Заклинатель двух душ'], 2, 'strong'),
]);
export const createRestlessRuinsEncounter = (
  pool = [], rng = Math.random,
  { completedCombatRooms = 0, tuning = PRODUCTION_LEVEL_ONE_TUNING, requireStrong = false } = {}
) => {
  const byName = new Map(pool.filter(enemy => enemy && !enemy.summonOnly && !isCursedRoomEnemy(enemy))
    .map(enemy => [enemy.name, enemy]));
  const templates = requireStrong
    ? RESTLESS_RUINS_STRONG_TEMPLATES
    : isStrongPoolAvailable(completedCombatRooms, tuning)
      ? [...RESTLESS_RUINS_NORMAL_TEMPLATES, ...RESTLESS_RUINS_STRONG_TEMPLATES]
      : RESTLESS_RUINS_NORMAL_TEMPLATES;
  const candidates = templates.map(template => resolveForestTemplate(template, byName)).filter(Boolean);
  const chosen = weightedPick(candidates, template => template.weight, rng);
  return chosen ? {
    enemies: [...chosen.enemies], miniBoss: false,
    encounterTemplateKey: chosen.key, encounterStrength: chosen.strength,
  } : null;
};

export const MUSHROOM_DUPLICATE_CHANCE = 0.2;
export const EARLY_FUNGAL_DUPLICATE_CHANCE = 0.4;
export const MUSHROOM_DUPLICATE_WEIGHTS = Object.freeze({
  'Троглодит-копейщик': 1,
  'Троглодит-заражённый': 1,
  'Заражённый троглодит': 1,
  'Троглодит-споровик': 1,
  'Одичавший троглодит': 0.5,
});
export const MUSHROOM_DUPLICATE_EXCLUSIONS = Object.freeze([
  'Троглодит-заклинатель змей', 'Троглодит-шаман', 'Костестраж', 'Змеиный двоеглав',
]);

const weightedPick = (entries, weightOf, rng) => {
  const weighted = entries.map(entry => ({ entry, weight: Math.max(0, weightOf(entry) || 0) })).filter(item => item.weight > 0);
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  return weighted.find(item => ((roll -= item.weight) <= 0))?.entry || weighted[weighted.length - 1]?.entry || null;
};

const mushroomTemplate = (names, weight, family, strength = 'normal') => Object.freeze({
  names: Object.freeze(names),
  weight,
  family,
  strength,
  key: [...names].sort((a, b) => a.localeCompare(b, 'ru')).join('|'),
});

// L1 Mushroom Caves: authored three-primary-enemy packs only.
// Normal and fungal troglodytes are separate encounter families and never mix.
export const MUSHROOM_NORMAL_TEMPLATES = Object.freeze([
  mushroomTemplate(['Троглодит-копейщик', 'Троглодит-заклинатель змей', 'Троглодит-шаман'], 4, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL),
  mushroomTemplate(['Троглодит-копейщик', 'Троглодит-копейщик', 'Троглодит-шаман'], 3, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL),
  mushroomTemplate(['Троглодит-копейщик', 'Троглодит-копейщик', 'Троглодит-заклинатель змей'], 2, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL),
  mushroomTemplate(['Троглодит-копейщик', 'Троглодит-заклинатель змей', 'Троглодит-заклинатель змей'], 1, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL),
  mushroomTemplate(['Троглодит-копейщик', 'Троглодит-шаман', 'Троглодит-шаман'], 2, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL),
]);

export const MUSHROOM_FUNGAL_TEMPLATES = Object.freeze([
  mushroomTemplate(['Троглодит-заражённый', 'Троглодит-заражённый', 'Троглодит-споровик'], 3, MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL),
  mushroomTemplate(['Троглодит-заражённый', 'Троглодит-споровик', 'Троглодит-споровик'], 2, MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL),
  mushroomTemplate(['Троглодит-заражённый', 'Троглодит-заражённый', 'Троглодит-заражённый'], 1, MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL),
]);

export const MUSHROOM_NORMAL_STRONG_TEMPLATES = Object.freeze([
  mushroomTemplate(['Костестраж', 'Троглодит-копейщик', 'Троглодит-шаман'], 3, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL, 'strong'),
  mushroomTemplate(['Костестраж', 'Троглодит-копейщик', 'Троглодит-заклинатель змей'], 2, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL, 'strong'),
  mushroomTemplate(['Костестраж', 'Троглодит-шаман', 'Троглодит-заклинатель змей'], 1, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL, 'strong'),
  mushroomTemplate(['Змеиный двоеглав', 'Троглодит-заклинатель змей', 'Троглодит-копейщик'], 3, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL, 'strong'),
  mushroomTemplate(['Змеиный двоеглав', 'Троглодит-заклинатель змей', 'Троглодит-шаман'], 2, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL, 'strong'),
  mushroomTemplate(['Змеиный двоеглав', 'Троглодит-копейщик', 'Троглодит-шаман'], 1, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL, 'strong'),
]);

export const MUSHROOM_FUNGAL_STRONG_TEMPLATES = Object.freeze([
  mushroomTemplate(['Одичавший троглодит', 'Троглодит-заражённый', 'Троглодит-споровик'], 3, MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL, 'strong'),
  mushroomTemplate(['Одичавший троглодит', 'Троглодит-заражённый', 'Троглодит-заражённый'], 2, MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL, 'strong'),
  mushroomTemplate(['Одичавший троглодит', 'Троглодит-споровик', 'Троглодит-споровик'], 1, MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL, 'strong'),
]);

const resolveMushroomTemplate = (template, byName) => {
  const resolved = template.names.map(name => byName.get(name)).filter(Boolean);
  return resolved.length === template.names.length ? { ...template, enemies: resolved } : null;
};

export const createMushroomCavesEncounter = (
  pool = [],
  rng = Math.random,
  { completedCombatRooms = 0, tuning = PRODUCTION_LEVEL_ONE_TUNING, requireStrong = false } = {}
) => {
  const byName = new Map(
    pool
      .filter(enemy => enemy && !enemy.summonOnly && !isCursedRoomEnemy(enemy))
      .map(enemy => [enemy.name, enemy])
  );
  const ordinary = [...MUSHROOM_NORMAL_TEMPLATES, ...MUSHROOM_FUNGAL_TEMPLATES];
  const strong = [...MUSHROOM_NORMAL_STRONG_TEMPLATES, ...MUSHROOM_FUNGAL_STRONG_TEMPLATES];
  const authored = requireStrong
    ? strong
    : isStrongPoolAvailable(completedCombatRooms, tuning)
    ? [...ordinary, ...strong]
    : ordinary;
  const candidates = authored.map(template => resolveMushroomTemplate(template, byName)).filter(Boolean);
  const chosen = weightedPick(candidates, template => template.weight, rng);
  if (!chosen) return null;
  return {
    enemies: [...chosen.enemies],
    miniBoss: false,
    encounterTemplateKey: chosen.key,
    encounterFamily: chosen.family,
    encounterStrength: chosen.strength,
  };
};


const goblinTemplate = (names, weight, strength = 'normal') => Object.freeze({
  names: Object.freeze(names),
  weight,
  strength,
  key: [...names].sort((a, b) => a.localeCompare(b, 'ru')).join('|'),
});

// L1 Goblin Nests: authored three-primary-enemy packs.
// Ratmancer, Executioner, and Weaver never duplicate; only selected Crossbowman/Ripper duplicates are allowed.
export const GOBLIN_NORMAL_TEMPLATES = Object.freeze([
  goblinTemplate(['Гоблин-палач', 'Гоблин-арбалетчик', 'Гоблин-Ткач'], 3),
  goblinTemplate(['Гоблин-Потрошитель', 'Гоблин-арбалетчик', 'Гоблин-Ткач'], 3),
  goblinTemplate(['Крысомант из Нор', 'Гоблин-палач', 'Гоблин-Ткач'], 3),
  goblinTemplate(['Крысомант из Нор', 'Гоблин-Потрошитель', 'Гоблин-арбалетчик'], 2),
  goblinTemplate(['Крысомант из Нор', 'Гоблин-арбалетчик', 'Гоблин-Ткач'], 3),
  goblinTemplate(['Гоблин-палач', 'Гоблин-Потрошитель', 'Гоблин-Ткач'], 2),
  goblinTemplate(['Гоблин-палач', 'Гоблин-Потрошитель', 'Гоблин-арбалетчик'], 1),
  goblinTemplate(['Гоблин-арбалетчик', 'Гоблин-арбалетчик', 'Гоблин-Ткач'], 1),
  goblinTemplate(['Гоблин-Потрошитель', 'Гоблин-Потрошитель', 'Гоблин-Ткач'], 1),
]);

export const GOBLIN_STRONG_TEMPLATES = Object.freeze([
  goblinTemplate(['Крысиный матриарх', 'Крысомант из Нор', 'Гоблин-Ткач'], 2, 'strong'),
  goblinTemplate(['Крысиный матриарх', 'Крысомант из Нор', 'Гоблин-арбалетчик'], 2, 'strong'),
  goblinTemplate(['Крысиный матриарх', 'Гоблин-Потрошитель', 'Гоблин-Ткач'], 2, 'strong'),
  goblinTemplate(['Крысиный всадник', 'Гоблин-Ткач', 'Гоблин-арбалетчик'], 3, 'strong'),
  goblinTemplate(['Крысиный всадник', 'Гоблин-палач', 'Гоблин-Ткач'], 1, 'strong'),
  goblinTemplate(['Гоблин-огнепоклонник', 'Гоблин-палач', 'Гоблин-Ткач'], 2, 'strong'),
  goblinTemplate(['Гоблин-огнепоклонник', 'Гоблин-Потрошитель', 'Гоблин-арбалетчик'], 2, 'strong'),
  goblinTemplate(['Гоблин-огнепоклонник', 'Крысомант из Нор', 'Гоблин-Ткач'], 1, 'strong'),
]);

const resolveGoblinTemplate = (template, byName) => {
  const resolved = template.names.map(name => byName.get(name)).filter(Boolean);
  return resolved.length === template.names.length ? { ...template, enemies: resolved } : null;
};

export const createGoblinNestsEncounter = (
  pool = [],
  rng = Math.random,
  {
    completedCombatRooms = 0,
    tuning = PRODUCTION_LEVEL_ONE_TUNING,
    requireStrong = false,
    preferredStrongEnemies = [],
    preferredMultiplier = 4,
    expeditionRegion = null,
  } = {}
) => {
  const byName = new Map(
    pool
      .filter(enemy => enemy && !enemy.summonOnly && !isCursedRoomEnemy(enemy))
      .map(enemy => [enemy.name, enemy])
  );
  const authored = expeditionRegion === 'approach'
    ? [...GOBLIN_NORMAL_TEMPLATES]
    : requireStrong
    ? [...GOBLIN_STRONG_TEMPLATES]
    : isStrongPoolAvailable(completedCombatRooms, tuning)
    ? [...GOBLIN_NORMAL_TEMPLATES, ...GOBLIN_STRONG_TEMPLATES]
    : [...GOBLIN_NORMAL_TEMPLATES];
  const candidates = authored.map(template => resolveGoblinTemplate(template, byName)).filter(Boolean);
  const preferred = new Set(preferredStrongEnemies || []);
  const chosen = weightedPick(
    candidates,
    template => template.weight * (
      preferred.size > 0 && template.names.some(name => preferred.has(name))
        ? Math.max(1, Number(preferredMultiplier) || 1)
        : 1
    ),
    rng
  );
  if (!chosen) return null;
  return {
    enemies: [...chosen.enemies],
    miniBoss: false,
    encounterTemplateKey: chosen.key,
    encounterStrength: chosen.strength,
  };
};

export const resolveEncounterFamilyWeights = (pool = [], options = {}) => {
  const counts = pool.filter(Boolean).reduce((weights, enemy) => {
    const family = enemy.encounterFamily || 'unclassified';
    weights[family] = (weights[family] || 0) + 1;
    return weights;
  }, {});
  const feralAvailable = pool.some(enemy => enemy.name === 'Одичавший троглодит');
  if (
    options.location === FUNGAL_LOCATION &&
    !feralAvailable &&
    counts[MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL]
  ) {
    counts[MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL] *= EARLY_FUNGAL_FAMILY_MULTIPLIER;
  }
  return counts;
};

export const resolveEncounterDuplicateChance = ({ location, family, eligiblePool = [] } = {}) => {
  const feralAvailable = eligiblePool.some(enemy => enemy?.name === 'Одичавший троглодит');
  if (
    location === FUNGAL_LOCATION &&
    family === MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL &&
    !feralAvailable
  ) {
    return EARLY_FUNGAL_DUPLICATE_CHANCE;
  }
  return MUSHROOM_DUPLICATE_CHANCE;
};

export const createEncounterPair = (pool = [], rng = Math.random, options = {}) => {
  const basePool = pool.filter(Boolean);
  const nonMini = basePool.filter(enemy => !enemy?.miniBoss);
  const phasePool = nonMini.length > 0 ? nonMini : basePool;
  const familyWeights = resolveEncounterFamilyWeights(phasePool, options);
  const selectedFamily = weightedPick(Object.keys(familyWeights), family => familyWeights[family], rng);
  const familyPool = selectedFamily
    ? phasePool.filter(enemy => (enemy.encounterFamily || 'unclassified') === selectedFamily)
    : phasePool;
  const available = familyPool.length > 0 ? familyPool : phasePool;
  if (available.length <= 1) return available.slice(0, 1);
  const pick = list => list[Math.min(list.length - 1, Math.floor(rng() * list.length))] ?? null;
  const mushroom = options.location === FUNGAL_LOCATION || available.some(enemy => enemy?.location === FUNGAL_LOCATION);
  const duplicateChance = resolveEncounterDuplicateChance({
    location: options.location,
    family: selectedFamily,
    eligiblePool: available,
  });
  if (mushroom && options.allowDuplicates !== false && rng() < duplicateChance) {
    const candidates = available.filter(enemy => {
      const weight = MUSHROOM_DUPLICATE_WEIGHTS[enemy.name] || 0;
      if (!weight || MUSHROOM_DUPLICATE_EXCLUSIONS.includes(enemy.name)) return false;
      if (enemy.name === 'Одичавший троглодит' && enemy.encounterPhase !== 'late') return false;
      return true;
    });
    const duplicate = weightedPick(candidates, enemy => MUSHROOM_DUPLICATE_WEIGHTS[enemy.name], rng);
    if (duplicate) return [duplicate, duplicate];
  }
  const first = pick(available);
  const compatible = available.filter(enemy => (
    (enemy.id == null || first?.id == null || enemy.id !== first.id) && enemy.name !== first?.name && (
      !first?.encounterFamily || !enemy.encounterFamily || enemy.encounterFamily === first.encounterFamily
    )
  ));
  const second = pick(compatible);
  return second ? [first, second] : [first];
};


const deserterTemplate = (names, weight, strength = 'normal') => Object.freeze({
  names: Object.freeze(names),
  weight,
  strength,
  key: [...names].sort((a, b) => a.localeCompare(b, 'ru')).join('|'),
});

// L1 Deserter Camp: authored three-enemy packs without duplicates.
// Apothecary, Stormcaller, and Halberd Master retain their existing late/Strong gating.
export const DESERTER_NORMAL_TEMPLATES = Object.freeze([
  deserterTemplate(['Громила', 'Следопыт', 'Трюкач'], 3),
  deserterTemplate(['Громила', 'Чернокнижник', 'Следопыт'], 3),
  deserterTemplate(['Громила', 'Дуэлянт', 'Следопыт'], 3),
  deserterTemplate(['Громила', 'Чернокнижник', 'Дуэлянт'], 2),
  deserterTemplate(['Громила', 'Трюкач', 'Дуэлянт'], 2),
  deserterTemplate(['Чернокнижник', 'Трюкач', 'Дуэлянт'], 1),
  deserterTemplate(['Чернокнижник', 'Дуэлянт', 'Следопыт'], 2),
  deserterTemplate(['Трюкач', 'Дуэлянт', 'Следопыт'], 2),
]);

export const DESERTER_STRONG_TEMPLATES = Object.freeze([
  deserterTemplate(['Аптекарь', 'Громила', 'Следопыт'], 3, 'strong'),
  deserterTemplate(['Аптекарь', 'Дуэлянт', 'Следопыт'], 2, 'strong'),
  deserterTemplate(['Аптекарь', 'Громила', 'Чернокнижник'], 2, 'strong'),
  deserterTemplate(['Заклинатель бурь', 'Громила', 'Дуэлянт'], 3, 'strong'),
  deserterTemplate(['Заклинатель бурь', 'Следопыт', 'Дуэлянт'], 2, 'strong'),
  deserterTemplate(['Заклинатель бурь', 'Громила', 'Следопыт'], 2, 'strong'),
  deserterTemplate(['Мастер алебарды', 'Чернокнижник', 'Громила'], 3, 'strong'),
  deserterTemplate(['Мастер алебарды', 'Чернокнижник', 'Следопыт'], 2, 'strong'),
  deserterTemplate(['Мастер алебарды', 'Трюкач', 'Чернокнижник'], 1, 'strong'),
  deserterTemplate(['Мастер алебарды', 'Дуэлянт', 'Следопыт'], 2, 'strong'),
]);

const resolveDeserterTemplate = (template, byName) => {
  const resolved = template.names.map(name => byName.get(name)).filter(Boolean);
  return resolved.length === template.names.length ? { ...template, enemies: resolved } : null;
};

export const createDeserterCampEncounter = (
  pool = [],
  rng = Math.random,
  { completedCombatRooms = 0, tuning = PRODUCTION_LEVEL_ONE_TUNING, requireStrong = false } = {}
) => {
  const byName = new Map(
    pool
      .filter(enemy => enemy && !enemy.summonOnly && !isCursedRoomEnemy(enemy))
      .map(enemy => [enemy.name, enemy])
  );
  const authored = requireStrong
    ? [...DESERTER_STRONG_TEMPLATES]
    : isStrongPoolAvailable(completedCombatRooms, tuning)
    ? [...DESERTER_NORMAL_TEMPLATES, ...DESERTER_STRONG_TEMPLATES]
    : [...DESERTER_NORMAL_TEMPLATES];
  const candidates = authored.map(template => resolveDeserterTemplate(template, byName)).filter(Boolean);
  const chosen = weightedPick(candidates, template => template.weight, rng);
  if (!chosen) return null;
  return {
    enemies: [...chosen.enemies],
    miniBoss: false,
    encounterTemplateKey: chosen.key,
    encounterStrength: chosen.strength,
  };
};

// A fourth Deserter is allowed only through Reinforcement. To keep four-enemy
// fights readable, no reinforcement may create three simultaneous denial/control specialists.
export const DESERTER_REINFORCEMENT_CONTROL_NAMES = Object.freeze([
  'Чернокнижник',
  'Трюкач',
  'Следопыт',
]);

const isSafeDeserterReinforcement = (enemy, existingEnemies = []) => {
  if (!enemy || existingEnemies.length >= 4) return false;
  const controlNames = new Set(DESERTER_REINFORCEMENT_CONTROL_NAMES);
  const existingControlCount = existingEnemies.filter(unit => controlNames.has(unit?.name)).length;
  if (controlNames.has(enemy.name) && existingControlCount >= 2) return false;
  return true;
};

export const DESERTER_ALERT_LEVELS = Object.freeze([
  { level: 0, minBattles: 0, modifierChance: 0, readyChance: 0, turnMeter: 0 },
  { level: 1, minBattles: 3, modifierChance: 0.35, readyChance: 1, turnMeter: 100 },
  { level: 2, minBattles: 6, modifierChance: 0.6, readyChance: 0.7, turnMeter: 150 },
  { level: 3, minBattles: 9, modifierChance: 0.8, readyChance: 0.6, turnMeter: 200 },
]);

export const getDeserterAlertLevel = completedCombatRooms => (
  Number(completedCombatRooms) >= 9 ? 3 : Number(completedCombatRooms) >= 6 ? 2 : Number(completedCombatRooms) >= 3 ? 1 : 0
);

/** Resolves exactly once and returns a new encounter; cursed/mini-boss/boss encounters are untouched. */
export const applyDeserterAlertModifier = ({ enemies = [], completedCombatRooms = 0, pool = [], rng = Math.random, cursedEnemy = false, miniBoss = false, boss = false } = {}) => {
  const level = getDeserterAlertLevel(completedCombatRooms);
  if (level === 0 || cursedEnemy || miniBoss || boss || enemies.some(enemy => enemy?.boss || enemy?.miniBoss)) return { enemies: enemies.map(enemy => ({ ...enemy, encounterAlertLevel: level })), alertLevel: level, alertModifier: null };
  const tuning = DESERTER_ALERT_LEVELS[level];
  if (rng() >= tuning.modifierChance) return { enemies: enemies.map(enemy => ({ ...enemy, encounterAlertLevel: level })), alertLevel: level, alertModifier: null };
  if (rng() < tuning.readyChance) return {
    enemies: enemies.map(enemy => ({ ...enemy, startingTurnMeterBonus: tuning.turnMeter, encounterAlertLevel: level })), alertLevel: level,
    alertModifier: { type: 'ready', name: 'Готовность', turnMeter: tuning.turnMeter, description: 'Готовность: враги начинают бой с повышенной шкалой хода' },
  };
  const existing = new Set(enemies.map(enemy => enemy?.name));
  const candidates = pool.filter(enemy =>
    enemy &&
    !enemy.boss &&
    !enemy.miniBoss &&
    enemy.encounterPhase !== 'late' &&
    !existing.has(enemy.name) &&
    isSafeDeserterReinforcement(enemy, enemies)
  );
  const reinforcement = candidates[Math.floor(rng() * candidates.length)] || null;
  if (!reinforcement) return { enemies: enemies.map(enemy => ({ ...enemy, encounterAlertLevel: level })), alertLevel: level, alertModifier: null };
  return { enemies: [...enemies.map(enemy => ({ ...enemy, encounterAlertLevel: level })), { ...reinforcement, encounterAlertLevel: level }], alertLevel: level, alertModifier: { type: 'reinforcement', name: 'Подкрепление', description: 'Подкрепление: +1 противник' } };
};

