import { equipmentByName } from '../data/equipment';
import { addEffect } from './effects';
import {
  TURN_METER_THRESHOLD,
  applyDamage,
  applyItemInCombat,
  handleShieldBreak,
  initCombatSession,
  performPlayerAction,
  processEnemyAI,
  triggerEquipmentOnDirectDamage,
} from './combatUtils';

const slots = overrides => ({
  helmet: null, armor: null, mainHand: null, offHand: null,
  legs: null, ring1: null, ring2: null, amulet: null, bag: null,
  ...(overrides || {}),
});

const player = (equipment, abilities = [], extra = {}) => ({
  id: 'hero',
  name: 'Герой',
  class: 'Defender',
  hp: 300,
  maxHp: 300,
  attack: 30,
  magAtk: 20,
  physDef: 20,
  magicDef: 10,
  speed: 100,
  critChance: 0,
  critDamage: 0.5,
  equipment: slots(equipment),
  abilities,
  items: [],
  currentLocation: 'Лес Увядания',
  ...extra,
});

const enemy = (id, abilities = [], extra = {}) => ({
  id,
  name: id,
  hp: 300,
  maxHp: 300,
  attack: 20,
  magAtk: 10,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  abilities,
  location: 'Лес Увядания',
  ...extra,
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

const support = (name = 'Подготовка', extra = {}) => ({
  name,
  damage: 0,
  type: 'support',
  targeting: 'self',
  cooldown: 0,
  ...extra,
});

const readyPlayerAgain = session => {
  session.state.initiative.playerReady = true;
  session.state.turnState = { started: false, itemUsed: false, cooldownsProcessed: false, defeated: false, stunned: false };
  session.state.players[0].turnMeter = TURN_METER_THRESHOLD;
};

describe('Abyss level-two common equipment', () => {
  test('all ten common definitions use the approved stats and rarities', () => {
    expect(equipmentByName['Клинок должника']).toMatchObject({ rarity: 'Редкая', stats: { attack: 17, maxHp: 12 } });
    expect(equipmentByName['Жезл встречных формул']).toMatchObject({ rarity: 'Редкая', weaponType: 'wand', stats: { magAtk: 14, maxHp: 12 } });
    expect(equipmentByName['Лук пристрелки']).toMatchObject({ rarity: 'Редкая', hands: 2, stats: { attack: 22, speedPct: 0.05, critChance: 0.05 } });
    expect(equipmentByName['Щит третьей заплаты']).toMatchObject({ rarity: 'Редкая', stats: { maxHp: 24, physDef: 17 } });
    expect(equipmentByName['Шлем чужого сигнала']).toMatchObject({ rarity: 'Редкая', stats: { maxHp: 26, physDef: 11, speedPct: 0.05 } });
    expect(equipmentByName['Кираса последнего в строю']).toMatchObject({ rarity: 'Редкая', stats: { maxHp: 46, physDef: 17, magicDef: 7 } });
    expect(equipmentByName['Куртка сорванного ритуала']).toMatchObject({ rarity: 'Редкая', stats: { maxHp: 42, physDef: 15, magicDef: 10 } });
    expect(equipmentByName['Обруч незаконченного приказа']).toMatchObject({ rarity: 'Необычная', stats: { maxHp: 23, physDef: 8, magicDef: 4 } });
    expect(equipmentByName['Сапоги загонщика']).toMatchObject({ rarity: 'Необычная', stats: { maxHp: 16, physDef: 9, speedPct: 0.08 } });
    expect(equipmentByName['Жетон интенданта']).toMatchObject({ rarity: 'Необычная', stats: { maxHp: 26, speedPct: 0.05 } });
  });

  test('Debtor Blade steals only once per attacking action and stops at both 40% caps', () => {
    const owner = player({ mainHand: 'Клинок должника' });
    owner.baseStats = { attack: 30, magAtk: 20, physDef: 20, magicDef: 10, speed: 100 };
    owner.statMultipliers = { attack: 1, magAtk: 1, physDef: 1, magicDef: 1, speed: 1, damageTaken: 1 };
    const target = enemy('Манекен', [], { physDef: 20 });
    target.baseStats = { attack: 20, magAtk: 10, physDef: 20, magicDef: 0, speed: 100 };
    target.statMultipliers = { attack: 1, magAtk: 1, physDef: 1, magicDef: 1, speed: 1, damageTaken: 1 };

    const first = {};
    triggerEquipmentOnDirectDamage({ attacker: owner, target, dealt: 10, damageType: 'physical', ability: {}, deliberateAction: first });
    triggerEquipmentOnDirectDamage({ attacker: owner, target, dealt: 10, damageType: 'physical', ability: {}, deliberateAction: first });
    expect(owner.physDef).toBe(24);
    expect(target.physDef).toBe(16);

    triggerEquipmentOnDirectDamage({ attacker: owner, target, dealt: 10, damageType: 'physical', ability: {}, deliberateAction: {} });
    triggerEquipmentOnDirectDamage({ attacker: owner, target, dealt: 10, damageType: 'physical', ability: {}, deliberateAction: {} });
    expect(owner.physDef).toBe(28);
    expect(target.physDef).toBe(12);
  });

  test('Debtor Blade stops weakening new targets after the owner reaches the 40% gain cap', () => {
    const owner = player({ mainHand: 'Клинок должника' });
    owner.baseStats = { attack: 30, magAtk: 20, physDef: 20, magicDef: 10, speed: 100 };
    owner.statMultipliers = { attack: 1, magAtk: 1, physDef: 1, magicDef: 1, speed: 1, damageTaken: 1 };
    const firstTarget = enemy('first', [], { physDef: 20 });
    const secondTarget = enemy('second', [], { physDef: 20 });
    firstTarget.baseStats = { attack: 20, magAtk: 10, physDef: 20, magicDef: 0, speed: 100 };
    secondTarget.baseStats = { attack: 20, magAtk: 10, physDef: 20, magicDef: 0, speed: 100 };
    firstTarget.statMultipliers = secondTarget.statMultipliers = { attack: 1, magAtk: 1, physDef: 1, magicDef: 1, speed: 1, damageTaken: 1 };

    triggerEquipmentOnDirectDamage({ attacker: owner, target: firstTarget, dealt: 10, damageType: 'physical', ability: {}, deliberateAction: {} });
    triggerEquipmentOnDirectDamage({ attacker: owner, target: firstTarget, dealt: 10, damageType: 'physical', ability: {}, deliberateAction: {} });
    expect(owner.physDef).toBe(28);
    expect(firstTarget.physDef).toBe(12);

    triggerEquipmentOnDirectDamage({ attacker: owner, target: secondTarget, dealt: 10, damageType: 'physical', ability: {}, deliberateAction: {} });

    expect(owner.physDef).toBe(28);
    expect(secondTarget.physDef).toBe(20);
  });

  test('Counterformula Wand needs a suitable pre-existing owner debuff and extends the shortest one once', () => {
    const session = initCombatSession(
      player({ mainHand: 'Жезл встречных формул' }, [attack('Формула', { type: 'magical', effect: { id: 'poison', duration: 2 } })], { id: 'hero' }),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'burn', duration: 2 }, () => {}, hero, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Формула', 0);
    expect(target.effects.find(effect => effect.id === 'burn')?.remainingTurns).toBe(3);
    expect(target.effects.find(effect => effect.id === 'poison')?.remainingTurns).toBe(2);
  });

  test('Counterformula Wand triggers at most once for an AoE action even when multiple targets qualify', () => {
    const session = initCombatSession(
      player(
        { mainHand: 'Жезл встречных формул' },
        [attack('Общая формула', {
          type: 'magical',
          targeting: 'allEnemies',
          effect: { id: 'poison', duration: 2 },
        })],
        { id: 'hero' }
      ),
      [enemy('first'), enemy('second')]
    );
    const hero = session.state.players[0];
    const [first, second] = session.state.enemies;

    addEffect(first, { id: 'burn', duration: 2 }, () => {}, hero, { session });
    addEffect(second, { id: 'burn', duration: 2 }, () => {}, hero, { session });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Общая формула', 0);

    const extendedBurns = [first, second]
      .map(target => target.effects.find(effect => effect.id === 'burn')?.remainingTurns)
      .filter(turns => turns === 3);

    expect(extendedBurns).toHaveLength(1);
  });

  test('Sighting Bow counts actions rather than multihit packets and fires one 50% secondary arrow on the second action', () => {
    const session = initCombatSession(
      player({ mainHand: 'Лук пристрелки' }, [attack('Двойной выстрел', { hitCount: 2 })], { class: 'Archer', attack: 30 }),
      [enemy('target', [], { hp: 200, maxHp: 200 })]
    );
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Двойной выстрел', 0);
    expect(session.state.enemies[0].hp).toBe(160);
    readyPlayerAgain(session);
    performPlayerAction(session, 'Двойной выстрел', 0);
    expect(session.state.enemies[0].hp).toBe(100);
  });

  test('Sighting Bow bases its secondary arrow only on direct physical damage to the primary AoE target', () => {
    const session = initCombatSession(
      player(
        { mainHand: 'Лук пристрелки' },
        [attack('Веерный выстрел', { targeting: 'allEnemies', damage: 20 })],
        { class: 'Archer', attack: 20 }
      ),
      [
        enemy('primary', [], { hp: 100, maxHp: 100 }),
        enemy('secondary', [], { hp: 100, maxHp: 100 }),
      ]
    );
    const [primary, secondary] = session.state.enemies;

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Веерный выстрел', 0);
    expect(primary.hp).toBe(80);
    expect(secondary.hp).toBe(80);

    readyPlayerAgain(session);
    performPlayerAction(session, 'Веерный выстрел', 0);

    expect(primary.hp).toBe(50);
    expect(secondary.hp).toBe(60);
  });

  test('Third Patch grants one Block on first full Shield break and Block absorbs exactly one direct packet', () => {
    const owner = player({ offHand: 'Щит третьей заплаты' }, [], { hp: 100, maxHp: 100, effects: [] });
    addEffect(owner, { id: 'shield', duration: 2, value: 10 }, () => {}, owner);
    owner.shield = 0;
    handleShieldBreak(owner, { logFn: () => {} });
    expect(owner.effects.some(effect => effect.id === 'block')).toBe(true);
    expect(applyDamage(owner, 20, 'physical', { directAttack: true, source: enemy('attacker') })).toBe(0);
    expect(owner.hp).toBe(100);
    expect(owner.effects.some(effect => effect.id === 'block')).toBe(false);
    expect(applyDamage(owner, 20, 'physical', { directAttack: true, source: enemy('attacker') })).toBeGreaterThan(0);
    expect(owner.hp).toBeLessThan(100);
  });

  test('Third Patch grants Block only for the first full Shield break of the battle', () => {
    const owner = player({ offHand: 'Щит третьей заплаты' }, [], { hp: 100, maxHp: 100, effects: [] });
    const attacker = enemy('attacker');

    addEffect(owner, { id: 'shield', duration: 2, value: 10 }, () => {}, owner);
    owner.shield = 0;
    handleShieldBreak(owner, { attacker, logFn: () => {} });
    expect(owner.effects.some(effect => effect.id === 'block')).toBe(true);

    applyDamage(owner, 20, 'physical', { directAttack: true, source: attacker });
    expect(owner.effects.some(effect => effect.id === 'block')).toBe(false);

    addEffect(owner, { id: 'shield', duration: 2, value: 10 }, () => {}, owner);
    owner.shield = 0;
    handleShieldBreak(owner, { attacker, logFn: () => {} });

    expect(owner.effects.some(effect => effect.id === 'block')).toBe(false);
  });

  test('Foreign Signal shortens the first suitable timed buff already present on each enemy', () => {
    const basic = attack('Атака', { basic: true });
    const session = initCombatSession(
      player({ helmet: 'Шлем чужого сигнала' }, [attack()]),
      [enemy('e1', [basic])]
    );
    const foe = session.state.enemies[0];
    addEffect(foe, { id: 'speed_boost_minor', duration: 3 }, () => {}, foe, { session });
    foe.turnMeter = 1000;
    session.state.players[0].turnMeter = 0;
    processEnemyAI(session);
    expect(session.state.players[0]._foreignSignalProcessedEnemyIds).toContain(foe.id);
    expect(session.state.log.some(line => line.includes('Шлем чужого сигнала'))).toBe(true);
  });

  test('Foreign Signal ignores an ineligible one-turn buff without consuming its per-enemy trigger', () => {
    const basic = attack('Атака', { basic: true });
    const session = initCombatSession(
      player({ helmet: 'Шлем чужого сигнала' }, [attack()]),
      [enemy('e1', [basic])]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];

    addEffect(foe, { id: 'speed_boost_minor', duration: 1 }, () => {}, foe, { session });
    foe.turnMeter = 1000;
    hero.turnMeter = 0;
    processEnemyAI(session);

    expect(hero._foreignSignalProcessedEnemyIds || []).not.toContain(foe.id);

    addEffect(foe, { id: 'defense_boost_minor', duration: 3 }, () => {}, foe, { session });
    foe.turnMeter = 1000;
    hero.turnMeter = 0;
    processEnemyAI(session);

    expect(hero._foreignSignalProcessedEnemyIds).toContain(foe.id);
    expect(session.state.log.filter(line => line.includes('Шлем чужого сигнала'))).toHaveLength(1);
  });

  test('Last in Line counts two separate enemy actions, not multihit packets, and grants one Protection Seal', () => {
    const basic = attack('Атака', { basic: true, hitCount: 2 });
    const session = initCombatSession(
      player({ armor: 'Кираса последнего в строю' }, [attack()], { hp: 300, maxHp: 300 }),
      [enemy('e1', [basic]), enemy('e2', [basic])]
    );
    const hero = session.state.players[0];
    const [e1, e2] = session.state.enemies;

    e1.turnMeter = 1000;
    e2.turnMeter = 0;
    hero.turnMeter = 0;
    processEnemyAI(session);
    expect(hero.effects.filter(effect => effect.id === 'protection_seals')).toHaveLength(0);

    e2.turnMeter = 1000;
    hero.turnMeter = 0;
    processEnemyAI(session);
    expect(hero.effects.filter(effect => effect.id === 'protection_seals')).toHaveLength(1);
  });

  test('Torn Ritual sacrifices one owner-applied timed debuff and reduces every packet of the first enemy action by 20%', () => {
    const basic = attack('Атака', { basic: true, hitCount: 2 });
    const session = initCombatSession(
      player({ armor: 'Куртка сорванного ритуала' }, [attack()], { hp: 100, maxHp: 100, physDef: 0 }),
      [enemy('attacker', [basic])]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];
    addEffect(foe, { id: 'burn', duration: 4 }, () => {}, hero, { session });
    foe.turnMeter = 1000; hero.turnMeter = 0;
    processEnemyAI(session);
    expect(hero.hp).toBe(68);
    expect(foe.effects.find(effect => effect.id === 'burn')?.remainingTurns).toBeLessThanOrEqual(3);
  });

  test('Torn Ritual ignores control and charge debuffs when choosing the sacrifice', () => {
    const basic = attack('Атака', { basic: true });
    const session = initCombatSession(
      player({ armor: 'Куртка сорванного ритуала' }, [attack()], { hp: 100, maxHp: 100, physDef: 0 }),
      [enemy('attacker', [basic])]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];

    addEffect(foe, { id: 'stun', duration: 5 }, () => {}, hero, { session });
    addEffect(foe, { id: 'charring', duration: 4 }, () => {}, hero, { session });
    addEffect(foe, { id: 'burn', duration: 3 }, () => {}, hero, { session });

    foe.turnMeter = 1000;
    hero.turnMeter = 0;
    processEnemyAI(session);

    expect(foe.effects.find(effect => effect.id === 'stun')?.remainingTurns).toBe(5);
    expect(foe.effects.find(effect => effect.id === 'charring')?.remainingTurns).toBe(4);
    expect(foe.effects.find(effect => effect.id === 'burn')?.remainingTurns).toBeLessThanOrEqual(2);
  });

  test('Unfinished Order prepares on a zero-direct-damage ability and spends readiness on the next direct hit', () => {
    const session = initCombatSession(
      player({ helmet: 'Обруч незаконченного приказа' }, [support(), attack('Удар')]),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'poison', duration: 2 }, () => {}, hero, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Подготовка', 0);
    expect(hero._unfinishedOrderReady).toBe(true);
    readyPlayerAgain(session);
    performPlayerAction(session, 'Удар', 0);
    expect(hero._unfinishedOrderReady).toBe(false);
    expect(target.effects.find(effect => effect.id === 'poison')?.remainingTurns).toBe(3);
  });

  test('Unfinished Order never extends control when another eligible owner debuff is present', () => {
    const session = initCombatSession(
      player({ helmet: 'Обруч незаконченного приказа' }, [support(), attack('Удар')]),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    addEffect(target, { id: 'stun', duration: 2 }, () => {}, hero, { session });
    addEffect(target, { id: 'poison', duration: 2 }, () => {}, hero, { session });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Подготовка', 0);
    readyPlayerAgain(session);
    performPlayerAction(session, 'Удар', 0);

    expect(target.effects.find(effect => effect.id === 'stun')?.remainingTurns).toBe(2);
    expect(target.effects.find(effect => effect.id === 'poison')?.remainingTurns).toBe(3);
  });

  test('Pursuer Boots grants 20% TM only once for a multi-kill action and only while another enemy remains', () => {
    const session = initCombatSession(
      player({ legs: 'Сапоги загонщика' }, [attack('Размах', { targeting: 'allEnemies', damage: 100 })], { attack: 100 }),
      [enemy('e1', [], { hp: 30, maxHp: 30 }), enemy('e2', [], { hp: 30, maxHp: 30 })]
    );
    session.state.initiative.playerReady = true;
    session.state.players[0].turnMeter = 0;
    performPlayerAction(session, 'Размах', 0);
    expect(session.state.players[0].turnMeter).toBe(200);
  });

  test('Pursuer Boots do not grant turn meter for killing the last living enemy', () => {
    const session = initCombatSession(
      player({ legs: 'Сапоги загонщика' }, [attack('Добивание', { damage: 100 })], { attack: 100 }),
      [enemy('last', [], { hp: 30, maxHp: 30 })]
    );
    const hero = session.state.players[0];
    session.state.initiative.playerReady = true;
    hero.turnMeter = 0;

    performPlayerAction(session, 'Добивание', 0);

    expect(session.state.enemies[0].hp).toBe(0);
    expect(hero.turnMeter).toBe(0);
  });

  test('Quartermaster converts exactly half of uncapped consumable overheal into Shield', () => {
    const session = initCombatSession(
      player({ amulet: 'Жетон интенданта' }, [attack()], {
        hp: 80, maxHp: 100, items: ['Малое зелье здоровья'],
      }),
      [enemy('target')]
    );

    const result = applyItemInCombat(session, 'Малое зелье здоровья');

    expect(result.itemUsed).toBe(true);
    expect(session.state.players[0].hp).toBe(100);
    // 15 overheal -> 7.5, rounded to 8 Shield; below the 15% max-HP cap.
    expect(session.state.players[0].shield).toBe(8);
  });

  test('Quartermaster does not convert non-consumable healing into Shield', () => {
    const session = initCombatSession(
      player({ amulet: 'Жетон интенданта' }, [attack()], { hp: 95, maxHp: 100 }),
      [enemy('target')]
    );
    const hero = session.state.players[0];

    applyHealing(hero, 35, { source: hero, session });

    expect(hero.hp).toBe(100);
    expect(hero.shield || 0).toBe(0);
  });

  test('Quartermaster converts half consumable overheal into Shield with a 15% max-HP cap', () => {
    const session = initCombatSession(
      player({ amulet: 'Жетон интенданта' }, [attack()], {
        hp: 95, maxHp: 100, items: ['Малое зелье здоровья'],
      }),
      [enemy('target')]
    );
    const result = applyItemInCombat(session, 'Малое зелье здоровья');
    expect(result.itemUsed).toBe(true);
    expect(session.state.players[0].hp).toBe(100);
    // 30 overheal -> 15 Shield, exactly the per-use cap.
    expect(session.state.players[0].shield).toBe(15);
    expect(session.state.players[0].effects.some(effect => effect.id === 'shield' && effect.remainingTurns === 2)).toBe(true);
  });
});
