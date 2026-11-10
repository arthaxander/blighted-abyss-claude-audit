import { createAbilityByName } from '../data/abilityPresets';
import { getEnemyBlueprintByName, createEnemyInstanceByName } from '../data/enemies';
import { addEffect, EFFECT_IDS, getEffectDefinition } from './effects';
import { getEligibleHostileUnits, getValidCombatTargets } from './combatTargeting';
import { applyDamage, initCombatSession, performPlayerAction, processEnemyAI, selectEnemyAction } from './combatUtils';
import { getThornReflectionDamage, THORN_REFLECTION_RATIO } from './witheringForestThornGuard';

const hero = (abilities = ['Атака']) => ({
  name: 'Герой', hp: 200, maxHp: 200, attack: 20, magAtk: 30,
  speed: 100, physDef: 0, magicDef: 0, abilities,
  currentLocation: 'Лес Увядания',
});
const make = (enemies = [createEnemyInstanceByName('Терновый страж')], abilities) =>
  initCombatSession(hero(abilities), enemies, { rng: () => 0.99 });
const dummy = () => ({ name: 'Манекен', hp: 500, maxHp: 500, attack: 1, speed: 1 });
const thorns = target => (target.abilities || []).some(a => a.name === 'Ответные шипы');

describe('Forest Thorn Guard definition and status', () => {
  test('authored normal stats, portrait, skill, passive and cooldowns', () => {
    expect(getEnemyBlueprintByName('Терновый страж')).toEqual(expect.objectContaining({
      location: 'Лес Увядания', maxHp: 440, hp: 440, attack: 17,
      magAtk: 1, physDef: 20, magicDef: 12, speed: 110,
      portraitKey: 'thorn_guard',
      abilityNames: ['Терновый заслон', 'Ответные шипы'],
    }));
    expect(createEnemyInstanceByName('Терновый страж')).toEqual(expect.objectContaining({
      maxHp: 440, hp: 440, difficultyTier: 'normal', portraitKey: 'thorn_guard',
    }));
    expect(thorns(createEnemyInstanceByName('Терновый страж'))).toBe(true);
    expect(createAbilityByName('Терновый заслон')).toMatchObject({
      cooldown: 4, targeting: 'self', effect: { id: 'guard', duration: 2 },
    });
    expect(createAbilityByName('Ответные шипы').passive).toBe(true);
  });

  test('Guard is a two-turn refresh-only buff and cannot duplicate', () => {
    expect(EFFECT_IDS['Защита союзников']).toBe('guard');
    expect(getEffectDefinition('guard')).toMatchObject({
      type: 'buff', defaultDuration: 2, stacking: 'refresh',
    });
    const target = { name: 'Страж', hp: 220, maxHp: 220, effects: [] };
    addEffect(target, { id: 'guard', duration: 1 }, () => {});
    addEffect(target, { id: 'guard', duration: 2 }, () => {});
    expect(target.effects.filter(effect => effect.id === 'guard')).toHaveLength(1);
    expect(target.effects.find(effect => effect.id === 'guard').remainingTurns).toBe(2);
    expect(JSON.parse(JSON.stringify(target.effects))[0].id).toBe('guard');
  });

  test('real Guard turn casts protection; AI does not redundantly refresh it', () => {
    const session = make();
    const guard = session.state.enemies[0];
    expect(selectEnemyAction(guard, session)?.ability.name).toBe('Терновый заслон');
    guard.turnMeter = 1000;
    processEnemyAI(session);
    expect(guard.effects.some(effect => effect.id === 'guard')).toBe(true);
    expect(guard.abilities.find(ability => ability.name === 'Терновый заслон').currentCooldown).toBe(4);
    guard.abilities.find(ability => ability.name === 'Терновый заслон').currentCooldown = 0;
    expect(selectEnemyAction(guard, session)?.ability.name).toBe('Атака');
  });
});

describe('Guard targeting enforced in executor (not just UI)', () => {
  test('shared selector prioritizes visible living Guards and preserves all-hidden fallback', () => {
    const invisible = { name: 'Тень', hp: 10, invisible: true, effects: [{ id: 'guard' }] };
    const ordinary = { name: 'Обычный', hp: 10, effects: [] };
    expect(getEligibleHostileUnits([invisible, ordinary])).toEqual([ordinary]);
    ordinary.hp = 0;
    expect(getEligibleHostileUnits([invisible, ordinary])).toEqual([invisible]);
    expect(getEligibleHostileUnits([invisible, ordinary], { area: true })).toEqual([invisible]);
  });

  test('direct hero action cannot bypass Guard through an explicit enemy index', () => {
    const session = make([dummy(), createEnemyInstanceByName('Терновый страж')]);
    const [normal, guard] = session.state.enemies;
    addEffect(guard, { id: 'guard', duration: 2 }, () => {});
    expect(getValidCombatTargets({ action: { targeting: 'enemy' }, players: session.state.players, enemies: session.state.enemies }).map(t => t.unit)).toEqual([guard]);
    session.state.initiative.playerReady = true;
    const result = performPlayerAction(session, 'Атака', 0);
    expect(result.turnConsumed).toBe(true);
    expect(normal.hp).toBe(normal.maxHp);
    expect(guard.hp).toBeLessThan(guard.maxHp);
  });

  test('AoE reaches the non-Guard as well as the Guard', () => {
    const sweep = { name: 'Проверочный залп', type: 'physical', targeting: 'allEnemies', damage: 30, cooldown: 0, alwaysHits: true };
    const session = make([dummy(), createEnemyInstanceByName('Терновый страж')], [sweep]);
    const [normal, guard] = session.state.enemies;
    addEffect(guard, { id: 'guard', duration: 2 }, () => {});
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Проверочный залп', 0).turnConsumed).toBe(true);
    expect(normal.hp).toBeLessThan(normal.maxHp);
    expect(guard.hp).toBeLessThan(guard.maxHp);
  });

  test('friendly summon AI also attacks a visible Guard before other enemies', () => {
    const session = make([dummy(), createEnemyInstanceByName('Терновый страж')]);
    const [normal, guard] = session.state.enemies;
    addEffect(guard, { id: 'guard', duration: 2 }, () => {});
    expect(session.summonPlayer('fire_elemental', { source: session.state.players[0] }).success).toBe(true);
    session.state.players[1].turnMeter = 1000;
    processEnemyAI(session);
    expect(normal.hp).toBe(normal.maxHp);
    expect(guard.hp).toBeLessThan(guard.maxHp);
  });
});

describe('Thorns: actual HP, pure indirect damage, no loops', () => {
  test('reflects exactly 15% of actual direct HP loss, bypassing attacker Shield', () => {
    expect(THORN_REFLECTION_RATIO).toBe(0.15);
    const session = make();
    const guard = session.state.enemies[0];
    const attacker = session.state.players[0];
    addEffect(attacker, { id: 'shield', duration: 2, value: 100 }, () => {});
    const beforeShield = attacker.shield;
    expect(applyDamage(guard, 40, 'pure', { source: attacker, session, directAttack: true })).toBe(40);
    expect(guard.hp).toBe(180);
    expect(attacker.hp).toBe(194);
    expect(attacker.shield).toBe(beforeShield);
  });

  test('shield-only damage, DoT and indirect damage do not reflect; disabled passive does not fire', () => {
    const session = make();
    const guard = session.state.enemies[0];
    const attacker = session.state.players[0];
    addEffect(guard, { id: 'shield', duration: 2, value: 100 }, () => {});
    applyDamage(guard, 40, 'pure', { source: attacker, session, directAttack: true });
    expect(attacker.hp).toBe(200);
    guard.shield = 0;
    guard.effects = guard.effects.filter(effect => effect.id !== 'shield');
    applyDamage(guard, 40, 'pure', { source: attacker, session, isPeriodic: true, fromEffect: 'poison' });
    applyDamage(guard, 40, 'pure', { source: attacker, session, directAttack: false });
    expect(attacker.hp).toBe(200);
    guard.passivesDisabled = true;
    applyDamage(guard, 40, 'pure', { source: attacker, session, directAttack: true });
    expect(attacker.hp).toBe(200);
  });

  test('does not reflect reflected damage recursively, even if both sides have Thorns', () => {
    const session = make();
    const guard = session.state.enemies[0];
    const attacker = session.state.players[0];
    attacker.abilities.push(createAbilityByName('Ответные шипы'));
    applyDamage(guard, 40, 'pure', { source: attacker, session, directAttack: true });
    expect(guard.hp).toBe(180);
    expect(attacker.hp).toBe(194);
    expect(getThornReflectionDamage(guard, { source: attacker, actualHpLost: 40, fromEffect: 'thorn_reflection', directAttack: false })).toBe(0);
  });

  test('lethal and overkill hit reflects only real HP lost', () => {
    const session = make();
    const guard = session.state.enemies[0];
    const attacker = session.state.players[0];
    guard.hp = 20;
    applyDamage(guard, 100, 'pure', { source: attacker, session, directAttack: true });
    expect(guard.hp).toBe(0);
    expect(attacker.hp).toBe(197);
  });
});
