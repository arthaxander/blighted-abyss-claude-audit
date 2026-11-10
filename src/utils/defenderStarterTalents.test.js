import { ABILITY_LIBRARY, createAbilityByName } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { addEffect } from './effects';
import { applyDamage, initCombatSession, performPlayerAction } from './combatUtils';

const talentProgression = (abilityId, talentId) => ({
  Defender: { talentSelections: { [abilityId]: talentId } },
});
const defender = (abilityName, abilityId, talentId, extra = {}) => ({
  id: 'hero', name: 'Защитник', class: 'Defender', hp: 200, maxHp: 200,
  attack: 100, shield: 0, physDef: 0, magicDef: 0, speed: 100, effects: [],
  abilities: [createAbilityByName(abilityName)], equippedClassPassiveIds: [],
  classProgression: talentId ? talentProgression(abilityId, talentId) : undefined,
  ...extra,
});
const enemy = (id = 'enemy') => ({ id, name: id, hp: 1000, maxHp: 1000, attack: 10, physDef: 0, magicDef: 0, speed: 1, effects: [], abilities: [] });
const act = (hero, foe, rng = () => 0.5) => {
  const session = initCombatSession(hero, [foe]);
  if (hero.shield) addEffect(session.state.players[0], { id: 'shield', value: hero.shield, duration: 3 }, jest.fn(), hero, { session });
  (foe.effects || []).forEach(effect => addEffect(session.state.enemies[0], effect, jest.fn(), hero, { session }));
  session.rng = rng;
  session.state.initiative.playerReady = true;
  performPlayerAction(session, hero.abilities[0].name, 0);
  return session;
};

describe('Defender starter ability talents', () => {
  test('keeps stable preset/art identifiers and applies base coefficients and shield', () => {
    const wound = createAbilityByName('Кровавый таран');
    const defense = createAbilityByName('Удар щитом');
    expect(wound).toMatchObject({ presetKey: 'Кровавый таран', artId: 'blood_ram', name: 'Ранящий удар', cooldown: 2 });
    expect(defense).toMatchObject({ presetKey: 'Удар щитом', artId: 'shield_bash', name: 'Защитный удар', cooldown: 2 });
    expect(wound.damage({ attacker: { attack: 100 } })).toBe(140);
    expect(defense.damage({ attacker: { attack: 100, shield: 50 } })).toBe(115);
    expect(defense.selfEffects({ attacker: { maxHp: 200 } })).toMatchObject({ value: 20, duration: 3 });
  });

  test('Wounding Strike uses shield snapshot and Deep Wound saved selection', () => {
    const ability = ABILITY_LIBRARY['Кровавый таран'];
    expect(ability.effect({ attacker: { shield: 0 } }).duration).toBe(1);
    expect(ability.effect({ attacker: { shield: 1 } }).duration).toBe(2);
    const hero = defender('Кровавый таран', 'defender.wounding_strike', 'defender.wounding_strike.deep_wound', { shield: 10 });
    const session = act(hero, enemy());
    expect(session.state.players[0].shield).toBe(10);
    expect(session.state.enemies[0].effects.find(effect => effect.id === 'bleed')?.remainingTurns).toBe(4);
  });

  test('Open Wounds performs one general-formula tick without consuming charges, but a miss does nothing', () => {
    const hero = defender('Кровавый таран', 'defender.wounding_strike', 'defender.wounding_strike.open_wounds');
    const foe = enemy();
    const session = act(hero, foe);
    const struck = session.state.enemies[0];
    expect(struck.effects.find(effect => effect.id === 'bleed')?.remainingTurns).toBe(1);
    expect(struck.hp).toBe(688); // (140 direct + 100 bleed at one charge) * 1.3

    const missHero = defender('Кровавый таран', 'defender.wounding_strike', 'defender.wounding_strike.open_wounds', { accuracy: 0 });
    const missed = enemy('missed'); missed.effects = [{ id: 'evasion', duration: 1 }];
    const missSession = act(missHero, missed, () => 0.99);
    expect(missSession.state.enemies[0].hp).toBe(1000);
    expect(missSession.state.enemies[0].effects.some(effect => effect.id === 'bleed')).toBe(false);
  });

  test('Breach requires pre-hit Bleed and Protection Seals block the new debuff', () => {
    const makeHero = () => defender('Удар щитом', 'defender.defensive_strike', 'defender.defensive_strike.breach');
    const clean = enemy('clean');
    const cleanSession = act(makeHero(), clean);
    expect(cleanSession.state.enemies[0].effects.some(effect => effect.id === 'phys_def_penalty_minor')).toBe(false);

    const bleeding = enemy('bleeding'); bleeding.effects = [{ id: 'bleed', duration: 1, remainingTurns: 1, sourceSnapshot: { attack: 1 } }];
    const bleedSession = act(makeHero(), bleeding);
    expect(bleedSession.state.enemies[0].effects.some(effect => effect.id === 'phys_def_penalty_minor')).toBe(true);

    const sealed = enemy('sealed'); sealed.effects = [{ id: 'bleed', duration: 1, remainingTurns: 1, sourceSnapshot: { attack: 1 } }, { id: 'protection_seals', stacks: 1, charges: 1 }];
    const sealSession = act(makeHero(), sealed);
    expect(sealSession.state.enemies[0].effects.some(effect => effect.id === 'phys_def_penalty_minor')).toBe(false);
    expect(sealSession.state.enemies[0].effects.some(effect => effect.id === 'protection_seals')).toBe(false);
  });

  test('Circular Defense counts unique attackers, caps at three, and replaces the previous-turn window', () => {
    const hero = defender('Удар щитом', 'defender.defensive_strike', 'defender.defensive_strike.circular_defense');
    const session = { state: { players: [hero], enemies: [] } };
    ['a', 'a', 'b', 'c', 'd'].forEach(id => applyDamage(hero, 1, 'physical', { source: enemy(id), session, directAttack: true }));
    hero._defensiveStrikeWindowAttackers = [...hero._defensiveStrikeAttackers]; hero._defensiveStrikeAttackers = [];
    expect(hero.abilities[0].selfEffects({ attacker: hero }).value).toBe(44); // 10% + capped 12%
    applyDamage(hero, 1, 'physical', { source: enemy('e'), session, directAttack: true });
    expect(hero.abilities[0].selfEffects({ attacker: hero }).value).toBe(44);
    hero._defensiveStrikeWindowAttackers = [...hero._defensiveStrikeAttackers]; hero._defensiveStrikeAttackers = [];
    expect(hero.abilities[0].selfEffects({ attacker: hero }).value).toBe(28);
  });

  test('only the sixteen implemented stable Defender talent IDs are combat-ready', () => {
    const ready = Object.values(TALENT_BY_ID).filter(talent => talent.combatReady && talent.id.startsWith('defender.')).map(talent => talent.id).sort();
    expect(ready).toEqual([
      'defender.bloody_challenge.bloody_reckoning', 'defender.bloody_challenge.defensive_stance',
      'defender.defensive_strike.breach', 'defender.defensive_strike.circular_defense',
      'defender.fortitude.combat_readiness', 'defender.fortitude.unbroken_will',
      'defender.intimidation.steadfastness', 'defender.intimidation.suppression',
      'defender.ram.acceleration', 'defender.ram.indestructible',
      'defender.shield_throw.no_respite', 'defender.shield_throw.ricochet',
      'defender.shockwave.bloody_echo', 'defender.shockwave.heavy_wave',
      'defender.wounding_strike.deep_wound', 'defender.wounding_strike.open_wounds',
    ]);
  });
});
