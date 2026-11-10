import { hydratePlayerSnapshot, buildPlayerSnapshot } from './playerState';
import { getPlayerPassiveSources } from './playerCombatDetails';
import { initCombatSession, performPlayerAction, applyDamage } from './combatUtils';

const archerSession = (damage, enemies, rng = () => 0, type = 'physical') => {
  const session = initCombatSession({
    name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 61, critChance: 0,
    abilities: [{ name: 'Проверочный выстрел', damage, cooldown: 0, type, alwaysHits: true }],
    equippedClassPassiveIds: ['finish_the_prey'],
  }, enemies);
  session.rng = rng;
  session.state.initiative.playerReady = true;
  return session;
};

const enemy = (name, hp) => ({ name, hp, maxHp: hp, physDef: 0, magicDef: 0, effects: [], abilities: [] });

describe('Archer base class feature', () => {
  test('class presentation is authoritative over selectable Finish the Prey', () => {
    const sources = getPlayerPassiveSources({ class: 'Archer', abilities: [{ name: 'Добить добычу', passive: true }] });
    expect(sources[0]).toMatchObject({ key: 'class', kind: 'classFeature', label: 'Сквозные раны' });
    expect(sources[0].descriptionParts.join('')).toContain('избыточный урон');
    expect(sources[0].descriptionParts.join('')).not.toContain('30%');
  });

  test('61 raw damage becomes 49 and transfers exactly 31 residual damage', () => {
    const session = archerSession(61, [enemy('A', 18), enemy('B', 100)]);
    performPlayerAction(session, 'Проверочный выстрел', 0);
    expect(session.state.enemies.map(unit => unit.hp)).toEqual([0, 69]);
  });

  test('exact lethal damage and no alternate living enemy transfer nothing', () => {
    const exact = archerSession(22.5, [enemy('A', 18), enemy('B', 100)]);
    performPlayerAction(exact, 'Проверочный выстрел', 0);
    expect(exact.state.enemies[1].hp).toBe(100);
    const solo = archerSession(61, [enemy('A', 18)]);
    performPlayerAction(solo, 'Проверочный выстрел', 0);
    expect(solo.state.enemies[0].hp).toBe(0);
  });

  test('controlled RNG selects one of multiple living enemies', () => {
    const session = archerSession(61, [enemy('A', 18), enemy('B', 100), enemy('C', 100)], () => 0.99);
    performPlayerAction(session, 'Проверочный выстрел', 0);
    expect(session.state.enemies.map(unit => unit.hp)).toEqual([0, 100, 69]);
  });

  test('non-physical direct Archer damage still transfers overkill', () => {
    const session = archerSession(61, [enemy('A', 18), enemy('B', 100)], () => 0, 'magical');
    performPlayerAction(session, 'Проверочный выстрел', 0);
    expect(session.state.enemies.map(unit => unit.hp)).toEqual([0, 69]);
  });

  test('non-direct damage kill never invokes the class feature', () => {
    const session = archerSession(1, [enemy('A', 18), enemy('B', 100)]);
    applyDamage(session.state.enemies[0], 61, 'physical', {
      source: session.state.players[0], session, directAttack: false, fromEffect: 'test_dot',
    });
    expect(session.state.enemies.map(unit => unit.hp)).toEqual([0, 100]);
  });
});

test.each(['physical', 'magical', 'pure'])('Archer outgoing %s damage is reduced once, including periodic damage', type => {
  const source = { class: 'Archer', hp: 100 };
  const target = () => ({ hp: 1000, maxHp: 1000, physDef: 0, magicDef: 0, effects: [] });
  expect(applyDamage(target(), 100, type, { source })).toBe(80);
  expect(applyDamage(target(), 100, type, { source, isPeriodic: true, fromEffect: 'bleed' })).toBe(80);
  expect(applyDamage(target(), 80, type, { source, bypassDamageModifiers: true })).toBe(80);
  expect(applyDamage(target(), 80, type, { source, bypassClassDamageMultiplier: true })).toBe(80);
  // Defender's outgoing multiplier is 1.3; defenderDamageBalance.test.js owns
  // that rule. This line only proves the class multiplier is applied once.
  expect(applyDamage(target(), 100, type, { source: { class: 'Defender', hp: 100 } })).toBe(130);
});

test('old Archer saves rehydrate with 176 base speed without compounding the nerf', () => {
  const old = { name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 9, speed: 220,
    baseStats: { maxHp: 90, attack: 9, speed: 220 }, equipment: { legs: 'Походные сапоги' }, inventory: [] };
  const loaded = hydratePlayerSnapshot(old);
  expect(loaded.baseStats.speed).toBe(176);
  expect(loaded.speed).toBe(185);
  const again = hydratePlayerSnapshot(buildPlayerSnapshot(loaded));
  expect(again.baseStats.speed).toBe(176);
  expect(again.speed).toBe(185);
});
