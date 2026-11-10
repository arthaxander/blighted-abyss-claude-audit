import {
  getSelectedCombatItemGroup,
  reconcileCombatQuickItem,
  selectCombatQuickItem,
} from "./combatQuickItem";

const groups = [
  { key: "potion", name: "Зелье", quantity: 3 },
  { key: "scroll", name: "Свиток", quantity: 2 },
];

describe("combat quick item selection", () => {
  test("selection and replacement do not mutate quantities or turn state", () => {
    const before = JSON.parse(JSON.stringify(groups));
    const turn = { spent: false };
    let selected = selectCombatQuickItem(null, "potion");
    selected = selectCombatQuickItem(selected, "scroll");
    expect(selected).toBe("scroll");
    expect(groups).toEqual(before);
    expect(turn.spent).toBe(false);
  });

  test("quantity is derived from the current inventory group", () => {
    expect(getSelectedCombatItemGroup(groups, "potion")?.quantity).toBe(3);
    const afterUse = [{ ...groups[0], quantity: 2 }, groups[1]];
    expect(getSelectedCombatItemGroup(afterUse, "potion")?.quantity).toBe(2);
  });

  test("the slot clears when its final copy is absent", () => {
    expect(reconcileCombatQuickItem(groups, "potion")).toBe("potion");
    expect(reconcileCombatQuickItem(groups.slice(1), "potion")).toBeNull();
  });
});
