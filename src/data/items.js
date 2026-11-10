import { FIELD_CONSUMABLE_ITEM_DATA, FIELD_CONSUMABLE_COMBAT_DATA } from './fieldConsumables';
import { EFFECT_IDS } from '../utils/effects';
import { equipment } from './equipment';
import { BOSS_MATERIAL_BY_LOCATION, COMMON_LEVEL_ONE_EQUIPMENT, COMMON_LEVEL_ONE_MATERIALS, CURSED_ONLY_MATERIALS, CRAFT_ONLY_SIGNATURE_EQUIPMENT, LOCATION_LEVEL_ONE_EQUIPMENT, selectTreasureEquipmentSource } from './levelOneLootOwnership';
import { getLootOwnershipForLocation } from './lootOwnership';
import { getSublocationDefinition } from './expeditionSublocations';
import {
  COMMON_LEVEL_TWO_EQUIPMENT,
  CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
  isLevelTwoLootLocation,
  LEVEL_TWO_MATERIAL_DEFINITIONS,
  LOCATION_LEVEL_TWO_CONSUMABLES,
  LOCATION_LEVEL_TWO_EQUIPMENT,
} from './levelTwoLootOwnership';

const resolveEffectId = (name) => {
  if (!name) return null;
  return EFFECT_IDS[name] || name;
};

// Values persisted by earlier saves. Keep this list explicit: guessing from an
// unknown identifier can silently turn one real stack into a different item.
export const LEGACY_ITEM_NAMES = Object.freeze({
  'Эссенция Осквернения': 'Эссенция Проклятий',
  'Мицелий': 'Лазурный мицелий',
  'Споры': 'Блуждающие споры',
  'Астральный разлом': 'Мерцающий узел',
  'Посох Первой Искры': 'Посох Украденной Искры',
  'Жезл Тёплого Стекла': 'Жезл Закопчённого Стекла',
  'Инеевый Фокус': 'Фокус Ледяного Спора',
  'Маска Пепельного Ученика': 'Пепельная Маска Отступника',
  'Мантия Тихого Канала': 'Мантия Погасшего Костра',
  'Плащ Слабого Барьера': 'Плащ Тусклого Оберега',
  'Свиток ослабления': 'Свиток уязвимости',
  'Свиток надлома щита': 'Свиток кражи щита',
  'Свиток промедления': 'Свиток Конус льда',
  'Усиленное зелье щита': 'Защитный настой',
});

export const LEGACY_ITEM_IDS = Object.freeze({
  simple_cloth: 'Простая ткань', leather_scraps: 'Обрывки кожи', metal_fragments: 'Металлические обломки',
  rat_hide: 'Крысиная шкура', azure_mycelium: 'Лазурный мицелий', wandering_spores: 'Блуждающие споры',
  goblin_pepper_ash: 'Пепел гоблинского перца', lightcap_spore: 'Спора светокапа', shimmering_node: 'Мерцающий узел',
  broken_oath: 'Сломанная клятва', bonfire_heart: 'Сердце костра', twilight_heather: 'Сумеречный вереск', blackvein_ore: 'Черножильная руда',
  simple_flask: 'Простая склянка', blood_poultice: 'Кровяная припарка', essence_of_corruption: 'Эссенция Проклятий', silver: 'Серебро',
  minor_health_potion: 'Малое зелье здоровья', minor_defense_potion: 'Малое зелье защиты', minor_regeneration_potion: 'Малое зелье регенерации',
  minor_shield_potion: 'Малое зелье щита', minor_magic_power_potion: 'Малое зелье магической силы', minor_attack_potion: 'Малое зелье атаки',
  minor_speed_potion: 'Малое зелье скорости', minor_antimagic_potion: 'Малое зелье антимагии', minor_cleanse_potion: 'Малое зелье очищения',
  fireball_scroll: 'Свиток Огненного шара', healing_scroll: 'Свиток Лечения', blood_touch_scroll: 'Свиток Кровавого касания',
  ice_cone_scroll: 'Свиток Конус льда', poison_cloud_scroll: 'Свиток Ядовитого облака',
});
export const normalizeItemName = (name) => {
  const normalized = typeof name === 'string' ? name.trim() : name || '';
  return LEGACY_ITEM_IDS[normalized] || LEGACY_ITEM_NAMES[normalized] || normalized;
};

const normalizeCraftRequirements = (craft) => {
  if (!Array.isArray(craft)) return undefined;
  return craft
    .map(req => {
      const normalizedName = normalizeItemName(typeof req === 'string' ? req : req?.name);
      if (!normalizedName) return null;
      return { name: normalizedName, quantity: req?.quantity ?? 1 };
    })
    .filter(Boolean);
};

// Базовые материалы и расходники
const BASE_ITEM_DATA = [
  {
    name: 'Простые чернила',
    type: 'material', stackSize: 50, rarity: 'Обычная', sourceTier: 'common',
    sourceTags: ['common'], intendedUse: 'consumableCrafting',
    description: 'Простые чернила для нанесения знаков на полевые свитки I этажа.',
    chestChance: 0.3, enemyChance: 0.2, chestQuantity: { min: 2, max: 5 },
    buyPrice: 10, sellPrice: 5,
  },
  {
    name: 'Простая ткань',
    type: 'material',
    stackSize: 50,
    rarity: 'Обычная',
    sourceTier: 'common',
    sourceTags: ['common'],
    intendedUse: 'crafting',
    description: 'Ткань, нужная для крафта простых вещей.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 5 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Малое зелье здоровья',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'При применении восстанавливает 35 здоровья и расходуется.',
    chestChance: 0.2,
    enemyChance: 0.1,
    chestQuantity: { min: 1, max: 2 },
    craft: [
      { name: 'Простая склянка', quantity: 1 },
      { name: 'Кровяной мох', quantity: 2 },
    ],
    buyPrice: 100,
    sellPrice: 20,
  },
  {
    name: 'Зелье здоровья',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    sourceTier: 'common',
    sourceTags: ['level2', 'common'],
    description: 'При применении восстанавливает 65 здоровья и расходуется.',
    chestChance: 0.20,
    enemyChance: 0.10,
    chestQuantity: { min: 1, max: 2 },
  },
  {
    name: 'Настой горькой живицы',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Необычная',
    sourceTier: 'location',
    sourceTags: ['level2', 'withering_forest'],
    description: 'Следующая успешная прямая атака накладывает Отравление на 2 хода.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 2 },
  },
  {
    name: 'Настой последней весны',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Необычная',
    sourceTier: 'location',
    sourceTags: ['level2', 'withering_forest'],
    description: 'Мгновенно восстанавливает 30 здоровья, накладывает Регенерацию на 2 хода, снимает 1 Отравление и 1 Замедление или Сильное замедление. Опутывание не снимает.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 2 },
  },
  {
    name: 'Свиток цепких корней',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Необычная',
    sourceTier: 'location',
    sourceTags: ['level2', 'withering_forest'],
    description: 'Накладывает всем живым врагам 3 заряда [Опутывания] и отнимает 15% шкалы хода. Невосприимчивым к Опутыванию шкала тоже снижается.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 2 },
  },
  {
    name: 'Кровяная повязка',
    type: 'consumable',
    category: 'fieldMedicine',
    stackSize: 5,
    rarity: 'Обычная',
    sourceTier: 'common',
    sourceTags: ['level2', 'common'],
    description:
      'Можно использовать только вне боя. Восстанавливает 30 здоровья и даёт Регенерацию на 2 хода в следующем бою.',
    usableInCombat: false,
    fieldUse: {
      type: 'healAndNextCombatEffect',
      healAmount: 30,
      nextCombatEffects: [{ id: 'regeneration', duration: 2, sourceName: 'Кровяная повязка' }],
    },
  },
  {
    name: 'Кровяная припарка',
    type: 'consumable',
    category: 'fieldMedicine',
    stackSize: 5,
    rarity: 'Обычная',
    description:
      'Можно использовать только вне боя. Восстанавливает 15 здоровья и даёт Регенерацию на 2 хода в следующем бою.',
    usableInCombat: false,
    fieldUse: {
      type: 'healAndNextCombatEffect',
      healAmount: 15,
      nextCombatEffects: [{ id: 'regeneration', duration: 2, sourceName: 'Кровяная припарка' }],
    },
    buyPrice: 45,
    sellPrice: 20,
  },
  {
    name: 'Обрывки кожи',
    type: 'material',
    stackSize: 50,
    rarity: 'Обычная',
    sourceTier: 'common',
    sourceTags: ['common'],
    intendedUse: 'crafting',
    description: 'Кожа, нужная для крафта простых вещей.',
    chestChance: 0.25,
    enemyChance: 0.15,
    chestQuantity: { min: 2, max: 5 },
    buyPrice: 15,
    sellPrice: 7,
  },
  {
    name: 'Металлические обломки',
    type: 'material',
    stackSize: 50,
    rarity: 'Обычная',
    sourceTier: 'common',
    sourceTags: ['common'],
    intendedUse: 'crafting',
    description: 'Металл, нужный для крафта простых вещей.',
    chestChance: 0.25,
    enemyChance: 0.15,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 20,
    sellPrice: 10,
  },
  {
    name: 'Крысиная желчь',
    type: 'material',
    stackSize: 20,
    rarity: 'Обычная',
    sourceTier: 'faction',
    sourceTags: ['goblin', 'rat', 'alchemy'],
    intendedUse: 'future',
    description: 'Едкий реагент из норных тварей. Используется для грубых полевых заготовок.',
    chestChance: 0,
    enemyChance: 0,
    buyPrice: 8,
    sellPrice: 4,
  },
  {
    name: 'Крысиная кость',
    type: 'material',
    stackSize: 30,
    rarity: 'Обычная',
    sourceTier: 'faction',
    sourceTags: ['goblin', 'rat', 'bone'],
    intendedUse: 'future',
    description: 'Лёгкая кость из крысиных гнёзд. Подходит для простого ремесла и наживок.',
    chestChance: 0,
    enemyChance: 0,
    buyPrice: 8,
    sellPrice: 4,
  },
  {
    name: 'Малое зелье защиты',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Накладывает Укрепление на 2 хода.',
    chestChance: 0.18,
    enemyChance: 0.08,
    chestQuantity: { min: 1, max: 2 },
    buyPrice: 84,
    sellPrice: 35,
  },
  {
    name: 'Малое зелье регенерации',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Накладывает регенерацию на 2 хода и тратится.',
    chestChance: 0.18,
    enemyChance: 0.08,
    chestQuantity: { min: 1, max: 2 },
    craft: [
      { name: 'Простая склянка', quantity: 1 },
      { name: 'Кровяной мох', quantity: 1 },
      { name: 'Слизь мохоспора', quantity: 1 },
    ],
    buyPrice: 105,
    sellPrice: 40,
  },
  {
    name: 'Малое зелье атаки',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Временно увеличивает силу атаки цели.',
    chestChance: 0.2,
    enemyChance: 0.1,
    chestQuantity: { min: 1, max: 2 },
    craft: [
      { name: 'Простая склянка', quantity: 1 },
      { name: 'Пепел гоблинского перца', quantity: 1 },
      { name: 'Кровяной мох', quantity: 1 },
    ],
    buyPrice: 84,
    sellPrice: 35,
  },
  {
    name: 'Малое зелье щита',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Накладывает щит силой 30 единиц на 2 хода.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 2 },
    craft: [
      { name: 'Простая склянка', quantity: 1 },
      { name: 'Сумеречный вереск', quantity: 2 },
    ],
    buyPrice: 126,
    sellPrice: 45,
  },
  {
    name: 'Малое зелье магической силы',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Повышает магическую силу цели на 2 хода.',
    chestChance: 0.18,
    enemyChance: 0.08,
    chestQuantity: { min: 1, max: 2 },
    craft: [
      { name: 'Простая склянка', quantity: 1 },
      { name: 'Пыльца серого спорника', quantity: 1 },
      { name: 'Блуждающие споры', quantity: 1 },
    ],
    buyPrice: 98,
    sellPrice: 40,
  },
  {
    name: 'Малое зелье скорости',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Дает Ускорение на 2 хода.',
    chestChance: 0.18,
    enemyChance: 0.08,
    chestQuantity: { min: 1, max: 2 },
    buyPrice: 91,
    sellPrice: 40,
  },
  {
    name: 'Малое зелье антимагии',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Накладывает Оберег на 2 хода.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 2 },
    buyPrice: 98,
    sellPrice: 40,
  },
  {
    name: 'Малое зелье очищения',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Снимает один случайный тип отрицательного эффекта со всеми его зарядами.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 140,
    sellPrice: 50,
  },
  {
    name: 'Свиток Огненного шара',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Наносит 120% большей из ФА и МА всем врагам; выбранный дополнительно получает [Горение] на 2 хода.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 80,
    sellPrice: 40,
  },
  {
    name: 'Свиток Ядовитого облака',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Наносит 50% большей из ФА и МА всем врагам и накладывает по одному [Отравлению] на 2 хода. Урон самого Отравления зависит от ФА.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 90,
    sellPrice: 45,
  },
  {
    name: 'Свиток Лечения',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Восстанавливает 40% максимального здоровья героя и накладывает [Регенерацию] на 2 хода.',
    chestChance: 0.15,
    enemyChance: 0.05,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 100,
    sellPrice: 60,
  },
  {
    name: 'Свиток Конус льда',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Наносит 50% большей из ФА и МА основной цели, отнимает 30% шкалы хода и даёт [Сильное замедление] на 2 хода. Остальным наносит 25%, отнимает 15% шкалы хода и даёт [Замедление] на 2 хода.',
    chestChance: 0.1,
    enemyChance: 0.03,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 120,
    sellPrice: 70,
  },
  {
    name: 'Свиток Кровавого касания',
    type: 'consumable',
    stackSize: 5,
    rarity: 'Обычная',
    description: 'Накладывает [Метку вампира] на 2 хода, затем наносит 150% большей из ФА и МА и накладывает [Кровотечение] на 1 ход. Лечение по метке срабатывает уже от первого удара.',
    chestChance: 0.1,
    enemyChance: 0.03,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 150,
    sellPrice: 90,
  },
  {
    name: 'Свиток Развеивания',
    type: 'consumable', stackSize: 5, rarity: 'Необычная',
    sourceTier: 'location', sourceTags: ['level2', 'restless_ruins'],
    description: 'Снимает все снимаемые положительные эффекты с одного выбранного противника, включая Перерождение. Не снимает Неупокоенность.',
    chestChance: 0.1, enemyChance: 0.05, chestQuantity: { min: 1, max: 1 },
  },
  {
    name: 'Эссенция Проклятий',
    legacyNames: ['Эссенция Осквернения'],
    type: 'material',
    sourceTier: 'rareCatalyst',
    intendedUse: 'crafting',
    rarity: 'Редкая',
    stackSize: 50,
    description: 'Эссенция для крафта проклятых предметов и рун.',
    chestChance: 0,
    enemyChance: 0.2,
    chestQuantity: { min: 1, max: 2 },
  },
  {
    name: 'Серебро',
    type: 'currency',
    rarity: 'Обычная',
    description: 'Основная валюта Гильдии.',
    chestChance: 1,
    enemyChance: 1,
    chestQuantity: { min: 20, max: 60 },
  },
  {
    name: 'Крысиная шкура нор',
    type: 'material',
    stackSize: 50,
    sourceTier: 'faction',
    sourceTags: ['goblin', 'rat'],
    intendedUse: 'future',
    // TODO(economy): consider merging this with 'Крысиная шкура' once rat-hide recipes are clarified.
    description: 'Шкура крупных крыс из нор, используется в крафте брони.',
    chestChance: 0.25,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 12,
    sellPrice: 6,
  },
  {
    name: 'Крысиная шкура',
    type: 'material',
    stackSize: 50,
    sourceTier: 'faction',
    sourceTags: ['goblin', 'rat'],
    intendedUse: 'equipmentCrafting',
    description: 'Обычная крысиная шкура, подходит для простых щитов.',
    chestChance: 0.25,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Лазурный мицелий',
    legacyNames: ['Мицелий'],
    type: 'material',
    stackSize: 50,
    sourceTier: 'location',
    sourceTags: ['fungal', 'cave'],
    intendedUse: 'equipmentCrafting',
    description: 'Нити грибного мицелия, нужные для ритуальных тканей.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 5 },
    buyPrice: 12,
    sellPrice: 6,
  },
  {
    name: 'Блуждающие споры',
    legacyNames: ['Споры'],
    type: 'material',
    stackSize: 50,
    sourceTier: 'location',
    sourceTags: ['fungal', 'cave'],
    intendedUse: 'consumableCrafting',
    description: 'Свежие споры грибов, используются в светящихся артефактах.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 5 },
    buyPrice: 12,
    sellPrice: 6,
  },
  {
    name: 'Простая склянка',
    type: 'material',
    stackSize: 10,
    sourceTier: 'common',
    sourceTags: ['common', 'alchemy'],
    intendedUse: 'consumableCrafting',
    description: 'Ингредиент для приготовления зелий.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Кровяной мох',
    type: 'material',
    stackSize: 10,
    sourceTier: 'common',
    sourceTags: ['common', 'healing', 'medicine'],
    intendedUse: 'consumableCrafting',
    description: 'Компонент для Малого зелья здоровья.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Пыль костяной корки',
    type: 'material',
    stackSize: 10,
    sourceTier: 'location',
    sourceTags: ['fungal', 'cave', 'chitin'],
    intendedUse: 'consumableCrafting',
    description: 'Компонент для Малого зелья защиты.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Слизь мохоспора',
    type: 'material',
    stackSize: 10,
    sourceTier: 'location',
    sourceTags: ['fungal', 'cave', 'medicine'],
    intendedUse: 'consumableCrafting',
    description: 'Компонент для зелий регенерации.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Пепел гоблинского перца',
    type: 'material',
    stackSize: 10,
    sourceTier: 'location',
    sourceTags: ['goblin', 'cave', 'alchemy'],
    intendedUse: 'crafting',
    description: 'Компонент для атакующих зелий.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Пыль обсидиановой скорлупы',
    type: 'material',
    stackSize: 10,
    description: 'Компонент для зелий щита.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Спора светокапа',
    type: 'material',
    stackSize: 10,
    sourceTier: 'location',
    sourceTags: ['fungal', 'cave', 'magic'],
    intendedUse: 'runeCrafting',
    description: 'Компонент для зелий магической силы.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Мерцающий узел',
    legacyNames: ['Астральный разлом'],
    type: 'material',
    stackSize: 10,
    rarity: 'Редкая',
    sourceTier: 'rareCatalyst',
    sourceTags: ['fungal', 'boss', 'astral', 'cave'],
    intendedUse: 'bossCrafting',
    description: 'Редкий катализатор из сердца Троглодита-мицелия. Зарезервирован для будущих рун и прогрессии.',
    chestChance: 0,
    enemyChance: 0,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 0,
    sellPrice: 90,
  },
  {
    name: 'Сломанная клятва',
    type: 'material',
    stackSize: 10,
    rarity: 'Редкая',
    sourceTier: 'rareCatalyst',
    sourceTags: ['deserter', 'boss', 'guild', 'oath', 'blade'],
    intendedUse: 'bossCrafting',
    description: 'Редкий катализатор Мастера клинков: обломок клятвы тех, кто спустился под знаменем Гильдии и не вернулся верным.',
    chestChance: 0,
    enemyChance: 0,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 0,
    sellPrice: 95,
  },
  {
    name: 'Сердце костра', type: 'material', stackSize: 10, rarity: 'Редкая',
    sourceTier: 'rareCatalyst', sourceTags: ['goblin', 'boss'], intendedUse: 'bossCrafting',
    description: 'Пылающее сердце Рагшнара — основа уникального ремесла.', chestChance: 0, enemyChance: 0, sellPrice: 60,
  },
  {
    name: 'Сумеречный вереск', type: 'material', stackSize: 20, rarity: 'Обычная',
    sourceTier: 'location', sourceTags: ['deserter'], intendedUse: 'crafting',
    description: 'Жёсткий вереск из лагеря отступников.', chestChance: 0, enemyChance: 0, sellPrice: 6,
  },
  {
    name: 'Черножильная руда', type: 'material', stackSize: 20, rarity: 'Необычная',
    sourceTier: 'location', sourceTags: ['deserter'], intendedUse: 'crafting',
    description: 'Тёмная руда из разбитых оружейных запасов.', chestChance: 0, enemyChance: 0, sellPrice: 10,
  },
  {
    name: 'Жало пещерного сверчка',
    type: 'material',
    stackSize: 10,
    description: 'Компонент для зелий скорости.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
  {
    name: 'Пыльца серого спорника',
    type: 'material',
    stackSize: 10,
    sourceTier: 'location',
    sourceTags: ['fungal', 'cave', 'antimagic'],
    intendedUse: 'consumableCrafting',
    description: 'Компонент для зелий антимагии.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },

  {
    name: 'Костяная удочка',
    type: 'fishingRod',
    stackSize: 1,
    rarity: 'Необычная',
    description: 'Надёжная удочка, помогающая контролировать натяжение лески в рыболовных комнатах.',
    chestChance: 0.08,
    enemyChance: 0,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 120,
    sellPrice: 70,
  },
  {
    name: 'Жезл глубинного лова',
    type: 'fishingRod',
    stackSize: 1,
    rarity: 'Редкая',
    description: 'Усиленная удочка для сложного улова в Бездне.',
    chestChance: 0.04,
    enemyChance: 0,
    chestQuantity: { min: 1, max: 1 },
    buyPrice: 240,
    sellPrice: 140,
  },
  {
    name: 'Светлячный мотыль',
    type: 'bait',
    stackSize: 20,
    rarity: 'Обычная',
    description: 'Светящаяся наживка для большинства подземных водоёмов.',
    chestChance: 0.14,
    enemyChance: 0.08,
    chestQuantity: { min: 2, max: 5 },
    buyPrice: 18,
    sellPrice: 9,
  },
  {
    name: 'Споровая наживка',
    type: 'bait',
    stackSize: 20,
    rarity: 'Необычная',
    sourceTier: 'location',
    sourceTags: ['fungal', 'fishing'],
    intendedUse: 'fishing',
    description: 'Наживка из спор, особенно эффективна в грибных пещерах.',
    chestChance: 0.1,
    enemyChance: 0.06,
    chestQuantity: { min: 1, max: 4 },
    buyPrice: 30,
    sellPrice: 14,
  },
  {
    name: 'Сумрачный пескарь',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Обычная',
    description: 'Фэнтезийная рыба из тёмных нор. Нужна торговцам и алхимикам.',
    buyPrice: 36,
    sellPrice: 18,
  },
  {
    name: 'Пещерный зубочист',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Обычная',
    description: 'Длиннорылая рыба с кристальными зубцами.',
    buyPrice: 44,
    sellPrice: 22,
  },
  {
    name: 'Шипохвост нор',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Необычная',
    description: 'Редкая хищная рыба с колючим хвостом.',
    buyPrice: 56,
    sellPrice: 28,
  },
  {
    name: 'Ржавожаберный шептун',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Редкая',
    description: 'Уникальный улов Гоблинских Нор.',
    buyPrice: 72,
    sellPrice: 36,
  },
  {
    name: 'Крысожор-плесень',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Редкая',
    description: 'Хищная рыба-паразит, ценится алхимиками.',
    buyPrice: 96,
    sellPrice: 48,
  },
  {
    name: 'Светокаповая минога',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Обычная',
    description: 'Светящаяся рыба из грибных подводных озёр.',
    buyPrice: 40,
    sellPrice: 20,
  },
  {
    name: 'Спороплав',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Необычная',
    description: 'Питается спорами и оставляет люминесцентный след.',
    buyPrice: 60,
    sellPrice: 30,
  },
  {
    name: 'Мохожор-стеклянник',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Необычная',
    description: 'Полупрозрачный хищник пещерных омутов.',
    buyPrice: 68,
    sellPrice: 34,
  },
  {
    name: 'Мицелийный скат',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Редкая',
    description: 'Уникальная рыба Грибных Пещер с биолюминесцентными плавниками.',
    buyPrice: 104,
    sellPrice: 52,
  },
  {
    name: 'Троглодонный призрак',
    type: 'fish',
    intendedUse: 'sellOnly',
    stackSize: 20,
    rarity: 'Редкая',
    description: 'Легендарный призрачный улов глубинных резервуаров.',
    buyPrice: 116,
    sellPrice: 58,
  },
  {
    name: 'Капля рассветной росы',
    type: 'material',
    stackSize: 10,
    description: 'Компонент для зелий очищения.',
    chestChance: 0.3,
    enemyChance: 0.2,
    chestQuantity: { min: 2, max: 4 },
    buyPrice: 10,
    sellPrice: 5,
  },
];

const EQUIPMENT_META = {
  'Укреплённые поножи': { buyPrice: 120 },
  'Походные сапоги': { chestChance: 0.15, buyPrice: 120 },
  'Крысиные обмотки': { chestChance: 0.12, enemyChance: 0.06, buyPrice: 170 },
  'Сапоги перебежчика': { chestChance: 0.12, enemyChance: 0.06, buyPrice: 180 },
  'Походная сумка Гильдии': { buyPrice: 200 },

  'Щит Новобранца': {},
  'Амулет Крысиной Жилы': {
    chestChance: 0.1, sourceTier: 'location', sourceTags: ['goblin', 'rat', 'archer', 'bleed'], intendedUse: 'goblinBleedEquipment',
  },
  'Полевой гримуар Отступника': {
    chestChance: 0.1, sourceTier: 'location', sourceTags: ['deserter', 'elementalist', 'magic'], intendedUse: 'deserterMagicEquipment',
  },

  // Early Archer equipment. Keep source tags explicit so these do not become Mushroom-native rewards.
  'Натянутый охотничий лук': {
    chestChance: 0.14,
    buyPrice: 120,
    sourceTier: 'earlyEquipment',
    sourceTags: ['archer', 'ranged', 'early', 'martial', 'light', 'scout', 'generic'],
    intendedUse: 'earlyArcherEquipment',
  },
  'Капюшон Следопыта': {
    chestChance: 0.12,
    buyPrice: 140,
    sourceTier: 'earlyEquipment',
    sourceTags: ['archer', 'ranged', 'early', 'martial', 'light', 'scout', 'deserter'],
    intendedUse: 'earlyArcherEquipment',
  },
  'Плащ разведчика': {
    chestChance: 0.12,
    buyPrice: 130,
    sourceTier: 'earlyEquipment',
    sourceTags: ['archer', 'ranged', 'early', 'martial', 'light', 'scout', 'generic'],
    intendedUse: 'earlyArcherEquipment',
    craft: [
      { name: 'Сумеречный вереск', quantity: 3 },
      { name: 'Простая ткань', quantity: 3 },
      { name: 'Обрывки кожи', quantity: 2 },
    ],
  },
  'Кольцо Меткой Тетивы': {
    chestChance: 0.1,
    buyPrice: 150,
    sourceTier: 'earlyEquipment',
    sourceTags: ['archer', 'ranged', 'early', 'martial', 'light', 'scout', 'deserter'],
    intendedUse: 'earlyArcherEquipment',
  },
  'Лук Спороносца': {
    chestChance: 0.12,
    buyPrice: 170,
    sourceTier: 'location',
    sourceTags: ['fungal', 'mushroom', 'archer', 'ranged', 'early', 'weapon'],
    intendedUse: 'mushroomArcherEquipment',
    craft: [{ name: 'Лазурный мицелий', quantity: 3 }, { name: 'Блуждающие споры', quantity: 2 }, { name: 'Обрывки кожи', quantity: 2 }],
  },


  // TODO(economy): split Deserter/Guild-themed gear into faction/location chest and vendor pools.
  // Universal early magical equipment
  'Посох Украденной Искры': { chestChance: 0.12, buyPrice: 180, craft: [{ name: 'Металлические обломки', quantity: 3 }, { name: 'Пепел гоблинского перца', quantity: 2 }] },
  'Жезл Закопчённого Стекла': { chestChance: 0.12, buyPrice: 180 },
  'Фокус Ледяного Спора': { chestChance: 0.12, buyPrice: 180 },
  'Молот Спорового Стража': {
    chestChance: 0.12,
    buyPrice: 170,
    sourceTier: 'location',
    sourceTags: ['fungal', 'mushroom', 'defender', 'martial', 'early', 'weapon'],
    intendedUse: 'mushroomDefenderEquipment',
  },
  'Капюшон Искателя Знаков': { chestChance: 0.12, buyPrice: 150 },
  'Пепельная Маска Отступника': { chestChance: 0.12, buyPrice: 150 },
  'Мантия Погасшего Костра': { chestChance: 0.12, buyPrice: 160 },
  'Плащ Тусклого Оберега': { chestChance: 0.12, buyPrice: 150 },
  'Кольцо Переменчивой Искры': { chestChance: 0.12, buyPrice: 150 },
  'Кольцо Тлеющего Отзвука': { chestChance: 0.12, buyPrice: 160 },
  'Амулет Трёх Искр': { chestChance: 0.1, buyPrice: 240 },

  // Curated Level 1 equipment
  'Красный Колпак Старшего Крысолова': { chestChance: 0.15, enemyChance: 0.07, buyPrice: 150 },
  'Грибная Маска Споровика': { chestChance: 0.15, enemyChance: 0.07, buyPrice: 150 },
  'Куртка Мародёра': { chestChance: 0.15, enemyChance: 0.07, buyPrice: 150 },
  'Хитиновый Панцирь Мясного Жука': { chestChance: 0.15, enemyChance: 0.07, buyPrice: 150 },
  'Щит Дозорного Гильдии': { chestChance: 0.15, enemyChance: 0.07, buyPrice: 150 },
  'Шипастый Щит Нор': {
    chestChance: 0,
    craft: [
      { name: 'Крысиная шкура', quantity: 6 },
      { name: 'Обрывки кожи', quantity: 6 },
      { name: 'Металлические обломки', quantity: 2 },
    ],
    buyPrice: 150,
  },
  'Тесак Гоблинского Мясника': { chestChance: 0.15, enemyChance: 0.07, buyPrice: 150 },
  'Булава Старого Сотника': { chestChance: 0.15, enemyChance: 0.07, buyPrice: 160, craft: [{ name: 'Черножильная руда', quantity: 3 }, { name: 'Металлические обломки', quantity: 3 }, { name: 'Обрывки кожи', quantity: 1 }] },
  'Алебарда Пограничного Дозора': { chestChance: 0.12, enemyChance: 0.05, buyPrice: 220 },
  'Кольцо Туманного Мха': {
    chestChance: 0.12,
    buyPrice: 150,
  },
  'Венец блуждающих спор': { craft: [{ name: 'Лазурный мицелий', quantity: 3 }, { name: 'Спора светокапа', quantity: 2 }] },
  'Накидка Красного Костра': { craft: [{ name: 'Сердце костра', quantity: 1 }, { name: 'Пепел гоблинского перца', quantity: 3 }, { name: 'Простая ткань', quantity: 3 }] },
  'Мерцающая оболочка': { craft: [{ name: 'Мерцающий узел', quantity: 1 }, { name: 'Лазурный мицелий', quantity: 3 }, { name: 'Обрывки кожи', quantity: 2 }] },
  'Клятвопреступник': { craft: [{ name: 'Сломанная клятва', quantity: 1 }, { name: 'Черножильная руда', quantity: 3 }, { name: 'Металлические обломки', quantity: 2 }] },
  'Железное Кольцо Караульного': { chestChance: 0.15, enemyChance: 0.07, buyPrice: 150 },
  'Амулет Ветерана Бездны': { chestChance: 0.1, enemyChance: 0.1, buyPrice: 300 },

  // Abyss Level 2 guild crafting
  'Амулет цепкой живицы': {
    sourceTier: 'craftOnly',
    sourceTags: ['level2', 'withering_forest', 'craft_only'],
    craft: [
      { name: 'Чёрная сердцевина', quantity: 3 },
      { name: 'Горькая живица', quantity: 5 },
      { name: 'Глубинное полотно', quantity: 3 },
    ],
  },
  'Зеркало третьего голоса': {
    sourceTier: 'craftOnly',
    sourceTags: ['level2', 'restless_ruins', 'craft_only'],
    craft: [
      { name: 'Эфирный прах', quantity: 6 },
      { name: 'Сумрачный сплав', quantity: 4 },
      { name: 'Глубинное полотно', quantity: 3 },
    ],
  },
  'Щит тлеющей жилы': {
    sourceTier: 'craftOnly',
    sourceTags: ['level2', 'mines_of_decay', 'craft_only'],
    craft: [
      { name: 'Тлеющий шлак', quantity: 6 },
      { name: 'Сумрачный сплав', quantity: 5 },
      { name: 'Выделанная кожа Бездны', quantity: 2 },
    ],
  },
  'Лук последнего цветения': {
    craft: [
      { name: 'Ветвь Архонта', quantity: 1 },
      { name: 'Выделанная кожа Бездны', quantity: 3 },
      { name: 'Горькая живица', quantity: 4 },
      { name: 'Цветок последней весны', quantity: 2 },
    ],
  },
  'Амулет последнего отзвука': {
    craft: [
      { name: 'Эфирная кость', quantity: 1 },
      { name: 'Глубинное полотно', quantity: 4 },
      { name: 'Выделанная кожа Бездны', quantity: 3 },
      { name: 'Сумрачный сплав', quantity: 2 },
    ],
  },
  'Посох выжженной памяти': {
    craft: [
      { name: 'Тлеющий рог', quantity: 1 },
      { name: 'Сумрачный сплав', quantity: 4 },
      { name: 'Глубинное полотно', quantity: 3 },
      { name: 'Выделанная кожа Бездны', quantity: 2 },
    ],
  },
  'Шлем глубинного дозора': {
    craft: [
      { name: 'Сумрачный сплав', quantity: 2 },
      { name: 'Глубинное полотно', quantity: 2 },
    ],
  },
  'Кираса глубинного дозора': {
    craft: [
      { name: 'Сумрачный сплав', quantity: 3 },
      { name: 'Выделанная кожа Бездны', quantity: 2 },
      { name: 'Глубинное полотно', quantity: 1 },
    ],
  },
  'Сапоги глубинного дозора': {
    craft: [
      { name: 'Сумрачный сплав', quantity: 1 },
      { name: 'Выделанная кожа Бездны', quantity: 2 },
      { name: 'Глубинное полотно', quantity: 1 },
    ],
  },
};
const EQUIPMENT_ITEM_DATA = equipment.map(item => {
  const meta = EQUIPMENT_META[item.name] || {};
  return {
    name: normalizeItemName(item.name),
    type: 'equipment',
    rarity: item.rarity,
    description: item.description,
    stackSize: 1,
    chestChance: meta.chestChance ?? 0,
    enemyChance: meta.enemyChance ?? 0,
    chestQuantity: meta.chestQuantity,
    craft: normalizeCraftRequirements(meta.craft),
    buyPrice: meta.buyPrice,
    sellPrice: meta.sellPrice,
    sourceTier: meta.sourceTier,
    sourceTags: meta.sourceTags,
    intendedUse: meta.intendedUse,
    equipmentType: item.type,
    ...(item.bagCapacity ? { bagCapacity: item.bagCapacity } : {}),
    ...(item.inventorySlotBonuses ? { inventorySlotBonuses: { ...item.inventorySlotBonuses } } : {}),
    legacyNames: item.legacyNames || [],
    ...(item.weaponType ? { weaponType: item.weaponType } : {}),
    ...(item.hands ? { hands: item.hands } : {}),
    ...(item.smartLootTags ? { smartLootTags: item.smartLootTags } : {}),
  };
});

const RAW_ITEM_DATA = [...FIELD_CONSUMABLE_ITEM_DATA, ...BASE_ITEM_DATA, ...LEVEL_TWO_MATERIAL_DEFINITIONS, ...EQUIPMENT_ITEM_DATA];

export const ITEM_DATA = RAW_ITEM_DATA.map(item => ({
  ...item,
  name: normalizeItemName(item.name),
  craft: normalizeCraftRequirements(item.craft),
}));

const genericChestMaterialNames = new Set(COMMON_LEVEL_ONE_MATERIALS);
const genericChestEquipmentNames = new Set(COMMON_LEVEL_ONE_EQUIPMENT);
const genericChestForbiddenNames = new Set([...CURSED_ONLY_MATERIALS, ...Object.values(BOSS_MATERIAL_BY_LOCATION)]);
const CHEST_ITEMS = ITEM_DATA
  .filter(item => (item.chestChance ?? 0) > 0)
  .filter(item => !genericChestForbiddenNames.has(item.name))
  .filter(item => item.type !== 'material' || genericChestMaterialNames.has(item.name))
  .filter(item => item.type !== 'equipment' || genericChestEquipmentNames.has(item.name));

export const GENERIC_EARLY_TREASURE_NAMES = [
  'Серебро',
  'Малое зелье здоровья',
  'Малое зелье защиты',
  'Малое зелье регенерации',
  'Малое зелье атаки',
  'Малое зелье щита',
  'Малое зелье магической силы',
  'Малое зелье скорости',
  'Малое зелье очищения',
  'Малое зелье антимагии',
  'Свиток Огненного шара',
  'Свиток Лечения',
  'Свиток Конус льда',
  'Свиток Ядовитого облака',
  'Свиток Кровавого касания',
];

export const LEVEL_TWO_GENERIC_TREASURE_NAMES = Object.freeze([
  ...GENERIC_EARLY_TREASURE_NAMES.map(name => (
    name === 'Малое зелье здоровья'
      ? 'Зелье здоровья'
      : name === 'Малое зелье щита'
        ? 'Защитный настой'
        : name
  )),
  'Очищающий состав',
]);

export const CLASS_EARLY_TREASURE_EQUIPMENT_NAMES = [...COMMON_LEVEL_ONE_EQUIPMENT];

const craftOnlyEquipment = new Set(CRAFT_ONLY_SIGNATURE_EQUIPMENT);
const levelTwoCraftOnlyEquipment = new Set(CRAFT_ONLY_LEVEL_TWO_EQUIPMENT);
const levelTwoTreasureEquipment = new Set([
  ...COMMON_LEVEL_TWO_EQUIPMENT,
  ...Object.values(LOCATION_LEVEL_TWO_EQUIPMENT).flat(),
]);
const LEVEL_TWO_TREASURE_BASE_WEIGHTS = Object.freeze({
  'Необычная': 0.12,
  'Редкая': 0.08,
});
export const GOBLIN_TREASURE_EQUIPMENT_NAMES = LOCATION_LEVEL_ONE_EQUIPMENT['Гоблинские Норы']
  .filter(name => !craftOnlyEquipment.has(name));
export const FUNGAL_TREASURE_EQUIPMENT_NAMES = LOCATION_LEVEL_ONE_EQUIPMENT['Грибные Пещеры']
  .filter(name => !craftOnlyEquipment.has(name));
export const DESERTER_TREASURE_EQUIPMENT_NAMES = LOCATION_LEVEL_ONE_EQUIPMENT['Лагерь Отступников']
  .filter(name => !craftOnlyEquipment.has(name));

const TREASURE_EXCLUDED_NAMES = new Set([
  'Мерцающий узел',
  'Сломанная клятва',
  'Эссенция Проклятий',
]);

const TREASURE_POOL_NAMES_BY_LOCATION = {
  'Гоблинские Норы': [
    ...GENERIC_EARLY_TREASURE_NAMES,
    ...CLASS_EARLY_TREASURE_EQUIPMENT_NAMES,
    ...GOBLIN_TREASURE_EQUIPMENT_NAMES,
  ],
  'Грибные Пещеры': [
    ...GENERIC_EARLY_TREASURE_NAMES,
    ...CLASS_EARLY_TREASURE_EQUIPMENT_NAMES,
    ...FUNGAL_TREASURE_EQUIPMENT_NAMES,
  ],
  'Лагерь Отступников': [
    ...GENERIC_EARLY_TREASURE_NAMES,
    ...CLASS_EARLY_TREASURE_EQUIPMENT_NAMES,
    ...DESERTER_TREASURE_EQUIPMENT_NAMES,
  ],
};

const GENERIC_TREASURE_POOL_NAMES = [
  ...GENERIC_EARLY_TREASURE_NAMES,
  ...CLASS_EARLY_TREASURE_EQUIPMENT_NAMES,
];

const TREASURE_ITEMS_BY_NAME = new Map(ITEM_DATA.map(item => [item.name, item]));

const buildTreasurePool = (names) => names
  .map(name => TREASURE_ITEMS_BY_NAME.get(normalizeItemName(name)))
  .filter(Boolean)
  .filter(item => (item.chestChance ?? 0) > 0 || levelTwoTreasureEquipment.has(item.name))
  .filter(item => !TREASURE_EXCLUDED_NAMES.has(item.name))
  .filter(item => item.sourceTier !== 'rareCatalyst')
  .filter(item => !['bait', 'fish'].includes(item.type))
  .filter(item => item.type !== 'material');

export const TREASURE_POOLS = {
  GENERIC_EARLY_TREASURE: buildTreasurePool(GENERIC_EARLY_TREASURE_NAMES),
  CLASS_EARLY_TREASURE_EQUIPMENT: buildTreasurePool(CLASS_EARLY_TREASURE_EQUIPMENT_NAMES),
  GOBLIN_TREASURE_EQUIPMENT: buildTreasurePool(GOBLIN_TREASURE_EQUIPMENT_NAMES),
  FUNGAL_TREASURE_EQUIPMENT: buildTreasurePool(FUNGAL_TREASURE_EQUIPMENT_NAMES),
  DESERTER_TREASURE_EQUIPMENT: buildTreasurePool(DESERTER_TREASURE_EQUIPMENT_NAMES),
};

const getTreasurePoolForLocation = (locationName = null) => {
  if (isLevelTwoLootLocation(locationName)) {
    return buildTreasurePool([
      ...LEVEL_TWO_GENERIC_TREASURE_NAMES,
      ...(LOCATION_LEVEL_TWO_CONSUMABLES[locationName] || []),
      ...COMMON_LEVEL_TWO_EQUIPMENT,
      ...(LOCATION_LEVEL_TWO_EQUIPMENT[locationName] || []),
    ]);
  }
  const poolNames = TREASURE_POOL_NAMES_BY_LOCATION[locationName] || GENERIC_TREASURE_POOL_NAMES;
  return buildTreasurePool(poolNames);
};

export const getTreasurePoolNamesForLocation = (locationName = null) =>
  getTreasurePoolForLocation(locationName).map(item => item.name);

export const getTreasureEquipmentPoolsForLocation = (locationName = null) => {
  if (isLevelTwoLootLocation(locationName)) {
    return {
      common: buildTreasurePool(COMMON_LEVEL_TWO_EQUIPMENT)
        .filter(item => !levelTwoCraftOnlyEquipment.has(item.name)),
      location: buildTreasurePool(LOCATION_LEVEL_TWO_EQUIPMENT[locationName] || [])
        .filter(item => !levelTwoCraftOnlyEquipment.has(item.name)),
    };
  }
  return {
    common: buildTreasurePool(COMMON_LEVEL_ONE_EQUIPMENT),
    location: buildTreasurePool(LOCATION_LEVEL_ONE_EQUIPMENT[locationName] || [])
      .filter(item => !craftOnlyEquipment.has(item.name)),
  };
};

const FUNGAL_NATIVE_TREASURE_NAMES = new Set([
  'Лазурный мицелий',
  'Блуждающие споры',
  'Спора светокапа',
  'Пыльца серого спорника',
  'Пыль костяной корки',
  'Хитиновый Панцирь Мясного Жука',
  'Грибная Маска Споровика',
  'Кольцо Туманного Мха',
  'Фокус Ледяного Спора',
]);

const isTreasureAllowedForLocation = (item, locationName = null) => {
  if (!getTreasurePoolNamesForLocation(locationName).includes(item.name)) return false;
  if (locationName === 'Гоблинские Норы') {
    if (FUNGAL_NATIVE_TREASURE_NAMES.has(item.name)) return false;
    if (item.sourceTier === 'location' && item.sourceTags?.includes('fungal')) return false;
  }
  return true;
};

export const getExpeditionTreasureWeightMultiplier = (
  item,
  {
    expeditionZone = null,
    locationName = null,
    sublocationId = null,
  } = {}
) => {
  let multiplier = 1;
  if (expeditionZone === 'sublocation') {
    if (item.sourceTier === 'location') multiplier *= 1.25;
    if (item.sourceTier === 'common') multiplier *= 0.85;
    const definition = getSublocationDefinition(locationName, sublocationId);
    const name = String(item?.name || '').toLowerCase();
    if (definition?.lootKeywords?.some(keyword => name.includes(String(keyword).toLowerCase()))) {
      multiplier *= 2;
    }
  } else if (expeditionZone === 'depth') {
    if (item.type === 'equipment') multiplier *= 1.4;
    if (item.sourceTier === 'rareCatalyst') multiplier *= 1.6;
    if (item.sourceTier === 'location') multiplier *= 1.3;
    if (item.sourceTier === 'common') multiplier *= 0.7;
  }
  return multiplier;
};

const getTreasureWeight = (item, options = {}) => {
  const baseWeight = item.chestChance
    || (levelTwoTreasureEquipment.has(item.name) ? LEVEL_TWO_TREASURE_BASE_WEIGHTS[item.rarity] || 0.08 : 0);
  let weight = baseWeight;
  if (item.type === 'equipment') weight *= 2.5;
  else if (item.sourceTier === 'rareCatalyst') weight *= 3;
  else if (item.type === 'material') weight *= 0.35;
  else if (item.type === 'currency') weight *= 1.4;
  return weight * getExpeditionTreasureWeightMultiplier(item, options);
};

// Legacy generic chest roll for non-Treasure callers; Treasure rooms use rollTreasureLoot(location).
export function rollChestLoot(minCount = 2, maxCount = 3, options = {}) {
  const rng = options.rng || Math.random;
  const count = Math.floor(rng() * (maxCount - minCount + 1)) + minCount;
  const available = [...CHEST_ITEMS];
  const loot = [];

  for (let i = 0; i < count && available.length > 0; i += 1) {
    const totalWeight = available.reduce((sum, item) => sum + (item.chestChance || 0), 0);
    if (totalWeight <= 0) break;
    let roll = rng() * totalWeight;
    let selectedIndex = 0;
    for (let j = 0; j < available.length; j += 1) {
      roll -= available[j].chestChance || 0;
      if (roll <= 0) {
        selectedIndex = j;
        break;
      }
    }
    const selected = available.splice(selectedIndex, 1)[0];
    if (!selected) continue;
    const quantityRange = selected.chestQuantity || { min: 1, max: 1 };
    const quantity = Math.max(
      quantityRange.min ?? 1,
      Math.round(
        quantityRange.min + rng() * ((quantityRange.max ?? quantityRange.min) - (quantityRange.min ?? 1))
      )
    );
    loot.push({ name: normalizeItemName(selected.name), quantity });
  }

  const primordial = getLootOwnershipForLocation(options.locationName).rollPrimordial('chest', rng);
  if (primordial) loot.push(primordial);
  return loot;
}

export function rollTreasureLoot(locationOrMinCount = null, maybeMinCount = 2, maybeMaxCount = 3, options = {}) {
  const locationName = typeof locationOrMinCount === 'string' ? locationOrMinCount : null;
  const minCount = typeof locationOrMinCount === 'number' ? locationOrMinCount : maybeMinCount;
  const maxCount = typeof locationOrMinCount === 'number' ? maybeMinCount : maybeMaxCount;
  const rng = options.rng || Math.random;
  const count = Math.floor(rng() * (maxCount - minCount + 1)) + minCount;
  const available = getTreasurePoolForLocation(locationName)
    .filter(item => isTreasureAllowedForLocation(item, locationName));
  const loot = [];

  for (let i = 0; i < count && available.length > 0; i += 1) {
    const nonEquipment = available.filter(item => item.type !== 'equipment');
    const equipmentPools = getTreasureEquipmentPoolsForLocation(locationName);
    const remainingEquipment = {
      common: equipmentPools.common.filter(item => available.includes(item)),
      location: equipmentPools.location.filter(item => available.includes(item)),
    };
    const equipmentWeight = [...remainingEquipment.common, ...remainingEquipment.location]
      .reduce((sum, item) => sum + getTreasureWeight(item, { ...options, locationName }), 0);
    const nonEquipmentWeight = nonEquipment.reduce((sum, item) => sum + getTreasureWeight(item, { ...options, locationName }), 0);
    const totalWeight = nonEquipmentWeight + equipmentWeight;
    if (totalWeight <= 0) break;
    let roll = rng() * totalWeight;
    let selected = null;
    if (roll < equipmentWeight && equipmentWeight > 0) {
      const commonAvailable = remainingEquipment.common.length > 0;
      const locationAvailable = remainingEquipment.location.length > 0;
      const source = selectTreasureEquipmentSource({ hasCommon: commonAvailable, hasLocation: locationAvailable }, rng);
      const sourcePool = remainingEquipment[source];
      let sourceRoll = rng() * sourcePool.reduce((sum, item) => sum + getTreasureWeight(item, { ...options, locationName }), 0);
      selected = sourcePool.find(item => {
        sourceRoll -= getTreasureWeight(item, { ...options, locationName });
        return sourceRoll <= 0;
      }) || sourcePool[sourcePool.length - 1];
    } else {
      roll -= equipmentWeight;
      selected = nonEquipment.find(item => {
        roll -= getTreasureWeight(item, { ...options, locationName });
        return roll <= 0;
      }) || nonEquipment[nonEquipment.length - 1];
    }
    const selectedIndex = available.indexOf(selected);
    if (selectedIndex >= 0) {
      available.splice(selectedIndex, 1);
    } else {
      if (!selected) break;
      const byNameIndex = available.findIndex(item => item.name === selected.name);
      if (byNameIndex >= 0) {
        available.splice(byNameIndex, 1);
      }
    }
    if (!selected) continue;
    const quantityRange = selected.chestQuantity || { min: 1, max: 1 };
    const quantity = Math.max(
      quantityRange.min ?? 1,
      Math.round(
        quantityRange.min + rng() * ((quantityRange.max ?? quantityRange.min) - (quantityRange.min ?? 1))
      )
    );
    loot.push({ name: normalizeItemName(selected.name), quantity });
  }

  const primordialSource = options.primordialSource || null;
  const primordial = primordialSource
    ? getLootOwnershipForLocation(locationName).rollPrimordial(primordialSource, rng)
    : null;
  if (primordial) loot.push(primordial);
  return loot;
}

export const ITEM_LIBRARY = {
  ...FIELD_CONSUMABLE_COMBAT_DATA,
  'Малое зелье здоровья': {
    artId: 'minor_health_potion',
    type: 'heal',
    target: 'self',
    amount: 35,
  },
  'Зелье здоровья': {
    artId: 'health_potion',
    type: 'heal',
    target: 'self',
    amount: 65,
  },
  'Настой горькой живицы': {
    artId: 'bitter_resin_infusion',
    type: 'primeNextDirectAttack',
    target: 'self',
    effect: { id: resolveEffectId('Отравление'), duration: 2 },
  },
  'Настой последней весны': {
    artId: 'last_spring_infusion',
    type: 'heal',
    target: 'self',
    amount: 30,
    effects: [{ id: resolveEffectId('Регенерация'), duration: 2 }],
    removeEffects: [
      { ids: [resolveEffectId('Отравление')], count: 1 },
      { ids: ['speed_penalty_minor', 'speed_penalty_major'], count: 1 },
    ],
  },
  'Свиток цепких корней': {
    artId: 'clinging_roots_scroll',
    type: 'tacticalScroll', target: 'enemy', kind: 'clingingRoots',
  },
  'Малое зелье защиты': {
    artId: 'minor_defense_potion',
    type: 'effects',
    target: 'self',
    effects: [{ id: resolveEffectId('Укрепление'), duration: 2 }],
  },
  'Малое зелье регенерации': {
    artId: 'minor_regeneration_potion',
    type: 'effects',
    target: 'self',
    effects: [{ id: resolveEffectId('Регенерация'), duration: 2 }],
  },
  'Малое зелье щита': {
    artId: 'minor_shield_potion',
    type: 'effects',
    target: 'self',
    effects: [{ id: resolveEffectId('Щит'), duration: 2, value: 30 }],
  },
  'Малое зелье магической силы': {
    artId: 'minor_magic_power_potion',
    type: 'effects',
    target: 'self',
    effects: [{ id: resolveEffectId('Магическая мощь'), duration: 2 }],
  },
  'Малое зелье атаки': {
    artId: 'minor_attack_potion',
    type: 'effects',
    target: 'self',
    effects: [{ id: resolveEffectId('Натиск'), duration: 2 }],
  },
  'Малое зелье скорости': {
    artId: 'minor_speed_potion',
    type: 'effects',
    target: 'self',
    effects: [{ id: resolveEffectId('Ускорение'), duration: 2 }],
  },
  'Малое зелье антимагии': {
    artId: 'minor_antimagic_potion',
    type: 'effects',
    target: 'self',
    effects: [{ id: resolveEffectId('Оберег'), duration: 2 }],
  },
  'Малое зелье очищения': {
    artId: 'minor_cleanse_potion',
    type: 'cleanse',
    target: 'self',
    cleanseCount: 1,
  },
  'Свиток Огненного шара': {
    artId: 'fireball_scroll',
    type: 'tacticalScroll', target: 'enemy', kind: 'fireball',
  },
  'Свиток Лечения': {
    artId: 'healing_scroll',
    type: 'heal',
    target: 'self',
    percent: 0.4,
    effects: [{ id: resolveEffectId('Регенерация'), duration: 2 }],
  },
  'Свиток лечения': {
    artId: 'healing_scroll',
    type: 'heal',
    target: 'self',
    percent: 0.4,
    effects: [{ id: resolveEffectId('Регенерация'), duration: 2 }],
  },
  'Свиток Развеивания': {
    artId: 'dispel_scroll',
    type: 'tacticalScroll', target: 'enemy', kind: 'dispelAll',
  },
  'Свиток Кровавого касания': {
    artId: 'blood_touch_scroll',
    type: 'tacticalScroll', target: 'enemy', kind: 'bloodTouch',
  },
  'Свиток Конус льда': {
    artId: 'ice_cone_scroll',
    type: 'tacticalScroll', target: 'enemy', kind: 'iceCone',
  },
  'Свиток Ядовитого облака': {
    artId: 'poison_cloud_scroll',
    type: 'tacticalScroll', target: 'enemy', kind: 'poisonCloud',
  },
};

export const MATERIAL_ITEMS = new Set(
  ITEM_DATA.filter(item => item.type === 'material').map(item => item.name)
);

export const ACTIVE_GUILD_CRAFT_NAMES = new Set([
  'Малое зелье здоровья', 'Малое зелье регенерации', 'Малое зелье щита', 'Малое зелье атаки', 'Малое зелье магической силы',
  'Шипастый Щит Нор', 'Посох Украденной Искры', 'Венец блуждающих спор', 'Лук Спороносца', 'Булава Старого Сотника', 'Плащ разведчика',
  'Накидка Красного Костра', 'Мерцающая оболочка', 'Клятвопреступник',
  'Амулет цепкой живицы', 'Зеркало третьего голоса', 'Щит тлеющей жилы',
  'Лук последнего цветения', 'Амулет последнего отзвука', 'Посох выжженной памяти',
  'Шлем глубинного дозора', 'Кираса глубинного дозора', 'Сапоги глубинного дозора',
]);
export const CRAFTABLE_ITEMS = ITEM_DATA.filter(item => ACTIVE_GUILD_CRAFT_NAMES.has(item.name) && Array.isArray(item.craft) && item.craft.length > 0);

// Cost belongs to the item, not its effect: a healing scroll still takes a turn.
export function combatItemConsumesTurn(name) {
  const normalized = normalizeItemName(name);
  const definition = getItemDefinition(normalized);
  return Boolean(definition && (/^Свиток(?:\s|$)/i.test(normalized) || ['tacticalScroll', 'preparedTrap'].includes(definition.type)));
}

export function getItemDefinition(name) {
  const normalized = normalizeItemName(name);
  if (!normalized) return null;
  return ITEM_LIBRARY[normalized] || null;
}

export function findItemData(name) {
  const normalized = normalizeItemName(name);
  if (!normalized) return null;
  return ITEM_DATA.find(item => item.name === normalized || item.legacyNames?.includes(normalized)) || null;
}

export function isMaterialItem(name) {
  return MATERIAL_ITEMS.has(name);
}

export function getCraftingRecipes() {
  return CRAFTABLE_ITEMS.map(item => ({ name: item.name, ingredients: item.craft }));
}
