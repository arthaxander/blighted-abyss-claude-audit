import { equipmentByName } from '../data/equipment';
import {
  addEffect,
  getEffectStackCount,
  processEffects,
} from './effects';
import {
  applyDamage,
  applyHealing,
  applyItemInCombat,
  completeEntanglementTurn,
  handleShieldBreak,
  initCombatSession,
  performPlayerAction,
  processEnemyAI,
  triggerEquipmentOnDirectDamage,
} from './combatUtils';
import {
  createEmptyEquipmentSlots,
  equipInventoryItemForClass,
} from './equipmentManager';
import { reviveCombatSession, snapshotCombatSession } from '../components/CombatScreen';

const slots = overrides => ({
  helmet: null, armor: null, legs: null, mainHand: null, offHand: null,
  ring1: null, ring2: null, amulet: null, bag: null,
  ...(overrides || {}),
});

const attack = (name = 'Удар', extra = {}) => ({
  name,
  damage: 20,
  type: 'physical',
  targeting: 'enemy',
  cooldown: 0,
  accuracy: 1,
  ...extra,
});

const support = (name = 'Выждать') => ({
  name,
  damage: 0,
  type: 'support',
  targeting: 'self',
  cooldown: 0,
});

const player = (equipment, abilities = [attack()], extra = {}) => ({
  id: 'hero',
  name: 'Герой',
  class: 'Defender',
  hp: 100,
  maxHp: 100,
  attack: 30,
  magAtk: 20,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  critChance: 0,
  critDamage: 0.5,
  equipment: slots(equipment),
  abilities,
  items: [],
  currentLocation: 'Лес Увядания',
  ...extra,
});

const enemy = (id, extra = {}) => ({
  id,
  name: id,
  hp: 300,
  maxHp: 300,
  attack: 20,
  magAtk: 10,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  abilities: [attack('Атака', { basic: true })],
  location: 'Лес Увядания',
  ...extra,
});

const readyPlayerAgain = (session, turnMeter = 0) => {
  session.state.initiative.playerReady = true;
  session.state.turnState = {
    started: false,
    itemUsed: false,
    cooldownsProcessed: false,
    defeated: false,
    stunned: false,
  };
  session.state.players[0].turnMeter = turnMeter;
};

const effectContext = (session, target) => ({
  session,
  applyDamage: (unit, amount, type, extra = {}) =>
    applyDamage(unit, amount, type, { ...extra, session, logFn: () => {} }),
  applyHealing: (unit, amount, extra = {}) =>
    applyHealing(unit, amount, { ...extra, session, logFn: () => {} }),
  getAllies: () => (session.state.enemies || []).includes(target)
    ? session.state.enemies
    : session.state.players,
  getOpponents: () => (session.state.enemies || []).includes(target)
    ? session.state.players
    : session.state.enemies,
  log: () => {},
});

describe('Withering Forest equipment', () => {
  test('registers all 14 authored items with their approved stats and slots', () => {
    expect(equipmentByName['Лук вязких жил']).toMatchObject({
      type: 'Weapon', weaponType: 'bow', hands: 2, rarity: 'Редкая',
      stats: { attack: 26, critChance: 0.05 },
    });
    expect(equipmentByName['Фокус остановленного сока']).toMatchObject({
      type: 'Weapon', weaponType: 'focus', hands: 1, rarity: 'Редкая',
      stats: { magAtk: 19, speedPct: 0.05 },
    });
    expect(equipmentByName['Покров поздней весны']).toMatchObject({
      type: 'Armor', stats: { maxHp: 42, physDef: 16, speedPct: 0.05 },
    });
    expect(equipmentByName['Амулет горькой росы']).toMatchObject({
      type: 'Amulet', stats: { maxHp: 22, physDef: 5, magAtk: 5 },
    });
    expect(equipmentByName['Перстень цепкого плюща']).toMatchObject({
      type: 'Ring', stats: { magAtk: 6, speedPct: 0.05 },
    });
    expect(equipmentByName['Перстень живых шрамов']).toMatchObject({
      type: 'Ring', stats: { maxHp: 25, dodge: 0.05 },
    });
    expect(equipmentByName['Сосуд украденного прилива']).toMatchObject({
      type: 'MagicOffHand', stats: { maxHp: 18, magAtk: 7, magicDef: 7 },
    });
    expect(equipmentByName['Маска лесного часового']).toMatchObject({
      type: 'Helmet', rarity: 'Необычная',
      stats: { maxHp: 22, physDef: 10, critChance: 0.05 },
    });
    expect(equipmentByName['Щит цепких корней']).toMatchObject({
      type: 'Shield', stats: { physDef: 18, magicDef: 7 },
    });
    expect(equipmentByName['Сапоги проросшей тропы']).toMatchObject({
      type: 'Legs', stats: { physDef: 12, speedPct: 0.10 },
    });
    expect(equipmentByName['Кольцо опавшего часа']).toMatchObject({
      type: 'Ring', stats: { attack: 5, magicDef: 6 },
    });
    expect(equipmentByName['Амулет цепкой живицы']).toMatchObject({
      type: 'Amulet', rarity: 'Редкая',
      stats: { maxHp: 26, physDef: 5, magicDef: 5 },
    });
    expect(equipmentByName['Лук последнего цветения']).toMatchObject({
      type: 'Weapon', rarity: 'Эпическая',
      stats: { attack: 30, speedPct: 0.07, critChance: 0.07, dodge: 0.05 },
    });
    expect(equipmentByName['Венец Раны Великого Корня']).toMatchObject({
      type: 'Helmet', rarity: 'Первозданная',
      stats: { maxHp: 38, physDef: 15, magicDef: 10, speedPct: 0.06 },
    });
  });

  test('Clinging Resin Amulet gains 15% TM from Prepared Weapon and adds two Entanglement to a single-target prepared hit', () => {
    const session = initCombatSession(
      player(
        { amulet: 'Амулет цепкой живицы' },
        [attack()],
        { items: ['Настой горькой живицы'], turnMeter: 0 }
      ),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    session.state.initiative.playerReady = true;

    const used = applyItemInCombat(session, 'Настой горькой живицы');
    expect(used.itemUsed).toBe(true);
    expect(hero.turnMeter).toBe(150);

    performPlayerAction(session, 'Удар', 0);
    expect(getEffectStackCount(session.state.enemies[0], 'entanglement')).toBe(2);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'poison')).toBe(true);
  });

  test('Clinging Resin Amulet adds one Entanglement to each target of a prepared multi-target direct attack', () => {
    const sweep = attack('Размашистый удар', { targeting: 'allEnemies' });
    const session = initCombatSession(
      player(
        { amulet: 'Амулет цепкой живицы' },
        [sweep],
        { items: ['Настой горькой живицы'], turnMeter: 0 }
      ),
      [enemy('left'), enemy('right')]
    );
    session.state.initiative.playerReady = true;

    applyItemInCombat(session, 'Настой горькой живицы');
    performPlayerAction(session, 'Размашистый удар', 0);

    expect(getEffectStackCount(session.state.enemies[0], 'entanglement')).toBe(1);
    expect(getEffectStackCount(session.state.enemies[1], 'entanglement')).toBe(1);
  });

  test('Stolen Tide can pair with the school-neutral one-handed Stilled Sap Focus', () => {
    const state = createEmptyEquipmentSlots();
    state.mainHand = 'Фокус остановленного сока';
    const vessel = equipmentByName['Сосуд украденного прилива'];
    const result = equipInventoryItemForClass({
      playerClass: 'Elementalist',
      equipmentState: state,
      inventory: [vessel.name],
      item: vessel,
    });
    expect(result.canEquip).toBe(true);
    expect(result.equipment.offHand).toBe(vessel.name);
  });

  test('Viscous Vein poisons only its first successful hit, then steals up to 10% TM from pre-poisoned targets', () => {
    const session = initCombatSession(
      player({ mainHand: 'Лук вязких жил' }, [attack()], { class: 'Archer' }),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    session.state.initiative.playerReady = true;
    target.turnMeter = 250;
    performPlayerAction(session, 'Удар', 0);
    expect(target.effects.some(effect => effect.id === 'poison')).toBe(true);
    expect(target.turnMeter).toBe(250);

    readyPlayerAgain(session, 0);
    performPlayerAction(session, 'Удар', 0);
    expect(target.turnMeter).toBe(150);
    expect(hero.turnMeter).toBe(100);
  });

  test('Stilled Sap checks Slow before the action and keeps Slow/Poison cooldowns independent', () => {
    const session = initCombatSession(
      player({ mainHand: 'Фокус остановленного сока' }, [attack('Магический удар', { type: 'magical' })], { class: 'Elementalist' }),
      [enemy('target')]
    );
    const target = session.state.enemies[0];
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Магический удар', 0);
    expect(target.effects.some(effect => effect.id === 'sap_slow')).toBe(true);
    expect(target.effects.some(effect => effect.id === 'poison')).toBe(false);

    readyPlayerAgain(session);
    performPlayerAction(session, 'Магический удар', 0);
    expect(target.effects.some(effect => effect.id === 'poison')).toBe(true);
  });

  test('Late Spring triggers once below half HP and its own Regeneration ticks grant 8% TM', () => {
    const session = initCombatSession(
      player({ armor: 'Покров поздней весны' }, [support()], { hp: 100, maxHp: 100 }),
      [enemy('attacker')]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];
    applyDamage(hero, 60, 'physical', { source: foe, session, logFn: () => {} });
    const regen = hero.effects.find(effect => effect.id === 'regeneration');
    expect(regen).toBeTruthy();
    expect(regen.remainingTurns).toBe(2);

    readyPlayerAgain(session, 0);
    performPlayerAction(session, 'Выждать', 0);
    expect(hero.hp).toBe(55);
    expect(hero.turnMeter).toBe(80);
  });

  test('Bitter Dew heals once per owner turn from actual own-Poison damage and cuts poisoned-enemy healing by 30%', () => {
    const session = initCombatSession(
      player({ amulet: 'Амулет горькой росы' }, [attack()], { hp: 50, maxHp: 100 }),
      [enemy('target', { hp: 200, maxHp: 200 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'poison', duration: 2 }, () => {}, hero, { session });
    addEffect(target, { id: 'poison', duration: 2 }, () => {}, hero, { session });
    processEffects(target, () => {}, effectContext(session, target));
    expect(hero.hp).toBe(54);

    target.hp = 100;
    expect(applyHealing(target, 100, { source: target, session })).toBe(70);
    expect(target.hp).toBe(170);
  });

  test('Clinging Ivy adds two Entanglement to a pre-poisoned target and Sprouted Path pays tempo only once', () => {
    const session = initCombatSession(
      player({ ring1: 'Перстень цепкого плюща', legs: 'Сапоги проросшей тропы' }, [attack()]),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'poison', duration: 2 }, () => {}, hero, { session });
    readyPlayerAgain(session, 0);
    performPlayerAction(session, 'Удар', 0);
    expect(getEffectStackCount(target, 'entanglement')).toBe(2);
    expect(hero.turnMeter).toBe(100);
  });

  test('Living Scars primes only from real Regeneration healing and manually ticks exactly one own Poison without consuming duration', () => {
    const session = initCombatSession(
      player({ ring1: 'Перстень живых шрамов' }, [attack()], { hp: 50, maxHp: 100 }),
      [enemy('target', { hp: 200, maxHp: 200 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(hero, { id: 'regeneration', duration: 2 }, () => {}, hero, { session });
    addEffect(target, { id: 'poison', duration: 2 }, () => {}, hero, { session });

    readyPlayerAgain(session, 0);
    performPlayerAction(session, 'Удар', 0);
    expect(hero.hp).toBe(65);
    expect(target.hp).toBe(161);
    expect(target.effects.find(effect => effect.id === 'poison')?.remainingTurns).toBe(2);
    expect(hero._livingScarsReady).toBe(false);
  });

  test('Stolen Tide consumes one turn from pre-existing Slow on the primary magical target and grants Regeneration', () => {
    const session = initCombatSession(
      player({ mainHand: 'Треснувший учебный фокус', offHand: 'Сосуд украденного прилива' }, [
        attack('Магический удар', { type: 'magical' }),
      ], { class: 'Elementalist' }),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'sap_slow', duration: 2 }, () => {}, hero, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Магический удар', 0);
    expect(target.effects.find(effect => effect.id === 'sap_slow')?.remainingTurns).toBe(1);
    expect(hero.effects.some(effect => effect.id === 'regeneration' && effect.remainingTurns === 1)).toBe(true);
  });

  test('Forest Sentinel prepares from Haste, poisons on the next direct hit, and waits two target turns before re-arming', () => {
    const session = initCombatSession(
      player({ helmet: 'Маска лесного часового' }, [attack()]),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'speed_boost_minor', duration: 2 }, () => {}, target, { session });
    expect(hero._equipmentBattleFlags.forestSentinelPreparedTargetIds).toContain(target.id);

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Удар', 0);
    expect(target.effects.some(effect => effect.id === 'poison')).toBe(true);
    expect(hero._equipmentBattleFlags.forestSentinelPreparedTargetIds).not.toContain(target.id);

    addEffect(target, { id: 'speed_boost_minor', duration: 2 }, () => {}, target, { session });
    expect(hero._equipmentBattleFlags.forestSentinelPreparedTargetIds).not.toContain(target.id);
    completeEntanglementTurn(target, () => {}, session);
    completeEntanglementTurn(target, () => {}, session);
    addEffect(target, { id: 'speed_boost_minor', duration: 2 }, () => {}, target, { session });
    expect(hero._equipmentBattleFlags.forestSentinelPreparedTargetIds).toContain(target.id);
  });

  test('Forest Sentinel also prepares from a non-natural positive enemy TM change', () => {
    const tempoAbility = {
      name: 'Разгон',
      damage: 0,
      type: 'support',
      targeting: 'self',
      cooldown: 0,
      aiScore: () => 1000,
      apply: ({ attacker }) => {
        attacker.turnMeter = Math.min(1000, (attacker.turnMeter || 0) + 200);
      },
    };
    const session = initCombatSession(
      player({ helmet: 'Маска лесного часового' }, [attack()]),
      [enemy('tempo-target', { abilities: [tempoAbility] })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    target.turnMeter = 1000;
    hero.turnMeter = 0;
    processEnemyAI(session);
    expect(hero._equipmentBattleFlags.forestSentinelPreparedTargetIds).toContain(target.id);
  });

  test('Clinging Roots retaliates only on its first opponent-caused Shield break', () => {
    const session = initCombatSession(
      player({ offHand: 'Щит цепких корней' }, [attack()]),
      [enemy('attacker')]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];
    addEffect(hero, { id: 'shield', duration: 2, value: 10 }, () => {}, hero, { session });
    hero.shield = 0;
    handleShieldBreak(hero, { attacker: foe, session, directAttack: true, logFn: () => {} });
    expect(getEffectStackCount(foe, 'entanglement')).toBe(3);
    expect(hero.effects.some(effect => effect.id === 'regeneration')).toBe(true);
  });

  test('Fallen Hour transfers own Poison once on natural expiry and once on bearer death, while transferred Poison cannot spread again', () => {
    const session = initCombatSession(
      player({ ring1: 'Кольцо опавшего часа' }, [attack()]),
      [enemy('a'), enemy('b')]
    );
    const hero = session.state.players[0];
    const [a, b] = session.state.enemies;

    addEffect(a, { id: 'poison', duration: 1 }, () => {}, hero, { session });
    processEffects(a, () => {}, effectContext(session, a));
    let transferred = b.effects.filter(effect => effect.id === 'poison');
    expect(transferred).toHaveLength(1);
    expect(transferred[0].extra?.fallenHourTransferred).toBe(true);

    addEffect(a, { id: 'poison', duration: 2 }, () => {}, hero, { session });
    applyDamage(a, 9999, 'pure', { source: hero, session, logFn: () => {} });
    transferred = b.effects.filter(effect => effect.id === 'poison');
    expect(transferred).toHaveLength(2);

    // Both inherited poisons are explicitly marked as terminal transfers.
    transferred.forEach(effect => expect(effect.extra?.fallenHourTransferred).toBe(true));
    processEffects(b, () => {}, effectContext(session, b));
    expect(a.effects.filter(effect => effect.id === 'poison')).toHaveLength(1);
  });

  test('Sprouted Path gives no tempo when Entanglement is already capped and no charge is added', () => {
    const session = initCombatSession(
      player({ legs: 'Сапоги проросшей тропы' }, [attack()]),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'entanglement', stacks: 5 }, () => {}, hero, { session });
    hero.turnMeter = 0;
    addEffect(target, { id: 'entanglement', stacks: 1 }, () => {}, hero, { session });
    expect(getEffectStackCount(target, 'entanglement')).toBe(5);
    expect(hero.turnMeter).toBe(0);
  });

  test('Last Bloom adds at most one Seed per attacking action and only to the explicit primary target', () => {
    const heroData = player(
      { mainHand: 'Лук последнего цветения' },
      [attack('Залп', { targeting: 'allEnemies', damage: 10 })],
      { class: 'Archer' }
    );
    const session = initCombatSession(heroData, [enemy('primary'), enemy('secondary')]);
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Залп', 0);
    expect(getEffectStackCount(session.state.enemies[0], 'withering_seed')).toBe(1);
    expect(getEffectStackCount(session.state.enemies[1], 'withering_seed')).toBe(0);
  });

  test('Last Bloom consumes the third Seed into Poison, three Entanglement and owner Regeneration', () => {
    const session = initCombatSession(
      player({ mainHand: 'Лук последнего цветения' }, [attack()], { class: 'Archer' }),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    for (let index = 0; index < 3; index += 1) {
      triggerEquipmentOnDirectDamage({
        attacker: hero,
        target,
        dealt: 10,
        targetHpBeforeDamage: target.hp,
        session,
        ability: {},
        damageType: 'physical',
        deliberateAction: { primaryTargetId: target.id },
      });
    }

    expect(getEffectStackCount(target, 'withering_seed')).toBe(0);
    expect(getEffectStackCount(target, 'entanglement')).toBe(3);
    expect(target.effects.some(effect => effect.id === 'poison' && effect.remainingTurns === 2)).toBe(true);
    expect(hero.effects.some(effect => effect.id === 'regeneration' && effect.remainingTurns === 1)).toBe(true);
  });

  test('Last Bloom uses its 50% Physical Attack compensation against explicit Entanglement immunity', () => {
    const session = initCombatSession(
      player({ mainHand: 'Лук последнего цветения' }, [attack()], { class: 'Archer', attack: 30 }),
      [enemy('immune-target', { entanglementImmune: true, hp: 300, maxHp: 300 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    for (let index = 0; index < 3; index += 1) {
      triggerEquipmentOnDirectDamage({
        attacker: hero,
        target,
        dealt: 10,
        targetHpBeforeDamage: target.hp,
        session,
        ability: {},
        damageType: 'physical',
        deliberateAction: { primaryTargetId: target.id },
      });
    }
    expect(getEffectStackCount(target, 'entanglement')).toBe(0);
    expect(target.hp).toBe(285);
    expect(target.effects.some(effect => effect.id === 'poison')).toBe(true);
    expect(hero.effects.some(effect => effect.id === 'regeneration')).toBe(true);
  });

  test('Forest equipment battle flags and per-target Sentinel cooldown survive combat save/revive', () => {
    const fallbackPlayer = player({ helmet: 'Маска лесного часового' }, [attack()]);
    const fallbackEnemies = [enemy('target')];
    const session = initCombatSession(fallbackPlayer, fallbackEnemies);
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    addEffect(target, { id: 'speed_boost_minor', duration: 2 }, () => {}, target, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Удар', 0);
    expect(hero._equipmentBattleFlags.forestSentinelCooldownByTarget[target.id]).toBe(2);

    const snapshot = JSON.parse(JSON.stringify(snapshotCombatSession(session)));
    const restored = reviveCombatSession(snapshot, fallbackPlayer, fallbackEnemies);
    const restoredHero = restored.state.players[0];
    const restoredTarget = restored.state.enemies[0];
    expect(restoredHero._equipmentBattleFlags.forestSentinelCooldownByTarget[restoredTarget.id]).toBe(2);

    completeEntanglementTurn(restoredTarget, () => {}, restored);
    expect(restoredHero._equipmentBattleFlags.forestSentinelCooldownByTarget[restoredTarget.id]).toBe(1);
  });

  test('Fallen Hour still recognizes its Poison owner after sourceRef is stripped by a combat snapshot', () => {
    const fallbackPlayer = player({ ring1: 'Кольцо опавшего часа' }, [attack()]);
    const fallbackEnemies = [enemy('a'), enemy('b')];
    const session = initCombatSession(fallbackPlayer, fallbackEnemies);
    const hero = session.state.players[0];
    addEffect(session.state.enemies[0], { id: 'poison', duration: 1 }, () => {}, hero, { session });

    const snapshot = JSON.parse(JSON.stringify(snapshotCombatSession(session)));
    const restored = reviveCombatSession(snapshot, fallbackPlayer, fallbackEnemies);
    const [a, b] = restored.state.enemies;
    processEffects(a, () => {}, effectContext(restored, a));
    expect(b.effects.some(effect => effect.id === 'poison' && effect.extra?.fallenHourTransferred)).toBe(true);
  });

  test('Great Root Crown applies Plague, caps Poison-tick tempo at 50%, and chains death payload from snapshotted attack', () => {
    const session = initCombatSession(
      player({ helmet: 'Венец Раны Великого Корня' }, [attack()], { attack: 30, magAtk: 20 }),
      [enemy('a'), enemy('b')]
    );
    const hero = session.state.players[0];
    const [a, b] = session.state.enemies;
    expect(a.effects.some(effect => effect.id === 'great_root_plague')).toBe(true);
    expect(b.effects.some(effect => effect.id === 'great_root_plague')).toBe(true);

    for (let index = 0; index < 4; index += 1) {
      addEffect(a, { id: 'poison', duration: 2 }, () => {}, hero, { session });
    }
    processEffects(a, () => {}, effectContext(session, a));
    expect(hero.turnMeter).toBe(500);

    const hpBefore = b.hp;
    applyDamage(a, 9999, 'pure', { source: hero, session, logFn: () => {} });
    expect(b.effects.filter(effect => effect.id === 'poison')).toHaveLength(2);
    expect(b.hp).toBe(hpBefore - 30);
  });
});
