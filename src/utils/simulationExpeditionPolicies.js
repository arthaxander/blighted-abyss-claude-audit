import { FIELD_CRAFTING_RECIPES } from '../data/recipes';
import { equipmentByName } from '../data/equipment';
import { applyEquipmentPatch, equipItemInSlots, getEquipmentSlotForItem, validateClassEquipment } from './equipmentManager';
import { craftRunInventoryRecipe, getRunInventoryLayout, insertItems, normalizeInventorySlots, slotsToLegacyInventory } from './expeditionInventory';
import { applyInventoryItemUse } from './inventoryItemUse';
import { getItemDefinition } from '../data/items';

export const GEAR_POLICY_IDS = Object.freeze(['off', 'simple', 'smart']);
export const CRAFT_POLICY_IDS = Object.freeze(['off', 'balanced', 'cautious', 'greedy']);
export const EXTRACTION_POLICY_IDS = Object.freeze(['off', 'cautious', 'balanced', 'greedy']);

const rarityScore = { Обычная: 0, Необычная: 2, Редкая: 4, Первозданная: 8 };
const statWeightsByClass = {
  Archer: { attack: 4, magAtk: 0.25, maxHp: 0.45, physDef: 1.5, magicDef: 1.2, speed: 2.5, critChance: 180, dodge: 150 },
  Defender: { attack: 2.5, magAtk: 0.2, maxHp: 0.7, physDef: 2.5, magicDef: 2, speed: 1.2, critChance: 80, dodge: 80 },
  Mage: { attack: 0.25, magAtk: 4, maxHp: 0.45, physDef: 1.2, magicDef: 1.8, speed: 2, critChance: 150, dodge: 100 },
  Elementalist: { attack: 0.25, magAtk: 4, maxHp: 0.45, physDef: 1.2, magicDef: 1.8, speed: 2, critChance: 150, dodge: 100 },
};

const buildSignals = player => {
  const authored = JSON.stringify([player?.abilities || [], player?.equippedClassPassiveIds || [], player?.classFeature || {}]).toLowerCase();
  return {
    bleed: authored.includes('bleed') || authored.includes('кровотеч'),
    poison: authored.includes('poison') || authored.includes('отравлен'),
    shield: authored.includes('shield') || authored.includes('щит'),
    trap: authored.includes('trap') || authored.includes('ловуш'),
    summon: authored.includes('summon') || authored.includes('призыв'),
    elemental: ['Mage', 'Elementalist'].includes(player?.class),
  };
};

export const scoreSimulationGear = (item, player, mode = 'smart') => {
  if (!item) return { total: -Infinity, raw: -Infinity, synergy: 0 };
  const weights = statWeightsByClass[player?.class] || statWeightsByClass.Defender;
  const raw = Object.entries(item.stats || {}).reduce((sum, [stat, value]) => sum + (weights[stat] || 0.5) * Number(value || 0), 0)
    + (rarityScore[item.rarity] || 0);
  if (mode !== 'smart') return { total: raw, raw, synergy: 0 };
  const signals = buildSignals(player);
  const tags = new Set([...(item.mechanicTags || []), ...(item.smartLootTags?.buildTags || [])].map(tag => String(tag).toLowerCase()));
  let synergy = 0;
  if ([...tags].some(tag => tag.includes('bleed')) && signals.bleed) synergy += 35;
  if ([...tags].some(tag => tag.includes('poison')) && signals.poison) synergy += 25;
  if ([...tags].some(tag => tag.includes('shield')) && signals.shield) synergy += 20;
  if ([...tags].some(tag => tag.includes('trap')) && signals.trap) synergy += 20;
  if ([...tags].some(tag => tag.includes('summon')) && signals.summon) synergy += 20;
  if ([...tags].some(tag => ['fire', 'ice', 'lightning', 'reaction'].some(signal => tag.includes(signal))) && signals.elemental) synergy += 20;
  return { total: raw + synergy, raw, synergy };
};

export const applySimulationGearPolicy = (player, acquired = [], policy = 'smart') => {
  if (!GEAR_POLICY_IDS.includes(policy)) throw new Error(`Unknown gear policy: ${policy}`);
  if (policy === 'off') return { player, decisions: [] };
  let next = player; const decisions = [];
  acquired.forEach(entry => {
    const candidate = equipmentByName[entry?.name];
    if (!candidate || !validateClassEquipment(next.class, candidate).canEquip) return;
    const slot = getEquipmentSlotForItem(candidate, next.equipment);
    const currentName = slot && (typeof next.equipment?.[slot] === 'string' ? next.equipment[slot] : next.equipment?.[slot]?.itemId);
    const current = equipmentByName[currentName];
    const candidateScore = scoreSimulationGear(candidate, next, policy);
    const currentScore = scoreSimulationGear(current, next, policy);
    const equip = candidateScore.total > currentScore.total + 0.001;
    decisions.push({ item: candidate.name, current: current?.name || null, slot, equip, candidateScore, currentScore });
    if (!equip) return;
    const result = equipItemInSlots(next.equipment, candidate);
    if (!result) return;
    let slots = normalizeInventorySlots(next.runInventory, next.runInventory?.length || 10);
    let removed = false;
    slots = slots.map(stack => {
      if (removed || stack?.itemId !== candidate.name) return stack;
      removed = true;
      return stack.quantity > 1 ? { ...stack, quantity: stack.quantity - 1 } : null;
    });
    const returned = result.returnedItems.map(item => ({ itemId: typeof item === 'string' ? item : item.itemId, quantity: 1 }));
    slots = insertItems(slots, returned, { layout: getRunInventoryLayout(next.equipment) }).slots;
    const inventory = slotsToLegacyInventory(slots);
    const patch = applyEquipmentPatch(next, result.equipment, inventory);
    next = { ...next, ...patch, runInventory: slots, inventory };
  });
  return { player: next, decisions };
};

const poulticeRecipe = FIELD_CRAFTING_RECIPES.find(recipe => recipe.id === 'blood_moss_poultice');
export const applyPoulticeCraftPolicy = (player, policy = 'balanced', rng = Math.random) => {
  if (!CRAFT_POLICY_IDS.includes(policy)) throw new Error(`Unknown craft policy: ${policy}`);
  const metrics = { crafted: 0, used: 0, preserved: 0, usedByItemId: {}, hpRestored: 0, recoveryEvents: 0, insufficient: 0, ingredientsConsumed: {} };
  if (policy === 'off' || !poulticeRecipe) return { player, metrics };
  const missingThreshold = { cautious: 4, balanced: 8, greedy: 13 }[policy];
  let next = player; let recovered = false;
  while ((next.maxHp - next.hp) >= missingThreshold) {
    let slotIndex = next.runInventory.findIndex(stack => stack?.itemId === poulticeRecipe.result.name);
    if (slotIndex < 0) {
      const crafted = craftRunInventoryRecipe(next, poulticeRecipe);
      if (!crafted.success) { if (crafted.reason === 'missing-ingredients') metrics.insufficient += 1; break; }
      next = crafted.player; metrics.crafted += 1;
      poulticeRecipe.ingredients.forEach(i => { metrics.ingredientsConsumed[i.name] = (metrics.ingredientsConsumed[i.name] || 0) + i.quantity; });
      slotIndex = next.runInventory.findIndex(stack => stack?.itemId === poulticeRecipe.result.name);
    }
    const before = next.hp;
    const used = applyInventoryItemUse(next, slotIndex, { inExpedition: true, inCombat: false, rng });
    if (!used.used) break;
    next = used.player; metrics.used += 1; metrics.preserved += used.preserved ? 1 : 0;
    metrics.usedByItemId[poulticeRecipe.result.name] = (metrics.usedByItemId[poulticeRecipe.result.name] || 0) + 1;
    metrics.hpRestored += next.hp - before; recovered = true;
  }
  metrics.recoveryEvents = recovered ? 1 : 0;
  return { player: next, metrics };
};

const VISIBLE_ROOM_BASE_THREAT = { boss: 0.7, cursedEnemy: 0.52, combat: 0.2 };
export const scoreVisibleEncounterThreat = (choice, player = null) => {
  const roomBase = VISIBLE_ROOM_BASE_THREAT[choice?.roomType] ?? 0.08;
  const visibleEnemies = Array.isArray(choice?.enemies) ? choice.enemies.filter(Boolean) : [];
  if (!visibleEnemies.length) return roomBase;
  const physDef = Math.max(0, Number(player?.physDef) || 0);
  const magicDef = Math.max(0, Number(player?.magicDef) || 0);
  const composition = visibleEnemies.reduce((score, enemy) => {
    const attack = Math.max(0, Number(enemy.attack) || 0);
    const magAtk = Math.max(0, Number(enemy.magAtk) || 0);
    const offense = Math.max(0, attack - physDef * 0.35) + Math.max(0, magAtk - magicDef * 0.35);
    const abilities = Array.isArray(enemy.abilities) ? enemy.abilities : [];
    const aoePressure = abilities.some(ability => ['all', 'all_enemies', 'aoe'].includes(ability?.targeting || ability?.target)) ? 0.08 : 0;
    const authoredRank = enemy.boss ? 0.18 : enemy.miniBoss || enemy.cursed ? 0.1 : enemy.strong ? 0.05 : 0;
    return score + 0.07 + Math.min(0.18, offense / 120) + aoePressure + authoredRank;
  }, 0);
  return Math.min(1.5, roomBase + composition);
};

const visibleThreat = (choices, player) => Math.max(0, ...(choices || []).map(choice => scoreVisibleEncounterThreat(choice, player)));
export const decideVoluntaryExtraction = ({ player, choices, policy = 'balanced', completedCombats = 0 } = {}) => {
  if (!EXTRACTION_POLICY_IDS.includes(policy)) throw new Error(`Unknown extraction policy: ${policy}`);
  if (policy === 'off' || completedCombats < 1) return { extract: false, reason: null };
  const hpRatio = player?.maxHp ? player.hp / player.maxHp : 1;
  const healing = (player?.items || []).filter(item => (typeof item === 'string' ? item : item?.name) === 'Малое зелье здоровья').length;
  const defensiveItems = (player?.items || []).filter(item => {
    const definition = getItemDefinition(typeof item === 'string' ? item : item?.name);
    return (definition?.effects || []).some(effect => ['shield', 'defense_up', 'magic_defense_up'].includes(effect.id));
  }).length;
  const readyDefense = (player?.abilities || []).some(ability => !ability.passive && (ability.currentCooldown || 0) <= 0 && (
    ability.targeting === 'self' || String(JSON.stringify(ability.effects || ability.effect || '') || '').toLowerCase().includes('shield')
  ));
  const reserve = hpRatio + Math.min(0.3, healing * 0.12) + Math.min(0.2, defensiveItems * 0.08) + (readyDefense ? 0.08 : 0);
  const threat = visibleThreat(choices, player);
  const threshold = ({ cautious: 0.7, balanced: 0.5, greedy: 0.32 }[policy]) + threat * ({ cautious: 0.2, balanced: 0.18, greedy: 0.12 }[policy]);
  return reserve < threshold
    ? { extract: true, reason: threat >= 0.8 ? 'high-next-threat' : healing ? 'policy-risk-threshold' : 'insufficient-recovery' }
    : { extract: false, reason: null };
};

export { FIELD_CRAFT_POLICY_IDS, applyFieldCraftingPolicy } from './fieldCraftingPolicy';
