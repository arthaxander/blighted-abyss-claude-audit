import { executeValidCombatDrop, getValidCombatTargets } from './combatTargeting';

const hero = { id: 'hero', hp: 100 };
const unit = (id, options = {}) => ({ id, hp: 100, effects: [], ...options });
const ids = (action, enemies) => getValidCombatTargets({
  action: { targeting: action }, players: [hero], enemies,
}).map(target => target.id);

describe('Withering Forest target-selection recovery', () => {
  test('a visible living Guard intercepts direct enemy-targeted actions', () => {
    const enemies = [unit('normal'), unit('guard', { effects: [{ id: 'guard', duration: 2 }] })];
    expect(ids('enemy', enemies)).toEqual(['enemy:guard']);
    expect(ids('allEnemies', enemies)).toEqual(['enemy:normal', 'enemy:guard']);
    expect(ids('enemies', enemies)).toEqual(['enemy:normal', 'enemy:guard']);
  });

  test('multiple Guards remain selectable and a dead Guard does not intercept', () => {
    const enemies = [unit('one', { effects: [{ id: 'guard' }] }),
      unit('two', { effects: [{ id: 'guard' }] }), unit('normal')];
    expect(ids('enemy', enemies)).toEqual(['enemy:one', 'enemy:two']);
    enemies[0].hp = 0;
    expect(ids('enemy', enemies)).toEqual(['enemy:two']);
    enemies[1].hp = 0;
    expect(ids('enemy', enemies)).toEqual(['enemy:normal']);
  });

  test('a hidden Guard cannot intercept while visible enemies remain', () => {
    const enemies = [unit('hidden-guard', { invisible: true, effects: [{ id: 'guard' }] }),
      unit('visible')];
    expect(ids('enemy', enemies)).toEqual(['enemy:visible']);
    expect(ids('allEnemies', enemies)).toEqual(['enemy:hidden-guard', 'enemy:visible']);
  });

  test('hidden enemies cannot be selected directly while a visible target exists', () => {
    const enemies = [unit('hidden', { invisible: true }), unit('visible')];
    expect(ids('enemy', enemies)).toEqual(['enemy:visible']);
    expect(ids('allEnemies', enemies)).toEqual(['enemy:hidden', 'enemy:visible']);
  });

  test('when every living enemy is invisible, the fallback permits direct targeting', () => {
    const enemies = [unit('hidden-a', { invisible: true }),
      unit('hidden-b', { invisible: true }), unit('dead', { hp: 0 })];
    expect(ids('enemy', enemies)).toEqual(['enemy:hidden-a', 'enemy:hidden-b']);
  });

  test('self and friendly targeting are unchanged by hostile Guard and invisibility', () => {
    const enemies = [unit('guard', { invisible: true, effects: [{ id: 'guard' }] })];
    const players = [hero, unit('ally')];
    expect(getValidCombatTargets({ action: { targeting: 'self' }, players, enemies }).map(t => t.id))
      .toEqual(['player:hero']);
    expect(getValidCombatTargets({ action: { targeting: 'ally' }, players, enemies }).map(t => t.id))
      .toEqual(['player:hero', 'player:ally']);
  });

  test('drag-and-drop rejects an invalid direct target without executing', () => {
    const enemies = [unit('normal'), unit('guard', { effects: [{ id: 'guard' }] })];
    const execute = jest.fn();
    const targets = getValidCombatTargets({ action: { targeting: 'enemy' }, players: [hero], enemies });
    expect(executeValidCombatDrop({ validTargets: targets, targetId: 'enemy:normal', execute })).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(executeValidCombatDrop({ validTargets: targets, targetId: 'enemy:guard', execute })).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
