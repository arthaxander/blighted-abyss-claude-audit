import { normalizeFieldLoadout, getFieldPresets, isFieldLoadoutLocked } from '../data/fieldCraftingLoadout';
import { createAbilityByName } from '../data/abilityPresets';
import { ensureRuneState } from '../data/runes';
import { ensureCurseState } from '../data/curses';
import { ensureRelicState } from '../data/relics';
import {
  initializeQuestLog,
  processQuestEvents,
  QUEST_EVENTS,
} from '../data/quests';
import { applyEquipmentPatch, normalizeEquipmentLoadout } from './equipmentManager';
import { createItemStack, getRunInventoryLayout, insertItems, legacyInventoryToSlots, migrateRunInventory, RUN_INVENTORY_LAYOUT_VERSION } from './expeditionInventory';
import { applyClassLoadoutToPlayer, ensureClassProgression } from '../data/classProgression';
import { compactExpeditionMapForSave } from './expeditionMapSnapshot';

export const DEFAULT_CRIT_DAMAGE = 0.5;
export const DEFAULT_CRIT_CHANCE = 0.05;

export const sanitizeAbilityNames = (player) =>
  player?.abilityNames || (player?.abilities || [])
    .map(ability => ability?.presetKey || ability?.name)
    .filter(Boolean);

export const ensureArenaProfile = (profile = {}) => {
  return {
    rating: profile.rating ?? 1000,
    record: {
      wins: profile.record?.wins ?? 0,
      losses: profile.record?.losses ?? 0,
    },
    attackSnapshot: profile.attackSnapshot || null,
    defenseSnapshot: profile.defenseSnapshot || null,
    attackConsumables: (profile.attackConsumables || []).slice(0, 2),
    defenseConsumables: (profile.defenseConsumables || []).slice(0, 2),
    lastArenaOpponent: profile.lastArenaOpponent || null,
  };
};

const restoreNormalizedEquipmentOwnership = (runInventory, normalizedLoadout) => {
  const layout = getRunInventoryLayout(normalizedLoadout.equipment);
  const equippedIds = new Set(Object.values(normalizedLoadout.equipment).map(item => item?.instanceId).filter(Boolean));
  const owned = runInventory.map(item => item?.instanceId && equippedIds.has(item.instanceId) ? null : item);
  const carriedIds = new Set(owned.map(item => item?.instanceId).filter(Boolean));
  const returned = normalizedLoadout.returnedItems
    .map(item => createItemStack(item))
    .filter(item => item && (!item.instanceId || !carriedIds.has(item.instanceId)));
  if (!returned.length) return owned;
  const insertion = insertItems(owned, returned, { layout, allowSafeFallback: false });
  // Hydration is an ownership boundary: changed equipment rules may exceed current
  // typed capacity, so retain exceptional returned instances as migration overflow.
  return insertion.fits ? insertion.slots : [...insertion.slots, ...insertion.rejected.map(item => ({ ...item }))];
};

export const buildPlayerSnapshot = (player) => {
  if (!player) return null;
  const abilityNames = sanitizeAbilityNames(player);
  const { abilities, currentEnemies, combatSession, inventory: legacyInventory, safeSlots: legacySafeSlots, ...rest } = player;
  const normalizedLoadout = normalizeEquipmentLoadout(player.equipment, [], player.class);
  const runInventory = player.runInventory
    ? migrateRunInventory(player.runInventory, normalizedLoadout.equipment, player.runInventoryLayoutVersion)
    : legacyInventoryToSlots(legacyInventory || [], getRunInventoryLayout(normalizedLoadout.equipment).totalCapacity, legacySafeSlots || [], getRunInventoryLayout(normalizedLoadout.equipment));
  const ownedRunInventory = restoreNormalizedEquipmentOwnership(runInventory, normalizedLoadout);
  return {
    ...rest,
    ...(player.expeditionMap ? { expeditionMap: compactExpeditionMapForSave(player.expeditionMap) } : {}),
    abilityNames,
    currentEnemies: undefined,
    combatSession: undefined,
    questLog: initializeQuestLog(player.questLog),
    curses: ensureCurseState(player.curses),
    dominantCurseId: player.dominantCurseId ?? null,
    arenaProfile: ensureArenaProfile(player.arenaProfile),
    tarotSpread: Array.isArray(player.tarotSpread) ? [...player.tarotSpread] : [],
    relics: ensureRelicState(player.relics),
    equipment: normalizedLoadout.equipment,
    runInventory: ownedRunInventory,
    runInventoryLayoutVersion: RUN_INVENTORY_LAYOUT_VERSION,
    runSilver: player.runSilver || 0,
    runResonance: player.runResonance || 0,
    guildSilver: player.guildSilver ?? player.silver ?? 0,
  };
};

export const hydratePlayerSnapshot = (snapshot, { normalizeEquipmentProficiency = true } = {}) => {
  if (!snapshot) return null;
  if (snapshot.expeditionMap) snapshot = { ...snapshot, expeditionMap: compactExpeditionMapForSave(snapshot.expeditionMap) };
  const abilityNames = snapshot.abilityNames || [];
  const baseAttack = snapshot.baseAtk ?? snapshot.attack ?? 0;
  const abilityObjects = abilityNames.length > 0
    ? abilityNames.map(name => createAbilityByName(name, baseAttack))
    : [createAbilityByName('Атака', baseAttack)];
  const normalizedLoadout = normalizeEquipmentLoadout(
    snapshot.equipment,
    [],
    normalizeEquipmentProficiency ? snapshot.class : null
  );
  const runInventory = snapshot.runInventory
    ? migrateRunInventory(snapshot.runInventory, normalizedLoadout.equipment, snapshot.runInventoryLayoutVersion)
    : legacyInventoryToSlots(snapshot.inventory || [], getRunInventoryLayout(normalizedLoadout.equipment).totalCapacity, snapshot.safeSlots || [], getRunInventoryLayout(normalizedLoadout.equipment));
  const ownedRunInventory = restoreNormalizedEquipmentOwnership(runInventory, normalizedLoadout);
  const { inventory: legacyInventory, safeSlots: legacySafeSlots, ...canonicalSnapshot } = snapshot;
  let player = {
    ...canonicalSnapshot,
    fieldCraftingLoadout: normalizeFieldLoadout(snapshot.fieldCraftingLoadout),
    fieldCraftingPresets: getFieldPresets(snapshot),
    fieldCraftingRunLoadout: isFieldLoadoutLocked(snapshot) ? normalizeFieldLoadout(snapshot.fieldCraftingRunLoadout ?? snapshot.fieldCraftingLoadout) : null,
    abilities: abilityObjects,
    abilityNames,
    runes: ensureRuneState(snapshot.runes),
    questLog: initializeQuestLog(snapshot.questLog),
    currentEnemies: undefined,
    curses: ensureCurseState(snapshot.curses),
    dominantCurseId: snapshot.dominantCurseId ?? null,
    arenaProfile: ensureArenaProfile(snapshot.arenaProfile),
    tarotSpread: Array.isArray(snapshot.tarotSpread) ? [...snapshot.tarotSpread] : [],
    relics: ensureRelicState(snapshot.relics),
    equipment: normalizedLoadout.equipment,
    runInventory: ownedRunInventory,
    runInventoryLayoutVersion: RUN_INVENTORY_LAYOUT_VERSION,
    runSilver: snapshot.runSilver || 0,
    runResonance: snapshot.runResonance || 0,
    guildSilver: snapshot.guildSilver ?? snapshot.silver ?? 0,
    classProgression: ensureClassProgression(snapshot.classProgression, snapshot),
  };
  player = applyClassLoadoutToPlayer(player, player.classProgression);
  const { inventory: ignoredLegacyInventory, ...equipmentPatch } = applyEquipmentPatch(
      normalizeEquipmentProficiency ? player : { ...player, class: null },
      player.equipment,
      [],
      player.runes
    );
  Object.assign(player, equipmentPatch);
  const { questLog } = processQuestEvents(
    player.questLog,
    [{ type: QUEST_EVENTS.INVENTORY_CHECK, runInventory: player.runInventory }],
    player
  );
  return { ...player, questLog };
};

