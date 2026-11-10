import { EFFECT_IDS } from '../utils/effects';

export const RUNE_SLOTS = [
  { id: 'mainHand', label: 'Оружие', description: 'Ячейка оружия.' },
  { id: 'armor', label: 'Нагрудник', description: 'Ячейка нагрудной брони.' },
  { id: 'amulet', label: 'Амулет', description: 'Ячейка амулета.' },
];

export const RUNE_LIBRARY = [
  {
    id: 'ember_heart',
    name: 'Руна Пламенного сердца',
    slot: 'mainHand',
    allowedEquipmentSlots: ['mainHand'],
    description: 'Фокусирует жар бездны в оружии.',
    effectDescription:
      'Каждое третье атакующее действие накладывает Горение на 1 ход.',
    runtime: {
      trigger: 'onHit',
      every: 3,
      effects: [
        { id: EFFECT_IDS.burn, duration: 1, target: 'enemy' },
      ],
    },
    craft: [
      { name: 'Эссенция Проклятий', quantity: 1 },
      { name: 'Пепел гоблинского перца', quantity: 2 },
      { name: 'Металлические обломки', quantity: 2 },
    ],
  },
  {
    id: 'stone_vigil',
    name: 'Руна Стального Отпора',
    slot: 'armor',
    allowedEquipmentSlots: ['armor'],
    description: 'Питает доспехи энергией големов.',
    effectDescription:
      '20% шанс после прямого урона немедленно контратаковать на 60% базовой атаки.',
    runtime: {
      trigger: 'onDirectDamaged', chance: 0.2, counterMultiplier: 0.6,
    },
    craft: [
      { name: 'Эссенция Проклятий', quantity: 1 },
      { name: 'Черножильная руда', quantity: 2 },
      { name: 'Металлические обломки', quantity: 3 },
    ],
  },
  {
    id: 'astral_focus',
    name: 'Руна Астрального эха',
    slot: 'amulet',
    allowedEquipmentSlots: ['amulet'],
    description: 'Собирает астральную энергию в амулете.',
    effectDescription:
      'Первая одиночная атакующая способность в бою наносит остальным врагам 28% прямого урона без переноса эффектов.',
    runtime: {
      trigger: 'firstSingleTargetDamage', splashFraction: 0.28,
    },
    craft: [
      { name: 'Эссенция Проклятий', quantity: 1 },
      { name: 'Спора светокапа', quantity: 2 },
      { name: 'Лазурный мицелий', quantity: 2 },
    ],
  },
];

export const RUNE_LIBRARY_BY_ID = RUNE_LIBRARY.reduce((acc, rune) => {
  acc[rune.id] = rune;
  return acc;
}, {});

export const EMPTY_RUNE_STATE = () => ({
  slots: RUNE_SLOTS.reduce((acc, slot) => {
    acc[slot.id] = null;
    return acc;
  }, {}),
  inventory: [],
});

export const createRuneState = () => EMPTY_RUNE_STATE();

export function ensureRuneState(state) {
  if (!state) return EMPTY_RUNE_STATE();
  const base = EMPTY_RUNE_STATE();
  return {
    slots: { ...base.slots, ...(state.slots || {}) },
    inventory: Array.isArray(state.inventory) ? [...state.inventory] : [],
  };
}

export function getRuneById(id) {
  return RUNE_LIBRARY_BY_ID[id] || null;
}

export function calculateRuneBonuses(slots = {}) {
  return Object.values(slots).reduce((acc, runeId) => {
    if (!runeId) return acc;
    const rune = getRuneById(runeId);
    if (!rune?.bonuses) return acc;
    Object.entries(rune.bonuses).forEach(([stat, value]) => {
      acc[stat] = (acc[stat] ?? 0) + value;
    });
    return acc;
  }, {});
}

export function describeRuneBonuses(rune) {
  if (rune?.bonuses && Object.keys(rune.bonuses).length > 0) {
    return Object.entries(rune.bonuses)
      .map(([stat, value]) => {
        if (['critChance', 'critDamage', 'dodge'].includes(stat)) {
          return `${stat}: ${Math.round(value * 100)}%`;
        }
        return `${stat}: ${value > 0 ? '+' : ''}${value}`;
      })
      .join(', ');
  }
  if (rune?.effectDescription) {
    return rune.effectDescription;
  }
  return 'нет бонусов';
}

export function getRuneRecipes() {
  return RUNE_LIBRARY.map(rune => ({
    id: rune.id,
    name: rune.name,
    slot: rune.slot,
    description: rune.description,
    craft: rune.craft || [],
    bonuses: rune.bonuses,
    effectDescription: rune.effectDescription,
  }));
}

export function getRuneRuntime(runeId) {
  return getRuneById(runeId)?.runtime || null;
}

export function getRuneInventoryEntries(runeState) {
  const ensured = ensureRuneState(runeState);
  const counts = ensured.inventory.reduce((acc, runeId) => {
    acc[runeId] = (acc[runeId] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([id, quantity]) => ({
    id,
    quantity,
    rune: getRuneById(id),
  }));
}

export function removeRuneFromInventory(state, runeId) {
  const ensured = ensureRuneState(state);
  const idx = ensured.inventory.indexOf(runeId);
  if (idx === -1) return ensured;
  const inventory = [...ensured.inventory];
  inventory.splice(idx, 1);
  return { ...ensured, inventory };
}

export function addRuneToInventory(state, runeId) {
  const ensured = ensureRuneState(state);
  return { ...ensured, inventory: [...ensured.inventory, runeId] };
}

export function socketRune(state, runeId, slotId) {
  const ensured = ensureRuneState(state);
  const rune = getRuneById(runeId);
  if (!rune || rune.slot !== slotId) return ensured;
  const cleaned = removeRuneFromInventory(ensured, runeId);
  return {
    slots: { ...cleaned.slots, [slotId]: runeId },
    inventory: cleaned.inventory,
  };
}

export function unsocketRune(state, slotId) {
  const ensured = ensureRuneState(state);
  const runeId = ensured.slots[slotId];
  if (!runeId) return ensured;
  return {
    slots: { ...ensured.slots, [slotId]: null },
    inventory: [...ensured.inventory, runeId],
  };
}

export function getRuneCraftCost(runeId) {
  const rune = getRuneById(runeId);
  return rune?.craft || [];
}

export function canCraftRune(runeId, inventory = []) {
  const recipe = getRuneCraftCost(runeId);
  if (!recipe.length) return false;
  return recipe.every(req => {
    const count = inventory.filter(item => item === req.name).length;
    return count >= req.quantity;
  });
}

export function craftRune(runeId, inventory = []) {
  const recipe = getRuneCraftCost(runeId);
  if (!recipe.length) return { success: false, inventory };
  const updated = [...inventory];
  for (const req of recipe) {
    for (let i = 0; i < req.quantity; i += 1) {
      const idx = updated.indexOf(req.name);
      if (idx === -1) return { success: false, inventory };
      updated.splice(idx, 1);
    }
  }
  return { success: true, inventory: updated };
}

export function getRuneSlotLabel(slotId) {
  return RUNE_SLOTS.find(slot => slot.id === slotId)?.label || slotId;
}
