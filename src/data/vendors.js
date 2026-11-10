import { findItemData } from './items';

export const VENDOR_DAILY_RESET_UTC_HOUR = 0;
export const QUARTERMASTER_MATERIAL_DAILY_LIMITS = Object.freeze({
  'Простая ткань': 20,
  'Обрывки кожи': 20,
  'Металлические обломки': 20,
  'Кровяной мох': 20,
});

export const ALCHEMIST_DAILY_LIMITS = Object.freeze({
  'Малое зелье здоровья': 5,
  'Малое зелье защиты': 3,
  'Малое зелье скорости': 3,
  'Малое зелье антимагии': 3,
  'Малое зелье очищения': 2,
});

export const getVendorPurchasePeriodId = (nowMs = Date.now()) => {
  const numericNow = Number(nowMs);
  const resolvedNow = Number.isFinite(numericNow) ? numericNow : Date.now();
  const shifted = new Date(resolvedNow - VENDOR_DAILY_RESET_UTC_HOUR * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

export const normalizeVendorPurchaseState = (state, nowMs = Date.now()) => {
  const periodId = getVendorPurchasePeriodId(nowMs);
  if (state?.periodId !== periodId) return { periodId, counts: {} };
  const counts = Object.fromEntries(Object.entries(state?.counts || {})
    .map(([name, value]) => [name, Math.max(0, Math.floor(Number(value) || 0))]));
  return { periodId, counts };
};

export const getVendorPurchaseStatus = (item, state, nowMs = Date.now()) => {
  const normalizedState = normalizeVendorPurchaseState(state, nowMs);
  const limit = Math.max(0, Math.floor(Number(item?.dailyLimit) || 0));
  const purchased = limit > 0 ? Math.min(limit, normalizedState.counts[item?.name] || 0) : 0;
  return {
    limited: limit > 0,
    limit,
    purchased,
    remaining: limit > 0 ? Math.max(0, limit - purchased) : null,
    periodId: normalizedState.periodId,
    state: normalizedState,
  };
};

const VENDOR_DEFINITIONS = [
  {
    id: 'alchemist',
    name: 'Алхимик Лисса',
    description: 'Ограниченный запас базовых зелий для подготовки к спуску.',
    stock: [
      'Малое зелье здоровья',
      'Малое зелье защиты',
      'Малое зелье скорости',
      'Малое зелье антимагии',
      'Малое зелье очищения',
    ],
  },
  {
    id: 'quartermaster',
    name: 'Интендант Торвальд',
    description: 'Материалы и простая экипировка.',
    stock: [
      'Простая ткань',
      'Обрывки кожи',
      'Металлические обломки',
      'Простая склянка',
      'Кровяной мох',
      'Походная сумка Гильдии',
      'Укреплённые поножи',
      'Походные сапоги',
      'Капюшон Искателя Знаков',
      'Плащ Тусклого Оберега',
      'Кольцо Переменчивой Искры',
      'Кольцо Тлеющего Отзвука',
      'Железное Кольцо Караульного',
    ],
  },
];

export const getVendorCatalog = () =>
  VENDOR_DEFINITIONS.map(vendor => ({
    ...vendor,
    items: vendor.stock
      .map(itemName => {
        const item = findItemData(itemName);
        if (!item || !item.buyPrice) return null;
        return {
          name: item.name,
          price: item.buyPrice,
          sellPrice: item.sellPrice ?? null,
          type: item.type,
          rarity: item.rarity,
          description: item.description,
          dailyLimit: vendor.id === 'quartermaster'
            ? QUARTERMASTER_MATERIAL_DAILY_LIMITS[item.name]
            : vendor.id === 'alchemist'
              ? ALCHEMIST_DAILY_LIMITS[item.name]
              : undefined,
        };
      })
      .filter(Boolean),
  }));

export default VENDOR_DEFINITIONS;
