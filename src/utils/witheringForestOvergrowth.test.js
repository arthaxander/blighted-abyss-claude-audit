import { addEffect, EFFECT_IDS, getEffectDefinition } from './effects';
import { captureOvergrowth, consumeOvergrowthAfterAction } from './witheringForestOvergrowth';
import { WITHERING_FOREST_TUNING, createAbilityByName } from '../data/abilityPresets';
import { getEnemyBlueprintByName, createEnemyInstanceByName } from '../data/enemies';
import { initCombatSession, performPlayerAction, selectEnemyAction } from './combatUtils';

const unit = () => ({ name: 'Герой', hp: 150, maxHp: 150, attack: 20, magAtk: 10, speed: 100, effects: [] });
const makeSession = () => initCombatSession({
  ...unit(), currentLocation: 'Гоблинские Норы',
  abilities: [
    { name: 'Атака', basic: true, damage: 10, cooldown: 0, type: 'physical', alwaysHits: true },
    { name: 'Проверочный удар', damage: 10, cooldown: 2, type: 'physical', alwaysHits: true },
  ],
}, [{ name: 'Манекен', hp: 500, maxHp: 500, attack: 1, speed: 1 }], { rng: () => 0.99 });

describe('Forest Overgrowth: status and cooldown consumption', () => {
  test('registers a finite refresh-only debuff without duplicate instances', () => {
    expect(EFFECT_IDS['Зарастание']).toBe('overgrowth');
    expect(getEffectDefinition('overgrowth')).toEqual(expect.objectContaining({
      type: 'debuff', stacking: 'refresh', defaultDuration: 4,
    }));
    const target = unit();
    addEffect(target, { id: 'overgrowth', duration: 2 }, () => {});
    addEffect(target, { id: 'overgrowth', duration: 4 }, () => {});
    expect(target.effects.filter(effect => effect.id === 'overgrowth')).toHaveLength(1);
    expect(target.effects.find(effect => effect.id === 'overgrowth').remainingTurns).toBe(4);
  });

  test('consumes once after the final assigned cooldown, including zero-cooldown actives', () => {
    const target = unit();
    addEffect(target, { id: 'overgrowth' }, () => {});
    const captured = captureOvergrowth(target);
    const ability = { name: 'Способность', cooldown: 3, currentCooldown: 5 };
    expect(consumeOvergrowthAfterAction(target, ability, captured)).toBe(true);
    expect(ability.currentCooldown).toBe(6);
    expect(captureOvergrowth(target)).toBeNull();
    expect(consumeOvergrowthAfterAction(target, ability, captured)).toBe(false);
    addEffect(target, { id: 'overgrowth' }, () => {});
    const zeroCooldown = { name: 'Активная', cooldown: 0, currentCooldown: 0 };
    expect(consumeOvergrowthAfterAction(target, zeroCooldown, captureOvergrowth(target))).toBe(true);
    expect(zeroCooldown.currentCooldown).toBe(1);
  });

  test('never consumes on basics, passives, failed/uncaptured actions or lost status', () => {
    const target = unit();
    addEffect(target, { id: 'overgrowth' }, () => {});
    const captured = captureOvergrowth(target);
    for (const ability of [
      { name: 'Атака', basic: true, currentCooldown: 0 },
      { name: 'Пассив', passive: true, currentCooldown: 0 },
      { name: 'Отменённое', currentCooldown: undefined },
    ]) {
      expect(consumeOvergrowthAfterAction(target, ability, captured)).toBe(false);
      expect(captureOvergrowth(target)).toBe(captured);
    }
    expect(consumeOvergrowthAfterAction(target, { name: 'Позднее', currentCooldown: 2 }, null)).toBe(false);
    target.effects = [];
    expect(consumeOvergrowthAfterAction(target, { name: 'Очищено', currentCooldown: 2 }, captured)).toBe(false);
  });

  test('actual player action consumes; basic action and silence rejection do not', () => {
    const session = makeSession();
    const player = session.state.players[0];
    addEffect(player, { id: 'overgrowth', duration: 4 }, () => {});
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Атака', 0).turnConsumed).toBe(true);
    expect(captureOvergrowth(player)).not.toBeNull();
    session.state.initiative.playerReady = true;
    player.silenced = true;
    expect(performPlayerAction(session, 'Проверочный удар', 0).turnConsumed).toBe(false);
    expect(captureOvergrowth(player)).not.toBeNull();
    player.silenced = false;
    expect(performPlayerAction(session, 'Проверочный удар', 0).turnConsumed).toBe(true);
    expect(player.abilities.find(ability => ability.name === 'Проверочный удар').currentCooldown).toBe(3);
    expect(captureOvergrowth(player)).toBeNull();
  });

  test('survives JSON state serialization and remains linked to the current instance', () => {
    const original = unit();
    addEffect(original, { id: 'overgrowth' }, () => {});
    const restored = JSON.parse(JSON.stringify({ effects: original.effects.map(({ sourceRef, sourceSnapshot, ...effect }) => effect) }));
    expect(captureOvergrowth(restored)?.id).toBe('overgrowth');
    const ability = { name: 'Навык', cooldown: 2, currentCooldown: 2 };
    expect(consumeOvergrowthAfterAction(restored, ability, captureOvergrowth(restored))).toBe(true);
    expect(ability.currentCooldown).toBe(3);
  });
});

describe('Forest Petal Witch recovery', () => {
  test('authored stats are not scaled a second time and the portrait is retained', () => {
    const blueprint = getEnemyBlueprintByName('Ведьма Лепестков');
    expect(blueprint).toEqual(expect.objectContaining({
      location: 'Лес Увядания', maxHp: 264, attack: 10, magAtk: 22,
      physDef: 5, magicDef: 10, speed: 126, portraitKey: 'petal_witch',
    }));
    const enemy = createEnemyInstanceByName('Ведьма Лепестков');
    expect(enemy).toEqual(expect.objectContaining({
      maxHp: 264, hp: 264, attack: 10, magAtk: 22, speed: 126,
      portraitKey: 'petal_witch', difficultyTier: 'normal',
    }));
  });

  test('abilities use the agreed cooldowns, Nature scaling and both statuses', () => {
    expect(WITHERING_FOREST_TUNING.poisonVinesDamageMultiplier).toBe(0.75);
    const vines = createAbilityByName('Ядовитые лозы');
    const bud = createAbilityByName('Зарастающий бутон');
    expect(vines.cooldown).toBe(2);
    expect(vines.damage({ attacker: { magAtk: 20 } })).toBe(15);
    expect(vines.effect).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'entanglement' }),
      expect.objectContaining({ id: 'poison', duration: 3 }),
    ]));
    expect(bud.cooldown).toBe(3);
    expect(bud.effect).toEqual(expect.objectContaining({ id: 'overgrowth', duration: 4 }));
  });

  test('Witch AI prioritizes applying missing debuffs, avoids redundant refresh', () => {
    const witch = createEnemyInstanceByName('Ведьма Лепестков');
    const session = initCombatSession({ ...unit(), currentLocation: 'Лес Увядания', abilities: ['Атака'] }, [witch], { rng: () => 0.99 });
    const enemy = session.state.enemies[0];
    const hero = session.state.players[0];
    expect(selectEnemyAction(enemy, session)?.ability.name).toBe('Зарастающий бутон');
    addEffect(hero, { id: 'overgrowth', duration: 4 }, () => {}, enemy, { session });
    expect(selectEnemyAction(enemy, session)?.ability.name).toBe('Ядовитые лозы');
    addEffect(hero, { id: 'entanglement' }, () => {}, enemy, { session });
    addEffect(hero, { id: 'poison' }, () => {}, enemy, { session });
    expect(selectEnemyAction(enemy, session)?.ability.name).toBe('Атака');
  });
});
