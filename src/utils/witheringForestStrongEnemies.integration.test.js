import fs from 'fs';
import path from 'path';
import { createAbilityByName, WITHERING_FOREST_TUNING } from '../data/abilityPresets';
import { createEnemyInstanceByName, getEnemyBlueprintByName, enemies } from '../data/enemies';
import { resolveEnemyPortrait } from '../data/combatAssets';
import { addEffect, getEffectStackCount } from './effects';
import { applyDamage, initCombatSession, processEnemyAI, selectEnemyAction } from './combatUtils';
import { createWitheringForestEncounter } from './enemyPools';

const hero = (overrides = {}) => ({
  name: 'Герой', hp: 500, maxHp: 500, attack: 20, speed: 100,
  physDef: 0, magicDef: 0, effects: [], abilities: ['Атака'],
  currentLocation: 'Лес Увядания', ...overrides,
});
const sessionFor = (enemyNames, player = hero()) => initCombatSession(
  player, enemyNames.map(createEnemyInstanceByName), { rng: () => 0.99 }
);
const ready = (session, actor) => {
  actor.turnMeter = 1000;
  session.state.players.forEach(unit => { unit.turnMeter = 999; });
  session.state.enemies.forEach(unit => { if (unit !== actor) unit.turnMeter = 0; });
  session.state.initiative.playerReady = false;
};
const act = (session, actor) => { ready(session, actor); processEnemyAI(session); };

it('authors the three strong enemies without a second difficulty multiplier and resolves their real WebP portraits', () => {
  const expected = {
    'Жнец лесов': [492, 25, 1, 14, 9, 129, 'forest_reaper'],
    'Совиный друид': [436, 19, 18, 8, 14, 141, 'owl_druid'],
    'Друид-медведь': [620, 22, 8, 22, 15, 114, 'bear_druid'],
  };
  Object.entries(expected).forEach(([name, [maxHp, attack, magAtk, physDef, magicDef, speed, portraitKey]]) => {
    expect(getEnemyBlueprintByName(name)).toMatchObject({ maxHp, hp: maxHp, attack, magAtk, physDef, magicDef, speed, portraitKey, encounterPhase: 'late' });
    expect(createEnemyInstanceByName(name)).toMatchObject({ maxHp, attack, difficultyTier: 'normal' });
    const url = resolveEnemyPortrait({ portraitKey });
    expect(url).toBe(`/assets/combat/portraits/enemies/withering_forest/${portraitKey}.webp`);
    expect(fs.existsSync(path.join('public', url))).toBe(true);
  });
});

describe('Forest Reaper', () => {
  test('Mow uses area targeting, damages the whole player side, and adds two Entanglement stacks to each hit target', () => {
    const session = sessionFor(['Жнец лесов']);
    const reaper = session.state.enemies[0];
    session.state.players.push({ ...hero({ id: 'summon', name: 'Призыв', hp: 100, maxHp: 100 }), summoned: true, turnMeter: 0 });
    expect(selectEnemyAction(reaper, session)?.ability.name).toBe('Покос');
    act(session, reaper);
    expect(session.state.players[0].hp).toBe(474);
    expect(session.state.players[1].hp).toBe(74);
    expect(getEffectStackCount(session.state.players[0], 'entanglement')).toBe(2);
    expect(getEffectStackCount(session.state.players[1], 'entanglement')).toBe(2);
  });

  test.each([0, 1, 2, 3, 4, 5])('Root Harvest uses and consumes at most three of %i Entanglement stacks', stacks => {
    const ability = createAbilityByName('Жатва корней');
    const target = hero();
    if (stacks > 0) addEffect(target, { id: 'entanglement', stacks }, () => {});
    const consumed = Math.min(3, stacks);
    expect(ability.damage({ attacker: { attack: 100 }, target })).toBe(Math.round(100 * (1.65 + consumed * 0.25)));
    ability.apply({ target, log: () => {} });
    expect(getEffectStackCount(target, 'entanglement')).toBe(stacks - consumed);
  });

  test('Root Harvest requires Entanglement outside execute range and applies Healing Curse for one turn on hit', () => {
    const session = sessionFor(['Жнец лесов'], hero({ hp: 500, maxHp: 500 }));
    const reaper = session.state.enemies[0];
    const harvest = reaper.abilities.find(ability => ability.name === 'Жатва корней');
    expect(harvest.canUse({ target: session.state.players[0] })).toBe(false);
    addEffect(session.state.players[0], { id: 'entanglement', stacks: 2 }, () => {});
    expect(harvest.canUse({ target: session.state.players[0] })).toBe(true);
    harvest.currentCooldown = 0;
    reaper.abilities.find(ability => ability.name === 'Покос').currentCooldown = 2;
    act(session, reaper);
    const curse = session.state.players[0].effects.find(effect => effect.id === 'healing_curse');
    expect(curse?.remainingTurns ?? curse?.duration).toBe(1);

    const executeTarget = hero({ hp: 175, maxHp: 500 });
    expect(harvest.canUse({ target: executeTarget })).toBe(true);
  });

  test('execute modifies each eligible direct packet, but not passive, DoT or reflection-like damage', () => {
    const passive = createAbilityByName('Безжалостная жатва');
    const target = hero({ hp: 175 });
    expect(passive.modifyDamage({ damage: 100, target, ability: { name: 'Атака' } })).toBe(130);
    expect(passive.modifyDamage({ damage: 100, target, ability: { isSecondaryDamage: true } })).toBe(130);
    expect(passive.modifyDamage({ damage: 100, target, ability: { passive: true } })).toBe(100);
    target.hp = 176;
    expect(passive.modifyDamage({ damage: 100, target, ability: { name: 'Атака' } })).toBe(100);
    const reaper = createEnemyInstanceByName('Жнец лесов');
    const before = reaper.hp;
    applyDamage(reaper, 20, 'pure', { source: target, fromEffect: 'poison', isPeriodic: true });
    expect(before - reaper.hp).toBe(20);
  });
});

describe('Owl Druid', () => {
  test('Grasping Roots applies exactly two Entanglement stacks', () => {
    const session = sessionFor(['Совиный друид']);
    const owl = session.state.enemies[0];
    expect(selectEnemyAction(owl, session)?.ability.name).toBe('Цепкие корни');
    act(session, owl);
    expect(getEffectStackCount(session.state.players[0], 'entanglement')).toBe(2);
  });

  test('Wingbeat shifts 15% turn meter each way and Lightness halves only hostile loss', () => {
    const session = sessionFor(['Совиный друид', 'Совиный друид']);
    const [attacker, target] = session.state.enemies;
    attacker.abilities.find(ability => ability.name === 'Цепкие корни').currentCooldown = 3;
    attacker.turnMeter = 100;
    target.turnMeter = 600;
    const wingbeat = attacker.abilities.find(ability => ability.name === 'Взмах крыла');
    wingbeat.apply({ attacker, target });
    expect(attacker.turnMeter).toBe(250);
    expect(target.turnMeter).toBe(525);
    attacker.turnMeter = 900;
    wingbeat.apply({ attacker, target: session.state.players[0] });
    expect(attacker.turnMeter).toBe(1000);
  });

  test.each([
    ['speed_penalty_minor', 90],
    ['speed_penalty_major', 85],
  ])('Lightness halves %s while surviving JSON restoration', (effectId, expectedSpeed) => {
    const session = sessionFor(['Совиный друид']);
    const restored = JSON.parse(JSON.stringify(session.state.enemies[0]));
    addEffect(restored, { id: effectId, duration: 2 }, () => {}, session.state.players[0], { session });
    expect(restored.speed).toBe(Math.round(141 * expectedSpeed / 100));
    restored.turnMeter = 100;
    restored.turnMeter = Math.min(1000, restored.turnMeter + 150);
    expect(restored.turnMeter).toBe(250);
  });
});

describe('Bear Druid', () => {
  test('Bear Charge applies the systemic one-turn Stun only after a hit', () => {
    const session = sessionFor(['Друид-медведь']);
    const bear = session.state.enemies[0];
    expect(selectEnemyAction(bear, session)?.ability.name).toBe('Медвежий натиск');
    act(session, bear);
    expect(session.state.players[0].effects.find(effect => effect.id === 'stun')).toMatchObject({ remainingTurns: 1 });
  });

  test('Oak Recovery is unavailable at full HP and combines 10% immediate healing with systemic Regeneration', () => {
    const session = sessionFor(['Друид-медведь']);
    const bear = session.state.enemies[0];
    expect(selectEnemyAction(bear, session)?.ability.name).not.toBe('Дубовое восстановление');
    bear.hp = 180;
    bear.abilities.find(ability => ability.name === 'Медвежий натиск').currentCooldown = 2;
    expect(selectEnemyAction(bear, session)?.ability.name).toBe('Дубовое восстановление');
    act(session, bear);
    expect(bear.hp).toBe(242);
    expect(bear.effects.find(effect => effect.id === 'regeneration')).toMatchObject({ remainingTurns: 2 });
  });

  test('Bestial Fury triggers once on a large threshold crossing and its serialized flag prevents retriggering', () => {
    const session = sessionFor(['Друид-медведь']);
    const bear = session.state.enemies[0];
    applyDamage(bear, 380, 'pure', { source: session.state.players[0], session, directAttack: true });
    expect(bear.hp).toBe(240);
    expect(bear._bestialFuryTriggered).toBe(true);
    expect(bear.effects.find(effect => effect.id === 'control_immunity')).toMatchObject({ remainingTurns: 2 });
    const saved = JSON.parse(JSON.stringify({ ...bear, effects: [], abilities: [] }));
    const restored = {
      ...createEnemyInstanceByName('Друид-медведь'), hp: saved.hp,
      _bestialFuryTriggered: saved._bestialFuryTriggered, effects: [],
    };
    expect(restored._bestialFuryTriggered).toBe(true);
    applyDamage(restored, 1, 'pure', { source: session.state.players[0], session: { ...session, state: { ...session.state, enemies: [restored] } }, directAttack: true });
    expect(restored.effects.some(effect => effect.id === 'control_immunity')).toBe(false);
  });
});

it('the existing authored strong table now resolves from the real roster after seven combats and never contains two Owls', () => {
  const forest = enemies.filter(enemy => enemy.location === 'Лес Увядания');
  const early = createWitheringForestEncounter(forest, () => 0.999999, { completedCombatRooms: 6 });
  const late = createWitheringForestEncounter(forest, () => 0.999999, { completedCombatRooms: 7 });
  expect(early.encounterStrength).toBe('normal');
  expect(late.encounterStrength).toBe('strong');
  expect(late.enemies.filter(enemy => enemy.roomRole === 'strongEnemy')).toHaveLength(1);
  for (let step = 0; step < 100; step += 1) {
    const encounter = createWitheringForestEncounter(forest, () => step / 100, { completedCombatRooms: 7 });
    expect(encounter.enemies.filter(enemy => enemy.name === 'Совиный друид').length).toBeLessThanOrEqual(1);
  }
  expect(WITHERING_FOREST_TUNING.owlWingbeatTurnMeter).toBe(150);
});
