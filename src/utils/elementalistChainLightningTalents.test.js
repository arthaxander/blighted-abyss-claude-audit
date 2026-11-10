import { createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { initCombatSession, performPlayerAction } from './combatUtils';

const progression = talentId => ({ Mage: { talentSelections: { 'mage.chain_lightning': talentId } } });

const mage = talentId => ({
  id: 'hero',
  name: 'Элементалист',
  class: 'Mage',
  displayClass: 'Элементалист',
  hp: 200,
  maxHp: 200,
  attack: 8,
  magAtk: 100,
  physDef: 0,
  magicDef: 0,
  speed: 125,
  critChance: 0,
  effects: [],
  abilities: [createAbilityByName('Цепная молния')],
  equippedClassPassiveIds: [],
  classProgression: progression(talentId),
});

const enemy = (id, extra = {}) => ({
  id,
  name: id,
  hp: 1000,
  maxHp: 1000,
  attack: 1,
  magAtk: 0,
  physDef: 0,
  magicDef: 0,
  speed: 1,
  critChance: 0,
  effects: [],
  abilities: [],
  ...extra,
});

const cast = (talentId, enemies, rng = () => 0.99) => {
  const session = initCombatSession(mage(talentId), enemies, { rng });
  session.state.initiative.playerReady = true;
  session.state.players[0].turnMeter = 1000;
  performPlayerAction(session, 'Цепная молния', 0);
  return session;
};

describe('Elementalist Chain Lightning talents', () => {
  test('Inevitable Chain guarantees Shock on secondary targets', () => {
    const session = cast(
      'mage.chain_lightning.inevitable_chain',
      [enemy('primary'), enemy('secondary-a'), enemy('secondary-b')],
      () => 0.99
    );

    expect(session.state.enemies.every(target =>
      target.effects.some(effect => effect.id === 'shock')
    )).toBe(true);
  });

  test('base Chain Lightning still keeps 55% Shock chance on secondary targets', () => {
    const session = cast(
      null,
      [enemy('primary'), enemy('secondary-a'), enemy('secondary-b')],
      () => 0.99
    );

    expect(session.state.enemies[0].effects.some(effect => effect.id === 'shock')).toBe(true);
    expect(session.state.enemies[1].effects.some(effect => effect.id === 'shock')).toBe(false);
    expect(session.state.enemies[2].effects.some(effect => effect.id === 'shock')).toBe(false);
  });

  test.each([
    [1, [801]],
    [2, [853, 891]],
    [3, [905, 905, 905]],
  ])('Closed Chain converts missing secondary targets with %i living enemy/enemies', (count, expectedHp) => {
    const session = cast(
      'mage.chain_lightning.closed_chain',
      Array.from({ length: count }, (_, index) => enemy(String(index + 1))),
      () => 0.99
    );

    expect(session.state.enemies.map(target => target.hp)).toEqual(expectedHp);
  });

  test('Closed Chain does not add hits when the primary attack misses', () => {
    const session = cast(
      'mage.chain_lightning.closed_chain',
      [enemy('primary', { statAdditives: { dodgeBonus: 1 } }), enemy('secondary')],
      () => 0.99
    );

    expect(session.state.enemies[0].hp).toBe(1000);
    expect(session.state.enemies[1].hp).toBe(905);
  });

  test('only the two Chain Lightning talents added here are additionally combat-ready', () => {
    expect(TALENT_BY_ID['mage.chain_lightning.inevitable_chain']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['mage.chain_lightning.closed_chain']?.combatReady).toBe(true);
  });
});
