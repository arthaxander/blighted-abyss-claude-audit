import { findItemData, getCraftingRecipes } from './items';
import { getRuneRecipes } from './runes';
import { getVendorCatalog } from './vendors';
import { FIELD_CRAFTING_RECIPES } from './recipes';
import { getResourceRoomTable } from '../utils/roomGeneration';

test('active Guild potions and runes match crafting economy v1', () => {
  const recipes = getCraftingRecipes();
  expect(recipes.filter(recipe => findItemData(recipe.name)?.type === 'consumable').map(recipe => recipe.name).sort()).toEqual([
    'Малое зелье атаки', 'Малое зелье здоровья', 'Малое зелье магической силы', 'Малое зелье регенерации', 'Малое зелье щита',
  ].sort());
  getRuneRecipes().forEach(rune => expect(rune.craft).toContainEqual({ name: 'Эссенция Проклятий', quantity: 1 }));
  expect(FIELD_CRAFTING_RECIPES.map(recipe => recipe.name)).toEqual(expect.arrayContaining(['Кровяная припарка', 'Кровяная повязка', 'Свиток уязвимости', 'Колючая западня']));
  expect(recipes.map(recipe => recipe.name)).not.toContain('Кровяная припарка');
});

test('active location materials and signature recipes are canonical', () => {
  expect(findItemData('Мицелий')?.name).toBe('Лазурный мицелий');
  expect(findItemData('Споры')?.name).toBe('Блуждающие споры');
  expect(findItemData('Астральный разлом')?.name).toBe('Мерцающий узел');
  expect(getResourceRoomTable('Гоблинские Норы').map(x => x.name)).toContain('Пепел гоблинского перца');
  expect(getResourceRoomTable('Грибные Пещеры').map(x => x.name)).toEqual(expect.arrayContaining(['Лазурный мицелий', 'Блуждающие споры', 'Спора светокапа']));
  expect(getResourceRoomTable('Лагерь Отступников').map(x => x.name)).toEqual(expect.arrayContaining(['Сумеречный вереск', 'Черножильная руда']));
});

test('Guild equipment crafting follows the authored L1/L2 recipe structure', () => {
  const equipmentRecipes = getCraftingRecipes()
    .filter(recipe => findItemData(recipe.name)?.type === 'equipment')
    .map(recipe => recipe.name);
  expect(equipmentRecipes).toEqual(expect.arrayContaining([
    'Посох Украденной Искры', 'Шипастый Щит Нор', 'Накидка Красного Костра',
    'Лук Спороносца', 'Венец блуждающих спор', 'Мерцающая оболочка',
    'Плащ разведчика', 'Булава Старого Сотника', 'Клятвопреступник',
    'Амулет цепкой живицы', 'Зеркало третьего голоса', 'Щит тлеющей жилы',
    'Лук последнего цветения', 'Амулет последнего отзвука', 'Посох выжженной памяти',
    'Шлем глубинного дозора', 'Кираса глубинного дозора', 'Сапоги глубинного дозора',
  ]));
  expect(equipmentRecipes).not.toContain('Укреплённые поножи');
});

test('vendors have no direct arbitrage and do not sell location materials', () => {
  const vendors = getVendorCatalog();
  vendors.flatMap(vendor => vendor.items).forEach(item => expect(item.sellPrice || 0).toBeLessThanOrEqual(item.price));
  const alchemist = vendors.find(vendor => vendor.id === 'alchemist');
  expect(alchemist.items.map(item => item.name)).toEqual([
    'Малое зелье здоровья',
    'Малое зелье защиты',
    'Малое зелье скорости',
    'Малое зелье антимагии',
    'Малое зелье очищения',
  ]);
  expect(Object.fromEntries(alchemist.items.map(item => [item.name, item.dailyLimit]))).toEqual({
    'Малое зелье здоровья': 5,
    'Малое зелье защиты': 3,
    'Малое зелье скорости': 3,
    'Малое зелье антимагии': 3,
    'Малое зелье очищения': 2,
  });
  ['Малое зелье регенерации', 'Малое зелье атаки', 'Малое зелье щита', 'Малое зелье магической силы',
    'Свиток Огненного шара', 'Свиток Лечения', 'Свиток Кровавого касания', 'Свиток Конус льда', 'Свиток Ядовитого облака']
    .forEach(name => expect(alchemist.items.map(item => item.name)).not.toContain(name));
  const quartermaster = vendors.find(vendor => vendor.id === 'quartermaster');
  expect(quartermaster.items.map(item => item.name)).toEqual([
    'Простая ткань', 'Обрывки кожи', 'Металлические обломки', 'Простая склянка', 'Кровяной мох',
    'Походная сумка Гильдии', 'Укреплённые поножи', 'Походные сапоги',
    'Капюшон Искателя Знаков', 'Плащ Тусклого Оберега', 'Кольцо Переменчивой Искры',
    'Кольцо Тлеющего Отзвука', 'Железное Кольцо Караульного',
  ]);
  ['Простая ткань', 'Обрывки кожи', 'Металлические обломки', 'Кровяной мох'].forEach(name => {
    expect(quartermaster.items.find(item => item.name === name)?.dailyLimit).toBe(20);
  });
  expect(quartermaster.items.find(item => item.name === 'Простая склянка')?.dailyLimit).toBeUndefined();
  quartermaster.items.slice(5).forEach(item => expect(item.dailyLimit).toBeUndefined());
  ['Пепел гоблинского перца','Крысиная шкура','Лазурный мицелий','Блуждающие споры','Спора светокапа','Сумеречный вереск','Черножильная руда'].forEach(name => expect(quartermaster.items.map(item => item.name)).not.toContain(name));
  const prices = Object.fromEntries(quartermaster.items.map(item => [item.name, item.price]));
  getCraftingRecipes().filter(recipe => findItemData(recipe.name)?.type === 'consumable').forEach(recipe => {
    const ingredientPrices = recipe.ingredients.map(req => prices[req.name]);
    if (ingredientPrices.every(Number.isFinite)) {
      const cost = recipe.ingredients.reduce((sum, req) => sum + prices[req.name] * req.quantity, 0);
      expect(findItemData(recipe.name).sellPrice || 0).toBeLessThanOrEqual(cost);
    }
  });
});
