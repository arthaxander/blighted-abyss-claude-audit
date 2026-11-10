import fs from 'fs';
import path from 'path';
import { createAbilityByName, WITHERING_FOREST_TUNING } from '../data/abilityPresets';
import { createEnemyInstanceByName, getEnemyBlueprintByName } from '../data/enemies';
import { resolveEnemyPortrait } from '../data/combatAssets';
import { addEffect, getEffectStackCount, processSourceTurnStartEffects } from './effects';
import {
  applyDamage, initCombatSession, processEnemyAI, selectEnemyAction,
} from './combatUtils';
import { reviveCombatSession, snapshotCombatSession } from '../components/CombatScreen';
import { beginCombatPresentation, consumeCombatPresentationEvents } from './combatPresentationEvents';

const ARCHON = 'Архонт Цветения';
const hero = overrides => ({
  id: 'hero', name: 'Герой', hp: 1000, maxHp: 1000, attack: 100, magAtk: 50,
  speed: 100, physDef: 0, magicDef: 0, effects: [], abilities: ['Атака'], ...overrides,
});
const combat = (player = hero(), rng = () => 0.99) => initCombatSession(player, [createEnemyInstanceByName(ARCHON)], { rng });
const useOnly = (archon, name) => archon.abilities.forEach(ability => { ability.currentCooldown = ability.name === name ? 0 : 99; });
const ready = (session, archon = session.state.enemies[0]) => {
  archon.turnMeter = 1000;
  session.state.players.forEach(unit => { unit.turnMeter = 999; });
  session.state.initiative.playerReady = false;
};

test('authored boss stats, portrait and global boss immunity are final and unscaled', () => {
  const blueprint = getEnemyBlueprintByName(ARCHON);
  expect(blueprint).toMatchObject({
    maxHp: 2250, hp: 2250, attack: 34, magAtk: 24, physDef: 20, magicDef: 22, speed: 170,
    portraitKey: 'bloom_archon', boss: true, authoredStats: true,
    guaranteedLoot: ['Ветвь Архонта'],
  });
  const archon = createEnemyInstanceByName(ARCHON);
  expect(archon).toMatchObject({
    maxHp: 2250, hp: 2250, attack: 34, magAtk: 24, physDef: 20, magicDef: 22, speed: 170,
    difficultyTier: 'boss', controlImmune: true, innateControlImmune: true,
  });
  const url = resolveEnemyPortrait(archon);
  expect(url).toBe('/assets/combat/portraits/enemies/withering_forest/bloom_archon.webp');
  expect(fs.existsSync(path.join('public', url))).toBe(true);
});

test('one global counter punishes the unit performing every second successful attacking action', () => {
  const session = combat();
  const archon = session.state.enemies[0];
  const runtimeHero = session.state.players[0];
  const summon = hero({ id: 'summon', name: 'Призыв', summoned: true });
  session.state.players.push(summon);
  const hit = (source, action = {}) => applyDamage(archon, 1, 'physical', {
    source, session, directAttack: true, deliberateAction: action,
  });
  hit(runtimeHero);
  expect(getEffectStackCount(runtimeHero, 'entanglement')).toBe(0);
  applyDamage(archon, 1, 'physical', {
    source: runtimeHero, session, directAttack: true, deliberateAction: {}, isSecondaryDamage: true,
  });
  expect(archon._bloomArchonAttackActionCounter).toBe(1);
  const multihitAction = {};
  hit(summon, multihitAction); hit(summon, multihitAction);
  expect(getEffectStackCount(summon, 'entanglement')).toBe(1);
  hit(runtimeHero); hit(runtimeHero);
  expect(getEffectStackCount(runtimeHero, 'entanglement')).toBe(1);
});

test('miss/periodic/reflection-like packets do not count, shield-only does, and reload preserves the odd counter', () => {
  const original = combat();
  const archon = original.state.enemies[0];
  const runtimeHero = original.state.players[0];
  applyDamage(archon, 1, 'physical', { source: runtimeHero, session: original, directAttack: true, deliberateAction: {} });
  applyDamage(archon, 5, 'pure', { source: runtimeHero, session: original, directAttack: false, fromEffect: 'bleed' });
  applyDamage(archon, 5, 'pure', { source: runtimeHero, session: original, directAttack: false, fromEffect: 'thorn_reflection' });
  expect(archon._bloomArchonAttackActionCounter).toBe(1);

  const wire = JSON.parse(JSON.stringify(snapshotCombatSession(original)));
  const restored = reviveCombatSession(wire, hero(), [createEnemyInstanceByName(ARCHON)]);
  const restoredArchon = restored.state.enemies[0];
  const restoredHero = restored.state.players[0];
  restoredArchon.shield = 100;
  applyDamage(restoredArchon, 1, 'physical', { source: restoredHero, session: restored, directAttack: true, deliberateAction: {} });
  expect(restoredArchon.hp).toBeLessThanOrEqual(archon.hp);
  expect(getEffectStackCount(restoredHero, 'entanglement')).toBe(1);
  expect(restoredArchon._bloomArchonAttackActionCounter).toBe(0);
});

test('Archon Roots starts at exactly two stacks and Bud ticks on the next two Archon turn starts', () => {
  const session = combat();
  const archon = session.state.enemies[0];
  const target = session.state.players[0];
  useOnly(archon, 'Корни Архонта'); ready(session, archon); processEnemyAI(session);
  expect(getEffectStackCount(target, 'entanglement')).toBe(2);
  expect(target.effects.filter(effect => effect.id === 'archon_bud')).toHaveLength(1);

  const tick = () => processSourceTurnStartEffects(archon, session.state.players, jest.fn(), { session });
  tick();
  expect(getEffectStackCount(target, 'entanglement')).toBe(3);
  expect(target.effects.find(effect => effect.id === 'archon_bud').extra.remainingSourceTurns).toBe(1);
  tick();
  expect(getEffectStackCount(target, 'entanglement')).toBe(4);
  expect(target.effects.some(effect => effect.id === 'archon_bud')).toBe(false);
  const poison = target.effects.find(effect => effect.id === 'poison');
  expect(poison).toEqual(expect.objectContaining({ remainingTurns: 3 }));
  expect(poison.sourceSnapshot).toEqual(expect.objectContaining({ attack: 34 }));
});

test('reapplying Bud refreshes its source-turn count without creating another instance', () => {
  const session = combat(); const archon = session.state.enemies[0]; const target = session.state.players[0];
  const roots = createAbilityByName('Корни Архонта');
  const applyRoots = () => roots.effect.forEach(effect => addEffect(target, effect, jest.fn(), archon, { session }));
  applyRoots();
  processSourceTurnStartEffects(archon, session.state.players, jest.fn(), { session });
  expect(target.effects.find(effect => effect.id === 'archon_bud').extra.remainingSourceTurns).toBe(1);
  applyRoots();
  expect(target.effects.filter(effect => effect.id === 'archon_bud')).toHaveLength(1);
  expect(target.effects.find(effect => effect.id === 'archon_bud').extra.remainingSourceTurns).toBe(2);
});

test('Bud survives JSON revive with its remaining source-turn count and never transfers from a dead target', () => {
  const session = combat();
  const archon = session.state.enemies[0];
  const target = session.state.players[0];
  addEffect(target, { id: 'archon_bud', persistent: true, extra: { remainingSourceTurns: 2 } }, jest.fn(), archon, { session });
  processSourceTurnStartEffects(archon, session.state.players, jest.fn(), { session });
  const wire = JSON.parse(JSON.stringify(snapshotCombatSession(session)));
  const restored = reviveCombatSession(wire, hero(), [createEnemyInstanceByName(ARCHON)]);
  const restoredArchon = restored.state.enemies[0];
  const restoredTarget = restored.state.players[0];
  expect(restoredTarget.effects.find(effect => effect.id === 'archon_bud').extra.remainingSourceTurns).toBe(1);
  restoredTarget.hp = 0;
  restored.state.players.push(hero({ id: 'other', name: 'Другая цель' }));
  expect(processSourceTurnStartEffects(restoredArchon, restored.state.players, jest.fn(), { session: restored })).toBe(0);
  expect(getEffectStackCount(restored.state.players[1], 'entanglement')).toBe(0);
});

test('a control-skipped Archon turn still ticks Bud during start-of-turn', () => {
  const session = combat(); const archon = session.state.enemies[0]; const target = session.state.players[0];
  addEffect(target, { id: 'archon_bud', persistent: true, extra: { remainingSourceTurns: 2 } }, jest.fn(), archon, { session });
  archon.turnDelay = 1;
  ready(session, archon); processEnemyAI(session);
  expect(getEffectStackCount(target, 'entanglement')).toBe(1);
  expect(target.effects.find(effect => effect.id === 'archon_bud').extra.remainingSourceTurns).toBe(1);
});

test('Petal Shedding removes the most accumulated removable debuff family before every third Archon turn tick', () => {
  const session = combat();
  const archon = session.state.enemies[0];
  const source = session.state.players[0];
  useOnly(archon, 'Атака');
  addEffect(archon, { id: 'bleed', duration: 23 }, jest.fn(), source, { session });
  addEffect(archon, { id: 'phys_def_penalty_minor', duration: 10 }, jest.fn(), source, { session });

  ready(session, archon); processEnemyAI(session);
  expect(archon.effects.some(effect => effect.id === 'bleed')).toBe(true);
  expect(archon._bloomArchonCleanseTurnCounter).toBe(1);

  ready(session, archon); processEnemyAI(session);
  expect(archon.effects.some(effect => effect.id === 'bleed')).toBe(true);
  expect(archon._bloomArchonCleanseTurnCounter).toBe(2);

  const hpBeforeThirdTurn = archon.hp;
  ready(session, archon); processEnemyAI(session);
  expect(archon.effects.some(effect => effect.id === 'bleed')).toBe(false);
  expect(archon.effects.some(effect => effect.id === 'phys_def_penalty_minor')).toBe(true);
  expect(archon.hp).toBe(hpBeforeThirdTurn);
  expect(archon._bloomArchonCleanseTurnCounter).toBe(0);
});

test('Petal Shedding cadence survives combat snapshot revive', () => {
  const session = combat();
  const archon = session.state.enemies[0];
  const source = session.state.players[0];
  useOnly(archon, 'Атака');
  addEffect(archon, { id: 'bleed', duration: 12 }, jest.fn(), source, { session });
  ready(session, archon); processEnemyAI(session);
  ready(session, archon); processEnemyAI(session);
  expect(archon._bloomArchonCleanseTurnCounter).toBe(2);

  const wire = JSON.parse(JSON.stringify(snapshotCombatSession(session)));
  const restored = reviveCombatSession(wire, hero(), [createEnemyInstanceByName(ARCHON)]);
  const restoredArchon = restored.state.enemies[0];
  expect(restoredArchon._bloomArchonCleanseTurnCounter).toBe(2);
  ready(restored, restoredArchon); processEnemyAI(restored);
  expect(restoredArchon.effects.some(effect => effect.id === 'bleed')).toBe(false);
  expect(restoredArchon._bloomArchonCleanseTurnCounter).toBe(0);
});

test.each([0, 1, 2, 3, 5])('Life Bloom consumes/heals/advances correctly from %i Entanglement', stacks => {
  const session = combat();
  const archon = session.state.enemies[0];
  const target = session.state.players[0];
  archon.hp = 1000; archon.turnMeter = 400;
  if (stacks > 0) addEffect(target, { id: 'entanglement', stacks }, jest.fn(), archon, { session });
  const ability = createAbilityByName('Цветение жизни');
  const context = { attacker: archon, target, opponents: [target] };
  expect(ability.canUse(context)).toBe(stacks > 0);
  ability.apply({ ...context, heal: (unit, amount) => {
    const before = unit.hp; unit.hp = Math.min(unit.maxHp, unit.hp + Math.round(amount)); return unit.hp - before;
  }, log: jest.fn() });
  const consumed = Math.min(2, stacks);
  expect(getEffectStackCount(target, 'entanglement')).toBe(stacks - consumed);
  expect(archon.hp).toBe(1000 + 90 * consumed);
  expect(archon.turnMeter).toBe(400 + 100 * consumed);
});

test('Life Bloom uses canonical healing while capped overheal does not reduce its +200 tempo', () => {
  const session = combat();
  const archon = session.state.enemies[0];
  const target = session.state.players[0];
  archon.hp = 2240; archon.turnMeter = 100;
  addEffect(target, { id: 'entanglement', stacks: 5 }, jest.fn(), archon, { session });
  useOnly(archon, 'Цветение жизни'); ready(session, archon);
  processEnemyAI(session);
  expect(archon.hp).toBe(2250);
  expect(archon.turnMeter).toBe(300);
  expect(getEffectStackCount(target, 'entanglement')).toBe(3);
});

test.each([[0, 1.3], [1, 1.5], [2, 1.7], [3, 1.9], [4, 1.9], [5, 1.9]])(
  'Thorn Bloom at %i stacks uses multiplier %f without spending Entanglement', (stacks, multiplier) => {
    const session = combat(); const archon = session.state.enemies[0]; const target = session.state.players[0];
    if (stacks > 0) addEffect(target, { id: 'entanglement', stacks }, jest.fn(), archon, { session });
    const ability = createAbilityByName('Терновое цветение');
    expect(ability.damage({ attacker: archon, target })).toBe(Math.round(archon.magAtk * multiplier));
    ability.apply({ attacker: archon, target, session, deliberateAction: { successfulDirectHit: true }, log: jest.fn() });
    expect(getEffectStackCount(target, 'entanglement')).toBe(stacks);
    expect(target.effects.some(effect => effect.id === 'attack_penalty_minor')).toBe(stacks > 0);
    if (stacks > 0) expect(target.effects.find(effect => effect.id === 'attack_penalty_minor').remainingTurns).toBe(2);
  },
);

test('Thorn Bloom reads execution state and preserves stacks on both miss and shield-only hit', () => {
  const missSession = combat(hero(), () => 0.99);
  const missArchon = missSession.state.enemies[0]; const missTarget = missSession.state.players[0];
  addEffect(missTarget, { id: 'entanglement', stacks: 3 }, jest.fn(), missArchon, { session: missSession });
  useOnly(missArchon, 'Терновое цветение');
  missArchon.abilities.find(ability => ability.name === 'Терновое цветение').accuracy = 0;
  ready(missSession, missArchon); processEnemyAI(missSession);
  expect(getEffectStackCount(missTarget, 'entanglement')).toBe(3);
  expect(missTarget.effects.some(effect => effect.id === 'attack_penalty_minor')).toBe(false);

  const shieldSession = combat(); const shieldArchon = shieldSession.state.enemies[0]; const shieldTarget = shieldSession.state.players[0];
  shieldTarget.shield = 999;
  addEffect(shieldTarget, { id: 'entanglement', stacks: 5 }, jest.fn(), shieldArchon, { session: shieldSession });
  useOnly(shieldArchon, 'Терновое цветение'); ready(shieldSession, shieldArchon); processEnemyAI(shieldSession);
  expect(shieldTarget.hp).toBe(shieldTarget.maxHp);
  expect(getEffectStackCount(shieldTarget, 'entanglement')).toBe(5);
  expect(shieldTarget.effects.filter(effect => effect.id === 'attack_penalty_minor')).toHaveLength(1);
});

test('Phase-I AI scores Roots, wounded Life Bloom and healthy Thorn Bloom contextually', () => {
  const session = combat(); const archon = session.state.enemies[0]; const target = session.state.players[0];
  expect(selectEnemyAction(archon, session).ability.name).toBe('Корни Архонта');
  addEffect(target, { id: 'entanglement', stacks: 3 }, jest.fn(), archon, { session });
  addEffect(target, { id: 'archon_bud', persistent: true, extra: { remainingSourceTurns: 2 } }, jest.fn(), archon, { session });
  expect(selectEnemyAction(archon, session).ability.name).toBe('Терновое цветение');
  archon.hp = 600;
  expect(selectEnemyAction(archon, session).ability.name).toBe('Цветение жизни');
  expect(WITHERING_FOREST_TUNING).toMatchObject({
    bloomArchonRootsCooldown: 3, bloomArchonLifeBloomCooldown: 4, bloomArchonThornBloomCooldown: 3,
  });
});

const enterPhaseTwo = session => {
  const archon = session.state.enemies[0];
  archon.hp = 1126;
  applyDamage(archon, 1, 'pure', { source: session.state.players[0], session, logFn: jest.fn() });
  return archon;
};

test('living direct and periodic threshold packets transition once, while lethal damage does not', () => {
  const direct = combat(); const directArchon = direct.state.enemies[0];
  directArchon.hp = 1126;
  const log = jest.fn();
  beginCombatPresentation(direct);
  applyDamage(directArchon, 1, 'pure', { source: direct.state.players[0], session: direct, directAttack: true, deliberateAction: {}, logFn: log });
  const phaseEvents = consumeCombatPresentationEvents(direct);
  expect(directArchon).toMatchObject({ hp: 1125, maxHp: 2250, _bloomArchonPhase: 2 });
  expect(phaseEvents.map(event => event.type)).toEqual(expect.arrayContaining(["damage", "bossPhaseTransition"]));
  expect(phaseEvents.find(event => event.type === "bossPhaseTransition")).toMatchObject({
    targetId: directArchon.id,
    phase: 2,
    label: "Увядание",
  });
  expect(log.mock.calls.filter(([line]) => line.includes('Цветы Архонта чернеют'))).toHaveLength(1);
  applyDamage(directArchon, 1, 'pure', { source: direct.state.players[0], session: direct, logFn: log });
  expect(log.mock.calls.filter(([line]) => line.includes('Цветы Архонта чернеют'))).toHaveLength(1);

  const periodic = combat(); const periodicArchon = periodic.state.enemies[0]; periodicArchon.hp = 1126;
  applyDamage(periodicArchon, 1, 'pure', { source: periodic.state.players[0], session: periodic, isPeriodic: true, fromEffect: 'bleed' });
  expect(periodicArchon._bloomArchonPhase).toBe(2);

  const lethal = combat(); const lethalArchon = lethal.state.enemies[0]; lethalArchon.hp = 1126;
  applyDamage(lethalArchon, 9999, 'pure', { source: lethal.state.players[0], session: lethal });
  expect(lethalArchon.hp).toBe(0);
  expect(lethalArchon._bloomArchonPhase).toBe(1);
});

test('transition preserves combat state and swaps only the authored phase roster', () => {
  const session = combat(); const archon = session.state.enemies[0]; const target = session.state.players[0];
  const roots = archon.abilities.find(ability => ability.name === 'Корни Архонта'); roots.currentCooldown = 2;
  archon.hp = 1126; archon.turnMeter = 437; archon._bloomArchonAttackActionCounter = 1;
  addEffect(target, { id: 'entanglement', stacks: 2 }, jest.fn(), archon, { session });
  addEffect(target, { id: 'archon_bud', persistent: true, extra: { remainingSourceTurns: 2 } }, jest.fn(), archon, { session });
  addEffect(archon, { id: 'speed_boost_minor', duration: 2 }, jest.fn(), archon, { session });
  applyDamage(archon, 1, 'pure', { source: target, session });
  expect(archon.hp).toBe(1125); expect(archon.turnMeter).toBe(437);
  expect(archon._bloomArchonAttackActionCounter).toBe(1);
  expect(getEffectStackCount(target, 'entanglement')).toBe(2);
  expect(target.effects.some(effect => effect.id === 'archon_bud')).toBe(true);
  expect(archon.effects.some(effect => effect.id === 'speed_boost_minor')).toBe(true);
  expect(archon.effects.some(effect => effect.id === 'withering_phase')).toBe(false);
  expect(archon.abilities.map(ability => ability.name)).toEqual([
    'Корни Архонта', 'Смертельное цветение', 'Погребение в корнях', 'Сброс лепестков', 'Атака',
  ]);
  expect(archon.abilities[0]).toBe(roots);
  expect(archon.abilities[0].currentCooldown).toBe(2);
});

test('Phase II internal state, roster, Bud, counter and cooldowns survive snapshot revive', () => {
  const session = combat(); const archon = enterPhaseTwo(session); const target = session.state.players[0];
  archon._bloomArchonAttackActionCounter = 1;
  addEffect(target, { id: 'archon_bud', persistent: true, extra: { remainingSourceTurns: 2 } }, jest.fn(), archon, { session });
  archon.abilities.find(ability => ability.name === 'Корни Архонта').currentCooldown = 2;
  const wire = JSON.parse(JSON.stringify(snapshotCombatSession(session)));
  const restored = reviveCombatSession(wire, hero(), [createEnemyInstanceByName(ARCHON)]);
  const restoredArchon = restored.state.enemies[0];
  expect(restoredArchon._bloomArchonPhase).toBe(2);
  expect(restoredArchon.abilities.map(ability => ability.name)).toEqual([
    'Корни Архонта', 'Смертельное цветение', 'Погребение в корнях', 'Сброс лепестков', 'Атака',
  ]);
  expect(restoredArchon.abilities.find(ability => ability.name === 'Корни Архонта').currentCooldown).toBe(2);
  expect(restoredArchon.effects.some(effect => effect.id === 'withering_phase')).toBe(false);
  expect(restoredArchon._bloomArchonAttackActionCounter).toBe(1);
  expect(restored.state.players[0].effects.find(effect => effect.id === 'archon_bud').extra.remainingSourceTurns).toBe(2);
});

test.each([[0, 1.5], [1, 1.65], [2, 1.8], [3, 1.95], [5, 1.95]])(
  'Death Bloom at %i stacks uses multiplier %f, consumes at most two and grants matching tempo', (stacks, multiplier) => {
    const session = combat(); const archon = enterPhaseTwo(session); const target = session.state.players[0];
    if (stacks) addEffect(target, { id: 'entanglement', stacks }, jest.fn(), archon, { session });
    const ability = archon.abilities.find(item => item.name === 'Смертельное цветение');
    expect(ability.damage({ attacker: archon, target })).toBe(Math.round(archon.magAtk * multiplier));
    archon.turnMeter = 100;
    ability.apply({ attacker: archon, target, deliberateAction: { successfulDirectHit: true }, log: jest.fn() });
    const consumed = Math.min(2, stacks);
    expect(getEffectStackCount(target, 'entanglement')).toBe(stacks - consumed);
    expect(archon.turnMeter).toBe(100 + consumed * 100);
    expect(archon.hp).toBe(1125);
  },
);

test('Death Bloom miss preserves stacks/TM while shield-only hit consumes and grants TM', () => {
  const missed = combat(); const missedArchon = enterPhaseTwo(missed); const missedTarget = missed.state.players[0];
  addEffect(missedTarget, { id: 'entanglement', stacks: 3 }, jest.fn(), missedArchon, { session: missed });
  useOnly(missedArchon, 'Смертельное цветение');
  missedArchon.abilities.find(ability => ability.name === 'Смертельное цветение').accuracy = 0;
  missedArchon.turnMeter = 1000; missed.state.players[0].turnMeter = 999; missed.state.initiative.playerReady = false;
  processEnemyAI(missed);
  expect(getEffectStackCount(missedTarget, 'entanglement')).toBe(3);
  expect(missedArchon.turnMeter).toBeLessThan(300);

  const shielded = combat(); const shieldArchon = enterPhaseTwo(shielded); const shieldTarget = shielded.state.players[0];
  shieldTarget.shield = 999; addEffect(shieldTarget, { id: 'entanglement', stacks: 5 }, jest.fn(), shieldArchon, { session: shielded });
  useOnly(shieldArchon, 'Смертельное цветение'); ready(shielded, shieldArchon); processEnemyAI(shielded);
  expect(shieldTarget.hp).toBe(shieldTarget.maxHp);
  expect(getEffectStackCount(shieldTarget, 'entanglement')).toBe(3);
  expect(shieldArchon.turnMeter).toBeGreaterThanOrEqual(200);
});

const prepareBurial = (session, stacks = 0) => {
  const archon = enterPhaseTwo(session); const target = session.state.players[0];
  if (stacks) addEffect(target, { id: 'entanglement', stacks }, jest.fn(), archon, { session });
  useOnly(archon, 'Погребение в корнях'); ready(session, archon); processEnemyAI(session);
  return { archon, target };
};

test('Burial preparation spends one turn, stores stable target and leaves a player response window', () => {
  const session = combat(); const { archon, target } = prepareBurial(session, 5);
  expect(target.hp).toBe(target.maxHp);
  expect(archon._preparation).toMatchObject({ kind: 'bloom_archon_burial', resolveName: 'Погребение в корнях', targetId: target.id });
  expect(archon.turnMeter).toBe(0);
  expect(session.state.initiative.playerReady).toBe(true);
  expect(archon.abilities.find(ability => ability.name === 'Погребение в корнях').currentCooldown).toBe(5);
  session.state.initiative.playerReady = false; ready(session, archon); processEnemyAI(session);
  expect(target.hp).toBeLessThan(target.maxHp);
  expect(archon._preparation).toBeNull();
});

test.each([[2, 1.8, 2, false, false], [3, 2.3, 1, true, false], [4, 2.3, 2, true, false], [5, 2.8, 3, true, true]])(
  'Burial executes the authored tier from %i current stacks', (stacks, multiplier, remaining, vulnerable, stunned) => {
    const session = combat(); const { archon, target } = prepareBurial(session, stacks);
    ready(session, archon); processEnemyAI(session);
    expect(target.maxHp - target.hp).toBe(Math.round(archon.attack * multiplier));
    expect(getEffectStackCount(target, 'entanglement')).toBe(remaining);
    expect(target.effects.some(effect => effect.id === 'vulnerability')).toBe(vulnerable);
    expect(target.effects.some(effect => effect.id === 'stun')).toBe(stunned);
  },
);

test('Bud ticks before Burial resolution and can raise its execution tier to five stacks', () => {
  const session = combat(); const { archon, target } = prepareBurial(session, 5);
  target.effects = target.effects.filter(effect => effect.id !== 'entanglement');
  addEffect(target, { id: 'entanglement', stacks: 4 }, jest.fn(), archon, { session });
  addEffect(target, { id: 'archon_bud', persistent: true, extra: { remainingSourceTurns: 1 } }, jest.fn(), archon, { session });
  ready(session, archon); processEnemyAI(session);
  expect(target.maxHp - target.hp).toBe(Math.round(archon.attack * 2.8));
  expect(getEffectStackCount(target, 'entanglement')).toBe(3);
  expect(target.effects.some(effect => effect.id === 'stun')).toBe(true);
  expect(target.effects.some(effect => effect.id === 'archon_bud')).toBe(false);
});

test('Burial miss consumes nothing, and a vanished prepared target cancels without retargeting', () => {
  const missed = combat(); const preparedMiss = prepareBurial(missed, 5);
  preparedMiss.archon._preparation.accuracy = 0;
  ready(missed, preparedMiss.archon); processEnemyAI(missed);
  expect(preparedMiss.target.hp).toBe(preparedMiss.target.maxHp);
  expect(getEffectStackCount(preparedMiss.target, 'entanglement')).toBe(5);
  expect(preparedMiss.target.effects.some(effect => ['vulnerability', 'stun'].includes(effect.id))).toBe(false);
  expect(preparedMiss.archon._preparation).toBeNull();

  const vanished = combat(); const second = hero({ id: 'other-target', name: 'Другая цель', abilities: [createAbilityByName('Атака')] }); vanished.state.players.push(second);
  const preparedGone = prepareBurial(vanished, 5); preparedGone.target.hp = 0;
  vanished.state.players = [second];
  ready(vanished, preparedGone.archon); processEnemyAI(vanished);
  expect(second.hp).toBe(second.maxHp);
  expect(preparedGone.archon._preparation).toBeNull();
});

test('serialized Burial resolves exactly once against its stable target with its spent cooldown', () => {
  const original = combat(); const { archon } = prepareBurial(original, 4);
  const cooldown = archon.abilities.find(ability => ability.name === 'Погребение в корнях').currentCooldown;
  const wire = JSON.parse(JSON.stringify(snapshotCombatSession(original)));
  const restored = reviveCombatSession(wire, hero(), [createEnemyInstanceByName(ARCHON)]);
  const restoredArchon = restored.state.enemies[0]; const restoredTarget = restored.state.players[0];
  expect(restoredArchon._preparation).toMatchObject({ kind: 'bloom_archon_burial', targetId: restoredTarget.id });
  expect(restoredArchon.abilities.find(ability => ability.name === 'Погребение в корнях').currentCooldown).toBe(cooldown);
  ready(restored, restoredArchon); processEnemyAI(restored);
  const hp = restoredTarget.hp;
  expect(restoredArchon._preparation).toBeNull();
  restoredArchon.turnDelay = 1;
  ready(restored, restoredArchon); processEnemyAI(restored);
  expect(restoredTarget.hp).toBe(hp);
});

test('Phase-II AI prefers Roots, Death Bloom, Burial, then Death Bloom while Burial cools down', () => {
  const session = combat(); const archon = enterPhaseTwo(session); const target = session.state.players[0];
  expect(selectEnemyAction(archon, session).ability.name).toBe('Корни Архонта');
  addEffect(target, { id: 'entanglement', stacks: 3 }, jest.fn(), archon, { session });
  addEffect(target, { id: 'archon_bud', persistent: true, extra: { remainingSourceTurns: 2 } }, jest.fn(), archon, { session });
  expect(selectEnemyAction(archon, session).ability.name).toBe('Смертельное цветение');
  addEffect(target, { id: 'entanglement', stacks: 2 }, jest.fn(), archon, { session });
  expect(selectEnemyAction(archon, session).ability.name).toBe('Погребение в корнях');
  archon.abilities.find(ability => ability.name === 'Погребение в корнях').currentCooldown = 2;
  expect(selectEnemyAction(archon, session).ability.name).toBe('Смертельное цветение');
});
