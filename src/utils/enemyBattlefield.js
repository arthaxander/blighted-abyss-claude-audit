const LOGICAL_SLOTS_BY_COUNT = {
  0: [],
  1: [1],
  2: [0, 2],
  3: [0, 1, 2],
  4: [0, 2, 3, 5],
  5: [0, 1, 2, 3, 5],
  6: [0, 1, 2, 3, 4, 5],
};

const DENSE_ENEMY_MODES = new Set(["quad", "swarm"]);

export const getEnemyStatusPresentation = mode => {
  const dense = DENSE_ENEMY_MODES.has(mode);
  return { mode: dense ? "compact" : "normal", columns: dense ? 3 : 4, rows: dense ? 1 : 2, capacity: dense ? 3 : 8 };
};

export const getEnemyBattlefieldLayout = enemyCount => {
  const count = Math.max(0, Math.floor(Number(enemyCount) || 0));
  const mode = count <= 1 ? "solo" : count === 2 ? "duo" : count === 3 ? "trio" : count === 4 ? "quad" : "swarm";
  const slots = LOGICAL_SLOTS_BY_COUNT[Math.min(count, 6)] || [];
  return {
    mode,
    slots: Array.from({ length: count }, (_, index) => slots[index] ?? index),
  };
};
