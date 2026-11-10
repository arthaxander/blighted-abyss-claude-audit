import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { consumeCombatPresentationEvents, buildCombatPresentationTimeline } from './combatPresentationEvents';
import { initCombatSession, performPlayerAction } from './combatUtils';

test('production Endurance records committed shield gain before a following actor can start', () => {
  const endurance = { ...ABILITY_LIBRARY['Стойкость'] };
  const player = { name: 'Защитник', hp: 100, maxHp: 100, shield: 0, attack: 5, speed: 100, physDef: 0, magicDef: 0, abilities: [endurance] };
  const enemy = { name: 'Враг', hp: 10, maxHp: 10, attack: 1, speed: 1, physDef: 0, magicDef: 0, abilities: [] };
  const session = initCombatSession(player, [enemy]); session.state.initiative.playerReady = true;
  performPlayerAction(session, 'Стойкость', 0);
  expect(session.state.players[0].shield).toBe(35);
  const events = consumeCombatPresentationEvents(session);
  const gain = events.find(event => event.type === 'shieldGain');
  expect(gain).toMatchObject({ amount: 35, targetAfter: expect.objectContaining({ shield: 35 }) });
  const timeline = buildCombatPresentationTimeline([...events, { type: 'actionStart', actor: enemy, actorSide: 'enemy' }]);
  expect(timeline.find(event => event.type === 'shieldGain').at).toBeLessThan(timeline.at(-1).at);
});
