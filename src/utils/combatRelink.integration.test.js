import { initCombatSession, applyDamage, processEnemyAI } from './combatUtils';
import { addEffect, processEffects } from './effects';
import { snapshotCombatSession } from './combatSnapshot';
import { reviveCombatSession } from './combatHydration';

// Effects that read their owner directly rather than through sourceSnapshot.
// A save must not change what happens next: the same input and RNG have to give
// the same result whether the battle continued or was reloaded in between.
const hero = overrides => ({
  id: 'hero-1', name: 'Герой', class: 'Archer', hp: 5000, maxHp: 5000,
  attack: 100, magAtk: 60, speed: 100, physDef: 0, magicDef: 0,
  effects: [], abilities: [], ...overrides,
});
const foe = overrides => ({
  id: 'foe-1', name: 'Враг', hp: 5000, maxHp: 5000,
  attack: 50, magAtk: 40, speed: 100, physDef: 0, magicDef: 0,
  effects: [], abilities: [], ...overrides,
});

const tickDamage = session => unit => {
  const before = unit.hp;
  processEffects(unit, () => {}, {
    applyDamage: (target, amount, type, extra = {}) =>
      applyDamage(target, amount, type, { ...extra, session, logFn: () => {} }),
    getAllies: () => session.state.players,
    getOpponents: () => session.state.enemies,
    session,
  });
  return before - unit.hp;
};

// Round-trips through the same wire format the save uses: sanitize -> JSON.
const throughSave = (session, player = hero(), enemies = [foe()]) =>
  reviveCombatSession(JSON.parse(JSON.stringify(snapshotCombatSession(session))), player, enemies);

const scenario = effectData => {
  const session = initCombatSession(hero(), [foe()], { rng: () => 0.5 });
  addEffect(session.state.enemies[0], { duration: 3, ...effectData }, () => {}, session.state.players[0], { session });
  return session;
};

describe('saved combat reproduces continuous combat', () => {
  test('bleed keeps reading the owner attack after a reload', () => {
    // Same inputs on both sides: the buff lands before the tick in each case.
    const live = scenario({ id: 'bleed' });
    live.state.players[0].attack = 300;
    const continued = tickDamage(live)(live.state.enemies[0]);

    const saved = scenario({ id: 'bleed' });
    const revived = throughSave(saved);
    revived.state.players[0].attack = 300; // buff applied only after the reload
    const resumed = tickDamage(revived)(revived.state.enemies[0]);

    expect(resumed).toBe(continued);
    expect(resumed).toBe(360); // 300 * (0.75 + 0.25 * 3 remaining turns)
  });

  test('great bonfire flame keeps the owner magic attack after a reload', () => {
    const build = () => {
      const session = scenario({ id: 'great_bonfire_flame' });
      return session;
    };
    const live = build();
    live.state.players[0].magAtk = 200;
    const continued = tickDamage(live)(live.state.enemies[0]);

    const saved = build();
    const revived = throughSave(saved);
    revived.state.players[0].magAtk = 200;

    expect(tickDamage(revived)(revived.state.enemies[0])).toBe(continued);
  });

  test('burn keeps its scaling stat after a reload', () => {
    const build = () => {
      const session = initCombatSession(hero(), [foe()], { rng: () => 0.5 });
      addEffect(session.state.enemies[0], { id: 'burn', duration: 2, sourceScaling: session.state.players[0].attack },
        () => {}, session.state.players[0], { session });
      return session;
    };
    const live = build();
    const continued = tickDamage(live)(live.state.enemies[0]);

    const revived = throughSave(build());
    expect(tickDamage(revived)(revived.state.enemies[0])).toBe(continued);
  });

  test('a dead owner behaves the same with and without a reload', () => {
    const run = reload => {
      const session = scenario({ id: 'bleed' });
      const active = reload ? throughSave(session) : session;
      active.state.players[0].hp = 0;
      return tickDamage(active)(active.state.enemies[0]);
    };
    expect(run(true)).toBe(run(false));
  });

  test('an owner missing from the roster is left unresolved instead of guessed', () => {
    const session = initCombatSession(hero(), [foe()], { rng: () => 0.5 });
    const transientOwner = { id: 'vanished-summon', name: 'Исчезнувший', attack: 999, hp: 1, maxHp: 1, effects: [] };
    addEffect(session.state.enemies[0], { id: 'bleed', duration: 3 }, () => {}, transientOwner, { session });

    const revived = throughSave(session);
    const effect = revived.state.enemies[0].effects.find(entry => entry.id === 'bleed');
    expect(effect).toBeTruthy();
    expect(effect.sourceRef).toBeFalsy();
  });

  test('a periodic effect applied by an enemy keeps its owner stats', () => {
    // Regular enemies reuse one value for both id and combatInstanceId, so the
    // lookup must not treat a single combatant as two conflicting ones.
    const build = () => initCombatSession(
      hero({ class: 'Defender' }),
      [foe({ attack: 200 })],
      { rng: () => 0.5 },
    );
    const live = build();
    const liveEnemy = live.state.enemies[0];
    expect(liveEnemy.id).toBe(liveEnemy.combatInstanceId); // guard for the fixture
    addEffect(live.state.players[0], { id: 'bleed', duration: 3 }, () => {}, liveEnemy, { session: live });
    const continued = tickDamage(live)(live.state.players[0]);

    const saved = build();
    addEffect(saved.state.players[0], { id: 'bleed', duration: 3 }, () => {}, saved.state.enemies[0], { session: saved });
    const revived = throughSave(saved, hero({ class: 'Defender' }), [foe({ attack: 200 })]);
    const effect = revived.state.players[0].effects.find(entry => entry.id === 'bleed');
    expect(effect.sourceRef).toBeTruthy();
    expect(effect.sourceRef.name).toBe('Враг');

    expect(tickDamage(revived)(revived.state.players[0])).toBe(continued);
    expect(continued).toBe(300); // 200 attack * (0.75 + 0.25 * 3 remaining turns)
  });

  test('the owner is found once per combatant even when ids repeat', () => {
    // Same id in `id` and `combatInstanceId` must not look like two candidates.
    const build = () => initCombatSession(hero(), [foe({ attack: 200 })], { rng: () => 0.5 });
    const saved = build();
    addEffect(saved.state.enemies[0], { id: 'bleed', duration: 3 }, () => {}, saved.state.players[0], { session: saved });
    const revived = throughSave(saved);
    const effect = revived.state.enemies[0].effects.find(entry => entry.id === 'bleed');
    expect(effect.sourceRef?.id).toBe('hero-1');
  });

  test('two allies sharing a display name are not cross-linked by name', () => {
    const session = initCombatSession(
      hero(),
      [foe({ id: 'e1', name: 'Крыса' }), foe({ id: 'e2', name: 'Крыса' })],
      { rng: () => 0.5 },
    );
    addEffect(session.state.enemies[0], { id: 'bleed', duration: 3 }, () => {}, session.state.players[0], { session });

    const revived = throughSave(session, hero(), [foe({ id: 'e1', name: 'Крыса' }), foe({ id: 'e2', name: 'Крыса' })]);
    const effect = revived.state.enemies[0].effects.find(entry => entry.id === 'bleed');
    // The durable id is unique, so the owner is found even though names collide.
    expect(effect.sourceRef?.id).toBe('hero-1');
  });
});

describe('agreed initiative order', () => {
  // Each combatant needs its own ability objects: a shared array would share
  // one cooldown counter across every unit in the test.
  const basicAttack = () => [{ name: 'Атака', basic: true, damage: 7, cooldown: 0 }];
  const combatant = (name, overrides = {}) => ({
    name, hp: 5000, maxHp: 5000, attack: 1, speed: 1,
    physDef: 0, magicDef: 0, effects: [], abilities: basicAttack(), ...overrides,
  });
  const fight = (enemies, allies) => {
    const session = initCombatSession(
      hero({ abilities: basicAttack(), speed: 1 }),
      enemies.map(enemy => combatant(enemy.name, enemy)),
      { rng: () => 0.5 },
    );
    session.state.players[0].turnMeter = 1000;
    (allies || []).forEach(ally => session.state.players.push(combatant(ally.name, { ...ally, turnMeter: 1000 })));
    session.state.enemies.forEach(enemy => { enemy.turnMeter = 1000; });
    session.state.players.forEach(unit => { unit.speed = 1; });
    session.state.enemies.forEach(unit => { unit.speed = 1; });
    return session;
  };

  test('the player always acts first when meters tie', () => {
    // processEnemyAI hands control back as soon as the player is the next
    // actor, so an empty log proves the player won a four-way tie.
    const session = fight([{ name: 'E1' }, { name: 'E2' }]);
    const before = session.state.log.length;
    processEnemyAI(session);
    expect(session.state.log.slice(before)).toEqual([]);
  });

  test('allies act before enemies, and enemies keep roster order', () => {
    const session = fight([{ name: 'E1' }, { name: 'E2' }], [{ name: 'AllyA' }]);
    // Take the player out of the queue so the ally and enemy rounds run.
    session.state.players[0].turnMeter = 0;
    const before = session.state.log.length;
    processEnemyAI(session);
    // Count each combatant's action once: the summon logs a cast line and a
    // damage line, so only the damage line identifies who actually acted.
    const order = session.state.log.slice(before)
      .filter(line => line.includes('наносит'))
      .map(line => (line.match(/(AllyA|E1|E2)/) || [])[1])
      .filter(Boolean);
    expect(order).toEqual(['AllyA', 'E1', 'E2']);
  });
});
