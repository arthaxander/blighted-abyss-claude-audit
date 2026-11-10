import { applyDamage, handleShieldBreak } from './combatUtils';
import { getClassDamageMultiplier } from '../data/classCombatBalance';

test.each(['physical', 'magical', 'pure'])('Defender outgoing %s damage gains 30%, including periodic damage', type => {
  const source = { class: 'Defender', hp: 100 };
  const target = () => ({ hp: 1000, maxHp: 1000, physDef: 0, magicDef: 0, effects: [] });
  expect(applyDamage(target(), 100, type, { source })).toBe(130);
  expect(applyDamage(target(), 100, type, { source, isPeriodic: true, fromEffect: 'bleed' })).toBe(130);
  for (const flag of ['bypassDamageModifiers', 'bypassOutgoingModifiers', 'bypassClassDamageMultiplier']) {
    expect(applyDamage(target(), 120, type, { source, [flag]: true })).toBe(120);
  }
  expect(applyDamage(target(), 100, type, { source: { ...source, summoned: true } })).toBe(100);
  expect(getClassDamageMultiplier({ class: 'Защитник' })).toBe(1.3);
  expect(getClassDamageMultiplier({ class: 'Mage' })).toBe(1);
});

test('Shield-break equipment works when inverted healing supplies a null logger', () => {
  const hero = {
    name: 'Защитник', class: 'Defender', hp: 100, maxHp: 100,
    attack: 10, physDef: 0, magicDef: 0, speed: 100, shield: 0,
    equipment: { offHand: 'Щит третьей заплаты' },
    effects: [{ id: 'shield', value: 0, appliedShield: 0, remainingTurns: 1 }],
    abilities: [],
  };
  expect(() => handleShieldBreak(hero, { logFn: null })).not.toThrow();
  expect(hero.effects.some(effect => effect.id === 'block')).toBe(true);
  // Once per battle, and with a regular logger the same behavior remains.
  expect(() => handleShieldBreak(hero, { logFn: jest.fn() })).not.toThrow();
  expect(hero.effects.filter(effect => effect.id === 'block')).toHaveLength(1);
});
