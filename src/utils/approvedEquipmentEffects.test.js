import {
  applyDeserterGrimoireCooldown,
  getPathfinderHoodCritBonus,
  getScoutCloakDirectMultiplier,
  registerStretchedBowDirectTarget,
  resolveMarkedBowstringCritBonus,
  applyOathbreakerAction,
  getOathbreakerCritBonus,
  prepareOathbreakerPrimaryTarget,
} from './combatUtils';

const ownerWith = name => ({ equipment: { mainHand: name }, turnMeter: 0 });

describe('approved non-starter equipment mechanics', () => {
  test('grimoire reduces only the first qualifying authored cooldown', () => {
    const owner = ownerWith('Полевой гримуар Отступника');
    const long = { name: 'Long', cooldown: 3, currentCooldown: 3 };
    expect(applyDeserterGrimoireCooldown(owner, long)).toBe(true);
    expect(long.currentCooldown).toBe(2);
    const second = { name: 'Second', cooldown: 2, currentCooldown: 2 };
    expect(applyDeserterGrimoireCooldown(owner, second)).toBe(false);
    expect(second.currentCooldown).toBe(2);
    expect(applyDeserterGrimoireCooldown(ownerWith('Полевой гримуар Отступника'), { cooldown: 1, currentCooldown: 1 })).toBe(false);
  });

  test('hunting bow grants TM once per unique bleeding target in an action', () => {
    const owner = ownerWith('Натянутый охотничий лук');
    const action = {};
    const targets = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    targets.forEach(target => expect(registerStretchedBowDirectTarget(owner, target, action, true)).toBe(150));
    expect(owner.turnMeter).toBe(450);
    expect(registerStretchedBowDirectTarget(owner, targets[0], action, true)).toBe(0);
    expect(registerStretchedBowDirectTarget(owner, { id: 'd' }, action, false)).toBe(0);
  });

  test('pathfinder hood expires only after a completed enemy action', () => {
    const owner = ownerWith('Капюшон Следопыта');
    expect(getPathfinderHoodCritBonus(owner)).toBe(0.17);
    owner._enemyCompletedFullTurn = true;
    expect(getPathfinderHoodCritBonus(owner)).toBe(0);
  });

  test('scout cloak protects every packet of exactly one deliberate enemy action', () => {
    const owner = ownerWith('Плащ разведчика');
    const first = {};
    expect(getScoutCloakDirectMultiplier(owner, first)).toBe(0.6);
    expect(getScoutCloakDirectMultiplier(owner, first)).toBe(0.6);
    expect(getScoutCloakDirectMultiplier(owner, {})).toBe(1);
  });

  test('marked bowstring ring advances primary-target chain and resets on switch', () => {
    const owner = ownerWith('Кольцо Меткой Тетивы');
    const a = { id: 'a' }; const b = { id: 'b' };
    expect(resolveMarkedBowstringCritBonus(owner, a)).toBe(0);
    expect(resolveMarkedBowstringCritBonus(owner, a)).toBe(0.1);
    expect(resolveMarkedBowstringCritBonus(owner, a)).toBe(0.2);
    expect(resolveMarkedBowstringCritBonus(owner, a)).toBe(0.2);
    expect(resolveMarkedBowstringCritBonus(owner, b)).toBe(0);
    expect(resolveMarkedBowstringCritBonus(owner, b)).toBe(0.1);
  });

  test('Oathbreaker uses originating action identity, caps at three, and resets on target switch', () => {
    const owner = ownerWith('Клятвопреступник');
    const a = { id: 'a' }; const b = { id: 'b' };
    const first = {};
    expect(applyOathbreakerAction(owner, a, first)).toBe(true);
    expect(applyOathbreakerAction(owner, a, first)).toBe(false);
    expect(owner.turnMeter).toBe(50); expect(getOathbreakerCritBonus(owner)).toBe(0.05);
    applyOathbreakerAction(owner, a, {}); applyOathbreakerAction(owner, a, {}); applyOathbreakerAction(owner, a, {});
    expect(owner.turnMeter).toBe(200); expect(getOathbreakerCritBonus(owner)).toBeCloseTo(0.15);
    prepareOathbreakerPrimaryTarget(owner, b);
    expect(getOathbreakerCritBonus(owner)).toBe(0);
    expect(owner.effects.some(effect => effect.id === 'combat_rhythm')).toBe(false);
  });
});
