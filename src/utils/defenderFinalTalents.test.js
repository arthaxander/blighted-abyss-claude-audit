import { createAbilityByName } from '../data/abilityPresets';
import { addEffect } from './effects';
import { applyDamage, initCombatSession, performPlayerAction, processEnemyAI, registerDefenderEnemyAttackAction } from './combatUtils';
import { reviveCombatSession, snapshotCombatSession } from '../components/CombatScreen';
import { getFreshPersistentGameState, hydratePersistentGameState, serializePersistentGameState } from '../hooks/usePersistentGameState';

const progression = (abilityId, talentId) => ({ Defender: { talentSelections: { [abilityId]: talentId } } });
const hero = (ability, abilityId, talentId, extra = {}) => ({
  id: 'hero', name: 'Защитник', class: 'Defender', hp: 200, maxHp: 200, attack: 100,
  physDef: 0, magicDef: 0, speed: 100, effects: [], abilities: [createAbilityByName(ability)],
  equippedClassPassiveIds: [], classProgression: progression(abilityId, talentId), critChance: 0, ...extra,
});
const foe = (id, extra = {}) => ({ id, name: id, hp: 1000, maxHp: 1000, attack: 10,
  physDef: 0, magicDef: 0, speed: 1, effects: [], abilities: [], critChance: 0, ...extra });
const use = (player, enemies) => {
  const session = initCombatSession(player, enemies, { rng: () => 0.5 });
  session.state.initiative.playerReady = true;
  performPlayerAction(session, player.abilities[0].name, 0);
  return session;
};

describe('final Defender talents through combat state', () => {
  test('Indestructible grants one independent three-turn shield after a successful delayed Ram', () => {
    const session = use(hero('Таран', 'defender.ram', 'defender.ram.indestructible'), [foe('a'), foe('b'), foe('c')]);
    const defender = session.state.players[0];
    const preparationShield = defender.shield;
    processEnemyAI(session);
    expect(defender.shield).toBe(preparationShield + 40);
    expect(defender.effects.filter(effect => effect.id === 'shield')).toEqual(expect.arrayContaining([
      expect.objectContaining({ remainingTurns: 3, appliedShield: 40 }),
    ]));
    expect(defender.effects.filter(effect => effect.id === 'shield')).toHaveLength(2);
  });

  test('Indestructible treats enemy shield absorption as a hit and grants nothing without a living target', () => {
    const shielded = use(hero('Таран', 'defender.ram', 'defender.ram.indestructible'), [foe('a')]);
    addEffect(shielded.state.enemies[0], { id: 'shield', value: 500, duration: 3 }, jest.fn(), shielded.state.enemies[0], { session: shielded });
    processEnemyAI(shielded);
    expect(shielded.state.players[0].shield).toBe(72);

    const empty = use(hero('Таран', 'defender.ram', 'defender.ram.indestructible'), [foe('dead', { hp: 0 })]);
    const baseShield = empty.state.players[0].shield;
    processEnemyAI(empty);
    expect(empty.state.players[0].shield).toBeLessThanOrEqual(baseShield);
  });

  test.each([[0, 1], [1, 1.15], [2, 1.3], [3, 1.45], [4, 1.45]])(
    'Acceleration applies the capped additive multiplier for %i completed attacks', (actions, multiplier) => {
      const session = use(hero('Таран', 'defender.ram', 'defender.ram.acceleration'), [foe('target')]);
      const defender = session.state.players[0];
      for (let i = 0; i < actions; i += 1) registerDefenderEnemyAttackAction(defender, session.state.enemies[0]);
      session.state.enemies[0].speed = 0;
      processEnemyAI(session);
      expect(session.state.enemies[0].hp).toBe(1000 - Math.round(1.3 * 95 * multiplier));
    }
  );

  test('Acceleration counter is serializable and combines additively with Retaliatory Assault', () => {
    const session = use(hero('Таран', 'defender.ram', 'defender.ram.acceleration', {
      equippedClassPassiveIds: ['retaliatory_assault'], retaliatoryAssaultStacks: 3,
    }), [foe('target')]);
    const defender = session.state.players[0];
    registerDefenderEnemyAttackAction(defender, session.state.enemies[0]);
    registerDefenderEnemyAttackAction(defender, session.state.enemies[0]);
    registerDefenderEnemyAttackAction(defender, session.state.enemies[0]);
    const preparedExtra = defender.effects.find(effect => effect.id === 'preparation' && effect.extra?.kind === 'defender_ram').extra;
    expect(JSON.parse(JSON.stringify(preparedExtra)).attackActions).toBe(3);
    session.state.enemies[0].speed = 0;
    processEnemyAI(session);
    expect(session.state.enemies[0].hp).toBe(1000 - Math.round(1.3 * 95 * 1.95));
    expect(defender.retaliatoryAssaultStacks).toBe(0);
  });

  test('Acceleration counts one action when a summon is primary and Defender is a direct secondary target', () => {
    const secondaryAttack = {
      name: 'Рассекающий выпад', cooldown: 1, type: 'physical', damage: 10,
      targetScore: ({ target }) => target?.summoned ? 10 : 0,
      secondary: { target: 'otherEnemies', type: 'physical', damage: 10 },
    };
    const session = use(hero('Таран', 'defender.ram', 'defender.ram.acceleration'), [
      foe('attacker', { speed: 100, abilities: [secondaryAttack] }),
    ]);
    const summoned = session.summonPlayer('fire_elemental', { source: session.state.players[0] });
    expect(summoned.success).toBe(true);
    session.state.enemies[0].turnMeter = 1000;

    processEnemyAI(session);

    expect(summoned.ally.hp).toBeLessThan(summoned.ally.maxHp);
    expect(session.state.players[0].shield).toBe(22);
    expect(session.state.enemies[0].hp).toBe(1000 - Math.round(1.3 * 95 * 1.15));
  });

  test('Acceleration survives the production combat snapshot save and revive path', () => {
    const original = use(hero('Таран', 'defender.ram', 'defender.ram.acceleration'), [foe('target')]);
    const defender = original.state.players[0];
    registerDefenderEnemyAttackAction(defender, original.state.enemies[0]);
    registerDefenderEnemyAttackAction(defender, original.state.enemies[0]);
    const savedPlayer = hero('Таран', 'defender.ram', 'defender.ram.acceleration');
    const persistent = {
      ...getFreshPersistentGameState(), currentScreen: 'combat', player: savedPlayer,
      classProgression: defender.classProgression, activeCombat: snapshotCombatSession(original),
    };
    const wire = JSON.parse(JSON.stringify(serializePersistentGameState(persistent)));
    const hydrated = hydratePersistentGameState(wire);
    const restored = reviveCombatSession(hydrated.activeCombat, hydrated.player, [foe('target')]);
    restored.state.enemies[0].speed = 0;

    processEnemyAI(restored);

    expect(restored.state.enemies[0].hp).toBe(1000 - Math.round(1.3 * 95 * 1.3));
    expect(restored.state.players[0].effects.some(effect => effect.id === 'preparation' && effect.extra?.kind === 'defender_ram')).toBe(false);
  });

  test('Defensive Stance reduces provoked direct physical and magical damage before shield/HP split', () => {
    const session = use(hero('Кровавый вызов', 'defender.bloody_challenge', 'defender.bloody_challenge.defensive_stance'), [foe('a')]);
    const defender = session.state.players[0];
    const enemy = session.state.enemies[0];
    addEffect(defender, { id: 'shield', value: 50, duration: 3 }, jest.fn(), defender, { session });
    const token = {};
    applyDamage(defender, 100, 'magical', { source: enemy, session, directAttack: true, deliberateAction: token });
    expect(defender.hp).toBe(170);
    expect(defender.shield).toBe(12); // 50 absorbed, then guard restores 40% of 30 HP lost.
    enemy.effects = [];
    applyDamage(defender, 10, 'physical', { source: enemy, session, directAttack: true, deliberateAction: {} });
    expect(defender.shield).toBe(2);
  });

  test('Bloody Reckoning records unique successful attackers and resolves once at next own turn', () => {
    const session = use(hero('Кровавый вызов', 'defender.bloody_challenge', 'defender.bloody_challenge.bloody_reckoning'), [foe('a'), foe('b', { physDef: 100 })]);
    const defender = session.state.players[0];
    const [a, b] = session.state.enemies;
    applyDamage(defender, 1, 'physical', { source: a, session, directAttack: true, deliberateAction: {} });
    applyDamage(defender, 1, 'physical', { source: a, session, directAttack: true, deliberateAction: {} });
    addEffect(b, { id: 'shield', value: 20, duration: 3 }, jest.fn(), b, { session });
    applyDamage(defender, 1, 'magical', { source: b, session, directAttack: true, deliberateAction: {} });
    a.speed = 0; b.speed = 0;
    processEnemyAI(session);
    expect(a.hp).toBe(870);
    expect(b.hp).toBe(955); // New Defender damage multiplier applies after defense and shield absorption.
    const hp = [a.hp, b.hp];
    processEnemyAI(session);
    expect([a.hp, b.hp]).toEqual(hp);
  });

  test('Bloody Reckoning attacker IDs survive the production combat snapshot save and revive path', () => {
    const original = use(hero('Кровавый вызов', 'defender.bloody_challenge', 'defender.bloody_challenge.bloody_reckoning'), [foe('a'), foe('b')]);
    const defender = original.state.players[0];
    original.state.enemies.forEach(attacker => {
      applyDamage(defender, 1, 'physical', { source: attacker, session: original, directAttack: true, deliberateAction: {} });
    });
    const savedPlayer = hero('Кровавый вызов', 'defender.bloody_challenge', 'defender.bloody_challenge.bloody_reckoning');
    const persistent = {
      ...getFreshPersistentGameState(), currentScreen: 'combat', player: savedPlayer,
      classProgression: defender.classProgression, activeCombat: snapshotCombatSession(original),
    };
    const wire = JSON.parse(JSON.stringify(serializePersistentGameState(persistent)));
    const hydrated = hydratePersistentGameState(wire);
    const restored = reviveCombatSession(hydrated.activeCombat, hydrated.player, [foe('a'), foe('b')]);
    restored.state.enemies.forEach(enemy => { enemy.speed = 0; });

    processEnemyAI(restored);
    expect(restored.state.enemies.map(enemy => enemy.hp)).toEqual([870, 870]);
    expect(restored.state.players[0].effects.find(effect => effect.id === 'provocation_guard')?.extra).toMatchObject({
      reckoningResolved: true, reckoningTargetIds: [],
    });
    const afterReckoning = restored.state.enemies.map(enemy => enemy.hp);
    processEnemyAI(restored);
    expect(restored.state.enemies.map(enemy => enemy.hp)).toEqual(afterReckoning);
  });
});
