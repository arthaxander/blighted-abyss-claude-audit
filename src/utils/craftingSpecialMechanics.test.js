import { handleShieldBreak, triggerRuneOnDamageTaken, triggerRuneOnHit } from './combatUtils';

test('Flame Heart counts attacking actions rather than hits', () => {
  const attacker = { name: 'Герой', activeRunes: { weapon: 'ember_heart' }, turnMeter: 10 };
  const target = { name: 'Цель', hp: 100, maxHp: 100, effects: [] };
  const ability = { name: 'Серия', targeting: 'enemy' };
  triggerRuneOnHit(attacker, target, { ability });
  triggerRuneOnHit(attacker, target, { ability });
  expect(target.effects).toHaveLength(0);
  attacker.turnMeter = 20; triggerRuneOnHit(attacker, target, { ability });
  attacker.turnMeter = 30; triggerRuneOnHit(attacker, target, { ability });
  expect(target.effects.find(effect => effect.id === 'burn')).toMatchObject({ remainingTurns: 1 });
});

test('Steel Rebuke counter cannot recursively trigger itself', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const owner = { name: 'Герой', hp: 100, maxHp: 100, attack: 20, physDef: 0, effects: [], activeRunes: { armor: 'stone_vigil' } };
  const enemy = { name: 'Враг', hp: 100, maxHp: 100, physDef: 0, effects: [], activeRunes: { armor: 'stone_vigil' } };
  triggerRuneOnDamageTaken(owner, { source: enemy, directAttack: true });
  expect(enemy.hp).toBe(88);
  triggerRuneOnDamageTaken(enemy, { source: owner, directAttack: true, fromEffect: 'steel_rebuke' });
  expect(owner.hp).toBe(100);
  Math.random.mockRestore();
});

test('Astral Echo splashes only the first single-target action and never copies statuses', () => {
  const attacker = { activeRunes: { ring: 'astral_focus' }, _astralEchoAvailable: true };
  const primary = { hp: 100, maxHp: 100, effects: [] };
  const secondary = { hp: 100, maxHp: 100, physDef: 0, effects: [] };
  const session = { state: { enemies: [primary, secondary] } };
  triggerRuneOnHit(attacker, primary, { ability: { name: 'Луч', targeting: 'enemy' }, dealt: 50, session });
  expect(secondary.hp).toBe(86);
  expect(secondary.effects).toEqual([]);
  triggerRuneOnHit(attacker, primary, { ability: { name: 'Луч 2', targeting: 'enemy' }, dealt: 50, session });
  expect(secondary.hp).toBe(86);
});

test('Wandering Spore Crown reacts only through the shield-break path and starts cooldown', () => {
  const owner = { hp: 50, maxHp: 50, effects: [{ id: 'shield', value: 0 }], equipment: { helmet: 'Венец блуждающих спор' } };
  handleShieldBreak(owner, {});
  expect(owner.effects.find(effect => effect.id === 'regeneration')).toBeTruthy();
  expect(owner._sporeCrownCooldown).toBe(3);
});
