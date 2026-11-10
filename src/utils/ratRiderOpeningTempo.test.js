import { getEnemyBlueprintByName } from '../data/enemies';
import {
  GOBLIN_SUBLOCATION_IDS,
  RAT_RIDERS_START_METER,
  applySublocationEnemyModifiers,
} from '../data/expeditionSublocations';
import { initCombatSession } from './combatUtils';

const hero = {
  name: 'Tester',
  class: 'Defender',
  hp: 500,
  maxHp: 500,
  attack: 20,
  speed: 100,
  abilities: ['Атака'],
  activeSublocationEffectId: 'rat-riders',
};

const enemyBlueprints = () => [
  getEnemyBlueprintByName('Крысиный всадник'),
  getEnemyBlueprintByName('Гоблин-Ткач'),
];

test('Rat Passages grants one opening initiative bonus but no permanent speed', () => {
  const blueprints = enemyBlueprints();
  const initialSpeeds = blueprints.map(enemy => enemy.speed);
  const session = initCombatSession(hero, blueprints, { rng: () => 0.99 });
  const [rider, weaver] = session.state.enemies;

  expect([rider.turnMeter, weaver.turnMeter]).toEqual([
    RAT_RIDERS_START_METER.rat,
    RAT_RIDERS_START_METER.other,
  ]);
  expect([rider.speed, weaver.speed]).toEqual(initialSpeeds);
  expect(session.sublocationEffectId).toBe('rat-riders');
});

test('pre-decorated encounter bonus is idempotent and works with existing start meter bonus', () => {
  const first = applySublocationEnemyModifiers(
    'Гоблинские Норы',
    GOBLIN_SUBLOCATION_IDS.RAT_RIDERS,
    enemyBlueprints().map(enemy => ({ ...enemy, startingTurnMeterBonus: 50 }))
  );
  const second = applySublocationEnemyModifiers(
    'Гоблинские Норы',
    GOBLIN_SUBLOCATION_IDS.RAT_RIDERS,
    first
  );
  expect(second.map(enemy => enemy.startingTurnMeterBonus)).toEqual([350, 200]);

  const session = initCombatSession(hero, second, { rng: () => 0.99 });
  expect(session.state.enemies.map(enemy => enemy.turnMeter)).toEqual([350, 200]);
  expect(session.state.enemies.map(enemy => enemy.speed)).toEqual(
    second.map(enemy => enemy.speed)
  );
});
