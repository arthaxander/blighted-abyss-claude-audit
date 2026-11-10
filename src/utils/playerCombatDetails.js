import { equipmentByName } from '../data/equipment';
import { EQUIPMENT_DETAILS } from '../data/itemDetailsPresentation';
import { ensureRelicState, getRelicById } from '../data/relics';
import { getClassCombatPassive } from '../data/classPassives';
import { getClassPassiveById } from '../data/classProgression';
import { getRuneById } from '../data/runes';
import { DEFAULT_CRIT_CHANCE, DEFAULT_CRIT_DAMAGE } from './combatUtils';

const isRawStatRelicLevel = description => /^\s*[+−-]\d/.test(description || '');

export const getCombatantSecondaryStats = combatant => ({
  dodge: Math.max(combatant?.dodge ?? 0, combatant?.statAdditives?.dodgeBonus ?? 0),
  critChance: combatant?.critChance ?? combatant?.baseStats?.critChance ?? DEFAULT_CRIT_CHANCE,
  critDamage: 1 + (combatant?.critDamage ?? combatant?.baseStats?.critDamage ?? DEFAULT_CRIT_DAMAGE),
});

export const getPlayerCombatStats = player => {
  const secondary = getCombatantSecondaryStats(player);
  return [
  { key: 'speed', label: 'Скорость', value: player?.speed ?? player?.baseStats?.speed ?? 0 },
  { key: 'dodge', label: 'Уворот', value: secondary.dodge },
  { key: 'attack', label: 'Физ. атака', value: player?.attack ?? player?.baseStats?.attack ?? 0 },
  { key: 'magAtk', label: 'Маг. атака', value: player?.magAtk ?? player?.baseStats?.magAtk ?? 0 },
  { key: 'physDef', label: 'Физ. защ.', value: player?.physDef ?? player?.baseStats?.physDef ?? 0 },
  { key: 'magicDef', label: 'Маг. защ.', value: player?.magicDef ?? player?.baseStats?.magicDef ?? 0 },
  { key: 'critChance', label: 'Крит. шанс', value: secondary.critChance },
  { key: 'critDamage', label: 'Крит. урон', value: secondary.critDamage },
  ];
};

export const getRunePassiveSources = player => Object.values(player?.activeRunes || {}).filter(Boolean).map(runeId => {
  const rune = getRuneById(runeId);
  if (!rune) return null;
  let stateText = null;
  if (rune.id === 'ember_heart') stateText = `${(player?._flameRuneActions || 0) % 3} / 3 атак`;
  if (rune.id === 'astral_focus') stateText = player?._astralEchoAvailable ? 'Готово' : 'Использовано';
  return { key: `rune-${rune.id}`, label: rune.name, descriptions: [rune.effectDescription], stateText };
}).filter(Boolean);

export const getPlayerPassiveSources = (player, sourcePlayer = player, { includeClassFeature = true } = {}) => {
  const sources = [];
  const classPassive = includeClassFeature ? getClassCombatPassive(player) : null;
  if (classPassive) sources.push({
    key: 'class',
    kind: 'classFeature',
    label: classPassive.name,
    descriptionParts: classPassive.descriptionParts || [classPassive.description],
  });

  (player?.equippedClassPassiveIds || []).filter(Boolean).forEach(passiveId => {
    const passive = getClassPassiveById(player?.class, passiveId);
    if (passive) sources.push({ key: `class-passive-${passive.id}`, kind: 'equippedPassive', label: passive.name, descriptionParts: passive.descriptionParts || [passive.description] });
  });

  const relicState = ensureRelicState(sourcePlayer?.relics);
  const relicId = player?.activeRelicId || relicState.activeRelicId;
  const relic = getRelicById(relicId);
  const relicLevel = relicState.progress?.[relicId]?.level ?? 0;
  const activeRelicRules = (relic?.levels || []).slice(0, relicLevel)
    .map(level => level.description)
    .filter(description => description && !isRawStatRelicLevel(description));
  if (relic && relicLevel > 0) sources.push({
    key: 'relic',
    kind: 'externalPassive',
    label: `Реликвия — ${relic.name} ${relicLevel}`,
    descriptions: activeRelicRules,
  });

  Object.values(player?.equipment || {}).filter(Boolean).forEach(item => {
    const itemName = typeof item === 'string' ? item : item.itemId;
    const details = EQUIPMENT_DETAILS[itemName];
    if (!equipmentByName[itemName] || details?.combatPassive === false) return;
    const effectParts = details?.effectParts || [];
    if (effectParts.length) sources.push({ key: `equipment-${itemName}`, kind: 'externalPassive', label: itemName, descriptionParts: effectParts });
  });
  sources.push(...getRunePassiveSources(player));
  return sources;
};
