import { ABILITY_LIBRARY, FUNGAL_ROSTER_TUNING } from '../data/abilityPresets';
import { allEnemies, createEnemyInstanceByName, enemies, getEnemyBlueprintByName } from '../data/enemies';
import { ENEMY_PORTRAITS, resolveEnemyPortrait } from '../data/combatAssets';
import { addEffect } from './effects';
import { applyDamage, handleShieldBreak, triggerOnDeath } from './combatUtils';
import {
  createEncounterPair,
  EARLY_FUNGAL_FAMILY_MULTIPLIER,
  EARLY_FUNGAL_DUPLICATE_CHANCE,
  FUNGAL_LOCATION,
  MUSHROOM_DUPLICATE_CHANCE,
  MUSHROOM_ENCOUNTER_FAMILIES,
  resolveEncounterFamilyWeights,
  resolveEncounterDuplicateChance,
} from './enemyPools';

const fungal = name => allEnemies.find(enemy => enemy.name === name);

describe('Mushroom Caves roster update', () => {
  test('production HP promotion changes only the infected and spore blueprints', () => {
    expect(Object.fromEntries([
      'Троглодит-копейщик', 'Троглодит-заклинатель змей', 'Пещерная змея', 'Троглодит-шаман',
      'Троглодит-заражённый', 'Троглодит-споровик', 'Одичавший троглодит', 'Костестраж', 'Змеиный двоеглав',
      'Осквернённый троглодит-змееголов', 'Искажённый троглодит-тотемщик', 'Троглодит-мицелий (босс)',
    ].map(name => [name, getEnemyBlueprintByName(name).maxHp]))).toEqual({
      'Троглодит-копейщик': 110, 'Троглодит-заклинатель змей': 72, 'Пещерная змея': 32, 'Троглодит-шаман': 84,
      'Троглодит-заражённый': 75, 'Троглодит-споровик': 68, 'Одичавший троглодит': 106, 'Костестраж': 142, 'Змеиный двоеглав': 136,
      'Осквернённый троглодит-змееголов': 151, 'Искажённый троглодит-тотемщик': 145, 'Троглодит-мицелий (босс)': 400,
    });
  });
  test('early fungal family receives only the approved weight multiplier until Feral unlocks', () => {
    const early = ['Троглодит-копейщик', 'Троглодит-заклинатель змей', 'Троглодит-шаман', 'Троглодит-заражённый', 'Троглодит-споровик'].map(fungal);
    const late = [...early, fungal('Одичавший троглодит')];
    expect(resolveEncounterFamilyWeights(early, { location: FUNGAL_LOCATION })).toEqual({
      [MUSHROOM_ENCOUNTER_FAMILIES.NORMAL]: 3,
      [MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL]: 2 * EARLY_FUNGAL_FAMILY_MULTIPLIER,
    });
    expect(resolveEncounterFamilyWeights(late, { location: FUNGAL_LOCATION })[MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL]).toBe(3);
    expect(EARLY_FUNGAL_FAMILY_MULTIPLIER).toBe(0.7);
    expect(MUSHROOM_DUPLICATE_CHANCE).toBe(0.2);
  });

  test('only the pre-Feral fungal family receives the 40% duplicate exception', () => {
    const infected = fungal('Троглодит-заражённый');
    const sporebearer = fungal('Троглодит-споровик');
    const feral = fungal('Одичавший троглодит');
    const earlyFungal = [infected, sporebearer];
    expect(resolveEncounterDuplicateChance({
      location: FUNGAL_LOCATION,
      family: MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL,
      eligiblePool: earlyFungal,
    })).toBe(EARLY_FUNGAL_DUPLICATE_CHANCE);
    expect(EARLY_FUNGAL_DUPLICATE_CHANCE).toBe(0.4);
    expect(resolveEncounterDuplicateChance({
      location: FUNGAL_LOCATION,
      family: MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL,
      eligiblePool: [...earlyFungal, feral],
    })).toBe(MUSHROOM_DUPLICATE_CHANCE);
    expect(resolveEncounterDuplicateChance({
      location: FUNGAL_LOCATION,
      family: MUSHROOM_ENCOUNTER_FAMILIES.NORMAL,
      eligiblePool: [fungal('Троглодит-копейщик')],
    })).toBe(MUSHROOM_DUPLICATE_CHANCE);
  });

  test('two-headed serpent remains normal_troglodytes and has no dedicated solo path', () => {
    const serpent = fungal('Змеиный двоеглав');
    const partner = fungal('Костестраж');
    expect(serpent).toMatchObject({ encounterFamily: 'normal_troglodytes', maxHp: 136, attack: 25 });
    expect(createEncounterPair([serpent, partner], () => 0, { location: FUNGAL_LOCATION, allowDuplicates: false })).toEqual([serpent, partner]);
    expect(createEncounterPair([partner, serpent], () => 0.99, { location: FUNGAL_LOCATION, allowDuplicates: false })).toEqual([serpent, partner]);
  });
  test('active roster uses every canonical fungal portrait, including shared Cave Snake summon identity', () => {
    const expected = {
      'Троглодит-копейщик': 'troglodyte_spearman.webp',
      'Троглодит-заклинатель змей': 'troglodyte_snake_caster.webp',
      'Троглодит-шаман': 'troglodyte_shaman.webp',
      'Костестраж': 'Troglodyte_Serpent_Bonewarden.webp',
      'Одичавший троглодит': 'Troglodyte_Feral.webp',
      'Троглодит-заражённый': 'troglodyte_infected.webp',
      'Троглодит-споровик': 'troglodyte_sporebearer.webp',
      'Змеиный двоеглав': 'two_headed_serpent.webp',
      'Пещерная змея': 'cave_snake.webp',
      'Осквернённый троглодит-змееголов': 'corrupted_troglodyte_snakehead.webp',
      'Искажённый троглодит-тотемщик': 'distorted_troglodyte_totemist.webp',
      'Троглодит-мицелий (босс)': 'troglodyte_mycelium.webp',
    };
    Object.entries(expected).forEach(([name, filename]) => {
      expect(resolveEnemyPortrait(fungal(name))).toBe(`/assets/combat/portraits/enemies/fungal/${filename}`);
    });
    const summon = createEnemyInstanceByName('Пещерная змея');
    expect(resolveEnemyPortrait(summon)).toBe(ENEMY_PORTRAITS.cave_snake);
    expect(Object.keys(ENEMY_PORTRAITS)).not.toContain('cave_snake_summon');
  });

  test('obsolete enemies are retired while Feral and Boneguard are selectable', () => {
    const names = enemies.filter(enemy => enemy.location === FUNGAL_LOCATION).map(enemy => enemy.name);
    expect(names).not.toContain('Троглодит-жукопас');
    expect(names).not.toContain('Мясистый жук');
    expect(names).toEqual(expect.arrayContaining(['Одичавший троглодит', 'Костестраж']));
  });

  test('ordinary encounter pairing preserves family separation and valid family combinations', () => {
    const normal = [fungal('Троглодит-копейщик'), fungal('Троглодит-шаман'), fungal('Костестраж')];
    const mushrooms = [fungal('Одичавший троглодит'), fungal('Троглодит-заражённый'), fungal('Троглодит-споровик')];
    const mixed = [...normal, ...mushrooms];
    for (let first = 0; first < mixed.length; first += 1) {
      const pack = createEncounterPair(mixed, () => first / mixed.length);
      expect(new Set(pack.map(enemy => enemy.encounterFamily)).size).toBe(1);
    }
    expect(createEncounterPair(normal, () => 0).map(enemy => enemy.encounterFamily)).toEqual([
      MUSHROOM_ENCOUNTER_FAMILIES.NORMAL, MUSHROOM_ENCOUNTER_FAMILIES.NORMAL,
    ]);
    expect(createEncounterPair(mushrooms, () => 0).map(enemy => enemy.encounterFamily)).toEqual([
      MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL, MUSHROOM_ENCOUNTER_FAMILIES.FUNGAL,
    ]);
  });

  test('canonical strong ordinary pool is exactly Boneguard, Feral, and Two-headed Serpent', () => {
    const strong = enemies.filter(enemy => (
      enemy.location === FUNGAL_LOCATION && enemy.encounterPhase === 'late' && !enemy.miniBoss && !enemy.boss
    ));
    expect(strong.map(enemy => enemy.name).sort()).toEqual([
      'Змеиный двоеглав', 'Костестраж', 'Одичавший троглодит',
    ].sort());
    const mixedStrong = createEncounterPair(strong, () => 0.4);
    expect(new Set(mixedStrong.map(enemy => enemy.encounterFamily)).size).toBe(1);
  });

  test('Mycelium authors 400 HP and boss scaling produces 700 HP, a 350 transition, and 56 nourishment', () => {
    const blueprint = getEnemyBlueprintByName('Троглодит-мицелий (босс)');
    const boss = createEnemyInstanceByName('Троглодит-мицелий (босс)');
    expect(blueprint.maxHp).toBe(400);
    expect(boss.maxHp).toBe(700);
    expect(boss.maxHp * 0.5).toBe(350);
    boss.hp = 600;
    const hero = { hp: 100, maxHp: 100, effects: [] };
    const summon = { hp: 50, maxHp: 50, effects: [] };
    addEffect(hero, { id: 'poison' }, () => {}, boss);
    addEffect(hero, { id: 'poison' }, () => {}, boss);
    addEffect(summon, { id: 'poison' }, () => {}, boss);
    ABILITY_LIBRARY['Мицелиевое питание'].onTurnStart({ owner: boss, session: { state: { players: [hero, summon] } } });
    expect(boss.hp).toBe(656);
    boss.hp = 351;
    ABILITY_LIBRARY['Сжатие мицелия'].onTurnStart({ owner: boss, session: { state: { players: [hero] } }, log: () => {} });
    expect(boss._myceliumPhaseTwoTriggered).toBeUndefined();
    boss.hp = 350;
    ABILITY_LIBRARY['Сжатие мицелия'].onTurnStart({ owner: boss, session: { state: { players: [hero] } }, log: () => {} });
    expect(boss._myceliumPhaseTwoTriggered).toBe(true);
  });

  test('Feral lunge damages through combat and advances only self; howl advances only living allies', () => {
    const feral = createEnemyInstanceByName('Одичавший троглодит');
    const ally = { hp: 20, turnMeter: 100 };
    const dead = { hp: 0, turnMeter: 100 };
    const player = { hp: 100, maxHp: 100, physDef: 0, effects: [], turnMeter: 300 };
    const before = player.hp;
    applyDamage(player, ABILITY_LIBRARY['Рваный наскок'].damage({ attacker: feral }), 'physical', { source: feral });
    ABILITY_LIBRARY['Рваный наскок'].apply({ attacker: feral });
    expect(player.hp).toBeLessThan(before);
    expect(feral.turnMeter).toBe(FUNGAL_ROSTER_TUNING.feralLungeTurnMeter);
    expect(player.turnMeter).toBe(300);
    ABILITY_LIBRARY['Стайный визг'].apply({ attacker: feral, session: { state: { enemies: [feral, ally, dead] } } });
    expect(feral.turnMeter).toBe(FUNGAL_ROSTER_TUNING.feralLungeTurnMeter);
    expect(ally.turnMeter).toBe(300);
    expect(dead.turnMeter).toBe(100);
  });

  test('Bone Cover shields every living ally and Last Guardian shields/reduces cooldown only on ally death', () => {
    const boneguard = createEnemyInstanceByName('Костестраж');
    const ally = { name: 'Союзник', hp: 40, maxHp: 40, effects: [], shield: 0, abilities: [] };
    const dead = { name: 'Мёртвый', hp: 0, maxHp: 40, effects: [], shield: 0 };
    const session = { state: { enemies: [boneguard, ally, dead], players: [] } };
    ABILITY_LIBRARY['Костяной покров'].apply({ attacker: boneguard, session, log: () => {} });
    expect(boneguard.shield).toBeGreaterThan(0);
    expect(ally.shield).toBeGreaterThan(0);
    expect(dead.shield).toBe(0);
    const cover = boneguard.abilities.find(ability => ability.name === 'Костяной покров');
    cover.currentCooldown = 3;
    ally.hp = 0;
    triggerOnDeath(ally, null, session);
    expect(boneguard.shield).toBeGreaterThan(Math.round(boneguard.maxHp * FUNGAL_ROSTER_TUNING.boneguardCoverShieldMaxHp));
    expect(cover.currentCooldown).toBe(2);
    const shield = boneguard.shield;
    boneguard.hp = 0;
    triggerOnDeath(boneguard, null, session);
    expect(boneguard.shield).toBe(shield);
  });

  test('Boneguard retaliates once per player action for allied breaks, never for its own break, without TM changes', () => {
    const boneguard = createEnemyInstanceByName('Костестраж');
    const allyA = { name: 'A', hp: 20, maxHp: 20, effects: [], shield: 0, abilities: [] };
    const allyB = { name: 'B', hp: 20, maxHp: 20, effects: [], shield: 0, abilities: [] };
    const player = { name: 'Герой', hp: 100, maxHp: 100, physDef: 0, effects: [] };
    const session = { state: { enemies: [boneguard, allyA, allyB], players: [player] } };
    [boneguard, allyA, allyB].forEach(unit => addEffect(unit, { id: 'shield', duration: 2, value: 5 }, () => {}, boneguard, { session }));
    const action = {};
    const turnMeterBefore = boneguard.turnMeter;
    const options = { attacker: player, session, deliberateAction: action, directAttack: true };
    handleShieldBreak(boneguard, options);
    expect(player.hp).toBe(100);
    handleShieldBreak(allyA, options);
    const afterOne = player.hp;
    expect(afterOne).toBeLessThan(100);
    handleShieldBreak(allyB, options);
    expect(player.hp).toBe(afterOne);
    expect(boneguard.turnMeter).toBe(turnMeterBefore);
  });
});
