import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { reviveUnit } from '../components/CombatScreen';
import {
  EFFECT_LIBRARY,
  cleanseEffects,
  consumeEffectStacks,
  getEffectStackCount,
  removeRandomNegativeEffect,
  removeRandomPositiveEffect,
  setEffectStackCount,
} from './effects';

const apothecary = () => ({ name: 'Аптекарь-отступник', hp: 70, maxHp: 100, effects: [], abilities: [] });
const session = alertLevel => ({ alertLevel, state: { metrics: {} } });

describe('neutral combat resources', () => {
  test('Supplies metadata is neutral, permanent and unremovable', () => {
    expect(EFFECT_LIBRARY.supplies).toMatchObject({ type: 'resource', stacking: 'stack', persistent: true, unremovable: true });
  });

  test('generic stack helpers clamp at zero and remove the visual effect', () => {
    const unit = apothecary();
    expect(setEffectStackCount(unit, 'supplies', 2)).toBe(2);
    expect(consumeEffectStacks(unit, 'supplies', 1)).toBe(1);
    expect(getEffectStackCount(unit, 'supplies')).toBe(1);
    expect(consumeEffectStacks(unit, 'supplies', 5)).toBe(1);
    expect(getEffectStackCount(unit, 'supplies')).toBe(0);
    expect(unit.effects).toHaveLength(0);
  });

  test.each([[0, 2], [1, 2], [2, 3], [3, 3]])('Field Kit starts Alert %s with %s Supplies', (alert, count) => {
    const owner = apothecary();
    ABILITY_LIBRARY['Полевой набор'].onBattleStart({ owner, session: session(alert) });
    expect(getEffectStackCount(owner, 'supplies')).toBe(count);
  });

  test('cleanse, dispel and buff removal cannot select Supplies', () => {
    const unit = apothecary();
    setEffectStackCount(unit, 'supplies', 2);
    expect(cleanseEffects(unit)).toBe(0);
    expect(removeRandomNegativeEffect(unit, () => 0)).toBeNull();
    expect(removeRandomPositiveEffect(unit, () => 0)).toBeNull();
    expect(getEffectStackCount(unit, 'supplies')).toBe(2);
  });

  test('both Apothecary abilities consume exactly one and keep legacy metric', () => {
    const actor = apothecary();
    const combat = session(0);
    setEffectStackCount(actor, 'supplies', 2);
    const injured = { hp: 50, maxHp: 100, turnMeter: 0, effects: [] };
    ABILITY_LIBRARY['Экстренный стимулятор'].apply({ attacker: actor, target: injured, session: combat });
    expect(injured).toMatchObject({ hp: 65, turnMeter: 200 });
    expect(getEffectStackCount(actor, 'supplies')).toBe(1);
    const poisoned = { hp: 100, maxHp: 100, effects: [{ id: 'poison', type: 'debuff' }] };
    ABILITY_LIBRARY['Очищающий состав'].apply({ attacker: actor, target: poisoned, session: combat });
    expect(getEffectStackCount(actor, 'supplies')).toBe(0);
    expect(poisoned.effects).toHaveLength(0);
    expect(combat.state.metrics.apothecaryChargesSpent).toBe(2);
    expect(ABILITY_LIBRARY['Экстренный стимулятор'].canUse({ attacker: actor, candidateTargets: [injured] })).toBe(false);
  });

  test('legacy medical charges revive once without duplicating existing Supplies', () => {
    const migrated = reviveUnit({ ...apothecary(), medicalCharges: 2, abilities: [{ name: 'Полевой набор' }] });
    expect(getEffectStackCount(migrated, 'supplies')).toBe(2);
    const existing = reviveUnit({ ...apothecary(), medicalCharges: 3, effects: [{ id: 'supplies', stacks: 1 }], abilities: [{ name: 'Полевой набор' }] });
    expect(getEffectStackCount(existing, 'supplies')).toBe(1);
  });
});
