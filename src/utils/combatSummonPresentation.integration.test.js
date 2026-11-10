import { createCustomCombatSandbox, getCustomCombatEnemyCatalog } from "./customCombat";
import { initCombatSession, processEnemyAI } from "./combatUtils";
import {
  beginCombatPresentation,
  consumeCombatPresentationEvents,
} from "./combatPresentationEvents";

const player = {
  id: "production-path-player",
  name: "Герой",
  hp: 100,
  maxHp: 100,
  attack: 10,
  speed: 100,
  abilities: [{ name: "Атака", basic: true, damage: 10, currentCooldown: 0 }],
  items: [],
};

const createRatmancerSession = count => {
  const catalog = getCustomCombatEnemyCatalog();
  const ratmancer = catalog.find(entry => entry.name === "Крысомант из Нор");
  const selection = Array.from({ length: count }, (_, index) => ({
    definitionId: ratmancer.id,
    selectionId: `ratmancer-${index}`,
  }));
  const sandbox = createCustomCombatSandbox(player, selection, catalog);
  const engineSession = initCombatSession(sandbox.player, sandbox.enemies);
  engineSession.state.players[0].turnMeter = 0;
  engineSession.state.enemies.forEach(enemy => { enemy.turnMeter = 1000; });
  return { engineSession, combatScreenSession: { ...engineSession } };
};

describe("production Ratmancer summon presentation collection", () => {
  test("records one real Rat Call summon across the shallow CombatScreen session wrapper", () => {
    const { engineSession, combatScreenSession } = createRatmancerSession(1);
    const before = combatScreenSession.state.enemies.filter(enemy => enemy.hp > 0).length;
    const originalIds = new Set(combatScreenSession.state.enemies.map(enemy => enemy.id));

    expect(combatScreenSession).not.toBe(engineSession);
    expect(combatScreenSession.state).toBe(engineSession.state);
    beginCombatPresentation(combatScreenSession);

    processEnemyAI(combatScreenSession);
    const events = consumeCombatPresentationEvents(combatScreenSession);
    const summonedEnemies = combatScreenSession.state.enemies.filter(enemy => !originalIds.has(enemy.id));
    const summonEvents = events.filter(event => event.type === "summon");

    expect(combatScreenSession.state.enemies.filter(enemy => enemy.hp > 0)).toHaveLength(before + 1);
    expect(summonedEnemies).toHaveLength(1);
    expect(summonEvents).toHaveLength(1);
    expect(summonEvents[0]).toMatchObject({
      summonedUnitId: summonedEnemies[0].id,
      summonerRuntimeId: combatScreenSession.state.enemies[0].id,
      rosterIndex: 1,
    });
    expect(events.filter(event => event.type === "actionStart" || event.type === "summon").map(event => event.type))
      .toEqual(["actionStart", "summon"]);
  });

  test("records each of three real Rat Call summons in its actor's causal order", () => {
    const { combatScreenSession } = createRatmancerSession(3);
    const originalEnemies = [...combatScreenSession.state.enemies];
    const originalIds = new Set(originalEnemies.map(enemy => enemy.id));
    beginCombatPresentation(combatScreenSession);

    processEnemyAI(combatScreenSession);
    const events = consumeCombatPresentationEvents(combatScreenSession);
    const summonedEnemies = combatScreenSession.state.enemies.filter(enemy => !originalIds.has(enemy.id));
    const causalEvents = events.filter(event => event.type === "actionStart" || event.type === "summon");

    expect(combatScreenSession.state.enemies.filter(enemy => enemy.hp > 0)).toHaveLength(6);
    expect(summonedEnemies).toHaveLength(3);
    expect(causalEvents).toHaveLength(6);
    originalEnemies.forEach((enemy, index) => {
      expect(causalEvents[index * 2]).toMatchObject({ type: "actionStart", actorId: enemy.id });
      expect(causalEvents[index * 2 + 1]).toMatchObject({
        type: "summon",
        summonerRuntimeId: enemy.id,
        summonedUnitId: summonedEnemies[index].id,
      });
    });
  });

  test("does not record a summon when the real battlefield is already full", () => {
    const { combatScreenSession } = createRatmancerSession(6);
    const beforeIds = combatScreenSession.state.enemies.map(enemy => enemy.id);
    beginCombatPresentation(combatScreenSession);

    processEnemyAI(combatScreenSession);
    const events = consumeCombatPresentationEvents(combatScreenSession);

    expect(combatScreenSession.state.enemies.map(enemy => enemy.id)).toEqual(beforeIds);
    expect(events.filter(event => event.type === "summon")).toHaveLength(0);
  });

  test("records the new runtime identity and reused index for a real dead-slot summon", () => {
    const { combatScreenSession } = createRatmancerSession(2);
    const replacedId = combatScreenSession.state.enemies[1].id;
    combatScreenSession.state.enemies[1].hp = 0;
    beginCombatPresentation(combatScreenSession);

    processEnemyAI(combatScreenSession);
    const events = consumeCombatPresentationEvents(combatScreenSession);
    const summonEvents = events.filter(event => event.type === "summon");
    const replacement = combatScreenSession.state.enemies[1];

    expect(replacement.id).not.toBe(replacedId);
    expect(replacement.hp).toBeGreaterThan(0);
    expect(summonEvents).toHaveLength(1);
    expect(summonEvents[0]).toMatchObject({
      summonedUnitId: replacement.id,
      rosterIndex: 1,
      targetAfter: { id: replacement.id, presentationIndex: 1 },
    });
  });
});
