import {
  createExecutionGate,
  executeValidCombatDrop,
  findValidCombatTarget,
  getCombatTargetId,
  getValidCombatTargets,
} from "./combatTargeting";
import { ABILITY_LIBRARY } from "../data/abilityPresets";
import { getItemDefinition } from "../data/items";

const player = { name: "Hero", hp: 10 };
const enemies = [
  { name: "Жук", hp: 10 },
  { name: "Жук", hp: 8 },
  { name: "Жук", hp: 0 },
];

describe("combat drag targeting", () => {
  test("Defender endurance is canonically self-targeted", () => {
    const endurance = ABILITY_LIBRARY["Стойкость"];
    expect(endurance.targeting).toBe("self");
    const targets = getValidCombatTargets({ action: endurance, players: [player], enemies });
    expect(findValidCombatTarget(targets, "player:0")).not.toBeNull();
    expect(findValidCombatTarget(targets, "enemy:0")).toBeNull();
  });

  test("frost shield stays self-targeted while damaging abilities target enemies", () => {
    expect(ABILITY_LIBRARY["Морозный щит"].targeting).toBe("self");
    const frostTargets = getValidCombatTargets({ action: ABILITY_LIBRARY["Морозный щит"], players: [player], enemies });
    const fireballTargets = getValidCombatTargets({ action: ABILITY_LIBRARY["Огненный шар"], players: [player], enemies });
    expect(frostTargets.map(target => target.id)).toEqual(["player:0"]);
    expect(fireballTargets.map(target => target.id)).toEqual(["enemy:0", "enemy:1"]);
  });

  test("healing scroll remains self-targeted", () => {
    const healingScroll = getItemDefinition("Свиток Лечения");
    expect(healingScroll.target).toBe("self");
    expect(getValidCombatTargets({ action: healingScroll, players: [player], enemies }).map(target => target.id))
      .toEqual(["player:0"]);
  });

  test("enemy actions include only living enemies with index-based identities", () => {
    const targets = getValidCombatTargets({ action: { target: "enemy" }, players: [player], enemies });
    expect(targets.map(target => target.id)).toEqual(["enemy:0", "enemy:1"]);
    expect(targets[0].id).not.toBe(targets[1].id);
  });

  test("self actions include only the player", () => {
    const ally = { name: "Ally", hp: 5 };
    const targets = getValidCombatTargets({ action: { targeting: "self" }, players: [player, ally], enemies });
    expect(targets.map(target => target.id)).toEqual(["player:0"]);
  });

  test("ally actions support all living friendly units", () => {
    const targets = getValidCombatTargets({
      action: { targeting: "ally" },
      players: [player, { name: "Ally", hp: 5 }, { name: "Fallen", hp: 0 }],
      enemies,
    });
    expect(targets.map(target => target.id)).toEqual(["player:0", "player:1"]);
  });

  test("duplicate-name allies remain distinct by friendly index", () => {
    const summon = { name: "Summon", hp: 5 };
    const targets = getValidCombatTargets({
      action: { targeting: "ally" },
      players: [player, { ...summon }, { ...summon }, { ...summon }],
      enemies,
    });
    expect(targets.map(target => target.id)).toEqual(["player:0", "player:1", "player:2", "player:3"]);
  });

  test("invalid and dead target IDs are rejected", () => {
    const targets = getValidCombatTargets({ action: { target: "enemy" }, players: [player], enemies });
    expect(findValidCombatTarget(targets, getCombatTargetId("enemy", 2))).toBeNull();
    expect(findValidCombatTarget(targets, "player:0")).toBeNull();
  });

  test("one gesture can execute only once", () => {
    const execute = jest.fn();
    const gate = createExecutionGate();
    expect(gate(execute)).toBe(true);
    expect(gate(execute)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("invalid drops do not execute or consume an item", () => {
    let itemCount = 2;
    let turns = 0;
    const targets = getValidCombatTargets({ action: { target: "enemy" }, players: [player], enemies });
    const result = executeValidCombatDrop({
      validTargets: targets,
      targetId: "player:0",
      execute: () => { itemCount -= 1; turns += 1; },
    });
    expect(result).toBe(false);
    expect(itemCount).toBe(2);
    expect(turns).toBe(0);
  });

  test("a damaging item executes on the dropped enemy and consumes exactly one", () => {
    let itemCount = 2;
    const affected = [];
    const gate = createExecutionGate();
    const targets = getValidCombatTargets({ action: { target: "enemy" }, players: [player], enemies });
    const drop = () => executeValidCombatDrop({
      validTargets: targets,
      targetId: "enemy:1",
      gate,
      execute: target => { itemCount -= 1; affected.push(target.index); },
    });
    expect(drop()).toBe(true);
    expect(drop()).toBe(false);
    expect(itemCount).toBe(1);
    expect(affected).toEqual([1]);
  });

  test("self and enemy abilities execute on their dropped unit", () => {
    const executed = [];
    const selfTargets = getValidCombatTargets({ action: { target: "self" }, players: [player], enemies });
    const enemyTargets = getValidCombatTargets({ action: { target: "enemy" }, players: [player], enemies });
    executeValidCombatDrop({ validTargets: selfTargets, targetId: "player:0", execute: target => executed.push(target.id) });
    executeValidCombatDrop({ validTargets: enemyTargets, targetId: "enemy:1", execute: target => executed.push(target.id) });
    expect(executed).toEqual(["player:0", "enemy:1"]);
  });
});
