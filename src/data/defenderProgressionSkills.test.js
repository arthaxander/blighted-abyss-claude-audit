import { ABILITY_LIBRARY } from './abilityPresets';
import { addEffect, EFFECT_LIBRARY, processEffects } from '../utils/effects';
import { initCombatSession, performPlayerAction, selectEnemyAction } from '../utils/combatUtils';

describe('Defender progression active skills', () => {
  test.each([
    [20, 1, 12],
    [20, 100, 47],
    [20, 10_000, 47], // the shield contribution is capped at 2 × Attack
    [37, 49, 48],
  ])('Ударная волна uses the approved formula for Attack %i and Shield %i', (attack, shield, expected) => {
    const ability = ABILITY_LIBRARY['Ударная волна'];
    expect(ability.damage({ attacker: { attack, shield } })).toBe(expected);
  });

  test('Ударная волна snapshots Shield for every target and synchronizes the half-spend', () => {
    const ability = { ...ABILITY_LIBRARY['Ударная волна'] };
    const session = initCombatSession({ name: 'Защитник', hp: 100, maxHp: 100, attack: 20, critChance: 0, speed: 100,
      abilities: [ability], equipment: {} }, [
      { name: 'A', hp: 100, maxHp: 100, physDef: 0, speed: 1, effects: [], abilities: [] },
      { name: 'B', hp: 100, maxHp: 100, physDef: 0, speed: 1, effects: [], abilities: [] },
    ], { rng: () => 0.5 });
    const attacker = session.state.players[0];
    expect(ability.canUse({ attacker: { shield: 0 } })).toBe(false);
    expect(ability.targeting).toBe('allEnemies');
    expect(ability.effect({ attacker })).toMatchObject({ id: 'speed_penalty_minor' });
    addEffect(attacker, { id: 'shield', value: 101, duration: 3 }, jest.fn(), attacker, { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Ударная волна', 0);
    expect(session.state.enemies.map(enemy => enemy.hp)).toEqual([53, 53]);
    expect(attacker.shield).toBe(50);
    expect(attacker.effects.filter(effect => effect.id === 'shield')).toHaveLength(1);
    expect(attacker.effects.find(effect => effect.id === 'shield')).toMatchObject({ value: 50, appliedShield: 50 });
    processEffects(attacker, jest.fn(), {});
    expect(attacker.shield).toBe(50);
  });

  test('Таран exposes prepared state, attacks once next turn, and clears', () => {
    const ability = ABILITY_LIBRARY['Таран'];
    const attacker = { name: 'Защитник', attack: 20, hp: 100, maxHp: 100, shield: 0, turnMeter: 700, effects: [] };
    const enemies = [{ name: 'A', hp: 100, physDef: 0, effects: [] }, { name: 'B', hp: 100, physDef: 0, effects: [] }];
    ability.apply({ attacker, session: { state: { players: [attacker], enemies } }, log: jest.fn() });
    expect(attacker.shield).toBe(16);
    expect(attacker.effects.some(effect => effect.id === 'speed_boost_minor')).toBe(true);
    expect(attacker.turnMeter).toBe(1000);
    expect(attacker.effects.find(effect => effect.id === 'preparation')).toEqual(expect.objectContaining({
      extra: expect.objectContaining({
        kind: 'defender_ram',
        sourceAbilityName: 'Таран',
        preparedDescription: expect.stringContaining('Таран'),
      }),
    }));
    const damage = jest.fn((target, amount) => { target.hp -= amount; return amount; });
    processEffects(attacker, jest.fn(), { applyDamage: damage, getOpponents: () => enemies });
    expect(damage).toHaveBeenCalledTimes(2);
    expect(damage.mock.calls.map(call => call[1])).toEqual([19, 19]);
    expect(attacker.effects.some(effect => effect.id === 'preparation')).toBe(false);
    processEffects(attacker, jest.fn(), { applyDamage: damage, getOpponents: () => enemies });
    expect(damage).toHaveBeenCalledTimes(2);
  });

  test('Бросок щита uses one Shield snapshot for damage and Bleed, then fully synchronizes its spend', () => {
    const ability = ABILITY_LIBRARY['Бросок щита'];
    const shield = { itemId: 'Щит Новобранца', instanceId: 'shield-1' };
    const attacker = { attack: 20, shield: 126, equipment: { offHand: shield }, effects: [{ id: 'shield', value: 126, appliedShield: 126 }] };
    expect(ability.canUse({ attacker })).toBe(true);
    expect(ability.canUse({ attacker: { ...attacker, equipment: {} } })).toBe(false);
    expect(ability.canUse({ attacker: { ...attacker, shield: 0 } })).toBe(false);
    expect(ability.damage({ attacker })).toBe(129);
    expect(ability.effect({ attacker }).duration).toBe(6);
    ability.apply({ attacker, log: jest.fn() });
    expect(attacker.shield).toBe(0);
    expect(attacker.effects.filter(effect => effect.id === 'shield')).toHaveLength(0);
    expect(attacker.equipment.offHand).toBe(shield);
  });

  test('Провокация forces basic AI and guard conversion is capped and non-recursive', () => {
    const ability = ABILITY_LIBRARY['Кровавый вызов'];
    const defender = { id: 'p', hp: 100, effects: [] };
    const enemy = { id: 'e', hp: 50, effects: [], abilities: [
      { name: 'Сильный удар', damage: 50, currentCooldown: 0 },
      { name: 'Атака', basic: true, damage: 5, currentCooldown: 0 },
    ] };
    const session = { state: { players: [defender], enemies: [enemy] } };
    ability.apply({ attacker: defender, targets: [enemy], session, log: jest.fn() });
    expect(enemy.effects.find(effect => effect.id === 'provoked')?.remainingTurns).toBe(1);
    expect(selectEnemyAction(enemy, session).ability.name).toBe('Атака');
    const guard = defender.effects.find(effect => effect.id === 'provocation_guard');
    expect(guard).toBeTruthy();
    enemy.effects.push({ id: 'bleed', remainingTurns: 20 });
    const before = defender.shield || 0;
    EFFECT_LIBRARY.provocation_guard.onDamageTaken({ target: defender, damage: 10, effect: guard, context: { source: enemy, directAttack: true, actualHpLost: 10, log: jest.fn() } });
    expect(defender.shield - before).toBeLessThanOrEqual(7);
  });
});
