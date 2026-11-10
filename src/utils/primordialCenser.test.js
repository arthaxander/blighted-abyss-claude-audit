import { equipmentByName } from '../data/equipment';
import { resolveItemArt } from '../data/itemArt';
import { EQUIPMENT_DETAILS } from '../data/itemDetailsPresentation';
import {
  LEVEL_ONE_LOCATIONS,
  LOCATION_LEVEL_ONE_EQUIPMENT,
  PRIMORDIAL_DROP_CHANCES,
  PRIMORDIAL_EQUIPMENT_BY_LOCATION,
} from '../data/levelOneLootOwnership';
import { MAGIC_SCHOOLS } from '../constants/magicSchools';
import {
  addEffect,
  cleanseEffects,
  EFFECT_LIBRARY,
  notifyEffectOwnerDeath,
  processEffects,
  removeRandomNegativeEffect,
} from './effects';
import { triggerEquipmentOnDirectDamage } from './combatUtils';
import { resolveEncounterRewards } from './encounterRewards';

const CENSER_NAME = 'Кадило Отца Костров';

const unit = (name, maxHp = 100) => ({
  name,
  hp: maxHp,
  maxHp,
  attack: 1,
  magAtk: 1,
  physDef: 0,
  magicDef: 0,
  effects: [],
});

const tick = (target, allies = []) => {
  const packets = [];
  processEffects(target, jest.fn(), {
    getAllies: () => allies,
    applyDamage: (recipient, amount, type, options) => {
      packets.push({ recipient, amount, type, options });
      recipient.hp = Math.max(0, recipient.hp - amount);
      return amount;
    },
  });
  return packets;
};

describe('Father of Bonfires Censer content and loot ownership', () => {
  test('defines the exact Primordial Magic Off-Hand and structured GameTerm presentation', () => {
    expect(equipmentByName[CENSER_NAME]).toMatchObject({
      id: 'father_of_bonfires_censer',
      class: 'Mage',
      type: 'MagicOffHand',
      rarity: 'Первозданная',
      stats: { magAtk: 8, magicDef: 8, speedPct: 0.05 },
      primordialEffectId: 'great_bonfire_flame',
    });
    expect(EQUIPMENT_DETAILS[CENSER_NAME].effectParts).toContainEqual({
      statusId: 'great_bonfire_flame',
      text: 'Пламя Великого Костра',
    });
    expect(resolveItemArt({ name: CENSER_NAME })).toContain('father_of_bonfires_censer.webp');
  });

  test('is the Goblin Nests Primordial and remains outside ordinary equipment pools', () => {
    expect(PRIMORDIAL_DROP_CHANCES.boss).toBe(0.035);
    expect(PRIMORDIAL_EQUIPMENT_BY_LOCATION).toEqual({
      [LEVEL_ONE_LOCATIONS.GOBLIN]: [CENSER_NAME],
      [LEVEL_ONE_LOCATIONS.FUNGAL]: ['Панцирь Змеиного Полубога'],
      [LEVEL_ONE_LOCATIONS.DESERTER]: ['Плащ Первого Предателя'],
    });
    Object.values(LOCATION_LEVEL_ONE_EQUIPMENT).forEach(pool => expect(pool).not.toContain(CENSER_NAME));

    const boss = [{ rewardId: 'boss', rank: 'boss', silverReward: 25, guaranteedLoot: [] }];
    const ordinary = [{ rewardId: 'ordinary', rank: 'ordinary', silverReward: 25, guaranteedLoot: [] }];
    expect(resolveEncounterRewards({ roster: boss, location: LEVEL_ONE_LOCATIONS.GOBLIN }, () => 0).items)
      .toContainEqual({ name: CENSER_NAME, quantity: 1 });
    expect(resolveEncounterRewards({ roster: ordinary, location: LEVEL_ONE_LOCATIONS.GOBLIN }, () => 0.9999).items)
      .not.toContainEqual(expect.objectContaining({ name: CENSER_NAME }));
    expect(resolveEncounterRewards({ roster: boss, location: LEVEL_ONE_LOCATIONS.FUNGAL }, () => 0.9999).items)
      .not.toContainEqual(expect.objectContaining({ name: CENSER_NAME }));
  });
});

describe('Great Bonfire Flame', () => {
  test('first eligible direct hit applies one Flame, while secondary packets and later hits do not', () => {
    const owner = unit('Элементалист');
    owner.id = 'hero';
    owner.magAtk = 20;
    owner.equipment = { offHand: CENSER_NAME };
    const first = unit('Первая цель');
    const second = unit('Вторая цель');
    const session = { state: { enemies: [first, second] } };

    triggerEquipmentOnDirectDamage({ attacker: owner, target: first, dealt: 10, session, ability: { name: 'Вторичный урон', isSecondaryDamage: true } });
    expect(first.effects).toHaveLength(0);
    triggerEquipmentOnDirectDamage({ attacker: owner, target: first, dealt: 10, session, ability: { name: 'Огненный шар' } });
    triggerEquipmentOnDirectDamage({ attacker: owner, target: second, dealt: 10, session, ability: { name: 'Огненный шар' } });

    expect(first.effects.filter(effect => effect.id === 'great_bonfire_flame')).toHaveLength(1);
    expect(second.effects.filter(effect => effect.id === 'great_bonfire_flame')).toHaveLength(0);
  });

  test('only canonical Burn ticks advance its uncapped 0.5x progression', () => {
    const source = unit('Владелец');
    source.magAtk = 20;
    const bearer = unit('Носитель', 1000);
    const effect = addEffect(bearer, {
      id: 'great_bonfire_flame',
      extra: { burnTicks: 0, lastKnownMagAtk: 20 },
    }, jest.fn(), source);

    expect(tick(bearer)[0]).toMatchObject({ amount: 10, type: 'magical', options: { magicSchool: MAGIC_SCHOOLS.FIRE } });
    expect(tick(bearer)[0].amount).toBe(10);
    addEffect(bearer, { id: 'burn' }, jest.fn(), source);
    tick(bearer);
    expect(effect.extra.burnTicks).toBe(1);
    effect.sourceRef = null;
    bearer.effects = bearer.effects.filter(entry => entry.id === 'great_bonfire_flame');
    expect(tick(bearer)[0].amount).toBe(20);
    expect(effect.extra.burnTicks).toBe(1);
    expect(effect.remainingTurns).toBeNull();
    expect(bearer.effects).toContain(effect);
  });

  test('is generically unremovable while one-effect and all-effect cleanses still remove normal debuffs', () => {
    const source = unit('Источник');
    const bearer = unit('Носитель');
    addEffect(bearer, { id: 'great_bonfire_flame' }, jest.fn(), source);
    addEffect(bearer, { id: 'poison' }, jest.fn(), source);

    expect(removeRandomNegativeEffect(bearer, () => 0)?.id).toBe('poison');
    expect(bearer.effects.map(effect => effect.id)).toEqual(['great_bonfire_flame']);
    expect(cleanseEffects(bearer, () => true)).toBe(0);
    expect(bearer.effects[0]).toMatchObject({ id: 'great_bonfire_flame', unremovable: true });
  });

  test('transfers the same progressing effect on bearer death and does not transfer without survivors', () => {
    const source = unit('Владелец');
    source.magAtk = 20;
    const first = unit('Первый', 1000);
    const second = unit('Второй', 1000);
    const effect = addEffect(first, { id: 'great_bonfire_flame', extra: { burnTicks: 3 } }, jest.fn(), source);
    first.hp = 0;
    notifyEffectOwnerDeath(first, [second], { rng: () => 0 });
    expect(first.effects).not.toContain(effect);
    expect(second.effects).toContain(effect);
    expect(tick(second)[0].amount).toBe(40);

    second.hp = 0;
    notifyEffectOwnerDeath(second, [], { rng: () => 0 });
    expect(second.effects).toContain(effect);
  });

  test('a lethal Flame tick does not re-add the transferred instance to its dead bearer', () => {
    const source = unit('Владелец');
    source.magAtk = 20;
    const first = unit('Первый', 10);
    const second = unit('Второй', 100);
    const effect = addEffect(first, { id: 'great_bonfire_flame' }, jest.fn(), source);

    processEffects(first, jest.fn(), {
      applyDamage: (recipient, amount) => {
        recipient.hp = Math.max(0, recipient.hp - amount);
        if (recipient.hp === 0) notifyEffectOwnerDeath(recipient, [second], { rng: () => 0 });
        return amount;
      },
    });

    expect(first.effects).not.toContain(effect);
    expect(second.effects).toEqual([effect]);
  });

  test('has a distinct identity and cannot satisfy ordinary Burn checks', () => {
    expect(EFFECT_LIBRARY.great_bonfire_flame.id).not.toBe(EFFECT_LIBRARY.burn.id);
    expect(EFFECT_LIBRARY.great_bonfire_flame.name).not.toBe(EFFECT_LIBRARY.burn.name);
    const bearer = unit('Носитель');
    addEffect(bearer, { id: 'great_bonfire_flame' }, jest.fn(), unit('Источник'));
    expect(bearer.effects.some(effect => effect.id === 'burn')).toBe(false);
  });
});

describe('canonical Burn splash', () => {
  test('uses the source snapshot plus bearer Max HP and spreads half of that base', () => {
    const source = unit('Пиромант');
    const burning = unit('A', 300);
    const allyB = unit('B', 200);
    const allyC = unit('C', 100);
    const dead = unit('Мёртвый', 400);
    dead.hp = 0;
    addEffect(burning, { id: 'burn', duration: 2 }, jest.fn(), source);

    const packets = tick(burning, [burning, allyB, allyC, dead]);
    expect(packets.map(packet => [packet.recipient.name, packet.amount])).toEqual([
      ['A', 10],
      ['B', 5],
      ['C', 5],
    ]);
    packets.forEach(packet => expect(packet).toMatchObject({
      type: 'magical',
      options: { magicSchool: MAGIC_SCHOOLS.FIRE },
    }));
    expect(burning.hp).toBe(290);
    expect(allyB.hp).toBe(195);
    expect(allyC.hp).toBe(95);
    expect(dead.hp).toBe(0);
    expect(burning.effects[0]).toMatchObject({ id: 'burn', remainingTurns: 1 });
    expect(EFFECT_LIBRARY.burn.description).toMatch(/50%.*3%/);
  });
});
