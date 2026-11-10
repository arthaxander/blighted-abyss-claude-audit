import { createAbilityByName } from '../data/abilityPresets';
import { applyEquipmentPatch, normalizeEquipmentLoadout } from './equipmentManager';
import { createItemStack, getRunInventoryLayout, insertItems, preserveInventorySlots } from './expeditionInventory';
import { applyClassLoadoutToPlayer, ensureClassProgression } from '../data/classProgression';
import { createClassBaseStats } from '../data/classTemplates';

export const DEVELOPER_PLAYABLE_CLASSES = Object.freeze([
  { id: 'Defender', label: 'Защитник', abilityNames: ['Стойкость', 'Кровавый таран', 'Устрашение', 'Удар щитом', 'Атака'] },
  { id: 'Mage', label: 'Элементалист', abilityNames: ['Заряд стихий', 'Атака', 'Огненный шар', 'Цепная молния', 'Морозный щит', 'Ледяное копьё'] },
  { id: 'Archer', label: 'Лучник', abilityNames: ['Сквозные раны', 'Зазубренная стрела', 'Прицельный выстрел', 'Добивающий выстрел', 'Быстрый перехват', 'Атака'] },
]);

/** Shared, safe class transition used by both the Guild and the developer panel. */
export const switchPlayerClass = (player, classId, { inCombat = false } = {}) => {
  if (inCombat) return { success: false, player, reason: 'Нельзя менять класс во время боя' };
  const definition = DEVELOPER_PLAYABLE_CLASSES.find(entry => entry.id === classId);
  if (!player || !definition) return { success: false, player, reason: 'Класс недоступен' };
  const normalized = normalizeEquipmentLoadout(player.equipment, [], classId);
  let runInventory = player.runInventory || [];
  if (normalized.returnedItems.length) {
    const layout = getRunInventoryLayout(normalized.equipment);
    const insertion = insertItems(preserveInventorySlots(runInventory, layout.totalCapacity), normalized.returnedItems.map(item => createItemStack(item)), { layout });
    if (insertion.rejected.length) return { success: false, player, reason: 'Недостаточно места, чтобы безопасно снять несовместимое снаряжение' };
    runInventory = insertion.slots;
  }
  const abilityNames = [...definition.abilityNames];
  const baseStats = createClassBaseStats(classId);
  const progression = ensureClassProgression(player.classProgression, player);
  // A progression marker describes deltas already applied to the *current*
  // class. It is invalid as soon as the destination base is installed.
  const { inventory: legacyInventory, safeSlots: legacySafeSlots, classProgressionStatBonus: oldClassProgressionStatBonus, ...canonicalPlayer } = player;
  let next = {
    ...canonicalPlayer,
    class: classId,
    ...baseStats,
    hp: baseStats.maxHp,
    baseAtk: baseStats.attack,
    baseStats,
    abilityNames,
    abilities: abilityNames.map(name => createAbilityByName(name, baseStats.attack)),
    runInventory,
    classProgression: progression,
  };
  next = applyClassLoadoutToPlayer(next, progression);
  // Class switching has always restored the destination character to full HP.
  // Do this after progression, so equipment preserves the correct 100% ratio.
  next = { ...next, hp: next.maxHp };
  const { inventory: ignoredLegacyInventory, ...patch } = applyEquipmentPatch(next, normalized.equipment, [], player.runes);
  return { success: true, player: { ...next, ...patch, runInventory }, returnedItems: normalized.returnedItems };
};

// Compatibility for existing callers and saved development tooling.
export const switchDeveloperClass = switchPlayerClass;
