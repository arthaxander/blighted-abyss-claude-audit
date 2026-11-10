import { initCombatSession } from './combatUtils';
import { applyEquipmentPatch } from './equipmentManager';
import { applyInventoryItemUse } from './inventoryItemUse';
import { insertItems, normalizeInventorySlots } from './expeditionInventory';
import { prepareFreshDungeonRun } from './dungeonRunState';
import { reconcileCombatConsumables, resolveCombatPlayerFromBattleResult, resolvePostCombatVitals } from './combatRunPersistence';

const player = hp => ({ name: 'Герой', hp, maxHp: 100, attack: 10, abilities: [] });

describe('expedition HP persistence', () => {
  test.each([37, 1])('%i HP survives combat result handoff and next session reconstruction', (hp) => {
    const finished = initCombatSession(player(100), [{ name: 'Враг', hp: 1, maxHp: 1 }]);
    finished.state.players[0].hp = hp;
    const activeCombat = { state: finished.state, battleResult: { outcome: 'victory', loot: { silver: 0, items: [] } } };
    const combatPlayer = resolveCombatPlayerFromBattleResult(activeCombat.battleResult, activeCombat);
    const persisted = { ...player(100), ...resolvePostCombatVitals(player(100), combatPlayer) };
    expect(persisted.hp).toBe(hp);
    expect(initCombatSession(persisted, [{ name: 'Следующий враг', hp: 1, maxHp: 1 }]).state.players[0].hp).toBe(hp);
  });

  test('missing playerState on the persisted battle result uses the authoritative combat snapshot', () => {
    const snapshotPlayer = player(37);
    expect(resolveCombatPlayerFromBattleResult({ outcome: 'victory' }, { state: { players: [snapshotPlayer] } })).toBe(snapshotPlayer);
    expect(resolvePostCombatVitals(player(100), snapshotPlayer)).toEqual({ hp: 37, maxHp: 100 });
  });

  test('explicit healing still changes current HP', () => {
    const wounded = { ...player(37), runInventory: normalizeInventorySlots([{ itemId: 'Кровяная припарка', quantity: 1 }], 10) };
    const healed = applyInventoryItemUse(wounded, 0, { inExpedition: true, inCombat: false });
    expect(healed.used).toBe(true);
    expect(healed.player.hp).toBeGreaterThan(37);
  });

  test('a genuinely fresh expedition starts at full current Max HP', () => {
    expect(prepareFreshDungeonRun(player(37), 'Грибные Пещеры').hp).toBe(100);
  });

  test('existing equipment recalculation preserves its canonical HP ratio without a full heal', () => {
    const recalculated = applyEquipmentPatch({ ...player(37), baseStats: { maxHp: 100 }, equipment: {} }, {}, []);
    expect(recalculated.hp).toBe(37);
    expect(recalculated.maxHp).toBe(100);
  });
});

describe('production combat consumable reconciliation', () => {
  const stack = (itemId, quantity) => ({ itemId, quantity });
  test('5 -> use 2 -> next combat sees 3 without changing another stack', () => {
    const persistent = { equipment: {}, runInventory: normalizeInventorySlots([stack('Малое зелье здоровья', 5), stack('Малое зелье щита', 2)], 10) };
    const combatPlayer = { items: [
      ...Array(3).fill({ name: 'Малое зелье здоровья' }),
      ...Array(2).fill({ name: 'Малое зелье щита' }),
    ] };
    const next = reconcileCombatConsumables(persistent, combatPlayer);
    expect(next.runInventory.filter(Boolean)).toEqual([stack('Малое зелье здоровья', 3), stack('Малое зелье щита', 2)]);
    expect(initCombatSession(next, [{ name: 'Враг', hp: 1, maxHp: 1 }]).state.players[0].items).toHaveLength(5);
  });

  test('exhausted stack remains at zero', () => {
    const next = reconcileCombatConsumables({ equipment: {}, runInventory: normalizeInventorySlots([stack('Малое зелье здоровья', 1)], 10) }, { items: [] });
    expect(next.runInventory.every(entry => entry === null)).toBe(true);
  });

  test('loot acquired after consumption is added to the reconciled quantity', () => {
    const consumed = reconcileCombatConsumables({ equipment: {}, runInventory: normalizeInventorySlots([stack('Малое зелье здоровья', 5)], 10) }, { items: Array(3).fill({ name: 'Малое зелье здоровья' }) });
    const acquired = insertItems(consumed.runInventory, [stack('Малое зелье здоровья', 1)]).slots;
    expect(acquired.filter(entry => entry?.itemId === 'Малое зелье здоровья').reduce((sum, entry) => sum + entry.quantity, 0)).toBe(4);
  });
});
