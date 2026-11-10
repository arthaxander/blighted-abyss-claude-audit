import { enemies as canonicalEnemies } from "../data/enemies";

export const CUSTOM_COMBAT_MAX_ENEMIES = 6;

export const canAccessCustomCombat = ({ screen, hasPlayer }) => (
  screen === "guild" && Boolean(hasPlayer)
);

const cloneSandboxValue = value => {
  if (Array.isArray(value)) return value.map(cloneSandboxValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneSandboxValue(entry)]));
  }
  return value;
};

export const getCustomCombatEnemyCatalog = () => canonicalEnemies.map(enemy => ({
  id: enemy.id,
  name: enemy.name,
  location: enemy.location || enemy.faction || "Без локации",
  category: enemy.boss ? "Босс" : enemy.miniBoss ? "Элита/проклятый" : "Обычный",
  definition: enemy,
}));

export const addCustomCombatEnemy = (selection, definitionId, sequence) => {
  if ((selection || []).length >= CUSTOM_COMBAT_MAX_ENEMIES) return selection;
  return [...(selection || []), { definitionId, selectionId: `custom-${sequence}` }];
};

export const moveCustomCombatEnemy = (selection, index, direction) => {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= selection.length || target >= selection.length) return selection;
  const next = [...selection];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

export const createCustomCombatSandbox = (player, selection, catalog = getCustomCombatEnemyCatalog()) => {
  const byId = new Map(catalog.map(entry => [entry.id, entry.definition]));
  const enemies = (selection || []).flatMap((entry, index) => {
    const definition = byId.get(entry.definitionId);
    if (!definition) return [];
    return [{
      ...cloneSandboxValue(definition),
      id: `custom-enemy-${entry.selectionId || index}`,
      effects: [],
    }];
  });
  const sandboxPlayer = {
    ...cloneSandboxValue(player || {}),
    runInventory: cloneSandboxValue(player?.runInventory || []),
    effects: [],
  };
  return { combatContext: "customDev", player: sandboxPlayer, enemies };
};
