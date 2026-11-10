import fs from 'fs';
import path from 'path';
import { createAbilityByName, WITHERING_FOREST_TUNING } from '../data/abilityPresets';
import { createEnemyInstanceByName, getEnemyBlueprintByName, enemies } from '../data/enemies';
import { resolveEnemyPortrait } from '../data/combatAssets';
import { addEffect, getEffectStackCount } from './effects';
import { applyDamage, applyHealing, initCombatSession, processEnemyAI, selectEnemyAction } from './combatUtils';
import { reviveCombatSession, snapshotCombatSession } from '../components/CombatScreen';
import { createCursedEncounter, getCursedEnemyPool, getTrashEnemyPool, WITHERING_FOREST_NORMAL_TEMPLATES, WITHERING_FOREST_STRONG_TEMPLATES } from './enemyPools';

const SPLITTER = 'Кристальный раскольник — Искажение';
const PREDATOR = 'Осквернённый хищник — Осквернение';
const hero = overrides => ({ name: 'Герой', hp: 500, maxHp: 500, attack: 30, speed: 100, physDef: 0, magicDef: 0, effects: [], abilities: ['Атака'], ...overrides });
const readyEnemy = (session, enemy) => {
  enemy.turnMeter = 1000;
  session.state.players.forEach(unit => { unit.turnMeter = 999; });
  session.state.initiative.playerReady = false;
};
const useOnly = (enemy, name) => enemy.abilities.forEach(ability => {
  ability.currentCooldown = ability.name === name ? 0 : 99;
});

test('authors both cursed enemies, real portraits, and canonical solo-only pool membership', () => {
  const expected = {
    [SPLITTER]: [720, 25, 20, 23, 19, 120, 'crystal_splitter'],
    [PREDATOR]: [584, 29, 6, 14, 12, 148, 'defiled_predator'],
  };
  Object.entries(expected).forEach(([name, [maxHp, attack, magAtk, physDef, magicDef, speed, portraitKey]]) => {
    expect(getEnemyBlueprintByName(name)).toMatchObject({ maxHp, hp: maxHp, attack, magAtk, physDef, magicDef, speed, portraitKey, roomRole: 'cursedEnemy', encounterPhase: 'elite' });
    const url = resolveEnemyPortrait({ portraitKey });
    expect(url).toBe(`/assets/combat/portraits/enemies/withering_forest/${portraitKey}.webp`);
    expect(fs.existsSync(path.join('public', url))).toBe(true);
  });
  const forest = enemies.filter(enemy => enemy.location === 'Лес Увядания');
  expect(getCursedEnemyPool(forest).map(enemy => enemy.name)).toEqual(expect.arrayContaining([SPLITTER, PREDATOR]));
  expect(getTrashEnemyPool({ nonBossEnemies: forest, selectedLocation: 'Лес Увядания', completedCombatRooms: 99 }).some(enemy => [SPLITTER, PREDATOR].includes(enemy.name))).toBe(false);
  [...WITHERING_FOREST_NORMAL_TEMPLATES, ...WITHERING_FOREST_STRONG_TEMPLATES].forEach(template => expect(template.names.some(name => [SPLITTER, PREDATOR].includes(name))).toBe(false));
  const cursed = getCursedEnemyPool(forest);
  const splitterIndex = cursed.findIndex(enemy => enemy.name === SPLITTER);
  const predatorIndex = cursed.findIndex(enemy => enemy.name === PREDATOR);
  const roll = index => () => (index + 0.1) / cursed.length;
  expect(createCursedEncounter(forest, roll(splitterIndex))).toMatchObject({ cursedEnemy: true, enemies: [{ name: SPLITTER }] });
  expect(createCursedEncounter(forest, roll(splitterIndex)).enemies).toHaveLength(1);
  expect(createCursedEncounter(forest, roll(predatorIndex))).toMatchObject({ cursedEnemy: true, enemies: [{ name: PREDATOR }] });
  expect(createCursedEncounter(forest, roll(predatorIndex)).enemies).toHaveLength(1);
});

test('a Carapace segment breaks immediately while another Shield remains and never transfers punishment', () => {
  const splitter = createEnemyInstanceByName(SPLITTER);
  const first = hero({ id: 'hero-a' });
  const second = hero({ id: 'summon-b', name: 'Призыв B', summoned: true });
  const session = initCombatSession(first, [splitter]);
  const runtimeSplitter = session.state.enemies[0];
  const runtimeFirst = session.state.players[0];
  session.state.players.push(second);
  createAbilityByName('Лес: Кристаллический панцирь').apply({ attacker: runtimeSplitter, session, log: jest.fn() });
  createAbilityByName('Раскалывающий удар').apply({ attacker: runtimeSplitter, session, log: jest.fn() });
  expect(runtimeSplitter.shield).toBe(223);
  applyDamage(runtimeSplitter, 173, 'pure', { source: runtimeFirst, session, directAttack: true });
  expect(runtimeSplitter.shield).toBe(50);
  expect(getEffectStackCount(runtimeFirst, 'entanglement')).toBe(2);
  applyDamage(runtimeSplitter, 50, 'pure', { source: second, session, directAttack: true });
  expect(getEffectStackCount(second, 'entanglement')).toBe(0);
  expect(getEffectStackCount(runtimeFirst, 'entanglement')).toBe(2);
});

test('lethal overflow still credits the Carapace breaker', () => {
  const splitter = createEnemyInstanceByName(SPLITTER);
  const attacker = hero({ id: 'hero' });
  const session = initCombatSession(attacker, [splitter]);
  const runtimeSplitter = session.state.enemies[0]; const runtimeAttacker = session.state.players[0];
  createAbilityByName('Лес: Кристаллический панцирь').apply({ attacker: runtimeSplitter, session, log: jest.fn() });
  runtimeSplitter.hp = 10;
  const logger = jest.fn();
  applyDamage(runtimeSplitter, 200, 'pure', { source: runtimeAttacker, session, directAttack: true, logFn: logger });
  expect(runtimeSplitter.hp).toBe(0);
  expect(getEffectStackCount(runtimeAttacker, 'entanglement')).toBeGreaterThanOrEqual(2);
  expect(logger.mock.calls.filter(([line]) => line.includes('Разрушение Кристаллического панциря'))).toHaveLength(1);
});

test('periodic canonical owner receives punishment, while missing/stale sources are never guessed', () => {
  const owner = hero({ id: 'dot-owner' });
  const splitter = createEnemyInstanceByName(SPLITTER);
  const session = initCombatSession(owner, [splitter]);
  const runtimeSplitter = session.state.enemies[0]; const runtimeOwner = session.state.players[0];
  createAbilityByName('Лес: Кристаллический панцирь').apply({ attacker: runtimeSplitter, session, log: jest.fn() });
  applyDamage(runtimeSplitter, 173, 'pure', { source: runtimeOwner, session, isPeriodic: true, fromEffect: 'bleed' });
  expect(getEffectStackCount(runtimeOwner, 'entanglement')).toBe(2);

  const other = createEnemyInstanceByName(SPLITTER);
  const otherSession = initCombatSession(hero({ id: 'real-hero' }), [other]);
  const runtimeOther = otherSession.state.enemies[0];
  createAbilityByName('Лес: Кристаллический панцирь').apply({ attacker: runtimeOther, session: otherSession, log: jest.fn() });
  applyDamage(runtimeOther, 173, 'pure', { source: { id: 'stale', name: 'Старый источник', hp: 1 }, session: otherSession, isPeriodic: true, fromEffect: 'bleed' });
  expect(getEffectStackCount(otherSession.state.players[0], 'entanglement')).toBe(0);
});

test('periodic owner is safely rebound by canonical ID after snapshot/revive, while a stale ID is not guessed', () => {
  const source = hero({ id: 'saved-dot-owner', attack: 30 });
  const authoredSplitter = createEnemyInstanceByName(SPLITTER);
  const original = initCombatSession(source, [authoredSplitter], { rng: () => 0.99 });
  const originalSource = original.state.players[0];
  const originalSplitter = original.state.enemies[0];
  createAbilityByName('Лес: Кристаллический панцирь').apply({ attacker: originalSplitter, session: original, log: jest.fn() });
  applyDamage(originalSplitter, 163, 'pure', { source: originalSource, session: original, directAttack: true });
  expect(originalSplitter.shield).toBe(10);
  addEffect(originalSplitter, { id: 'bleed', duration: 1 }, jest.fn(), originalSource, { session: original });

  const snapshot = JSON.parse(JSON.stringify(snapshotCombatSession(original)));
  const savedBleed = snapshot.state.enemies[0].effects.find(effect => effect.id === 'bleed');
  expect(savedBleed).not.toHaveProperty('sourceRef');
  expect(savedBleed.sourceSnapshot).not.toHaveProperty('entity');
  expect(savedBleed.sourceSnapshot.id).toBe('saved-dot-owner');
  const staleSnapshot = JSON.parse(JSON.stringify(snapshot));
  staleSnapshot.state.enemies[0].effects.find(effect => effect.id === 'bleed').sourceSnapshot.id = 'missing-source';

  const restored = reviveCombatSession(snapshot, source, [createEnemyInstanceByName(SPLITTER)]);
  const restoredSource = restored.state.players[0];
  const restoredSplitter = restored.state.enemies[0];
  expect(restoredSplitter.effects.find(effect => effect.id === 'bleed').sourceRef).toBeUndefined();
  restoredSplitter.attack = 0;
  useOnly(restoredSplitter, 'Атака');
  readyEnemy(restored, restoredSplitter);
  processEnemyAI(restored);
  expect(restoredSplitter.shield).toBe(0);
  expect(getEffectStackCount(restoredSource, 'entanglement')).toBe(2);
  expect(getEffectStackCount(restoredSplitter, 'entanglement')).toBe(0);

  const stale = reviveCombatSession(staleSnapshot, source, [createEnemyInstanceByName(SPLITTER)]);
  const staleSplitter = stale.state.enemies[0];
  staleSplitter.attack = 0;
  useOnly(staleSplitter, 'Атака');
  readyEnemy(stale, staleSplitter);
  expect(() => processEnemyAI(stale)).not.toThrow();
  expect(staleSplitter.shield).toBe(0);
  expect(getEffectStackCount(stale.state.players[0], 'entanglement')).toBe(0);
  expect(getEffectStackCount(staleSplitter, 'entanglement')).toBe(0);
});

test('Carapace provenance survives JSON, partial damage is safe, and its damage break punishes the actual source once', () => {
  const splitter = createEnemyInstanceByName(SPLITTER);
  const attacker = hero({ id: 'friendly-summon', summoned: true });
  const session = initCombatSession(attacker, [splitter], { rng: () => 0.99 });
  const runtimeSplitter = session.state.enemies[0]; const runtimeAttacker = session.state.players[0];
  const carapace = createAbilityByName('Лес: Кристаллический панцирь');
  expect(carapace.name).toBe('Опутывающий панцирь');
  carapace.apply({ attacker: runtimeSplitter, session, log: jest.fn() });
  expect(runtimeSplitter.shield).toBe(173);
  const provenance = runtimeSplitter.effects.find(effect => effect.id === 'shield').extra.shieldSources;
  expect(JSON.parse(JSON.stringify(provenance))[0]).toMatchObject({ sourceKey: 'crystal_splitter_carapace', remaining: 173 });
  applyDamage(runtimeSplitter, 30, 'pure', { source: runtimeAttacker, session, directAttack: true });
  expect(getEffectStackCount(runtimeAttacker, 'entanglement')).toBe(0);
  applyDamage(runtimeSplitter, 200, 'pure', { source: runtimeAttacker, session, directAttack: true });
  expect(getEffectStackCount(runtimeAttacker, 'entanglement')).toBe(2);
  applyDamage(runtimeSplitter, 1, 'pure', { source: runtimeAttacker, session, directAttack: true });
  expect(getEffectStackCount(runtimeAttacker, 'entanglement')).toBe(2);
});

test('Resonant preparation is selected, survives reload and consumes execution-time Shield exactly once', () => {
  const splitter = createEnemyInstanceByName(SPLITTER);
  const target = hero({ id: 'hero' });
  const session = initCombatSession(target, [splitter], { rng: () => 0.99 });
  const runtimeSplitter = session.state.enemies[0];
  createAbilityByName('Лес: Кристаллический панцирь').apply({ attacker: runtimeSplitter, session, log: jest.fn() });
  runtimeSplitter.abilities.find(ability => ability.name === 'Опутывающий панцирь').currentCooldown = 3;
  runtimeSplitter.abilities.find(ability => ability.name === 'Раскалывающий удар').currentCooldown = 3;
  expect(selectEnemyAction(runtimeSplitter, session).ability.name).toBe('Резонансный разряд');
  readyEnemy(session, runtimeSplitter);
  processEnemyAI(session);
  expect(runtimeSplitter._preparation).toMatchObject({ kind: 'resonant_discharge' });

  const snapshot = JSON.parse(JSON.stringify(snapshotCombatSession(session)));
  const restored = reviveCombatSession(snapshot, target, [createEnemyInstanceByName(SPLITTER)]);
  const restoredSplitter = restored.state.enemies[0];
  applyDamage(restoredSplitter, 129, 'pure', { source: restored.state.players[0], session: restored, directAttack: true });
  expect(restoredSplitter.shield).toBe(44);
  restoredSplitter.attack = 0;
  restoredSplitter.abilities.filter(ability => ability.name !== 'Резонансный разряд').forEach(ability => { ability.currentCooldown = 99; });
  const before = restored.state.players[0].hp;
  readyEnemy(restored, restoredSplitter);
  processEnemyAI(restored);
  expect(before - restored.state.players[0].hp).toBe(59);
  expect(restored.state.players[0].effects.some(effect => effect.id === 'shock')).toBe(true);
  expect(restoredSplitter._preparation).toBeNull();
  expect(restoredSplitter.shield).toBe(0);
  expect(restoredSplitter.effects.some(effect => effect.id === 'shield')).toBe(false);
  expect(getEffectStackCount(restored.state.players[0], 'entanglement')).toBe(0);
  const after = restored.state.players[0].hp;
  readyEnemy(restored, restoredSplitter);
  processEnemyAI(restored);
  expect(restored.state.players[0].hp).toBe(after);
});

test('Resonant Discharge below threshold does not Shock and Strike Shield has no punishment', () => {
  const splitter = createEnemyInstanceByName(SPLITTER);
  const target = hero({ id: 'hero' });
  const session = initCombatSession(target, [splitter]);
  const runtimeSplitter = session.state.enemies[0]; const runtimeTarget = session.state.players[0];
  createAbilityByName('Раскалывающий удар').apply({ attacker: runtimeSplitter, session, log: jest.fn() });
  expect(runtimeSplitter.shield).toBe(50);
  runtimeSplitter._preparation = { kind: 'resonant_discharge', resolveName: 'Резонансный разряд' };
  runtimeSplitter.attack = 0; useOnly(runtimeSplitter, 'Атака');
  readyEnemy(session, runtimeSplitter); processEnemyAI(session);
  expect(runtimeTarget.effects.some(effect => effect.id === 'shock')).toBe(false);
  expect(getEffectStackCount(runtimeTarget, 'entanglement')).toBe(0);
  expect(runtimeSplitter.effects.some(effect => effect.id === 'shield')).toBe(false);
});

test('predator uses systemic Bleed, Vampire Mark and finite Haste tuning', () => {
  const target = hero();
  const predator = createEnemyInstanceByName(PREDATOR);
  const session = initCombatSession(target, [predator]);
  addEffect(target, { id: 'bleed', duration: 1 }, jest.fn(), predator, { session });
  addEffect(target, { id: 'bleed', duration: 1 }, jest.fn(), predator, { session });
  expect(target.effects.find(effect => effect.id === 'bleed')).toMatchObject({ remainingTurns: 2 });
  const call = createAbilityByName('Зов крови');
  addEffect(target, call.effect, jest.fn(), predator, { session });
  addEffect(predator, call.selfEffects, jest.fn(), predator, { session });
  expect(target.effects.find(effect => effect.id === 'vampire_mark')).toMatchObject({ remainingTurns: 3 });
  expect(predator.effects.find(effect => effect.id === 'speed_boost_minor')).toMatchObject({ remainingTurns: 2 });
  expect(WITHERING_FOREST_TUNING.predatorBloodFeastBaseLifesteal + 5 * WITHERING_FOREST_TUNING.predatorBloodFeastLifestealPerBleed).toBe(0.75);
});

test.each([0, 1, 2, 3, 4, 5])('Blood Feast uses actual HP loss and the %i-Bleed formula without consuming Bleed', bleed => {
  const target = hero({ hp: 500 });
  const predator = createEnemyInstanceByName(PREDATOR);
  const session = initCombatSession(target, [predator], { rng: () => 0.99 });
  const runtimePredator = session.state.enemies[0];
  runtimePredator.hp = 100;
  if (bleed > 0) addEffect(session.state.players[0], { id: 'bleed', duration: bleed }, jest.fn(), runtimePredator, { session });
  useOnly(runtimePredator, 'Кровавый пир');
  const hpBefore = runtimePredator.hp;
  readyEnemy(session, runtimePredator); processEnemyAI(session);
  const ratio = Math.min(0.75, 0.35 + bleed * 0.08);
  expect(runtimePredator.hp - hpBefore).toBe(Math.round(46 * ratio));
  // The automation proceeds to the hero's ordinary turn-start Bleed tick; the
  // only decrement is that canonical phase, never Blood Feast consumption.
  expect(session.state.players[0].effects.find(effect => effect.id === 'bleed')?.remainingTurns || 0).toBe(Math.max(0, bleed - 1));
});

test('Blood Feast grants no lifesteal for Shield-only damage and caps overkill at actual remaining HP', () => {
  const shielded = initCombatSession(hero({ shield: 100 }), [createEnemyInstanceByName(PREDATOR)], { rng: () => 0.99 });
  const predator = shielded.state.enemies[0]; predator.hp = 100; useOnly(predator, 'Кровавый пир');
  shielded.state.players[0].shield = 100;
  readyEnemy(shielded, predator); processEnemyAI(shielded);
  expect(predator.hp).toBe(100);

  const lethal = initCombatSession(hero({ hp: 10 }), [createEnemyInstanceByName(PREDATOR)], { rng: () => 0.99 });
  const killer = lethal.state.enemies[0]; killer.hp = 100; useOnly(killer, 'Кровавый пир');
  readyEnemy(lethal, killer); processEnemyAI(lethal);
  expect(killer.hp).toBe(104);
});

test('Vampire Mark and Blood Feast are separate actual-damage heals but Wild Overgrowth deduplicates their overheal per action', () => {
  const session = initCombatSession(hero({ hp: 500 }), [createEnemyInstanceByName(PREDATOR)], { rng: () => 0.99 });
  const predator = session.state.enemies[0];
  addEffect(session.state.players[0], { id: 'vampire_mark', duration: 3 }, jest.fn(), predator, { session });
  useOnly(predator, 'Кровавый пир');
  readyEnemy(session, predator); processEnemyAI(session);
  expect(getEffectStackCount(session.state.players[0], 'entanglement')).toBe(1);
  predator.abilities.find(ability => ability.name === 'Кровавый пир').currentCooldown = 0;
  readyEnemy(session, predator); processEnemyAI(session);
  expect(getEffectStackCount(session.state.players[0], 'entanglement')).toBe(2);

  const noOverheal = initCombatSession(hero(), [createEnemyInstanceByName(PREDATOR)]);
  const wounded = noOverheal.state.enemies[0]; wounded.hp = 1;
  applyHealing(wounded, 10, { source: wounded, session: noOverheal, deliberateAction: {} });
  applyHealing(wounded, 999, { source: null, session: noOverheal });
  expect(getEffectStackCount(noOverheal.state.players[0], 'entanglement')).toBe(0);
});
