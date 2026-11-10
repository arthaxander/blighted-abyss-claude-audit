import { createAbilityByName } from '../data/abilityPresets';
import { applyClassLoadoutToPlayer, ensureClassProgression } from '../data/classProgression';
import { getPlayableClassDefinition, createClassBaseStats } from '../data/classTemplates';
import { DEFAULT_MAGIC_SCHOOL } from '../constants/magicSchools';
import { ensureRelicState } from '../data/relics';
import { createRuneState } from '../data/runes';
import { initializeQuestLog } from '../data/quests';
import { applyEquipmentPatch, createEmptyEquipmentSlots } from './equipmentManager';
import { getRunInventoryLayout, legacyInventoryToSlots } from './expeditionInventory';

export const STARTING_INVENTORY = Object.freeze([
  'Малое зелье здоровья',
  'Малое зелье здоровья',
]);

export const STARTER_FISHING_ROD = 'Костяная удочка';

const STARTER_WEAPON_BY_CLASS = Object.freeze({
  Defender: 'Ржавый меч новобранца',
  Mage: 'Треснувший учебный фокус',
  Archer: 'Старый короткий лук',
});

export const createStarterEquipmentSlots = classId => {
  const equipment = createEmptyEquipmentSlots();
  equipment.mainHand = STARTER_WEAPON_BY_CLASS[classId] || null;
  if (classId === 'Defender') equipment.offHand = 'Щит Новобранца';
  return equipment;
};

export const createStartingExpeditionLoadout = (equipment = {}) => ({
  inventory: [...STARTING_INVENTORY],
  runInventory: legacyInventoryToSlots(STARTING_INVENTORY, getRunInventoryLayout(equipment).totalCapacity, [], getRunInventoryLayout(equipment)),
  runSilver: 0,
  fishingTool: STARTER_FISHING_ROD,
  fishingSetup: { rod: STARTER_FISHING_ROD, bait: '' },
});

/** The one authoritative fresh-character constructor shared by UI and simulators. */
export const createProductionFreshCharacter = ({ name = 'Новобранец', classId = 'Defender', classProgression } = {}) => {
  const definition = getPlayableClassDefinition(classId);
  if (!definition) throw new Error(`Unknown playable class: ${classId}`);
  const baseStats = createClassBaseStats(definition);
  const equipment = createStarterEquipmentSlots(classId);
  const expedition = createStartingExpeditionLoadout(equipment);
  const progression = ensureClassProgression(classProgression, { class: classId, abilityNames: definition.abilityNames });
  const draft = {
    name, class: classId, ...definition.stats, baseAtk: definition.stats.attack,
    abilities: definition.abilityNames.map(abilityName => createAbilityByName(abilityName, definition.stats.attack)),
    abilityNames: [...definition.abilityNames], ...expedition, equipment, silver: 0,
    turnMeter: 0, debuffs: [], buffs: [], shield: 0, baseStats,
    relics: ensureRelicState(), critChance: definition.stats.critChance ?? 0.1,
    critDamage: definition.stats.critDamage ?? 0.5, dodge: definition.stats.dodge ?? 0,
    runes: createRuneState(), questLog: initializeQuestLog(),
    weaponMagicSchool: classId === 'Mage' ? DEFAULT_MAGIC_SCHOOL : null,
    curses: {}, tarotSpread: [],
  };
  const progressedDraft = applyClassLoadoutToPlayer({ ...draft, classProgression: progression }, progression);
  const equipmentPatch = applyEquipmentPatch({ ...progressedDraft, hp: progressedDraft.maxHp }, equipment, expedition.inventory);
  const canonical = { ...progressedDraft, ...equipmentPatch };
  const { inventory: legacyInventory, safeSlots: legacySafeSlots, ...player } = canonical;
  return player;
};
