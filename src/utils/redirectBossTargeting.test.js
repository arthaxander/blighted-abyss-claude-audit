import { createAbilityByName } from '../data/abilityPresets';
import { consumeArcherRedirect, initCombatSession } from './combatUtils';

const archer = () => ({ id: 'archer', name: 'Лучник', class: 'Archer', hp: 80, maxHp: 80, abilities: [], effects: [], _redirectPrepared: true });
const boss = () => ({ id: 'mycelium', name: 'Троглодит-мицелий (босс)', hp: 400, maxHp: 400, abilities: [], effects: [], boss: true });

describe('Redirect uses canonical targeting for bosses', () => {
  test('qualifying Mycelium single-target attack respects Redirect', () => {
    const hero = archer(); const enemy = boss(); const ally = { id: 'ally', name: 'Союзник', hp: 10, maxHp: 10, effects: [] };
    const session = initCombatSession(hero, [enemy, ally]); session.rng = () => 0;
    const combatHero = session.state.players[0]; const combatEnemy = session.state.enemies[0]; const combatAlly = session.state.enemies[1];
    combatHero._redirectPrepared = true;
    const ability = createAbilityByName('Споровой паралич');
    const result = consumeArcherRedirect(combatEnemy, combatHero, ability, 20, session, jest.fn());
    expect(result.target).toBe(combatAlly); expect(combatHero._redirectPrepared).toBe(false);
  });

  test.each(['Споровой выброс', 'Грибная сеть'])('Mycelium AoE %s is not redirected or consumed', name => {
    const hero = archer(); const enemy = boss();
    const session = initCombatSession(hero, [enemy]);
    const result = consumeArcherRedirect(enemy, hero, createAbilityByName(name), 20, session, jest.fn());
    expect(result.target).toBe(hero); expect(hero._redirectPrepared).toBe(true);
  });
});
