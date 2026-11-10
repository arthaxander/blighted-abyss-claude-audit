import { equipmentByName, equipmentSets, getMagicSchoolFromEquipment } from '../data/equipment';
import { calculateRuneBonuses, ensureRuneState } from '../data/runes';
import { DEFAULT_MAGIC_SCHOOL } from '../constants/magicSchools';
import { getActiveSocketedRunes, getEquipmentInstanceItemId } from './runeSockets';

export const EQUIPMENT_SLOT_KEYS = ['helmet', 'armor', 'legs', 'mainHand', 'offHand', 'ring1', 'ring2', 'amulet', 'bag'];

export const EQUIPMENT_SLOT_LABELS = {
  helmet: 'Шлем',
  armor: 'Доспех',
  legs: 'Ноги',
  mainHand: 'Основная рука',
  offHand: 'Вторая рука',
  ring1: 'Кольцо 1',
  ring2: 'Кольцо 2',
  amulet: 'Амулет',
  bag: 'Сумка',
};

export const WEAPON_PROFICIENCIES = Object.freeze({
  Defender: Object.freeze(['sword', 'mace', 'axe', 'hammer', 'halberd']),
  Elementalist: Object.freeze(['focus', 'wand', 'scepter', 'staff']),
  Archer: Object.freeze(['bow']),
});

export const WEAPON_TYPES = Object.freeze([
  'sword',
  'mace',
  'axe',
  'hammer',
  'halberd',
  'bow',
  'staff',
  'wand',
  'scepter',
  'focus',
]);

const normalizePlayableClass = (playerClass) =>
  playerClass === 'Mage' ? 'Elementalist' : playerClass;

export const validateClassEquipment = (playerClass, item) => {
  if (!item) {
    return { canEquip: false, message: 'Этот предмет нельзя экипировать' };
  }

  const normalizedPlayerClass = normalizePlayableClass(playerClass);
  const normalizedItemClass = normalizePlayableClass(item.class);
  if (item.classBound === true && item.class !== 'Any' && normalizedItemClass !== normalizedPlayerClass) {
    return { canEquip: false, message: `Этот предмет только для ${item.class}` };
  }

  if (item.type === 'Weapon') {
    const allowedWeaponTypes = WEAPON_PROFICIENCIES[normalizedPlayerClass];
    if (!allowedWeaponTypes?.includes(item.weaponType)) {
      return { canEquip: false, message: 'Ваш класс не владеет этим типом оружия' };
    }
  }

  if (item.type === 'Shield' && normalizedPlayerClass !== 'Defender') {
    return { canEquip: false, message: 'Ваш класс не может использовать щиты' };
  }

  return { canEquip: true, message: null };
};

export const createEmptyEquipmentSlots = () =>
  EQUIPMENT_SLOT_KEYS.reduce((acc, slot) => {
    acc[slot] = null;
    return acc;
  }, {});

export const normalizeEquipmentSlots = (equipmentState) => {
  if (!equipmentState || Array.isArray(equipmentState) || typeof equipmentState !== 'object') {
    return createEmptyEquipmentSlots();
  }

  const slots = createEmptyEquipmentSlots();
  EQUIPMENT_SLOT_KEYS.forEach(slot => {
    const item = equipmentState[slot];
    const itemName = getEquipmentInstanceItemId(item);
    slots[slot] = equipmentByName[itemName] ? item : null;
  });
  return slots;
};

export const isOneHandedMagicWeapon = item =>
  item?.type === 'Weapon' &&
  item.hands === 1 &&
  (Boolean(item.magicSchool) || item.weaponType === 'wand' || item.weaponType === 'focus');

const isOffHandCompatible = (offHand, mainHand) => {
  if (!offHand) return true;
  if (offHand.type === 'MagicOffHand') return isOneHandedMagicWeapon(mainHand);
  return !mainHand || mainHand.hands !== 2;
};

export const normalizeEquipmentLoadout = (equipmentState, inventory = [], playerClass = null) => {
  const equipment = normalizeEquipmentSlots(equipmentState);
  const normalizedInventory = [...(inventory || [])];
  const returnedItems = [];

  if (playerClass) {
    EQUIPMENT_SLOT_KEYS.forEach(slot => {
      const itemRef = equipment[slot];
      const itemName = getEquipmentInstanceItemId(itemRef);
      if (!itemName) return;
      if (!validateClassEquipment(playerClass, equipmentByName[itemName]).canEquip) {
        returnedItems.push(itemRef);
        normalizedInventory.push(itemRef);
        equipment[slot] = null;
      }
    });
  }

  if (equipment.offHand && !isOffHandCompatible(equipmentByName[getEquipmentInstanceItemId(equipment.offHand)], equipmentByName[getEquipmentInstanceItemId(equipment.mainHand)])) {
    returnedItems.push(equipment.offHand);
    normalizedInventory.push(equipment.offHand);
    equipment.offHand = null;
  }

  // Physical equipment can have only one owner.  During hydration the equipped
  // copy is authoritative, so remove only legacy/run entries bearing that exact
  // instance id (different instances of the same authored item remain valid).
  const equippedInstanceIds = new Set(EQUIPMENT_SLOT_KEYS
    .map(slot => equipment[slot]?.instanceId)
    .filter(Boolean));
  const uniqueInventory = normalizedInventory.filter(item => !item?.instanceId || !equippedInstanceIds.has(item.instanceId));

  return { equipment, inventory: uniqueInventory, returnedItems };
};

export const getEquippedItemNames = (equipmentState) => {
  const slots = normalizeEquipmentSlots(equipmentState);
  return EQUIPMENT_SLOT_KEYS
    .map(slot => getEquipmentInstanceItemId(slots[slot]))
    .filter(Boolean);
};

export const getEquipmentSlotForItem = (item, equipmentState) => {
  const candidates = getEquipmentSlotCandidates(item);
  if (!candidates.length) return null;
  const slots = normalizeEquipmentSlots(equipmentState);
  return candidates.find(slot => !slots[slot]) || candidates[0];
};

export const getEquipmentSlotCandidates = item => {
  if (!item?.type) return [];
  switch (item.type) {
    case 'Helmet':
      return ['helmet'];
    case 'Armor':
      return ['armor'];
    case 'Legs':
      return ['legs'];
    case 'Weapon':
      return ['mainHand'];
    case 'Shield':
    case 'MagicOffHand':
      return ['offHand'];
    case 'Amulet':
      return ['amulet'];
    case 'Ring':
      return ['ring1', 'ring2'];
    case 'Bag':
      return ['bag'];
    default:
      return [];
  }
};

export const equipItemInSlots = (equipmentState, item, preferredSlot = null) => {
  const candidates = getEquipmentSlotCandidates(item);
  const slot = preferredSlot && candidates.includes(preferredSlot) ? preferredSlot : getEquipmentSlotForItem(item, equipmentState);
  if (!slot || !item?.name) return null;
  const slots = normalizeEquipmentSlots(equipmentState);
  if (item.type === 'MagicOffHand' && !isOneHandedMagicWeapon(equipmentByName[getEquipmentInstanceItemId(slots.mainHand)])) return null;
  const replacedItem = slots[slot] || null;
  const returnedItems = replacedItem ? [replacedItem] : [];

  if (item.type === 'Weapon' && slots.offHand && !isOffHandCompatible(equipmentByName[getEquipmentInstanceItemId(slots.offHand)], item)) {
    returnedItems.push(slots.offHand);
    slots.offHand = null;
  } else if (slot === 'offHand' && !isOffHandCompatible(item, equipmentByName[getEquipmentInstanceItemId(slots.mainHand)])) {
    returnedItems.push(slots.mainHand);
    slots.mainHand = null;
  }

  return {
    slot,
    replacedItem,
    returnedItems,
    equipment: {
      ...slots,
      [slot]: item.instanceId ? { instanceId: item.instanceId, itemId: item.name, socketedRuneId: item.socketedRuneId || null } : item.name,
    },
  };
};

export const equipInventoryItemForClass = ({
  playerClass,
  equipmentState,
  inventory = [],
  item,
} = {}) => {
  const validation = validateClassEquipment(playerClass, item);
  const unchanged = {
    equipment: normalizeEquipmentSlots(equipmentState),
    inventory: [...(inventory || [])],
    returnedItems: [],
  };
  if (!validation.canEquip) return { ...unchanged, ...validation };

  const inventoryIndex = unchanged.inventory.findIndex(entry => getEquipmentInstanceItemId(entry) === item.name && (!item.instanceId || entry?.instanceId === item.instanceId));
  if (inventoryIndex === -1) {
    return { ...unchanged, canEquip: false, message: 'Предмет отсутствует в инвентаре' };
  }

  const result = equipItemInSlots(unchanged.equipment, item);
  if (!result) {
    return { ...unchanged, canEquip: false, message: 'Этот предмет нельзя экипировать' };
  }
  unchanged.inventory.splice(inventoryIndex, 1);
  unchanged.inventory.push(...result.returnedItems);
  return {
    canEquip: true,
    message: null,
    equipment: result.equipment,
    inventory: unchanged.inventory,
    returnedItems: result.returnedItems,
  };
};

export const unequipItemFromSlots = (equipmentState, slotOrItemName) => {
  const slots = normalizeEquipmentSlots(equipmentState);
  const slot = EQUIPMENT_SLOT_KEYS.includes(slotOrItemName)
    ? slotOrItemName
    : EQUIPMENT_SLOT_KEYS.find(key => slots[key] === slotOrItemName || getEquipmentInstanceItemId(slots[key]) === slotOrItemName);
  if (!slot || !slots[slot]) return null;
  const itemName = slots[slot];
  return {
    slot,
    itemName,
    equipment: {
      ...slots,
      [slot]: null,
    },
  };
};


export const getEquipmentSetCounts = (equipmentState = {}) => {
  return getEquippedItemNames(equipmentState).reduce((acc, itemName) => {
    const setId = equipmentByName[itemName]?.setId;
    if (!setId) return acc;
    acc[setId] = (acc[setId] ?? 0) + 1;
    return acc;
  }, {});
};

export const getActiveEquipmentSetBonuses = (equipmentState = {}) => {
  const counts = getEquipmentSetCounts(equipmentState);
  return Object.entries(counts).reduce((acc, [setId, count]) => {
    const setDef = equipmentSets[setId];
    if (!setDef?.bonuses) return acc;
    const activeBonuses = setDef.bonuses.filter(bonus => count >= bonus.pieces);
    if (activeBonuses.length > 0) {
      acc[setId] = {
        set: setDef,
        count,
        bonuses: activeBonuses,
      };
    }
    return acc;
  }, {});
};

export const calculateEquipmentSetBonuses = (equipmentState = {}) => {
  const activeSets = getActiveEquipmentSetBonuses(equipmentState);
  return Object.values(activeSets).reduce((acc, activeSet) => {
    activeSet.bonuses.forEach(bonus => {
      Object.entries(bonus.stats || {}).forEach(([stat, value]) => {
        acc[stat] = (acc[stat] ?? 0) + value;
      });
    });
    return acc;
  }, {});
};

export const getEquipmentSetRuntimeBonuses = (equipmentState = {}) => {
  const activeSets = getActiveEquipmentSetBonuses(equipmentState);
  return Object.values(activeSets).reduce((acc, activeSet) => {
    activeSet.bonuses.forEach(bonus => {
      const runtime = bonus.runtime || {};
      Object.entries(runtime).forEach(([key, value]) => {
        if (typeof value === 'number') {
          acc[key] = (acc[key] ?? 0) + value;
        } else if (value !== undefined) {
          acc[key] = value;
        }
      });
    });
    return acc;
  }, {});
};

export const calculateEquipmentBonuses = (equipmentState = {}) => {
  return getEquippedItemNames(equipmentState).reduce((acc, itemName) => {
    const def = equipmentByName[itemName];
    if (!def?.stats) return acc;
    Object.entries(def.stats).forEach(([stat, value]) => {
      acc[stat] = (acc[stat] ?? 0) + value;
    });
    return acc;
  }, {});
};

export const buildBaseStats = (prev = {}) => ({
  maxHp: prev.baseStats?.maxHp ?? prev.maxHp ?? 0,
  attack: prev.baseStats?.attack ?? prev.baseAtk ?? prev.attack ?? 0,
  magAtk: prev.baseStats?.magAtk ?? prev.magAtk ?? 0,
  physDef: prev.baseStats?.physDef ?? prev.physDef ?? 0,
  magicDef: prev.baseStats?.magicDef ?? prev.magicDef ?? 0,
  speed: prev.baseStats?.speed ?? prev.speed ?? 0,
  critChance: prev.baseStats?.critChance ?? prev.critChance ?? 0,
  critDamage: prev.baseStats?.critDamage ?? prev.critDamage ?? 0.5,
  dodge: prev.baseStats?.dodge ?? prev.dodge ?? 0,
});

const combineBonuses = (...bonusSets) =>
  bonusSets.reduce((acc, bonuses = {}) => {
    Object.entries(bonuses).forEach(([stat, value]) => {
      acc[stat] = (acc[stat] ?? 0) + value;
    });
    return acc;
  }, {});

export const applyEquipmentPatch = (prev, updatedEquipment, inventory, runeOverride) => {
  const baseStats = buildBaseStats(prev);
  const normalizedLoadout = normalizeEquipmentLoadout(updatedEquipment, inventory, prev.class);
  const equipmentSlots = normalizedLoadout.equipment;
  const equippedNames = getEquippedItemNames(equipmentSlots);
  const ensuredRunes = ensureRuneState(runeOverride || prev.runes);
  const equipmentBonuses = calculateEquipmentBonuses(equipmentSlots);
  const setBonuses = calculateEquipmentSetBonuses(equipmentSlots);
  const runeBonuses = calculateRuneBonuses(getActiveSocketedRunes(equipmentSlots));
  const bonuses = combineBonuses(equipmentBonuses, setBonuses, runeBonuses);
  const resolvedMagicSchool =
    getMagicSchoolFromEquipment(equippedNames) ||
    prev.weaponMagicSchool ||
    (prev.class === 'Mage' ? DEFAULT_MAGIC_SCHOOL : null);
  const newMaxHp = (baseStats.maxHp ?? 0) + (bonuses.maxHp ?? 0);
  const newAttack = (baseStats.attack ?? 0) + (bonuses.attack ?? 0);
  const newMagAtk = (baseStats.magAtk ?? 0) + (bonuses.magAtk ?? 0);
  const newPhysDef = (baseStats.physDef ?? 0) + (bonuses.physDef ?? 0);
  const newMagicDef = (baseStats.magicDef ?? 0) + (bonuses.magicDef ?? 0);
  const newSpeed = Math.round((baseStats.speed ?? 0) * (1 + (bonuses.speedPct ?? 0)) + (bonuses.speed ?? 0));
  const newCritChance = (baseStats.critChance ?? 0) + (bonuses.critChance ?? 0);
  const newCritDamage = (baseStats.critDamage ?? 0.5) + (bonuses.critDamage ?? 0);
  const newDodge = (baseStats.dodge ?? 0) + (bonuses.dodge ?? 0);
  const hpRatio = prev.maxHp ? Math.min(1, (prev.hp ?? prev.maxHp) / prev.maxHp) : 1;
  const newHp = Math.min(newMaxHp || 0, Math.round((newMaxHp || 0) * hpRatio));

  return {
    baseStats,
    equipment: equipmentSlots,
    inventory: normalizedLoadout.inventory,
    runes: ensuredRunes,
    maxHp: newMaxHp,
    hp: newHp,
    attack: newAttack,
    baseAtk: baseStats.attack ?? newAttack,
    magAtk: newMagAtk,
    physDef: newPhysDef,
    magicDef: newMagicDef,
    speed: newSpeed,
    equipmentSpeedPct: bonuses.speedPct ?? 0,
    critChance: newCritChance,
    critDamage: newCritDamage,
    dodge: newDodge,
    weaponMagicSchool: resolvedMagicSchool,
  };
};
