import { ITEM_DATA, findItemData } from './items';
import { FIELD_CONSUMABLES, ADDITIONAL_FIELD_RECIPES } from './fieldConsumables';

const FIELD_MEDICINE_RECIPES = [
  {
    id: 'blood_moss_poultice',
    name: 'Кровяная припарка',
    category: 'survival',
    knownByDefault: true,
    craftContext: 'dungeon',
    abyssLevel: 1,
    locationTags: ['generic', 'goblin_burrows'],
    ingredients: [
      { name: 'Кровяной мох', quantity: 1 },
      { name: 'Простая ткань', quantity: 1 },
    ],
    result: { name: 'Кровяная припарка', quantity: 1 },
    description: 'Полевая припарка для выживания между схватками. Используется вне боя: лечит 15 здоровья и даёт [Регенерацию] на 2 хода в следующем бою.',
  },
  {
    id: 'deepweave_blood_bandage',
    name: 'Кровяная повязка',
    category: 'survival',
    knownByDefault: true,
    craftContext: 'dungeon',
    abyssLevel: 2,
    locationTags: ['generic', 'level2'],
    ingredients: [
      { name: 'Глубинное полотно', quantity: 1 },
      { name: 'Кровяной мох', quantity: 1 },
    ],
    result: { name: 'Кровяная повязка', quantity: 1 },
    description: 'Полевая повязка II уровня. Используется вне боя: лечит 30 здоровья и даёт [Регенерацию] на 2 хода в следующем бою.',
  },
];

const makeRecipe = entry => ({
  ...entry,
  id: `field_${entry.id}`,
  knownByDefault: true,
  craftContext: 'dungeon',
  abyssLevel: entry.abyssLevel || 1,
  ingredients: entry.ingredients || entry.craft,
  result: { name: entry.name, quantity: 1 },
  description: entry.description || findItemData(entry.name)?.description || '',
});

export const FIELD_CRAFTING_RECIPES = [
  ...FIELD_MEDICINE_RECIPES,
  ...ITEM_DATA.filter(item => item.type === 'consumable' && item.craft?.length && !FIELD_CONSUMABLES.some(entry => entry.name === item.name))
    .map(item => makeRecipe({ ...item, id: `existing_${item.name}`, category: 'medicine' })),
  ...FIELD_CONSUMABLES.map(makeRecipe),
  ...ADDITIONAL_FIELD_RECIPES.map(makeRecipe),
];

export const getFieldCraftingRecipes = ({ abyssLevel } = {}) => {
  const level = Number(abyssLevel);
  if (!Number.isFinite(level)) return FIELD_CRAFTING_RECIPES;
  return FIELD_CRAFTING_RECIPES.filter(recipe => recipe.abyssLevel <= level);
};
