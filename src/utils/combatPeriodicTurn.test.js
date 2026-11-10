import { addEffect } from "./effects";
import {
  checkBattleOutcome,
  initCombatSession,
  processEnemyAI,
} from "./combatUtils";
import {
  beginCombatPresentation,
  consumeCombatPresentationEvents,
} from "./combatPresentationEvents";
import { createEnemyInstanceByName } from "../data/enemies";

const playerData = {
  name: "Герой",
  hp: 40,
  maxHp: 40,
  attack: 5,
  physDef: 0,
  magicDef: 0,
  abilities: [{ name: "Атака", damage: 1, basic: true, cooldown: 0, alwaysHits: true }],
};

const enemyData = (name = "Враг") => ({
  name,
  hp: 5,
  maxHp: 53,
  attack: 1,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  abilities: [{ name: "Укол", damage: 1, basic: true, cooldown: 0, alwaysHits: true }],
});

const addRegenAndBleed = (unit, session, regenDuration = 1, bleedDuration = 1) => {
  addEffect(unit, { id: "bleed", duration: bleedDuration }, () => {}, { name: "Источник", attack: 10 }, { session });
  addEffect(unit, { id: "regeneration", duration: regenDuration }, () => {}, unit, { session });
};

const makeEnemyActNext = (session, enemy) => {
  session.state.players[0].turnMeter = 0;
  enemy.turnMeter = 1000;
  session.state.initiative.playerReady = false;
};

describe("periodic effects at acting-unit turn start", () => {
  test("periodic HP loss advances Matriarch brood progress but shield absorption does not", () => {
    const createSession = shield => {
      const matriarch = createEnemyInstanceByName("Крысиный матриарх");
      const session = initCombatSession(playerData, [matriarch]);
      const runtimeMatriarch = session.state.enemies[0];
      runtimeMatriarch.shield = shield;
      addEffect(runtimeMatriarch, { id: "bleed", duration: 1 }, () => {}, { name: "Источник", attack: 10 }, { session });
      makeEnemyActNext(session, runtimeMatriarch);
      return { session, matriarch: runtimeMatriarch };
    };

    const unshielded = createSession(0);
    const hpBefore = unshielded.matriarch.hp;
    processEnemyAI(unshielded.session);
    const actualHpLost = hpBefore - unshielded.matriarch.hp;
    expect(actualHpLost).toBeGreaterThan(0);
    expect(unshielded.matriarch._litterCallDamageProgress).toBe(actualHpLost);

    const shielded = createSession(100);
    const shieldedHpBefore = shielded.matriarch.hp;
    processEnemyAI(shielded.session);
    expect(shielded.matriarch.hp).toBe(shieldedHpBefore);
    expect(shielded.matriarch._litterCallDamageProgress).toBe(0);
  });

  test("regeneration resolves before bleed and saves an enemy that then acts", () => {
    const session = initCombatSession(playerData, [enemyData()]);
    const enemy = session.state.enemies[0];
    addRegenAndBleed(enemy, session);
    makeEnemyActNext(session, enemy);
    beginCombatPresentation(session);

    processEnemyAI(session);

    expect(enemy.hp).toBe(3);
    expect(session.state.players[0].hp).toBeLessThan(40);
    const events = consumeCombatPresentationEvents(session);
    expect(events.filter(event => ["heal", "damage", "actionStart"].includes(event.type)).map(event => event.type))
      .toEqual(["heal", "damage", "actionStart", "damage"]);
  });

  test("insufficient regeneration lets bleed kill the enemy before it acts", () => {
    const session = initCombatSession(playerData, [{ ...enemyData(), maxHp: 13 }]);
    const enemy = session.state.enemies[0];
    addRegenAndBleed(enemy, session);
    makeEnemyActNext(session, enemy);

    processEnemyAI(session);

    expect(enemy.hp).toBe(0);
    expect(session.state.players[0].hp).toBe(40);
  });

  test("lethal DoT without regeneration kills the final enemy before action", () => {
    const session = initCombatSession(playerData, [enemyData("Последний враг")]);
    const enemy = session.state.enemies[0];
    addEffect(enemy, { id: "bleed", duration: 1 }, () => {}, { name: "Источник", attack: 14 }, { session });
    makeEnemyActNext(session, enemy);

    processEnemyAI(session);

    expect(enemy.hp).toBe(0);
    expect(session.state.players[0].hp).toBe(40);
    expect(checkBattleOutcome(session).victory).toBe(true);
  });

  test("newly applied DoT waits for the target turn and a three-turn status ticks three times", () => {
    const session = initCombatSession(playerData, [{ ...enemyData(), hp: 53 }]);
    const enemy = session.state.enemies[0];
    addEffect(enemy, { id: "bleed", duration: 3 }, () => {}, { name: "Источник", attack: 1 }, { session });

    expect(enemy.hp).toBe(53);
    for (let turn = 0; turn < 3; turn += 1) {
      makeEnemyActNext(session, enemy);
      processEnemyAI(session);
    }

    expect(session.state.log.filter(line => line.includes("истекает кровью"))).toHaveLength(3);
    expect(enemy.effects.some(effect => effect.id === "bleed")).toBe(false);
  });

  test("newly applied poison does not tick until the poisoned unit starts a turn", () => {
    const session = initCombatSession(playerData, [{ ...enemyData(), hp: 100, maxHp: 100 }]);
    const enemy = session.state.enemies[0];
    addEffect(enemy, { id: "poison", duration: 1 }, () => {}, { name: "Источник", attack: 1 }, { session });

    expect(enemy.hp).toBe(100);
    makeEnemyActNext(session, enemy);
    processEnemyAI(session);

    expect(enemy.hp).toBe(97);
    expect(session.state.log.filter(line => line.includes("страдает от яда"))).toHaveLength(1);
  });

  test("lethal player DoT resolves before player controls become ready", () => {
    const session = initCombatSession({ ...playerData, hp: 5, maxHp: 5 }, [{ ...enemyData(), hp: 40 }]);
    const player = session.state.players[0];
    addEffect(player, { id: "bleed", duration: 1 }, () => {}, { name: "Источник", attack: 14 }, { session });
    player.turnMeter = 1000;
    session.state.enemies[0].turnMeter = 0;
    session.state.initiative.playerReady = false;

    processEnemyAI(session);

    expect(player.hp).toBe(0);
    expect(session.state.initiative.playerReady).toBe(false);
    expect(checkBattleOutcome(session).defeat).toBe(true);
  });
});
