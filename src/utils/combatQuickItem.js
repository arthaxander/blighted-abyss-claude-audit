export const selectCombatQuickItem = (currentKey, nextKey) => nextKey || currentKey || null;

export const getSelectedCombatItemGroup = (groups = [], selectedKey = null) => (
  selectedKey ? groups.find(group => group?.key === selectedKey) || null : null
);

export const reconcileCombatQuickItem = (groups = [], selectedKey = null) => (
  getSelectedCombatItemGroup(groups, selectedKey)?.key || null
);
