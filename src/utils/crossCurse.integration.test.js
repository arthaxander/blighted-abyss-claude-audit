import { isAbyssBound } from '../data/curses';
import { applyDamage, initCombatSession, performPlayerAction } from './combatUtils';
import { getEffectStackCount } from './effects';

const attack = { name: 'Атака', basic: true, targeting: 'enemy', accuracy: 1, damage: 100, cooldown: 0, type: 'physical' };
const skill = { name: 'Ритуальный удар', targeting: 'enemy', accuracy: 1, damage: 100, cooldown: 2, type: 'physical' };
const sessionFor = curses => initCombatSession({
  name: 'Герой', hp: 500, maxHp: 500, attack: 100, speed: 100, critChance: 0,
  curses, abilities: [attack, skill],
}, [{ name: 'Цель', hp: 5000, maxHp: 5000, attack: 20, speed: 1, physDef: 0, abilities: [] }], { rng: () => 0.99 });
const act = (session, name = 'Атака') => {
  session.state.turnState = null;
  session.state.initiative.playerReady = true;
  return performPlayerAction(session, name, 0);
};

describe('cross-curse systemic regression', () => {
  test('secondary I–II curses remain active beside a tier III dominant curse', () => {
    const session = sessionFor({ corruption: { tier: 2 }, decay: { tier: 1 }, withering: { tier: 3 } });
    const hero = session.state.players[0];
    expect(hero.speed).toBe(115);
    act(session);
    expect(getEffectStackCount(hero, 'thirst')).toBe(1);
    expect(hero.baseStats.speed).toBe(100);
  });

  test('outgoing modifiers from different curses enter the shared pipeline once each', () => {
    const session = sessionFor({ corruption: { tier: 1 }, decay: { tier: 1 } });
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    act(session); // grants one Thirst after this hit
    const before = enemy.hp;
    applyDamage(enemy, 100, 'pure', { source: hero, session });
    expect(before - enemy.hp).toBe(110); // 5% Thirst + 5% Decay
  });

  test('a new combat keeps tiers but resets all temporary curse resources', () => {
    const curses = { corruption: { tier: 5 }, distortion: { tier: 5 }, withering: { tier: 5 }, undeath: { tier: 5 }, decay: { tier: 5 } };
    const first = sessionFor(curses);
    act(first);
    expect(getEffectStackCount(first.state.players[0], 'thirst')).toBe(1);
    const next = sessionFor(curses);
    expect(next.state.players[0].curses).toEqual(curses);
    expect(getEffectStackCount(next.state.players[0], 'thirst')).toBe(0);
    expect(next.state.players[0]._refraction).toBe(0);
    expect(next.state.players[0]._undeathDeathSaveConsumed).toBe(false);
  });

  test('abyss binding is derived immediately from current tiers', () => {
    const curses = { corruption: { tier: 4 }, distortion: { tier: 4 } };
    expect(isAbyssBound(curses)).toBe(false);
    curses.distortion.tier = 5;
    expect(isAbyssBound(curses)).toBe(true);
    curses.distortion.tier = 4;
    expect(isAbyssBound(curses)).toBe(false);
  });
});
