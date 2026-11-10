import { equipmentByName } from '../data/equipment';
import { createAbilityByName, reduceHostileTurnMeter } from '../data/abilityPresets';
import { addEffect, getEffectStackCount } from './effects';
import {
  applyDamage,
  applyItemInCombat,
  initCombatSession,
  performPlayerAction,
  processEnemyAI,
  notifyFriendlyTemporarySummonDisappeared,
  createRoyalExecutioner,
  triggerArcherTrap,
  triggerEquipmentOnDirectDamage,
} from './combatUtils';

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

const player = (equipment, extra = {}) => ({
  id: 'hero',
  name: 'Герой',
  class: 'Defender',
  hp: 200,
  maxHp: 200,
  attack: 30,
  magAtk: 20,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  critChance: 0,
  critDamage: 0.5,
  equipment: slots(equipment),
  abilities: [attack()],
  items: [],
  currentLocation: 'Руины Неупокоенных',
  ...extra,
});

const enemy = (id = 'target', extra = {}) => ({
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
  location: 'Руины Неупокоенных',
  ...extra,
});

describe('Restless Ruins equipment: first runtime slice', () => {
  test('registers the first three approved Ruins items', () => {
    expect(equipmentByName['Гладиус незаживших ран']).toMatchObject({
      type: 'Weapon', weaponType: 'sword', hands: 1, rarity: 'Редкая',
      stats: { attack: 21, maxHp: 16 },
    });
    expect(equipmentByName['Лук сорванного построения']).toMatchObject({
      type: 'Weapon', weaponType: 'bow', hands: 2, rarity: 'Редкая',
      stats: { attack: 28, maxHp: 20, speedPct: 0.05 },
    });
    expect(equipmentByName['Щит неумолкшего марша']).toMatchObject({
      type: 'Shield', rarity: 'Редкая',
      stats: { maxHp: 18, physDef: 19, magicDef: 6 },
    });
    expect(equipmentByName['Зеркало третьего голоса']).toMatchObject({
      type: 'MagicOffHand', offHandKind: 'magic', rarity: 'Редкая',
      stats: { maxHp: 18, magAtk: 9, magicDef: 9 },
    });
    expect(equipmentByName['Амулет последнего отзвука']).toMatchObject({
      type: 'Amulet', rarity: 'Эпическая',
      stats: { maxHp: 30, magicDef: 7, speedPct: 0.06 },
    });
  });

  test('Unhealed Wounds stores 30% of direct HP damage up to owner Attack and releases it once on the next primary direct hit', () => {
    const session = initCombatSession(
      player({ mainHand: 'Гладиус незаживших ран' }),
      [enemy()]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    applyDamage(hero, 20, 'physical', {
      source: target,
      session,
      logFn: () => {},
      directAttack: true,
      deliberateAction: { actorId: target.id, primaryTargetId: hero.id },
    });
    expect(hero._unhealedWoundsStored).toBe(6);

    const action = { actorId: hero.id, primaryTargetId: target.id };
    const hpBefore = target.hp;
    triggerEquipmentOnDirectDamage({
      attacker: hero,
      target,
      dealt: 10,
      absorbed: 0,
      targetHpBeforeDamage: hpBefore,
      session,
      logFn: () => {},
      ability: attack(),
      damageType: 'physical',
      deliberateAction: action,
    });

    expect(hero._unhealedWoundsStored).toBe(0);
    expect(target.hp).toBe(hpBefore - 6);

    triggerEquipmentOnDirectDamage({
      attacker: hero,
      target,
      dealt: 10,
      absorbed: 0,
      targetHpBeforeDamage: target.hp,
      session,
      logFn: () => {},
      ability: attack(),
      damageType: 'physical',
      deliberateAction: action,
    });
    expect(target.hp).toBe(hpBefore - 6);
  });

  test('Unhealed Wounds stores only HP actually lost before Last Stand recovery', () => {
    const session = initCombatSession(
      player(
        { mainHand: 'Гладиус незаживших ран' },
        {
          hp: 10,
          maxHp: 200,
          equippedClassPassiveIds: ['last_stand'],
        }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];

    applyDamage(hero, 100, 'physical', {
      source: foe,
      session,
      logFn: () => {},
      directAttack: true,
      deliberateAction: { actorId: foe.id, primaryTargetId: hero.id },
    });

    expect(hero.hp).toBeGreaterThan(0);
    expect(hero._lastStandConsumed).toBe(true);
    expect(hero._unhealedWoundsStored).toBe(3);
  });

  test('Broken Formation steals Shield before the arrow, capped at 15% owner max HP', () => {
    const session = initCombatSession(
      player({ mainHand: 'Лук сорванного построения' }, { class: 'Archer', hp: 100, maxHp: 100 }),
      [enemy()]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'shield', duration: 2, value: 100 }, () => {}, target, { session });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Удар', 0);

    expect(hero.shield).toBe(15);
    expect(target.lastAbsorbed).toBe(20);
    expect(target.shield).toBe(65);
  });


  test('Surviving Standard-Bearer boosts only a defensive class ability after starting the turn with Shield', () => {
    const session = initCombatSession(
      player(
        { armor: 'Кираса уцелевшего знаменосца' },
        { abilities: [createAbilityByName('Стойкость')] }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    addEffect(hero, { id: 'shield', duration: 2, value: 20 }, () => {}, hero, { session });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Стойкость', 0);

    // Existing 20 Shield + 35% max HP (70) * 1.25 = 88.
    expect(hero.shield).toBe(108);
    expect(hero._survivingStandardBearerReady).toBe(false);
  });

  test('Surviving Standard-Bearer does not arm when the owner begins the turn without Shield', () => {
    const session = initCombatSession(
      player(
        { armor: 'Кираса уцелевшего знаменосца' },
        { abilities: [createAbilityByName('Стойкость')] }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Стойкость', 0);

    expect(hero.shield).toBe(70);
  });

  test('Burial Formation grants 12% max-HP Shield when an Archer trap disappears and only once per owner turn', () => {
    const session = initCombatSession(
      player(
        { ring1: 'Перстень погребального строя' },
        { class: 'Archer', hp: 200, maxHp: 200 }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    hero._armedTrap = { type: 'snake_trap' };
    expect(triggerArcherTrap(hero, target, session, () => {})).toBe(true);
    expect(hero.shield).toBe(24);

    hero._armedTrap = { type: 'wolf_pit' };
    expect(triggerArcherTrap(hero, target, session, () => {})).toBe(true);
    expect(hero.shield).toBe(24);
  });


  test('Eternal Sentinel marks the first direct attacker and reduces the whole next attacking action by 30%', () => {
    const combo = attack('Серия ударов', { damage: 20, hitCount: 2, basic: true });
    const session = initCombatSession(
      player({ helmet: 'Шлем вечного часового' }),
      [enemy('attacker', { abilities: [combo] })],
      { rng: () => 0.99 }
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];

    hero.turnMeter = 999;
    foe.turnMeter = 1000;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);
    expect(hero.hp).toBe(160);
    expect(hero._eternalSentinelMarkedAttackerId).toBe(foe.id);

    hero.turnMeter = 0;
    foe.turnMeter = 1000;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);
    expect(hero.hp).toBe(132);
    expect(hero._eternalSentinelMarkedAttackerId).toBeNull();
    expect(hero._eternalSentinelCooldown).toBe(1);
  });

  test('Broken March halves only the first hostile turn-meter reduction and grants one 10% max-HP Shield', () => {
    const session = initCombatSession(
      player({ legs: 'Поножи сбитого марша' }),
      [enemy()]
    );
    const hero = session.state.players[0];
    hero.turnMeter = 500;

    const firstLoss = reduceHostileTurnMeter(hero, 150, { session, log: () => {} });
    expect(firstLoss).toBe(75);
    expect(hero.turnMeter).toBe(425);
    expect(hero.shield).toBe(20);

    const secondLoss = reduceHostileTurnMeter(hero, 150, { session, log: () => {} });
    expect(secondLoss).toBe(150);
    expect(hero.turnMeter).toBe(275);
    expect(hero.shield).toBe(20);
  });

  test('Burial Watch primes after a non-attacking class ability and heals once from the next primary direct hit', () => {
    const supportAbility = {
      name: 'Построение',
      damage: 0,
      type: 'support',
      targeting: 'self',
      cooldown: 0,
    };
    const session = initCombatSession(
      player(
        { armor: 'Мундир погребального дозора' },
        { hp: 100, maxHp: 200, abilities: [supportAbility, attack()] }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Построение', 0);
    expect(hero._burialWatchUniformReady).toBe(true);

    session.state.initiative.playerReady = true;
    session.state.turnState = {
      started: false,
      itemUsed: false,
      cooldownsProcessed: false,
      defeated: false,
      stunned: false,
    };
    performPlayerAction(session, 'Удар', 0);

    expect(hero.hp).toBe(104);
    expect(hero._burialWatchUniformReady).toBe(false);
  });


  test('Burial Watch heals from actual HP lost on an overkill hit', () => {
    const supportAbility = {
      name: 'Построение',
      damage: 0,
      type: 'support',
      targeting: 'self',
      cooldown: 0,
    };
    const session = initCombatSession(
      player(
        { armor: 'Мундир погребального дозора' },
        { hp: 100, maxHp: 200, abilities: [supportAbility, attack()] }
      ),
      [enemy('fragile', { hp: 5, maxHp: 5 })]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Построение', 0);

    session.state.initiative.playerReady = true;
    session.state.turnState = {
      started: false,
      itemUsed: false,
      cooldownsProcessed: false,
      defeated: false,
      stunned: false,
    };
    performPlayerAction(session, 'Удар', 0);

    expect(session.state.enemies[0].hp).toBe(0);
    expect(hero.hp).toBe(101);
    expect(hero._burialWatchUniformReady).toBe(false);
  });

  test('Allking Signet uses the item action, summons the scaled Executioner, and its second own turn ends the summon', () => {
    const session = initCombatSession(
      player(
        { ring1: 'Печатка Всецаря', ring2: 'Перстень погребального строя' },
        {
          hp: 200,
          maxHp: 200,
          attack: 30,
          magAtk: 20,
          physDef: 40,
          magicDef: 20,
        }
      ),
      [enemy('target', { hp: 100, maxHp: 300, attack: 0, speed: 1 })],
      { rng: () => 0.99 }
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'shield', duration: 3, value: 20 }, () => {}, target, { session });

    session.state.initiative.playerReady = true;
    const use = applyItemInCombat(session, 'Печатка Всецаря');

    expect(use).toMatchObject({ itemUsed: true, turnConsumed: false, activeEquipment: true });
    expect(hero.items).toHaveLength(0);
    expect(hero._allkingSignetCooldown).toBe(4);

    const executioner = session.state.players.find(unit => unit?.summonKind === 'royal_executioner');
    expect(executioner).toMatchObject({
      name: 'Королевский палач',
      maxHp: 100,
      hp: 100,
      attack: 30,
      physDef: 30,
      magicDef: 15,
      speed: 120,
      turnMeter: 500,
      _temporaryOwnTurnsRemaining: 2,
    });
    expect(target.effects.some(effect => effect.id === 'provoked')).toBe(true);

    session.state.initiative.playerReady = false;
    hero.turnMeter = 0;
    executioner.turnMeter = 1000;
    target.turnMeter = 0;
    processEnemyAI(session);

    expect(target.shield).toBe(0);
    expect(target.hp).toBe(64);
    expect(executioner._temporaryOwnTurnsRemaining).toBe(1);

    session.state.initiative.playerReady = false;
    hero.turnMeter = 0;
    executioner.turnMeter = 1000;
    target.turnMeter = 0;
    processEnemyAI(session);

    expect(target.hp).toBe(2);
    expect(executioner.hp).toBe(0);
    expect(executioner._temporaryOwnTurnsRemaining).toBe(0);
    expect(hero.shield).toBe(24);
  });

  test('Allking Signet cannot summon another Executioner while the first is alive even if its cooldown is forced ready', () => {
    const session = initCombatSession(
      player({ ring1: 'Печатка Всецаря' }),
      [enemy()]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    expect(applyItemInCombat(session, 'Печатка Всецаря').itemUsed).toBe(true);

    hero._allkingSignetCooldown = 0;
    session.state.turnState.itemUsed = false;
    const second = applyItemInCombat(session, 'Печатка Всецаря');
    expect(second.itemUsed).toBe(false);
    expect(session.state.players.filter(unit => unit?.hp > 0 && unit?.summonKind === 'royal_executioner')).toHaveLength(1);
  });


  test('Third Voice Mirror primes after three non-damaging class abilities and Echoes the next attacking class ability', () => {
    const supportAbility = {
      name: 'Тихий приказ',
      damage: 0,
      type: 'support',
      targeting: 'self',
      cooldown: 0,
    };
    const strike = attack('Удар третьего голоса', { damage: 40, cooldown: 0 });
    const session = initCombatSession(
      player(
        { offHand: 'Зеркало третьего голоса' },
        { abilities: [supportAbility, strike] }
      ),
      [enemy('target', { hp: 300, maxHp: 300, speed: 1 })]
    );
    const hero = session.state.players[0];
    const ready = () => {
      session.state.initiative.playerReady = true;
      session.state.turnState = {
        started: false, itemUsed: false, cooldownsProcessed: false, defeated: false, stunned: false,
      };
    };

    for (let use = 0; use < 3; use += 1) {
      ready();
      performPlayerAction(session, 'Тихий приказ', 0);
    }
    expect(getEffectStackCount(hero, 'third_voice_ready')).toBe(1);
    expect(getEffectStackCount(hero, 'ruins_echo_charge')).toBe(0);

    ready();
    performPlayerAction(session, 'Тихий приказ', 0);
    expect(getEffectStackCount(hero, 'third_voice_ready')).toBe(1);

    ready();
    performPlayerAction(session, 'Удар третьего голоса', 0);
    expect(getEffectStackCount(hero, 'third_voice_ready')).toBe(0);
    expect(hero._pendingRuinsEcho?.abilityName).toBe('Удар третьего голоса');
  });

  test('Two Voices starts with one Echo charge and repeats class damage next owner turn as 40% Death magic', () => {
    const echoStrike = attack('Эхо-удар', {
      damage: 50,
      type: 'magical',
      school: 'fire',
      cooldown: 0,
    });
    const session = initCombatSession(
      player(
        { mainHand: 'Посох двух голосов' },
        { class: 'Mage', magAtk: 50, abilities: [echoStrike] }
      ),
      [enemy('target', { hp: 300, maxHp: 300, speed: 1 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    expect(getEffectStackCount(hero, 'ruins_echo_charge')).toBe(1);

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Эхо-удар', 0);

    expect(target.hp).toBe(250);
    expect(getEffectStackCount(hero, 'ruins_echo_charge')).toBe(0);
    expect(hero._pendingRuinsEcho?.abilityName).toBe('Эхо-удар');

    hero.turnMeter = 1000;
    target.turnMeter = 0;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);

    expect(target.hp).toBe(230);
    expect(hero._pendingRuinsEcho).toBeUndefined();
  });

  test('Echo repeats only 40% of class Shield while keeping its normal duration', () => {
    const ward = {
      name: 'Эхо-щит',
      damage: 0,
      type: 'support',
      targeting: 'self',
      cooldown: 0,
      apply: ({ attacker, session, log }) =>
        addEffect(attacker, { id: 'shield', duration: 3, value: 50 }, log, attacker, { session }),
    };
    const session = initCombatSession(
      player(
        { mainHand: 'Посох двух голосов' },
        { class: 'Mage', abilities: [ward] }
      ),
      [enemy('target', { speed: 1 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Эхо-щит', 0);
    expect(hero.shield).toBe(50);

    hero.turnMeter = 1000;
    target.turnMeter = 0;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);

    expect(hero.shield).toBe(70);
    const echoShield = hero.effects
      .filter(effect => effect.id === 'shield')
      .find(effect => effect.appliedShield === 20);
    expect(echoShield?.remainingTurns).toBe(3);
  });

  test('Unsung Medallion grants one Echo charge only for the first successfully applied hostile debuff', () => {
    const session = initCombatSession(
      player({ amulet: 'Медальон неотпетого' }),
      [enemy('caster')]
    );
    const hero = session.state.players[0];
    const caster = session.state.enemies[0];

    expect(addEffect(hero, { id: 'poison', duration: 2 }, () => {}, caster, { session })).toBeTruthy();
    expect(getEffectStackCount(hero, 'ruins_echo_charge')).toBe(1);

    expect(addEffect(hero, { id: 'blind', duration: 2 }, () => {}, caster, { session })).toBeTruthy();
    expect(getEffectStackCount(hero, 'ruins_echo_charge')).toBe(1);
  });


  test('Foreign Shift primes on a basic attack and reduces the next real nonbasic cooldown before a two-turn lockout', () => {
    const basic = attack('Атака', { basic: true, cooldown: 0 });
    const skill = {
      name: 'Манёвр',
      damage: 0,
      type: 'support',
      targeting: 'self',
      cooldown: 3,
    };
    const session = initCombatSession(
      player({ ring1: 'Кольцо чужой смены' }, { abilities: [basic, skill] }),
      [enemy()]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Атака', 0);
    expect(hero._foreignShiftPrimed).toBe(true);

    session.state.initiative.playerReady = true;
    session.state.turnState = {
      started: false, itemUsed: false, cooldownsProcessed: false, defeated: false, stunned: false,
    };
    performPlayerAction(session, 'Манёвр', 0);

    expect(hero.abilities.find(entry => entry.name === 'Манёвр').currentCooldown).toBe(2);
    expect(hero._foreignShiftPrimed).toBe(false);
    expect(hero._foreignShiftCooldown).toBe(3);
  });

  test('Last Rank grants one Combat Rhythm after two successful direct attacks on the same primary target and resets on target switch', () => {
    const basic = attack('Атака', { basic: true, cooldown: 0 });
    const session = initCombatSession(
      player({ ring1: 'Перстень последней шеренги' }, { abilities: [basic] }),
      [enemy('a'), enemy('b')]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Атака', 0);
    expect(getEffectStackCount(hero, 'combat_rhythm')).toBe(0);

    session.state.initiative.playerReady = true;
    session.state.turnState = {
      started: false, itemUsed: false, cooldownsProcessed: false, defeated: false, stunned: false,
    };
    performPlayerAction(session, 'Атака', 1);
    expect(getEffectStackCount(hero, 'combat_rhythm')).toBe(0);

    session.state.initiative.playerReady = true;
    session.state.turnState = {
      started: false, itemUsed: false, cooldownsProcessed: false, defeated: false, stunned: false,
    };
    performPlayerAction(session, 'Атака', 1);
    expect(getEffectStackCount(hero, 'combat_rhythm')).toBe(1);
  });


  test('Last Rank loses its streak when a direct attack misses after switching targets', () => {
    const basic = attack('Атака', { basic: true, cooldown: 0 });
    const session = initCombatSession(
      player({ ring1: 'Перстень последней шеренги' }, { abilities: [basic] }),
      [enemy('a'), enemy('b')]
    );
    const hero = session.state.players[0];
    const [a, b] = session.state.enemies;

    const act = targetIndex => {
      session.state.initiative.playerReady = true;
      session.state.turnState = {
        started: false, itemUsed: false, cooldownsProcessed: false, defeated: false, stunned: false,
      };
      performPlayerAction(session, 'Атака', targetIndex);
    };

    session.rng = () => 0;
    act(0);
    expect(hero._lastRankRingTargetId).toBe(a.id);
    expect(hero._lastRankRingCount).toBe(1);

    b.statAdditives = { ...(b.statAdditives || {}), dodgeBonus: 0.95 };
    session.rng = () => 0.99;
    act(1);
    expect(hero._lastRankRingTargetId).toBe(b.id);
    expect(hero._lastRankRingCount).toBe(0);

    b.statAdditives.dodgeBonus = 0;
    session.rng = () => 0;
    act(0);
    expect(getEffectStackCount(hero, 'combat_rhythm')).toBe(0);
    expect(hero._lastRankRingCount).toBe(1);

    act(0);
    expect(getEffectStackCount(hero, 'combat_rhythm')).toBe(1);
  });

  test('Last Echo recreates an Archer trap only after the original fully resolves and never copies its own copy', () => {
    const session = initCombatSession(
      player(
        { amulet: 'Амулет последнего отзвука' },
        { class: 'Archer' }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    hero._armedTrap = { type: 'snake_trap' };
    expect(triggerArcherTrap(hero, target, session, () => {})).toBe(true);
    expect(hero._lastEchoAmuletUsed).toBe(true);
    expect(hero._armedTrap).toEqual({ type: 'snake_trap', lastEchoCopy: true });

    target.hp = 300;
    expect(triggerArcherTrap(hero, target, session, () => {})).toBe(true);
    expect(hero._armedTrap).toBeNull();
  });

  test('Last Echo recreates Royal Executioner from its generic summon template with full lifetime and fresh taunt', () => {
    const session = initCombatSession(
      player({ amulet: 'Амулет последнего отзвука' }),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    const original = createRoyalExecutioner(hero, {
      id: 'vanished-executioner',
    });
    original.maxHp = 100;
    original.hp = 100;
    original.attack = 30;
    original.physDef = 24;
    original.magicDef = 12;
    original.baseStats = { maxHp: 100, attack: 30, magAtk: 0, physDef: 24, magicDef: 12, speed: 120 };
    const template = {
      ...original._summonTemplate,
      snapshot: {
        ...original._summonTemplate.snapshot,
        maxHp: 100,
        attack: 30,
        physDef: 24,
        magicDef: 12,
        baseStats: { maxHp: 100, attack: 30, magAtk: 0, physDef: 24, magicDef: 12, speed: 120 },
      },
    };

    notifyFriendlyTemporarySummonDisappeared(hero, session, () => {}, {
      kind: original.summonKind,
      reason: 'duration',
      template,
      temporary: true,
      lastEchoCopy: false,
    });

    const copy = session.state.players.find(unit => unit?.summonKind === 'royal_executioner');
    expect(copy).toMatchObject({
      maxHp: 100,
      hp: 100,
      attack: 30,
      physDef: 24,
      magicDef: 12,
      speed: 120,
      turnMeter: 500,
      _temporaryOwnTurnsRemaining: 2,
      _lastEchoCopy: true,
    });
    expect(target.effects.some(effect => effect.id === 'provoked')).toBe(true);

    const countBefore = session.state.players.filter(unit => unit?.summonKind === 'royal_executioner').length;
    notifyFriendlyTemporarySummonDisappeared(hero, session, () => {}, {
      kind: copy.summonKind,
      reason: 'duration',
      template: copy._summonTemplate,
      temporary: true,
      lastEchoCopy: true,
    });
    expect(session.state.players.filter(unit => unit?.summonKind === 'royal_executioner')).toHaveLength(countBefore);
  });

  test('Last Echo also recreates a permanent summoned unit without a summon-specific branch', () => {
    const summon = createAbilityByName('Призыв элементаля');
    const session = initCombatSession(
      player(
        { amulet: 'Амулет последнего отзвука', ring1: 'Перстень погребального строя' },
        {
          class: 'Mage',
          abilities: [summon],
          hp: 200,
          maxHp: 200,
          attack: 30,
          magAtk: 50,
          physDef: 20,
          magicDef: 20,
        }
      ),
      [enemy('target', { hp: 500, maxHp: 500 })]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Призыв элементаля', 0);

    const original = session.state.players.find(unit => unit?.summonKind === 'fire_elemental' && unit.hp > 0);
    expect(original).toBeTruthy();
    expect(original.temporarySummon).not.toBe(true);
    expect(original._summonTemplate?.form).toBe('unit');

    applyDamage(original, original.maxHp + 100, 'pure', {
      source: session.state.enemies[0],
      session,
      logFn: () => {},
      directAttack: true,
      deliberateAction: { actorId: 'target', primaryTargetId: original.id },
    });

    const copies = session.state.players.filter(unit => unit?.summonKind === 'fire_elemental' && unit.hp > 0);
    expect(copies).toHaveLength(1);
    expect(copies[0]).not.toBe(original);
    expect(copies[0]).toMatchObject({
      hp: copies[0].maxHp,
      summonKind: 'fire_elemental',
      summoned: true,
      _lastEchoCopy: true,
    });
    expect(copies[0].effects).toHaveLength(0);
    expect(hero.shield || 0).toBe(0);
  });

  test('Unrelenting March grants 15% turn meter once while Shield absorbs a direct enemy attack', () => {
    const session = initCombatSession(
      player({ offHand: 'Щит неумолкшего марша' }),
      [enemy()]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];
    addEffect(hero, { id: 'shield', duration: 2, value: 50 }, () => {}, hero, { session });

    applyDamage(hero, 20, 'physical', {
      source: foe,
      session,
      logFn: () => {},
      directAttack: true,
      deliberateAction: { actorId: foe.id, primaryTargetId: hero.id },
    });
    expect(hero.turnMeter).toBe(150);

    applyDamage(hero, 20, 'physical', {
      source: foe,
      session,
      logFn: () => {},
      directAttack: true,
      deliberateAction: { actorId: foe.id, primaryTargetId: hero.id, sequence: 2 },
    });
    expect(hero.turnMeter).toBe(150);
  });
});
