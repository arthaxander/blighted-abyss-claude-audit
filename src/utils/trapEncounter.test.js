import { allEnemies } from '../data/enemies';
import { createTrapAmbush, getTrapMetal } from './trapEncounter';
import { isStrongEnemy } from './levelOneProgression';
import { isCursedRoomEnemy, DESERTER_LOCATION } from './enemyPools';
import { initCombatSession, TURN_METER_THRESHOLD } from './combatUtils';

const locations = ['Гоблинские Норы', 'Грибные Пещеры', DESERTER_LOCATION, 'Лес Увядания', 'Руины Неупокоенных', 'Шахты Тления'];
test.each(locations)('ordinary %s trap packs contain two eligible enemies and do not mutate blueprints', location => {
  for (const roll of [0, 0.2, 0.5, 0.8, 0.999]) {
    const pack = createTrapAmbush(allEnemies, location, 0, () => roll);
    expect(pack).toHaveLength(2);
    pack.forEach(enemy => {
      expect(enemy.location).toBe(location);
      expect(enemy.boss || enemy.summonOnly || isStrongEnemy(enemy) || isCursedRoomEnemy(enemy)).toBeFalsy();
      expect(enemy.startingTurnMeterBonus).toBe(400);
    });
  }
  expect(allEnemies.filter(e => e.startingTurnMeterBonus === 400)).toHaveLength(0);
});
test('strong and cursed enemies remain excluded late in a run, including alert reinforcements', () => {
  locations.forEach(location => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const pack = createTrapAmbush(allEnemies, location, 20, () => roll);
      expect(pack.length).toBeGreaterThan(0);
      pack.forEach(enemy => expect(isStrongEnemy(enemy) || isCursedRoomEnemy(enemy) || enemy.boss).toBeFalsy());
    }
  });
});
test('a single eligible enemy remains one; empty pool never substitutes a boss', () => {
  expect(createTrapAmbush([{ name: 'Один', location: 'test' }], 'test')).toHaveLength(1);
  expect(createTrapAmbush([{ name: 'Босс', location: 'test', boss: true }], 'test')).toEqual([]);
});
test('trap opening initiative stacks with rat-rider sublocation: 55% and 70%', () => {
  const pack = createTrapAmbush(allEnemies, 'Гоблинские Норы', 0, () => 0.5);
  const player = { name: 'Тест', hp: 100, maxHp: 100, attack: 10, speed: 100, currentLocation: 'Гоблинские Норы', activeSublocationEffectId: 'rat-riders' };
  const baseline = initCombatSession(player, pack.map(({ startingTurnMeterBonus, ...enemy }) => enemy), { rng: () => 0.99 });
  const ambush = initCombatSession(player, pack, { rng: () => 0.99 });
  ambush.state.enemies.forEach((enemy, i) => {
    expect(enemy.turnMeter).toBe(baseline.state.enemies[i].turnMeter + TURN_METER_THRESHOLD * 0.4);
    expect([550, 700]).toContain(enemy.turnMeter);
  });
});
test('reward uses existing metal for the current floor', () => {
  expect(getTrapMetal('Гоблинские Норы', 1)).toBe('Металлические обломки');
  expect(getTrapMetal('Лес Увядания', 1)).toBe('Сумрачный сплав');
  expect(getTrapMetal('Шахты Тления', 2)).toBe('Сумрачный сплав');
});
