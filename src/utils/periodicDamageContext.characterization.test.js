import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { addEffect } from './effects';
import { applyDamage, initCombatSession, performPlayerAction, processEnemyAI } from './combatUtils';

const attackAbility = (damage = 100) => ({
  name: 'Проверочный удар',
  damage,
  type: 'physical',
  cooldown: 0,
  alwaysHits: true,
});

const playerData = (abilities = [attackAbility()]) => ({
  name: 'Герой',
  hp: 200,
  maxHp: 200,
  attack: 100,
  magAtk: 100,
  physDef: 0,
  magicDef: 0,
  critChance: 0,
  abilities,
});

const enemyData = (name = 'Цель', extra = {}) => ({
  name,
  hp: 500,
  maxHp: 500,
  attack: 10,
  physDef: 0,
  magicDef: 0,
  critChance: 0,
  speed: 100,
  abilities: [attackAbility(1)],
  ...extra,
});

const decayStored = target => target.effects.find(effect => effect.id === 'decay')?.extra?.accumulated ?? 0;

const readyPlayer = session => {
  session.state.initiative.playerReady = true;
  session.state.players[0].turnMeter = 1000;
};

const readyEnemy = (session, enemy) => {
  session.state.initiative.playerReady = false;
  session.state.players[0].turnMeter = 0;
  enemy.turnMeter = 1000;
};

describe('periodic damage, Shield and Decay semantics', () => {
  test.each([
    ['unshielded mitigated hit', 0, 50, 17.5],
    ['partially shielded mitigated hit', 30, 35, 12.25],
    ['fully shielded mitigated hit', 100, 0, 0],
  ])('direct damage: %s', (_label, shield, expectedHpLoss, expectedStored) => {
    const session = initCombatSession(playerData(), [enemyData('Бронированная цель', { physDef: 100 })]);
    const target = session.state.enemies[0];
    target.shield = shield;
    addEffect(target, { id: 'decay', duration: 3 }, jest.fn(), session.state.players[0], { session });
    readyPlayer(session);
    const hpBefore = target.hp;

    performPlayerAction(session, 'Проверочный удар', 0);

    expect(hpBefore - target.hp).toBe(expectedHpLoss);
    expect(decayStored(target)).toBeCloseTo(expectedStored);
  });

  test.each([
    ['physical', 'physDef'],
    ['magical', 'magicDef'],
  ])('direct %s damage consumes Shield before the matching defense', (type, defenseKey) => {
    const target = enemyData('Щитоносец', {
      hp: 500,
      maxHp: 500,
      shield: 40,
      physDef: 0,
      magicDef: 0,
      [defenseKey]: 100,
    });

    const dealt = applyDamage(target, 100, type, {
      source: playerData(),
      directAttack: true,
    });

    expect(target.shield).toBe(0);
    expect(target.lastAbsorbed).toBe(40);
    expect(dealt).toBe(30);
    expect(target.hp).toBe(470);
  });

  test('a bonus direct hit can use Shield-before-defense without becoming a direct attack reaction', () => {
    const target = enemyData('Щитоносец', {
      hp: 500,
      maxHp: 500,
      shield: 40,
      physDef: 100,
    });

    const dealt = applyDamage(target, 100, 'physical', {
      source: playerData(),
      directAttack: false,
      shieldBeforeDefense: true,
    });

    expect(target.shield).toBe(0);
    expect(dealt).toBe(30);
    expect(target.hp).toBe(470);
  });

  test('multihit direct attacks consume Shield before defense on every hit', () => {
    const multihit = {
      ...attackAbility(50),
      name: 'Проверочная серия',
      hits: 2,
    };
    const session = initCombatSession(playerData([multihit]), [enemyData('Щитоносец', {
      shield: 70,
      physDef: 100,
    })]);
    const target = session.state.enemies[0];
    target.shield = 70;
    readyPlayer(session);

    performPlayerAction(session, 'Проверочная серия', 0);

    expect(target.shield).toBe(0);
    expect(target.hp).toBe(485);
  });

  test('AoE direct attacks apply the same Shield-before-defense rule to every target', () => {
    const aoe = {
      ...attackAbility(100),
      name: 'Проверочная волна',
      targeting: 'allEnemies',
    };
    const session = initCombatSession(playerData([aoe]), [
      enemyData('Первая цель', { shield: 40, physDef: 100 }),
      enemyData('Вторая цель', { shield: 40, physDef: 100 }),
    ]);
    session.state.enemies.forEach(target => { target.shield = 40; });
    readyPlayer(session);

    performPlayerAction(session, 'Проверочная волна', 0);

    session.state.enemies.forEach(target => {
      expect(target.shield).toBe(0);
      expect(target.hp).toBe(470);
    });
  });

  test('shield-break multiplier spends extra Shield without spilling bonus damage into HP', () => {
    const target = enemyData('Толстый щит', {
      hp: 500,
      maxHp: 500,
      shield: 150,
      physDef: 100,
    });

    const dealt = applyDamage(target, 100, 'physical', {
      source: playerData(),
      directAttack: true,
      shieldDamageMultiplier: 2,
    });

    expect(target.shield).toBe(0);
    expect(target.lastAbsorbed).toBe(100);
    expect(target.lastShieldDamage).toBe(150);
    expect(dealt).toBe(0);
    expect(target.hp).toBe(500);
  });

  test('shield multiplier below one reduces Shield spent without reducing same-hit HP overflow', () => {
    const target = enemyData('Укреплённый щит', {
      hp: 500,
      maxHp: 500,
      shield: 40,
      physDef: 100,
    });

    const dealt = applyDamage(target, 100, 'physical', {
      source: playerData(),
      directAttack: true,
      shieldDamageMultiplier: 0.75,
    });

    expect(target.shield).toBe(10);
    expect(target.lastAbsorbed).toBe(40);
    expect(target.lastShieldDamage).toBe(30);
    expect(dealt).toBe(30);
    expect(target.hp).toBe(470);
  });

  test.each([
    ['physical', 'physDef'],
    ['magical', 'magicDef'],
  ])('periodic %s damage consumes full Shield before reducing HP overflow', (damageType, defenseKey) => {
    const target = enemyData('Щитоносец', {
      hp: 500,
      maxHp: 500,
      shield: 30,
      physDef: 0,
      magicDef: 0,
      [defenseKey]: 100,
    });

    const dealt = applyDamage(target, 100, damageType, {
      source: playerData(),
      directAttack: false,
      isPeriodic: true,
      fromEffect: 'bleed',
      sourceEffectId: 'bleed',
    });

    expect(target.shield).toBe(0);
    expect(target.lastAbsorbed).toBe(30);
    expect(dealt).toBe(35);
    expect(target.hp).toBe(465);
  });

  test.each([
    ['physical', 'physDef'],
    ['magical', 'magicDef'],
  ])('periodic %s damage spends full Shield without defense, and has no HP overflow when fully covered', (type, defenseKey) => {
    const target = enemyData('Полный щит', {
      hp: 500, maxHp: 500, shield: 120,
      physDef: 0, magicDef: 0, [defenseKey]: 300,
    });
    const dealt = applyDamage(target, 100, type, {
      source: playerData(), isPeriodic: true, fromEffect: 'test_periodic', sourceEffectId: 'test_periodic',
    });
    expect(target.shield).toBe(20);
    expect(target.lastAbsorbed).toBe(100);
    expect(target.hp).toBe(500);
    expect(dealt).toBe(0);
  });

  test.each([
    ['physical', 'physDef'],
    ['magical', 'magicDef'],
  ])('periodic %s damage uses the matching defense even without Shield', (type, defenseKey) => {
    const target = enemyData('Бронированная цель', {
      hp: 500,
      maxHp: 500,
      shield: 0,
      physDef: 0,
      magicDef: 0,
      [defenseKey]: 300,
    });

    const dealt = applyDamage(target, 100, type, {
      source: playerData(),
      directAttack: false,
      isPeriodic: true,
      fromEffect: 'test_periodic',
      sourceEffectId: 'test_periodic',
    });

    expect(dealt).toBe(25);
    expect(target.hp).toBe(475);
  });

  test.each([
    ['bleed', { attack: 10 }, 3],
    ['burn', { attack: 10 }, 4],
    ['poison', { attack: 10 }, 4],
  ])('%s tick carries periodic metadata and does not accumulate in Decay', (effectId, sourceStats, expectedLoss) => {
    const session = initCombatSession(playerData(), [enemyData('Бронированная цель', { physDef: 300, magicDef: 300 })]);
    const target = session.state.enemies[0];
    const dotSource = { name: 'Источник эффекта', hp: 100, maxHp: 100, ...sourceStats };
    const observed = [];
    target.abilities.push({
      name: 'Наблюдатель контекста',
      passive: true,
      onOwnerDamaged: ({ attacker, context }) => observed.push({ attacker, context }),
    });
    addEffect(target, { id: 'decay', duration: 3 }, jest.fn(), session.state.players[0], { session });
    addEffect(target, { id: effectId, duration: 1 }, jest.fn(), dotSource, { session });
    readyEnemy(session, target);
    const hpBefore = target.hp;

    processEnemyAI(session);

    expect(hpBefore - target.hp).toBe(expectedLoss);
    expect(decayStored(target)).toBe(0);
    expect(observed).toHaveLength(effectId === 'poison' ? 2 : 1);
    observed.forEach(({ attacker, context }) => {
      expect(attacker).toBe(dotSource);
      expect(context).toMatchObject({
        source: dotSource,
        isPeriodic: true,
        directAttack: false,
        fromEffect: effectId,
        sourceEffectId: effectId,
      });
    });
  });

  test.each([
    ['gloom', 40],
    // Searing Mark gains +10% magical attack per active buff, including Shield.
    ['searing_mark', 40],
  ])('%s bypasses Shield, but not magical defense, on actual status ticks', (effectId, raw) => {
    const session = initCombatSession(playerData(), [enemyData('Щитоносец', { magicDef: 100 })]);
    const target = session.state.enemies[0];
    const source = { name: 'Источник', hp: 100, maxHp: 100, magAtk: 100 };
    // Shield must have an actual backing buff: effect-turn synchronization
    // correctly removes unsupported manual shield values.
    addEffect(target, { id: 'shield', duration: 3, value: 100 }, jest.fn(), source, { session });
    expect(target.shield).toBe(100);
    addEffect(target, { id: effectId, duration: 1 }, jest.fn(), source, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    expect(target.shield).toBe(100);
    expect(target.hp).toBe(500 - Math.round(raw / 2));
  });

  test('regular Burn tick is mitigated and absorbed by Shield', () => {
    const session = initCombatSession(playerData(), [enemyData('Горящая цель', { magicDef: 100 })]);
    const target = session.state.enemies[0];
    target.shield = 30;
    addEffect(target, { id: 'burn', duration: 1 }, jest.fn(),
      { name: 'Пиромант', hp: 100, maxHp: 100, magAtk: 100 }, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    // 65 incoming Fire damage first spends 30 Shield, then 35 HP overflow / 2 -> 18.
    expect(target.shield).toBe(0);
    expect(target.hp).toBe(482);
  });

  test('source-less Bleed is treated identically by Decay', () => {
    const session = initCombatSession(playerData(), [enemyData()]);
    const target = session.state.enemies[0];
    addEffect(target, { id: 'decay', duration: 3 }, jest.fn(), session.state.players[0], { session });
    addEffect(target, { id: 'bleed', duration: 1, sourceAttack: 10 }, jest.fn(), null, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    expect(decayStored(target)).toBe(0);
  });

  test.each([
    ['gloom', { magAtk: 10 }],
    ['searing_mark', { magAtk: 10 }],
  ])('%s delayed status damage is periodic and excluded from Decay', (effectId, sourceStats) => {
    const session = initCombatSession(playerData(), [enemyData()]);
    const target = session.state.enemies[0];
    const source = { name: 'Источник эффекта', hp: 100, maxHp: 100, ...sourceStats };
    const contexts = [];
    target.abilities.push({
      name: 'Наблюдатель контекста',
      passive: true,
      onOwnerDamaged: ({ context }) => contexts.push(context),
    });
    addEffect(target, { id: 'decay', duration: 3 }, jest.fn(), session.state.players[0], { session });
    addEffect(target, { id: effectId, duration: 1 }, jest.fn(), source, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    expect(decayStored(target)).toBe(0);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      source,
      isPeriodic: true,
      directAttack: false,
      fromEffect: effectId,
      sourceEffectId: effectId,
    });
  });

  test('Fireball secondary damage is characterized as direct by the central path and accumulates', () => {
    const fireball = { ...ABILITY_LIBRARY['Огненный шар'], alwaysHits: true };
    const session = initCombatSession(playerData([fireball]), [enemyData('Основная'), enemyData('Вторичная')]);
    const [primary, secondary] = session.state.enemies;
    const contexts = [];
    secondary.abilities.push({
      name: 'Наблюдатель контекста',
      passive: true,
      onOwnerDamaged: ({ context }) => contexts.push(context),
    });
    addEffect(primary, { id: 'burn', duration: 2 }, jest.fn(), session.state.players[0], { session });
    addEffect(secondary, { id: 'decay', duration: 3 }, jest.fn(), session.state.players[0], { session });
    readyPlayer(session);

    performPlayerAction(session, 'Огненный шар', 0);

    expect(decayStored(secondary)).toBe(12.25); // 35 magical damage × 35%.
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ isPeriodic: false, directAttack: true });
  });

  test('Iron Counter retaliation is indirect but still accumulates in Decay', () => {
    const session = initCombatSession(playerData([attackAbility(1)]), [enemyData('Контратакующий')]);
    const player = session.state.players[0];
    const counter = session.state.enemies[0];
    const contexts = [];
    player.abilities.push({
      name: 'Наблюдатель контекста',
      passive: true,
      onOwnerDamaged: ({ context }) => contexts.push(context),
    });
    addEffect(player, { id: 'decay', duration: 3 }, jest.fn(), counter, { session });
    addEffect(counter, { id: 'iron_counter', duration: 2 }, jest.fn(), counter, { session });
    readyPlayer(session);

    performPlayerAction(session, 'Проверочный удар', 0);

    expect(player.hp).toBe(192);
    expect(decayStored(player)).toBeCloseTo(2.8);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      source: counter,
      isPeriodic: false,
      directAttack: false,
      fromEffect: 'iron_counter',
    });
  });

  test('sourced Bleed remains owned for Vampire Mark while Decay excludes it', () => {
    const session = initCombatSession(playerData(), [enemyData()]);
    const target = session.state.enemies[0];
    const markApplier = { name: 'Маг', hp: 40, maxHp: 100 };
    const bleedSource = { name: 'Лучник', hp: 40, maxHp: 100, attack: 10 };
    addEffect(target, { id: 'decay', duration: 3 }, jest.fn(), markApplier, { session });
    addEffect(target, { id: 'vampire_mark', duration: 3 }, jest.fn(), markApplier, { session });
    addEffect(target, { id: 'bleed', duration: 1 }, jest.fn(), bleedSource, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    expect(bleedSource.hp).toBe(43);
    expect(markApplier.hp).toBe(40);
    expect(decayStored(target)).toBe(0);
  });
});
