import { getAllyBattlefieldLayout } from "./allyBattlefield";

describe("ally battlefield layout", () => {
  test.each([
    [0, "empty", []],
    [1, "solo", [1]],
    [2, "duo", [0, 2]],
    [3, "trio", [0, 1, 2]],
  ])("maps %i allies to stable %s slots", (count, mode, slots) => {
    expect(getAllyBattlefieldLayout(count)).toEqual({ mode, slots });
  });

  test("caps presentation at three allies", () => {
    expect(getAllyBattlefieldLayout(5)).toEqual({ mode: "trio", slots: [0, 1, 2] });
  });
});
