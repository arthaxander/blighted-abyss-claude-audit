import { equipmentByName } from '../data/equipment';
import { resolveItemArt } from '../data/itemArt';
import { EQUIPMENT_DETAILS } from '../data/itemDetailsPresentation';
import {
  LEVEL_ONE_LOCATIONS,
  LOCATION_LEVEL_ONE_EQUIPMENT,
  PRIMORDIAL_DROP_CHANCES,
  PRIMORDIAL_EQUIPMENT_BY_LOCATION,
  rollLocationPrimordial,
} from '../data/levelOneLootOwnership';
import { rollChestLoot, rollTreasureLoot } from '../data/items';
import { buildResourceRoomPayload } from './roomGeneration';
import { resolveEncounterRewards } from './encounterRewards';
import { addEffect, cleanseEffects, processEffects } from './effects';
import {
  applyDamage,
  consumeBetrayalRedirectTarget,
} from './combatUtils';

const CARAPACE = 'Панцирь Змеиного Полубога';
const CLOAK = 'Плащ Первого Предателя';
const CENSER = 'Кадило Отца Костров';

const unit = (name, overrides = {}) => ({
  id: name,
  name,
  hp: 100,
  maxHp: 100,
  attack: 10,
  magAtk: 10,
  physDef: 0,
  magicDef: 0,
  effects: [],
  abilities: [],
  ...overrides,
});

describe('Primordial item data and ownership', () => {
  test('defines the Defender chest and Archer cloak with exact authored stats', () => {
    expect(equipmentByName[CARAPACE]).toMatchObject({
      id: 'demigod_serpent_carapace',
      class: 'Defender',
      type: 'Armor',
      armorKind: 'chest',
      rarity: 'Первозданная',
      stats: { maxHp: 30, physDef: 18, magicDef: 12 },
    });
    expect(equipmentByName[CLOAK]).toMatchObject({
      id: 'first_traitor_cloak',
      class: 'Archer',
      type: 'Armor',
      armorKind: 'cloak',
      rarity: 'Первозданная',
      stats: { maxHp: 23, physDef: 15, magicDef: 8, attack: 5, speedPct: 0.06 },
    });
    expect(resolveItemArt(CARAPACE)).toContain('serpent_demigod_armor.webp');
    expect(resolveItemArt(CLOAK)).toContain('first_traitor_cloak.webp');
    expect(EQUIPMENT_DETAILS[CARAPACE].effectParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ statusId: 'poison' }),
      expect.objectContaining({ statusId: 'shield' }),
    ]));
    expect(EQUIPMENT_DETAILS[CLOAK].effectParts).toContainEqual(expect.objectContaining({ statusId: 'betrayal' }));
  });

  test('maps exactly one Primordial to each Level-1 location and none to ordinary pools', () => {
    expect(PRIMORDIAL_EQUIPMENT_BY_LOCATION).toEqual({
      [LEVEL_ONE_LOCATIONS.GOBLIN]: [CENSER],
      [LEVEL_ONE_LOCATIONS.FUNGAL]: [CARAPACE],
      [LEVEL_ONE_LOCATIONS.DESERTER]: [CLOAK],
    });
    const allPrimordials = [CENSER, CARAPACE, CLOAK];
    Object.values(LOCATION_LEVEL_ONE_EQUIPMENT).forEach(pool => {
      allPrimordials.forEach(name => expect(pool).not.toContain(name));
    });
  });
});

describe('location Primordial drop sources', () => {
  test('uses the exact source chances, with boss highest and Resource Rooms disabled', () => {
    expect(PRIMORDIAL_DROP_CHANCES).toEqual({
      ordinary: 0.0004,
      strong: 0.0015,
      cursed: 0.003,
      chest: 0.001,
      treasureRoom: 0.005,
      secretRoom: 0.006,
      boss: 0.035,
      resourceRoom: 0,
    });
    expect(PRIMORDIAL_DROP_CHANCES.boss).toBeGreaterThan(PRIMORDIAL_DROP_CHANCES.secretRoom);
    expect(PRIMORDIAL_DROP_CHANCES.ordinary).toBeLessThan(PRIMORDIAL_DROP_CHANCES.strong);
  });

  test.each([
    [LEVEL_ONE_LOCATIONS.GOBLIN, CENSER],
    [LEVEL_ONE_LOCATIONS.FUNGAL, CARAPACE],
    [LEVEL_ONE_LOCATIONS.DESERTER, CLOAK],
  ])('%s rolls only its owned Primordial across allowed sources', (location, expected) => {
    ['ordinary', 'strong', 'cursed', 'chest', 'treasureRoom', 'secretRoom', 'boss'].forEach(source => {
      expect(rollLocationPrimordial(location, source, () => 0)).toEqual({ name: expected, quantity: 1 });
    });
    expect(rollLocationPrimordial(location, 'resourceRoom', () => 0)).toBeNull();
  });

  test('chest and treasure entry points compose the location drop without contaminating Resource payloads', () => {
    expect(rollChestLoot(1, 1, { locationName: LEVEL_ONE_LOCATIONS.FUNGAL, rng: () => 0 }))
      .toContainEqual({ name: CARAPACE, quantity: 1 });
    expect(rollTreasureLoot(LEVEL_ONE_LOCATIONS.DESERTER, 1, 1, { primordialSource: 'treasureRoom', rng: () => 0 }))
      .toContainEqual({ name: CLOAK, quantity: 1 });
    expect(rollTreasureLoot(LEVEL_ONE_LOCATIONS.GOBLIN, 1, 1, { primordialSource: 'secretRoom', rng: () => 0 }))
      .toContainEqual({ name: CENSER, quantity: 1 });
    const resource = buildResourceRoomPayload({ locationName: LEVEL_ONE_LOCATIONS.FUNGAL, rng: () => 0 });
    expect(resource.loot.map(entry => entry.name)).not.toContain(CARAPACE);
  });

  test.each([
    ['ordinary', { rank: 'ordinary', cursed: false }],
    ['strong', { rank: 'strong', cursed: false }],
    ['cursed', { rank: 'miniBoss', cursed: true }],
    ['boss', { rank: 'boss', cursed: false }],
  ])('%s encounter victory uses the encounter Primordial layer', (_source, metadata) => {
    const roster = [{ rewardId: 'test', name: 'Враг', silverReward: 25, guaranteedLoot: [], ...metadata }];
    expect(resolveEncounterRewards({ roster, location: LEVEL_ONE_LOCATIONS.FUNGAL }, () => 0).items)
      .toContainEqual({ name: CARAPACE, quantity: 1 });
  });

  test('mixed authored enemies roll independently while summons never add rolls', () => {
    const authored = [
      { rewardId: 'ordinary', name: 'Обычный', rank: 'ordinary', silverReward: 25, guaranteedLoot: [] },
      { rewardId: 'strong', name: 'Сильный', rank: 'strong', silverReward: 25, guaranteedLoot: [] },
      { rewardId: 'cursed', name: 'Проклятый', rank: 'miniBoss', cursed: true, silverReward: 25, guaranteedLoot: [] },
    ];
    const summon = { rewardId: 'summon', name: 'Призыв', rank: 'boss', summoned: true, summonOnly: true, silverReward: 999, guaranteedLoot: [] };
    const reward = resolveEncounterRewards({ roster: [...authored, summon], location: LEVEL_ONE_LOCATIONS.FUNGAL }, () => 0);
    expect(reward.items.find(item => item.name === CARAPACE)).toEqual({ name: CARAPACE, quantity: 3 });
  });
});

describe('Demigod Serpent Carapace', () => {
  test('turns every Poison tick into normal capped healing instead of damage', () => {
    const wearer = unit('Защитник', { hp: 100, maxHp: 200, equipment: { armor: CARAPACE } });
    const poisoner = unit('Отравитель', { attack: 10 });
    addEffect(wearer, { id: 'poison', duration: 2 }, jest.fn(), poisoner);
    const damage = jest.fn();
    processEffects(wearer, jest.fn(), {
      applyDamage: damage,
      applyHealing: (target, amount) => {
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + amount);
        return target.hp - before;
      },
    });
    expect(damage).not.toHaveBeenCalled();
    expect(wearer.hp).toBe(109);
    wearer.hp = 195;
    processEffects(wearer, jest.fn(), {
      applyDamage: damage,
      applyHealing: (target, amount) => { const before = target.hp; target.hp = Math.min(target.maxHp, target.hp + amount); return target.hp - before; },
    });
    expect(wearer.hp).toBe(200);
    expect(wearer.shield || 0).toBe(0);
  });

  test('Poison applied by the wearer damages its target and does not heal the wearer', () => {
    const wearer = unit('Защитник', { hp: 50, equipment: { armor: CARAPACE } });
    const enemy = unit('Враг');
    addEffect(enemy, { id: 'poison', duration: 1 }, jest.fn(), wearer);
    processEffects(enemy, jest.fn(), {
      applyDamage: (target, amount) => { target.hp -= amount; return amount; },
      applyHealing: jest.fn(),
    });
    expect(enemy.hp).toBeLessThan(100);
    expect(wearer.hp).toBe(50);
  });

  test('a hostile direct hit against its Shield poisons the attacker, but periodic damage does not', () => {
    const wearer = unit('Защитник', { shield: 20, equipment: { armor: CARAPACE } });
    const attacker = unit('Нападающий');
    applyDamage(wearer, 5, 'physical', { source: attacker, directAttack: true, logFn: jest.fn() });
    expect(attacker.effects.filter(effect => effect.id === 'poison')).toHaveLength(1);

    const periodicAttacker = unit('Периодический источник');
    wearer.shield = 20;
    applyDamage(wearer, 5, 'physical', {
      source: periodicAttacker,
      directAttack: false,
      isPeriodic: true,
      fromEffect: 'poison',
      logFn: jest.fn(),
    });
    expect(periodicAttacker.effects).toHaveLength(0);
  });
});

describe('First Traitor Cloak and Betrayal', () => {
  test('the first crossing to 50% applies Betrayal without requiring owner direct damage and only once', () => {
    const owner = unit('Лучник', { equipment: { armor: CLOAK } });
    const target = unit('Цель', { hp: 60 });
    const ally = unit('Союзник');
    const session = { state: { players: [owner], enemies: [target, ally] } };
    applyDamage(target, 10, 'pure', { session, source: null, directAttack: false });
    expect(target.effects.filter(effect => effect.id === 'betrayal')).toHaveLength(1);
    cleanseEffects(target, effect => effect.id === 'betrayal');
    target.hp = 60;
    applyDamage(target, 10, 'pure', { session, source: null, directAttack: false });
    expect(target.effects.filter(effect => effect.id === 'betrayal')).toHaveLength(0);
  });

  test('redirects and consumes the next attack, but waits when the bearer has no living ally', () => {
    const traitor = unit('Предатель');
    const ally = unit('Случайный союзник');
    addEffect(traitor, { id: 'betrayal' }, jest.fn(), unit('Лучник'));
    const session = { state: { enemies: [traitor, ally] }, rng: () => 0 };
    expect(consumeBetrayalRedirectTarget(traitor, session, { name: 'Атака' }, 10)).toBe(ally);
    expect(traitor.effects.some(effect => effect.id === 'betrayal')).toBe(false);

    addEffect(traitor, { id: 'betrayal' }, jest.fn(), unit('Лучник'));
    ally.hp = 0;
    expect(consumeBetrayalRedirectTarget(traitor, session, { name: 'Атака' }, 10)).toBeNull();
    expect(traitor.effects.some(effect => effect.id === 'betrayal')).toBe(false);
  });

  test('does not apply to a solo or last remaining enemy', () => {
    const owner = unit('Лучник', { equipment: { armor: CLOAK } });
    const solo = unit('Одиночка', { hp: 60 });
    applyDamage(solo, 10, 'pure', { session: { state: { players: [owner], enemies: [solo] } } });
    expect(solo.effects.some(effect => effect.id === 'betrayal')).toBe(false);
  });
});
