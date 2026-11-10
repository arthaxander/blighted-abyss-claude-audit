import { createAbilityByName } from '../data/abilityPresets';
import { addEffect, processEffects, finishEffectTurn } from './effects';
import { initCombatSession, performPlayerAction } from './combatUtils';

const selections = (abilityId, talentId) => ({ Defender: { talentSelections: { [abilityId]: talentId } } });
const hero = (abilities, abilityId, talentId) => ({
  id: 'hero', name: 'Защитник', class: 'Defender', hp: 200, maxHp: 200, attack: 100,
  physDef: 10, magicDef: 10, speed: 100, effects: [], equipment: { offHand: 'Щит Новобранца' },
  abilities: abilities.map(createAbilityByName), equippedClassPassiveIds: [],
  classProgression: talentId ? selections(abilityId, talentId) : undefined,
});
const enemy = (id = 'enemy') => ({ id, name: id, hp: 1000, maxHp: 1000, attack: 10, magAtk: 100, physDef: 0, magicDef: 0, speed: 1, effects: [], abilities: [] });
const ready = session => { session.state.initiative.playerReady = true; };
const use = (session, name) => { ready(session); return performPlayerAction(session, name, 0); };
const effect = (unit, id) => unit.effects.find(entry => entry.id === id);

describe('Defender Fortitude and Intimidation talents', () => {
  test('Unbroken Will cleans one session-RNG debuff and preserves base Fortitude', () => {
    const session = initCombatSession(hero(['Стойкость'], 'defender.fortitude', 'defender.fortitude.unbroken_will'), [enemy()], { rng: () => 0.99 });
    const player = session.state.players[0];
    addEffect(player, { id: 'poison', duration: 3 }, jest.fn(), player, { session });
    addEffect(player, { id: 'attack_penalty_minor', duration: 3 }, jest.fn(), player, { session });
    use(session, 'Стойкость');
    expect(player.effects.some(entry => entry.id === 'attack_penalty_minor')).toBe(false);
    expect(effect(player, 'poison')).toBeTruthy();
    expect(player.shield).toBe(60);
    expect(effect(player, 'phys_def_boost_major')).toBeTruthy();
  });

  test('Unbroken Will grants one Protection Seal only when there is nothing to cleanse', () => {
    const session = initCombatSession(hero(['Стойкость'], 'defender.fortitude', 'defender.fortitude.unbroken_will'), [enemy()]);
    const player = session.state.players[0];
    use(session, 'Стойкость');
    expect(player.effects.filter(entry => entry.id === 'protection_seals')).toHaveLength(1);
    player.abilities[0].currentCooldown = 0;
    use(session, 'Стойкость');
    expect(player.effects.filter(entry => entry.id === 'protection_seals')).toHaveLength(1);
  });

  test('Combat Readiness survives a basic attack and halves one Shockwave spend without reducing damage', () => {
    const data = hero(['Стойкость', 'Ударная волна', 'Атака'], 'defender.fortitude', 'defender.fortitude.combat_readiness');
    const session = initCombatSession(data, [enemy()], { rng: () => 0.99 });
    const player = session.state.players[0];
    use(session, 'Стойкость');
    expect(effect(player, 'defender_combat_readiness')).toBeTruthy();
    use(session, 'Атака');
    expect(effect(player, 'defender_combat_readiness')).toBeTruthy();
    const hpBefore = session.state.enemies[0].hp;
    use(session, 'Ударная волна');
    expect(player.shield).toBe(45); // 60 - rounded 25% of the original snapshot
    expect(hpBefore - session.state.enemies[0].hp).toBe(96); // (35 + 5*sqrt(60)) * 1.3; full shield snapshot
    expect(effect(player, 'defender_combat_readiness')).toBeFalsy();
  });

  test('Combat Readiness halves Shield Throw spend while damage and Bleed use the full snapshot', () => {
    const session = initCombatSession(hero(['Стойкость', 'Бросок щита'], 'defender.fortitude', 'defender.fortitude.combat_readiness'), [enemy()], { rng: () => 0.99 });
    const player = session.state.players[0];
    use(session, 'Стойкость');
    const hpBefore = session.state.enemies[0].hp;
    use(session, 'Бросок щита');
    expect(player.shield).toBe(30);
    expect(hpBefore - session.state.enemies[0].hp).toBe(244);
    expect(effect(session.state.enemies[0], 'bleed')?.remainingTurns).toBe(3);
  });

  test('Combat Readiness expires after two own actions and survives JSON combat restoration', () => {
    const session = initCombatSession(hero(['Стойкость', 'Атака'], 'defender.fortitude', 'defender.fortitude.combat_readiness'), [enemy()]);
    use(session, 'Стойкость');
    const saved = { ...session.state.players[0], effects: session.state.players[0].effects.map(entry => ({
      ...entry, sourceRef: null, sourceSnapshot: { ...entry.sourceSnapshot, entity: null },
    })) };
    const restored = JSON.parse(JSON.stringify(saved));
    expect(effect(restored, 'defender_combat_readiness')?.remainingTurns).toBe(3);
    processEffects(restored, jest.fn());
    expect(effect(restored, 'defender_combat_readiness')?.remainingTurns).toBe(3);
    finishEffectTurn(restored, jest.fn());
    expect(effect(restored, 'defender_combat_readiness')?.remainingTurns).toBe(2);
    processEffects(restored, jest.fn());
    finishEffectTurn(restored, jest.fn());
    expect(effect(restored, 'defender_combat_readiness')?.remainingTurns).toBe(1);
    processEffects(restored, jest.fn());
    finishEffectTurn(restored, jest.fn());
    expect(effect(restored, 'defender_combat_readiness')).toBeFalsy();
  });

  test('Steadfastness extends existing temporary buffs without reapplying Shield and adds control immunity', () => {
    const session = initCombatSession(hero(['Устрашение'], 'defender.intimidation', 'defender.intimidation.steadfastness'), [enemy()]);
    const player = session.state.players[0];
    addEffect(player, { id: 'shield', duration: 3, value: 40 }, jest.fn(), player, { session });
    addEffect(player, { id: 'attack_boost_minor', duration: 2 }, jest.fn(), player, { session });
    addEffect(player, { id: 'protection_seals' }, jest.fn(), player, { session });
    use(session, 'Устрашение');
    expect(player.shield).toBe(40);
    expect(effect(player, 'shield')?.remainingTurns).toBe(4); // no start-of-turn aging; extended by one
    expect(effect(player, 'attack_boost_minor')?.remainingTurns).toBe(3);
    expect(effect(player, 'protection_seals')?.persistent).toBe(true);
    expect(effect(player, 'control_immunity')?.remainingTurns).toBe(1);
    expect(player._temporaryControlImmunity).toBe(1);
  });

  test('Steadfastness extends removable Rebirth like other temporary buffs', () => {
    const session = initCombatSession(hero(['Устрашение'], 'defender.intimidation', 'defender.intimidation.steadfastness'), [enemy()]);
    const player = session.state.players[0];
    addEffect(player, { id: 'rebirth', duration: 3 }, jest.fn(), player, { session });
    use(session, 'Устрашение');
    expect(effect(player, 'rebirth')?.remainingTurns).toBe(4); // removable buff: extended by the talent
  });

  test('Suppression expires enemy temporary buffs including Shield and applies magic penalty for two turns', () => {
    const session = initCombatSession(hero(['Устрашение'], 'defender.intimidation', 'defender.intimidation.suppression'), [enemy()]);
    const foe = session.state.enemies[0];
    addEffect(foe, { id: 'shield', duration: 1, value: 50 }, jest.fn(), foe, { session });
    addEffect(foe, { id: 'attack_boost_minor', duration: 2 }, jest.fn(), foe, { session });
    addEffect(foe, { id: 'overheat' }, jest.fn(), foe, { session });
    use(session, 'Устрашение');
    expect(foe.shield).toBe(0);
    expect(effect(foe, 'shield')).toBeFalsy();
    expect(effect(foe, 'attack_boost_minor')?.remainingTurns).toBe(1);
    expect(effect(foe, 'overheat')).toBeTruthy();
    expect(effect(foe, 'magic_attack_penalty_minor')?.remainingTurns).toBe(2);
    expect(foe.magAtk).toBe(75);
    expect(effect(foe, 'attack_penalty_minor')?.remainingTurns).toBe(2);
  });

  test('Suppression removes one-turn Rebirth now that it is removable', () => {
    const session = initCombatSession(hero(['Устрашение'], 'defender.intimidation', 'defender.intimidation.suppression'), [enemy()]);
    const foe = session.state.enemies[0];
    addEffect(foe, { id: 'rebirth', duration: 1 }, jest.fn(), foe, { session });
    use(session, 'Устрашение');
    expect(effect(foe, 'rebirth')).toBeFalsy();
  });

  test('without a selection both abilities retain only their base behavior', () => {
    const session = initCombatSession(hero(['Стойкость', 'Устрашение']), [enemy()]);
    const player = session.state.players[0];
    use(session, 'Стойкость');
    expect(player.shield).toBe(60);
    expect(effect(player, 'defender_combat_readiness')).toBeFalsy();
    player.abilities[1].currentCooldown = 0;
    use(session, 'Устрашение');
    expect(effect(player, 'control_immunity')).toBeFalsy();
    expect(effect(session.state.enemies[0], 'attack_penalty_minor')).toBeTruthy();
  });
});
