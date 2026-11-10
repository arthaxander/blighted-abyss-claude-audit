import { rollAltarChoices } from './altarChoices';
import { DESERTER_LOCATION, FUNGAL_LOCATION, GOBLIN_LOCATION } from './enemyPools';
import { BOSS_MATERIAL_BY_LOCATION, CURSED_ONLY_MATERIALS } from '../data/levelOneLootOwnership';
import { getLootOwnershipForLocation } from '../data/lootOwnership';
import { PRODUCTION_LEVEL_ONE_TUNING } from './levelOneProgression';

export const ROOM_TYPES = {
  COMBAT: 'COMBAT',
  TREASURE: 'TREASURE',
  SECRET: 'SECRET',
  RESOURCE: 'RESOURCE',
  FISHING: 'FISHING',
  CURSE_ALTAR: 'CURSE_ALTAR',
  CURSED_ENEMY: 'CURSED_ENEMY',
  BOSS: 'BOSS',
};

export const SECRET_TYPES = {
  TREASURE: 'SECRET_TREASURE',
  COMBAT: 'SECRET_COMBAT',
  EVENT: 'SECRET_EVENT',
  RESOURCE: 'SECRET_RESOURCE',
  TRAP: 'SECRET_TRAP',
  CURSE_ALTAR: 'SECRET_CURSE_ALTAR',
  FISHING: 'SECRET_FISHING',
  CURSED_ENEMY: 'SECRET_CURSED_ENEMY',
};

export const ROOM_LABELS = {
  [ROOM_TYPES.COMBAT]: 'Бой',
  [ROOM_TYPES.TREASURE]: 'Сокровище',
  [ROOM_TYPES.SECRET]: 'Тайная тропа',
  [ROOM_TYPES.RESOURCE]: 'Ресурсы',
  [ROOM_TYPES.FISHING]: 'Рыбалка',
  [ROOM_TYPES.CURSE_ALTAR]: 'Алтарь',
  [ROOM_TYPES.CURSED_ENEMY]: 'Проклятый враг',
  [ROOM_TYPES.BOSS]: 'Босс',
};

export const SECRET_LABELS = {
  [SECRET_TYPES.TREASURE]: 'Сокровище',
  [SECRET_TYPES.COMBAT]: 'Бой',
  [SECRET_TYPES.RESOURCE]: 'Ресурсы',
  [SECRET_TYPES.TRAP]: 'Ловушка',
  [SECRET_TYPES.CURSE_ALTAR]: 'Алтарь',
  [SECRET_TYPES.FISHING]: 'Рыбалка',
  [SECRET_TYPES.CURSED_ENEMY]: 'Проклятый враг',
};

const INITIAL_LOCATION_STATE = {
  choiceWindowIndex: 0,
  completedCombatRooms: 0,
  roomsSinceTreasureSeen: 0,
  roomsSinceCurseAltarSeen: 0,
  treasureSeenCount: 0,
  curseAltarSeenCount: 0,
  lastDirectRoomTypes: [],
  lastSecretHiddenTypes: [],
  bossOffered: false,
};

const UNIQUE_DIRECT_TYPES = new Set([
  ROOM_TYPES.BOSS,
  ROOM_TYPES.TREASURE,
  ROOM_TYPES.CURSE_ALTAR,
  ROOM_TYPES.FISHING,
  ROOM_TYPES.SECRET,
  ROOM_TYPES.RESOURCE,
]);

const REPLACEMENT_ORDER = [
  ROOM_TYPES.FISHING,
  ROOM_TYPES.CURSED_ENEMY,
  ROOM_TYPES.SECRET,
  ROOM_TYPES.RESOURCE,
  ROOM_TYPES.TREASURE,
  ROOM_TYPES.CURSE_ALTAR,
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pickRandom = (list = [], rng = Math.random) => list[Math.floor(rng() * list.length)] ?? null;

const RESOURCE_ROOM_FLAVOR = {
  [GOBLIN_LOCATION]: [
    'Заросли кровавого мха',
    'Сырая расщелина',
    'Крысиная подстилка',
    'Гоблинский склад тряпья',
    'Мшистая сточная канава',
  ],
  [FUNGAL_LOCATION]: [
    'Заросли светящихся спор',
    'Мягкий мицелиевый ковёр',
    'Влажная грибная полость',
    'Колония серого спорника',
    'Нора мясного жука',
    'Светокаповая расщелина',
  ],
  [DESERTER_LOCATION]: [
    'Разграбленный обоз',
    'Брошенный склад припасов',
    'Разорванные тюки ткани',
    'Сломанная оружейная стойка',
    'Старый походный сундук',
    'Остатки лагерной мастерской',
  ],
  'Лес Увядания': [
    'Корни у мёртвого исполина',
    'Заросшая смоляная ложбина',
    'Поваленный древний ствол',
    'Поляна последнего цветения',
    'Заброшенный лагерь сборщиков',
  ],
  fallback: ['Заброшенная кладовая', 'Сырая ниша', 'Старый тайник путника'],
};

const RESOURCE_ROOM_TABLES = {
  [GOBLIN_LOCATION]: [
    { name: 'Кровяной мох', weight: 50, quantity: { min: 1, max: 2 } },
    { name: 'Простая ткань', weight: 16, quantity: { min: 1, max: 2 } },
    { name: 'Обрывки кожи', weight: 14, quantity: { min: 1, max: 2 } },
    { name: 'Металлические обломки', weight: 12, quantity: { min: 1, max: 2 } },
    { name: 'Простая склянка', weight: 6, quantity: { min: 1, max: 1 } },
    { name: 'Крысиная шкура', weight: 20, quantity: { min: 1, max: 1 } },
    { name: 'Пепел гоблинского перца', weight: 20, quantity: { min: 1, max: 2 } },
  ],
  [FUNGAL_LOCATION]: [
    { name: 'Лазурный мицелий', weight: 28, quantity: { min: 1, max: 2 } },
    { name: 'Блуждающие споры', weight: 22, quantity: { min: 1, max: 2 } },
    { name: 'Простая ткань', weight: 8, quantity: { min: 1, max: 2 } },
    { name: 'Обрывки кожи', weight: 8, quantity: { min: 1, max: 2 } },
    { name: 'Металлические обломки', weight: 8, quantity: { min: 1, max: 2 } },
    { name: 'Кровяной мох', weight: 12, quantity: { min: 1, max: 2 } },
    { name: 'Простая склянка', weight: 7, quantity: { min: 1, max: 1 } },
    { name: 'Спора светокапа', weight: 5, quantity: { min: 1, max: 1 } },
  ],
  // TODO: Add Deserter early/late/cursed enemies, Master Blades boss, reward ladder,
  // boss catalyst, and move Deserter/Guild gear out of unrelated loot where appropriate.
  [DESERTER_LOCATION]: [
    { name: 'Простая ткань', weight: 34, quantity: { min: 1, max: 2 } },
    { name: 'Обрывки кожи', weight: 28, quantity: { min: 1, max: 2 } },
    { name: 'Металлические обломки', weight: 26, quantity: { min: 1, max: 2 } },
    { name: 'Простая склянка', weight: 12, quantity: { min: 1, max: 1 } },
    { name: 'Кровяной мох', weight: 10, quantity: { min: 1, max: 2 } },
    { name: 'Сумеречный вереск', weight: 20, quantity: { min: 1, max: 2 } },
    { name: 'Черножильная руда', weight: 14, quantity: { min: 1, max: 1 } },
  ],
  'Лес Увядания': [
    { name: 'Чёрная сердцевина', weight: 28, quantity: { min: 1, max: 2 } },
    { name: 'Горькая живица', weight: 24, quantity: { min: 1, max: 2 } },
    { name: 'Цветок последней весны', weight: 16, quantity: { min: 1, max: 1 } },
    { name: 'Глубинное полотно', weight: 18, quantity: { min: 1, max: 2 } },
    { name: 'Кровяной мох', weight: 16, quantity: { min: 1, max: 2 } },
    { name: 'Выделанная кожа Бездны', weight: 12, quantity: { min: 1, max: 2 } },
    { name: 'Сумрачный сплав', weight: 10, quantity: { min: 1, max: 2 } },
  ],
  fallback: [
    { name: 'Кровяной мох', weight: 20, quantity: { min: 1, max: 2 } },
    { name: 'Простая ткань', weight: 25, quantity: { min: 1, max: 2 } },
    { name: 'Обрывки кожи', weight: 20, quantity: { min: 1, max: 2 } },
    { name: 'Металлические обломки', weight: 20, quantity: { min: 1, max: 2 } },
    { name: 'Простая склянка', weight: 15, quantity: { min: 1, max: 2 } },
  ],
};

const randomInt = (min, max, rng = Math.random) => Math.floor(rng() * (max - min + 1)) + min;

const rollWeightedEntry = (entries = [], rng = Math.random) => {
  const total = entries.reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
  if (total <= 0) return entries[0] || null;
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= Number(entry.weight) || 0;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1] || null;
};

export const getOrdinaryMaterialPoolForLocation = locationName => {
  const ownership = getLootOwnershipForLocation(locationName);
  return [
    ...ownership.commonMaterials,
    ...ownership.locationMaterials,
  ];
};

const buildOwnedResourceRoomTable = (locationName) => {
  const ownership = getLootOwnershipForLocation(locationName);
  const common = ownership.commonMaterials.map(name => ({
    name,
    weight: 16,
    quantity: { min: 1, max: 2 },
  }));
  const local = ownership.locationMaterials.map(name => ({
    name,
    weight: 24,
    quantity: { min: 1, max: 2 },
  }));
  return [...local, ...common];
};

export const getResourceRoomTable = (locationName) => {
  const ownership = getLootOwnershipForLocation(locationName);
  const authoredTable = RESOURCE_ROOM_TABLES[locationName];
  const table = authoredTable
    || (ownership.abyssLevel > 1 ? buildOwnedResourceRoomTable(locationName) : RESOURCE_ROOM_TABLES.fallback);
  const allowed = new Set(getOrdinaryMaterialPoolForLocation(locationName));
  const forbidden = new Set([
    ...CURSED_ONLY_MATERIALS,
    ...Object.values(BOSS_MATERIAL_BY_LOCATION),
    ...ownership.bossMaterials,
  ]);
  return table.filter(entry => allowed.has(entry.name) && !forbidden.has(entry.name));
};

export const rollResourceRoomLoot = (locationName, rng = Math.random) => {
  const table = getResourceRoomTable(locationName);
  const stackCount = randomInt(2, 4, rng);
  const loot = [];

  const addStack = (entry) => {
    if (!entry?.name) return;
    const quantity = randomInt(entry.quantity?.min ?? 1, entry.quantity?.max ?? entry.quantity?.min ?? 1, rng);
    loot.push({ name: entry.name, quantity });
  };

  while (table.length && loot.length < stackCount) {
    addStack(rollWeightedEntry(table, rng));
  }

  if (locationName === GOBLIN_LOCATION && !loot.some(entry => entry.name === 'Кровяной мох') && rng() < 0.2) {
    const mossEntry = table.find(entry => entry.name === 'Кровяной мох');
    const replacementIndex = Math.floor(rng() * loot.length);
    const quantity = randomInt(mossEntry?.quantity?.min ?? 1, mossEntry?.quantity?.max ?? 1, rng);
    loot[replacementIndex] = { name: 'Кровяной мох', quantity };
  }

  // Add supplies without replacing equipment-crafting material rolls.
  loot.push({ name: 'Простая склянка', quantity: 1 }, { name: 'Кровяной мох', quantity: 2 }, { name: 'Простая ткань', quantity: 1 });
  if (locationName === FUNGAL_LOCATION) loot.push({ name: rng() < 0.5 ? 'Слизь мохоспора' : 'Пыльца серого спорника', quantity: 1 });
  return loot;
};

export const buildResourceRoomPayload = (context = {}) => {
  const locationName = context.locationName;
  const flavorPool = RESOURCE_ROOM_FLAVOR[locationName] || RESOURCE_ROOM_FLAVOR.fallback;
  return {
    roomName: pickRandom(flavorPool, context.rng),
    loot: rollResourceRoomLoot(locationName, context.rng),
  };
};

export const normalizeRoomGenerationLocationState = (state = {}) => ({
  ...INITIAL_LOCATION_STATE,
  ...(state && typeof state === 'object' ? state : {}),
  choiceWindowIndex: Number(state?.choiceWindowIndex) || 0,
  completedCombatRooms: Number(state?.completedCombatRooms) || 0,
  roomsSinceTreasureSeen: Number(state?.roomsSinceTreasureSeen) || 0,
  roomsSinceCurseAltarSeen: Number(state?.roomsSinceCurseAltarSeen) || 0,
  treasureSeenCount: Number(state?.treasureSeenCount) || 0,
  curseAltarSeenCount: Number(state?.curseAltarSeenCount) || 0,
  lastDirectRoomTypes: Array.isArray(state?.lastDirectRoomTypes) ? state.lastDirectRoomTypes : [],
  lastSecretHiddenTypes: Array.isArray(state?.lastSecretHiddenTypes) ? state.lastSecretHiddenTypes : [],
  bossOffered: Boolean(state?.bossOffered),
});

export const getLocationRoomGenerationState = (roomGenerationState = {}, locationName) =>
  normalizeRoomGenerationLocationState(roomGenerationState?.[locationName]);

export const getTreasurePity = (state = {}) =>
  clamp(Math.max(0, (Number(state.roomsSinceTreasureSeen) || 0) - 3) * 2, 0, 12);

export const getCurseAltarPity = (state = {}) => {
  if ((Number(state.curseAltarSeenCount) || 0) >= 2) return 0;
  return clamp(Math.max(0, (Number(state.roomsSinceCurseAltarSeen) || 0) - 4) * 2, 0, 10);
};

const getPhase = (state) => {
  const tuning = state.progressionTuning || PRODUCTION_LEVEL_ONE_TUNING;
  if (state.completedCombatRooms >= tuning.roomPhaseLate) return 'late';
  if (state.completedCombatRooms >= tuning.roomPhaseMid) return 'mid';
  return 'early';
};

export const resolveRoomWeights = ({ slotIndex = 0, state = {} } = {}) => {
  const phase = getPhase(state);
  const treasurePity = getTreasurePity(state);
  const altarPity = getCurseAltarPity(state);
  const lastDirect = state.lastDirectRoomTypes || [];
  const treasurePityCapped = treasurePity >= 12;
  const altarSeenCount = Number(state.curseAltarSeenCount) || 0;
  const altarDirectBase = altarSeenCount >= 2 ? 1 : phase === 'late' ? 3 : 4;
  const hasBossEnemy = state.hasBossEnemy !== false;
  const hasCursedEnemyPool = state.hasCursedEnemyPool !== false;
  const tuning = state.progressionTuning || PRODUCTION_LEVEL_ONE_TUNING;
  const bossUnlocked = state.completedCombatRooms >= tuning.bossUnlock;
  const altarBlockedByCooldown = lastDirect.includes(ROOM_TYPES.CURSE_ALTAR);
  const treasureBlockedByCooldown = lastDirect.includes(ROOM_TYPES.TREASURE) && !treasurePityCapped;

  if (slotIndex === 0) {
    return phase === 'late'
      ? { [ROOM_TYPES.BOSS]: hasBossEnemy && bossUnlocked ? 65 : 0, [ROOM_TYPES.COMBAT]: 35 }
      : { [ROOM_TYPES.COMBAT]: 100 };
  }

  if (phase === 'late') {
    return {
      [ROOM_TYPES.COMBAT]: 38,
      [ROOM_TYPES.BOSS]: hasBossEnemy && bossUnlocked ? 18 : 0,
      [ROOM_TYPES.RESOURCE]: 10,
      [ROOM_TYPES.SECRET]: 11,
      [ROOM_TYPES.TREASURE]: treasureBlockedByCooldown ? 0 : 4 + treasurePity,
      [ROOM_TYPES.CURSE_ALTAR]: altarBlockedByCooldown ? 0 : altarDirectBase + altarPity,
      [ROOM_TYPES.CURSED_ENEMY]: hasCursedEnemyPool ? 3 : 0,
      [ROOM_TYPES.FISHING]: 1,
    };
  }

  return {
    [ROOM_TYPES.COMBAT]: phase === 'mid' ? 43 : 46,
    [ROOM_TYPES.RESOURCE]: 12,
    [ROOM_TYPES.SECRET]: 14,
    [ROOM_TYPES.TREASURE]: treasureBlockedByCooldown ? 0 : 5 + treasurePity,
    [ROOM_TYPES.CURSE_ALTAR]: altarBlockedByCooldown ? 0 : altarDirectBase + altarPity,
    [ROOM_TYPES.CURSED_ENEMY]: phase === 'mid' && state.choiceWindowIndex >= 4 && hasCursedEnemyPool ? 5 : 0,
    [ROOM_TYPES.FISHING]: 1,
    [ROOM_TYPES.BOSS]: 0,
  };
};

export const rollWeightedRoomType = (weights = {}, rng = Math.random) => {
  const entries = Object.entries(weights).filter(([, weight]) => Number(weight) > 0);
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  if (total <= 0) return ROOM_TYPES.COMBAT;
  let roll = rng() * total;
  for (const [type, weight] of entries) {
    roll -= Number(weight);
    if (roll <= 0) return type;
  }
  return entries[entries.length - 1]?.[0] || ROOM_TYPES.COMBAT;
};

const rollRoomTypeForSlot = (slotIndex, context, selectedTypes) => {
  let weights = resolveRoomWeights({ ...context, slotIndex });
  weights = { ...weights };
  delete weights.TRAP;
  for (const type of selectedTypes) {
    if (UNIQUE_DIRECT_TYPES.has(type)) weights[type] = 0;
  }
  return rollWeightedRoomType(weights, context.rng);
};

export const applyRoomChoicePostRules = (types) => {
  const cleaned = types.map(type => (type === 'TRAP' ? ROOM_TYPES.COMBAT : type)).slice(0, 3);
  while (cleaned.length < 3) cleaned.push(ROOM_TYPES.COMBAT);

  const seen = new Set();
  for (let i = 0; i < cleaned.length; i += 1) {
    const type = cleaned[i];
    if (UNIQUE_DIRECT_TYPES.has(type) && seen.has(type)) cleaned[i] = ROOM_TYPES.COMBAT;
    seen.add(cleaned[i]);
  }

  if (!cleaned.includes(ROOM_TYPES.COMBAT) && !cleaned.includes(ROOM_TYPES.BOSS)) {
    const replaceType = REPLACEMENT_ORDER.find(type => cleaned.includes(type));
    const index = replaceType ? cleaned.indexOf(replaceType) : cleaned.length - 1;
    if (cleaned[index] !== ROOM_TYPES.BOSS) cleaned[index] = ROOM_TYPES.COMBAT;
  }

  return cleaned.slice(0, 3);
};

const resolveSecretWeights = (state = {}, { allowCurseAltar = true } = {}) => {
  const phase = getPhase(state);
  const altarSuppressed = !allowCurseAltar
    || (Number(state.curseAltarSeenCount) || 0) >= 2
    || (state.lastDirectRoomTypes || []).includes(ROOM_TYPES.CURSE_ALTAR)
    || (state.lastSecretHiddenTypes || []).includes(SECRET_TYPES.CURSE_ALTAR);
  const hasCursedEnemyPool = state.hasCursedEnemyPool !== false;
  if (phase === 'late') {
    return {
      [SECRET_TYPES.RESOURCE]: 16,
      [SECRET_TYPES.TREASURE]: 18,
      [SECRET_TYPES.COMBAT]: 20,
      [SECRET_TYPES.TRAP]: 12,
      [SECRET_TYPES.CURSED_ENEMY]: hasCursedEnemyPool ? 8 : 0,
      [SECRET_TYPES.CURSE_ALTAR]: altarSuppressed ? 0 : 6,
      [SECRET_TYPES.FISHING]: 2,
    };
  }
  if (phase === 'mid') {
    return {
      [SECRET_TYPES.RESOURCE]: 18,
      [SECRET_TYPES.TREASURE]: 20,
      [SECRET_TYPES.COMBAT]: 22,
      [SECRET_TYPES.TRAP]: 12,
      [SECRET_TYPES.CURSED_ENEMY]: state.choiceWindowIndex >= 4 && hasCursedEnemyPool ? 8 : 0,
      [SECRET_TYPES.CURSE_ALTAR]: altarSuppressed ? 0 : 4,
      [SECRET_TYPES.FISHING]: 2,
    };
  }
  return {
    [SECRET_TYPES.RESOURCE]: 18,
    [SECRET_TYPES.TREASURE]: 22,
    [SECRET_TYPES.COMBAT]: 24,
    [SECRET_TYPES.TRAP]: 12,
    [SECRET_TYPES.CURSE_ALTAR]: altarSuppressed ? 0 : 6,
    [SECRET_TYPES.FISHING]: 2,
    [SECRET_TYPES.CURSED_ENEMY]: 0,
  };
};

export const resolveSecretRoom = (context = {}) => {
  const hiddenRoomType = rollWeightedRoomType(
    resolveSecretWeights(context.state, {
      allowCurseAltar: context.allowSecretCurseAltar !== false,
    }),
    context.rng
  );
  return {
    hiddenRoomType,
    hiddenType: SECRET_LABELS[hiddenRoomType] || 'Событие',
    hiddenPayload: buildSecretPayload(hiddenRoomType, context),
  };
};

// SECRET_EVENT was the pre-resolved "nothing found" outcome in older saves.
// Repair only that choice, using the canonical resource payload authority and a
// stable roll when no caller-provided RNG exists; unrelated choices stay intact.
export const migrateLegacySecretRoomChoices = (choices, context = {}) => {
  if (!Array.isArray(choices)) return choices;
  return choices.map(choice => {
    if (choice?.roomType !== ROOM_TYPES.SECRET) return choice;
    if (choice.hiddenRoomType && choice.hiddenRoomType !== SECRET_TYPES.EVENT) return choice;
    const hiddenPayload = buildResourceRoomPayload({ ...context, rng: context.rng || (() => 0) });
    return {
      ...choice,
      hiddenRoomType: SECRET_TYPES.RESOURCE,
      hiddenType: SECRET_LABELS[SECRET_TYPES.RESOURCE],
      hiddenPayload,
    };
  });
};

const buildSecretPayload = (hiddenRoomType, context) => {
  switch (hiddenRoomType) {
    case SECRET_TYPES.TREASURE:
      return { loot: context.rollChestLoot?.('secretRoom') || [] };
    case SECRET_TYPES.COMBAT:
      return { ...context.buildFightEncounter?.('combat') };
    case SECRET_TYPES.CURSED_ENEMY:
      return { ...context.buildFightEncounter?.('cursed') };
    case SECRET_TYPES.TRAP:
      return { damage: 10 };
    case SECRET_TYPES.CURSE_ALTAR: {
      return rollAltarChoices(context.cursePool || [], context.rng);
    }
    case SECRET_TYPES.FISHING:
      return {};
    case SECRET_TYPES.RESOURCE:
      return buildResourceRoomPayload(context);
    case SECRET_TYPES.EVENT:
    default:
      return buildResourceRoomPayload(context);
  }
};

export const buildRoomPayload = (type, context = {}) => {
  switch (type) {
    case ROOM_TYPES.COMBAT:
      return { type: ROOM_LABELS[type], roomType: type, ...context.buildFightEncounter?.('combat') };
    case ROOM_TYPES.CURSED_ENEMY:
      return { type: ROOM_LABELS[type], roomType: type, ...context.buildFightEncounter?.('cursed') };
    case ROOM_TYPES.TREASURE:
      return { type: ROOM_LABELS[type], roomType: type, loot: context.rollChestLoot?.('treasureRoom') || [] };
    case ROOM_TYPES.RESOURCE:
      return { type: ROOM_LABELS[type], roomType: type, ...buildResourceRoomPayload(context) };
    case ROOM_TYPES.CURSE_ALTAR: {
      const choices = rollAltarChoices(context.cursePool || [], context.rng);
      return choices.curseIds?.length
        ? { type: ROOM_LABELS[type], roomType: type, ...choices }
        : { type: 'Пустая комната', roomType: 'EMPTY' };
    }
    case ROOM_TYPES.FISHING:
      return { type: ROOM_LABELS[type], roomType: type };
    case ROOM_TYPES.BOSS:
      return { type: ROOM_LABELS[type], roomType: type, enemies: context.bossEnemy ? [context.bossEnemy] : [], miniBoss: false };
    case ROOM_TYPES.SECRET: {
      const secret = resolveSecretRoom(context);
      return { type: ROOM_LABELS[type], roomType: type, ...secret };
    }
    default:
      return { type: 'Пустая комната', roomType: 'EMPTY' };
  }
};

const applyGenerationEffects = (state, choices) => {
  const directRoomTypes = choices.map(choice => choice.roomType).filter(Boolean);
  const secretHiddenTypes = choices.map(choice => choice.hiddenRoomType).filter(Boolean);
  const sawTreasure = directRoomTypes.includes(ROOM_TYPES.TREASURE) || secretHiddenTypes.includes(SECRET_TYPES.TREASURE);
  const sawAltar = directRoomTypes.includes(ROOM_TYPES.CURSE_ALTAR) || secretHiddenTypes.includes(SECRET_TYPES.CURSE_ALTAR);

  return {
    ...state,
    roomsSinceTreasureSeen: sawTreasure ? 0 : state.roomsSinceTreasureSeen,
    roomsSinceCurseAltarSeen: sawAltar ? 0 : state.roomsSinceCurseAltarSeen,
    treasureSeenCount: state.treasureSeenCount + (sawTreasure ? 1 : 0),
    curseAltarSeenCount: state.curseAltarSeenCount + (sawAltar ? 1 : 0),
    lastDirectRoomTypes: directRoomTypes,
    lastSecretHiddenTypes: secretHiddenTypes,
    bossOffered: state.bossOffered || directRoomTypes.includes(ROOM_TYPES.BOSS),
  };
};

export const advanceRoomGenerationStateForNewWindow = (state = {}) => ({
  ...normalizeRoomGenerationLocationState(state),
  choiceWindowIndex: normalizeRoomGenerationLocationState(state).choiceWindowIndex + 1,
  roomsSinceTreasureSeen: normalizeRoomGenerationLocationState(state).roomsSinceTreasureSeen + 1,
  roomsSinceCurseAltarSeen: normalizeRoomGenerationLocationState(state).roomsSinceCurseAltarSeen + 1,
});


export const validateRoomChoices = (choices, context = {}) => {
  if (!Array.isArray(choices) || choices.length !== 3) return false;

  const state = normalizeRoomGenerationLocationState(context.state);
  const hasBossEnemy = context.hasBossEnemy ?? Boolean(context.bossEnemy);
  const hasCursedEnemyPool = context.hasCursedEnemyPool ?? true;
  const rareCounts = new Map();

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') return false;
    const roomType = choice.roomType;
    const choiceEnemies = [
      ...(Array.isArray(choice.enemies) ? choice.enemies : []),
      ...(Array.isArray(choice.hiddenPayload?.enemies) ? choice.hiddenPayload.enemies : []),
    ];

    if (choiceEnemies.some(enemy => enemy?.summonOnly)) return false;
    if (roomType === 'TRAP' || choice.type === 'Ловушка') return false;
    const tuning = state.progressionTuning || PRODUCTION_LEVEL_ONE_TUNING;
    if (roomType === ROOM_TYPES.BOSS && state.completedCombatRooms < tuning.bossUnlock) return false;
    if (roomType === ROOM_TYPES.BOSS && !hasBossEnemy) return false;
    if (roomType === ROOM_TYPES.CURSED_ENEMY) {
      if (state.completedCombatRooms < tuning.cursedEncounterUnlock || state.choiceWindowIndex < tuning.cursedChoiceWindowUnlock) return false;
      if (!hasCursedEnemyPool) return false;
    }
    if (roomType === ROOM_TYPES.SECRET && choice.hiddenRoomType === ROOM_TYPES.BOSS) return false;
    if (choice.hiddenRoomType === ROOM_TYPES.BOSS || choice.hiddenRoomType === 'SECRET_BOSS') return false;
    if (choice.hiddenRoomType === SECRET_TYPES.CURSED_ENEMY) {
      if (state.completedCombatRooms < tuning.cursedEncounterUnlock || state.choiceWindowIndex < tuning.cursedChoiceWindowUnlock) return false;
      if (!hasCursedEnemyPool) return false;
    }

    if (UNIQUE_DIRECT_TYPES.has(roomType)) {
      const nextCount = (rareCounts.get(roomType) || 0) + 1;
      if (nextCount > 1) return false;
      rareCounts.set(roomType, nextCount);
    }
  }

  return true;
};

export const generateRoomChoices = (context = {}) => {
  const rng = context.rng || Math.random;
  const initialState = advanceRoomGenerationStateForNewWindow(context.state);
  const generationContext = {
    ...context,
    rng,
    state: {
      ...initialState,
      hasBossEnemy: context.hasBossEnemy ?? Boolean(context.bossEnemy),
      hasCursedEnemyPool: context.hasCursedEnemyPool ?? true,
    },
  };
  const selected = [];
  for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
    selected.push(rollRoomTypeForSlot(slotIndex, generationContext, selected));
  }
  const finalTypes = applyRoomChoicePostRules(selected);
  const choices = finalTypes.map((type, index) => {
    const path = buildRoomPayload(type, generationContext);
    return {
      ...path,
      id: path.id || `${context.locationName || 'location'}-${Date.now()}-${index}-${rng().toString(36).slice(2, 8)}`,
    };
  });

  return {
    choices,
    state: applyGenerationEffects(initialState, choices),
  };
};

export const incrementCompletedCombatRooms = (roomGenerationState = {}, locationName) => {
  const current = getLocationRoomGenerationState(roomGenerationState, locationName);
  return {
    ...(roomGenerationState || {}),
    [locationName]: {
      ...current,
      completedCombatRooms: current.completedCombatRooms + 1,
    },
  };
};

export const resetLocationRoomGenerationState = (roomGenerationState = {}, locationName) => ({
  ...(roomGenerationState || {}),
  [locationName]: { ...INITIAL_LOCATION_STATE },
});
