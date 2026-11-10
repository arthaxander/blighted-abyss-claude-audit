import {
  EFFECT_LIBRARY,
  addEffect,
  notifyDamageTaken,
  processEffects,
} from './effects';
import { ABILITY_LIBRARY } from '../data/abilityPresets';

const unit = (name, hp = 50, extra = {}) => ({
  name,
  hp,
  maxHp: 100,
  effects: [],
  ...extra,
});

const healingContext = source => ({
  source,
  applyHealing: (target, amount) => {
    if (!target || target.hp <= 0) return 0;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + Math.round(amount));
    return target.hp - before;
  },
  log: jest.fn(),
});

describe('Vampire Mark healing ownership', () => {
  test('the current damage dealer heals, not the combatant who applied the mark', () => {
    const applier = unit('Маг', 40, { vampirismBonus: 1 });
    const dealer = unit('Лучник', 40, { vampirismBonus: 0.2 });
    const marked = unit('Цель', 100);
    const effect = addEffect(marked, { id: 'vampire_mark', duration: 3 }, jest.fn(), applier);

    EFFECT_LIBRARY.vampire_mark.onDamageTaken({
      target: marked,
      damage: 70,
      effect,
      context: { ...healingContext(dealer), actualHpLost: 70 },
    });

    expect(dealer.hp).toBe(65); // round(70 × 30% × 1.2)
    expect(applier.hp).toBe(40);
  });

  test('the mark applier can benefit when they deal damage themselves', () => {
    const applier = unit('Маг', 40);
    const marked = unit('Цель', 100);
    const effect = addEffect(marked, { id: 'vampire_mark' }, jest.fn(), applier);

    EFFECT_LIBRARY.vampire_mark.onDamageTaken({
      target: marked,
      damage: 20,
      effect,
      context: { ...healingContext(applier), actualHpLost: 20 },
    });

    expect(applier.hp).toBe(46);
  });

  test('uses actual HP lost and rejects zero, self, dead, and sourceless damage', () => {
    const dealer = unit('Атакующий', 10);
    const marked = unit('Цель', 100);
    const effect = addEffect(marked, { id: 'vampire_mark' }, jest.fn(), unit('Источник'));

    EFFECT_LIBRARY.vampire_mark.onDamageTaken({
      target: marked,
      damage: 100,
      effect,
      context: { ...healingContext(dealer), actualHpLost: 7 },
    });
    expect(dealer.hp).toBe(12);

    [
      { ...healingContext(dealer), actualHpLost: 0 },
      { ...healingContext(marked), actualHpLost: 20 },
      { ...healingContext(null), actualHpLost: 20 },
      { ...healingContext(unit('Мёртвый', 0)), actualHpLost: 20 },
    ].forEach(context => EFFECT_LIBRARY.vampire_mark.onDamageTaken({ target: marked, damage: 20, effect, context }));
    expect(dealer.hp).toBe(12);
  });

  test('periodic damage preserves its authoritative combatant source', () => {
    const bleedSource = unit('Лучник', 40, { attack: 10 });
    const markApplier = unit('Маг', 40);
    const marked = unit('Цель', 100, { physDef: 0 });
    addEffect(marked, { id: 'vampire_mark', duration: 3 }, jest.fn(), markApplier);
    addEffect(marked, { id: 'bleed', duration: 1 }, jest.fn(), bleedSource);

    processEffects(marked, jest.fn(), {
      applyDamage: (target, amount, type, extra) => {
        const before = target.hp;
        target.hp = Math.max(0, target.hp - amount);
        const actualHpLost = before - target.hp;
        notifyDamageTaken(target, amount, {
          ...healingContext(extra.source),
          actualHpLost,
          damageType: type,
          fromEffect: extra.id,
        });
        return amount;
      },
      log: jest.fn(),
    });

    expect(bleedSource.hp).toBe(43); // Bleed deals 10; mark heals 3.
    expect(markApplier.hp).toBe(40);
  });

  test('refresh stacking remains one mark and Blood Touch exposes the status reference', () => {
    const applier = unit('Маг');
    const marked = unit('Цель');
    addEffect(marked, { id: 'vampire_mark', duration: 2 }, jest.fn(), applier);
    addEffect(marked, { id: 'vampire_mark', duration: 3 }, jest.fn(), unit('Другой'));

    expect(marked.effects.filter(effect => effect.id === 'vampire_mark')).toHaveLength(1);
    expect(marked.effects[0].remainingTurns).toBe(3);
    expect(ABILITY_LIBRARY['Кровавое касание'].descriptionParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ statusId: 'vampire_mark', text: 'Метку вампира' }),
    ]));
  });
});
