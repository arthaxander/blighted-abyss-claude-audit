import { claimPendingSilver, commitPendingLoot, createPendingLoot, previewPendingLoot, selectFittingPendingLoot, shouldOverrideLootWarningSuppression, shouldWarnAboutAbandonedLoot, togglePendingLootSelection } from './pendingLoot';
import { normalizeInventorySlots } from './expeditionInventory';

describe('pending loot domain', () => {
  test('session suppression only yields to canonical high-value loot', () => {
    expect(shouldWarnAboutAbandonedLoot([{ itemId: 'Простая ткань' }], false)).toBe(true);
    expect(shouldWarnAboutAbandonedLoot([{ itemId: 'Простая ткань' }], true)).toBe(false);
    expect(shouldOverrideLootWarningSuppression({ itemId: 'Куртка Мародёра' })).toBe(false);
    expect(shouldOverrideLootWarningSuppression({ itemId: 'Амулет Трёх Искр' })).toBe(true);
    expect(shouldOverrideLootWarningSuppression({ itemId: 'Эссенция Проклятий' })).toBe(true);
    expect(shouldWarnAboutAbandonedLoot([{ itemId: 'Амулет Трёх Искр' }], true)).toBe(true);
  });
  test('preserves expedition key roll through combat loot selection', () => {
    const pending = createPendingLoot({
      id: 'combat-key',
      source: 'combat',
      loot: {
        expeditionKeyRoll: {
          keyType: 'sublocation',
          zone: 'approach',
          sourceCellId: 'cell-1',
          battleNumber: 5,
          totalBattles: 7,
          chance: 1,
          dropped: true,
        },
      },
    });
    expect(pending.expeditionKeyRoll).toMatchObject({
      keyType: 'sublocation',
      sourceCellId: 'cell-1',
      dropped: true,
    });
  });

  test('starts with no selected physical items and selection is stable', () => {
    let pending = createPendingLoot({ id: 'reward', source: 'combat', loot: { silver: 43, items: [{ name: 'Простая ткань', quantity: 3 }] } });
    expect(pending.selectedIds).toEqual([]); expect(pending.silver).toBe(43);
    pending = togglePendingLootSelection(pending, pending.items[0].id);
    expect(pending.selectedIds).toHaveLength(1);
  });
  test('preview uses partial stacks and blocks an atomic commit that does not fit', () => {
    const slots = normalizeInventorySlots([{ itemId: 'Простая ткань', quantity: 19 }], 1);
    let pending = createPendingLoot({ id: 'reward', loot: { items: [{ name: 'Простая ткань', quantity: 2 }] } });
    pending = togglePendingLootSelection(pending, pending.items[0].id);
    expect(previewPendingLoot(pending, slots)).toMatchObject({ fits: false, additionalSlotsRequired: 1 });
    expect(commitPendingLoot(pending, slots).committed).toBe(false);
  });
  test('only selected loot enters inventory and silver claim is idempotent', () => {
    let pending = createPendingLoot({ id: 'reward', loot: { silver: 8, items: [{ name: 'Простая ткань' }, { name: 'Обрывки кожи' }] } });
    pending = togglePendingLootSelection(pending, pending.items[0].id);
    const committed = commitPendingLoot(pending, normalizeInventorySlots([], 10));
    expect(committed.slots.filter(Boolean).map(x => x.itemId)).toEqual(['Простая ткань']);
    let claim = claimPendingSilver({ runSilver: 2 }, pending);
    expect(claim.player.runSilver).toBe(10);
    claim = claimPendingSilver(claim.player, claim.pending);
    expect(claim.player.runSilver).toBe(10);
  });
});

test('special rewards remain outside inventory selection and capacity', () => {
  const pending = createPendingLoot({ loot: { items: [], specialRewards: [{ id: 'portal_stone', name: 'Камень портала' }] } });
  expect(pending.specialRewards).toEqual([{ id: 'portal_stone', name: 'Камень портала' }]);
  expect(pending.items).toEqual([]);
  expect(previewPendingLoot(pending, Array(12).fill(null)).additionalSlotsRequired).toBe(0);
});

test('take-all splits a resource stack when only part fits, without changing rewards', () => {
  const pending = createPendingLoot({ id: 'partial', source: 'combat', loot: {
    silver: 19, items: [{ name: 'Простая ткань', quantity: 3 }],
  } });
  const slots = normalizeInventorySlots([{ itemId: 'Простая ткань', quantity: 19 }], 1);
  const candidate = selectFittingPendingLoot(pending, slots);
  expect(candidate.selectedIds).toEqual([pending.items[0].id]);
  expect(candidate.items.map(item => item.quantity)).toEqual([1, 2]);
  const committed = commitPendingLoot(candidate, slots);
  expect(committed.committed).toBe(true);
  expect(committed.slots[0]).toMatchObject({ itemId: 'Простая ткань', quantity: 20 });
  expect(committed.abandoned).toEqual([expect.objectContaining({ itemId: 'Простая ткань', quantity: 2 })]);
  expect(candidate.silver).toBe(19);
  expect(pending.items[0].quantity).toBe(3);
});

