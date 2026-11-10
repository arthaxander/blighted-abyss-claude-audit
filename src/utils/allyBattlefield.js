const ALLY_SLOTS_BY_COUNT = {
  0: [],
  1: [1],
  2: [0, 2],
  3: [0, 1, 2],
};

export const getAllyBattlefieldLayout = allyCount => {
  const count = Math.max(0, Math.min(3, Math.floor(Number(allyCount) || 0)));
  const mode = count === 0 ? "empty" : count === 1 ? "solo" : count === 2 ? "duo" : "trio";
  return { mode, slots: ALLY_SLOTS_BY_COUNT[count] };
};
