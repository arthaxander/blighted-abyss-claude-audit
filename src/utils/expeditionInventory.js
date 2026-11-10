import { findItemData, normalizeItemName } from '../data/items';
import { BASE_RUN_INVENTORY_CAPACITY, GUILD_STASH_CAPACITY, SAFE_SLOT_LIMIT } from '../constants/gameplay';
import { equipmentByName } from '../data/equipment';
import { equipItemInSlots, getEquipmentSlotCandidates, unequipItemFromSlots, validateClassEquipment } from './equipmentManager';
import { getRuneById } from '../data/runes';
import { depositIntoStorage, normalizeStorage, RUN_INVENTORY_RUNE_STACK_LIMIT } from './storageManagement';
import { getGuildSilver, withGuildSilver } from './guildCurrency';
import { DEFAULT_RELIC_ID, ensureRelicState, getRelicBonuses } from '../data/relics';

export const SAFE_SLOT_COUNT = SAFE_SLOT_LIMIT;
export { BASE_RUN_INVENTORY_CAPACITY, GUILD_STASH_CAPACITY };
export const RUN_INVENTORY_LAYOUT_VERSION = 2;

const withoutLegacyInventory = player => {
  const { inventory, safeSlots, ...canonical } = player || {};
  return canonical;
};
export const RUN_SLOT_TYPES = Object.freeze({ SAFE: 'safe', GENERAL: 'general', CONSUMABLE: 'consumable', RESOURCE: 'resource' });
export const BASE_RUN_SLOT_CAPACITIES = Object.freeze({ safe: 2, general: 10, consumable: 2, resource: 12 });
const SLOT_ORDER = ['safe', 'general', 'consumable', 'resource'];

const quantityOf = value => Math.max(0, Math.floor(Number(value) || 0));
export const getItemId = item => normalizeItemName(typeof item === 'string' ? item : item?.itemId || item?.name);
export const createItemStack = (item, quantity = 1) => {
  const itemId = getItemId(item);
  if (!itemId || !quantityOf(quantity)) return null;
  return typeof item === 'object'
    ? { ...item, itemId, quantity: quantityOf(quantity) }
    : { itemId, quantity: quantityOf(quantity) };
};

export const getStackLimit = item => {
  if (getRuneById(typeof item === 'object' ? item?.itemId : item)) return RUN_INVENTORY_RUNE_STACK_LIMIT;
  const def = typeof item === 'object' && item?.type ? item : findItemData(getItemId(item));
  if (!def) return 1;
  if (def.type === 'equipment' || def.type === 'fishingRod') return 1;
  if (def.type === 'consumable' || def.type === 'potion' || def.type === 'scroll') return 3;
  if (def.type === 'material') return def.rarity === 'Редкая' ? 5 : 20;
  if (def.type === 'bait') return 20;
  return 1;
};

export const isCompatibleStack = (a, b) => Boolean(a && b && getItemId(a) === getItemId(b) && getStackLimit(a) > 1);
export const isSafeSlotIndex = index => index >= 0 && index < SAFE_SLOT_COUNT;
export const getBagSlotBonuses = equipment => {
  const bagName = getItemId(equipment?.bag);
  const def = findItemData(bagName);
  if (def?.inventorySlotBonuses) return Object.fromEntries(['general', 'consumable', 'resource'].map(type => [type, Math.max(0, Number(def.inventorySlotBonuses[type]) || 0)]));
  // Compatibility for genuinely legacy/future definitions only. A current canonical definition always wins.
  const legacy = Math.max(0, Number(def?.bagCapacity || def?.capacityBonus) || 0);
  return { general: legacy, consumable: 0, resource: 0 };
};
export const getBagCapacity = equipment => Object.values(getBagSlotBonuses(equipment)).reduce((sum, value) => sum + value, 0);
export const getRunInventoryLayout = equipment => {
  const bonuses = getBagSlotBonuses(equipment);
  const capacities = { ...BASE_RUN_SLOT_CAPACITIES };
  ['general', 'consumable', 'resource'].forEach(type => { capacities[type] += bonuses[type]; });
  let index = 0;
  const sections = SLOT_ORDER.map(type => {
    const start = index; index += capacities[type];
    return { type, start, end: index, capacity: capacities[type], indices: Array.from({ length: capacities[type] }, (_, offset) => start + offset) };
  });
  const slots = sections.flatMap(section => section.indices.map(slotIndex => ({ index: slotIndex, type: section.type })));
  return { version: RUN_INVENTORY_LAYOUT_VERSION, capacities, sections, slots, totalCapacity: index, slotTypeAt: slotIndex => slots[slotIndex]?.type || null };
};
export const getRunInventoryCapacity = equipment => getRunInventoryLayout(equipment).totalCapacity;
export const createInventoryLayout = capacities => {
  let index = 0;
  const sections = SLOT_ORDER.map(type => {
    const capacity = Math.max(0, Number(capacities?.[type]) || 0);
    const start = index; index += capacity;
    return { type, start, end: index, capacity, indices: Array.from({ length: capacity }, (_, offset) => start + offset) };
  });
  const slots = sections.flatMap(section => section.indices.map(slotIndex => ({ index: slotIndex, type: section.type })));
  return { version: RUN_INVENTORY_LAYOUT_VERSION, capacities: Object.fromEntries(sections.map(section => [section.type, section.capacity])), sections, slots, totalCapacity: index, slotTypeAt: slotIndex => slots[slotIndex]?.type || (slotIndex >= index ? 'overflow' : null) };
};
export const createGeneralInventoryLayout = capacity => createInventoryLayout({ safe: 0, general: capacity, consumable: 0, resource: 0 });
export const preserveInventorySlots = (slots = [], minimumCapacity = 0) => normalizeInventorySlots(slots, Math.max(minimumCapacity, Array.isArray(slots) ? slots.length : 0));
export const trimResolvedInventoryOverflow = (slots, layout) => {
  const next = preserveInventorySlots(slots, layout.totalCapacity);
  while (next.length > layout.totalCapacity && !next[next.length - 1]) next.pop();
  return next;
};
export const getItemSlotCategory = item => {
  const def = findItemData(getItemId(item));
  if (def?.type === 'material') return 'resource';
  if (['consumable', 'potion', 'scroll'].includes(def?.type)) return 'consumable';
  return 'general';
};
export const canPlaceItemInSlotType = (item, slotType) => slotType === 'safe' || slotType === 'general' || getItemSlotCategory(item) === slotType;
export const hasOrdinaryFreeInventorySlot = player => normalizeInventorySlots(
  player?.runInventory,
  getRunInventoryCapacity(player?.equipment)
).some((stack, index) => !stack && getRunInventoryLayout(player?.equipment).slotTypeAt(index) === 'general');

export const getRunInventoryAcceptance = (player, item, availableQuantity = Infinity) => {
  const limit = getStackLimit(item);
  const layout = getRunInventoryLayout(player?.equipment);
  const slots = migrateRunInventory(player?.runInventory, player?.equipment, player?.runInventoryLayoutVersion);
  const result = insertItems(slots, [createItemStack(item, Number.isFinite(availableQuantity) ? availableQuantity : 1000000)], { layout });
  const rejected = result.rejected.reduce((sum, entry) => sum + entry.quantity, 0);
  const maxQuantity = Math.max(0, Math.min(availableQuantity, (Number.isFinite(availableQuantity) ? availableQuantity : 1000000) - rejected));
  const partial = layout.slots.find(({ index, type }) => type !== 'safe' && slots[index]?.itemId === getItemId(item) && slots[index].quantity < limit);
  const stackQuantity = Math.min(maxQuantity, partial ? limit - slots[partial.index].quantity : limit);
  return { maxQuantity, stackQuantity };
};

const repackOrdinarySlots = (slots, layout) => {
  const safeSlots = normalizeInventorySlots(slots, Math.max(SAFE_SLOT_COUNT, slots.length)).slice(0, SAFE_SLOT_COUNT);
  const ordinaryStacks = slots.slice(SAFE_SLOT_COUNT).filter(Boolean);
  const packed = normalizeInventorySlots([], layout.totalCapacity);
  safeSlots.forEach((stack, index) => { packed[index] = stack; });
  const insertion = insertItems(packed, ordinaryStacks, { layout, allowSafeFallback: false });
  const deficit = insertion.rejected.reduce((sum, stack) => sum + Math.ceil(stack.quantity / getStackLimit(stack)), 0);
  return { slots: deficit ? null : insertion.slots, deficit };
};

const bagCapacityFailure = (operation, deficit, player) => ({
  success: false,
  player,
  code: operation === 'replace' ? 'BAG_REPLACEMENT_CAPACITY' : 'BAG_REMOVAL_CAPACITY',
  deficit,
  title: operation === 'replace' ? 'Нельзя сменить сумку' : 'Нельзя снять сумку',
  reason: `После ${operation === 'replace' ? 'замены' : 'снятия'} в инвентаре не хватит места для всех предметов. Освободите ${deficit} ячеек и попробуйте снова.`,
});

export const getInventoryEquipmentAction = (player, slotIndex, { inCombat = false } = {}) => {
  const stack = player?.runInventory?.[slotIndex];
  const def = findItemData(stack?.itemId);
  if (!stack || !def || !['equipment', 'fishingRod'].includes(def.type)) return null;
  if (inCombat) return { available: false, reason: 'Снаряжение нельзя менять во время боя' };
  if (stack.quantity !== 1) return { available: false, reason: 'Снаряжение должно занимать отдельную ячейку' };
  if (def.type === 'fishingRod') return { available: true, equipmentSlot: 'fishingTool' };
  const equipmentDef = equipmentByName[stack.itemId];
  const validation = validateClassEquipment(player?.class, equipmentDef);
  if (!validation.canEquip) return { available: false, reason: validation.message };
  const candidateSlots = getEquipmentSlotCandidates(equipmentDef);
  const emptySlot = candidateSlots.find(slot => !player?.equipment?.[slot]);
  return { available: true, equipmentSlot: emptySlot || (candidateSlots.length === 1 ? candidateSlots[0] : null), candidateSlots, requiresSlotChoice: !emptySlot && candidateSlots.length > 1 };
};

export const equipRunInventoryItem = (player, sourceIndex, context = {}, preferredSlot = null) => {
  const action = getInventoryEquipmentAction(player, sourceIndex, context);
  if (!action?.available) return { success: false, player, reason: action?.reason || 'Этот предмет нельзя экипировать' };
  const oldLayout = getRunInventoryLayout(player?.equipment);
  const slots = preserveInventorySlots(player?.runInventory, oldLayout.totalCapacity);
  const newItem = slots[sourceIndex];
  if (action.equipmentSlot === 'fishingTool') {
    slots[sourceIndex] = player.fishingTool ? createItemStack(player.fishingTool) : null;
    const next = { ...withoutLegacyInventory(player), fishingTool: newItem.itemId, fishingSetup: { ...(player.fishingSetup || {}), rod: newItem.itemId }, runInventory: slots };
    return { success: true, player: next };
  }
  const equipmentDef = equipmentByName[newItem.itemId];
  if (action.requiresSlotChoice && !preferredSlot) return { success: false, player, requiresSlotChoice: true, candidateSlots: action.candidateSlots };
  const equipped = equipItemInSlots(player.equipment, { ...equipmentDef, instanceId: newItem.instanceId, socketedRuneId: newItem.socketedRuneId }, preferredSlot);
  if (!equipped) return { success: false, player, reason: 'Этот предмет нельзя экипировать' };
  const newLayout = getRunInventoryLayout(equipped.equipment);
  slots[sourceIndex] = null;
  if (newLayout.totalCapacity === oldLayout.totalCapacity && equipped.returnedItems.length && canPlaceItemInSlotType(equipped.returnedItems[0], newLayout.slotTypeAt(sourceIndex))) {
    slots[sourceIndex] = createItemStack(equipped.returnedItems.shift());
  }
  const existing = slots.slice(SAFE_SLOT_COUNT).filter(Boolean);
  const target = normalizeInventorySlots([], newLayout.totalCapacity);
  slots.slice(0, SAFE_SLOT_COUNT).forEach((stack, index) => { target[index] = stack; });
  const insertion = insertItems(target, [...existing, ...equipped.returnedItems.map(item => createItemStack(item))], { layout: newLayout, allowSafeFallback: false });
  if (!insertion.fits) return bagCapacityFailure(newLayout.totalCapacity < oldLayout.totalCapacity ? 'replace' : 'replace', insertion.rejected.length, player);
  const resized = insertion.slots;
  return { success: true, player: { ...withoutLegacyInventory(player), equipment: equipped.equipment, runInventory: resized } };
};

export const unequipRunEquipment = (player, equipmentSlot, { inCombat = false } = {}) => {
  if (inCombat) return { success: false, player, reason: 'Снаряжение нельзя менять во время боя' };
  const oldLayout = getRunInventoryLayout(player?.equipment);
  const slots = preserveInventorySlots(player?.runInventory, oldLayout.totalCapacity);
  if (equipmentSlot === 'fishingTool') {
    if (!player?.fishingTool) return { success: false, player, reason: 'Удочка не экипирована' };
    const insertion = insertItems(slots, [createItemStack(player.fishingTool)], { layout: oldLayout });
    if (!insertion.fits) return { success: false, player, reason: 'Нет свободной обычной или безопасной ячейки' };
    return { success: true, player: { ...withoutLegacyInventory(player), fishingTool: null, fishingSetup: { ...(player.fishingSetup || {}), rod: '' }, runInventory: insertion.slots } };
  }
  const unequipped = unequipItemFromSlots(player?.equipment, equipmentSlot);
  if (!unequipped) return { success: false, player, reason: 'Слот уже пуст' };
  const newLayout = getRunInventoryLayout(unequipped.equipment);
  let resized;
  if (newLayout.totalCapacity < oldLayout.totalCapacity || slots.length > newLayout.totalCapacity) {
    const packed = repackOrdinarySlots([...slots, createItemStack(unequipped.itemName)], newLayout);
    if (!packed.slots) return bagCapacityFailure('remove', packed.deficit, player);
    resized = packed.slots;
    return { success: true, player: { ...withoutLegacyInventory(player), equipment: unequipped.equipment, runInventory: resized } };
  }
  resized = preserveInventorySlots(slots, newLayout.totalCapacity);
  const insertion = insertItems(resized, [createItemStack(unequipped.itemName)], { layout: newLayout });
  if (!insertion.fits) return { success: false, player, reason: 'Нет свободной обычной или безопасной ячейки' };
  resized = insertion.slots;
  return { success: true, player: { ...withoutLegacyInventory(player), equipment: unequipped.equipment, runInventory: resized } };
};

export const normalizeInventorySlots = (slots = [], capacity = BASE_RUN_INVENTORY_CAPACITY) => {
  const result = Array.from({ length: capacity }, () => null);
  (Array.isArray(slots) ? slots : []).slice(0, capacity).forEach((entry, index) => {
    if (!entry) return;
    const stack = createItemStack(entry, typeof entry === 'string' ? 1 : entry.quantity);
    if (stack) result[index] = stack;
  });
  return result;
};

export const legacyInventoryToSlots = (inventory = [], capacity = BASE_RUN_INVENTORY_CAPACITY, safeItems = [], layout = getRunInventoryLayout()) => {
  let slots = normalizeInventorySlots([], layout.totalCapacity || capacity);
  const remaining = [...(inventory || [])];
  (safeItems || []).slice(0, SAFE_SLOT_COUNT).forEach((safe, index) => {
    const itemId = getItemId(safe); const found = remaining.findIndex(item => getItemId(item) === itemId);
    if (found >= 0) { slots[index] = createItemStack(itemId); remaining.splice(found, 1); }
  });
  const items = remaining.map(name => ({ itemId: getItemId(name), quantity: 1 })).filter(x => x.itemId);
  return insertItems(slots, items, { layout }).slots;
};

export const legacyStorageToSlots = (inventory = [], capacity = GUILD_STASH_CAPACITY) => insertItems(
  normalizeInventorySlots([], capacity),
  (inventory || []).map(item => createItemStack(item)).filter(Boolean),
  { layout: createGeneralInventoryLayout(capacity), allowSafeFallback: false }
).slots;

export const slotsToLegacyInventory = slots => (slots || []).flatMap(stack =>
  stack ? (stack.instanceId ? [{ ...stack, quantity: 1 }] : Array.from({ length: stack.quantity }, () => stack.itemId)) : []
);

export const insertItems = (inputSlots, items = [], { layout = createGeneralInventoryLayout(inputSlots?.length || BASE_RUN_INVENTORY_CAPACITY), allowSafeFallback = true } = {}) => {
  const slots = preserveInventorySlots(inputSlots, layout.totalCapacity);
  const rejected = [];
  items.forEach(raw => {
    const itemId = getItemId(raw);
    let remaining = quantityOf(typeof raw === 'string' ? 1 : raw?.quantity ?? 1);
    const limit = getStackLimit(itemId);
    if (!itemId || !remaining) return;
    // Safe stacks are deliberately deferred until all valid non-safe capacity is exhausted.
    for (const { index: i, type } of layout.slots) {
      if (!remaining) break;
      if (type === 'safe') continue;
      if (slots[i]?.itemId !== itemId || slots[i].quantity >= limit) continue;
      const moved = Math.min(remaining, limit - slots[i].quantity);
      slots[i] = { ...slots[i], quantity: slots[i].quantity + moved };
      remaining -= moved;
    }
    const category = getItemSlotCategory(raw);
    const preferredTypes = category === 'resource' ? ['resource', 'general'] : category === 'consumable' ? ['consumable', 'general'] : ['general'];
    const emptySlotOrder = preferredTypes.flatMap(type => layout.slots.filter(slot => slot.type === type).map(slot => slot.index));
    for (const i of emptySlotOrder) {
      if (!remaining) break;
      if (slots[i]) continue;
      const moved = Math.min(remaining, limit);
      slots[i] = raw?.instanceId ? { ...raw, itemId, quantity: 1 } : { itemId, quantity: moved };
      remaining -= moved;
    }
    if (remaining && allowSafeFallback) {
      for (const i of layout.sections.find(section => section.type === 'safe')?.indices || []) {
        if (!remaining) break;
        if (slots[i]?.itemId !== itemId || slots[i].quantity >= limit) continue;
        const moved = Math.min(remaining, limit - slots[i].quantity);
        slots[i] = { ...slots[i], quantity: slots[i].quantity + moved }; remaining -= moved;
      }
      for (const i of layout.sections.find(section => section.type === 'safe')?.indices || []) if (remaining && !slots[i]) {
        const moved = Math.min(remaining, limit);
        slots[i] = raw?.instanceId ? { ...raw, itemId, quantity: 1 } : { itemId, quantity: moved }; remaining -= moved;
      }
    }
    if (remaining) rejected.push({ ...(typeof raw === 'object' ? raw : {}), itemId, quantity: remaining });
  });
  return { slots, rejected, fits: rejected.length === 0 };
};

export const craftRunInventoryRecipe = (player, recipe) => {
  const layout = getRunInventoryLayout(player?.equipment);
  const original = migrateRunInventory(player?.runInventory || [], player?.equipment, player?.runInventoryLayoutVersion);
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const resultQuantity = recipe?.result?.quantity ?? 1;
  const result = createItemStack(recipe?.result?.name || recipe?.name, resultQuantity);
  if (!Number.isSafeInteger(resultQuantity) || resultQuantity <= 0 || !findItemData(result?.itemId)
    || ingredients.some(i => !Number.isSafeInteger(i?.quantity ?? 1) || (i?.quantity ?? 1) <= 0)
    || !result || !ingredients.length) return { success: false, player, reason: 'invalid-recipe' };

  if (original.slice(layout.totalCapacity).some(Boolean)) return { success: false, player, reason: 'insufficient-space' };
  const slots = preserveInventorySlots(original, layout.totalCapacity);
  for (const ingredient of ingredients) {
    let remaining = quantityOf(ingredient?.quantity || 1);
    const itemId = getItemId(ingredient);
    const available = slots.reduce((sum, stack) => sum + (stack?.itemId === itemId ? stack.quantity : 0), 0);
    if (!itemId || available < remaining) return { success: false, player, reason: 'missing-ingredients' };
    for (let index = 0; index < slots.length && remaining; index += 1) {
      if (slots[index]?.itemId !== itemId) continue;
      const consumed = Math.min(remaining, slots[index].quantity);
      const quantity = slots[index].quantity - consumed;
      slots[index] = quantity ? { ...slots[index], quantity } : null;
      remaining -= consumed;
    }
  }

  const insertion = insertItems(slots, [result], { layout });
  if (!insertion.fits) return { success: false, player, reason: 'insufficient-space' };
  return {
    success: true,
    player: { ...withoutLegacyInventory(player), runInventory: insertion.slots },
  };
};

export const simulateItemInsertion = (slots, items, options = {}) => {
  const before = (slots || []).filter(Boolean).length;
  const result = insertItems(slots, items, options);
  const after = result.slots.filter(Boolean).length;
  return { ...result, additionalSlotsRequired: after - before + result.rejected.reduce((sum, item) => sum + Math.ceil(item.quantity / getStackLimit(item)), 0) };
};

export const moveInventoryStack = (inputSlots, sourceIndex, destinationIndex, layout = createGeneralInventoryLayout(inputSlots?.length || 0)) => {
  const slots = normalizeInventorySlots(inputSlots, inputSlots.length);
  const source = slots[sourceIndex]; const destination = slots[destinationIndex];
  if (layout.slotTypeAt(destinationIndex) === 'overflow') return slots;
  if (!source || !canPlaceItemInSlotType(source, layout.slotTypeAt(destinationIndex))) return slots;
  if (destination && layout.slotTypeAt(sourceIndex) !== 'overflow' && !canPlaceItemInSlotType(destination, layout.slotTypeAt(sourceIndex))) return slots;
  if (sourceIndex === destinationIndex || !slots[sourceIndex] || !slots[destinationIndex]) {
    if (slots[sourceIndex] && !slots[destinationIndex]) {
      slots[destinationIndex] = slots[sourceIndex]; slots[sourceIndex] = null;
    }
    return trimResolvedInventoryOverflow(slots, layout);
  }
  if (isCompatibleStack(source, destination)) {
    const room = getStackLimit(destination) - destination.quantity;
    const moved = Math.min(room, source.quantity);
    slots[destinationIndex] = { ...destination, quantity: destination.quantity + moved };
    slots[sourceIndex] = source.quantity === moved ? null : { ...source, quantity: source.quantity - moved };
  } else {
    slots[sourceIndex] = destination; slots[destinationIndex] = source;
  }
  return trimResolvedInventoryOverflow(slots, layout);
};

export const discardInventoryStack = (slots, index, layout = createGeneralInventoryLayout(slots?.length || 0)) => trimResolvedInventoryOverflow(
  normalizeInventorySlots(slots, slots.length).map((entry, i) => i === index ? null : entry),
  layout
);
const sortGroup = def => def?.type === 'equipment' ? 0 : def?.type === 'consumable' ? 1 : def?.type === 'material' ? 2 : 3;
const rarityRank = rarity => ({ 'Обычная': 0, 'Необычная': 1, 'Редкая': 2 }[rarity] ?? 9);
export const sortOrdinaryInventory = (inputSlots, layout = createGeneralInventoryLayout(inputSlots?.length || 0)) => {
  const slots = normalizeInventorySlots(inputSlots, inputSlots.length);
  const safe = slots.slice(0, SAFE_SLOT_COUNT);
  const ordinary = slots.slice(SAFE_SLOT_COUNT).filter(Boolean).sort((a, b) => {
    const ad = findItemData(a.itemId); const bd = findItemData(b.itemId);
    return sortGroup(ad) - sortGroup(bd) || String(ad?.equipmentType || ad?.category || '').localeCompare(String(bd?.equipmentType || bd?.category || '')) || rarityRank(ad?.rarity) - rarityRank(bd?.rarity) || a.itemId.localeCompare(b.itemId);
  });
  const target = normalizeInventorySlots([], layout.totalCapacity);
  safe.forEach((stack, index) => { target[index] = stack; });
  const packed = insertItems(target, ordinary, { layout, allowSafeFallback: false });
  return trimResolvedInventoryOverflow(packed.fits ? packed.slots : [...packed.slots, ...packed.rejected], layout);
};

export const migrateRunInventory = (inputSlots, equipment, sourceVersion = 0) => {
  const layout = getRunInventoryLayout(equipment);
  const source = preserveInventorySlots(inputSlots, SAFE_SLOT_COUNT);
  if (sourceVersion === RUN_INVENTORY_LAYOUT_VERSION) return preserveInventorySlots(source, layout.totalCapacity);
  const target = normalizeInventorySlots([], layout.totalCapacity);
  source.slice(0, SAFE_SLOT_COUNT).forEach((stack, index) => { target[index] = stack; });
  const result = insertItems(target, source.slice(SAFE_SLOT_COUNT).filter(Boolean), { layout, allowSafeFallback: false });
  // A legal old bag can contain fourteen general-only stacks but the new layout has twelve
  // general cells. Keep exceptional legacy overflow appended and block normal capacity-sensitive
  // operations until the player clears it; never silently discard ownership.
  return result.fits ? result.slots : [...result.slots, ...result.rejected.map(stack => ({ ...stack }))];
};

export const applyExpeditionDeath = player => ({
  ...withoutLegacyInventory(player),
  preparedTrap: null,
  runInventory: normalizeInventorySlots(player?.runInventory, getRunInventoryCapacity(player?.equipment)).map((stack, index) => isSafeSlotIndex(index) ? stack : null),
  equipment: Object.fromEntries(Object.keys(player?.equipment || {}).map(key => [key, null])),
  fishingTool: null,
  fishingSetup: { ...(player?.fishingSetup || {}), rod: '' },
  runSilver: 0,
});

export const createExpeditionDeathResult = (player, { rng = Math.random, allowInsurance = true } = {}) => {
  const nextPlayer = applyExpeditionDeath(player);
  const preservedStacks = normalizeInventorySlots(nextPlayer.runInventory, getRunInventoryCapacity(nextPlayer.equipment))
    .filter(Boolean)
    .map(stack => ({ ...stack }));
  const original = normalizeInventorySlots(player?.runInventory, getRunInventoryCapacity(player?.equipment));
  const relics = ensureRelicState(player?.relics); const level = relics.progress?.[DEFAULT_RELIC_ID]?.level || 0;
  const chance = relics.activeRelicId === DEFAULT_RELIC_ID ? getRelicBonuses(DEFAULT_RELIC_ID, level).insuranceChance : 0;
  const candidates = original.slice(SAFE_SLOT_COUNT).filter(stack => {
    const def = findItemData(stack?.itemId); return def && !['relic', 'quest', 'system'].includes(def.type) && !def.bossUnique && def.rarity !== 'Первозданная';
  });
  const successful = allowInsurance && chance > 0 && candidates.length > 0 && rng() < chance;
  const insuredStack = successful ? { ...candidates[Math.floor(rng() * candidates.length)] } : null;
  if (insuredStack) preservedStacks.push(insuredStack);
  return { player: nextPlayer, preservedStacks, insurance: { eligible: allowInsurance && chance > 0, successful, chance, insuredStack, reason: !allowInsurance ? 'disabled' : !chance ? 'relic-level' : !candidates.length ? 'no-eligible-candidates' : successful ? null : 'chance-failed', additionalToSafeSlots: successful } };
};

export const bankRunSilver = player => ({
  ...withGuildSilver(player, getGuildSilver(player) + Math.max(0, Number(player?.runSilver) || 0)),
  runSilver: 0,
});
export const extractRunInventory = player => {
  const runInventory = preserveInventorySlots(player?.runInventory, getRunInventoryCapacity(player?.equipment));
  const banked = bankRunSilver(player);
  return {
    player: { ...withoutLegacyInventory(banked), runInventory },
  };
};

export const unloadRunInventoryToStash = (player, storageItems = [], { keepSlotIndices = [] } = {}) => {
  const runInventory = preserveInventorySlots(player?.runInventory, getRunInventoryCapacity(player?.equipment));
  const kept = keepSlotIndices instanceof Set ? keepSlotIndices : new Set(keepSlotIndices);
  let nextStorage = normalizeStorage((storageItems || []).filter(Boolean));
  let movedQuantity = 0;
  let remainingQuantity = 0;
  runInventory.forEach((stack, index) => {
    if (!stack || kept.has(index)) return;
    const transaction = depositIntoStorage(nextStorage, stack);
    if (!transaction.success) { remainingQuantity += stack.quantity; return; }
    movedQuantity += stack.quantity;
    nextStorage = transaction.storage;
    runInventory[index] = null;
  });
  return {
    player: { ...withoutLegacyInventory(player), runInventory },
    storageItems: nextStorage,
    stashSlots: nextStorage,
    movedQuantity,
    remainingQuantity,
  };
};

export const needsHighValueConfirmation = item => {
  const def = findItemData(getItemId(item));
  return Boolean(def && (def.rarity === 'Редкая' || def.type === 'equipment' || def.type === 'quest'));
};
