import { createAbilityByName, WITHERING_FOREST_TUNING } from '../data/abilityPresets';
import { createEnemyInstanceByName, getEnemyBlueprintByName } from '../data/enemies';
import { getValidCombatTargets } from './combatTargeting';
import { initCombatSession, performPlayerAction, processEnemyAI, selectEnemyAction } from './combatUtils';
import { beginInvisibleAttack, shadowExecuteMultiplier, SHADOW_BACKSTAB_RATIO } from './witheringForestShadow';

const hero = hp => ({
  name: 'Герой', hp, maxHp: 200, attack: 20, physDef: 0, magicDef: 0,
  speed: 100, abilities: ['Атака'], currentLocation: 'Лес Увядания',
});
const make = (hp = 200, enemies = [createEnemyInstanceByName('Тень чащи')]) =>
  initCombatSession(hero(hp), enemies, { rng: () => 0.99 });
const actShadow = session => {
  const shadow = session.state.enemies[0];
  const heroUnit = session.state.players[0];
  shadow.turnMeter = 1000;
  heroUnit.turnMeter = 999; // Shadow acts first; hero is next, preventing a second enemy turn.
  processEnemyAI(session);
  return heroUnit;
};

describe('Withering Forest Thicket Shadow blueprint and invisibility', () => {
  test('normal-tier authored stats, portrait, unique ability and passive', () => {
    expect(getEnemyBlueprintByName('Тень чащи')).toEqual(expect.objectContaining({
      location: 'Лес Увядания', hp: 256, maxHp: 256, attack: 20, magAtk: 1,
      physDef: 5, magicDef: 7, speed: 140, portraitKey: 'thicket_shadow',
      startsInvisible: true, abilityNames: ['Смертельный выпад', 'Удар в спину'],
    }));
    expect(createEnemyInstanceByName('Тень чащи')).toEqual(expect.objectContaining({
      hp: 256, maxHp: 256, difficultyTier: 'normal', startsInvisible: true,
    }));
    expect(createAbilityByName('Смертельный выпад')).toMatchObject({ cooldown: 3, targeting: 'enemy' });
    expect(createAbilityByName('Удар в спину').passive).toBe(true);
    expect(WITHERING_FOREST_TUNING.shadowLungeMultiplier).toBe(1.55);
    expect(SHADOW_BACKSTAB_RATIO).toBe(0.35);
  });

  test('real combat begins with visible invisibility status; direct target hides, AoE still hits without revealing', () => {
    const shadow = createEnemyInstanceByName('Тень чащи');
    const dummy = { name: 'Манекен', hp: 300, maxHp: 300, attack: 1, speed: 1 };
    const session = make(200, [shadow, dummy]);
    const [hidden, visible] = session.state.enemies;
    expect(hidden.invisible).toBe(true);
    expect(hidden.effects.some(effect => effect.id === 'invisibility')).toBe(true);
    expect(getValidCombatTargets({
      action: { targeting: 'enemy' }, players: session.state.players, enemies: session.state.enemies,
    }).map(entry => entry.unit)).toEqual([visible]);
    expect(getValidCombatTargets({
      action: { targeting: 'allEnemies' }, players: session.state.players, enemies: session.state.enemies,
    }).map(entry => entry.unit)).toEqual([hidden, visible]);
    session.state.players[0].abilities.push({
      name: 'Проверочная волна', targeting: 'allEnemies', type: 'pure', damage: 35,
      cooldown: 0, alwaysHits: true,
    });
    session.state.initiative.playerReady = true;
    expect(performPlayerAction(session, 'Проверочная волна').turnConsumed).toBe(true);
    expect(hidden.hp).toBeLessThan(256);
    expect(visible.hp).toBeLessThan(300);
    expect(hidden.invisible).toBe(true);
  });

  test('all-hidden fallback remains targetable', () => {
    const session = make();
    const candidates = getValidCombatTargets({
      action: { targeting: 'enemy' }, players: session.state.players, enemies: session.state.enemies,
    });
    expect(candidates.map(candidate => candidate.unit)).toEqual([session.state.enemies[0]]);
  });
});

describe('Shadow combat action integration', () => {
  test('first real Lunge reveals the Shadow and boosts direct damage once', () => {
    const hiddenSession = make();
    const visibleSession = make();
    const visible = visibleSession.state.enemies[0];
    visible.invisible = false;
    visible.effects = visible.effects.filter(effect => effect.id !== 'invisibility');
    expect(selectEnemyAction(hiddenSession.state.enemies[0], hiddenSession)?.ability.name).toBe('Смертельный выпад');
    const hiddenHero = actShadow(hiddenSession);
    const visibleHero = actShadow(visibleSession);
    expect(hiddenSession.state.enemies[0].invisible).toBe(false);
    expect(hiddenSession.state.enemies[0].effects.some(effect => effect.id === 'invisibility')).toBe(false);
    expect(hiddenSession.state.enemies[0].abilities.find(a => a.name === 'Смертельный выпад').currentCooldown).toBe(3);
    expect(200 - hiddenHero.hp).toBeGreaterThan(200 - visibleHero.hp);
    expect(200 - hiddenHero.hp).toBe(Math.round((200 - visibleHero.hp) * 1.35));
  });

  test('miss reveals the Shadow without dealing damage or preserving a future Backstab', () => {
    const session = make();
    const shadow = session.state.enemies[0];
    shadow.abilities.find(a => a.name === 'Смертельный выпад').accuracy = 0;
    expect(actShadow(session).hp).toBe(200);
    expect(shadow.invisible).toBe(false);
    expect(shadow.effects.some(effect => effect.id === 'invisibility')).toBe(false);
    const nextAction = {};
    expect(beginInvisibleAttack(shadow, shadow.abilities.find(a => a.name === 'Атака'), nextAction)).toBe(false);
    expect(nextAction.shadowBackstabMultiplier).toBeUndefined();
  });

  test('executes at 40% HP or lower; target scoring prioritizes the most wounded', () => {
    expect(shadowExecuteMultiplier({ hp: 80, maxHp: 200 })).toBe(1.35);
    expect(shadowExecuteMultiplier({ hp: 81, maxHp: 200 })).toBe(1);
    const low = make(80);
    const high = make(81);
    const lostLow = 80 - actShadow(low).hp;
    const lostHigh = 81 - actShadow(high).hp;
    expect(lostLow).toBeGreaterThan(lostHigh);
    const session = make();
    session.state.players.push({ name: 'Раненый союзник', hp: 30, maxHp: 100, speed: 20, effects: [] });
    const choice = selectEnemyAction(session.state.enemies[0], session);
    expect(choice.ability.name).toBe('Смертельный выпад');
    expect(choice.primary.name).toBe('Раненый союзник');
  });

  test('serialized stealth state gives at most one bonus; generic stealth never gives the Shadow passive bonus', () => {
    const restored = JSON.parse(JSON.stringify({
      name: 'Тень чащи', hp: 256, invisible: true,
      effects: [{ id: 'invisibility', remainingTurns: 999 }],
      abilities: [{ name: 'Удар в спину', passive: true }],
    }));
    const first = {};
    expect(beginInvisibleAttack(restored, { name: 'Атака', basic: true }, first)).toBe(true);
    expect(first.shadowBackstabMultiplier).toBe(1.35);
    const second = {};
    expect(beginInvisibleAttack(restored, { name: 'Атака', basic: true }, second)).toBe(false);
    expect(second.shadowBackstabMultiplier).toBeUndefined();
    const other = { name: 'Другой невидимка', invisible: true, effects: [{ id: 'invisibility' }] };
    const otherAction = {};
    expect(beginInvisibleAttack(other, { name: 'Атака' }, otherAction)).toBe(true);
    expect(otherAction.shadowBackstabMultiplier).toBeUndefined();
  });
});
