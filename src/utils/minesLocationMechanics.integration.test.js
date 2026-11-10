import { initCombatSession, applyDamage } from './combatUtils';
import { addEffect, cleanseEffects, getEffectStackCount } from './effects';
import { getEnemyBlueprintByName } from '../data/enemies';
import {
  MINES_LOCATION_NAME, MINES_SUBLOCATION_EFFECTS, triggerMinesLastShift,
  minesGalleryDamageMultiplier,
} from './minesLocationMechanics';
import {
  MINES_SUBLOCATION_IDS, MINES_SUBLOCATIONS,
  getSublocationCatalogForLocation, getSublocationDefinition,
} from '../data/expeditionSublocations';
import { LOCATION_EFFECTS } from '../data/locationEffects';

const actor = overrides => ({
  name: 'Герой', hp: 900, maxHp: 900, attack: 75, magAtk: 30,
  speed: 100, physDef: 0, magicDef: 0, abilities: ['Атака'],
  ...overrides,
});
const setup = (enemyNames = ['Обугленный громила'], effectId = null) =>
  initCombatSession(actor({ activeSublocationEffectId: effectId }),
    enemyNames.map(name => getEnemyBlueprintByName(name)), { rng: () => .01 });
const add = (target, id, duration, source, session) =>
  addEffect(target, { id, ...(duration !== null ? { duration } : {}) },
    () => {}, source, { session });

describe('Mines oppression: each NEW status type (never repeat/refresh/stacks)', () => {
  test('the location registers correctly and does not unlock mines', () => {
    expect(LOCATION_EFFECTS[MINES_LOCATION_NAME]).toMatchObject({ id: 'mines-oppression', name: 'Шахтный гнёт' });
    expect(MINES_SUBLOCATIONS).toHaveLength(4);
    expect(getSublocationCatalogForLocation(MINES_LOCATION_NAME)).toBe(MINES_SUBLOCATIONS);
    expect(new Set(MINES_SUBLOCATIONS.map(x => x.id)).size).toBe(4);
    expect(getSublocationDefinition(MINES_LOCATION_NAME, MINES_SUBLOCATION_IDS.CURSED))
      .toMatchObject({ effectId: MINES_SUBLOCATION_EFFECTS.CURSED });
  });

  test('enemy gets +100 for each new distinct buff; refresh, stack and resource have no reward', () => {
    const session = setup();
    const enemy = session.state.enemies[0];
    enemy.turnMeter = 0;
    add(enemy, 'speed_boost_minor', 2, enemy, session);
    expect(enemy.turnMeter).toBe(100);
    add(enemy, 'speed_boost_minor', 2, enemy, session);
    expect(enemy.turnMeter).toBe(100);
    add(enemy, 'phys_def_boost_minor', 2, enemy, session);
    expect(enemy.turnMeter).toBe(200);
    addEffect(enemy, { id: 'shield', duration: 2, value: 50 }, () => {}, enemy, { session });
    expect(enemy.turnMeter).toBe(300);
    addEffect(enemy, { id: 'shield', duration: 2, value: 60 }, () => {}, enemy, { session });
    expect(enemy.turnMeter).toBe(300);
    add(enemy, 'supplies', null, enemy, session);
    expect(enemy.turnMeter).toBe(300);
    cleanseEffects(enemy, eff => eff.id === 'speed_boost_minor', () => {});
    add(enemy, 'speed_boost_minor', 2, enemy, session);
    expect(enemy.turnMeter).toBe(400);
  });

  test('enemy-only debuffs reduce player meter 100 per new TYPE, never for stacked Charges', () => {
    const session = setup();
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    hero.turnMeter = 700;
    add(hero, 'gloom', 2, enemy, session);
    add(hero, 'healing_curse', 2, enemy, session);
    expect(hero.turnMeter).toBe(500);
    add(hero, 'gloom', 2, enemy, session);
    expect(hero.turnMeter).toBe(500);
    add(hero, 'charge', null, enemy, session);
    expect(hero.turnMeter).toBe(400);
    add(hero, 'charge', null, enemy, session);
    expect(hero.turnMeter).toBe(400);
    cleanseEffects(hero, eff => eff.id === 'gloom', () => {});
    add(hero, 'gloom', 2, enemy, session);
    expect(hero.turnMeter).toBe(300);
  });

  test('self-inflicted, player-inflicted and blocked debuffs never grant enemy tempo', () => {
    const session = setup();
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    hero.turnMeter = 800;
    add(hero, 'bleed', 2, hero, session);
    expect(hero.turnMeter).toBe(800);
    add(enemy, 'bleed', 2, hero, session);
    expect(hero.turnMeter).toBe(800);
    hero.blockDebuffs = true;
    expect(add(hero, 'gloom', 2, enemy, session)).toBeNull();
    expect(hero.turnMeter).toBe(800);
  });

  test('new debuff on a summon has its own meter loss', () => {
    const session = setup();
    const enemy = session.state.enemies[0];
    const ally = actor({ id: 'summon-test', name: 'Призыв', hp: 150, maxHp: 150, summoned: true, turnMeter: 500, effects: [] });
    session.state.players.push(ally);
    // The hero starts with the recruit_seal's initial turn meter, so assert that
    // the summon's debuff leaves it untouched instead of assuming zero.
    const heroMeterBefore = session.state.players[0].turnMeter;
    add(ally, 'bleed', 2, enemy, session);
    expect(ally.turnMeter).toBe(400);
    expect(session.state.players[0].turnMeter).toBe(heroMeterBefore);
  });
});

describe('the four Mines sublocations', () => {
  test('Overseer: threshold at 50% boosts only an ordinary living enemy, once', () => {
    const session = setup(['Обугленный громила', 'Старший надзиратель'], MINES_SUBLOCATION_EFFECTS.OVERSEER);
    const [brute, overseer] = session.state.enemies;
    const hero = session.state.players[0];
    brute.turnMeter = 0;
    applyDamage(brute, 240, 'pure', { source: hero, session });
    expect(brute.hp).toBeLessThanOrEqual(175);
    expect(brute.hp).toBeGreaterThan(0);
    expect(brute.turnMeter).toBe(200);
    applyDamage(brute, 20, 'pure', { source: hero, session });
    expect(brute.turnMeter).toBe(200);
    overseer.turnMeter = 0;
    applyDamage(overseer, 280, 'pure', { source: hero, session });
    expect(overseer.turnMeter).toBe(0);
    brute.hp = 300;
    applyDamage(brute, 180, 'pure', { source: hero, session });
    expect(brute.turnMeter).toBe(200);
  });

  test('Fortified galleries: only unsheilded allies gain 20% resistance to direct AoE', () => {
    const session = setup(['Мастер крепей', 'Рудный носильщик'], MINES_SUBLOCATION_EFFECTS.SUPPORT);
    const [master, porter] = session.state.enemies;
    const hero = session.state.players[0];
    addEffect(master, { id: 'shield', duration: 2, value: 100 }, () => {}, master, { session });
    expect(minesGalleryDamageMultiplier(session, porter, hero, { directAttack: true, areaAttack: true })).toBe(.8);
    expect(minesGalleryDamageMultiplier(session, porter, hero, { directAttack: true, areaAttack: false })).toBe(1);
    expect(minesGalleryDamageMultiplier(session, master, hero, { directAttack: true, areaAttack: true })).toBe(1);
    porter.hp = porter.maxHp;
    applyDamage(porter, 100, 'pure', { source: hero, session, directAttack: true, areaAttack: true });
    expect(porter.hp).toBe(porter.maxHp - 80);
    porter.hp = porter.maxHp;
    applyDamage(porter, 100, 'pure', { source: hero, session, directAttack: true, areaAttack: false });
    expect(porter.hp).toBe(porter.maxHp - 100);
    cleanseEffects(master, e => e.id === 'shield', () => {});
    expect(minesGalleryDamageMultiplier(session, porter, hero, { directAttack: true, areaAttack: true })).toBe(1);
  });

  test('Blind workings: exactly two distinct ordinary miners get two-turn buffs', () => {
    const session = setup(['Забывший маркшейдер','Рудный носильщик','Закованный охранник'], MINES_SUBLOCATION_EFFECTS.SURVEYOR);
    const [surveyor, porter, guard] = session.state.enemies;
    expect(surveyor.effects.filter(e => e.type === 'buff')).toHaveLength(0);
    expect(porter.effects.filter(e => e.type === 'buff')).toHaveLength(1);
    expect(guard.effects.filter(e => e.type === 'buff')).toHaveLength(1);
    expect(porter.turnMeter).toBe(100);
    expect(guard.turnMeter).toBe(100);
    expect(porter.effects.find(e => e.type === 'buff').remainingTurns).toBe(2);
  });

  test('Cursed rift: first actual cursed status lasts +1, refresh and second type do not multiply', () => {
    const session = setup(['Осквернённый лекарь'], MINES_SUBLOCATION_EFFECTS.CURSED);
    const hero = session.state.players[0];
    const healer = session.state.enemies[0];
    add(hero, 'gloom', 2, healer, session);
    expect(hero.effects.find(e => e.id === 'gloom').remainingTurns).toBe(3);
    add(hero, 'gloom', 2, healer, session);
    expect(hero.effects.find(e => e.id === 'gloom').remainingTurns).toBe(2);
    cleanseEffects(hero, e => e.id === 'gloom', () => {});
    add(hero, 'gloom', 2, healer, session);
    expect(hero.effects.find(e => e.id === 'gloom').remainingTurns).toBe(2);
    add(hero, 'bleed', 1, healer, session);
    expect(hero.effects.find(e => e.id === 'bleed').remainingTurns).toBe(2);
    add(hero, 'bleed', 1, healer, session);
    expect(hero.effects.find(e => e.id === 'bleed').remainingTurns).toBe(3);
  });

  test('Cursed rift: immune attempts do not consume once-per-type extension', () => {
    const session = setup(['Осквернённый лекарь'], MINES_SUBLOCATION_EFFECTS.CURSED);
    const hero = session.state.players[0];
    const healer = session.state.enemies[0];
    hero.blockDebuffs = true;
    expect(add(hero, 'gloom', 2, healer, session)).toBeNull();
    hero.blockDebuffs = false;
    add(hero, 'gloom', 2, healer, session);
    expect(hero.effects.find(e => e.id === 'gloom').remainingTurns).toBe(3);
  });

  test('Cursed rift: stack-only Charge is not extended', () => {
    const session = setup(['Искажённый взрывник'], MINES_SUBLOCATION_EFFECTS.CURSED);
    const hero = session.state.players[0];
    const bomber = session.state.enemies[0];
    add(hero, 'charge', null, bomber, session);
    expect(getEffectStackCount(hero, 'charge')).toBe(1);
    expect((hero._minesCurseExtendedStatusIds || []).includes('charge')).toBe(false);
  });

  test('Cursed rift does not extend debuffs cast by regular enemies', () => {
    const session = setup(['Обугленный громила'], MINES_SUBLOCATION_EFFECTS.CURSED);
    const hero = session.state.players[0];
    const brute = session.state.enemies[0];
    add(hero, 'searing_mark', 2, brute, session);
    expect(hero.effects.find(e => e.id === 'searing_mark').remainingTurns).toBe(2);
  });
});
