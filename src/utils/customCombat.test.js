import {
  addCustomCombatEnemy,
  createCustomCombatSandbox,
  CUSTOM_COMBAT_MAX_ENEMIES,
  getCustomCombatEnemyCatalog,
  canAccessCustomCombat,
  moveCustomCombatEnemy,
} from "./customCombat";
import { getCombatTargetId } from "./combatTargeting";

describe("development custom combat", () => {
  test("is accessible with a player in the Guild in production builds", () => {
    const originalEnvironment = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { configurable: true, value: "production" });
    expect(canAccessCustomCombat({ screen: "guild", hasPlayer: true })).toBe(true);
    expect(canAccessCustomCombat({ screen: "guild", hasPlayer: false })).toBe(false);
    expect(canAccessCustomCombat({ screen: "dungeon", hasPlayer: true })).toBe(false);
    expect(canAccessCustomCombat({ screen: "combat", hasPlayer: true })).toBe(false);
    Object.defineProperty(process.env, "NODE_ENV", { configurable: true, value: originalEnvironment });
  });

  test("catalog is populated from canonical standalone enemies", () => {
    const catalog = getCustomCombatEnemyCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every(entry => entry.definition && !entry.definition.summonOnly)).toBe(true);
    expect(new Set(catalog.map(entry => entry.id)).size).toBe(catalog.length);
  });

  test("duplicates preserve order, reorder, and stop at six", () => {
    const id = getCustomCombatEnemyCatalog()[0].id;
    let selection = [];
    for (let index = 0; index < CUSTOM_COMBAT_MAX_ENEMIES + 2; index += 1) {
      selection = addCustomCombatEnemy(selection, id, index);
    }
    expect(selection).toHaveLength(6);
    expect(new Set(selection.map(entry => entry.selectionId)).size).toBe(6);
    expect(moveCustomCombatEnemy(selection, 0, 1)[1]).toEqual(selection[0]);
  });

  test.each([1, 2, 3, 4, 5, 6])("creates %i distinct real combat units", count => {
    const catalog = getCustomCombatEnemyCatalog();
    const selection = Array.from({ length: count }, (_, index) => ({
      definitionId: catalog[0].id,
      selectionId: `duplicate-${index}`,
    }));
    const original = { name: "Tester", hp: 50, abilities: [], items: [], runInventory: [], roomGenerationState: { safe: true } };
    const sandbox = createCustomCombatSandbox(original, selection, catalog);
    expect(sandbox.combatContext).toBe("customDev");
    expect(sandbox.enemies).toHaveLength(count);
    expect(new Set(sandbox.enemies.map(enemy => enemy.id)).size).toBe(count);
    expect(sandbox.enemies.map((_, index) => getCombatTargetId("enemy", index)))
      .toEqual(Array.from({ length: count }, (_, index) => `enemy:${index}`));
    expect(original).toEqual({ name: "Tester", hp: 50, abilities: [], items: [], runInventory: [], roomGenerationState: { safe: true } });
  });

  test("deeply copies canonical carried inventory without requiring legacy inventory", () => {
    const carried = { itemId: "Капюшон Искателя Знаков", quantity: 1, metadata: { socket: "stone_vigil" } };
    const original = {
      name: "Persistent hero",
      hp: 37,
      runInventory: [carried, null],
      equipment: { head: { itemId: carried.itemId, durability: { value: 9 } } },
      questLog: { quest: { progress: 2 } },
    };
    const snapshot = JSON.parse(JSON.stringify(original));

    const sandbox = createCustomCombatSandbox(original, []);

    expect(sandbox.player.runInventory).toEqual(original.runInventory);
    expect(sandbox.player.runInventory).not.toBe(original.runInventory);
    expect(sandbox.player.runInventory[0]).not.toBe(carried);
    expect(sandbox.player.runInventory[0].metadata).not.toBe(carried.metadata);
    expect(sandbox.player).not.toHaveProperty("inventory");
    sandbox.player.runInventory[0].metadata.socket = "changed";
    sandbox.player.equipment.head.durability.value = 0;
    sandbox.player.questLog.quest.progress = 99;
    expect(original).toEqual(snapshot);
  });
});
