import { createAbilityByName } from '../data/abilityPresets';
import { chooseCombatAction, getLegalCombatActions } from './combatSimulator';
import { resolveSimulationPlayerProfile } from './simulationPlayerProfiles';

const scenario = (count, attack = 1) => {
  const player = resolveSimulationPlayerProfile({ classId: 'Mage', profile: 'bare_base', relicLevel: 1, consumables: [] }).player;
  return { state: { players: [{ ...player, effects: [], shield: 0, turnMeter: 1000 }], enemies: Array.from({ length: count }, (_, i) => ({ name: `Enemy ${i}`, hp: 200, maxHp: 200, attack, speed: 100, turnMeter: 0, effects: [], abilities: [], physDef: 0, magicDef: 0 })) } };
};
const choose = session => chooseCombatAction({ policy: 'competent', session, rng: () => 0.5 });

test('competent mage recognizes secondary AoE without corrupting primary lethal damage', () => {
  const session = scenario(3);
  const chosen = choose(session);
  expect(chosen.ability.artId).toBe('chain_lightning');
  expect(chosen.expectedDamage).toBe(createAbilityByName('Цепная молния').damage({ attacker: session.state.players[0] }));
  expect(choose(scenario(1)).ability.artId).toBe('fireball');
});

test('competent mage uses available shield against pressure and respects cooldown', () => {
  const session = scenario(3, 20);
  const player = session.state.players[0];
  player.abilities.find(a => a.artId === 'chain_lightning').currentCooldown = 2;
  expect(choose(session).ability.artId).toBe('frost_shield');
  player.abilities.find(a => a.artId === 'frost_shield').currentCooldown = 2;
  expect(getLegalCombatActions(session).some(a => a.ability?.artId === 'frost_shield')).toBe(false);
  expect(choose(session).ability.artId).toBe('fireball');
});

test('existing shield removes marginal defense value and scoring is pure', () => {
  const session = scenario(3, 20);
  session.state.players[0].shield = 100;
  session.state.players[0].abilities.find(a => a.artId === 'chain_lightning').currentCooldown = 2;
  const before = JSON.stringify(session);
  expect(choose(session).ability.artId).toBe('fireball');
  expect(JSON.stringify(session)).toBe(before);
});
