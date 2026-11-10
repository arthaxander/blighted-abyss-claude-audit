import { FIELD_CRAFTING_RECIPES, getFieldCraftingRecipes } from '../data/recipes';
import { craftRunInventoryRecipe, getRunInventoryLayout, normalizeInventorySlots, RUN_INVENTORY_LAYOUT_VERSION } from './expeditionInventory';
const recipe = FIELD_CRAFTING_RECIPES.find(entry => entry.id === 'blood_moss_poultice');
const bandageRecipe = FIELD_CRAFTING_RECIPES.find(entry => entry.id === 'deepweave_blood_bandage');
const stack = (itemId, quantity = 1) => ({ itemId, quantity });
const player = slots => ({ equipment: {}, runInventory: slots, runInventoryLayoutVersion: RUN_INVENTORY_LAYOUT_VERSION });
describe('expedition crafting transaction', () => {
  test('consumes typed resource ingredients and routes output to Consumable', () => {
    const slots = normalizeInventorySlots([], 26); slots[14] = stack('Кровяной мох'); slots[15] = stack('Простая ткань');
    const result = craftRunInventoryRecipe(player(slots), recipe);
    expect(result.success).toBe(true); expect(result.player.runInventory[12]).toEqual(stack('Кровяная припарка'));
    expect(result.player.runInventory[14]).toBeNull(); expect(result.player.runInventory[15]).toBeNull();
    expect(result.player.inventory).toBeUndefined();
  });
  test('merges a non-safe consumable stack and creates a new Consumable stack when full', () => {
    const partial = normalizeInventorySlots([], 26); partial[12] = stack('Кровяная припарка', 2); partial[14] = stack('Кровяной мох'); partial[15] = stack('Простая ткань');
    expect(craftRunInventoryRecipe(player(partial), recipe).player.runInventory[12]).toEqual(stack('Кровяная припарка', 3));
    const full = normalizeInventorySlots([], 26); full[12] = stack('Кровяная припарка', 3); full[14] = stack('Кровяной мох'); full[15] = stack('Простая ткань');
    expect(craftRunInventoryRecipe(player(full), recipe).player.runInventory[13]).toEqual(stack('Кровяная припарка'));
  });
  test('ingredient consumption can free General overflow capacity for output', () => {
    const slots = normalizeInventorySlots([], 26); [0,1,...getRunInventoryLayout().sections.find(s=>s.type==='general').indices,12,13].forEach((i,n)=>{ slots[i]=stack(`filler-${n}`); });
    slots[2] = stack('Кровяной мох'); slots[3] = stack('Простая ткань');
    expect(craftRunInventoryRecipe(player(slots), recipe).success).toBe(true);
  });
  test('insufficient output space is atomic', () => {
    const slots = normalizeInventorySlots([], 26); [0,1,...Array.from({length:12},(_,i)=>i+2)].forEach((i,n)=>{ slots[i]=stack(`filler-${n}`); }); slots[14]=stack('Кровяной мох',2); slots[15]=stack('Простая ткань',2);
    const before=JSON.parse(JSON.stringify(slots)); const result=craftRunInventoryRecipe(player(slots),recipe);
    expect(result).toMatchObject({success:false,reason:'insufficient-space'}); expect(result.player.runInventory).toEqual(before);
  });
});


describe('abyss-level field crafting', () => {
  test('shows the poultice on Level 1 and the blood bandage on Level 2', () => {
    expect(getFieldCraftingRecipes({ abyssLevel: 1 }).map(entry => entry.id)).toEqual(expect.arrayContaining(['blood_moss_poultice']));
    expect(getFieldCraftingRecipes({ abyssLevel: 2 }).map(entry => entry.id)).toEqual(expect.arrayContaining(['blood_moss_poultice', 'deepweave_blood_bandage']));
  });

  test('crafts Blood Bandage from two Deepweave Cloth in the run inventory', () => {
    const slots = normalizeInventorySlots([], 26);
    slots[14] = stack('Глубинное полотно', 1);
    slots[15] = stack('Кровяной мох', 1);
    const result = craftRunInventoryRecipe(player(slots), bandageRecipe);

    expect(result.success).toBe(true);
    expect(result.player.runInventory[12]).toEqual(stack('Кровяная повязка'));
    expect(result.player.runInventory[14]).toBeNull();
    expect(result.player.runInventory[15]).toBeNull();
  });
});