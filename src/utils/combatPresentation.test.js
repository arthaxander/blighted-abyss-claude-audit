import {
  formatHealthWithShield,
  getCombatActionGridAbilities,
  getCooldownPresentationFraction,
  getHealthShieldSegments,
  getVisibleStatuses,
} from "./combatPresentation";

describe("combat presentation helpers", () => {
  test.each([
    [4, 4, 1],
    [4, 3, 0.75],
    [4, 2, 0.5],
    [4, 1, 0.25],
    [4, 0, 0],
    [0, 3, 0],
  ])("maps cooldown %s/%s to radial fraction %s", (cooldown, currentCooldown, expected) => {
    expect(getCooldownPresentationFraction({ cooldown, currentCooldown })).toBe(expected);
  });

  test("places basic attack third without changing class ability order", () => {
    const abilities = [
      { name: "Ability 1" },
      { name: "Ability 2" },
      { name: "Ability 3" },
      { name: "Ability 4" },
      { name: "Attack", basic: true, artId: "attack" },
    ];

    expect(getCombatActionGridAbilities(abilities).map(ability => ability.name)).toEqual([
      "Ability 1", "Ability 2", "Attack", "Ability 3", "Ability 4",
    ]);
  });

  test("keeps statuses within capacity and reserves the final slot for overflow", () => {
    const statuses = Array.from({ length: 11 }, (_, index) => ({ id: index }));
    expect(getVisibleStatuses(statuses, 10)).toEqual({
      visible: statuses.slice(0, 9),
      hiddenCount: 2,
    });
    expect(getVisibleStatuses(statuses.slice(0, 10), 10)).toEqual({
      visible: statuses.slice(0, 10),
      hiddenCount: 0,
    });
  });

  test("dense status overflow is deterministic without mutating mechanical effects", () => {
    const statuses = Array.from({ length: 6 }, (_, index) => ({ id: index }));
    expect(getVisibleStatuses(statuses, 3)).toEqual({
      visible: statuses.slice(0, 2),
      hiddenCount: 4,
    });
    expect(statuses).toHaveLength(6);
  });

  test("formats health without a zero shield suffix", () => {
    expect(formatHealthWithShield(100, 0, 110)).toBe("100/110");
    expect(formatHealthWithShield(100, 20, 110)).toBe("100/110 +20");
    expect(formatHealthWithShield(65, 25, 125)).not.toBe("65+25/125");
  });

  test("keeps oversized shield visible without changing its value", () => {
    const segments = getHealthShieldSegments(50, 200, 100);
    expect(segments.hpPercent).toBeCloseTo(16.67, 1);
    expect(segments.shieldPercent).toBeCloseTo(66.67, 1);
    expect(segments.missingPercent).toBeCloseTo(16.67, 1);
    expect(Object.values(segments).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100);
  });
});

describe('battlefield status presentation', () => {
  const { presentCombatStatuses } = require('./combatPresentation');

  test('aggregates true stacks before capacity and uses the longest duration', () => {
    const raw = [
      ...[1, 2, 3].map(remainingTurns => ({ id: 'combat_rhythm', remainingTurns })),
      { id: 'burn', remainingTurns: 2 },
      { id: 'slow', remainingTurns: 1 },
    ];
    const statuses = presentCombatStatuses(raw);
    expect(statuses).toHaveLength(3);
    expect(statuses[0]).toMatchObject({ id: 'combat_rhythm', stacks: 3, remainingTurns: null });
    expect(getVisibleStatuses(statuses, 3).hiddenCount).toBe(0);
  });

  test('aggregates ice shards without presenting a duration', () => {
    expect(presentCombatStatuses([
      { id: 'ice_shards', remainingTurns: 1 },
      { id: 'ice_shards', remainingTurns: 3 },
    ])[0]).toMatchObject({ stacks: 2, remainingTurns: null });
  });

  test.each(['poison', 'regeneration'])('%s instances remain independent with their turns', id => {
    const statuses = presentCombatStatuses([{ id, remainingTurns: 1 }, { id, remainingTurns: 2 }]);
    expect(statuses).toHaveLength(2);
    expect(statuses.map(status => status.remainingTurns)).toEqual([1, 2]);
    expect(statuses.every(status => status.stacks === 1)).toBe(true);
  });

  test('one stack is retained while permanent and sentinel durations stay hidden', () => {
    expect(presentCombatStatuses([{ id: 'combat_rhythm', duration: 999 }])[0]).toMatchObject({ stacks: 1, remainingTurns: null });
    expect(presentCombatStatuses([{ id: 'preparation', remainingTurns: 999 }])[0].remainingTurns).toBeNull();
  });

  test('marks authoritative unremovable resources', () => {
    expect(presentCombatStatuses([{ id: 'supplies', stacks: 2 }])[0]).toMatchObject({ type: 'resource', stacks: 2, unremovable: true });
    expect(presentCombatStatuses([{ id: 'burn' }])[0].unremovable).toBe(false);
  });
});
