import { FIELD_CRAFTING_RECIPES } from '../data/recipes';
import { normalizeFieldLoadout, getSelectedFieldRecipes, setFieldLoadout, saveFieldPreset, applyFieldPreset } from '../data/fieldCraftingLoadout';
import { craftSelectedFieldRecipe } from './fieldCrafting';
import { getRunInventoryLayout, insertItems, applyExpeditionDeath } from './expeditionInventory';
import { prepareFreshDungeonRun, resetDungeonRunState } from './dungeonRunState';
import { buildPlayerSnapshot, hydratePlayerSnapshot } from './playerState';
const recipe = name => FIELD_CRAFTING_RECIPES.find(r => r.name === name);
const player = () => ({ name: 'Герой', class: 'Defender', hp: 100, maxHp: 100, equipment: {}, runInventoryLayoutVersion: 2,
  runInventory: insertItems(Array(26).fill(null), [{itemId:'Кровяной мох',quantity:5},{itemId:'Простые чернила',quantity:5},{itemId:'Простая ткань',quantity:5}], { layout: getRunInventoryLayout() }).slots });

test('six typed choices include a universal slot, with medicine always available', () => {
  const defaults = normalizeFieldLoadout();
  expect(defaults).toHaveLength(6);
  expect(new Set(defaults).size).toBe(6);
  const r = recipe('Свиток уязвимости');
  expect(normalizeFieldLoadout([r.id,r.id,r.id,r.id,r.id,r.id])).toEqual([null,null,r.id,null,null,null]);
  const empty = { ...player(), fieldCraftingLoadout: [] };
  expect(getSelectedFieldRecipes(empty).map(r=>r.name)).toEqual(['Кровяная припарка']);
  expect(getSelectedFieldRecipes({...empty,abyssLevel:2}).map(r=>r.name)).toEqual(['Кровяная припарка','Кровяная повязка']);
});

test('craft rejects an unselected recipe without spending, and uses canonical costs/output', () => {
  const p = player();
  expect(craftSelectedFieldRecipe(p, recipe('Свиток рассеивания'))).toMatchObject({ success:false, reason:'recipe-not-equipped', player:p });
  const r = recipe('Свиток уязвимости');
  const result = craftSelectedFieldRecipe(p, { ...r, ingredients:[], result:{name:r.name,quantity:99} });
  expect(result.success).toBe(true);
  expect(result.player.runInventory.find(s=>s?.itemId===r.name).quantity).toBe(1);
  expect(result.player.runInventory.find(s=>s?.itemId==='Кровяной мох').quantity).toBe(4);
  expect(craftSelectedFieldRecipe({...p,activeCombat:{}},r).reason).toBe('in-combat');
});

test('future-floor selection cannot bypass recipe floor or unlock every alternative', () => {
  const r = recipe('Зелье здоровья');
  const p = {...player(),fieldCraftingLoadout:[r.id]};
  expect(craftSelectedFieldRecipe(p,r).reason).toBe('recipe-not-equipped');
  expect(getSelectedFieldRecipes({...p,abyssLevel:2})).toContain(r);
});

test('departure freezes choices; presets and edit helpers cannot change them in a run', () => {
  const base = saveFieldPreset(player(),0,'Первый');
  const run = prepareFreshDungeonRun(base,'Гоблинские Норы');
  const expected = getSelectedFieldRecipes(run);
  expect(setFieldLoadout(run,[])).toBe(run);
  expect(saveFieldPreset(run,1,'Другой')).toBe(run);
  expect(applyFieldPreset(run,0)).toBe(run);
  expect(getSelectedFieldRecipes({...run,fieldCraftingLoadout:[]})).toEqual(expected);
  const restored = hydratePlayerSnapshot(JSON.parse(JSON.stringify(buildPlayerSnapshot(run))));
  expect(getSelectedFieldRecipes(restored)).toEqual(expected);
  expect(restored.fieldCraftingPresets[0].name).toBe('Первый');
  const returned = resetDungeonRunState(applyExpeditionDeath(restored));
  expect(returned.fieldCraftingRunLoadout).toBeNull();
  expect(returned.fieldCraftingPresets[0].name).toBe('Первый');
  expect(setFieldLoadout(returned,[]).fieldCraftingLoadout).toEqual(Array(6).fill(null));
});

test('saved sets restore choices; corrupt and old saves get bounded deterministic data', () => {
  const base = saveFieldPreset(player(),0,'Мой набор');
  expect(applyFieldPreset(setFieldLoadout(base,[]),0).fieldCraftingLoadout).toEqual(normalizeFieldLoadout());
  expect(saveFieldPreset(base,3,'Лишний')).toBe(base);
  const restored = hydratePlayerSnapshot({...player(), currentLocation:'Гоблинские Норы',fieldCraftingLoadout:['unknown']});
  expect(restored.fieldCraftingRunLoadout).toEqual(Array(6).fill(null));
  expect(hydratePlayerSnapshot({...player(),currentLocation:'Гоблинские Норы'}).fieldCraftingRunLoadout).toEqual(normalizeFieldLoadout());
});
