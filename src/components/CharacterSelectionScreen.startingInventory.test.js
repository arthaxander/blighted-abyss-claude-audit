import { createStartingExpeditionLoadout, STARTER_FISHING_ROD } from './CharacterSelectionScreen';
import { getStackLimit, isSafeSlotIndex } from '../utils/expeditionInventory';

describe('fresh character expedition loadout', () => {
  test('starts with one ordinary stack of two health potions and an equipped rod', () => {
    const loadout = createStartingExpeditionLoadout({});
    expect(loadout.runInventory).toHaveLength(26);
    expect(loadout.runInventory.filter(Boolean)).toEqual([{ itemId: 'Малое зелье здоровья', quantity: 2 }]);
    expect(loadout.runInventory.findIndex(Boolean)).toBe(12);
    expect(loadout.inventory).toEqual(['Малое зелье здоровья', 'Малое зелье здоровья']);
    expect(getStackLimit('Малое зелье здоровья')).toBe(3);
    expect(loadout.fishingTool).toBe(STARTER_FISHING_ROD);
    expect(loadout.runInventory.some(stack => stack?.itemId === STARTER_FISHING_ROD)).toBe(false);
    expect(loadout.fishingSetup).toEqual({ rod: STARTER_FISHING_ROD, bait: '' });
    expect(loadout.runSilver).toBe(0);
    expect([0, 1, 2].map(isSafeSlotIndex)).toEqual([true, true, false]);
  });
});
