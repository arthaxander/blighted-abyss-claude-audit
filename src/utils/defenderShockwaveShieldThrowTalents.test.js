import { createAbilityByName } from '../data/abilityPresets';
import { addEffect, processEffects, finishEffectTurn } from './effects';
import { initCombatSession, performPlayerAction } from './combatUtils';

const selection = (abilityId, talentId) => ({ Defender: { talentSelections: { [abilityId]: talentId } } });
const hero = (name, talentId, extra = {}) => ({
  id: 'hero', name: 'Защитник', class: 'Defender', hp: 200, maxHp: 200, attack: 100,
  critChance: 0, physDef: 0, magicDef: 0, speed: 100, effects: [],
  equipment: { offHand: { itemId: 'Щит Новобранца', instanceId: 'shield' } },
  abilities: [createAbilityByName(name)], equippedClassPassiveIds: [],
  classProgression: talentId ? selection(name === 'Ударная волна' ? 'defender.shockwave' : 'defender.shield_throw', talentId) : undefined,
  ...extra,
});
const enemy = (id, extra = {}) => ({ id, name: id, hp: 1000, maxHp: 1000, attack: 1, physDef: 0, magicDef: 0, speed: 1, effects: [], abilities: [], ...extra });
const ready = session => { session.state.initiative.playerReady = true; };
const use = (session, name, target = 0) => { ready(session); return performPlayerAction(session, name, target); };
const shield = (player, amount, session, duration = 5) => addEffect(player, { id: 'shield', value: amount, duration }, jest.fn(), player, { session });
const bleed = (target, duration = 3, session) => addEffect(target, { id: 'bleed', duration }, jest.fn(), null, { session });

describe('Defender Shockwave talents through the combat executor', () => {
  test.each([[0, 0], [1, 10], [2, 20], [3, 30]])('Bloody Echo refunds 20%% per unique pre-bleeding hit (%i)', (bleeding, refund) => {
    const foes = [enemy('a'), enemy('b'), enemy('c')];
    const session = initCombatSession(hero('Ударная волна', 'defender.shockwave.bloody_echo'), foes, { rng: () => 0.99 });
    const player = session.state.players[0];
    shield(player, 100, session);
    session.state.enemies.slice(0, bleeding).forEach(unit => bleed(unit, 3, session));
    use(session, 'Ударная волна');
    expect(player.shield).toBe(50 + refund);
    if (refund) expect(player.effects.find(effect => effect.id === 'shield' && effect.appliedShield === refund)?.remainingTurns).toBe(2);
  });

  test('Bloody Echo caps at 60%, ignores misses, counts shield absorption, and de-duplicates hits', () => {
    const foes = [enemy('miss', { dodgeChance: 1 }), enemy('shielded', { shield: 999 }), enemy('third'), enemy('fourth')];
    const ability = createAbilityByName('Ударная волна'); ability.hitCount = 2;
    const data = hero('Ударная волна', 'defender.shockwave.bloody_echo'); data.abilities = [ability];
    const session = initCombatSession(data, foes, { rng: () => 0.5 });
    session.state.enemies.forEach(unit => bleed(unit, 3, session));
    const player = session.state.players[0]; shield(player, 100, session);
    use(session, 'Ударная волна');
    expect(player.shield).toBe(80); // spends 50 and refunds the capped 30
    expect(session.state.enemies[1].shield).toBeLessThan(999);
  });

  test('Bloody Echo uses the Combat Readiness reduced spend and its returned effect expires cleanly', () => {
    const session = initCombatSession(hero('Ударная волна', 'defender.shockwave.bloody_echo'), [enemy('a'), enemy('b')], { rng: () => 0.99 });
    const player = session.state.players[0]; shield(player, 100, session);
    addEffect(player, { id: 'defender_combat_readiness', duration: 3 }, jest.fn(), player, { session });
    session.state.enemies.forEach(unit => bleed(unit, 3, session));
    use(session, 'Ударная волна');
    expect(player.shield).toBe(85); // 100 - 25 + round(25 * 40%)
    for (let turn = 0; turn < 2; turn += 1) {
      processEffects(player, jest.fn(), {});
      finishEffectTurn(player, jest.fn(), {});
    }
    expect(player.shield).toBe(75);
    expect(player.shield).toBeGreaterThanOrEqual(0);
  });

  test('Heavy Wave replaces Slow and adds 25% only for innate immunity before physical defense', () => {
    const foes = [enemy('normal', { physDef: 100 }), enemy('innate', { physDef: 100, controlImmune: true, innateControlImmune: true }), enemy('temporary', { physDef: 100, controlImmune: true, _temporaryControlImmunity: 1 })];
    const session = initCombatSession(hero('Ударная волна', 'defender.shockwave.heavy_wave'), foes, { rng: () => 0.99 });
    shield(session.state.players[0], 100, session); use(session, 'Ударная волна');
    expect(session.state.enemies.map(unit => 1000 - unit.hp)).toEqual([55, 69, 55]);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'speed_penalty_major')).toBe(true);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'speed_penalty_minor')).toBe(false);
  });
});

describe('Defender Shield Throw talents through the combat executor', () => {
  test.each([1, 2, 3])('Ricochet handles %i enemies with one shield spend', count => {
    const session = initCombatSession(hero('Бросок щита', 'defender.shield_throw.ricochet'), Array.from({ length: count }, (_, i) => enemy(String(i))), { rng: () => 0.99 });
    const player = session.state.players[0]; shield(player, 100, session); use(session, 'Бросок щита');
    expect(player.shield).toBe(0);
    expect(session.state.enemies[0].hp).toBe(714);
    if (count === 1) expect(session.state.enemies[0].effects.filter(effect => effect.id === 'bleed')).toHaveLength(1);
    else expect(session.state.enemies[count - 1].hp).toBe(857);
  });

  test('Ricochet uses session RNG, half base rounding and half current Bleed duration', () => {
    const session = initCombatSession(hero('Бросок щита', 'defender.shield_throw.ricochet', { attack: 11 }), [enemy('primary'), enemy('first'), enemy('second')], { rng: () => 0.1 });
    const player = session.state.players[0]; shield(player, 126, session); use(session, 'Бросок щита');
    expect(session.state.enemies[1].hp).toBe(925); // rounded half-base damage, then class multiplier 1.3
    expect(session.state.enemies[2].hp).toBe(1000);
    expect(session.state.enemies[1].effects.find(effect => effect.id === 'bleed')?.remainingTurns).toBe(3);
  });

  test('Ricochet does not occur on a primary miss, but does after a lethal primary hit', () => {
    const miss = initCombatSession(hero('Бросок щита', 'defender.shield_throw.ricochet'), [enemy('primary'), enemy('other')], { rng: () => 0.99 });
    addEffect(miss.state.enemies[0], { id: 'evasion', duration: 2 }, jest.fn(), miss.state.enemies[0], { session: miss });
    shield(miss.state.players[0], 100, miss); use(miss, 'Бросок щита');
    expect(miss.state.enemies[1].hp).toBe(1000);
    const lethal = initCombatSession(hero('Бросок щита', 'defender.shield_throw.ricochet'), [enemy('primary', { hp: 1 }), enemy('other')], { rng: () => 0.99 });
    shield(lethal.state.players[0], 100, lethal); use(lethal, 'Бросок щита');
    expect(lethal.state.enemies[0].hp).toBe(0); expect(lethal.state.enemies[1].hp).toBe(857);
  });

  test('Ricochet combines with readiness and retaliatory assault without a second consumption', () => {
    const data = hero('Бросок щита', 'defender.shield_throw.ricochet'); data.equippedClassPassiveIds = ['retaliatory_assault'];
    const session = initCombatSession(data, [enemy('primary'), enemy('other')], { rng: () => 0.99 });
    const player = session.state.players[0]; shield(player, 100, session);
    addEffect(player, { id: 'defender_combat_readiness', duration: 3 }, jest.fn(), player, { session });
    player.retaliatoryAssaultStacks = 3;
    use(session, 'Бросок щита');
    expect(player.shield).toBe(50); expect(player.retaliatoryAssaultStacks).toBe(0);
  });

  test('Ricochet applies Bleed before flushing one direct-damage reaction and leaves no queued reaction', () => {
    const session = initCombatSession(hero('Бросок щита', 'defender.shield_throw.ricochet'), [enemy('primary'), enemy('counter', { attack: 10 })], { rng: () => 0.99 });
    const player = session.state.players[0]; shield(player, 100, session);
    addEffect(session.state.enemies[1], { id: 'iron_counter', duration: 2 }, jest.fn(), session.state.enemies[1], { session });
    use(session, 'Бросок щита');
    expect(player.hp).toBe(192);
    expect(session.state.enemies[1]._pendingDamageReactions || []).toHaveLength(0);
    const bleedLog = session.state.log.findIndex(entry => entry.includes('Кровотечение'));
    const counterLog = session.state.log.findIndex(entry => entry.includes('отвечает контратакой'));
    expect(bleedLog).toBeGreaterThanOrEqual(0);
    expect(counterLog).toBeGreaterThan(bleedLog);
  });

  test.each([[true, 3], [false, 4]])('No Respite recognizes only pre-existing Bleed (%s)', (preBleed, cooldown) => {
    const session = initCombatSession(hero('Бросок щита', 'defender.shield_throw.no_respite'), [enemy('primary')], { rng: () => 0.99 });
    const player = session.state.players[0]; shield(player, 100, session);
    if (preBleed) bleed(session.state.enemies[0], 3, session);
    use(session, 'Бросок щита'); expect(player.abilities[0].currentCooldown).toBe(cooldown);
  });

  test('No Respite applies on a miss, not on a rejected action, and composes with Exhaustion', () => {
    const session = initCombatSession(hero('Бросок щита', 'defender.shield_throw.no_respite'), [enemy('primary')], { rng: () => 0.99 });
    const player = session.state.players[0]; shield(player, 100, session); bleed(session.state.enemies[0], 3, session);
    addEffect(session.state.enemies[0], { id: 'evasion', duration: 2 }, jest.fn(), session.state.enemies[0], { session });
    addEffect(player, { id: 'curse_of_exhaustion', duration: 2 }, jest.fn(), player, { session });
    use(session, 'Бросок щита'); expect(player.abilities[0].currentCooldown).toBe(4); // 4 + curse - talent
    player.abilities[0].currentCooldown = 0; player.shield = 0; player.effects = player.effects.filter(effect => effect.id !== 'shield');
    const result = use(session, 'Бросок щита'); expect(result.turnConsumed).toBe(false); expect(player.abilities[0].currentCooldown).toBe(0);
  });

  test('unselected and mutually exclusive variants retain base behavior', () => {
    const session = initCombatSession(hero('Бросок щита'), [enemy('primary'), enemy('other')], { rng: () => 0.99 });
    shield(session.state.players[0], 100, session); use(session, 'Бросок щита');
    expect(session.state.enemies[1].hp).toBe(1000); expect(session.state.players[0].abilities[0].currentCooldown).toBe(4);
  });
});
