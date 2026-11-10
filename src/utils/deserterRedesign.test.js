import { allEnemies } from '../data/enemies';
import { ABILITY_LIBRARY, createAbilityByName } from '../data/abilityPresets';
import { addEffect, EFFECT_LIBRARY, getEffectStackCount } from './effects';
import { applyDamage, checkBattleOutcome, initCombatSession, performPlayerAction, processEnemyAI, resolveElementalReactionBatch } from './combatUtils';
import { applyDeserterAlertModifier, getDeserterAlertLevel } from './enemyPools';
import { beginCombatPresentation, consumeCombatPresentationEvents } from './combatPresentationEvents';

const blueprint = name => allEnemies.find(enemy => enemy.name === name);
const hero = (overrides = {}) => ({
  name: 'Герой', class: 'Defender', hp: 200, maxHp: 200, attack: 30, physDef: 0, magicDef: 0,
  speed: 100, critChance: 0, abilities: [createAbilityByName('Атака')], ...overrides,
});
const forceEnemyTurn = (session, enemy = session.state.enemies[0]) => {
  session.state.players[0].turnMeter = 0;
  session.state.enemies.forEach(unit => { if (!unit.nonActingCombatObject) unit.turnMeter = unit === enemy ? 1000 : 0; });
  return processEnemyAI(session);
};

describe('Deserter Camp production runtime', () => {
  test.each([[0,0],[2,0],[3,1],[5,1],[6,2],[8,2],[9,3]])('alert threshold %i -> %i', (fights, level) => expect(getDeserterAlertLevel(fights)).toBe(level));

  test('Ready reaches hydrated initiative exactly once and carries Alert into Field Kit', () => {
    const encounter = applyDeserterAlertModifier({ enemies: [blueprint('Аптекарь')], completedCombatRooms: 6, pool: [], rng: () => 0 });
    const session = initCombatSession(hero(), encounter.enemies);
    const apothecary = session.state.enemies[0];
    expect(session.alertLevel).toBe(2);
    expect(apothecary.turnMeter).toBe(150);
    expect(getEffectStackCount(apothecary, 'supplies')).toBe(3);
    forceEnemyTurn(session, apothecary);
    expect(apothecary.turnMeter).toBeLessThan(1000);
    expect(apothecary._startingTurnMeterApplied).toBe(true);
  });

  test('preparation damage uses Shield/Defense pipeline and canonical control cancels before resolution', () => {
    const session = initCombatSession(hero({ physDef: 50, preCombatEffects: [{ id: 'shield', duration: 3, value: 30 }] }), [blueprint('Громила')], { rng: () => 0.99 });
    const brute = session.state.enemies[0]; const target = session.state.players[0];
    ABILITY_LIBRARY['Тяжёлый замах'].apply({ attacker: brute, target, session, log: jest.fn() });
    const hpBefore = target.hp;
    forceEnemyTurn(session, brute);
    expect(target.hp).toBeGreaterThan(hpBefore - brute.attack * 2);
    expect(target.lastAbsorbed).toBeGreaterThan(0);

    ABILITY_LIBRARY['Тяжёлый замах'].apply({ attacker: brute, target, session, log: jest.fn() });
    addEffect(brute, { id: 'stun', duration: 1 }, jest.fn(), target, { session });
    const controlledHp = target.hp;
    forceEnemyTurn(session, brute);
    expect(target.hp).toBe(controlledHp);
    expect(brute._preparation).toBeNull();
  });

  test('Ranger preparation receives only a new other-source debuff bonus', () => {
    const ranger = blueprint('Следопыт');
    const base = initCombatSession(hero({ physDef: 0 }), [ranger, blueprint('Чернокнижник')], { rng: () => 0.99 });
    const [runtimeRanger, warlock] = base.state.enemies; const target = base.state.players[0];
    ABILITY_LIBRARY['Выжидающий выстрел'].apply({ attacker: runtimeRanger, target, session: base, log: jest.fn() });
    addEffect(target, { id: 'vulnerability', duration: 1 }, jest.fn(), warlock, { session: base });
    const before = target.hp; forceEnemyTurn(base, runtimeRanger);
    expect(before - target.hp).toBeGreaterThanOrEqual(Math.round(runtimeRanger.attack * 1.5));
  });

  test('Snares never act, direct basic disarms safely, and do not block victory', () => {
    const session = initCombatSession(hero(), [blueprint('Следопыт')], { rng: () => 0.99 });
    const ranger = session.state.enemies[0];
    ABILITY_LIBRARY['Силки'].apply({ attacker: ranger, session, log: jest.fn() });
    const snare = session.state.enemies.find(unit => unit.nonActingCombatObject);
    expect(snare.turnMeter).toBeNull(); expect(snare.abilities).toEqual([]);
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Атака', session.state.enemies.indexOf(snare));
    expect(snare.hp).toBe(0);
    expect(session.state.metrics.snaresTriggered || 0).toBe(0);
    expect(session.state.metrics.snaresSafeDisarmed).toBe(1);

    ABILITY_LIBRARY['Силки'].apply({ attacker: ranger, session, log: jest.fn() });
    applyDamage(ranger, 999, 'pure', { source: session.state.players[0], session });
    expect(checkBattleOutcome(session).victory).toBe(true);
  });

  test('active ability triggers Snares once and applies Strong Slow', () => {
    const active = { ...createAbilityByName('Атака'), name: 'Проверочная способность', basic: false, cooldown: 1, classTags: ['defender'] };
    const session = initCombatSession(hero({ abilities: [active] }), [blueprint('Следопыт')], { rng: () => 0.99 });
    ABILITY_LIBRARY['Силки'].apply({ attacker: session.state.enemies[0], session, log: jest.fn() });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Проверочная способность', 0);
    expect(session.state.metrics.snaresTriggered).toBe(1);
    expect(session.state.players[0].effects.some(effect => effect.id === 'speed_penalty_major')).toBe(true);
  });

  test('Curse of Exhaustion adds one cooldown to the exact active and empowers caster', () => {
    const active = { name: 'Классовый навык', damage: 1, type: 'physical', cooldown: 2, classTags: ['defender'] };
    const session = initCombatSession(hero({ abilities: [active, createAbilityByName('Атака')] }), [blueprint('Чернокнижник')], { rng: () => 0.99 });
    const warlock = session.state.enemies[0]; const player = session.state.players[0];
    addEffect(player, { id: 'curse_of_exhaustion', duration: 3 }, jest.fn(), warlock, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Классовый навык', 0);
    expect(player.abilities.find(ability => ability.name === 'Классовый навык').currentCooldown).toBe(3);
    expect(warlock._exhaustionEmpowered).toBe(true);
    expect(player.effects.some(effect => effect.id === 'curse_of_exhaustion')).toBe(false);
  });

  test('targeted miss makes Trickster Invisible', () => {
    const session = initCombatSession(hero({ accuracy: 0.05 }), [blueprint('Трюкач')], { rng: () => 0.99 });
    addEffect(session.state.enemies[0], { id: 'evasion', duration: 1 });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Атака', 0);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'invisibility')).toBe(true);
  });

  test('global boss control immunity excludes Blind and permits ordinary damage debuffs', () => {
    allEnemies.filter(enemy => enemy.boss || enemy.miniBoss).forEach(enemy => {
      const target = { ...enemy, effects: [] };
      expect(addEffect(target, { id: 'stun', duration: 1 })).toBeNull();
      ['blind', 'bleed', 'burn', 'poison'].forEach(id => expect(addEffect(target, { id, duration: 1 })).not.toBeNull());
    });
  });

  test('Elementalist control fallback is specific to innate control rejection', () => {
    const boss = { ...blueprint('Мастер клинков'), effects: [] };
    expect(addEffect(boss, { id: 'freeze', duration: 1 }, jest.fn(), hero({ class: 'Mage' }), { elementalistControlFallback: true })?.id).toBe('ice_shards');
    const blocked = { name: 'Blocked', hp: 10, maxHp: 10, effects: [], blockDebuffs: true, controlImmune: true };
    expect(addEffect(blocked, { id: 'shock' }, jest.fn(), hero({ class: 'Mage' }), { elementalistControlFallback: true })).toBeNull();
    expect(blocked.effects).toHaveLength(0);
    expect(EFFECT_LIBRARY.charge.elementalState).toBe('lightning');
    expect(EFFECT_LIBRARY.charring.elementalState).toBe('fire');
  });
  test('Duelist gains at most one Rhythm per multihit action', () => {
    const strike = { name: 'Тройной тест', cooldown: 0, hits: 3, damage: 5, type: 'physical' };
    const unit = { ...blueprint('Дуэлянт'), abilities: [strike, ABILITY_LIBRARY['Школа дуэлянта']] };
    const session = initCombatSession(hero({ hp: 1000, maxHp: 1000 }), [unit], { rng: () => 0.99 });
    forceEnemyTurn(session);
    expect(session.state.enemies[0].effects.filter(effect => effect.id === 'combat_rhythm')).toHaveLength(1);
  });

  test('Storm Order makes a physical ally turn count as Lightning and Conductor shocks on 3 consecutive turns', () => {
    const storm = blueprint('Заклинатель бурь');
    const ally = { ...blueprint('Громила'), abilities: [{ name: 'Физический тест', cooldown: 0, damage: 5, type: 'physical' }] };
    const session = initCombatSession(hero({ hp: 1000, maxHp: 1000 }), [storm, ally], { rng: () => 0.99 });
    const [caller, fighter] = session.state.enemies;
    for (let turn = 0; turn < 3; turn += 1) {
      ABILITY_LIBRARY['Грозовой приказ'].apply({ attacker: caller, target: fighter, session });
      forceEnemyTurn(session, fighter);
    }
    expect(session.state.metrics.stormConductorProcs).toBe(1);
    expect(session.state.players[0].pendingShockSkip || session.state.log.some(line => line.includes('Проводник грозы'))).toBeTruthy();
  });

  test('Storm Shield retaliates once per deliberate action and not as an enemy-turn conductor event', () => {
    const session = initCombatSession(hero({ hp: 500, maxHp: 500 }), [blueprint('Заклинатель бурь')], { rng: () => 0.99 });
    const caller = session.state.enemies[0]; const player = session.state.players[0];
    ABILITY_LIBRARY['Грозовой щит'].apply({ attacker: caller, target: caller, session, log: jest.fn() });
    const action = { actorId: player.id };
    const before = player.hp;
    applyDamage(caller, 5, 'physical', { source: player, session, directAttack: true, deliberateAction: action });
    const once = player.hp;
    applyDamage(caller, 5, 'physical', { source: player, session, directAttack: true, deliberateAction: action });
    expect(once).toBeLessThan(before);
    expect(player.hp).toBe(once);
    expect(player._enemyTurnLightningPositive).not.toBe(true);
  });

  test('Wound Opening forces Bleed and Barrier Fracture uses actual destroyed Shield accounting', () => {
    const session = initCombatSession(hero({ hp: 500, maxHp: 500 }), [blueprint('Осквернённый рубака')], { rng: () => 0.99 });
    const berserker = session.state.enemies[0]; const player = session.state.players[0];
    addEffect(player, { id: 'bleed', duration: 3 }, jest.fn(), berserker, { session });
    const before = player.hp;
    ABILITY_LIBRARY['Вскрыть рану'].apply({ attacker: berserker, target: player, session, deliberateAction: { vampireHealingBefore: 0 }, log: jest.fn() });
    expect(player.hp).toBeLessThan(before);
    expect(player.effects.find(effect => effect.id === 'bleed').remainingTurns).toBe(2);

    const guard = initCombatSession(hero({ preCombatEffects: [{ id: 'shield', duration: 3, value: 20 }] }), [blueprint('Искажённый страж')]).state.enemies[0];
    const guardSession = initCombatSession(hero(), [blueprint('Искажённый страж')]);
    const runtimeGuard = guardSession.state.enemies[0];
    const shieldBefore = runtimeGuard.shield;
    ABILITY_LIBRARY['Разлом барьера'].apply({ attacker: runtimeGuard, session: guardSession, deliberateAction: { shieldDestroyed: 10 }, log: jest.fn() });
    expect(runtimeGuard.shield - shieldBefore).toBe(5);
    expect(guard).toBeDefined();
  });

  test('Master of Blades preparation durability is not Shield and Broken Oath does not refill it', () => {
    const session = initCombatSession(hero({ hp: 1000, maxHp: 1000 }), [blueprint('Мастер клинков')], { rng: () => 0.99 });
    const boss = session.state.enemies[0];
    boss._preparation = { kind: 'blade_dance', resolveName: 'Танец клинков', damageMultiplier: .55, hits: 3, durability: 80, maxDurability: 80 };
    const hp = boss.hp;
    applyDamage(boss, 20, 'pure', { source: session.state.players[0], session });
    expect(boss.hp).toBe(hp - 20);
    expect(boss._preparation.durability).toBe(60);
    applyDamage(boss, boss.hp - Math.floor(boss.maxHp * .5) + 1, 'pure', { source: session.state.players[0], session });
    expect(boss._brokenOathTriggered).toBe(true);
    expect(boss._preparation).toBeNull();
    expect(session.state.metrics.bladePreparationsBroken).toBe(1);
  });

  test('generic maxStacks caps Ice Shards, Charring and Combat Rhythm but not Poison', () => {
    const target = { name: 'Цель', hp: 1000, maxHp: 1000, physDef: 0, magicDef: 0, effects: [] };
    const source = { id: 'mage', name: 'Маг', magAtk: 100 };
    for (let index = 0; index < 4; index += 1) addEffect(target, { id: 'ice_shards', duration: 3 }, jest.fn(), source);
    expect(target.effects.filter(effect => effect.id === 'ice_shards')).toHaveLength(3);
    applyDamage(target, 1, 'pure', { source: { name: 'Другой' }, directAttack: true, deliberateAction: {} });
    expect(target.effects.filter(effect => effect.id === 'ice_shards')).toHaveLength(2);
    for (let index = 0; index < 4; index += 1) addEffect(target, { id: 'charring' }, jest.fn(), source);
    for (let index = 0; index < 4; index += 1) addEffect(target, { id: 'combat_rhythm' }, jest.fn(), source);
    for (let index = 0; index < 4; index += 1) addEffect(target, { id: 'poison' }, jest.fn(), source);
    expect(target.effects.filter(effect => effect.id === 'charring')).toHaveLength(3);
    expect(target.effects.filter(effect => effect.id === 'combat_rhythm')).toHaveLength(3);
    expect(target.effects.filter(effect => effect.id === 'poison')).toHaveLength(4);
  });

  test('maxStacks overflow returns null without reporting a successful application', () => {
    const source = { id: 'mage', name: 'Маг', magAtk: 100 };
    const target = { id: 'target', name: 'Цель', hp: 100, maxHp: 100, effects: [] };
    const session = { state: { players: [source], enemies: [target] } };
    beginCombatPresentation(session);
    for (let index = 0; index < 3; index += 1) {
      expect(addEffect(target, { id: 'ice_shards' }, jest.fn(), source, { session })).not.toBeNull();
    }
    expect(consumeCombatPresentationEvents(session).filter(event => event.type === 'statusApplied')).toHaveLength(3);

    beginCombatPresentation(session);
    expect(addEffect(target, { id: 'ice_shards' }, jest.fn(), source, { session })).toBeNull();
    expect(target.effects.filter(effect => effect.id === 'ice_shards')).toHaveLength(3);
    expect(consumeCombatPresentationEvents(session)).toHaveLength(0);
  });

  test.each([[150, 160], [60, 70]])('Ice Shards use current source MagAtk %i at proc time', (currentMagAtk, expectedLoss) => {
    const shardOwner = { id: 'mage', name: 'Маг', hp: 50, maxHp: 100, magAtk: 100, effects: [] };
    const breaker = { id: 'defender', name: 'Защитник', attack: 10 };
    const target = { name: 'Цель', hp: 1000, maxHp: 1000, physDef: 0, magicDef: 0, effects: [] };
    for (let index = 0; index < 3; index += 1) addEffect(target, { id: 'ice_shards' }, jest.fn(), shardOwner);
    addEffect(target, { id: 'vampire_mark', duration: 2 }, jest.fn(), shardOwner);
    shardOwner.magAtk = currentMagAtk;
    const before = target.hp;
    applyDamage(target, 10, 'pure', { source: breaker, directAttack: true, deliberateAction: {} });
    expect(before - target.hp).toBe(expectedLoss);
    expect(shardOwner.hp).toBeGreaterThan(50); // shard damage source remains the Mage, not the breaker
  });

  test('Charge discharges on the third stack and a fourth application starts a fresh stack', () => {
    const source = { id: 'mage', name: 'Маг', magAtk: 100 };
    const target = { name: 'Цель', hp: 1000, maxHp: 1000, physDef: 0, magicDef: 0, effects: [] };
    const session = { state: { players: [source], enemies: [target], log: [] } };
    session.applyIndirectDamage = (unit, amount, type, extra) => applyDamage(unit, amount, type, { ...extra, session });
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session });
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session });
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session });
    expect(target.hp).toBe(920);
    expect(target.effects.filter(effect => effect.id === 'charge')).toHaveLength(0);
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session });
    expect(target.effects.filter(effect => effect.id === 'charge')).toHaveLength(1);
  });

  test('elemental reaction consumes Ice Shards without a separate shard proc', () => {
    const mage = { id: 'mage', name: 'Маг', class: 'Mage', hp: 100, maxHp: 100, magAtk: 100, effects: [] };
    const target = { name: 'Цель', hp: 1000, maxHp: 1000, physDef: 0, magicDef: 0, effects: [] };
    const session = { state: { players: [mage], enemies: [target], log: [] } };
    for (let index = 0; index < 3; index += 1) addEffect(target, { id: 'ice_shards' }, jest.fn(), mage, { session });
    const before = target.hp;
    applyDamage(target, 10, 'pure', { source: mage, session, directAttack: true, deliberateAction: { incomingElementSchool: 'fire' } });
    resolveElementalReactionBatch({ source: mage, targets: [target], incomingSchool: 'fire', session, logFn: jest.fn() });
    expect(target.effects.some(effect => effect.id === 'ice_shards')).toBe(false);
    expect(before - target.hp).toBeLessThan(150); // direct hit + reaction, but no extra 100% shard explosion
  });

});
