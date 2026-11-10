import { getEnemyBattlefieldLayout, getEnemyStatusPresentation } from "./enemyBattlefield";

describe("enemy battlefield layout", () => {
  test.each([
    [1, "solo", [1]],
    [2, "duo", [0, 2]],
    [3, "trio", [0, 1, 2]],
    [4, "quad", [0, 2, 3, 5]],
    [5, "swarm", [0, 1, 2, 3, 5]],
    [6, "swarm", [0, 1, 2, 3, 4, 5]],
  ])("maps %i enemies to %s presentation", (count, mode, slots) => {
    expect(getEnemyBattlefieldLayout(count)).toEqual({ mode, slots });
  });

  test.each([
    ["solo", "normal", 4, 2, 8],
    ["duo", "normal", 4, 2, 8],
    ["trio", "normal", 4, 2, 8],
    ["quad", "compact", 3, 1, 3],
    ["swarm", "compact", 3, 1, 3],
  ])("maps %s to %s status presentation", (layout, mode, columns, rows, capacity) => {
    expect(getEnemyStatusPresentation(layout)).toEqual({ mode, columns, rows, capacity });
  });
});
