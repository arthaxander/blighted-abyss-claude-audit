import fs from 'fs';

import {
  generateRoomChoices,
  getCurseAltarPity,
  getTreasurePity,
  rollResourceRoomLoot,
  getResourceRoomTable,
  validateRoomChoices,
  buildResourceRoomPayload,
  migrateLegacySecretRoomChoices,
  ROOM_TYPES,
  SECRET_TYPES,
} from './roomGeneration';
import {
  findItemData,
  getExpeditionTreasureWeightMultiplier,
  getTreasurePoolNamesForLocation,
  rollTreasureLoot,
} from '../data/items';
import { AVAILABLE_LOCATIONS } from '../data/locations';
import {
  COMMON_LEVEL_TWO_MATERIALS,
  LEVEL_TWO_LOOT_LOCATIONS,
  LOCATION_LEVEL_TWO_MATERIALS,
} from '../data/levelTwoLootOwnership';
import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { EFFECT_LIBRARY, addEffect, processEffects, finishEffectTurn } from './effects';
import { MAX_ACTIVE_ENEMIES, applyDamage, applyItemInCombat, initCombatSession, performPlayerAction, processEnemyAI, rollLootForEnemies, triggerOnDeath } from './combatUtils';
import { beginCombatPresentation, consumeCombatPresentationEvents } from './combatPresentationEvents';
import { FIELD_CRAFTING_RECIPES } from '../data/recipes';
import { CURSE_IDS } from '../data/curses';
import { allEnemies, enemies } from '../data/enemies';
import { equipment, equipmentByName } from '../data/equipment';
import {
  EQUIPMENT_SLOT_KEYS,
  WEAPON_TYPES,
  applyEquipmentPatch,
  equipInventoryItemForClass,
  equipItemInSlots,
  getEquipmentSlotForItem,
  normalizeEquipmentLoadout,
  validateClassEquipment,
} from './equipmentManager';
import {
  DESERTER_LOCATION,
  FUNGAL_LOCATION,
  GOBLIN_LOCATION,
  getCursedEnemyPool,
  getTrashEnemyPool,
} from './enemyPools';
import { prepareFreshDungeonRun, resetDungeonRunState } from './dungeonRunState';

const enemy = { id: 'goblin', name: 'Goblin' };
const lateEnemy = { id: 'late', name: 'Late Goblin', encounterPhase: 'late' };
const cursedEnemy = { id: 'elite', name: 'Elite Goblin', miniBoss: true, encounterPhase: 'elite' };
const bossEnemy = { id: 'boss', name: 'Boss', boss: true };
const cursePool = [{ id: 'corruption', shortName: 'Corruption' }];

const makeContext = (state = {}, rng = () => 0.99, overrides = {}) => ({
  locationName: 'Гоблинские Норы',
  state,
  rng,
  bossEnemy,
  hasBossEnemy: true,
  hasCursedEnemyPool: true,
  cursePool,
  rollChestLoot: () => [{ name: 'Серебро', quantity: 10 }],
  buildFightEncounter: kind => ({
    enemies: kind === 'cursed' ? [cursedEnemy] : state.completedCombatRooms >= 5 ? [lateEnemy] : [enemy],
    miniBoss: kind === 'cursed',
  }),
  ...overrides,
});

const sequence = values => {
  let index = 0;
  return () => values[index++] ?? 0.99;
};

const withMockedRandom = (value, callback) => {
  const originalRandom = Math.random;
  Math.random = () => value;
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
};

const lcg = seed => {
  let value = seed;
  return () => {
    value = (value * 48271) % 0x7fffffff;
    return value / 0x7fffffff;
  };
};

describe('roomGeneration', () => {
  test('generates exactly three choices with no direct trap and a combat/boss anchor', () => {
    const { choices } = generateRoomChoices(makeContext({ completedCombatRooms: 0 }));
    expect(choices).toHaveLength(3);
    expect(choices.some(choice => choice.type === 'Ловушка')).toBe(false);
    expect(choices.some(choice => [ROOM_TYPES.COMBAT, ROOM_TYPES.BOSS].includes(choice.roomType))).toBe(true);
  });

  test('does not offer boss before 14 completed combat rooms', () => {
    const { choices } = generateRoomChoices(makeContext({ completedCombatRooms: 13 }, () => 0));
    expect(choices.some(choice => choice.roomType === ROOM_TYPES.BOSS)).toBe(false);
  });

  test('can offer boss after 14 completed combat rooms', () => {
    const { choices } = generateRoomChoices(makeContext({ completedCombatRooms: 14 }, () => 0));
    expect(choices.some(choice => choice.roomType === ROOM_TYPES.BOSS)).toBe(true);
  });

  test('does not offer cursed enemy before unlock', () => {
    const { choices } = generateRoomChoices(makeContext({ completedCombatRooms: 5, choiceWindowIndex: 2 }, () => 0.9));
    expect(choices.some(choice => choice.roomType === ROOM_TYPES.CURSED_ENEMY)).toBe(false);
  });

  test('secret rooms never pre-resolve boss', () => {
    for (let i = 0; i < 100; i += 1) {
      const rng = () => i / 100;
      const { choices } = generateRoomChoices(makeContext({ completedCombatRooms: 14 }, rng));
      choices
        .filter(choice => choice.roomType === ROOM_TYPES.SECRET)
        .forEach(choice => expect(choice.hiddenRoomType).not.toBe(ROOM_TYPES.BOSS));
    }
  });

  test('secret generation never produces the obsolete empty event outcome', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const { choices } = generateRoomChoices(makeContext({ completedCombatRooms: 14, choiceWindowIndex: 8 }, lcg(seed)));
      choices.filter(choice => choice.roomType === ROOM_TYPES.SECRET).forEach(choice => {
        expect(choice.hiddenRoomType).not.toBe(SECRET_TYPES.EVENT);
        expect(choice.hiddenRoomType).not.toBe(ROOM_TYPES.BOSS);
        expect(choice.hiddenPayload).toBeDefined();
      });
    }
  });

  test('expedition secrets can suppress hidden curse altars so the floor budget stays exact', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const secret = buildRoomPayload(ROOM_TYPES.SECRET, {
        ...makeContext({}, lcg(seed)),
        allowSecretCurseAltar: false,
      });
      expect(secret.hiddenRoomType).not.toBe(SECRET_TYPES.CURSE_ALTAR);
    }
  });

  test('legacy empty Secret is repaired in place without regenerating sibling choices', () => {
    const combat = { id: 'same-combat', type: 'Бой', roomType: ROOM_TYPES.COMBAT };
    const sibling = { id: 'same-treasure', type: 'Сокровище', roomType: ROOM_TYPES.TREASURE, loot: [] };
    const legacy = { id: 'legacy-secret', type: 'Секрет', roomType: ROOM_TYPES.SECRET, hiddenRoomType: SECRET_TYPES.EVENT, hiddenPayload: { description: 'Пусто' } };
    const migrated = migrateLegacySecretRoomChoices([combat, legacy, sibling], { locationName: 'Гоблинские Норы' });
    expect(migrated[0]).toBe(combat);
    expect(migrated[2]).toBe(sibling);
    expect(migrated[1]).toMatchObject({ id: 'legacy-secret', hiddenRoomType: SECRET_TYPES.RESOURCE, hiddenType: 'Ресурсы' });
    expect(migrated[1].hiddenPayload.loot.length).toBeGreaterThan(0);
  });

  test('pity values increase and cap after droughts', () => {
    expect(getTreasurePity({ roomsSinceTreasureSeen: 3 })).toBe(0);
    expect(getTreasurePity({ roomsSinceTreasureSeen: 7 })).toBe(8);
    expect(getTreasurePity({ roomsSinceTreasureSeen: 99 })).toBe(12);
    expect(getCurseAltarPity({ roomsSinceCurseAltarSeen: 4 })).toBe(0);
    expect(getCurseAltarPity({ roomsSinceCurseAltarSeen: 8 })).toBe(8);
    expect(getCurseAltarPity({ roomsSinceCurseAltarSeen: 99 })).toBe(10);
    expect(getCurseAltarPity({ roomsSinceCurseAltarSeen: 99, curseAltarSeenCount: 2 })).toBe(0);
  });

  test('secret hidden treasure and altar reset corresponding drought counters', () => {
    const treasure = generateRoomChoices(makeContext({}, sequence([0, 0, 0.75, 0.99, 0.99, 0.25])));
    expect(treasure.choices.some(choice => choice.hiddenRoomType === SECRET_TYPES.TREASURE)).toBe(true);
    expect(treasure.state.roomsSinceTreasureSeen).toBe(0);

    const altar = generateRoomChoices(makeContext({}, sequence([0, 0, 0.75, 0.99, 0.99, 0.93])));
    expect(altar.choices.some(choice => choice.hiddenRoomType === SECRET_TYPES.CURSE_ALTAR)).toBe(true);
    expect(altar.state.roomsSinceCurseAltarSeen).toBe(0);
  });

  test('expedition treasure profiles favor themed sublocation loot and richer Depth loot', () => {
    const ratItem = { name: 'Крысиная шкура', sourceTier: 'location', type: 'material' };
    const commonItem = { name: 'Простая ткань', sourceTier: 'common', type: 'material' };
    const equipment = { name: 'Тесак', sourceTier: 'location', type: 'equipment' };

    expect(getExpeditionTreasureWeightMultiplier(ratItem, {
      expeditionZone: 'sublocation',
      locationName: 'Гоблинские Норы',
      sublocationId: 'goblin-rat-riders',
    })).toBeCloseTo(2.5);
    expect(getExpeditionTreasureWeightMultiplier(commonItem, {
      expeditionZone: 'sublocation',
      locationName: 'Гоблинские Норы',
      sublocationId: 'goblin-rat-riders',
    })).toBeCloseTo(0.85);
    expect(getExpeditionTreasureWeightMultiplier(equipment, {
      expeditionZone: 'depth',
      locationName: 'Гоблинские Норы',
    })).toBeCloseTo(1.82);
  });

  test('RESOURCE can appear directly at most once and has stable pre-resolved payload', () => {
    const { choices } = generateRoomChoices(makeContext({}, sequence([0, 0.57, 0.57, 0.2, 0.2, 0.1, 0.2, 0.3, 0.4])));
    const resources = choices.filter(choice => choice.roomType === ROOM_TYPES.RESOURCE);
    expect(resources).toHaveLength(1);
    expect(resources[0].loot.length).toBeGreaterThanOrEqual(2);
    expect(resources[0].roomName).toBeTruthy();
  });

  test('RESOURCE can appear as a secret hidden result with pre-resolved payload', () => {
    const { choices } = generateRoomChoices(makeContext({}, sequence([0, 0, 0.75, 0.99, 0.99, 0.1, 0.2, 0.2, 0.1, 0.2, 0.3])));
    const secretResource = choices.find(choice => choice.hiddenRoomType === SECRET_TYPES.RESOURCE);
    expect(secretResource).toBeTruthy();
    expect(secretResource.hiddenPayload.loot.length).toBeGreaterThanOrEqual(2);
    expect(secretResource.hiddenPayload.roomName).toBeTruthy();
  });

  test('RESOURCE does not reset pity counters or count as combat', () => {
    const direct = generateRoomChoices(makeContext({
      roomsSinceTreasureSeen: 7,
      roomsSinceCurseAltarSeen: 7,
      completedCombatRooms: 3,
    }, sequence([0, 0.57, 0])));
    expect(direct.choices.some(choice => choice.roomType === ROOM_TYPES.RESOURCE)).toBe(true);
    expect(direct.state.roomsSinceTreasureSeen).toBe(8);
    expect(direct.state.roomsSinceCurseAltarSeen).toBe(8);
    expect(direct.state.completedCombatRooms).toBe(3);

    const secret = generateRoomChoices(makeContext({
      roomsSinceTreasureSeen: 7,
      roomsSinceCurseAltarSeen: 7,
      completedCombatRooms: 3,
    }, sequence([0, 0, 0.65, 0.99, 0.99, 0.1])));
    expect(secret.choices.some(choice => choice.hiddenRoomType === SECRET_TYPES.RESOURCE)).toBe(true);
    expect(secret.state.roomsSinceTreasureSeen).toBe(8);
    expect(secret.state.roomsSinceCurseAltarSeen).toBe(8);
    expect(secret.state.completedCombatRooms).toBe(3);
  });

  test('validateRoomChoices rejects stale invalid saved rooms', () => {
    const baseContext = { state: { completedCombatRooms: 0, choiceWindowIndex: 1 }, hasBossEnemy: true, hasCursedEnemyPool: true };
    const combat = { id: 'combat', type: 'Бой', roomType: ROOM_TYPES.COMBAT };

    expect(validateRoomChoices([
      combat,
      { id: 'boss', type: 'Босс', roomType: ROOM_TYPES.BOSS },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
    ], baseContext)).toBe(false);

    expect(validateRoomChoices([
      combat,
      { id: 'trap', type: 'Ловушка', roomType: 'TRAP' },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
    ], baseContext)).toBe(false);

    expect(validateRoomChoices([
      combat,
      { id: 'secret', type: 'Секрет', roomType: ROOM_TYPES.SECRET, hiddenRoomType: ROOM_TYPES.BOSS },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
    ], baseContext)).toBe(false);

    expect(validateRoomChoices([
      combat,
      { id: 'resource-1', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
      { id: 'resource-2', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
    ], baseContext)).toBe(false);

    expect(validateRoomChoices([
      combat,
      { id: 'treasure-1', type: 'Сокровище', roomType: ROOM_TYPES.TREASURE },
      { id: 'treasure-2', type: 'Сокровище', roomType: ROOM_TYPES.TREASURE },
    ], baseContext)).toBe(false);

    expect(validateRoomChoices([
      combat,
      { id: 'cursed', type: 'Проклятый враг', roomType: ROOM_TYPES.CURSED_ENEMY },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
    ], baseContext)).toBe(false);

    expect(validateRoomChoices([
      combat,
      { id: 'secret-cursed', type: 'Секрет', roomType: ROOM_TYPES.SECRET, hiddenRoomType: SECRET_TYPES.CURSED_ENEMY },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
    ], baseContext)).toBe(false);
  });

  test('validateRoomChoices rejects boss or cursed rooms without backing pools', () => {
    const combat = { id: 'combat', type: 'Бой', roomType: ROOM_TYPES.COMBAT };
    expect(validateRoomChoices([
      combat,
      { id: 'boss', type: 'Босс', roomType: ROOM_TYPES.BOSS },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
    ], { state: { completedCombatRooms: 14, choiceWindowIndex: 10 }, hasBossEnemy: false, hasCursedEnemyPool: true })).toBe(false);

    expect(validateRoomChoices([
      combat,
      { id: 'cursed', type: 'Проклятый враг', roomType: ROOM_TYPES.CURSED_ENEMY },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
    ], { state: { completedCombatRooms: 5, choiceWindowIndex: 4 }, hasBossEnemy: true, hasCursedEnemyPool: false })).toBe(false);
  });

  test('validateRoomChoices accepts a valid saved window', () => {
    expect(validateRoomChoices([
      { id: 'combat', type: 'Бой', roomType: ROOM_TYPES.COMBAT },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
      { id: 'secret', type: 'Секрет', roomType: ROOM_TYPES.SECRET, hiddenRoomType: SECRET_TYPES.RESOURCE },
    ], { state: { completedCombatRooms: 5, choiceWindowIndex: 4 }, hasBossEnemy: true, hasCursedEnemyPool: true })).toBe(true);
  });

  test('normal combat generation can preserve empty phase-safe pools instead of leaking late enemies', () => {
    const { choices } = generateRoomChoices(makeContext(
      { completedCombatRooms: 0 },
      () => 0.99,
      { buildFightEncounter: () => ({ enemies: [], miniBoss: false }) }
    ));
    const combatChoice = choices.find(choice => choice.roomType === ROOM_TYPES.COMBAT);
    expect(combatChoice.enemies).toEqual([]);
  });



  test('Mushroom early combat pool excludes late and cursed enemies', () => {
    const fungalNonBoss = enemies.filter(enemyEntry => enemyEntry.location === FUNGAL_LOCATION && !enemyEntry.boss);
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: fungalNonBoss,
      selectedLocation: FUNGAL_LOCATION,
      completedCombatRooms: 0,
    });
    expect(earlyPool.map(enemyEntry => enemyEntry.name).sort()).toEqual([
      'Троглодит-заклинатель змей',
      'Троглодит-заражённый',
      'Троглодит-копейщик',
      'Троглодит-споровик',
      'Троглодит-шаман',
    ].sort());
    expect(earlyPool.some(enemyEntry => enemyEntry.encounterPhase === 'late')).toBe(false);
    expect(earlyPool.some(enemyEntry => enemyEntry.miniBoss || enemyEntry.roomRole === 'cursedEnemy' || enemyEntry.encounterPhase === 'elite')).toBe(false);
    expect(earlyPool.some(enemyEntry => /Оскверн|Искаж/.test(enemyEntry.name))).toBe(false);
  });

  test('Mushroom mid combat pool includes late enemies but keeps cursed enemies out of normal combat', () => {
    const fungalNonBoss = enemies.filter(enemyEntry => enemyEntry.location === FUNGAL_LOCATION && !enemyEntry.boss);
    const midPool = getTrashEnemyPool({
      nonBossEnemies: fungalNonBoss,
      selectedLocation: FUNGAL_LOCATION,
      completedCombatRooms: 7,
    });
    expect(midPool.map(enemyEntry => enemyEntry.name)).toEqual(expect.arrayContaining([
      'Одичавший троглодит',
      'Костестраж',
      'Змеиный двоеглав',
    ]));
    expect(midPool.some(enemyEntry => enemyEntry.roomRole === 'cursedEnemy' || enemyEntry.encounterPhase === 'elite')).toBe(false);
  });

  test('Mushroom cursed room pool uses explicit cursed enemies only', () => {
    const fungalNonBoss = enemies.filter(enemyEntry => enemyEntry.location === FUNGAL_LOCATION && !enemyEntry.boss);
    const cursedPool = getCursedEnemyPool(fungalNonBoss);
    expect(cursedPool.map(enemyEntry => enemyEntry.name).sort()).toEqual([
      'Искажённый троглодит-тотемщик',
      'Осквернённый троглодит-змееголов',
    ].sort());
    expect(cursedPool.every(enemyEntry => enemyEntry.roomRole === 'cursedEnemy' && enemyEntry.miniBoss)).toBe(true);
  });
  test('Змеиный двоеглав is a late poison predator without snake summoning', () => {
    const snake = allEnemies.find(enemyEntry => enemyEntry.name === 'Змеиный двоеглав');
    expect(snake).toBeTruthy();
    expect(snake.encounterPhase).toBe('late');
    expect(snake.abilityNames).toEqual(expect.arrayContaining(['Двойной укус', 'Змеиная увертка']));
    expect(snake.abilityNames).not.toContain('Ядовитый инстинкт');
    expect(snake.abilityNames).not.toContain('Змеиный зов');
    const bite = ABILITY_LIBRARY['Двойной укус'];
    expect(bite.effect).toEqual([{ id: 'poison', duration: 2 }, { id: 'poison', duration: 2 }]);
    const cleanTarget = { name: 'Герой', effects: [] };
    const poisonedTarget = { name: 'Герой', effects: [{ id: 'poison', type: 'debuff' }] };
    expect(bite.damage({ attacker: snake, target: poisonedTarget })).toBeGreaterThan(
      bite.damage({ attacker: snake, target: cleanTarget })
    );
    expect(EFFECT_LIBRARY.evasion).toBeTruthy();
  });

  test('Троглодит-заклинатель змей keeps the snake-summoner identity', () => {
    const caster = allEnemies.find(enemyEntry => enemyEntry.name === 'Троглодит-заклинатель змей');
    expect(caster.abilityNames).toContain('Змеиный зов');
    expect(ABILITY_LIBRARY['Змеиный зов'].apply.toString()).toContain('Пещерная змея');
  });


  test('Mushroom boss follows completed combat boss gating', () => {
    const fungalBoss = enemies.find(enemyEntry => enemyEntry.location === FUNGAL_LOCATION && enemyEntry.boss);
    const commonContext = {
      locationName: FUNGAL_LOCATION,
      bossEnemy: fungalBoss,
      hasBossEnemy: true,
      hasCursedEnemyPool: true,
      cursePool,
      rollChestLoot: () => [{ name: 'Серебро', quantity: 10 }],
      buildFightEncounter: () => ({ enemies: [enemy], miniBoss: false }),
    };
    expect(generateRoomChoices({ ...commonContext, state: { completedCombatRooms: 13 }, rng: () => 0 }).choices
      .some(choice => choice.roomType === ROOM_TYPES.BOSS)).toBe(false);
    expect(generateRoomChoices({ ...commonContext, state: { completedCombatRooms: 14 }, rng: () => 0 }).choices
      .some(choice => choice.roomType === ROOM_TYPES.BOSS)).toBe(true);
  });

  test('Deserter Camp is selectable with stable unique location metadata', () => {
    expect(DESERTER_LOCATION).toBe('Лагерь Отступников');
    const locationSource = fs.readFileSync('src/data/locations.js', 'utf8');
    expect(locationSource).toContain("id: 'goblin'");
    expect(locationSource).toContain("id: 'fungal'");
    expect(locationSource).toContain("id: 'deserter'");
    expect(locationSource).toContain('GOBLIN_LOCATION');
    expect(locationSource).toContain('FUNGAL_LOCATION');
    expect(locationSource).toContain('DESERTER_LOCATION');

    const ids = AVAILABLE_LOCATIONS.map(location => location.id);
    const names = AVAILABLE_LOCATIONS.map(location => location.name);
    expect(ids).toEqual(['goblin', 'fungal', 'deserter']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });


  test('Abyss location metadata is shared and supports the dedicated location picker flow', () => {
    expect(AVAILABLE_LOCATIONS.map(location => location.name)).toEqual([
      GOBLIN_LOCATION,
      FUNGAL_LOCATION,
      DESERTER_LOCATION,
    ]);
    expect(new Set(AVAILABLE_LOCATIONS.map(location => location.id)).size).toBe(AVAILABLE_LOCATIONS.length);
    expect(AVAILABLE_LOCATIONS.find(location => location.name === DESERTER_LOCATION)).toMatchObject({
      id: 'deserter',
      hasCombatLocationEffect: false,
    });

    const appSource = fs.readFileSync('src/App.js', 'utf8');
    expect(appSource).toContain("setCurrentScreen('locationSelect')");
    expect(appSource).toContain('LocationSelectionScreen');
    expect(appSource).toContain('startDungeonRun(prepareFreshDungeonRun(player, locationName))');

    const dungeonScreenSource = fs.readFileSync('src/components/DungeonScreen.js', 'utf8');
    expect(dungeonScreenSource).not.toContain('useState(player?.currentLocation || GOBLIN_LOCATION)');
    expect(dungeonScreenSource).toContain('const selectedLocation = player?.currentLocation || null');
    expect(dungeonScreenSource).toContain('if (!selectedLocation) return { choices: [], state: null }');
    expect(dungeonScreenSource).not.toContain('AVAILABLE_LOCATIONS.map');
  });

  test('fresh run helper owns selected location and clears stale run state before room generation', () => {
    const previousState = {
      name: 'Герой',
      hp: 40,
      maxHp: 100,
      inventory: ['Сереброносный осколок'],
      silver: 77,
      currentLocation: FUNGAL_LOCATION,
      currentEnemies: [{ name: 'Старый враг' }],
      currentCombatRoomType: ROOM_TYPES.COMBAT,
      isBoss: true,
      currentDungeonChoices: [{ id: 'stale', roomType: ROOM_TYPES.BOSS }],
      currentDungeonChoicesLocation: FUNGAL_LOCATION,
      currentPathEvent: { type: 'Алтарь', status: 'active' },
      activeCombat: { state: {} },
      preCombatEffects: [{ id: 'burn' }],
      portalStone: { hasStone: true },
      curses: { corruption: { tier: 2 } },
      roomGenerationState: {
        [FUNGAL_LOCATION]: { completedCombatRooms: 13, choiceWindowIndex: 9 },
        [GOBLIN_LOCATION]: { completedCombatRooms: 7, choiceWindowIndex: 7 },
      },
    };

    const started = prepareFreshDungeonRun(previousState, GOBLIN_LOCATION);
    expect(started.currentLocation).toBe(GOBLIN_LOCATION);
    expect(started.currentEnemies).toBeUndefined();
    expect(started.currentCombatRoomType).toBeNull();
    expect(started.isBoss).toBe(false);
    expect(started.currentDungeonChoices).toBeNull();
    expect(started.currentDungeonChoicesLocation).toBeNull();
    expect(started.currentPathEvent).toBeNull();
    expect(started.activeCombat).toBeNull();
    expect(started.preCombatEffects).toEqual([]);
    expect(started.portalStone).toBeNull();
    expect(started.curses).toEqual({});
    expect(started.inventory).toBeUndefined();
    expect(started.silver).toBe(previousState.silver);
    expect(started.roomGenerationState[GOBLIN_LOCATION]).toMatchObject({ completedCombatRooms: 0, choiceWindowIndex: 0 });
    expect(started.roomGenerationState[FUNGAL_LOCATION]).toEqual(previousState.roomGenerationState[FUNGAL_LOCATION]);
  });

  test('portal return reset clears run state while preserving extracted rewards and meta progression', () => {
    const returned = resetDungeonRunState({
      name: 'Герой',
      hp: 12,
      maxHp: 90,
      inventory: ['Сломанная клятва'],
      silver: 321,
      equipment: { weapon: 'Старый короткий лук' },
      runes: { inventory: ['test-rune'] },
      relics: { activeRelicId: 'ember', progress: { ember: { level: 1, xp: 5 } } },
      safeSlots: ['Сломанная клятва'],
      currentLocation: DESERTER_LOCATION,
      currentEnemies: [{ name: 'Мастер клинков' }],
      currentCombatRoomType: ROOM_TYPES.BOSS,
      isBoss: true,
      preCombatEffects: [{ id: 'shock' }],
      items: [{ name: 'Малое зелье лечения' }],
      _equipmentBattleFlags: { used: true },
      _equipmentTurnFlags: { used: true },
      portalStone: { hasStone: true },
      currentDungeonChoices: [{ id: 'stale' }],
      currentDungeonChoicesLocation: DESERTER_LOCATION,
      currentPathEvent: { type: 'Алтарь', status: 'active' },
      activeCombat: { state: {} },
      curses: { corruption: { tier: 2 } },
      roomGenerationState: { [DESERTER_LOCATION]: { completedCombatRooms: 14 } },
      questLog: {},
    });

    expect(returned.hp).toBe(90);
    expect(returned.currentLocation).toBeNull();
    expect(returned.currentEnemies).toBeUndefined();
    expect(returned.currentCombatRoomType).toBeNull();
    expect(returned.isBoss).toBe(false);
    expect(returned.preCombatEffects).toEqual([]);
    expect(returned.items).toBeUndefined();
    expect(returned.portalStone).toBeNull();
    expect(returned.currentDungeonChoices).toBeNull();
    expect(returned.currentDungeonChoicesLocation).toBeNull();
    expect(returned.currentPathEvent).toBeNull();
    expect(returned.activeCombat).toBeNull();
    expect(returned.curses).toEqual({});
    expect(returned.roomGenerationState).toEqual({});
    expect(returned.inventory).toEqual(['Сломанная клятва']);
    expect(returned.silver).toBe(321);
    expect(returned.equipment).toEqual({ weapon: 'Старый короткий лук' });
    expect(returned.runes).toEqual({ inventory: ['test-rune'] });
    expect(returned.relics).toEqual({ activeRelicId: 'ember', progress: { ember: { level: 1, xp: 5 } } });
  });

  test('Curse Altar handling is guarded, consumes stale choices, and disables duplicate offers', () => {
    const dungeonScreenSource = fs.readFileSync('src/components/DungeonScreen.js', 'utf8');
    expect(dungeonScreenSource).toContain('const altarResolvingRef = useRef(false)');
    expect(dungeonScreenSource).toContain('const [altarResolving, setAltarResolving] = useState(false)');
    expect(dungeonScreenSource).toContain('claimedPathIdsRef.current.add(pathId)');
    expect(dungeonScreenSource).toContain('if (!activeAltar || !onUpdatePlayer || altarResolvingRef.current || altarResolving) return');
    expect(dungeonScreenSource).toContain('currentDungeonChoices: null');
    expect(dungeonScreenSource).toContain('currentDungeonChoicesLocation: null');
    expect(dungeonScreenSource).toContain('currentPathEvent: null');
    expect(dungeonScreenSource).toContain('offerDisabled={altarResolving}');

    const altarModalSource = fs.readFileSync('src/components/AltarRoomModal.js', 'utf8');
    expect(altarModalSource).toContain('offerDisabled = false');
    expect(altarModalSource).toContain("disabled={!preview?.canAccept || offerDisabled}");
  });

  test('Deserter Camp early combat pool gates late enemies and excludes cursed fixtures', () => {
    const deserterFixtures = [
      { name: 'Deserter Bruiser', location: DESERTER_LOCATION },
      { name: 'Deserter Halberd Master', location: DESERTER_LOCATION, encounterPhase: 'late' },
      { name: 'Corrupted Deserter', location: DESERTER_LOCATION, roomRole: 'cursedEnemy', encounterPhase: 'elite', miniBoss: true },
      { name: 'Deserter Summon', location: DESERTER_LOCATION, summonOnly: true },
    ];

    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: deserterFixtures,
      selectedLocation: DESERTER_LOCATION,
      completedCombatRooms: 0,
    });
    const midPool = getTrashEnemyPool({
      nonBossEnemies: deserterFixtures,
      selectedLocation: DESERTER_LOCATION,
      completedCombatRooms: 7,
    });
    const cursedPool = getCursedEnemyPool(deserterFixtures);

    expect(earlyPool.map(enemyEntry => enemyEntry.name)).toEqual(['Deserter Bruiser']);
    expect(midPool.map(enemyEntry => enemyEntry.name).sort()).toEqual([
      'Deserter Bruiser',
      'Deserter Halberd Master',
    ].sort());
    expect(midPool.some(enemyEntry => enemyEntry.roomRole === 'cursedEnemy' || enemyEntry.miniBoss)).toBe(false);
    expect(cursedPool.map(enemyEntry => enemyEntry.name)).toEqual(['Corrupted Deserter']);
  });

  test('Deserter Camp resource table includes universal healing and signature materials', () => {
    const table = getResourceRoomTable(DESERTER_LOCATION);
    const names = table.map(entry => entry.name);
    expect(names).toEqual([
      'Простая ткань',
      'Обрывки кожи',
      'Металлические обломки',
      'Простая склянка',
      'Кровяной мох',
      'Сумеречный вереск',
      'Черножильная руда',
    ]);
    expect(names).not.toContain('Мицелий');
    expect(names).not.toContain('Слизь мохоспора');
    expect(names).not.toContain('Споры');
    expect(names).not.toContain('Пыльца серого спорника');
    expect(names).not.toContain('Пыль костяной корки');
    expect(names).not.toContain('Спора светокапа');
    expect(names).not.toContain('Куртка Мародёра');
    expect(names).not.toContain('Алебарда Пограничного Дозора');
    table.forEach(entry => expect(findItemData(entry.name)?.type).toBe('material'));
  });

  test('Deserter Camp resource loot rolls only safe supply materials', () => {
    const forbidden = new Set([
      'Мицелий',
      'Слизь мохоспора',
      'Споры',
      'Пыльца серого спорника',
      'Пыль костяной корки',
      'Спора светокапа',
      'Куртка Мародёра',
      'Алебарда Пограничного Дозора',
      'Пепельная Маска Отступника',
      'Щит Дозорного Гильдии',
      'Натянутый охотничий лук',
      'Капюшон Следопыта',
      'Плащ разведчика',
      'Кольцо Меткой Тетивы',
    ]);
    const rng = lcg(424242);
    for (let i = 0; i < 500; i += 1) {
      const loot = rollResourceRoomLoot(DESERTER_LOCATION, rng);
      expect(loot.length).toBeGreaterThanOrEqual(2);
      loot.forEach(entry => {
        expect(forbidden.has(entry.name)).toBe(false);
        expect(findItemData(entry.name)?.type).toBe('material');
      });
    }
  });

  test('Archer early equipment pack exists with valid slots, rarity, stats, and metadata', () => {
    const archerItems = [
      'Натянутый охотничий лук',
      'Капюшон Следопыта',
      'Плащ разведчика',
      'Кольцо Меткой Тетивы',
    ];
    const validTypes = new Set(['Weapon', 'Helmet', 'Armor', 'Ring', 'Amulet', 'Shield']);
    const validRarities = new Set(['Обычная', 'Необычная', 'Редкая']);
    const validStats = new Set(['maxHp', 'attack', 'magAtk', 'physDef', 'magicDef', 'speed', 'speedPct', 'critChance', 'critDamage', 'dodge']);

    archerItems.forEach(itemName => {
      const item = equipmentByName[itemName];
      const itemData = findItemData(itemName);
      expect(item).toBeTruthy();
      expect(itemData).toBeTruthy();
      expect(item.class).toBe('Any');
      expect(validTypes.has(item.type)).toBe(true);
      expect(validRarities.has(item.rarity)).toBe(true);
      expect(EQUIPMENT_SLOT_KEYS).toContain(getEquipmentSlotForItem(item, {}));
      Object.keys(item.stats || {}).forEach(stat => expect(validStats.has(stat)).toBe(true));
      expect(item.smartLootTags?.classTags).toEqual(expect.arrayContaining(['archer', 'ranged']));
      expect(itemData.sourceTags).toEqual(expect.arrayContaining(['archer', 'ranged', 'early', 'martial', 'light', 'scout']));
      expect(itemData.sourceTags).not.toContain('fungal');
      expect(itemData.sourceTier).toBe('earlyEquipment');
      expect(itemData.type).toBe('equipment');
    });
  });


  test('equipment weapons have explicit weaponType and hands metadata without changing equip slots', () => {
    const allowedWeaponTypes = new Set(WEAPON_TYPES);
    const expectedClassifications = {
      'Ржавый меч новобранца': { weaponType: 'sword', hands: 1 },
      'Треснувший учебный фокус': { weaponType: 'focus', hands: 1 },
      'Старый короткий лук': { weaponType: 'bow', hands: 2 },
      'Натянутый охотничий лук': { weaponType: 'bow', hands: 2 },
      'Лук Спороносца': { weaponType: 'bow', hands: 2 },
      'Посох Украденной Искры': { weaponType: 'staff', hands: 2 },
      'Жезл Закопчённого Стекла': { weaponType: 'wand', hands: 1 },
      'Фокус Ледяного Спора': { weaponType: 'focus', hands: 1 },
      'Молот Спорового Стража': { weaponType: 'hammer', hands: 1 },
      'Тесак Гоблинского Мясника': { weaponType: 'axe', hands: 1 },
      'Булава Старого Сотника': { weaponType: 'mace', hands: 1 },
      'Алебарда Пограничного Дозора': { weaponType: 'halberd', hands: 2 },
      'Клятвопреступник': { weaponType: 'sword', hands: 1 },
    };

    const weapons = equipment.filter(item => item.type === 'Weapon');
    expect(weapons.map(item => item.name).sort()).toEqual(Object.keys(expectedClassifications).sort());

    weapons.forEach(item => {
      const expected = expectedClassifications[item.name];
      expect(expected).toBeTruthy();
      expect(item.weaponType).toBe(expected.weaponType);
      expect(item.hands).toBe(expected.hands);
      expect(allowedWeaponTypes.has(item.weaponType)).toBe(true);
      expect([1, 2]).toContain(item.hands);
      expect(getEquipmentSlotForItem(item, {})).toBe('mainHand');
      expect(findItemData(item.name)).toMatchObject({
        type: 'equipment',
        equipmentType: 'Weapon',
        weaponType: item.weaponType,
        hands: item.hands,
      });
    });

    equipment.filter(item => item.type !== 'Weapon').forEach(item => {
      expect(item.weaponType).toBeUndefined();
      expect(findItemData(item.name)?.weaponType).toBeUndefined();
    });
  });

  test('one-handed weapons remain compatible with offhand shields', () => {
    const sword = equipmentByName['Ржавый меч новобранца'];
    const shield = equipmentByName['Щит Дозорного Гильдии'];
    const withSword = equipItemInSlots({}, sword);
    const withShield = equipItemInSlots(withSword.equipment, shield);

    expect(withShield.equipment.mainHand).toBe(sword.name);
    expect(withShield.equipment.offHand).toBe(shield.name);
    expect(withShield.returnedItems).toEqual([]);
  });

  test('equipping a two-handed weapon returns the offhand shield to inventory', () => {
    const bow = equipmentByName['Старый короткий лук'];
    const shield = equipmentByName['Щит Дозорного Гильдии'];
    const result = equipItemInSlots({ offHand: shield.name }, bow);

    expect(result.equipment.mainHand).toBe(bow.name);
    expect(result.equipment.offHand).toBeNull();
    expect(result.returnedItems).toEqual([shield.name]);
  });

  test('equipping an offhand shield returns a two-handed weapon to inventory', () => {
    const staff = equipmentByName['Посох Украденной Искры'];
    const shield = equipmentByName['Щит Дозорного Гильдии'];
    const result = equipItemInSlots({ mainHand: staff.name }, shield);

    expect(result.equipment.mainHand).toBeNull();
    expect(result.equipment.offHand).toBe(shield.name);
    expect(result.returnedItems).toEqual([staff.name]);
  });

  test('replacing one two-handed weapon with another returns exactly one weapon', () => {
    const bow = equipmentByName['Старый короткий лук'];
    const halberd = equipmentByName['Алебарда Пограничного Дозора'];
    const result = equipItemInSlots({ mainHand: bow.name }, halberd);

    expect(result.equipment.mainHand).toBe(halberd.name);
    expect(result.equipment.offHand).toBeNull();
    expect(result.returnedItems).toEqual([bow.name]);
  });

  test('equipment stats are recalculated after both two-handed conflict directions', () => {
    const bow = equipmentByName['Старый короткий лук'];
    const shield = equipmentByName['Щит Дозорного Гильдии'];
    const basePlayer = {
      baseStats: { maxHp: 100, attack: 10, magAtk: 0, physDef: 5, magicDef: 0, speed: 10 },
      maxHp: 115,
      hp: 115,
      inventory: [],
      equipment: { mainHand: bow.name, offHand: null },
    };

    const shieldResult = equipItemInSlots(basePlayer.equipment, shield);
    const withShield = applyEquipmentPatch(
      basePlayer,
      shieldResult.equipment,
      shieldResult.returnedItems
    );
    expect(withShield.inventory).toEqual([bow.name]);
    expect(withShield.attack).toBe(10);
    expect(withShield.physDef).toBe(19);
    expect(withShield.maxHp).toBe(114);

    const bowResult = equipItemInSlots(withShield.equipment, bow);
    const withBow = applyEquipmentPatch(
      withShield,
      bowResult.equipment,
      [...withShield.inventory.filter(name => name !== bow.name), ...bowResult.returnedItems]
    );
    expect(withBow.inventory).toEqual([shield.name]);
    expect(withBow.attack).toBe(16);
    expect(withBow.physDef).toBe(5);
    expect(withBow.maxHp).toBe(100);
  });

  test('persisted two-handed and offhand conflicts normalize without losing items', () => {
    const bow = equipmentByName['Старый короткий лук'];
    const shield = equipmentByName['Щит Дозорного Гильдии'];
    const normalized = normalizeEquipmentLoadout(
      { mainHand: bow.name, offHand: shield.name },
      ['Малое зелье здоровья']
    );

    expect(normalized.equipment.mainHand).toBe(bow.name);
    expect(normalized.equipment.offHand).toBeNull();
    expect(normalized.inventory).toEqual(['Малое зелье здоровья', shield.name]);
    expect(normalized.returnedItems).toEqual([shield.name]);
    expect(normalizeEquipmentLoadout(normalized.equipment, normalized.inventory)).toEqual({
      equipment: normalized.equipment,
      inventory: normalized.inventory,
      returnedItems: [],
    });
  });

  test('weapon and shield proficiencies are centralized for all playable class keys', () => {
    const items = {
      sword: equipmentByName['Ржавый меч новобранца'],
      mace: equipmentByName['Булава Старого Сотника'],
      axe: equipmentByName['Тесак Гоблинского Мясника'],
      halberd: equipmentByName['Алебарда Пограничного Дозора'],
      bow: equipmentByName['Натянутый охотничий лук'],
      focus: equipmentByName['Фокус Ледяного Спора'],
      wand: equipmentByName['Жезл Закопчённого Стекла'],
      staff: equipmentByName['Посох Украденной Искры'],
      shield: equipmentByName['Щит Дозорного Гильдии'],
    };
    const canEquip = (playerClass, item) => validateClassEquipment(playerClass, item).canEquip;

    ['sword', 'mace', 'axe', 'halberd', 'shield'].forEach(type => {
      expect(canEquip('Defender', items[type])).toBe(true);
    });
    ['bow', 'focus', 'wand', 'staff'].forEach(type => {
      expect(canEquip('Defender', items[type])).toBe(false);
    });

    ['Mage', 'Elementalist'].forEach(playerClass => {
      ['focus', 'wand', 'staff'].forEach(type => {
        expect(canEquip(playerClass, items[type])).toBe(true);
      });
      ['sword', 'mace', 'axe', 'halberd', 'bow', 'shield'].forEach(type => {
        expect(canEquip(playerClass, items[type])).toBe(false);
      });
      expect(canEquip(playerClass, equipmentByName['Треснувший учебный фокус'])).toBe(true);
    });

    expect(canEquip('Archer', items.bow)).toBe(true);
    ['sword', 'mace', 'axe', 'halberd', 'focus', 'wand', 'staff', 'shield'].forEach(type => {
      expect(canEquip('Archer', items[type])).toBe(false);
    });
  });

  test('proficiency supplements class restrictions and leaves armor and accessories flexible', () => {
    const archerBow = equipmentByName['Натянутый охотничий лук'];
    const archerHood = equipmentByName['Капюшон Следопыта'];
    const genericArmor = equipmentByName['Куртка Новобранца'];
    const genericRing = equipmentByName['Кольцо Туманного Мха'];

    expect(validateClassEquipment('Defender', archerBow).canEquip).toBe(false);
    expect(validateClassEquipment('Defender', archerHood).canEquip).toBe(true);
    ['Defender', 'Mage', 'Elementalist', 'Archer'].forEach(playerClass => {
      expect(validateClassEquipment(playerClass, genericArmor).canEquip).toBe(true);
      expect(validateClassEquipment(playerClass, genericRing).canEquip).toBe(true);
    });
  });

  test('invalid proficiency attempts preserve inventory, equipment, and player stats', () => {
    const bow = equipmentByName['Старый короткий лук'];
    const cleaver = equipmentByName['Тесак Гоблинского Мясника'];
    const equipmentState = { mainHand: bow.name };
    const inventory = [cleaver.name, 'Малое зелье здоровья'];
    const playerStats = { attack: 14, speed: 130, maxHp: 90 };
    const result = equipInventoryItemForClass({
      playerClass: 'Archer',
      equipmentState,
      inventory,
      item: cleaver,
    });

    expect(result.canEquip).toBe(false);
    expect(result.equipment.mainHand).toBe(bow.name);
    expect(result.inventory).toEqual(inventory);
    expect(equipmentState).toEqual({ mainHand: bow.name });
    expect(inventory).toEqual([cleaver.name, 'Малое зелье здоровья']);
    expect(playerStats).toEqual({ attack: 14, speed: 130, maxHp: 90 });
  });

  test('legacy proficiency violations return items and recalculate without stale stats', () => {
    const halberd = equipmentByName['Алебарда Пограничного Дозора'];
    const shield = equipmentByName['Щит Дозорного Гильдии'];
    const staff = equipmentByName['Посох Украденной Искры'];
    const archerLoadout = normalizeEquipmentLoadout({ mainHand: halberd.name }, [], 'Archer');
    const mageLoadout = normalizeEquipmentLoadout({ offHand: shield.name }, [], 'Mage');
    const defenderLoadout = normalizeEquipmentLoadout({ mainHand: staff.name }, [], 'Defender');

    expect(archerLoadout.equipment.mainHand).toBeNull();
    expect(archerLoadout.inventory).toEqual([halberd.name]);
    expect(mageLoadout.equipment.offHand).toBeNull();
    expect(mageLoadout.inventory).toEqual([shield.name]);
    expect(defenderLoadout.equipment.mainHand).toBeNull();
    expect(defenderLoadout.inventory).toEqual([staff.name]);

    const normalizedArcher = applyEquipmentPatch({
      class: 'Archer',
      baseStats: { maxHp: 90, attack: 10, magAtk: 0, physDef: 2, magicDef: 1, speed: 120 },
      maxHp: 90,
      hp: 90,
      attack: 26,
      physDef: 10,
      equipment: { mainHand: halberd.name },
      inventory: [],
    }, { mainHand: halberd.name }, []);
    expect(normalizedArcher.equipment.mainHand).toBeNull();
    expect(normalizedArcher.inventory).toEqual([halberd.name]);
    expect(normalizedArcher.attack).toBe(10);
    expect(normalizedArcher.physDef).toBe(2);
  });

  test('class normalization preserves valid gear and then resolves valid two-handed conflicts', () => {
    const sword = equipmentByName['Ржавый меч новобранца'];
    const halberd = equipmentByName['Алебарда Пограничного Дозора'];
    const shield = equipmentByName['Щит Дозорного Гильдии'];
    const valid = normalizeEquipmentLoadout({ mainHand: sword.name, offHand: shield.name }, [], 'Defender');
    const conflict = normalizeEquipmentLoadout({ mainHand: halberd.name, offHand: shield.name }, [], 'Defender');

    expect(valid.equipment.mainHand).toBe(sword.name);
    expect(valid.equipment.offHand).toBe(shield.name);
    expect(valid.inventory).toEqual([]);
    expect(conflict.equipment.mainHand).toBe(halberd.name);
    expect(conflict.equipment.offHand).toBeNull();
    expect(conflict.inventory).toEqual([shield.name]);
  });

  test('unknown classes cannot equip weapons or shields but retain flexible Any accessories', () => {
    expect(validateClassEquipment('FutureClass', equipmentByName['Тесак Гоблинского Мясника']).canEquip).toBe(false);
    expect(validateClassEquipment('FutureClass', equipmentByName['Фокус Ледяного Спора']).canEquip).toBe(false);
    expect(validateClassEquipment('FutureClass', equipmentByName['Щит Дозорного Гильдии']).canEquip).toBe(false);
    expect(validateClassEquipment('FutureClass', equipmentByName['Куртка Новобранца']).canEquip).toBe(true);
  });

  test('Mushroom weapon proficiencies and hand rules match Defender and Archer identities', () => {
    const hammer = equipmentByName['Молот Спорового Стража'];
    const bow = equipmentByName['Лук Спороносца'];
    const shield = equipmentByName['Щит Дозорного Гильдии'];

    expect(hammer).toMatchObject({
      class: 'Any',
      type: 'Weapon',
      weaponType: 'hammer',
      hands: 1,
      rarity: 'Необычная',
      stats: { attack: 9, physDef: 5 },
    });
    expect(validateClassEquipment('Defender', hammer).canEquip).toBe(true);
    expect(validateClassEquipment('Mage', hammer).canEquip).toBe(false);
    expect(validateClassEquipment('Elementalist', hammer).canEquip).toBe(false);
    expect(validateClassEquipment('Archer', hammer).canEquip).toBe(false);
    const hammerAndShield = equipItemInSlots({ mainHand: hammer.name }, shield);
    expect(hammerAndShield.equipment).toMatchObject({ mainHand: hammer.name, offHand: shield.name });

    expect(bow).toMatchObject({
      class: 'Archer',
      type: 'Weapon',
      weaponType: 'bow',
      hands: 2,
      rarity: 'Необычная',
      stats: { attack: 17, speedPct: 0.02 },
    });
    expect(validateClassEquipment('Archer', bow).canEquip).toBe(true);
    expect(validateClassEquipment('Defender', bow).canEquip).toBe(false);
    expect(validateClassEquipment('Mage', bow).canEquip).toBe(false);
    expect(validateClassEquipment('Elementalist', bow).canEquip).toBe(false);
  });

  test('Spore Guard Hammer dispels exactly one random removable buff on direct basic damage', () => {
    const random = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0, 0.99]));
    try {
      const session = initCombatSession(
        {
          name: 'Защитник',
          class: 'Defender',
          hp: 100,
          maxHp: 100,
          attack: 20,
          critChance: 0,
          equipment: { mainHand: 'Молот Спорового Стража' },
          abilities: [{ name: 'Атака', basic: true, damage: 12, cooldown: 0, type: 'physical', alwaysHits: true }],
        },
        [{ name: 'Усиленный враг', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] }]
      );
      const target = session.state.enemies[0];
      addEffect(target, { id: 'attack_boost_minor', duration: 2 }, () => {}, target, { session });
      addEffect(target, { id: 'speed_boost_minor', duration: 2 }, () => {}, target, { session });
      addEffect(target, { id: 'rebirth', duration: 2 }, () => {}, target, { session });
      session.state.initiative.playerReady = true;

      performPlayerAction(session, 'Атака', 0);

      expect(target.effects.filter(effect => ['attack_boost_minor', 'speed_boost_minor'].includes(effect.id))).toHaveLength(1);
      expect(target.effects.some(effect => effect.id === 'rebirth')).toBe(true);
      expect(session.state.log.filter(line => line.includes('Молот Спорового Стража') && line.includes('снимает'))).toHaveLength(1);
    } finally {
      random.mockRestore();
    }
  });

  test('Spore Guard Hammer procs on direct abilities, stays silent without buffs, and ignores indirect damage', () => {
    const directRandom = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0, 0]));
    try {
      const session = initCombatSession(
        {
          name: 'Защитник',
          class: 'Defender',
          hp: 100,
          maxHp: 100,
          attack: 20,
          critChance: 0,
          equipment: { mainHand: 'Молот Спорового Стража' },
          abilities: [{ name: 'Удар молотом', damage: 14, cooldown: 0, type: 'physical', alwaysHits: true }],
        },
        [{ name: 'Страж', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] }]
      );
      const target = session.state.enemies[0];
      addEffect(target, { id: 'phys_def_boost_minor', duration: 2 }, () => {}, target, { session });
      session.state.initiative.playerReady = true;
      performPlayerAction(session, 'Удар молотом', 0);
      expect(target.effects.some(effect => effect.id === 'phys_def_boost_minor')).toBe(false);
    } finally {
      directRandom.mockRestore();
    }

    withMockedRandom(0, () => {
      const noBuffSession = initCombatSession(
        {
          name: 'Защитник',
          class: 'Defender',
          hp: 100,
          maxHp: 100,
          attack: 20,
          critChance: 0,
          equipment: { mainHand: 'Молот Спорового Стража' },
          abilities: [{ name: 'Пустой удар', damage: 10, cooldown: 0, type: 'physical', alwaysHits: true }],
        },
        [{ name: 'Чистая цель', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] }]
      );
      noBuffSession.state.initiative.playerReady = true;
      performPlayerAction(noBuffSession, 'Пустой удар', 0);
      expect(noBuffSession.state.log.some(line => line.includes('Молот Спорового Стража') && line.includes('снимает'))).toBe(false);
    });

    const indirectSession = initCombatSession(
      {
        name: 'Защитник',
        class: 'Defender',
        hp: 100,
        maxHp: 100,
        attack: 20,
        equipment: { mainHand: 'Молот Спорового Стража' },
        abilities: [],
      },
      [{ name: 'Отравленный страж', hp: 100, maxHp: 100, effects: [], abilities: [] }]
    );
    const indirectTarget = indirectSession.state.enemies[0];
    addEffect(indirectTarget, { id: 'attack_boost_minor', duration: 2 }, () => {}, indirectTarget, { session: indirectSession });
    addEffect(indirectTarget, { id: 'poison', duration: 1 }, () => {}, indirectSession.state.players[0], { session: indirectSession });
    withMockedRandom(0, () => processEffects(indirectTarget, () => {}, { session: indirectSession }));
    expect(indirectTarget.effects.some(effect => effect.id === 'attack_boost_minor')).toBe(true);
  });

  test('Sporebearer Bow applies existing Poison on direct hits and respects failed rolls', () => {
    const makeBowSession = ability => initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 90,
        maxHp: 90,
        attack: 18,
        critChance: 0,
        equipment: { mainHand: 'Лук Спороносца' },
        abilities: [ability],
      },
      [{ name: 'Цель', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] }]
    );

    const basicRandom = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0]));
    try {
      const basicSession = makeBowSession({ name: 'Атака', basic: true, damage: 10, cooldown: 0, type: 'physical', alwaysHits: true });
      basicSession.state.initiative.playerReady = true;
      performPlayerAction(basicSession, 'Атака', 0);
      expect(basicSession.state.enemies[0].effects.find(effect => effect.id === 'poison')).toBeTruthy();
      expect(basicSession.state.log.some(line => line.includes('получает эффект "Отравление"'))).toBe(true);
    } finally {
      basicRandom.mockRestore();
    }

    const abilityRandom = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0]));
    try {
      const abilitySession = makeBowSession({ name: 'Споровый выстрел', damage: 12, cooldown: 0, type: 'physical', alwaysHits: true });
      abilitySession.state.initiative.playerReady = true;
      performPlayerAction(abilitySession, 'Споровый выстрел', 0);
      expect(abilitySession.state.enemies[0].effects.some(effect => effect.id === 'poison')).toBe(true);
    } finally {
      abilityRandom.mockRestore();
    }

    const failedRandom = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0.25]));
    try {
      const failedSession = makeBowSession({ name: 'Неудачный выстрел', damage: 12, cooldown: 0, type: 'physical', alwaysHits: true });
      failedSession.state.initiative.playerReady = true;
      performPlayerAction(failedSession, 'Неудачный выстрел', 0);
      expect(failedSession.state.enemies[0].effects.some(effect => effect.id === 'poison')).toBe(false);
    } finally {
      failedRandom.mockRestore();
    }
  });

  test('Mushroom weapon procs ignore secondary damage and roll independently per directly hit target', () => {
    const secondaryRandom = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0, 0.99]));
    try {
      const secondarySession = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 18,
          critChance: 0,
          equipment: { mainHand: 'Лук Спороносца' },
          abilities: [{
            name: 'Выстрел с осколком',
            damage: 12,
            cooldown: 0,
            type: 'physical',
            alwaysHits: true,
            secondary: { target: 'otherEnemies', damage: 8, type: 'physical' },
          }],
        },
        [
          { name: 'Основная цель', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] },
          { name: 'Вторичная цель', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] },
        ]
      );
      secondarySession.state.initiative.playerReady = true;
      performPlayerAction(secondarySession, 'Выстрел с осколком', 0);
      expect(secondarySession.state.enemies[0].effects.some(effect => effect.id === 'poison')).toBe(true);
      expect(secondarySession.state.enemies[1].effects.some(effect => effect.id === 'poison')).toBe(false);
    } finally {
      secondaryRandom.mockRestore();
    }

    const hammerRandom = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0, 0, 0.99]));
    try {
      const hammerSession = initCombatSession(
        {
          name: 'Защитник',
          class: 'Defender',
          hp: 100,
          maxHp: 100,
          attack: 20,
          critChance: 0,
          equipment: { mainHand: 'Молот Спорового Стража' },
          abilities: [{
            name: 'Раскалывающий взмах',
            damage: 12,
            cooldown: 0,
            type: 'physical',
            alwaysHits: true,
            secondary: { target: 'otherEnemies', damage: 8, type: 'physical' },
          }],
        },
        [
          { name: 'Основной страж', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] },
          { name: 'Вторичный страж', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] },
        ]
      );
      addEffect(hammerSession.state.enemies[0], { id: 'speed_boost_minor', duration: 2 }, () => {}, hammerSession.state.enemies[0], { session: hammerSession });
      addEffect(hammerSession.state.enemies[1], { id: 'attack_boost_minor', duration: 2 }, () => {}, hammerSession.state.enemies[1], { session: hammerSession });
      hammerSession.state.initiative.playerReady = true;
      performPlayerAction(hammerSession, 'Раскалывающий взмах', 0);
      expect(hammerSession.state.enemies[0].effects.some(effect => effect.id === 'speed_boost_minor')).toBe(false);
      expect(hammerSession.state.enemies[1].effects.some(effect => effect.id === 'attack_boost_minor')).toBe(true);
    } finally {
      hammerRandom.mockRestore();
    }

    const aoeRandom = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0, 0.99, 0.25]));
    try {
      const aoeSession = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 18,
          critChance: 0,
          equipment: { mainHand: 'Лук Спороносца' },
          abilities: [{ name: 'Споровый залп', damage: 10, cooldown: 0, type: 'physical', targeting: 'allEnemies', alwaysHits: true }],
        },
        [
          { name: 'Первая цель', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] },
          { name: 'Вторая цель', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] },
        ]
      );
      aoeSession.state.initiative.playerReady = true;
      performPlayerAction(aoeSession, 'Споровый залп', 0);
      expect(aoeSession.state.enemies[0].effects.some(effect => effect.id === 'poison')).toBe(true);
      expect(aoeSession.state.enemies[1].effects.some(effect => effect.id === 'poison')).toBe(false);
    } finally {
      aoeRandom.mockRestore();
    }
  });

  test('Sporebearer Bow ignores Poison ticks and Piercing Wounds spillover', () => {
    const dotSession = initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 90,
        maxHp: 90,
        attack: 18,
        equipment: { mainHand: 'Лук Спороносца' },
        abilities: [],
      },
      [{ name: 'Отравленная цель', hp: 100, maxHp: 100, effects: [], abilities: [] }]
    );
    addEffect(dotSession.state.enemies[0], { id: 'poison', duration: 1 }, () => {}, dotSession.state.players[0], { session: dotSession });
    const dotRandom = jest.spyOn(Math, 'random');
    processEffects(dotSession.state.enemies[0], () => {}, { session: dotSession });
    expect(dotRandom).not.toHaveBeenCalled();
    dotRandom.mockRestore();

    const spillRandom = jest.spyOn(Math, 'random').mockImplementation(sequence([0.99, 0]));
    try {
      const spillSession = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 20,
          critChance: 0,
          equipment: { mainHand: 'Лук Спороносца' },
          abilityNames: ['Сквозные раны', 'Добивание'],
          abilities: [{ name: 'Добивание', damage: 20, cooldown: 0, type: 'physical', alwaysHits: true }],
        },
        [
          { name: 'Раненая цель', hp: 5, maxHp: 100, physDef: 0, effects: [], abilities: [] },
          { name: 'Вторая цель', hp: 100, maxHp: 100, physDef: 0, effects: [], abilities: [] },
        ]
      );
      spillSession.state.initiative.playerReady = true;
      performPlayerAction(spillSession, 'Добивание', 0);
      expect(spillSession.state.enemies[1].hp).toBe(85);
      expect(spillSession.state.enemies[1].effects.some(effect => effect.id === 'poison')).toBe(false);
    } finally {
      spillRandom.mockRestore();
    }
  });

  test('Mushroom weapons stay in Mushroom Treasure and out of guaranteed boss or cursed rewards', () => {
    const mushroomNames = getTreasurePoolNamesForLocation(FUNGAL_LOCATION);
    const goblinNames = getTreasurePoolNamesForLocation(GOBLIN_LOCATION);
    const deserterNames = getTreasurePoolNamesForLocation(DESERTER_LOCATION);
    const newItems = ['Молот Спорового Стража', 'Лук Спороносца'];

    newItems.forEach(itemName => {
      expect(mushroomNames).toContain(itemName);
      expect(goblinNames).not.toContain(itemName);
      expect(deserterNames).not.toContain(itemName);
      expect(findItemData(itemName)).toMatchObject({
        sourceTier: 'location',
        sourceTags: expect.arrayContaining(['fungal', 'mushroom', 'early', 'weapon']),
      });
      allEnemies
        .filter(enemyEntry => enemyEntry.boss || enemyEntry.roomRole === 'cursedEnemy')
        .forEach(enemyEntry => expect(enemyEntry.guaranteedLoot || []).not.toContain(itemName));
    });
  });

  test('thematic Archer armor is universal while bow remains proficiency-gated', () => {
    const archerItems = [
      'Натянутый охотничий лук',
      'Капюшон Следопыта',
      'Плащ разведчика',
      'Кольцо Меткой Тетивы',
    ];
    archerItems.forEach(itemName => {
      const item = equipmentByName[itemName];
      expect(validateClassEquipment('Archer', item).canEquip).toBe(true);
      const expectedOtherClassAccess = item.type !== 'Weapon';
      expect(validateClassEquipment('Defender', item).canEquip).toBe(expectedOtherClassAccess);
      expect(validateClassEquipment('Mage', item).canEquip).toBe(expectedOtherClassAccess);
      expect(validateClassEquipment('Elementalist', item).canEquip).toBe(expectedOtherClassAccess);
    });
  });

  test('Archer early equipment has intended early sources without leaking into Resource or Mushroom boss/cursed loot', () => {
    const archerItems = [
      'Натянутый охотничий лук',
      'Капюшон Следопыта',
      'Плащ разведчика',
      'Кольцо Меткой Тетивы',
    ];
    const resourceNames = [
      ...getResourceRoomTable('Гоблинские Норы'),
      ...getResourceRoomTable(FUNGAL_LOCATION),
      ...getResourceRoomTable(DESERTER_LOCATION),
    ].map(entry => entry.name);
    const mushroomBossOrCursed = allEnemies.filter(enemyEntry => (
      enemyEntry.location === FUNGAL_LOCATION && (enemyEntry.boss || enemyEntry.roomRole === 'cursedEnemy')
    ));

    archerItems.forEach(itemName => {
      expect(resourceNames).not.toContain(itemName);
      expect(findItemData(itemName)?.chestChance).toBeGreaterThan(0);
      mushroomBossOrCursed.forEach(enemyEntry => {
        expect(enemyEntry.lootTable || []).not.toContain(itemName);
      });
    });

    const goblinGearUsers = allEnemies.filter(enemyEntry => enemyEntry.location === 'Гоблинские Норы');
    expect(goblinGearUsers.some(enemyEntry => (enemyEntry.lootTable || []).includes('Натянутый охотничий лук'))).toBe(false);
    expect(allEnemies.find(enemyEntry => enemyEntry.name === 'Следопыт')?.lootTable).toEqual(expect.arrayContaining(['Капюшон Следопыта', 'Кольцо Меткой Тетивы']));
    expect(allEnemies.find(enemyEntry => enemyEntry.name === 'Трюкач')?.lootTable).toContain('Плащ разведчика');
  });

  test('class starting weapons remain unchanged after adding Archer gear', () => {
    const characterFactorySource = fs.readFileSync('src/utils/characterFactory.js', 'utf8');
    expect(characterFactorySource).toContain("Defender: 'Ржавый меч новобранца'");
    expect(characterFactorySource).toContain("Mage: 'Треснувший учебный фокус'");
    expect(characterFactorySource).toContain("Archer: 'Старый короткий лук'");
  });

  test('Production Deserter early pool contains only five normal enemies before five combats', () => {
    const deserterNonBoss = enemies.filter(enemyEntry => enemyEntry.location === DESERTER_LOCATION && !enemyEntry.boss);
    const earlyPool = getTrashEnemyPool({
      nonBossEnemies: deserterNonBoss,
      selectedLocation: DESERTER_LOCATION,
      completedCombatRooms: 0,
    });
    expect(earlyPool.map(enemyEntry => enemyEntry.name).sort()).toEqual([
      'Громила',
      'Дуэлянт',
      'Трюкач',
      'Следопыт',
      'Чернокнижник',
    ].sort());
    expect(earlyPool.every(enemyEntry => !enemyEntry.encounterPhase)).toBe(true);
    expect(earlyPool.some(enemyEntry => enemyEntry.roomRole === 'cursedEnemy' || enemyEntry.miniBoss || enemyEntry.summonOnly)).toBe(false);
  });

  test('Production Deserter late pool unlocks strong enemies after seven combats', () => {
    const deserterNonBoss = enemies.filter(enemyEntry => enemyEntry.location === DESERTER_LOCATION && !enemyEntry.boss);
    const latePool = getTrashEnemyPool({
      nonBossEnemies: deserterNonBoss,
      selectedLocation: DESERTER_LOCATION,
      completedCombatRooms: 7,
    });
    expect(latePool.map(enemyEntry => enemyEntry.name)).toEqual(expect.arrayContaining([
      'Аптекарь',
      'Заклинатель бурь',
      'Мастер алебарды',
    ]));
    expect(latePool.some(enemyEntry => enemyEntry.roomRole === 'cursedEnemy' || enemyEntry.encounterPhase === 'elite' || enemyEntry.miniBoss)).toBe(false);
  });

  test('Production Deserter cursed pool contains only explicit cursed enemies', () => {
    const deserterNonBoss = enemies.filter(enemyEntry => enemyEntry.location === DESERTER_LOCATION && !enemyEntry.boss);
    const cursedPool = getCursedEnemyPool(deserterNonBoss);
    expect(cursedPool.map(enemyEntry => enemyEntry.name).sort()).toEqual([
      'Искажённый страж',
      'Осквернённый рубака',
    ].sort());
    expect(cursedPool.every(enemyEntry => enemyEntry.roomRole === 'cursedEnemy' && enemyEntry.encounterPhase === 'elite' && enemyEntry.miniBoss)).toBe(true);
  });

  test('Production Deserter boss pool contains Master Blades', () => {
    const deserterBosses = enemies.filter(enemyEntry => enemyEntry.location === DESERTER_LOCATION && enemyEntry.boss);
    expect(deserterBosses.map(enemyEntry => enemyEntry.name)).toEqual(['Мастер клинков']);
  });

  test('Deserter boss room respects boss gating and never resolves as a secret boss', () => {
    const deserterBoss = allEnemies.find(enemyEntry => enemyEntry.name === 'Мастер клинков');
    const deserterContext = (state = {}, rng = () => 0.99) => makeContext(state, rng, {
      locationName: DESERTER_LOCATION,
      bossEnemy: deserterBoss,
      hasBossEnemy: Boolean(deserterBoss),
      buildFightEncounter: kind => {
        const deserterNonBoss = enemies.filter(enemyEntry => enemyEntry.location === DESERTER_LOCATION && !enemyEntry.boss);
        const pool = kind === 'cursed'
          ? getCursedEnemyPool(deserterNonBoss)
          : getTrashEnemyPool({
              nonBossEnemies: deserterNonBoss,
              selectedLocation: DESERTER_LOCATION,
              completedCombatRooms: state.completedCombatRooms ?? 0,
            });
        return { enemies: pool.slice(0, 2), miniBoss: kind === 'cursed' };
      },
    });

    const beforeGate = generateRoomChoices(deserterContext({ completedCombatRooms: 13 }, () => 0));
    expect(beforeGate.choices.some(choice => choice.roomType === ROOM_TYPES.BOSS)).toBe(false);

    const afterGate = generateRoomChoices(deserterContext({ completedCombatRooms: 14 }, () => 0));
    expect(afterGate.choices.some(choice => choice.roomType === ROOM_TYPES.BOSS)).toBe(true);

    for (let i = 0; i < 100; i += 1) {
      const rng = () => i / 100;
      const { choices } = generateRoomChoices(deserterContext({ completedCombatRooms: 14 }, rng));
      choices
        .filter(choice => choice.roomType === ROOM_TYPES.SECRET)
        .forEach(choice => expect(choice.hiddenRoomType).not.toBe(ROOM_TYPES.BOSS));
    }
  });

  test('Deserter enemies use existing ability presets and visible effect primitives', () => {
    const collectEffectIds = value => {
      if (!value) return [];
      if (Array.isArray(value)) return value.flatMap(collectEffectIds);
      if (typeof value === 'function') return [];
      if (typeof value === 'object') return value.id ? [value.id] : [];
      return [];
    };
    const deserterEnemies = allEnemies.filter(enemyEntry => enemyEntry.location === DESERTER_LOCATION);
    expect(deserterEnemies.length).toBe(11);
    deserterEnemies.forEach(enemyEntry => {
      enemyEntry.abilityNames.forEach(abilityName => {
        const ability = ABILITY_LIBRARY[abilityName];
        expect(ability).toBeTruthy();
        [...collectEffectIds(ability.effect), ...collectEffectIds(ability.selfEffects)].forEach(id => {
          expect(EFFECT_LIBRARY[id]).toBeTruthy();
        });
      });
    });
    expect(EFFECT_LIBRARY.poison_shield).toBeUndefined();
    expect(EFFECT_LIBRARY.spore_poison).toBeUndefined();
    expect(EFFECT_LIBRARY.spore_paralysis).toBeUndefined();
    expect(EFFECT_LIBRARY.shard_shield).toBeUndefined();
    expect(EFFECT_LIBRARY.bug_command_aura).toBeUndefined();
    expect(EFFECT_LIBRARY.deserter_mark).toBeUndefined();
    expect(EFFECT_LIBRARY.storm_mark).toBeUndefined();
  });

  test('Deserter early readability tuning limits illusion and bleed overlap', () => {
    const trickster = allEnemies.find(entry => entry.name === 'Трюкач');
    const duelist = allEnemies.find(entry => entry.name === 'Дуэлянт');
    const ranger = allEnemies.find(entry => entry.name === 'Следопыт');
    expect(trickster.abilityNames).toEqual(expect.arrayContaining(['Ослепляющая уловка', 'Удар из марева', 'Исчезающий трюк']));
    expect(ABILITY_LIBRARY['Ослепляющая уловка'].effect).toMatchObject({ id: 'blind', duration: 1 });
    expect(duelist.abilityNames).toEqual(expect.arrayContaining(['Завершающий выпад', 'Школа дуэлянта']));
    expect(ranger.abilityNames).toEqual(expect.arrayContaining(['Выжидающий выстрел', 'Силки']));
  });

  test('Deserter short defensive abilities use one-turn existing primitives', () => {
    const log = jest.fn();
    const session = { state: { enemies: [] } };
    const unit = { name: 'Дуэлянт', hp: 50, maxHp: 50, effects: [] };

    ABILITY_LIBRARY['Короткая уловка'].onBattleStart({ owner: unit, session, log });
    expect(unit.effects.find(effect => effect.id === 'evasion')).toMatchObject({ remainingTurns: 1 });

    unit.effects = [];
    ABILITY_LIBRARY['Дуэльный финт'].apply({ attacker: unit, log, session });
    expect(unit.effects.find(effect => effect.id === 'evasion')).toMatchObject({ remainingTurns: 1 });

    unit.effects = [];
    ABILITY_LIBRARY['Короткий контрудар'].apply({ attacker: unit, log, session });
    expect(unit.effects.find(effect => effect.id === 'iron_counter')).toMatchObject({ remainingTurns: 1 });
  });

  test('Late Deserter support remains bounded and halberd counter uptime is shortened', () => {
    const apothecary = { name: 'Аптекарь', hp: 80, maxHp: 92, effects: [] };
    const woundedAlly = {
      name: 'Мастер алебарды',
      hp: 50,
      maxHp: 100,
      effects: [{ id: 'bleed', type: 'debuff', remainingTurns: 2 }],
    };
    const session = { state: { enemies: [apothecary, woundedAlly] } };
    const log = jest.fn();

    ABILITY_LIBRARY['Полевая перевязка'].apply({ attacker: apothecary, target: woundedAlly, session, log });
    expect(woundedAlly.hp).toBe(64);
    expect(woundedAlly.effects.find(effect => effect.id === 'regeneration')).toMatchObject({ remainingTurns: 1 });
    expect(woundedAlly.effects.some(effect => effect.id === 'bleed')).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('на 14 HP'));

    const halberdMaster = allEnemies.find(enemyEntry => enemyEntry.name === 'Мастер алебарды');
    expect(halberdMaster?.abilityNames).toEqual(expect.arrayContaining(['Подхват слабости', 'Сбить строй']));
    expect(halberdMaster?.abilityNames).not.toContain('Контратака');
  });

  test('Apothecary healing applies to the authoritative ally target and not the player', () => {
    const player = { name: 'Герой', hp: 10, maxHp: 100, effects: [] };
    const apothecary = { name: 'Аптекарь', hp: 98, maxHp: 98, effects: [] };
    const lightlyWounded = { name: 'Громила', hp: 90, maxHp: 100, effects: [] };
    const mostWounded = { name: 'Мастер алебарды', hp: 30, maxHp: 100, effects: [] };
    const session = { state: { players: [player], enemies: [apothecary, lightlyWounded, mostWounded] } };
    const log = jest.fn();

    ABILITY_LIBRARY['Полевая перевязка'].apply({
      attacker: apothecary,
      target: mostWounded,
      session,
      log,
    });

    expect(player.hp).toBe(10);
    expect(lightlyWounded.hp).toBe(90);
    expect(mostWounded.hp).toBe(44);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Мастер алебарды'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('на 14 HP'));

    ABILITY_LIBRARY['Лечение'].apply({
      attacker: apothecary,
      target: mostWounded,
      session,
      log,
    });

    expect(player.hp).toBe(10);
    expect(mostWounded.hp).toBe(79);
  });

  test('Healing Scroll heals the hero directly, applies regeneration, and never targets enemies', () => {
    withMockedRandom(0.99, () => {
      const session = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 40,
          maxHp: 80,
          attack: 12,
          critChance: 0,
          items: ['Свиток Лечения'],
          abilities: [ABILITY_LIBRARY['Атака']],
        },
        [{ name: 'Раненый враг', hp: 10, maxHp: 80, attack: 1, boss: true }]
      );
      session.state.initiative.playerReady = true;

      const result = applyItemInCombat(session, 'Свиток Лечения');
      const player = result.session.state.players[0];
      const enemy = result.session.state.enemies[0];

      expect(result.itemUsed).toBe(true);
      expect(player.hp).toBe(60);
      expect(player.effects.find(effect => effect.id === 'regeneration')).toMatchObject({ remainingTurns: 1 });
      expect(enemy.hp).toBe(10);
      expect(player.items.some(item => item.name === 'Свиток Лечения')).toBe(false);
      expect(result.session.state.log.some(line => line.includes('Свиток Лечения восстанавливает Лучник 20 здоровья'))).toBe(true);
      expect(result.session.state.log.some(line => line.includes('Свиток Лечения накладывает Регенерацию на Лучник'))).toBe(true);
    });
  });

  test('Healing Scroll is not consumed when item-use validation fails', () => {
    const session = initCombatSession(
      {
        name: 'Лучник',
        hp: 40,
        maxHp: 80,
        attack: 12,
        items: ['Свиток Лечения'],
        abilities: [ABILITY_LIBRARY['Атака']],
      },
      [{ name: 'Манекен', hp: 80, maxHp: 80, attack: 1 }]
    );
    session.state.initiative.playerReady = false;

    const result = applyItemInCombat(session, 'Свиток Лечения');

    expect(result.itemUsed).toBe(false);
    expect(result.session.state.players[0].hp).toBe(40);
    expect(result.session.state.players[0].items.some(item => item.name === 'Свиток Лечения')).toBe(true);
  });

  test('Deserter bruiser and late caster stats reflect level 1 tuning', () => {
    const bruiser = allEnemies.find(enemyEntry => enemyEntry.name === 'Громила');
    expect(bruiser?.abilityNames).toEqual(['Тяжёлый замах', 'Размашистый удар', 'Атака']);
    expect(bruiser?.attack).toBeGreaterThan(16);
    expect(bruiser?.physDef).toBeLessThan(12);
    expect(bruiser?.abilityNames).not.toContain('Удар щитом');
    expect(bruiser?.abilityNames).not.toContain('Стойкость');

    const apothecary = allEnemies.find(enemyEntry => enemyEntry.name === 'Аптекарь');
    const stormCaller = allEnemies.find(enemyEntry => enemyEntry.name === 'Заклинатель бурь');
    const halberdMaster = allEnemies.find(enemyEntry => enemyEntry.name === 'Мастер алебарды');
    expect(apothecary?.speed).toBeGreaterThanOrEqual(98);
    expect(apothecary?.maxHp).toBeGreaterThanOrEqual(98);
    expect(halberdMaster?.speed).toBe(100);
    expect(halberdMaster?.speed).toBeLessThan(allEnemies.find(enemyEntry => enemyEntry.name === 'Следопыт')?.speed ?? 0);
    expect(stormCaller?.speed).toBeGreaterThanOrEqual(104);
    expect(stormCaller?.maxHp).toBe(96);
    expect(stormCaller?.magAtk).toBeGreaterThanOrEqual(20);
  });

  test('Halberd master counter and pressure use existing debuff primitives', () => {
    expect(EFFECT_LIBRARY.iron_counter.name).toBe('Контратака');
    const target = {
      name: 'Герой',
      hp: 100,
      maxHp: 100,
      physDef: 10,
      effects: [{ id: 'bleed', type: 'debuff', kind: 'debuff', remainingTurns: 1, duration: 1, durationTotal: 1 }],
    };
    const attacker = { name: 'Мастер алебарды', attack: 22, hp: 100, maxHp: 100, effects: [] };
    const plainDamage = ABILITY_LIBRARY['Напор алебардой'].damage({ attacker, target: { ...target, effects: [] } });
    const debuffedDamage = ABILITY_LIBRARY['Напор алебардой'].damage({ attacker, target });
    expect(debuffedDamage).toBeGreaterThan(plainDamage);

    ABILITY_LIBRARY['Напор алебардой'].apply({ attacker, target, session: { state: {} }, log: jest.fn() });
    expect(target.effects.find(effect => effect.id === 'phys_def_penalty_minor')).toMatchObject({ remainingTurns: 1 });
    expect(target.effects.find(effect => effect.id === 'bleed')).toMatchObject({ remainingTurns: 2 });

    const counterHolder = { name: 'Мастер алебарды', hp: 100, maxHp: 100, attack: 22, effects: [] };
    ABILITY_LIBRARY['Контратака'].apply({ attacker: counterHolder, session: { state: {} }, log: jest.fn() });
    expect(counterHolder.effects.find(effect => effect.id === 'iron_counter')?.extra?.counterEffect).toMatchObject({
      id: 'attack_penalty_minor',
      duration: 1,
    });

    const session = initCombatSession(
      { name: 'Герой', hp: 120, maxHp: 120, attack: 20, critChance: 0, abilities: [{ name: 'Проверочный удар', damage: 20, cooldown: 0, type: 'physical', alwaysHits: true }] },
      [{ name: 'Мастер алебарды', hp: 120, maxHp: 120, attack: 22, physDef: 0, magicDef: 0, abilities: [] }]
    );
    session.state.initiative.playerReady = true;
    addEffect(
      session.state.enemies[0],
      { id: 'iron_counter', duration: 1, extra: { counterEffect: { id: 'attack_penalty_minor', duration: 1 } } },
      () => {},
      session.state.enemies[0],
      { session }
    );
    performPlayerAction(session, 'Проверочный удар', 0);
    expect(session.state.players[0].effects.find(effect => effect.id === 'attack_penalty_minor')).toMatchObject({ remainingTurns: 1 });
    expect(session.state.log.some(line => line.includes('контратак'))).toBe(true);
  });

  test('Distorted Guard uses stance fracture instead of Shield Bash', () => {
    const guard = allEnemies.find(entry => entry.name === 'Искажённый страж');
    expect(guard.abilityNames).toEqual(expect.arrayContaining(['Искажённая стойка', 'Разлом барьера', 'Искажённый удар', 'Проводимость искажения']));
    expect(ABILITY_LIBRARY['Разлом барьера']).toMatchObject({ cooldown: 3, shieldDamageMultiplier: 2 });
  });

  test('target counterattacks resolve only after incoming damage and effects, and not after death', () => {
    const session = initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 100,
        maxHp: 100,
        attack: 20,
        critChance: 0,
        abilities: [
          {
            name: 'Пробный выстрел',
            damage: 20,
            cooldown: 0,
            type: 'physical',
            alwaysHits: true,
            effect: { id: 'speed_penalty_minor', duration: 1 },
          },
        ],
      },
      [{ name: 'Контрударник', hp: 45, maxHp: 45, attack: 8, physDef: 0, magicDef: 0, abilities: [] }]
    );
    const counterTarget = session.state.enemies[0];
    addEffect(counterTarget, { id: 'iron_counter', duration: 1 }, () => {}, counterTarget, { session });
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Пробный выстрел', 0);

    expect(counterTarget.hp).toBe(25);
    expect(counterTarget.effects.find(effect => effect.id === 'speed_penalty_minor')).toBeTruthy();
    expect(session.state.players[0].hp).toBe(94);
    expect(session.state.log.some(line => line.includes('контратак'))).toBe(true);

    const lethalSession = initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 100,
        maxHp: 100,
        attack: 50,
        critChance: 0,
        abilities: [{ name: 'Летальный выстрел', damage: 50, cooldown: 0, type: 'physical', alwaysHits: true }],
      },
      [{ name: 'Умирающий контрударник', hp: 12, maxHp: 12, attack: 50, physDef: 0, magicDef: 0, abilities: [] }]
    );
    addEffect(lethalSession.state.enemies[0], { id: 'iron_counter', duration: 1 }, () => {}, lethalSession.state.enemies[0], { session: lethalSession });
    lethalSession.state.initiative.playerReady = true;

    performPlayerAction(lethalSession, 'Летальный выстрел', 0);

    expect(lethalSession.state.enemies[0].hp).toBe(0);
    expect(lethalSession.state.players[0].hp).toBe(100);
    expect(lethalSession.state.log.some(line => line.includes('контратак'))).toBe(false);
  });

  test('Frost Shield reacts after a hit and can stop later multi-hit swings', () => {
    withMockedRandom(0, () => {
      const session = initCombatSession(
        { name: 'Маг', hp: 100, maxHp: 100, physDef: 0, magicDef: 0, attack: 5, abilities: [] },
        [{
          name: 'Двурукий налётчик',
          hp: 80,
          maxHp: 80,
          attack: 10,
          critChance: 0,
          physDef: 0,
          magicDef: 0,
          abilities: [{ name: 'Двойной тестовый удар', damage: 10, cooldown: 0, type: 'physical', alwaysHits: true, hitCount: 2 }],
        }]
      );
      const player = session.state.players[0];
      const attacker = session.state.enemies[0];
      addEffect(player, { id: 'shield', duration: 2, value: 30, extra: { frostRetaliation: true, retaliationChance: 1 } }, () => {}, player, { session });
      player.turnMeter = 0;
      attacker.turnMeter = 1000;

      processEnemyAI(session);

      expect(player.shield).toBe(20);
      expect(attacker.effects.some(effect => effect.id === 'freeze')).toBe(true);
      expect(attacker.effects.some(effect => effect.id === 'speed_penalty_minor')).toBe(false);
      expect(session.state.log.some(line => line.includes('Морозный щит замораживает Двурукий налётчик'))).toBe(true);
      expect(session.state.log.filter(line => line.includes('Двойной тестовый удар'))).toHaveLength(1);
    });
  });

  test('Frost Shield ability keeps retaliation metadata through plain Shield refreshes', () => {
    const session = initCombatSession(
      { name: 'Элементалист', hp: 100, maxHp: 100, magAtk: 12, attack: 5, abilities: [ABILITY_LIBRARY['Морозный щит']] },
      [{ name: 'Манекен', hp: 80, maxHp: 80, attack: 1, abilities: [] }]
    );
    const player = session.state.players[0];
    const logs = [];

    ABILITY_LIBRARY['Морозный щит'].apply({ attacker: player, session, log: line => logs.push(line) });
    const frostShield = player.effects.find(effect => effect.id === 'shield');
    expect(frostShield).toMatchObject({
      extra: {
        frostRetaliation: true,
        retaliationChance: 0.35,
      },
    });

    addEffect(player, { id: 'shield', duration: 1, value: 5 }, line => logs.push(line), player, { session });
    const refreshedByPlainShield = player.effects.find(effect => effect.id === 'shield');
    expect(refreshedByPlainShield).toMatchObject({
      extra: {
        frostRetaliation: true,
        retaliationChance: 0.35,
      },
    });

    addEffect(
      player,
      { id: 'shield', duration: 2, value: 5, extra: { frostRetaliation: true, retaliationChance: 1 } },
      line => logs.push(line),
      player,
      { session }
    );
    expect(player.effects.find(effect => effect.id === 'shield')).toMatchObject({
      extra: {
        frostRetaliation: true,
        retaliationChance: 1,
      },
    });
  });

  test('plain Shield refresh after Frost Shield still expires without stale barrier leftovers', () => {
    const unit = { name: 'Элементалист', hp: 100, maxHp: 100, effects: [], shield: 0 };
    addEffect(unit, { id: 'shield', duration: 1, value: 20, extra: { frostRetaliation: true, retaliationChance: 0.35 } }, () => {}, unit);
    addEffect(unit, { id: 'shield', duration: 1, value: 10 }, () => {}, unit);

    expect(unit.effects.find(effect => effect.id === 'shield')?.extra?.frostRetaliation).toBe(true);
    expect(unit.shield).toBe(30);

    processEffects(unit, () => {});
    expect(unit.effects.some(effect => effect.id === 'shield')).toBe(true);
    finishEffectTurn(unit, () => {});

    expect(unit.effects.some(effect => effect.id === 'shield')).toBe(false);
    expect(unit.shield).toBe(0);
  });

  test('Frost Shield slow fallback is logged and does not apply Freeze', () => {
    withMockedRandom(0.99, () => {
      const session = initCombatSession(
        { name: 'Маг', hp: 100, maxHp: 100, physDef: 0, magicDef: 0, attack: 5, abilities: [] },
        [{ name: 'Налётчик', hp: 80, maxHp: 80, attack: 10, physDef: 0, magicDef: 0, abilities: [{ name: 'Проверочный удар', damage: 10, cooldown: 0, type: 'physical', alwaysHits: true }] }]
      );
      const player = session.state.players[0];
      const attacker = session.state.enemies[0];
      addEffect(player, { id: 'shield', duration: 2, value: 30, extra: { frostRetaliation: true, retaliationChance: 0 } }, () => {}, player, { session });
      player.turnMeter = 0;
      attacker.turnMeter = 1000;

      processEnemyAI(session);

      expect(attacker.effects.some(effect => effect.id === 'freeze')).toBe(false);
      expect(attacker.effects.find(effect => effect.id === 'speed_penalty_minor')).toMatchObject({ remainingTurns: 2 });
      expect(session.state.log.some(line => line.includes('Морозный щит замедляет Налётчик'))).toBe(true);
    });
  });

  test('Frost Shield retaliation can trigger when the shield breaks on the direct hit', () => {
    withMockedRandom(0, () => {
      const session = initCombatSession(
        { name: 'Маг', hp: 100, maxHp: 100, physDef: 0, magicDef: 0, attack: 5, abilities: [] },
        [{ name: 'Сильный налётчик', hp: 80, maxHp: 80, attack: 30, physDef: 0, magicDef: 0, abilities: [{ name: 'Ломающий удар', damage: 30, cooldown: 0, type: 'physical', alwaysHits: true }] }]
      );
      const player = session.state.players[0];
      const attacker = session.state.enemies[0];
      addEffect(player, { id: 'shield', duration: 2, value: 5, extra: { frostRetaliation: true, retaliationChance: 1 } }, () => {}, player, { session });
      player.turnMeter = 0;
      attacker.turnMeter = 1000;

      processEnemyAI(session);

      expect(player.shield).toBe(0);
      expect(player.hp).toBeLessThan(100);
      expect(attacker.effects.some(effect => effect.id === 'freeze')).toBe(true);
      expect(session.state.log.some(line => line.includes('Морозный щит замораживает Сильный налётчик'))).toBe(true);
    });
  });

  test('Frost Shield works against Deserter-style direct physical attacks', () => {
    const deserterCases = [
      ['Громила', 'Размашистый удар'],
      ['Дуэлянт', 'Завершающий выпад'],
      ['Мастер алебарды', 'Подхват слабости'],
      ['Мастер клинков', 'Серия клинков'],
    ];

    withMockedRandom(0, () => {
      deserterCases.forEach(([enemyName, abilityName]) => {
        const session = initCombatSession(
          { name: 'Элементалист', hp: 120, maxHp: 120, physDef: 0, magicDef: 0, attack: 5, abilities: [] },
          [{
            name: enemyName,
            hp: 100,
            maxHp: 100,
            attack: 18,
            critChance: 0,
            physDef: 0,
            magicDef: 0,
            abilities: [{ ...ABILITY_LIBRARY[abilityName], cooldown: 0, alwaysHits: true }],
          }]
        );
        const player = session.state.players[0];
        const attacker = session.state.enemies[0];
        addEffect(player, { id: 'shield', duration: 2, value: 50, extra: { frostRetaliation: true, retaliationChance: 1 } }, () => {}, player, { session });
        player.turnMeter = 0;
        attacker.turnMeter = 1000;

        processEnemyAI(session);

        expect(session.state.log.some(line => line.includes(`Морозный щит замораживает ${enemyName}`))).toBe(true);
        expect(player.shield).toBeLessThan(50);
      });
    });
  });

  test('multi-hit actions stop if a counterattack kills the attacker after hit one', () => {
    const session = initCombatSession(
      {
        name: 'Уязвимый лучник',
        class: 'Archer',
        hp: 15,
        maxHp: 15,
        attack: 10,
        critChance: 0,
        abilities: [{ name: 'Двойной выпад', damage: 10, cooldown: 0, type: 'physical', alwaysHits: true, hitCount: 2 }],
      },
      [{ name: 'Сильный контрударник', hp: 50, maxHp: 50, attack: 30, physDef: 0, magicDef: 0, abilities: [] }]
    );
    addEffect(session.state.enemies[0], { id: 'iron_counter', duration: 1 }, () => {}, session.state.enemies[0], { session });
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Двойной выпад', 0);

    expect(session.state.players[0].hp).toBe(0);
    expect(session.state.enemies[0].hp).toBe(40);
    expect(session.state.log.filter(line => line.includes('Двойной выпад'))).toHaveLength(1);
  });

  test('Archer base feature does not mutate Bleed duration on surviving targets', () => {
    const session = initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 90,
        maxHp: 90,
        attack: 12,
        critChance: 0,
        abilityNames: ['Сквозные раны', 'Проверочный выстрел'],
        abilities: [{ name: 'Проверочный выстрел', damage: 5, cooldown: 0, type: 'physical', alwaysHits: true }],
      },
      [
        { name: 'Кровоточащая цель', hp: 50, maxHp: 50, physDef: 0, magicDef: 0, effects: [{ id: 'bleed', type: 'debuff', remainingTurns: 1, duration: 1 }] },
        { name: 'Чистая цель', hp: 50, maxHp: 50, physDef: 0, magicDef: 0, effects: [] },
      ]
    );
    addEffect(session.state.enemies[0], { id: 'bleed', duration: 1 }, () => {}, session.state.players[0], { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Проверочный выстрел', 0);

    expect(session.state.enemies[0].effects.find(effect => effect.id === 'bleed')).toMatchObject({ remainingTurns: 1 });

    session.state.initiative.playerReady = true;
    session.state.players[0].abilities[0].currentCooldown = 0;
    performPlayerAction(session, 'Проверочный выстрел', 1);

    expect(session.state.enemies[1].effects.some(effect => effect.id === 'bleed')).toBe(false);
  });

  test('Archer Сквозные раны spills over only raw overkill damage without repeating effects or chaining', () => {
    withMockedRandom(0, () => {
      const session = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 20,
          critChance: 0,
          abilityNames: ['Сквозные раны', 'Зазубренная проверка'],
          abilities: [{
            name: 'Зазубренная проверка',
            damage: 20,
            cooldown: 0,
            type: 'physical',
            alwaysHits: true,
            effect: { id: 'bleed', duration: 2 },
          }],
        },
        [
          { name: 'Первая цель', hp: 5, maxHp: 5, physDef: 0, magicDef: 0, effects: [] },
          { name: 'Вторая цель', hp: 12, maxHp: 12, physDef: 0, magicDef: 0, effects: [{ id: 'bleed', type: 'debuff', remainingTurns: 1, duration: 1 }] },
          { name: 'Третья цель', hp: 12, maxHp: 12, physDef: 0, magicDef: 0, effects: [] },
        ]
      );
      addEffect(session.state.enemies[1], { id: 'bleed', duration: 1 }, () => {}, session.state.players[0], { session });
      session.state.initiative.playerReady = true;

      performPlayerAction(session, 'Зазубренная проверка', 0);

      expect(session.state.enemies[0].hp).toBe(0);
      expect(session.state.enemies[1].hp).toBe(0);
      expect(session.state.enemies[1].effects.find(effect => effect.id === 'bleed')).toMatchObject({ remainingTurns: 1 });
      expect(session.state.enemies[2].hp).toBe(12);
      expect(session.state.log.filter(line => line.includes('Сквозные раны переносят'))).toHaveLength(1);
    });
  });

  test('Archer Сквозные раны can select the second spillover candidate without touching the first', () => {
    withMockedRandom(0.99, () => {
      const session = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 20,
          critChance: 0,
          abilityNames: ['Сквозные раны', 'Зазубренная проверка'],
          abilities: [{
            name: 'Зазубренная проверка',
            damage: 20,
            cooldown: 0,
            type: 'physical',
            alwaysHits: true,
            effect: { id: 'bleed', duration: 2 },
          }],
        },
        [
          { name: 'Первая цель', hp: 5, maxHp: 5, physDef: 0, magicDef: 0, effects: [] },
          { name: 'Вторая цель', hp: 12, maxHp: 12, physDef: 0, magicDef: 0, effects: [] },
          { name: 'Третья цель', hp: 12, maxHp: 12, physDef: 0, magicDef: 0, effects: [] },
        ]
      );
      session.state.initiative.playerReady = true;

      performPlayerAction(session, 'Зазубренная проверка', 0);

      expect(session.state.enemies[0].hp).toBe(0);
      expect(session.state.enemies[1].hp).toBe(12);
      expect(session.state.enemies[2].hp).toBe(0);
      expect(session.state.enemies[2].effects.some(effect => effect.id === 'bleed')).toBe(false);
      expect(session.state.log.filter(line => line.includes('Сквозные раны переносят'))).toHaveLength(1);
      expect(session.state.log.some(line => line.includes('на Третья цель'))).toBe(true);
    });
  });

  test('Archer Сквозные раны hits the only other enemy once in a two-enemy fight', () => {
    withMockedRandom(0.5, () => {
      const session = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 20,
          critChance: 0,
          abilityNames: ['Сквозные раны', 'Проверочный выстрел'],
          abilities: [{ name: 'Проверочный выстрел', damage: 20, cooldown: 0, type: 'physical', alwaysHits: true }],
        },
        [
          { name: 'Первая цель', hp: 5, maxHp: 5, physDef: 0, magicDef: 0, effects: [] },
          { name: 'Вторая цель', hp: 30, maxHp: 30, physDef: 0, magicDef: 0, effects: [] },
        ]
      );
      session.state.initiative.playerReady = true;

      performPlayerAction(session, 'Проверочный выстрел', 0);

      expect(session.state.enemies[0].hp).toBe(0);
      expect(session.state.enemies[1].hp).toBe(15);
      expect(session.state.log.filter(line => line.includes('Сквозные раны переносят'))).toHaveLength(1);
    });
  });

  test('Archer Сквозные раны distinguishes duplicate-name Mushroom spillover candidates by object', () => {
    const buildDuplicateMushroomSession = () => initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 90,
        maxHp: 90,
        attack: 20,
        critChance: 0,
        abilityNames: ['Сквозные раны', 'Проверочный выстрел'],
        abilities: [{ name: 'Проверочный выстрел', damage: 20, cooldown: 0, type: 'physical', alwaysHits: true }],
      },
      [
        { name: 'Троглодит-жукопас', hp: 5, maxHp: 40, physDef: 0, magicDef: 0, effects: [] },
        { name: 'Мясистый жук', hp: 30, maxHp: 30, physDef: 0, magicDef: 0, effects: [] },
        { name: 'Мясистый жук', hp: 30, maxHp: 30, physDef: 0, magicDef: 0, effects: [] },
      ]
    );

    withMockedRandom(0, () => {
      const session = buildDuplicateMushroomSession();
      session.state.initiative.playerReady = true;

      performPlayerAction(session, 'Проверочный выстрел', 0);

      expect(session.state.enemies[0].hp).toBe(0);
      expect(session.state.enemies[1].hp).toBe(15);
      expect(session.state.enemies[2].hp).toBe(30);
      expect(session.state.log.filter(line => line.includes('Сквозные раны переносят'))).toHaveLength(1);
      expect(session.state.log.some(line => line.includes('на Мясистый жук #1'))).toBe(true);
    });

    withMockedRandom(0.99, () => {
      const session = buildDuplicateMushroomSession();
      session.state.initiative.playerReady = true;

      performPlayerAction(session, 'Проверочный выстрел', 0);

      expect(session.state.enemies[0].hp).toBe(0);
      expect(session.state.enemies[1].hp).toBe(30);
      expect(session.state.enemies[2].hp).toBe(15);
      expect(session.state.log.filter(line => line.includes('Сквозные раны переносят'))).toHaveLength(1);
      expect(session.state.log.some(line => line.includes('на Мясистый жук #2'))).toBe(true);
    });
  });

  test('Archer Сквозные раны does not select a dead duplicate-name original target again', () => {
    withMockedRandom(0.99, () => {
      const session = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 20,
          critChance: 0,
          abilityNames: ['Сквозные раны', 'Проверочный выстрел'],
          abilities: [{ name: 'Проверочный выстрел', damage: 20, cooldown: 0, type: 'physical', alwaysHits: true }],
        },
        [
          { name: 'Троглодит-жукопас', hp: 40, maxHp: 40, physDef: 0, magicDef: 0, effects: [] },
          { name: 'Мясистый жук', hp: 5, maxHp: 30, physDef: 0, magicDef: 0, effects: [] },
          { name: 'Мясистый жук', hp: 30, maxHp: 30, physDef: 0, magicDef: 0, effects: [] },
        ]
      );
      session.state.initiative.playerReady = true;

      performPlayerAction(session, 'Проверочный выстрел', 1);

      expect(session.state.enemies[0].hp).toBe(40);
      expect(session.state.enemies[1].hp).toBe(0);
      expect(session.state.enemies[2].hp).toBe(15);
      expect(session.state.log.filter(line => line.includes('Сквозные раны переносят'))).toHaveLength(1);
      expect(session.state.log.some(line => line.includes('на Мясистый жук #2'))).toBe(true);
    });
  });

  test('Сквозные раны does not trigger from AoE, DoT, counter, or non-Archer attacks', () => {
    const aoeSession = initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 90,
        maxHp: 90,
        attack: 20,
        critChance: 0,
        abilityNames: ['Сквозные раны', 'Широкий залп'],
        abilities: [{ name: 'Широкий залп', damage: 20, cooldown: 0, type: 'physical', targeting: 'allEnemies', alwaysHits: true }],
      },
      [
        { name: 'Слабая цель', hp: 5, maxHp: 5, physDef: 0, magicDef: 0, effects: [] },
        { name: 'Соседняя цель', hp: 20, maxHp: 20, physDef: 0, magicDef: 0, effects: [] },
      ]
    );
    aoeSession.state.initiative.playerReady = true;
    performPlayerAction(aoeSession, 'Широкий залп', 0);
    expect(aoeSession.state.log.some(line => line.includes('Сквозные раны переносят'))).toBe(false);
    expect(aoeSession.state.enemies[1].hp).toBe(0);

    const nonArcherSession = initCombatSession(
      {
        name: 'Защитник',
        class: 'Defender',
        hp: 100,
        maxHp: 100,
        attack: 20,
        critChance: 0,
        abilityNames: ['Сквозные раны', 'Обычный удар'],
        abilities: [{ name: 'Обычный удар', damage: 20, cooldown: 0, type: 'physical', alwaysHits: true }],
      },
      [
        { name: 'Слабая цель', hp: 5, maxHp: 5, physDef: 0, magicDef: 0, effects: [] },
        { name: 'Соседняя цель', hp: 20, maxHp: 20, physDef: 0, magicDef: 0, effects: [] },
      ]
    );
    nonArcherSession.state.initiative.playerReady = true;
    performPlayerAction(nonArcherSession, 'Обычный удар', 0);
    expect(nonArcherSession.state.log.some(line => line.includes('Сквозные раны переносят'))).toBe(false);
    expect(nonArcherSession.state.enemies[1].hp).toBe(20);

    const dotSession = initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 90,
        maxHp: 90,
        attack: 30,
        critChance: 0,
        abilityNames: ['Сквозные раны'],
      },
      [
        { name: 'Отравленная цель', hp: 5, maxHp: 5, physDef: 0, magicDef: 0, effects: [] },
        { name: 'Соседняя цель', hp: 20, maxHp: 20, physDef: 0, magicDef: 0, effects: [] },
      ]
    );
    addEffect(dotSession.state.enemies[0], { id: 'poison', duration: 1, sourceAttack: 40 }, () => {}, dotSession.state.players[0], { session: dotSession });
    dotSession.state.players[0].turnMeter = 0;
    dotSession.state.enemies[0].turnMeter = 1000;
    processEnemyAI(dotSession);
    expect(dotSession.state.log.some(line => line.includes('Сквозные раны переносят'))).toBe(false);
    expect(dotSession.state.enemies[1].hp).toBe(20);

    const counterSession = initCombatSession(
      {
        name: 'Лучник',
        class: 'Archer',
        hp: 90,
        maxHp: 90,
        attack: 50,
        critChance: 0,
        abilityNames: ['Сквозные раны'],
      },
      [
        { name: 'Атакующий враг', hp: 5, maxHp: 5, attack: 10, physDef: 0, magicDef: 0, abilities: [{ name: 'Укол', damage: 1, cooldown: 0, type: 'physical', alwaysHits: true }] },
        { name: 'Соседняя цель', hp: 20, maxHp: 20, physDef: 0, magicDef: 0, effects: [] },
      ]
    );
    addEffect(counterSession.state.players[0], { id: 'iron_counter', duration: 1 }, () => {}, counterSession.state.players[0], { session: counterSession });
    counterSession.state.players[0].turnMeter = 0;
    counterSession.state.enemies[0].turnMeter = 1000;
    processEnemyAI(counterSession);
    expect(counterSession.state.log.some(line => line.includes('Сквозные раны переносят'))).toBe(false);
    expect(counterSession.state.enemies[1].hp).toBe(20);

    expect(ABILITY_LIBRARY['Охотничий инстинкт']).toBeUndefined();
    expect(ABILITY_LIBRARY['Сквозные раны']?.passive).toBe(true);
  });

  test('Master Blades keeps active threat while reducing evasion and counter frustration', () => {
    const boss = allEnemies.find(entry => entry.name === 'Мастер клинков');
    expect(boss.abilityNames).toEqual(expect.arrayContaining(['Точный выпад', 'Серия клинков', 'Школа клинка', 'Нарушенная клятва']));
    expect(boss.controlImmune).toBe(true);
    expect(ABILITY_LIBRARY['Точный выпад'].damage({ attacker: { attack: 100 } })).toBe(145);
    expect(ABILITY_LIBRARY['Серия клинков']).toMatchObject({ hits: 3, cooldown: 3 });
  });

  test('Master Blades defense-piercing tool and second phase are present and one-shot', () => {
    const session = initCombatSession({ name: 'Герой', hp: 100, maxHp: 100, attack: 10 }, [allEnemies.find(entry => entry.name === 'Мастер клинков')]);
    const boss = session.state.enemies[0]; const log = jest.fn();
    applyDamage(boss, boss.maxHp * 0.6, 'pure', { source: session.state.players[0], session, logFn: log });
    const preparation = boss._preparation;
    applyDamage(boss, 1, 'pure', { source: session.state.players[0], session, logFn: log });
    expect(boss._brokenOathTriggered).toBe(true);
    expect(preparation).toMatchObject({ kind: 'blade_dance' });
    expect(boss._preparation).toBe(preparation);
  });

  test('Deserter boss catalyst exists and Master Blades guarantees it', () => {
    expect(findItemData('Сломанная клятва')).toMatchObject({
      type: 'material',
      rarity: 'Редкая',
      sourceTier: 'rareCatalyst',
      sourceTags: expect.arrayContaining(['deserter', 'boss', 'guild', 'oath', 'blade']),
      intendedUse: 'bossCrafting',
      chestChance: 0,
      enemyChance: 0,
    });
    const boss = allEnemies.find(enemyEntry => enemyEntry.name === 'Мастер клинков');
    expect(boss?.guaranteedLoot).toContain('Сломанная клятва');
    expect(boss?.guaranteedLoot).not.toContain('Алебарда Пограничного Дозора');
  });

  test('Deserter boss catalyst stays out of Resource and generic Treasure rolls', () => {
    const resourceLocations = ['Гоблинские Норы', 'Грибные Пещеры', DESERTER_LOCATION, 'unknown'];
    resourceLocations.forEach(locationName => {
      expect(getResourceRoomTable(locationName).map(entry => entry.name)).not.toContain('Сломанная клятва');
    });

    const originalRandom = Math.random;
    Math.random = lcg(202607);
    try {
      for (let i = 0; i < 500; i += 1) {
        expect(rollTreasureLoot().map(entry => entry.name)).not.toContain('Сломанная клятва');
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test('Deserter cursed rewards guarantee corruption essence', () => {
    ['Осквернённый рубака', 'Искажённый страж'].forEach(enemyName => {
      const enemyEntry = allEnemies.find(entry => entry.name === enemyName);
      expect(enemyEntry?.guaranteedLoot).toContain('Эссенция Проклятий');
      expect(enemyEntry?.lootRolls).toBeGreaterThanOrEqual(2);
    });
  });

  test('Deserter/Guild gear no longer leaks through Goblin or Mushroom cursed/boss loot', () => {
    const deserterGear = [
      'Алебарда Пограничного Дозора',
      'Пепельная Маска Отступника',
      'Куртка Мародёра',
      'Щит Дозорного Гильдии',
    ];
    const goblinEnemies = allEnemies.filter(enemyEntry => enemyEntry.location === 'Гоблинские Норы');
    goblinEnemies.forEach(enemyEntry => {
      deserterGear.forEach(itemName => {
        expect(enemyEntry.lootTable || []).not.toContain(itemName);
      });
    });

    const mushroomBossOrCursed = allEnemies.filter(enemyEntry => (
      enemyEntry.location === 'Грибные Пещеры' && (enemyEntry.boss || enemyEntry.roomRole === 'cursedEnemy')
    ));
    mushroomBossOrCursed.forEach(enemyEntry => {
      deserterGear.forEach(itemName => {
        expect(enemyEntry.lootTable || []).not.toContain(itemName);
        expect(enemyEntry.guaranteedLoot || []).not.toContain(itemName);
      });
    });
  });

  test('Goblin rewards do not leak obvious Mushroom-native loot while Mushroom loot keeps it', () => {
    const mushroomNativeLoot = [
      'Мицелий',
      'Споры',
      'Слизь мохоспора',
      'Спора светокапа',
      'Пыльца серого спорника',
      'Пыль костяной корки',
      'Хитиновый Панцирь Мясного Жука',
      'Грибная Маска Споровика',
      'Кольцо Туманного Мха',
      'Фокус Ледяного Спора',
    ];
    const goblinEnemies = allEnemies.filter(enemyEntry => enemyEntry.location === 'Гоблинские Норы');
    goblinEnemies.forEach(enemyEntry => {
      mushroomNativeLoot.forEach(itemName => {
        expect(enemyEntry.lootTable || []).not.toContain(itemName);
        expect(enemyEntry.guaranteedLoot || []).not.toContain(itemName);
      });
    });

    const goblinResourceItems = getResourceRoomTable('Гоблинские Норы').map(entry => entry.name);
    mushroomNativeLoot.forEach(itemName => expect(goblinResourceItems).not.toContain(itemName));

    const originalRandom = Math.random;
    Math.random = lcg(202608);
    try {
      for (let i = 0; i < 500; i += 1) {
        rollTreasureLoot('Гоблинские Норы').forEach(entry => {
          expect(mushroomNativeLoot).not.toContain(entry.name);
        });
      }
    } finally {
      Math.random = originalRandom;
    }

    const mushroomEnemies = allEnemies.filter(enemyEntry => enemyEntry.location === 'Грибные Пещеры');
    expect(mushroomEnemies.some(enemyEntry => (
      (enemyEntry.lootTable || []).some(itemName => mushroomNativeLoot.includes(itemName))
      || (enemyEntry.guaranteedLoot || []).some(itemName => mushroomNativeLoot.includes(itemName))
    ))).toBe(true);
  });

  test('Withering Forest resource table uses only its authored Level 2 materials', () => {
    const forest = LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST;
    const names = getResourceRoomTable(forest).map(entry => entry.name);

    expect(names).toEqual([
      'Чёрная сердцевина',
      'Горькая живица',
      'Цветок последней весны',
      'Глубинное полотно',
      'Кровяной мох',
      'Выделанная кожа Бездны',
      'Сумрачный сплав',
    ]);

    names.forEach(name => expect(findItemData(name)?.type).toBe('material'));
    expect(names).not.toContain('Простая ткань');
    expect(names).not.toContain('Обрывки кожи');
    expect(names).not.toContain('Металлические обломки');
    expect(names).not.toContain('Ветвь Архонта');
  });

  test('unfinished Ruins and Mines resource rooms use only the shared Level 2 material pool', () => {
    for (const location of [
      LEVEL_TWO_LOOT_LOCATIONS.RESTLESS_RUINS,
      LEVEL_TWO_LOOT_LOCATIONS.MINES_OF_DECAY,
    ]) {
      expect(LOCATION_LEVEL_TWO_MATERIALS[location]).toEqual([]);
      expect(getResourceRoomTable(location).map(entry => entry.name))
        .toEqual(COMMON_LEVEL_TWO_MATERIALS);
    }
  });

  test('Level 2 resource rolls allow only intentional basic field supply carryover', () => {
    const forest = LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST;
    const allowed = new Set([
      ...COMMON_LEVEL_TWO_MATERIALS,
      ...LOCATION_LEVEL_TWO_MATERIALS[forest],
      'Простая склянка', 'Простая ткань',
    ]);
    const rng = lcg(20260924);

    for (let i = 0; i < 1000; i += 1) {
      const loot = rollResourceRoomLoot(forest, rng);
      expect(loot.length).toBeGreaterThanOrEqual(2);
      loot.forEach(entry => expect(allowed.has(entry.name)).toBe(true));
    }
  });

  test('Mushroom Caves resource table uses active fungal items and universal Blood Moss', () => {
    const table = getResourceRoomTable('Грибные Пещеры');
    expect(table.map(entry => entry.name)).toEqual([
      'Лазурный мицелий',
      'Блуждающие споры',
      'Простая ткань',
      'Обрывки кожи',
      'Металлические обломки',
      'Кровяной мох',
      'Простая склянка',
      'Спора светокапа',
    ]);
    table.forEach(entry => expect(findItemData(entry.name)).toBeTruthy());
  });

  test('Mushroom Caves resource loot can roll universal Blood Moss', () => {
    const rng = lcg(67890);
    let found = false;
    for (let i = 0; i < 1000; i += 1) {
      const loot = rollResourceRoomLoot('Грибные Пещеры', rng);
      expect(loot.length).toBeGreaterThanOrEqual(2);
      if (loot.some(entry => entry.name === 'Кровяной мох')) found = true;
    }
    expect(found).toBe(true);
  });

  test('Mushroom Resource payload is pre-resolved with stable loot', () => {
    const payload = buildResourceRoomPayload({ locationName: 'Грибные Пещеры', rng: lcg(24680) });
    const savedPayload = JSON.parse(JSON.stringify(payload));
    expect(payload.roomName).toBeTruthy();
    expect(payload.loot.length).toBeGreaterThanOrEqual(2);
    expect(payload).toEqual(savedPayload);
  });

  test('Mushroom Resource room keeps glowcap spores less common than core fungal resources', () => {
    const rng = lcg(13579);
    const counts = { 'Лазурный мицелий': 0, 'Блуждающие споры': 0, 'Спора светокапа': 0 };
    const runs = 5000;
    for (let i = 0; i < runs; i += 1) {
      rollResourceRoomLoot('Грибные Пещеры', rng).forEach(entry => {
        if (counts[entry.name] !== undefined) counts[entry.name] += 1;
      });
    }
    expect(counts['Спора светокапа']).toBeLessThan(counts['Лазурный мицелий']);
    expect(counts['Спора светокапа']).toBeLessThan(counts['Блуждающие споры']);
  });

  test('Goblin Nests resource table only uses existing active non-future items', () => {
    const table = getResourceRoomTable('Гоблинские Норы');
    expect(table).toHaveLength(7);
    table.forEach(entry => {
      const item = findItemData(entry.name);
      expect(item).toBeTruthy();
      expect(item.intendedUse).not.toBe('future');
    });
    expect(table.map(entry => entry.name)).not.toContain('Крысиная желчь');
    expect(table.map(entry => entry.name)).not.toContain('Крысиная кость');
  });

  test('rat bile and rat bone remain defined as future faction resources', () => {
    expect(findItemData('Крысиная желчь')).toMatchObject({
      sourceTier: 'faction',
      sourceTags: expect.arrayContaining(['goblin', 'rat', 'alchemy']),
      intendedUse: 'future',
    });
    expect(findItemData('Крысиная кость')).toMatchObject({
      sourceTier: 'faction',
      sourceTags: expect.arrayContaining(['goblin', 'rat', 'bone']),
      intendedUse: 'future',
    });
  });

  test('Goblin Nests resource loot keeps Blood Moss common without forcing oversupply', () => {
    const rng = lcg(12345);
    let bloodMossRooms = 0;
    let bloodMossQuantity = 0;
    const runs = 10000;
    for (let i = 0; i < runs; i += 1) {
      const loot = rollResourceRoomLoot('Гоблинские Норы', rng);
      expect(loot.map(entry => entry.name)).not.toContain('Крысиная желчь');
      expect(loot.map(entry => entry.name)).not.toContain('Крысиная кость');
      const mossQuantity = loot
        .filter(entry => entry.name === 'Кровяной мох')
        .reduce((sum, entry) => sum + entry.quantity, 0);
      if (mossQuantity > 0) bloodMossRooms += 1;
      bloodMossQuantity += mossQuantity;
    }
    expect(bloodMossRooms / runs).toBe(1);
    expect(bloodMossQuantity / runs).toBeGreaterThanOrEqual(3.5);
    expect(bloodMossQuantity / runs).toBeLessThanOrEqual(4.2);
  });

  test('Resource rooms stay material-focused and do not use treasure equipment rewards', () => {
    const table = getResourceRoomTable('Грибные Пещеры');
    table.forEach(entry => {
      expect(findItemData(entry.name)?.type).toBe('material');
    });

    const loot = rollResourceRoomLoot('Грибные Пещеры', lcg(202406));
    loot.forEach(entry => {
      expect(findItemData(entry.name)?.type).toBe('material');
    });
  });

  test('Treasure loot avoids common Resource-room materials', () => {
    const originalRandom = Math.random;
    Math.random = lcg(98765);
    try {
      for (let i = 0; i < 200; i += 1) {
        rollTreasureLoot().forEach(entry => {
          const item = findItemData(entry.name);
          expect(item).toBeTruthy();
          expect(item?.sourceTier).not.toBe('common');
          expect(['bait', 'fish']).not.toContain(item?.type);
        });
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test('location-aware Treasure pools prevent faction gear leakage while keeping generic early rewards', () => {
    const goblinSignature = [
      'Красный Колпак Старшего Крысолова',
      'Тесак Гоблинского Мясника',
      'Посох Украденной Искры',
      'Жезл Закопчённого Стекла',
      'Мантия Погасшего Костра',
      'Амулет Крысиной Жилы',
    ];
    const mushroomNative = [
      'Грибная Маска Споровика',
      'Хитиновый Панцирь Мясного Жука',
      'Кольцо Туманного Мха',
      'Фокус Ледяного Спора',
      'Лазурный мицелий',
      'Блуждающие споры',
      'Спора светокапа',
      'Пыльца серого спорника',
      'Пыль костяной корки',
    ];
    const deserterGuild = [
      'Пепельная Маска Отступника',
      'Куртка Мародёра',
      'Щит Дозорного Гильдии',
      'Алебарда Пограничного Дозора',
      'Капюшон Следопыта',
      'Кольцо Меткой Тетивы',
      'Булава Старого Сотника',
      'Плащ разведчика',
      'Полевой гримуар Отступника',
    ];
    const genericClassEarly = [
      'Серебро',
      'Малое зелье здоровья',
      'Свиток Лечения',
      'Капюшон Искателя Знаков',
      'Плащ Тусклого Оберега',
    ];

    const goblinPool = getTreasurePoolNamesForLocation(GOBLIN_LOCATION);
    const mushroomPool = getTreasurePoolNamesForLocation(FUNGAL_LOCATION);
    const deserterPool = getTreasurePoolNamesForLocation(DESERTER_LOCATION);
    const unknownPool = getTreasurePoolNamesForLocation('Будущая локация');

    expect(goblinPool).toEqual(expect.arrayContaining([...genericClassEarly, ...goblinSignature]));
    deserterGuild.forEach(itemName => expect(goblinPool).not.toContain(itemName));
    mushroomNative.forEach(itemName => expect(goblinPool).not.toContain(itemName));

    expect(mushroomPool).toEqual(expect.arrayContaining([
      ...genericClassEarly,
      'Грибная Маска Споровика',
      'Хитиновый Панцирь Мясного Жука',
      'Кольцо Туманного Мха',
      'Фокус Ледяного Спора',
    ]));
    goblinSignature.forEach(itemName => expect(mushroomPool).not.toContain(itemName));
    deserterGuild.forEach(itemName => expect(mushroomPool).not.toContain(itemName));

    expect(deserterPool).toEqual(expect.arrayContaining([...genericClassEarly, ...deserterGuild]));
    goblinSignature.forEach(itemName => expect(deserterPool).not.toContain(itemName));
    mushroomNative.forEach(itemName => expect(deserterPool).not.toContain(itemName));

    expect(unknownPool).toEqual(expect.arrayContaining(genericClassEarly));
    [...goblinSignature, ...mushroomNative, ...deserterGuild].forEach(itemName => {
      expect(unknownPool).not.toContain(itemName);
    });
  });

  test('location-aware Treasure rolls never return wrong-faction gear, resource materials, or catalysts', () => {
    const forbiddenByLocation = {
      [GOBLIN_LOCATION]: [
        'Пепельная Маска Отступника',
        'Куртка Мародёра',
        'Щит Дозорного Гильдии',
        'Алебарда Пограничного Дозора',
        'Капюшон Следопыта',
        'Кольцо Меткой Тетивы',
        'Грибная Маска Споровика',
        'Хитиновый Панцирь Мясного Жука',
        'Кольцо Туманного Мха',
        'Фокус Ледяного Спора',
        'Мицелий',
        'Споры',
        'Слизь мохоспора',
        'Спора светокапа',
        'Пыльца серого спорника',
        'Пыль костяной корки',
      ],
      [FUNGAL_LOCATION]: [
        'Красный Колпак Старшего Крысолова',
        'Тесак Гоблинского Мясника',
        'Булава Старого Сотника',
        'Шипастый Щит Нор',
        'Пепельная Маска Отступника',
        'Куртка Мародёра',
        'Щит Дозорного Гильдии',
        'Алебарда Пограничного Дозора',
        'Капюшон Следопыта',
        'Кольцо Меткой Тетивы',
      ],
      [DESERTER_LOCATION]: [
        'Красный Колпак Старшего Крысолова',
        'Тесак Гоблинского Мясника',
        'Шипастый Щит Нор',
        'Грибная Маска Споровика',
        'Хитиновый Панцирь Мясного Жука',
        'Кольцо Туманного Мха',
        'Фокус Ледяного Спора',
        'Мицелий',
        'Споры',
        'Слизь мохоспора',
        'Спора светокапа',
        'Пыльца серого спорника',
        'Пыль костяной корки',
      ],
    };
    const catalysts = ['Астральный разлом', 'Сломанная клятва', 'Эссенция Проклятий'];
    const originalRandom = Math.random;
    Math.random = lcg(424200);
    try {
      Object.entries(forbiddenByLocation).forEach(([locationName, forbiddenNames]) => {
        let sawLocationGear = false;
        for (let i = 0; i < 500; i += 1) {
          const loot = rollTreasureLoot(locationName);
          loot.forEach(entry => {
            const item = findItemData(entry.name);
            expect(item).toBeTruthy();
            expect(forbiddenNames).not.toContain(entry.name);
            expect(catalysts).not.toContain(entry.name);
            expect(item?.sourceTier).not.toBe('rareCatalyst');
            expect(item?.type).not.toBe('material');
            expect(['bait', 'fish']).not.toContain(item?.type);
            sawLocationGear = sawLocationGear || (
              locationName === GOBLIN_LOCATION
                ? ['Красный Колпак Старшего Крысолова', 'Тесак Гоблинского Мясника', 'Булава Старого Сотника', 'Шипастый Щит Нор'].includes(entry.name)
                : locationName === FUNGAL_LOCATION
                  ? ['Грибная Маска Споровика', 'Хитиновый Панцирь Мясного Жука', 'Кольцо Туманного Мха', 'Фокус Ледяного Спора'].includes(entry.name)
                  : ['Пепельная Маска Отступника', 'Куртка Мародёра', 'Щит Дозорного Гильдии', 'Алебарда Пограничного Дозора', 'Капюшон Следопыта', 'Кольцо Меткой Тетивы'].includes(entry.name)
            );
          });
        }
        expect(sawLocationGear).toBe(true);
      });

      for (let i = 0; i < 300; i += 1) {
        rollTreasureLoot('Будущая локация').forEach(entry => {
          expect([
            ...forbiddenByLocation[GOBLIN_LOCATION],
            ...forbiddenByLocation[FUNGAL_LOCATION],
            ...forbiddenByLocation[DESERTER_LOCATION],
            ...catalysts,
          ]).not.toContain(entry.name);
        });
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test('Secret Treasure and Tarot extra rolls use the location-aware Treasure path instead of global chest loot', () => {
    const dungeonSource = fs.readFileSync('src/components/DungeonScreen.js', 'utf8');
    expect(dungeonSource).toContain('rollChestLoot: primordialSource => rollTreasureLoot(selectedLocation, 2, 3, { primordialSource })');
    expect(dungeonSource).toContain('rollTreasureLoot(selectedLocation, 1, 1)');
    expect(dungeonSource).not.toContain('loot = loot.concat(rollChestLoot(1, 1))');
  });

  test('Shimmering Node replaces Astral Rift and the Mushroom boss guarantees it', () => {
    expect(findItemData('Астральный разлом')).toMatchObject({
      sourceTier: 'rareCatalyst',
      sourceTags: expect.arrayContaining(['fungal', 'boss', 'astral', 'cave']),
      intendedUse: 'bossCrafting',
    });

    const boss = allEnemies.find(enemyEntry => enemyEntry.name === 'Троглодит-мицелий (босс)');
    expect(boss?.guaranteedLoot).toContain('Мерцающий узел');
    const loot = rollLootForEnemies([boss]);
    expect(loot.items.map(item => item.name)).toContain('Мерцающий узел');
  });

  test('Mushroom cursed enemies guarantee curse essence and avoid Goblin-only gear', () => {
    const cursedNames = ['Осквернённый троглодит-змееголов', 'Искажённый троглодит-тотемщик'];
    const goblinOnlyGear = ['Красный Колпак Старшего Крысолова', 'Тесак Гоблинского Мясника', 'Булава Старого Сотника'];

    cursedNames.forEach(name => {
      const enemyEntry = allEnemies.find(enemy => enemy.name === name);
      expect(enemyEntry?.guaranteedLoot).toContain('Эссенция Проклятий');
      goblinOnlyGear.forEach(itemName => {
        expect(enemyEntry?.lootTable || []).not.toContain(itemName);
      });
    });
  });

  test('Blood Poultice recipe stays simple and does not require rat resources', () => {
    const poultice = FIELD_CRAFTING_RECIPES.find(recipe => recipe.id === 'blood_moss_poultice');
    expect(poultice.ingredients).toEqual([
      { name: 'Кровяной мох', quantity: 1 },
      { name: 'Простая ткань', quantity: 1 },
    ]);
    expect(poultice.ingredients.map(ingredient => ingredient.name)).not.toContain('Крысиная желчь');
    expect(poultice.ingredients.map(ingredient => ingredient.name)).not.toContain('Крысиная кость');
  });

  test('Mushroom abilities do not add flavor-only statuses to EFFECT_LIBRARY', () => {
    expect(EFFECT_LIBRARY.poison_shield).toBeUndefined();
    expect(EFFECT_LIBRARY.spore_poison).toBeUndefined();
    expect(EFFECT_LIBRARY.spore_paralysis).toBeUndefined();
    expect(EFFECT_LIBRARY.shard_shield).toBeUndefined();
    expect(EFFECT_LIBRARY.bug_command_aura).toBeUndefined();
  });

  test('Mushroom early ability effects use existing EFFECT_LIBRARY ids', () => {
    const earlyNames = [
      'Пронзающая шеренга',
      'Стойка копья',
      'Змеиный зов',
      'Хоровод ядовитых змей',
      'Шиповидная чешуя',
      'Споровой щит',
      'Споровой шторм',
      'Грибной симбиоз',
      'Кровавый обряд',
      'Ритуальная защита',
      'Посмертный выброс спор',
    ];
    const collectEffectIds = value => {
      if (!value) return [];
      if (Array.isArray(value)) return value.flatMap(collectEffectIds);
      if (typeof value === 'object') return value.id ? [value.id] : [];
      return [];
    };
    earlyNames.forEach(name => {
      const ability = ABILITY_LIBRARY[name];
      expect(ability).toBeTruthy();
      [...collectEffectIds(ability.effect), ...collectEffectIds(ability.selfEffects)].forEach(id => {
        expect(EFFECT_LIBRARY[id]).toBeTruthy();
      });
    });
  });

  test('temporary Shield removes remaining barrier when the effect expires', () => {
    const unit = { name: 'Защитник', hp: 100, maxHp: 100, effects: [], shield: 0 };
    addEffect(unit, { id: 'shield', duration: 1, value: 24 }, () => {}, unit);
    expect(unit.shield).toBe(24);

    processEffects(unit, () => {});
    expect(unit.effects.some(effect => effect.id === 'shield')).toBe(true);
    finishEffectTurn(unit, () => {});

    expect(unit.effects.some(effect => effect.id === 'shield')).toBe(false);
    expect(unit.shield).toBe(0);
  });

  test('Shield damage bookkeeping prevents stale barriers after consumption and refresh', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 20, critChance: 0, abilities: [{ name: 'Тестовый удар', damage: 12, cooldown: 0, type: 'physical', alwaysHits: true }] },
      [{ name: 'Щитоносец', hp: 80, maxHp: 80, physDef: 0, magicDef: 0, shield: 0, effects: [] }]
    );
    const defender = session.state.enemies[0];
    addEffect(defender, { id: 'shield', duration: 2, value: 20 }, () => {}, defender, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Тестовый удар', 0);
    expect(defender.hp).toBe(80);
    expect(defender.shield).toBe(8);

    processEffects(defender, () => {});
    finishEffectTurn(defender, () => {});
    addEffect(defender, { id: 'shield', duration: 1, value: 10 }, () => {}, defender, { session });
    expect(defender.shield).toBe(18);
    processEffects(defender, () => {});
    finishEffectTurn(defender, () => {});

    expect(defender.effects.some(effect => effect.id === 'shield')).toBe(false);
    expect(defender.shield).toBe(0);
  });

  test('fully consumed Shield expires safely without negative shield leftovers', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 40, critChance: 0, abilities: [{ name: 'Сильный удар', damage: 30, cooldown: 0, type: 'physical', alwaysHits: true }] },
      [{ name: 'Защитник', hp: 80, maxHp: 80, physDef: 0, magicDef: 0, shield: 0, effects: [] }]
    );
    const defender = session.state.enemies[0];
    addEffect(defender, { id: 'shield', duration: 1, value: 10 }, () => {}, defender, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Сильный удар', 0);
    expect(defender.shield).toBe(0);
    expect(defender.hp).toBeLessThan(80);

    processEffects(defender, () => {});

    expect(defender.shield).toBe(0);
  });

  test('triggerOnDeath fires a Mushroom spore burst exactly once', () => {
    const sporeling = {
      name: 'Троглодит-споровик',
      hp: 0,
      attack: 12,
      abilities: [ABILITY_LIBRARY['Посмертный выброс спор']],
      effects: [],
    };
    const player = { name: 'Герой', hp: 100, maxHp: 100, physDef: 0, magicDef: 0, effects: [], shield: 0 };
    const session = { state: { enemies: [sporeling], players: [player] } };
    const logs = [];

    expect(triggerOnDeath(sporeling, player, session, text => logs.push(text))).toBe(true);
    expect(player.effects.filter(effect => effect.id === 'poison')).toHaveLength(1);
    expect(player.effects.find(effect => effect.id === 'poison')?.sourceSnapshot?.attack).toBe(12);
    expect(triggerOnDeath(sporeling, player, session, text => logs.push(text))).toBe(false);
    expect(player.effects.filter(effect => effect.id === 'poison')).toHaveLength(1);
    expect(logs.some(line => line.includes('при смерти') && line.includes('отравляет'))).toBe(true);
  });

  test('onDeath does not fire if rebirth prevents actual death', () => {
    const session = initCombatSession(
      {
        name: 'Герой',
        hp: 120,
        maxHp: 120,
        attack: 100,
        critChance: 0,
        abilities: [{ name: 'Смертельный тест', damage: 200, cooldown: 0, type: 'physical', alwaysHits: true }],
      },
      [{
        name: 'Троглодит-споровик',
        hp: 40,
        maxHp: 40,
        attack: 8,
        physDef: 0,
        magicDef: 0,
        abilities: [ABILITY_LIBRARY['Посмертный выброс спор']],
      }]
    );
    session.state.initiative.playerReady = true;
    addEffect(session.state.enemies[0], { id: 'rebirth', duration: 2 }, () => {}, session.state.enemies[0], { session });

    performPlayerAction(session, 'Смертельный тест', 0);

    expect(session.state.enemies[0].hp).toBeGreaterThan(0);
    expect(session.state.enemies[0]._deathTriggered).toBeUndefined();
    expect(session.state.players[0].effects.some(effect => effect.id === 'poison')).toBe(false);
  });

  test('shield.onBreak can apply poison without a poison shield status', () => {
    const session = initCombatSession(
      {
        name: 'Герой',
        hp: 120,
        maxHp: 120,
        attack: 30,
        critChance: 0,
        abilities: [{ name: 'Тестовый удар', damage: 40, cooldown: 0, type: 'physical', alwaysHits: true }],
      },
      [{ name: 'Троглодит-шаман', hp: 100, maxHp: 100, attack: 8, physDef: 0, magicDef: 0, abilities: [] }]
    );
    session.state.initiative.playerReady = true;
    const enemyUnit = session.state.enemies[0];
    addEffect(enemyUnit, {
      id: 'shield',
      duration: 2,
      value: 10,
      onBreak: {
        effects: [{ id: 'poison', duration: 1 }],
        target: 'enemies',
      },
    }, () => {}, enemyUnit, { session });

    performPlayerAction(session, 'Тестовый удар', 0);
    expect(session.state.players[0].effects.some(effect => effect.id === 'poison')).toBe(true);
    expect(EFFECT_LIBRARY.poison_shield).toBeUndefined();
  });

  test.each([2, 3, 4, 5])('enemy summoning fills the shared battlefield from %i living enemies', livingCount => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      Array.from({ length: livingCount }, (_, index) => ({
        name: `Манекен ${index + 1}`,
        hp: 50,
        maxHp: 50,
        attack: 8,
        abilities: [],
      }))
    );
    const summoner = session.state.enemies[0];
    beginCombatPresentation(session);
    const result = session.summonEnemy('Пещерная змея', { source: summoner });
    expect(result.success).toBe(true);
    expect(session.state.enemies.filter(enemyEntry => enemyEntry.hp > 0)).toHaveLength(livingCount + 1);
    expect(result.enemy).toBe(session.state.enemies[livingCount]);
    expect(consumeCombatPresentationEvents(session)).toEqual([
      expect.objectContaining({
        type: 'summon',
        actor: summoner,
        target: result.enemy,
        side: 'enemy',
        summonedUnitId: result.enemy.id,
      }),
    ]);
  });

  test('enemy summoning stops at the six-living-enemy battlefield capacity', () => {
    expect(MAX_ACTIVE_ENEMIES).toBe(6);
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      Array.from({ length: MAX_ACTIVE_ENEMIES }, (_, index) => ({
        name: `Манекен ${index + 1}`,
        hp: 50,
        maxHp: 50,
        attack: 8,
        abilities: [],
      }))
    );
    beginCombatPresentation(session);
    expect(session.summonEnemy('Пещерная змея')).toEqual({ success: false, reason: 'no_slot' });
    expect(consumeCombatPresentationEvents(session)).toEqual([]);
  });

  test('a dead enemy frees its runtime slot for a distinct summon', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      Array.from({ length: MAX_ACTIVE_ENEMIES }, (_, index) => ({
        name: `Манекен ${index + 1}`,
        hp: 50,
        maxHp: 50,
        attack: 8,
        abilities: [],
      }))
    );
    const deadEnemy = session.state.enemies[2];
    deadEnemy.hp = 0;
    beginCombatPresentation(session);
    const result = session.summonEnemy('Пещерная змея');
    expect(result.success).toBe(true);
    expect(result.enemy).not.toBe(deadEnemy);
    expect(session.state.enemies[2]).toBe(result.enemy);
    expect(session.state.enemies.filter(enemyEntry => enemyEntry.hp > 0)).toHaveLength(MAX_ACTIVE_ENEMIES);
    expect(consumeCombatPresentationEvents(session)).toEqual([
      expect.objectContaining({ type: 'summon', target: result.enemy, summonedUnitId: result.enemy.id }),
    ]);
  });

  test('Cave snake remains summon-only and lighter than normal early enemies', () => {
    const snake = allEnemies.find(enemyEntry => enemyEntry.name === 'Пещерная змея');
    const rat = allEnemies.find(enemyEntry => enemyEntry.name === 'Чумная крыса');
    const earlyMushroomEnemies = enemies.filter(enemyEntry =>
      enemyEntry.location === 'Грибные Пещеры' &&
      !enemyEntry.boss &&
      !enemyEntry.miniBoss &&
      !enemyEntry.summonOnly &&
      enemyEntry.encounterPhase !== 'late' &&
      enemyEntry.encounterPhase !== 'elite'
    );

    expect(snake).toMatchObject({ summonOnly: true });
    expect(snake?.maxHp).toBeLessThan(Math.min(...earlyMushroomEnemies.map(enemyEntry => enemyEntry.maxHp)));
    expect(snake?.attack).toBeLessThan(Math.min(...earlyMushroomEnemies.map(enemyEntry => enemyEntry.attack)));
    expect(snake?.maxHp).toBeLessThanOrEqual((rat?.maxHp ?? 0) * 2.5);
    expect(snake?.attack).toBeLessThanOrEqual((rat?.attack ?? 0) + 2);
    expect(snake?.speed).toBeLessThanOrEqual(rat?.speed ?? 999);
    expect(ABILITY_LIBRARY['Чумной укус'].effect).toMatchObject({ id: 'poison', duration: 1 });
  });


  test('onDeath fires from DoT kills', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      [{ name: 'Троглодит-споровик', hp: 6, maxHp: 40, attack: 8, physDef: 0, magicDef: 0, abilities: [ABILITY_LIBRARY['Посмертный выброс спор']] }]
    );
    addEffect(session.state.enemies[0], { id: 'poison', duration: 1, sourceAttack: 10 }, () => {}, session.state.players[0], { session });
    session.state.enemies[0].turnMeter = 1000;

    processEnemyAI(session);

    expect(session.state.enemies[0]._deathTriggered).toBe(true);
    expect(session.state.players[0].effects.some(effect => effect.id === 'poison')).toBe(true);
    expect(session.state.players[0].hp).toBe(100);
  });

  test('onDeath fires from shield-break damage kills', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 5, maxHp: 100, attack: 30, critChance: 0, abilities: [ABILITY_LIBRARY['Посмертный выброс спор'], { name: 'Тестовый удар', damage: 40, cooldown: 0, type: 'physical', alwaysHits: true }] },
      [{ name: 'Искажённый троглодит-тотемщик', hp: 100, maxHp: 100, attack: 8, physDef: 0, magicDef: 0, abilities: [] }]
    );
    session.state.initiative.playerReady = true;
    addEffect(session.state.enemies[0], {
      id: 'shield',
      duration: 2,
      value: 10,
      onBreak: { damage: 20, type: 'magical', target: 'enemies' },
    }, () => {}, session.state.enemies[0], { session });

    performPlayerAction(session, 'Тестовый удар', 0);

    expect(session.state.players[0]._deathTriggered).toBe(true);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'poison')).toBe(true);
  });

  test('onDeath fires from reflected damage kills', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 5, maxHp: 100, attack: 10, magAtk: 100, critChance: 0, abilities: [ABILITY_LIBRARY['Посмертный выброс спор'], { name: 'Тестовая искра', damage: 100, cooldown: 0, type: 'magical', alwaysHits: true }] },
      [{ name: 'Зеркальный спорник', hp: 200, maxHp: 200, attack: 8, physDef: 0, magicDef: 0, abilities: [] }]
    );
    session.state.initiative.playerReady = true;
    addEffect(session.state.enemies[0], { id: 'magic_reflection', duration: 2 }, () => {}, session.state.enemies[0], { session });

    performPlayerAction(session, 'Тестовая искра', 0);

    expect(session.state.players[0]._deathTriggered).toBe(true);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'poison')).toBe(true);
  });

  test('onDeath fires from counterattack kills', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 5, maxHp: 100, attack: 10, critChance: 0, abilities: [ABILITY_LIBRARY['Посмертный выброс спор'], { name: 'Тестовый тычок', damage: 10, cooldown: 0, type: 'physical', alwaysHits: true }] },
      [{ name: 'Троглодит-копейщик', hp: 100, maxHp: 100, attack: 20, physDef: 0, magicDef: 0, abilities: [] }]
    );
    session.state.initiative.playerReady = true;
    addEffect(session.state.enemies[0], { id: 'iron_counter', duration: 2 }, () => {}, session.state.enemies[0], { session });

    performPlayerAction(session, 'Тестовый тычок', 0);

    expect(session.state.players[0]._deathTriggered).toBe(true);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'poison')).toBe(true);
  });

  test('onDeath still fires only once in chained deaths', () => {
    const unitA = { name: 'A', hp: 0, abilities: [], effects: [] };
    const unitB = { name: 'B', hp: 0, abilities: [], effects: [] };
    const session = { state: { players: [unitA], enemies: [unitB] } };
    unitA.abilities = [{ name: 'A death', passive: true, onDeath: () => triggerOnDeath(unitB, unitA, session, () => {}) }];
    unitB.abilities = [{ name: 'B death', passive: true, onDeath: () => triggerOnDeath(unitA, unitB, session, () => {}) }];

    expect(triggerOnDeath(unitA, unitB, session, () => {})).toBe(true);
    expect(unitA._deathTriggered).toBe(true);
    expect(unitB._deathTriggered).toBe(true);
    expect(triggerOnDeath(unitA, unitB, session, () => {})).toBe(false);
    expect(triggerOnDeath(unitB, unitA, session, () => {})).toBe(false);
  });

  test('onDeath respects passive_break passivesDisabled', () => {
    const unit = { name: 'Сломленный споровик', hp: 0, passivesDisabled: true, abilities: [ABILITY_LIBRARY['Посмертный выброс спор']], effects: [] };
    const player = { name: 'Герой', hp: 100, maxHp: 100, effects: [], shield: 0 };
    const session = { state: { enemies: [unit], players: [player] } };

    expect(triggerOnDeath(unit, player, session, () => {})).toBe(false);
    expect(unit._deathTriggered).toBeUndefined();
    expect(player.effects).toHaveLength(0);
  });

  test('iron_counter triggers once from direct positive damage and does not recursively counter', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10, critChance: 0, abilities: [{ name: 'Тестовый удар', damage: 10, cooldown: 0, type: 'physical', alwaysHits: true }] },
      [{ name: 'Троглодит-копейщик', hp: 100, maxHp: 100, attack: 10, physDef: 0, magicDef: 0, abilities: [] }]
    );
    session.state.initiative.playerReady = true;
    addEffect(session.state.players[0], { id: 'iron_counter', duration: 2 }, () => {}, session.state.players[0], { session });
    addEffect(session.state.enemies[0], { id: 'iron_counter', duration: 2 }, () => {}, session.state.enemies[0], { session });

    performPlayerAction(session, 'Тестовый удар', 0);

    const counterLogs = session.state.log.filter(line => line.includes('контратак'));
    expect(counterLogs).toHaveLength(1);
    expect(session.state.players[0].hp).toBeGreaterThan(0);
    expect(session.state.enemies[0].hp).toBeGreaterThan(0);
  });

  test('iron_counter does not trigger from DoT damage', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      [{ name: 'Троглодит-копейщик', hp: 100, maxHp: 100, attack: 10, physDef: 0, magicDef: 0, abilities: [] }]
    );
    addEffect(session.state.enemies[0], { id: 'iron_counter', duration: 2 }, () => {}, session.state.enemies[0], { session });
    addEffect(session.state.enemies[0], { id: 'poison', duration: 1, sourceAttack: 10 }, () => {}, session.state.players[0], { session });
    session.state.enemies[0].turnMeter = 1000;

    processEnemyAI(session);

    expect(session.state.log.filter(line => line.includes('контратак'))).toHaveLength(0);
  });

  test('iron_counter does not trigger from shield-break damage', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 30, critChance: 0, abilities: [{ name: 'Тестовый удар', damage: 40, cooldown: 0, type: 'physical', alwaysHits: true }] },
      [{ name: 'Искажённый троглодит-тотемщик', hp: 100, maxHp: 100, attack: 10, physDef: 0, magicDef: 0, abilities: [] }]
    );
    session.state.initiative.playerReady = true;
    addEffect(session.state.players[0], { id: 'iron_counter', duration: 2 }, () => {}, session.state.players[0], { session });
    addEffect(session.state.enemies[0], {
      id: 'shield',
      duration: 2,
      value: 10,
      onBreak: { damage: 20, type: 'magical', target: 'enemies' },
    }, () => {}, session.state.enemies[0], { session });

    performPlayerAction(session, 'Тестовый удар', 0);

    expect(session.state.log.filter(line => line.includes('контратак'))).toHaveLength(0);
  });

  test('iron_counter does not trigger from reflected damage', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10, magAtk: 50, critChance: 0, abilities: [{ name: 'Тестовая искра', damage: 30, cooldown: 0, type: 'magical', alwaysHits: true }] },
      [{ name: 'Зеркальный копейщик', hp: 100, maxHp: 100, attack: 10, physDef: 0, magicDef: 0, abilities: [] }]
    );
    session.state.initiative.playerReady = true;
    addEffect(session.state.players[0], { id: 'iron_counter', duration: 2 }, () => {}, session.state.players[0], { session });
    addEffect(session.state.enemies[0], { id: 'magic_reflection', duration: 2 }, () => {}, session.state.enemies[0], { session });

    performPlayerAction(session, 'Тестовая искра', 0);

    expect(session.state.log.filter(line => line.includes('контратак'))).toHaveLength(0);
  });

  test('shield.onBreak poison does not trigger on natural shield expiration', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      [{ name: 'Троглодит-шаман', hp: 100, maxHp: 100, attack: 8, physDef: 0, magicDef: 0, abilities: [] }]
    );
    addEffect(session.state.enemies[0], {
      id: 'shield',
      duration: 1,
      value: 10,
      onBreak: { effects: [{ id: 'poison', duration: 1 }], target: 'enemies' },
    }, () => {}, session.state.enemies[0], { session });

    processEnemyAI(session);

    expect(session.state.players[0].effects.some(effect => effect.id === 'poison')).toBe(false);
  });

  test('shield.onBreak poison does not double-trigger after the same shield has broken', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 30, critChance: 0, abilities: [{ name: 'Тестовый удар', damage: 40, cooldown: 0, type: 'physical', alwaysHits: true }] },
      [{ name: 'Троглодит-шаман', hp: 100, maxHp: 100, attack: 8, physDef: 0, magicDef: 0, abilities: [] }]
    );
    const enemyUnit = session.state.enemies[0];
    addEffect(enemyUnit, {
      id: 'shield',
      duration: 2,
      value: 10,
      onBreak: { effects: [{ id: 'poison', duration: 1 }], target: 'enemies' },
    }, () => {}, enemyUnit, { session });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Тестовый удар', 0);
    expect(session.state.players[0].effects.some(effect => effect.id === 'poison')).toBe(true);
    session.state.players[0].effects = [];
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Тестовый удар', 0);

    expect(session.state.players[0].effects.some(effect => effect.id === 'poison')).toBe(false);
  });

  test('boss mycelium regeneration only maintains short recovery while damaged', () => {
    const healthyBoss = { name: 'Троглодит-мицелий', hp: 220, maxHp: 260, effects: [] };
    const woundedBoss = { name: 'Троглодит-мицелий', hp: 150, maxHp: 260, effects: [] };
    const ability = ABILITY_LIBRARY['Мицелиевое восстановление'];
    const originalRandom = Math.random;

    Math.random = () => 0.99;
    try {
      ability.onTurnStart({ owner: healthyBoss, session: { state: { enemies: [healthyBoss], players: [] } }, log: () => {} });
      ability.onTurnStart({ owner: woundedBoss, session: { state: { enemies: [woundedBoss], players: [] } }, log: () => {} });
      ability.onTurnStart({ owner: woundedBoss, session: { state: { enemies: [woundedBoss], players: [] } }, log: () => {} });
    } finally {
      Math.random = originalRandom;
    }

    expect(healthyBoss.effects.some(effect => effect.id === 'regeneration')).toBe(false);
    const regenEffects = woundedBoss.effects.filter(effect => effect.id === 'regeneration');
    expect(regenEffects).toHaveLength(1);
    expect(regenEffects[0].remainingTurns).toBe(1);
  });

  test('Mycelium phase two triggers once below half HP and removes regeneration', () => {
    const boss = { name: 'Троглодит-мицелий', hp: 130, maxHp: 260, effects: [{ id: 'regeneration', remainingTurns: 2, duration: 2 }] };
    const ability = ABILITY_LIBRARY['Сжатие мицелия'];
    const logs = [];

    ability.onTurnStart({ owner: boss, session: { state: { enemies: [boss], players: [] } }, log: text => logs.push(text) });
    ability.onTurnStart({ owner: boss, session: { state: { enemies: [boss], players: [] } }, log: text => logs.push(text) });

    expect(boss._myceliumPhaseTwoTriggered).toBe(true);
    expect(boss.effects.some(effect => effect.id === 'regeneration')).toBe(false);
    expect(boss.effects.some(effect => effect.id === 'speed_boost_minor')).toBe(true);
    expect(boss.effects.some(effect => effect.id === 'magic_attack_boost_minor')).toBe(true);
    expect(logs.filter(line => line.includes('перестаёт восстанавливаться'))).toHaveLength(1);
  });

  test('Mycelium phase two does not trigger above half HP and blocks later regeneration after phase two', () => {
    const healthyBoss = { name: 'Троглодит-мицелий', hp: 140, maxHp: 260, effects: [] };
    const phaseAbility = ABILITY_LIBRARY['Сжатие мицелия'];
    phaseAbility.onTurnStart({ owner: healthyBoss, session: { state: { enemies: [healthyBoss], players: [] } }, log: () => {} });
    expect(healthyBoss._myceliumPhaseTwoTriggered).toBeUndefined();

    healthyBoss.hp = 120;
    phaseAbility.onTurnStart({ owner: healthyBoss, session: { state: { enemies: [healthyBoss], players: [] } }, log: () => {} });
    ABILITY_LIBRARY['Мицелиевое восстановление'].onTurnStart({ owner: healthyBoss, session: { state: { enemies: [healthyBoss], players: [] } }, log: () => {} });
    expect(healthyBoss.effects.some(effect => effect.id === 'regeneration')).toBe(false);
  });

  test('boss has meaningful active damage options', () => {
    const boss = allEnemies.find(enemyEntry => enemyEntry.name === 'Троглодит-мицелий (босс)');
    const paralysis = ABILITY_LIBRARY['Споровой паралич'];
    const net = ABILITY_LIBRARY['Грибная сеть'];

    expect(paralysis.damage({ attacker: boss })).toBeGreaterThan(boss.attack);
    expect(net.damage({ attacker: boss })).toBeGreaterThan(boss.attack);
  });

  test('enemy with unavailable abilities falls back to a basic attack without no-op log', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    const session = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      [{
        name: 'Истощённый грибник',
        hp: 80,
        maxHp: 80,
        attack: 12,
        physDef: 0,
        magicDef: 0,
        abilities: [{ name: 'Недоступный приём', damage: 40, cooldown: 3, type: 'physical' }],
      }]
    );
    session.state.enemies[0].abilities[0].currentCooldown = 3;
    session.state.enemies[0].turnMeter = 1000;

    try {
      processEnemyAI(session);
    } finally {
      Math.random = originalRandom;
    }

    expect(session.state.players[0].hp).toBeLessThan(100);
    expect(session.state.log.some(line => line.includes('атакует напрямую'))).toBe(true);
    expect(session.state.log.some(line => line.includes('не совершает заметных действий'))).toBe(false);
  });

  test('boss with no valid special ability falls back to a basic attack', () => {
    const session = initCombatSession(
      { name: 'Герой', hp: 130, maxHp: 130, attack: 10 },
      [{
        name: 'Троглодит-мицелий (босс)',
        hp: 260,
        maxHp: 260,
        attack: 25,
        boss: true,
        physDef: 0,
        magicDef: 0,
        abilities: [
          { name: 'Пассивная спора', passive: true },
          { name: 'Остывающая сеть', damage: 50, cooldown: 4, type: 'magical' },
        ],
      }]
    );
    session.state.enemies[0].abilities[1].currentCooldown = 4;
    session.state.enemies[0].turnMeter = 1000;

    const originalRandom = Math.random;
    Math.random = () => 0.1;
    try {
      processEnemyAI(session);
    } finally {
      Math.random = originalRandom;
    }

    expect(session.state.players[0].hp).toBeLessThan(130);
    expect(session.state.log.some(line => line.includes('Троглодит-мицелий (босс) не находит подходящей особой способности'))).toBe(true);
    expect(session.state.log.some(line => line.includes('не совершает заметных действий'))).toBe(false);
  });

  test('silenced enemy can still use fallback basic attacks, but stunned enemy skips', () => {
    const silencedSession = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      [{ name: 'Немой троглодит', hp: 80, maxHp: 80, attack: 50, abilities: [{ name: 'Заклинание', damage: 40, cooldown: 0, type: 'magical' }] }]
    );
    addEffect(silencedSession.state.enemies[0], { id: 'silence', duration: 1 }, () => {}, silencedSession.state.players[0], { session: silencedSession });
    silencedSession.state.enemies[0].turnMeter = 1000;
    const originalRandom = Math.random;
    Math.random = () => 0.1;
    try {
      processEnemyAI(silencedSession);
    } finally {
      Math.random = originalRandom;
    }
    expect(silencedSession.state.players[0].hp).toBeLessThan(100);
    expect(silencedSession.state.log.some(line => line.includes('атакует напрямую'))).toBe(true);

    const stunnedSession = initCombatSession(
      { name: 'Герой', hp: 100, maxHp: 100, attack: 10 },
      [{ name: 'Оглушённый троглодит', hp: 80, maxHp: 80, attack: 11, abilities: [{ name: 'Атака', damage: 11, cooldown: 0, type: 'physical', basic: true }] }]
    );
    addEffect(stunnedSession.state.enemies[0], { id: 'stun', duration: 2 }, () => {}, stunnedSession.state.players[0], { session: stunnedSession });
    stunnedSession.state.enemies[0].turnMeter = 1000;
    processEnemyAI(stunnedSession);
    expect(stunnedSession.state.players[0].hp).toBe(100);
    expect(stunnedSession.state.log.some(line => line.includes('оглушён и пропускает ход'))).toBe(true);
  });


  test('normal attacks and directed abilities no longer have a hidden baseline miss', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      const physicalSession = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 15,
          critChance: 0,
          abilities: [{ name: 'Прицельный тест', damage: 15, cooldown: 0, type: 'physical' }],
        },
        [{ name: 'Манекен', hp: 60, maxHp: 60, physDef: 0, magicDef: 0, effects: [] }]
      );
      physicalSession.state.initiative.playerReady = true;
      performPlayerAction(physicalSession, 'Прицельный тест', 0);
      expect(physicalSession.state.enemies[0].hp).toBe(45);
      expect(physicalSession.state.log.some(line => line.includes('промах'))).toBe(false);

      const magicSession = initCombatSession(
        {
          name: 'Элементалист',
          class: 'Mage',
          hp: 80,
          maxHp: 80,
          attack: 5,
          magAtk: 20,
          critChance: 0,
          abilities: [{ name: 'Тестовая искра', damage: 20, cooldown: 0, type: 'magical' }],
        },
        [{ name: 'Манекен', hp: 80, maxHp: 80, physDef: 0, magicDef: 0, effects: [] }]
      );
      magicSession.state.initiative.playerReady = true;
      performPlayerAction(magicSession, 'Тестовая искра', 0);
      expect(magicSession.state.enemies[0].hp).toBe(60);
      expect(magicSession.state.log.some(line => line.includes('промах'))).toBe(false);

      const fallbackSession = initCombatSession(
        { name: 'Герой', hp: 100, maxHp: 100, physDef: 0, magicDef: 0, abilities: [] },
        [{ name: 'Растерянный враг', hp: 40, maxHp: 40, attack: 12, physDef: 0, magicDef: 0, abilities: [] }]
      );
      fallbackSession.state.players[0].turnMeter = 0;
      fallbackSession.state.enemies[0].turnMeter = 1000;
      processEnemyAI(fallbackSession);
      expect(fallbackSession.state.players[0].hp).toBe(88);
      expect(fallbackSession.state.log.some(line => line.includes('промах'))).toBe(false);
    } finally {
      Math.random = originalRandom;
    }
  });

  test('explicit evasion can still cause misses with clear logs and blocks Archer passive follow-ups', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      const session = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 50,
          critChance: 0,
          abilityNames: ['Сквозные раны', 'Тестовый выстрел'],
          abilities: [{ name: 'Тестовый выстрел', damage: 50, cooldown: 0, type: 'physical' }],
        },
        [
          { name: 'Уклончивая цель', hp: 20, maxHp: 20, physDef: 0, magicDef: 0, effects: [{ id: 'bleed', type: 'debuff', remainingTurns: 1, duration: 1 }] },
          { name: 'Запасная цель', hp: 60, maxHp: 60, physDef: 0, magicDef: 0, effects: [] },
        ]
      );
      addEffect(session.state.enemies[0], { id: 'bleed', duration: 1 }, () => {}, session.state.players[0], { session });
      addEffect(session.state.enemies[0], { id: 'evasion', duration: 1 }, () => {}, session.state.enemies[0], { session });
      session.state.initiative.playerReady = true;
      performPlayerAction(session, 'Тестовый выстрел', 0);

      expect(session.state.enemies[0].hp).toBe(20);
      expect(session.state.enemies[0].effects.find(effect => effect.id === 'bleed')).toMatchObject({ remainingTurns: 1 });
      expect(session.state.enemies[1].hp).toBe(60);
      expect(session.state.log.some(line => line.includes('уклоняется от атаки'))).toBe(true);
      expect(session.state.log.some(line => line.includes('Сквозные раны'))).toBe(false);
    } finally {
      Math.random = originalRandom;
    }
  });

  test('Blind lowers attacker accuracy instead of making the blinded target harder to hit', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      const blindedAttackerSession = initCombatSession(
        {
          name: 'Ослепший лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 15,
          critChance: 0,
          abilities: [{ name: 'Слепой выстрел', damage: 15, cooldown: 0, type: 'physical' }],
        },
        [{ name: 'Манекен', hp: 60, maxHp: 60, physDef: 0, magicDef: 0, effects: [] }]
      );
      addEffect(blindedAttackerSession.state.players[0], { id: 'blind', duration: 2 }, () => {}, blindedAttackerSession.state.enemies[0], { session: blindedAttackerSession });
      blindedAttackerSession.state.initiative.playerReady = true;
      performPlayerAction(blindedAttackerSession, 'Слепой выстрел', 0);
      expect(blindedAttackerSession.state.enemies[0].hp).toBe(60);
      expect(blindedAttackerSession.state.log.some(line => line.includes('промахивается из-за Слепоты'))).toBe(true);

      const blindedTargetSession = initCombatSession(
        {
          name: 'Лучник',
          class: 'Archer',
          hp: 90,
          maxHp: 90,
          attack: 15,
          critChance: 0,
          abilities: [{ name: 'Ясный выстрел', damage: 15, cooldown: 0, type: 'physical' }],
        },
        [{ name: 'Ослеплённая цель', hp: 60, maxHp: 60, physDef: 0, magicDef: 0, effects: [] }]
      );
      addEffect(blindedTargetSession.state.enemies[0], { id: 'blind', duration: 1 }, () => {}, blindedTargetSession.state.players[0], { session: blindedTargetSession });
      blindedTargetSession.state.initiative.playerReady = true;
      performPlayerAction(blindedTargetSession, 'Ясный выстрел', 0);
      expect(blindedTargetSession.state.enemies[0].hp).toBe(45);
      expect(blindedTargetSession.state.log.some(line => line.includes('промах'))).toBe(false);
    } finally {
      Math.random = originalRandom;
    }
  });

  test('Elementalist canonical ST splash cooldowns exclude Chain Lightning', () => {
    expect(ABILITY_LIBRARY['Цепная молния'].cooldown).toBe(2);
    expect(ABILITY_LIBRARY['Ледяное копьё'].cooldown).toBe(1);
    expect(ABILITY_LIBRARY['Морозный щит'].cooldown).toBe(3);
  });

  test('Elementalist legacy chaos no longer applies random elemental statuses', () => {
    const castElementalSpell = (abilityName, randomValue) => {
      const originalRandom = Math.random;
      Math.random = () => randomValue;
      try {
        const session = initCombatSession(
          {
            name: 'Элементалист',
            class: 'Mage',
            hp: 80,
            maxHp: 80,
            attack: 5,
            magAtk: 20,
            critChance: 0,
            abilityNames: ['Стихийный хаос', abilityName],
            abilities: [ABILITY_LIBRARY['Стихийный хаос'], { ...ABILITY_LIBRARY[abilityName], alwaysHits: true }],
          },
          [{ name: 'Манекен', hp: 200, maxHp: 200, physDef: 0, magicDef: 0, effects: [] }]
        );
        session.state.initiative.playerReady = true;
        performPlayerAction(session, abilityName, 0);
        return session.state.log.filter(line => line.includes('Стихийный хаос накладывает'));
      } finally {
        Math.random = originalRandom;
      }
    };

    expect(castElementalSpell('Огненный шар', 0)).toEqual([]);
    expect(castElementalSpell('Огненный шар', 0.99)).toEqual([]);
    expect(castElementalSpell('Ледяной осколок', 0)).toEqual([]);
    expect(castElementalSpell('Ледяной осколок', 0.99)).toEqual([]);
    expect(castElementalSpell('Цепная молния', 0)).toEqual([]);
    expect(castElementalSpell('Цепная молния', 0.99)).toEqual([]);
  });

  test('Elementalist chaos ignores basic, DoT, counter, item proc, and secondary damage paths', () => {
    const basicSession = initCombatSession(
      {
        name: 'Элементалист',
        class: 'Mage',
        hp: 80,
        maxHp: 80,
        attack: 5,
        magAtk: 20,
        weaponMagicSchool: 'fire',
        critChance: 0,
        abilityNames: ['Стихийный хаос', 'Атака'],
        abilities: [ABILITY_LIBRARY['Стихийный хаос'], ABILITY_LIBRARY['Атака']],
      },
      [{ name: 'Манекен', hp: 200, maxHp: 200, physDef: 0, magicDef: 0, effects: [] }]
    );
    basicSession.state.initiative.playerReady = true;
    performPlayerAction(basicSession, 'Атака', 0);
    expect(basicSession.state.enemies[0].effects.some(effect => effect.metadata?.sourceAbility === 'Стихийный хаос')).toBe(false);

    const dotSession = initCombatSession(
      {
        name: 'Элементалист',
        class: 'Mage',
        hp: 80,
        maxHp: 80,
        attack: 5,
        magAtk: 20,
        abilityNames: ['Стихийный хаос'],
        abilities: [ABILITY_LIBRARY['Стихийный хаос']],
      },
      [{ name: 'Горящая цель', hp: 5, maxHp: 5, physDef: 0, magicDef: 0, effects: [] }]
    );
    addEffect(dotSession.state.enemies[0], { id: 'burn', duration: 1, sourceAttack: 40 }, () => {}, dotSession.state.players[0], { session: dotSession });
    dotSession.state.players[0].turnMeter = 0;
    dotSession.state.enemies[0].turnMeter = 1000;
    processEnemyAI(dotSession);
    expect(dotSession.state.log.some(line => line.includes('Стихийный хаос'))).toBe(false);

    const counterSession = initCombatSession(
      {
        name: 'Элементалист',
        class: 'Mage',
        hp: 80,
        maxHp: 80,
        attack: 5,
        magAtk: 30,
        abilityNames: ['Стихийный хаос'],
        abilities: [ABILITY_LIBRARY['Стихийный хаос']],
      },
      [{ name: 'Атакующий враг', hp: 5, maxHp: 5, attack: 10, physDef: 0, magicDef: 0, abilities: [{ name: 'Укол', damage: 1, cooldown: 0, type: 'physical', alwaysHits: true }] }]
    );
    addEffect(counterSession.state.players[0], { id: 'iron_counter', duration: 1 }, () => {}, counterSession.state.players[0], { session: counterSession });
    counterSession.state.players[0].turnMeter = 0;
    counterSession.state.enemies[0].turnMeter = 1000;
    processEnemyAI(counterSession);
    expect(counterSession.state.log.some(line => line.includes('Стихийный хаос'))).toBe(false);

    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      const itemProcSession = initCombatSession(
        {
          name: 'Элементалист',
          class: 'Mage',
          hp: 80,
          maxHp: 80,
          attack: 5,
          magAtk: 20,
          critChance: 0,
          equipment: { mainHand: 'Посох Украденной Искры' },
          abilityNames: ['Стихийный хаос', 'Огненный шар', 'Цепная молния'],
          abilities: [
            ABILITY_LIBRARY['Стихийный хаос'],
            { ...ABILITY_LIBRARY['Огненный шар'], alwaysHits: true },
            { ...ABILITY_LIBRARY['Цепная молния'], alwaysHits: true },
          ],
        },
        [
          { name: 'Основная цель', hp: 200, maxHp: 200, physDef: 0, magicDef: 0, effects: [] },
          { name: 'Соседняя цель', hp: 200, maxHp: 200, physDef: 0, magicDef: 0, effects: [] },
        ]
      );
      itemProcSession.state.initiative.playerReady = true;
      performPlayerAction(itemProcSession, 'Огненный шар', 0);
      itemProcSession.state.initiative.playerReady = true;
      itemProcSession.state.players[0].abilities.forEach(ability => { ability.currentCooldown = 0; });
      performPlayerAction(itemProcSession, 'Цепная молния', 0);

      const chaosLogs = itemProcSession.state.log.filter(line => line.includes('Стихийный хаос накладывает'));
      expect(chaosLogs).toHaveLength(0);
      expect(chaosLogs.every(line => line.includes('Основная цель'))).toBe(true);
    } finally {
      Math.random = originalRandom;
    }
  });

  test('Elementalist chaos replaces the old passive damage budget without adding statuses', () => {
    expect(ABILITY_LIBRARY['Стихийный хаос']).toMatchObject({ passive: true });
    expect(ABILITY_LIBRARY['Стихийный хаос'].modifyDamage).toBeUndefined();
    expect(ABILITY_LIBRARY['Огненный шар'].damage({ attacker: { magAtk: 10 } })).toBe(14);
    expect(ABILITY_LIBRARY['Цепная молния'].damage({ attacker: { magAtk: 10 } })).toBe(10);
    expect(ABILITY_LIBRARY['Цепная молния'].secondary.damage({ attacker: { magAtk: 10 } })).toBe(10);
    expect(EFFECT_LIBRARY.elemental_chaos).toBeUndefined();
    expect(EFFECT_LIBRARY.chaos_burn).toBeUndefined();
    expect(EFFECT_LIBRARY.chaos_freeze).toBeUndefined();
    expect(EFFECT_LIBRARY.chaos_shock).toBeUndefined();
  });

  test('validateRoomChoices rejects saved encounter payloads with summoned-only enemies', () => {
    expect(validateRoomChoices([
      { id: 'combat', type: 'Бой', roomType: ROOM_TYPES.COMBAT, enemies: [{ name: 'Пещерная змея', summonOnly: true }] },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
      { id: 'secret', type: 'Секрет', roomType: ROOM_TYPES.SECRET, hiddenRoomType: SECRET_TYPES.RESOURCE },
    ], { state: { completedCombatRooms: 5, choiceWindowIndex: 4 }, hasBossEnemy: true, hasCursedEnemyPool: true })).toBe(false);

    expect(validateRoomChoices([
      { id: 'combat', type: 'Бой', roomType: ROOM_TYPES.COMBAT },
      { id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE },
      { id: 'secret', type: 'Секрет', roomType: ROOM_TYPES.SECRET, hiddenRoomType: SECRET_TYPES.COMBAT, hiddenPayload: { enemies: [{ name: 'Пещерная змея', summonOnly: true }] } },
    ], { state: { completedCombatRooms: 5, choiceWindowIndex: 4 }, hasBossEnemy: true, hasCursedEnemyPool: true })).toBe(false);
  });

  test('returning to the Guild clears curses and their stable dominant selection', () => {
    const returned = resetDungeonRunState({ curses: { corruption: { tier: 5 } }, dominantCurseId: CURSE_IDS.CORRUPTION, hp: 10, maxHp: 100 });
    expect(returned.curses).toEqual({});
    expect(returned.dominantCurseId).toBeNull();
  });

});
