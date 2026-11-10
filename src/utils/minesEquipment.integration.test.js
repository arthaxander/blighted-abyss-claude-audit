import { equipmentByName } from '../data/equipment';
import { addEffect, cleanseEffects, finishEffectTurn, processEffects } from './effects';
import {
  applyDamage,
  applyHealing,
  applyItemInCombat,
  toggleBlackVeinLantern,
  initCombatSession,
  performPlayerAction,
  processEnemyAI,
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
  attack: 40,
  magAtk: 50,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  critChance: 0,
  critDamage: 0.5,
  equipment: slots(equipment),
  abilities: [attack()],
  items: [],
  currentLocation: 'Шахты Тления',
  ...extra,
});

const enemy = (id = 'target', extra = {}) => ({
  id,
  name: id,
  hp: 400,
  maxHp: 400,
  attack: 20,
  magAtk: 20,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  abilities: [attack('Атака', { basic: true })],
  location: 'Шахты Тления',
  ...extra,
});

const readyPlayerAgain = session => {
  session.state.initiative.playerReady = true;
  session.state.turnState = {
    started: false,
    itemUsed: false,
    cooldownsProcessed: false,
    defeated: false,
    stunned: false,
  };
};

describe('Mines of Decay equipment', () => {
  test('registers Smoldering Vein Shield as the Mines craft-only Rare', () => {
    expect(equipmentByName['Щит тлеющей жилы']).toMatchObject({
      type: 'Shield',
      rarity: 'Редкая',
      stats: { maxHp: 18, physDef: 20, magicDef: 7 },
    });
  });

  test('Smoldering Vein Shield burns once per enemy attacking action while Shield is present, up to three times per battle', () => {
    const multiHit = attack('Тройной удар', { basic: true, damage: 10, hits: 3 });
    const session = initCombatSession(
      player({ offHand: 'Щит тлеющей жилы' }),
      [enemy('burner', { abilities: [multiHit], speed: 100 })]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];

    addEffect(hero, { id: 'shield', duration: 99, value: 300 }, () => {}, hero, { session });

    for (let action = 1; action <= 4; action += 1) {
      hero.turnMeter = 0;
      foe.turnMeter = 1000;
      session.state.initiative.playerReady = false;
      processEnemyAI(session);
      expect(hero._smolderingVeinShieldTriggers).toBe(Math.min(action, 3));
      // Burn lasts one attacker turn, so after the fourth (capped) action the
      // previous application has correctly expired.
      expect(foe.effects.some(effect => effect.id === 'burn')).toBe(action <= 3);
    }
  });

  test('Smoldering Vein Shield retaliates for the action that destroys its Shield', () => {
    const session = initCombatSession(
      player({ offHand: 'Щит тлеющей жилы' }),
      [enemy('breaker', { abilities: [attack('Разбивающий удар', { basic: true, damage: 100 })], speed: 100 })]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];
    addEffect(hero, { id: 'shield', duration: 99, value: 1 }, () => {}, hero, { session });

    hero.turnMeter = 0;
    foe.turnMeter = 1000;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);

    expect(hero.shield).toBe(0);
    expect(hero._smolderingVeinShieldTriggers).toBe(1);
    expect(foe.effects.find(effect => effect.id === 'burn')).toMatchObject({ remainingTurns: 1 });
  });


  test('Last Shift Hammer reduces the used class ability cooldown by one and starts a two-turn lockout', () => {
    const skill = attack('Тяжёлый выпад', { damage: 30, cooldown: 3 });
    const session = initCombatSession(
      player({ mainHand: 'Молот последней смены' }, { abilities: [skill] }),
      [enemy()]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Тяжёлый выпад', 0);

    expect(hero.abilities[0].currentCooldown).toBe(2);
    expect(hero._lastShiftHammerCooldown).toBe(3);
  });

  test('Last Shift Hammer skips exactly two owner turns before it can reduce cooldown again', () => {
    const first = attack('Первый удар', { damage: 20, cooldown: 3 });
    const second = attack('Второй удар', { damage: 20, cooldown: 3 });
    const third = attack('Третий удар', { damage: 20, cooldown: 3 });
    const fourth = attack('Четвёртый удар', { damage: 20, cooldown: 3 });
    const session = initCombatSession(
      player(
        { mainHand: 'Молот последней смены' },
        { abilities: [first, second, third, fourth] }
      ),
      [enemy('target', { hp: 1000, maxHp: 1000 })]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Первый удар', 0);
    expect(hero.abilities[0].currentCooldown).toBe(2);
    expect(hero._lastShiftHammerCooldown).toBe(3);

    readyPlayerAgain(session);
    performPlayerAction(session, 'Второй удар', 0);
    expect(hero.abilities[1].currentCooldown).toBe(3);
    expect(hero._lastShiftHammerCooldown).toBe(2);

    readyPlayerAgain(session);
    performPlayerAction(session, 'Третий удар', 0);
    expect(hero.abilities[2].currentCooldown).toBe(3);
    expect(hero._lastShiftHammerCooldown).toBe(1);

    readyPlayerAgain(session);
    performPlayerAction(session, 'Четвёртый удар', 0);
    expect(hero.abilities[3].currentCooldown).toBe(2);
    expect(hero._lastShiftHammerCooldown).toBe(3);
  });

  test('Scorched Vein Scepter keeps a foreign Mark, applies its own Mark, then explodes only its own remaining damage through Shield', () => {
    const magicHit = attack('Луч', {
      damage: 20,
      type: 'magical',
      school: 'light',
      cooldown: 0,
    });
    const foreignCaster = enemy('foreign-caster', { magAtk: 80 });
    const session = initCombatSession(
      player(
        { mainHand: 'Скипетр выжженной жилы' },
        { class: 'Elementalist', abilities: [magicHit] }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    addEffect(target, { id: 'searing_mark', duration: 3 }, () => {}, foreignCaster, {
      session,
      forceIndependentInstance: true,
    });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Луч', 0);

    let marks = target.effects.filter(effect => effect.id === 'searing_mark');
    expect(marks).toHaveLength(2);
    expect(marks.some(effect => effect.sourceId === foreignCaster.id)).toBe(true);
    expect(marks.some(effect => effect.sourceId === hero.id)).toBe(true);

    addEffect(target, { id: 'shield', duration: 2, value: 50 }, () => {}, target, { session });
    const hpBefore = target.hp;
    readyPlayerAgain(session);
    performPlayerAction(session, 'Луч', 0);

    marks = target.effects.filter(effect => effect.id === 'searing_mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].sourceId).toBe(foreignCaster.id);
    expect(target.shield).toBe(30);
    // 50 MA × (30% base + 10% for the still-active Shield) × 3 turns.
    expect(target.hp).toBe(hpBefore - 60);
  });


  test('Scorched Vein Scepter triggers only on the first eligible direct class hit of the owner turn', () => {
    const session = initCombatSession(
      player(
        { mainHand: 'Скипетр выжженной жилы' },
        { class: 'Elementalist' }
      ),
      [
        enemy('first', { hp: 200, maxHp: 200 }),
        enemy('second', { hp: 200, maxHp: 200 }),
      ]
    );
    const hero = session.state.players[0];
    const [first, second] = session.state.enemies;
    const ability = attack('Рассеянный луч', {
      damage: 20,
      type: 'magical',
      school: 'light',
      cooldown: 0,
      targeting: 'allEnemies',
    });
    hero.abilities = [ability];
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Рассеянный луч', 0);

    expect(first.effects.some(effect => effect.id === 'searing_mark' && effect.sourceId === hero.id)).toBe(true);
    expect(second.effects.some(effect => effect.id === 'searing_mark' && effect.sourceId === hero.id)).toBe(false);
  });

  test('Scorched Vein Scepter does not count a Shield destroyed by the triggering hit as a buff', () => {
    const magicHit = attack('Тёмный луч', { damage: 20, type: 'magical', school: 'darkness' });
    const session = initCombatSession(
      player({ mainHand: 'Скипетр выжженной жилы' }, { class: 'Elementalist', abilities: [magicHit] }),
      [enemy()]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'searing_mark', duration: 3 }, () => {}, hero, { session, forceIndependentInstance: true });
    addEffect(target, { id: 'shield', duration: 2, value: 10 }, () => {}, target, { session });
    const hpBefore = target.hp;

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Тёмный луч', 0);

    expect(target.shield).toBe(0);
    expect(target.effects.some(effect => effect.id === 'shield')).toBe(false);
    // 10 overflow + (50 MA × 30% × 3 remaining turns).
    expect(target.hp).toBe(hpBefore - 55);
  });


  test('Surviving Miner Jacket shortens the longest timed debuff after a successful consumable use', () => {
    const session = initCombatSession(
      player(
        { armor: 'Куртка уцелевшего забойщика' },
        { items: [{ name: 'Малое зелье здоровья' }], hp: 150, maxHp: 200 }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    addEffect(hero, { id: 'poison', duration: 2 }, () => {}, session.state.enemies[0], { session });
    addEffect(hero, { id: 'blind', duration: 3 }, () => {}, session.state.enemies[0], { session });

    session.state.initiative.playerReady = true;
    const result = applyItemInCombat(session, 'Малое зелье здоровья');

    expect(result.itemUsed).toBe(true);
    expect(hero.effects.find(effect => effect.id === 'blind')?.remainingTurns).toBe(2);
    expect(hero.effects.find(effect => effect.id === 'poison')?.remainingTurns).toBe(2);
  });

  test('Deaf Face Helmet grants one-turn Fortify after a non-attacking class ability', () => {
    const support = {
      name: 'Собраться',
      damage: 0,
      type: 'support',
      targeting: 'self',
      cooldown: 0,
    };
    const session = initCombatSession(
      player({ helmet: 'Каска глухого забоя' }, { abilities: [support] }),
      [enemy()]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Собраться', 0);

    const fortify = hero.effects.find(effect => effect.id === 'phys_def_boost_minor');
    expect(fortify).toBeTruthy();
    expect(fortify.remainingTurns).toBe(1);
  });

  test('Insatiable Vein deals 35% of actual healing as Light damage once between owner turns without Vampire Mark recursion', () => {
    const session = initCombatSession(
      player({ ring1: 'Перстень ненасытной жилы' }, { hp: 100, maxHp: 200 }),
      [enemy('target', { hp: 200, maxHp: 200 })],
      { rng: () => 0 }
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'vampire_mark', duration: 3 }, () => {}, hero, { session });

    const first = applyHealing(hero, 40, { source: hero, session, logFn: () => {} });
    expect(first).toBe(40);
    expect(target.hp).toBe(186);
    expect(hero.hp).toBe(140);

    const second = applyHealing(hero, 20, { source: hero, session, logFn: () => {} });
    expect(second).toBe(20);
    expect(target.hp).toBe(186);
    expect(hero.hp).toBe(160);
  });

  test('Erased Name shortens the longest finite buff and skips the next owner turn before it can proc again', () => {
    const session = initCombatSession(
      player({ amulet: 'Амулет стёртого имени' }),
      [enemy()]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    addEffect(target, { id: 'speed_boost_minor', duration: 4 }, () => {}, target, { session });
    addEffect(target, { id: 'phys_def_boost_minor', duration: 2 }, () => {}, target, { session });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Удар', 0);
    expect(target.effects.find(effect => effect.id === 'speed_boost_minor')?.remainingTurns).toBe(3);
    expect(hero._erasedNameCooldown).toBe(2);

    readyPlayerAgain(session);
    performPlayerAction(session, 'Удар', 0);
    expect(target.effects.find(effect => effect.id === 'speed_boost_minor')?.remainingTurns).toBe(3);
    expect(hero._erasedNameCooldown).toBe(1);

    readyPlayerAgain(session);
    performPlayerAction(session, 'Удар', 0);
    expect(target.effects.find(effect => effect.id === 'speed_boost_minor')?.remainingTurns).toBe(2);
    expect(hero._erasedNameCooldown).toBe(2);
  });


  test('Borrowed Guilt blocks the first hostile debuff and mirrors it to the source', () => {
    const session = initCombatSession(
      player({ armor: 'Кираса чужой вины' }),
      [enemy('caster')]
    );
    const hero = session.state.players[0];
    const caster = session.state.enemies[0];

    const blocked = addEffect(hero, { id: 'poison', duration: 3 }, () => {}, caster, { session });
    expect(blocked).toBeNull();
    expect(hero.effects.some(effect => effect.id === 'poison')).toBe(false);
    expect(caster.effects.some(effect => effect.id === 'poison' && effect.sourceId === hero.id)).toBe(true);

    const second = addEffect(hero, { id: 'blind', duration: 2 }, () => {}, caster, { session });
    expect(second).toBeTruthy();
    expect(hero.effects.some(effect => effect.id === 'blind')).toBe(true);
  });

  test('Borrowed Guilt still blocks the debuff when the hostile source is immune to the mirrored control', () => {
    const session = initCombatSession(
      player({ armor: 'Кираса чужой вины' }),
      [enemy('caster', { controlImmune: true })]
    );
    const hero = session.state.players[0];
    const caster = session.state.enemies[0];

    const blocked = addEffect(hero, { id: 'stun', duration: 1 }, () => {}, caster, { session });

    expect(blocked).toBeNull();
    expect(hero.effects.some(effect => effect.id === 'stun')).toBe(false);
    expect(caster.effects.some(effect => effect.id === 'stun')).toBe(false);
    expect(hero._borrowedGuiltCuirassUsed).toBe(true);
  });

  test('Black Stratum shortens the exact periodic debuff that dealt damage in addition to its normal tick decay', () => {
    const session = initCombatSession(
      player({ legs: 'Сапоги чёрного пласта' }),
      [enemy('caster', { attack: 40 })]
    );
    const hero = session.state.players[0];
    const caster = session.state.enemies[0];
    addEffect(hero, { id: 'poison', duration: 3 }, () => {}, caster, { session });

    processEffects(hero, () => {}, {
      applyDamage: (unit, amount, type, extra = {}) =>
        applyDamage(unit, amount, type, { ...extra, session, logFn: () => {} }),
      applyHealing: (unit, amount) => applyHealing(unit, amount, { session }),
      getAllies: () => session.state.players,
      getOpponents: () => session.state.enemies,
      session,
    });

    expect(hero.effects.find(effect => effect.id === 'poison')?.remainingTurns).toBe(1);
  });

  test('Flaring Vein grants Haste when a debuff is cleansed and starts a three-owner-turn cooldown', () => {
    const session = initCombatSession(
      player({ legs: 'Сапоги вспыхнувшей жилы' }),
      [enemy('caster')]
    );
    const hero = session.state.players[0];
    const caster = session.state.enemies[0];
    addEffect(hero, { id: 'blind', duration: 2 }, () => {}, caster, { session });

    cleanseEffects(hero, effect => effect.id === 'blind', () => {});

    const haste = hero.effects.find(effect => effect.id === 'speed_boost_minor');
    expect(haste).toBeTruthy();
    expect(haste.remainingTurns).toBe(2);
    expect(hero._flaringVeinBootsCooldown).toBe(4);
  });

  test('Flaring Vein also grants Haste when a debuff expires naturally', () => {
    const session = initCombatSession(
      player({ legs: 'Сапоги вспыхнувшей жилы' }),
      [enemy('caster')]
    );
    const hero = session.state.players[0];
    const caster = session.state.enemies[0];
    addEffect(hero, { id: 'poison', duration: 1 }, () => {}, caster, { session });

    processEffects(hero, () => {}, {
      applyDamage: (unit, amount, type, extra = {}) =>
        applyDamage(unit, amount, type, { ...extra, session, logFn: () => {} }),
      applyHealing: (unit, amount) => applyHealing(unit, amount, { session }),
      getAllies: () => session.state.players,
      getOpponents: () => session.state.enemies,
      session,
    });

    expect(hero.effects.some(effect => effect.id === 'poison')).toBe(false);
    const haste = hero.effects.find(effect => effect.id === 'speed_boost_minor');
    expect(haste).toBeTruthy();
    expect(haste.remainingTurns).toBe(2);
    expect(hero._flaringVeinBootsCooldown).toBe(4);
  });

  test('Last Support Helmet heals only when remaining Shield expires naturally', () => {
    const session = initCombatSession(
      player({ helmet: 'Каска последней крепи' }, { hp: 100, maxHp: 200 }),
      [enemy()]
    );
    const hero = session.state.players[0];
    addEffect(hero, { id: 'shield', duration: 1, value: 50 }, () => {}, hero, { session });

    processEffects(hero, () => {}, { session });
    finishEffectTurn(hero, () => {}, {
      session,
      applyHealing: (unit, amount) => applyHealing(unit, amount, { session }),
    });

    expect(hero.shield).toBe(0);
    expect(hero.hp).toBe(120);
  });


  test('Last Support Helmet does not heal when Shield is broken by damage', () => {
    const session = initCombatSession(
      player({ helmet: 'Каска последней крепи' }, { hp: 100, maxHp: 200 }),
      [enemy('attacker')]
    );
    const hero = session.state.players[0];
    const attacker = session.state.enemies[0];

    addEffect(hero, { id: 'shield', duration: 2, value: 20 }, () => {}, hero, { session });
    applyDamage(hero, 30, 'physical', {
      source: attacker,
      session,
      logFn: () => {},
      directAttack: true,
      deliberateAction: { actorId: attacker.id, ability: 'Атака' },
    });

    expect(hero.shield).toBe(0);
    expect(hero.hp).toBe(90);
    expect(hero.effects.some(effect => effect.id === 'shield')).toBe(false);
  });

  test('Last Support Helmet does not heal when Shield is fully consumed by equipment', () => {
    const magicHit = attack('Луч', { damage: 20, type: 'magical', school: 'light' });
    const session = initCombatSession(
      player(
        { helmet: 'Каска последней крепи', offHand: 'Фонарь чёрной жилы' },
        { class: 'Elementalist', hp: 100, maxHp: 200, abilities: [magicHit] }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    addEffect(hero, { id: 'shield', duration: 2, value: 1 }, () => {}, hero, { session });
    session.state.initiative.playerReady = true;
    expect(toggleBlackVeinLantern(session, true).changed).toBe(true);

    performPlayerAction(session, 'Луч', 0);

    expect(hero.shield).toBe(0);
    expect(hero.effects.some(effect => effect.id === 'shield')).toBe(false);
    expect(hero.hp).toBe(100);
  });

  test('a Shield source depleted by theft is removed while surviving Shield stays active', () => {
    const session = initCombatSession(
      player({ mainHand: 'Лук сорванного построения' }, { abilities: [attack('Укол', { damage: 1 })] }),
      [enemy()]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'shield', duration: 3, value: 1 }, () => {}, target, {
      session, forceIndependentInstance: true,
    });
    addEffect(target, { id: 'shield', duration: 3, value: 3 }, () => {}, target, {
      session, forceIndependentInstance: true,
    });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Укол', 0);

    expect(hero.shield).toBe(1);
    expect(target.shield).toBe(2);
    const activeShields = target.effects.filter(effect => effect.id === 'shield');
    expect(activeShields).toHaveLength(1);
    expect(activeShields[0].appliedShield).toBe(2);
  });

  test('Deep Watch helmet shortens only the first eligible hostile timed debuff by two turns', () => {
    const session = initCombatSession(
      player({ helmet: 'Шлем глубинного дозора' }),
      [enemy('caster')]
    );
    const hero = session.state.players[0];
    const caster = session.state.enemies[0];

    const first = addEffect(hero, { id: 'poison', duration: 3 }, () => {}, caster, { session });
    expect(first).toBeTruthy();
    expect(first.remainingTurns).toBe(1);

    const second = addEffect(hero, { id: 'blind', duration: 3 }, () => {}, caster, { session });
    expect(second).toBeTruthy();
    expect(second.remainingTurns).toBe(3);
  });

  test('Deep Watch helmet ignores charge-based debuffs and waits for the first eligible timed debuff', () => {
    const session = initCombatSession(
      player({ helmet: 'Шлем глубинного дозора' }),
      [enemy('caster')]
    );
    const hero = session.state.players[0];
    const caster = session.state.enemies[0];

    const charring = addEffect(hero, { id: 'charring', duration: 3 }, () => {}, caster, { session });
    expect(charring).toBeTruthy();
    expect(charring.remainingTurns).toBe(3);
    expect(hero._deepWatchHelmetUsed || false).toBe(false);

    const poison = addEffect(hero, { id: 'poison', duration: 3 }, () => {}, caster, { session });
    expect(poison).toBeTruthy();
    expect(poison.remainingTurns).toBe(1);
    expect(hero._deepWatchHelmetUsed).toBe(true);
  });

  test('Deep Watch Cuirass grants its Shield only on the first successful consumable use per battle', () => {
    const session = initCombatSession(
      player(
        { armor: 'Кираса глубинного дозора' },
        {
          hp: 150,
          maxHp: 200,
          items: [
            { name: 'Малое зелье здоровья' },
            { name: 'Малое зелье здоровья' },
          ],
        }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    const first = applyItemInCombat(session, 'Малое зелье здоровья');
    expect(first.itemUsed).toBe(true);
    expect(hero.shield).toBe(20);

    hero.shield = 0;
    hero.effects = (hero.effects || []).filter(effect => effect.id !== 'shield');
    readyPlayerAgain(session);

    const second = applyItemInCombat(session, 'Малое зелье здоровья');
    expect(second.itemUsed).toBe(true);
    expect(hero.shield).toBe(0);
  });

  test('Deep Watch Boots grant 12% turn meter on a successful consumable use and do not trigger twice in the same turn', () => {
    const session = initCombatSession(
      player(
        { legs: 'Сапоги глубинного дозора' },
        {
          hp: 150,
          maxHp: 200,
          items: [
            { name: 'Малое зелье здоровья' },
            { name: 'Малое зелье здоровья' },
          ],
        }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    hero.turnMeter = 300;

    session.state.initiative.playerReady = true;
    const first = applyItemInCombat(session, 'Малое зелье здоровья');
    expect(first.itemUsed).toBe(true);
    expect(hero.turnMeter).toBe(420);

    const second = applyItemInCombat(session, 'Малое зелье здоровья');
    expect(second.itemUsed).toBe(false);
    expect(hero.turnMeter).toBe(420);
  });

  test('Deep Watch 3/3 applies all first-consumable bonuses after the consumable resolves', () => {
    const session = initCombatSession(
      player(
        {
          helmet: 'Шлем глубинного дозора',
          armor: 'Кираса глубинного дозора',
          legs: 'Сапоги глубинного дозора',
        },
        {
          hp: 150,
          maxHp: 200,
          items: [{ name: 'Малое зелье здоровья' }],
        }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];
    const turnMeterBefore = hero.turnMeter;

    session.state.initiative.playerReady = true;
    const result = applyItemInCombat(session, 'Малое зелье здоровья');

    expect(result.itemUsed).toBe(true);
    expect(hero.shield).toBe(20);
    expect(hero.turnMeter - turnMeterBefore).toBe(120);
    expect(hero.effects.find(effect => effect.id === 'attack_boost_minor')?.remainingTurns).toBe(2);
    expect(hero.effects.find(effect => effect.id === 'magic_attack_boost_minor')?.remainingTurns).toBe(2);
  });


  test('Deep Watch 3/3 does not refresh its first-consumable buffs later in the same battle', () => {
    const session = initCombatSession(
      player(
        {
          helmet: 'Шлем глубинного дозора',
          armor: 'Кираса глубинного дозора',
          legs: 'Сапоги глубинного дозора',
        },
        {
          hp: 150,
          maxHp: 200,
          items: [
            { name: 'Малое зелье здоровья' },
            { name: 'Малое зелье здоровья' },
          ],
        }
      ),
      [enemy()]
    );
    const hero = session.state.players[0];

    session.state.initiative.playerReady = true;
    const first = applyItemInCombat(session, 'Малое зелье здоровья');
    expect(first.itemUsed).toBe(true);

    const attackBuff = hero.effects.find(effect => effect.id === 'attack_boost_minor');
    const magicBuff = hero.effects.find(effect => effect.id === 'magic_attack_boost_minor');
    expect(attackBuff?.remainingTurns).toBe(2);
    expect(magicBuff?.remainingTurns).toBe(2);

    attackBuff.remainingTurns = 1;
    attackBuff.duration = 1;
    magicBuff.remainingTurns = 1;
    magicBuff.duration = 1;
    readyPlayerAgain(session);

    const second = applyItemInCombat(session, 'Малое зелье здоровья');
    expect(second.itemUsed).toBe(true);
    expect(attackBuff.remainingTurns).toBe(1);
    expect(magicBuff.remainingTurns).toBe(1);
  });


  test('Burned Memory Staff stores only the previous owner-turn class magic damage, caps recall at 200% MA, and stays free', () => {
    const magicHit = attack('Магический залп', {
      damage: 150,
      type: 'magical',
      school: 'fire',
      cooldown: 0,
    });
    const session = initCombatSession(
      player(
        { mainHand: 'Посох выжженной памяти' },
        {
          class: 'Elementalist',
          magAtk: 50,
          abilities: [magicHit],
          items: [{ name: 'Малое зелье здоровья' }],
          hp: 150,
          maxHp: 200,
        }
      ),
      [enemy('target', { hp: 500, maxHp: 500, speed: 1 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Магический залп', 0);
    expect(hero._burnedMemoryCurrentTurnDamage).toBe(150);
    expect(hero._burnedMemoryStoredDamage || 0).toBe(0);

    hero.turnMeter = 1000;
    target.turnMeter = 0;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);
    expect(session.state.initiative.playerReady).toBe(true);
    expect(hero._burnedMemoryStoredDamage).toBe(150);
    expect(hero._burnedMemoryCurrentTurnDamage).toBe(0);

    const hpBeforeRecall = target.hp;
    const recall = applyItemInCombat(session, 'Посох выжженной памяти', { targetIndex: 0 });
    expect(recall).toMatchObject({
      itemUsed: true,
      turnConsumed: false,
      activeEquipment: true,
      freeActiveEquipment: true,
    });
    expect(target.hp).toBe(hpBeforeRecall - 100);
    expect(hero._burnedMemoryStoredDamage).toBe(0);
    expect(hero._burnedMemoryStaffCooldown).toBe(3);
    expect(session.state.turnState.itemUsed).toBe(false);
  });

  test('Burned Memory Staff forgets an unused charge after one owner turn', () => {
    const magicHit = attack('Магический залп', {
      damage: 60,
      type: 'magical',
      school: 'fire',
      cooldown: 0,
    });
    const physicalHit = attack('Удар посохом', {
      damage: 10,
      type: 'physical',
      cooldown: 0,
    });
    const session = initCombatSession(
      player(
        { mainHand: 'Посох выжженной памяти' },
        {
          class: 'Elementalist',
          magAtk: 50,
          abilities: [magicHit, physicalHit],
        }
      ),
      [enemy('target', { hp: 500, maxHp: 500, speed: 1 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Магический залп', 0);

    hero.turnMeter = 1000;
    target.turnMeter = 0;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);
    expect(hero._burnedMemoryStoredDamage).toBe(60);

    performPlayerAction(session, 'Удар посохом', 0);
    expect(hero._burnedMemoryCurrentTurnDamage || 0).toBe(0);

    hero.turnMeter = 1000;
    target.turnMeter = 0;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);

    expect(hero._burnedMemoryStoredDamage).toBe(0);
  });

  test('Pride Sword uses three charges to apply Reverence, then deals +175% direct damage and wakes the target', () => {
    const session = initCombatSession(
      player({ mainHand: 'Меч Гордыни' }),
      [enemy('target', { hp: 1000, maxHp: 1000 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    for (let hit = 0; hit < 3; hit += 1) {
      session.state.initiative.playerReady = true;
      session.state.turnState = {
        started: false,
        itemUsed: false,
        cooldownsProcessed: false,
        defeated: false,
        stunned: false,
      };
      performPlayerAction(session, 'Удар', 0);
    }
    expect(hero._prideArroganceCharges).toBe(3);
    expect(target.hp).toBe(922); // Defender outgoing multiplier is 1.3, not 1.2.

    readyPlayerAgain(session);
    performPlayerAction(session, 'Удар', 0);
    expect(hero._prideArroganceCharges).toBe(0);
    expect(target.hp).toBe(896); // 1.3 multiplier applied to the +175% follow-up.
    expect(target.effects.some(effect => effect.id === 'reverence')).toBe(true);
    expect(target.prostrated).toBe(true);

    readyPlayerAgain(session);
    performPlayerAction(session, 'Удар', 0);
    expect(target.hp).toBe(824); // Same multiplier on the +150% conversion hit.
    expect(target.effects.some(effect => effect.id === 'reverence')).toBe(false);
    expect(target.prostrated).toBe(false);
    expect(hero._prideArroganceCharges).toBe(1);
  });

  test('Pride Sword fourth hit deals +150% direct damage instead of Reverence against control-immune targets', () => {
    const session = initCombatSession(
      player({ mainHand: 'Меч Гордыни' }),
      [enemy('boss', { hp: 1000, maxHp: 1000, controlImmune: true })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    for (let hit = 0; hit < 4; hit += 1) {
      session.state.initiative.playerReady = true;
      session.state.turnState = {
        started: false,
        itemUsed: false,
        cooldownsProcessed: false,
        defeated: false,
        stunned: false,
      };
      performPlayerAction(session, 'Удар', 0);
    }

    expect(target.hp).toBe(857); // Same 1.3 multiplier as the previous case.
    expect(target.effects.some(effect => effect.id === 'reverence')).toBe(false);
    expect(hero._prideArroganceCharges).toBe(0);
  });



  test('any successful direct damage, including a secondary direct component, wakes Reverence without granting Pride progress', () => {
    const splitHit = attack('Двойной импульс', {
      damage: 1,
      secondary: { target: 'target', damage: 10, type: 'physical' },
    });
    const session = initCombatSession(
      player({}, { abilities: [splitHit] }),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'reverence' }, () => {}, hero, { session });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Двойной импульс', 0);

    expect(target.effects.some(effect => effect.id === 'reverence')).toBe(false);
    expect(target.prostrated).toBe(false);
    expect(hero._prideArroganceCharges || 0).toBe(0);
  });

  test('a fully blocked hit does not wake Reverence because it dealt no direct damage', () => {
    const session = initCombatSession(
      player({}),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];

    addEffect(target, { id: 'reverence' }, () => {}, hero, { session });
    addEffect(target, { id: 'block', stacks: 1 }, () => {}, target, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Удар', 0);

    expect(target.effects.some(effect => effect.id === 'reverence')).toBe(true);
  });

  test('Reverence breaks after periodic HP damage reaches 15% of target max HP', () => {
    const session = initCombatSession(
      player({ mainHand: 'Меч Гордыни' }),
      [enemy('target', { hp: 1000, maxHp: 1000 })]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(target, { id: 'reverence' }, () => {}, hero, { session });
    target._reverencePeriodicDamage = 0;

    applyDamage(target, 100, 'physical', {
      source: hero,
      session,
      logFn: () => {},
      isPeriodic: true,
      directAttack: false,
      fromEffect: 'test_dot',
    });
    expect(target.effects.some(effect => effect.id === 'reverence')).toBe(true);
    expect(target._reverencePeriodicDamage).toBe(130); // Periodic damage carries the 1.3 multiplier too.

    applyDamage(target, 50, 'physical', {
      source: hero,
      session,
      logFn: () => {},
      isPeriodic: true,
      directAttack: false,
      fromEffect: 'test_dot',
    });
    expect(target.effects.some(effect => effect.id === 'reverence')).toBe(false);
    expect(target.prostrated).toBe(false);
    expect(target._reverencePeriodicDamage).toBe(0);
  });

  test('Pride Sword keeps at most one Reverence target at a time', () => {
    const session = initCombatSession(
      player(
        { mainHand: 'Меч Гордыни' },
        { abilities: [attack('Удар', { basic: true, cooldown: 0 })] }
      ),
      [enemy('first', { hp: 500, maxHp: 500 }), enemy('second', { hp: 500, maxHp: 500 })]
    );
    const hero = session.state.players[0];
    const [first, second] = session.state.enemies;
    addEffect(first, { id: 'reverence' }, () => {}, hero, { session });
    first._reverencePeriodicDamage = 0;
    hero._prideArroganceCharges = 3;

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Удар', 1);

    expect(first.effects.some(effect => effect.id === 'reverence')).toBe(false);
    expect(second.effects.some(effect => effect.id === 'reverence')).toBe(true);
  });

  test('Black Vein Lantern is off by default, toggles for free, and spends Shield only on the first eligible magic class hit', () => {
    const magicHit = attack('Луч', {
      damage: 20,
      type: 'magical',
      school: 'light',
      cooldown: 0,
    });
    const session = initCombatSession(
      player(
        { offHand: 'Фонарь чёрной жилы' },
        {
          class: 'Elementalist',
          hp: 150,
          maxHp: 200,
          abilities: [magicHit],
          items: [{ name: 'Малое зелье здоровья' }],
        }
      ),
      [enemy('target')]
    );
    const hero = session.state.players[0];
    const target = session.state.enemies[0];
    addEffect(hero, { id: 'shield', duration: 99, value: 40 }, () => {}, hero, { session });

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Луч', 0);
    expect(hero.shield).toBe(40);
    expect(target.hp).toBe(380);

    session.state.initiative.playerReady = false;
    const blockedToggle = toggleBlackVeinLantern(session, true);
    expect(blockedToggle.changed).toBe(false);
    expect(hero._blackVeinLanternEnabled || false).toBe(false);

    session.state.initiative.playerReady = true;
    const toggled = toggleBlackVeinLantern(session, true);
    expect(toggled).toMatchObject({
      changed: true,
      enabled: true,
      itemUsed: false,
      turnConsumed: false,
    });
    expect(session.state.turnState.itemUsed).toBe(false);

    // Both hits belong to one action, so the Lantern may spend only once.
    hero.abilities[0].hits = 2;
    readyPlayerAgain(session);
    performPlayerAction(session, 'Луч', 0);
    expect(hero.shield).toBe(20);
    expect(target.hp).toBe(310);
  });


  test('Blinding Gold reacts to a direct enemy hit, then skips the next two owner turns before rearming', () => {
    const session = initCombatSession(
      player({ amulet: 'Амулет слепящего золота' }),
      [enemy('attacker')]
    );
    const hero = session.state.players[0];
    const foe = session.state.enemies[0];

    hero.turnMeter = 0;
    foe.turnMeter = 1000;
    session.state.initiative.playerReady = false;
    const hpBeforeHit = hero.hp;
    processEnemyAI(session);
    const blind = foe.effects.find(effect => effect.id === 'blind');
    expect(hero.hp).toBeLessThan(hpBeforeHit);
    expect(blind).toBeTruthy();
    expect(blind.remainingTurns).toBe(2);
    cleanseEffects(foe, effect => effect.id === 'blind', () => {});

    // After one skipped owner turn an intervening direct hit cannot proc it.
    readyPlayerAgain(session);
    performPlayerAction(session, 'Удар', 0);
    hero.turnMeter = 0;
    foe.turnMeter = 1000;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);
    expect(foe.effects.some(effect => effect.id === 'blind')).toBe(false);

    // Once two owner turns have completed, the next direct hit rearms it.
    readyPlayerAgain(session);
    performPlayerAction(session, 'Удар', 0);
    hero.turnMeter = 0;
    foe.turnMeter = 1000;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);
    expect(foe.effects.find(effect => effect.id === 'blind')).toMatchObject({ remainingTurns: 2 });
  });
});
