import { createEnemyInstanceByName } from '../data/enemies';
import { EFFECT_IDS } from './effects';
import { getEffectiveSpeed, initCombatSession } from './combatUtils';
import { insertItems, moveInventoryStack, SAFE_SLOT_COUNT } from './expeditionInventory';
import { createAbilityByName, ABILITY_LIBRARY } from '../data/abilityPresets';
import { ensureClassProgression } from '../data/classProgression';

describe('device stabilization invariants', () => {
  test('duplicate templates hydrate as independent combat instances', () => {
    const blueprint = createEnemyInstanceByName('Троглодит-копейщик');
    const session = initCombatSession({ name: 'Герой', hp: 47, maxHp: 160, abilities: [] }, [blueprint, blueprint]);
    const [a, b] = session.state.enemies;
    expect(a.templateId).toBe(b.templateId);
    expect(a.combatInstanceId).not.toBe(b.combatInstanceId);
    a.hp = 0; a.effects.push({ id: 'bleed', duration: 2 }); b.hp = 50;
    expect(b).toMatchObject({ hp: 50, effects: [] });
    expect(session.state.players[0].hp).toBe(47);
  });

  test('Mushroom Poison speed pressure is symmetric, non-stacking, and is not Slow', () => {
    const session = { state: { encounterReward: { location: 'Грибные Пещеры' } } };
    const unit = { speed: 100, effects: [] };
    expect(getEffectiveSpeed(unit, session)).toBe(100);
    unit.effects.push({ id: EFFECT_IDS['Отравление'] });
    expect(getEffectiveSpeed(unit, session)).toBe(85);
    unit.effects.push({ id: EFFECT_IDS['Отравление'] });
    expect(getEffectiveSpeed(unit, session)).toBe(85);
    expect(unit.effects.some(effect => ['speed_penalty_minor', 'speed_penalty_major'].includes(effect.id))).toBe(false);
  });

  test.each([[1, 2, 3]])('stack merge conserves %i + %i', (source, target, total) => {
    const slots = [{ itemId: 'Малое зелье здоровья', quantity: source }, { itemId: 'Малое зелье здоровья', quantity: target }];
    const merged = moveInventoryStack(slots, 0, 1);
    expect(merged[0]).toBeNull(); expect(merged[1].quantity).toBe(total);
    expect(merged.reduce((sum, stack) => sum + (stack?.quantity || 0), 0)).toBe(total);
  });

  test('partial merge at the canonical cap conserves quantity', () => {
    const merged = moveInventoryStack([{ itemId: 'Малое зелье здоровья', quantity: 2 }, { itemId: 'Малое зелье здоровья', quantity: 2 }], 0, 1);
    expect(merged.map(stack => stack?.quantity || 0)).toEqual([1, 3]);
    expect(merged.reduce((sum, stack) => sum + (stack?.quantity || 0), 0)).toBe(4);
  });

  test('loot prefers normal capacity then uses an empty Safe Slot', () => {
    const slots = Array(16).fill(null); for (let i = SAFE_SLOT_COUNT; i < slots.length; i += 1) slots[i] = { itemId: `material-${i}`, quantity: 1 };
    const result = insertItems(slots, [{ itemId: 'Малое зелье здоровья', quantity: 1 }]);
    expect(result.fits).toBe(true); expect(result.slots[0]).toMatchObject({ itemId: 'Малое зелье здоровья', quantity: 1 });
  });

  test('legacy Burning Rune saves migrate to Ice Spear without exposing the obsolete skill', () => {
    const progression = ensureClassProgression({ Mage: { cumulativeClassXp: 0, unlockedSkillIds: ['Горящая руна'], activeSkillIds: ['Горящая руна'] } });
    expect(progression.Mage.unlockedSkillIds).toContain('Ледяное копьё');
    expect(progression.Mage.activeSkillIds).toContain('Ледяное копьё');
    expect(ABILITY_LIBRARY['Горящая руна']).toBeUndefined();
    expect(createAbilityByName('Горящая руна').name).toBe('Ледяное копьё');
  });
});
