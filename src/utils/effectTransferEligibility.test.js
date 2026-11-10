import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { addEffect, isEffectTransferable } from './effects';

const unit = (overrides = {}) => ({
  id: 'hero', name: 'Герой', hp: 500, maxHp: 500,
  attack: 100, magAtk: 10, physDef: 10, magicDef: 10,
  speed: 100, shield: 0, effects: [], ...overrides,
});

describe('shared status theft and transfer eligibility', () => {
  test('only removable buffs and debuffs can be moved', () => {
    expect(isEffectTransferable({ id: 'attack_boost_minor' })).toBe(true);
    expect(isEffectTransferable({ id: 'bleed' })).toBe(true);
    expect(isEffectTransferable({ id: 'supplies' })).toBe(false);
    expect(isEffectTransferable({ id: 'thirst' })).toBe(false);
    expect(isEffectTransferable({ id: 'rebirth' })).toBe(false); // removable: false
    expect(isEffectTransferable({ id: 'bleed', unremovable: true })).toBe(false);
    expect(isEffectTransferable({ id: 'bleed', removable: false })).toBe(false);
    expect(isEffectTransferable({ id: 'bleed', extra: { removable: false } })).toBe(false);
    expect(isEffectTransferable({ id: 'nonexistent_effect' })).toBe(false);
    expect(isEffectTransferable(null)).toBe(false);
  });

  test('Господство спор ignores protected buffs and properly removes a transferable one', () => {
    const hero = unit();
    const owner = unit({ id: 'mycelium', name: 'Мицелий', effects: [] });
    const session = { state: { players: [hero], enemies: [owner] }, rng: () => 0 };
    const log = jest.fn();

    addEffect(hero, { id: 'thirst' }, log, hero);
    addEffect(hero, { id: 'attack_boost_minor', duration: 3 }, log, hero);
    expect(hero.attack).toBe(125);

    ABILITY_LIBRARY['Господство спор'].onTurnStart({ owner, session, log });
    expect(hero.effects.some(effect => effect.id === 'thirst')).toBe(true);
    expect(hero.effects.some(effect => effect.id === 'attack_boost_minor')).toBe(false);
    expect(hero.effects.some(effect => effect.id === 'blind')).toBe(true);
    expect(hero.attack).toBe(100); // stat multipliers must be reverted
  });

  test('Господство спор does not convert protected buffs into debuffs', () => {
    const hero = unit();
    const owner = unit({ id: 'mycelium', name: 'Мицелий', effects: [] });
    const session = { state: { players: [hero], enemies: [owner] }, rng: () => 0 };
    addEffect(hero, { id: 'rebirth', duration: 3 }, jest.fn(), hero);
    addEffect(hero, { id: 'thirst' }, jest.fn(), hero);

    ABILITY_LIBRARY['Господство спор'].onTurnStart({ owner, session, log: jest.fn() });
    expect(hero.effects.map(effect => effect.id)).toEqual(['rebirth', 'thirst']);
  });
});
