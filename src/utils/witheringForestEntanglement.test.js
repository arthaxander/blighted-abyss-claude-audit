import {
  ENTANGLEMENT_MAX_STACKS,
  ENTANGLEMENT_SPEED_PENALTY_PER_STACK,
  advanceEntanglementDecayAtTurnEnd,
  applyEntanglementSpeed,
  consumeEntanglementAtTurnEnd,
  getEntanglementStacks,
} from './witheringForestEntanglement';

const root = (stacks = 1) => ({ id: 'entanglement', stacks, persistent: true });

describe('Withering Forest Entanglement primitives', () => {
  test('limits the effective stack count to five', () => {
    const unit = { effects: Array.from({ length: 7 }, () => root()) };
    expect(ENTANGLEMENT_MAX_STACKS).toBe(5);
    expect(getEntanglementStacks(unit)).toBe(5);
    expect(applyEntanglementSpeed(100, unit)).toBe(70);
  });

  test('supports an effect serialized with multiple stacks', () => {
    expect(getEntanglementStacks({ effects: [root(3), root(1)] })).toBe(4);
    expect(getEntanglementStacks({ effects: [root(8)] })).toBe(5);
  });

  test('does not compound the slowdown or mutate canonical Speed', () => {
    const unit = { speed: 100, effects: [root(2)] };
    expect(ENTANGLEMENT_SPEED_PENALTY_PER_STACK).toBe(0.06);
    expect(applyEntanglementSpeed(unit.speed, unit)).toBe(88);
    expect(applyEntanglementSpeed(unit.speed, unit)).toBe(88);
    expect(unit.speed).toBe(100);
  });

  test('applies after pre-existing haste, slow and location multipliers', () => {
    const unit = { effects: [root(5)] };
    expect(applyEntanglementSpeed(115, unit)).toBe(81);
    expect(applyEntanglementSpeed(92, unit)).toBe(64);
    expect(applyEntanglementSpeed(85, unit)).toBe(59);
  });

  test('decays only one independent stack per explicitly completed turn', () => {
    const other = { id: 'poison', remainingTurns: 3 };
    const unit = { effects: [other, root(), root(), root()] };
    expect(consumeEntanglementAtTurnEnd(unit)).toBe(2);
    expect(getEntanglementStacks(unit)).toBe(2);
    expect(unit.effects).toContain(other);
    expect(other.remainingTurns).toBe(3);
    expect(consumeEntanglementAtTurnEnd(unit)).toBe(1);
    expect(consumeEntanglementAtTurnEnd(unit)).toBe(0);
    expect(consumeEntanglementAtTurnEnd(unit)).toBe(0);
  });

  test('natural decay removes one stack only after every second completed own turn', () => {
    const unit = { effects: [root(), root(), root()] };
    expect(advanceEntanglementDecayAtTurnEnd(unit)).toBe(3);
    expect(unit._entanglementDecayTurns).toBe(1);
    expect(advanceEntanglementDecayAtTurnEnd(unit)).toBe(2);
    expect(unit._entanglementDecayTurns).toBe(0);
    expect(advanceEntanglementDecayAtTurnEnd(unit)).toBe(2);
    expect(advanceEntanglementDecayAtTurnEnd(unit)).toBe(1);
  });

  test('two-turn decay cadence survives JSON combat snapshots', () => {
    const original = { effects: [root(), root()] };
    expect(advanceEntanglementDecayAtTurnEnd(original)).toBe(2);
    const restored = JSON.parse(JSON.stringify(original));
    expect(restored._entanglementDecayTurns).toBe(1);
    expect(advanceEntanglementDecayAtTurnEnd(restored)).toBe(1);
    expect(restored._entanglementDecayTurns).toBe(0);
  });

  test('protected current-turn stacks are preserved and reported accurately', () => {
    const unit = { effects: [{ ...root(), _appliedTurnEpoch: 7 }] };
    expect(consumeEntanglementAtTurnEnd(unit, 7)).toBe(1);
    expect(getEntanglementStacks(unit)).toBe(1);
  });

  test('decays a serialized multi-stack effect without destroying metadata', () => {
    const unit = { effects: [{ ...root(3), sourceId: 'witch', iconPath: '/entangle.webp' }] };
    expect(consumeEntanglementAtTurnEnd(unit)).toBe(2);
    expect(unit.effects[0]).toEqual(expect.objectContaining({
      id: 'entanglement', stacks: 2, sourceId: 'witch', iconPath: '/entangle.webp',
    }));
  });

  test('does not touch unrelated effects or create an effect for a clear unit', () => {
    const unit = { effects: [{ id: 'speed_boost_minor' }] };
    expect(consumeEntanglementAtTurnEnd(unit)).toBe(0);
    expect(unit.effects).toEqual([{ id: 'speed_boost_minor' }]);
    expect(getEntanglementStacks(null)).toBe(0);
    expect(applyEntanglementSpeed(100, null)).toBe(100);
  });

  test('stack counts and decay survive JSON combat snapshots', () => {
    const original = { hp: 100, effects: [root(), root(), { id: 'poison', remainingTurns: 2 }] };
    const restored = JSON.parse(JSON.stringify(original));
    expect(getEntanglementStacks(restored)).toBe(2);
    expect(consumeEntanglementAtTurnEnd(restored)).toBe(1);
    expect(applyEntanglementSpeed(100, restored)).toBe(94);
    expect(original.effects).toHaveLength(3);
  });
});
