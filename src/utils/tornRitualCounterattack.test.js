import { addEffect } from './effects';
import { applyDamage, initCombatSession } from './combatUtils';

const makeSession = () => {
  const hero = {
    id: 'hero', name: 'Герой', class: 'Defender',
    hp: 100, maxHp: 100, attack: 15, physDef: 0, magicDef: 0, speed: 100,
    equipment: { armor: 'Куртка сорванного ритуала' },
    abilities: [{ name: 'Атака', basic: true, damage: 10, type: 'physical', targeting: 'enemy', cooldown: 0 }],
    items: [], currentLocation: 'Лес Увядания',
  };
  const foe = {
    id: 'foe', name: 'Враг', hp: 200, maxHp: 200,
    attack: 20, physDef: 0, magicDef: 0, speed: 100,
    abilities: [{ name: 'Атака', basic: true, damage: 20, type: 'physical', targeting: 'enemy', cooldown: 0 }],
    location: 'Лес Увядания',
  };
  const session = initCombatSession(hero, [foe]);
  return { session, hero: session.state.players[0], foe: session.state.enemies[0] };
};

test('enemy counterattacks consume one timed debuff and trigger Torn Ritual mitigation only once per owner turn', () => {
  const { session, hero, foe } = makeSession();
  addEffect(foe, { id: 'burn', duration: 4 }, () => {}, hero, { session });
  const firstDuration = foe.effects.find(effect => effect.id === 'burn').remainingTurns;
  const startingHp = hero.hp;
  applyDamage(hero, 20, 'physical', {
    source: foe, session, fromEffect: 'boneguard_retaliation',
    counterAttack: true, directAttack: false, logFn: () => {},
  });
  expect(startingHp - hero.hp).toBe(16);
  expect(foe.effects.find(effect => effect.id === 'burn').remainingTurns).toBe(firstDuration - 1);
  applyDamage(hero, 20, 'physical', {
    source: foe, session, fromEffect: 'boneguard_retaliation',
    counterAttack: true, directAttack: false, logFn: () => {},
  });
  expect(startingHp - hero.hp).toBe(36);
  expect(foe.effects.find(effect => effect.id === 'burn').remainingTurns).toBe(firstDuration - 1);
});

test('periodic or reflected damage is not treated as a counterattack', () => {
  const { session, hero, foe } = makeSession();
  addEffect(foe, { id: 'burn', duration: 4 }, () => {}, hero, { session });
  const duration = foe.effects.find(effect => effect.id === 'burn').remainingTurns;
  const startingHp = hero.hp;
  applyDamage(hero, 20, 'physical', {
    source: foe, session, fromEffect: 'reflected_damage',
    directAttack: false, logFn: () => {},
  });
  expect(startingHp - hero.hp).toBe(20);
  expect(foe.effects.find(effect => effect.id === 'burn').remainingTurns).toBe(duration);
});
