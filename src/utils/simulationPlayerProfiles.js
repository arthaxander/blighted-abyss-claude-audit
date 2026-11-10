import { ABILITY_LIBRARY, createAbilityByName } from '../data/abilityPresets';
import {
  ACTIVE_SKILL_SLOT_COUNT, CLASS_PROGRESSION_DEFINITIONS, ensureClassProgression,
  getPassiveSlotCount,
} from '../data/classProgression';
import { getPlayableClassDefinition } from '../data/classTemplates';
import { DEFAULT_RELIC_ID, ensureRelicState, getRelicBonuses, getRelicById } from '../data/relics';
import { getItemDefinition } from '../data/items';
import { applyEquipmentPatch, normalizeEquipmentLoadout, validateClassEquipment } from './equipmentManager';
import { createProductionFreshCharacter } from './characterFactory';
import { equipmentByName } from '../data/equipment';
import { getRunInventoryLayout, legacyInventoryToSlots } from './expeditionInventory';

export const SIMULATION_PROFILE_IDS = Object.freeze(['fresh', 'established', 'prepared', 'production_fresh', 'bare_base']);
export const SIMULATION_BUILD_IDS = Object.freeze(['default']);

const PROFILE_TIERS = Object.freeze({
  established: Object.freeze({ classLevel: 4, cumulativeClassXp: 450, relicLevel: 1 }),
  prepared: Object.freeze({ classLevel: 9, cumulativeClassXp: 2500, relicLevel: 2 }),
});

export const SIMULATION_CONTROL_PROFILES = Object.freeze({
  Defender: Object.freeze({
    established: Object.freeze({ activeIds: ['endurance', 'blood_ram', 'shield_bash', 'shockwave'], passiveIds: ['last_stand'], equipment: { helmet: 'Красный Колпак Старшего Крысолова', armor: 'Куртка Мародёра', legs: 'Укреплённые поножи', mainHand: 'Ржавый меч новобранца', offHand: 'Щит Новобранца', amulet: 'Амулет Крысиной Жилы', bag: 'Походная сумка Гильдии' }, consumables: [{ id: 'Малое зелье здоровья', quantity: 2 }, { id: 'Кровяная припарка', quantity: 2 }] }),
    prepared: Object.freeze({ activeIds: ['endurance', 'shockwave', 'ram', 'shield_throw'], passiveIds: ['last_stand'], equipment: { helmet: 'Красный Колпак Старшего Крысолова', armor: 'Куртка Мародёра', legs: 'Сапоги перебежчика', mainHand: 'Булава Старого Сотника', offHand: 'Щит Дозорного Гильдии', ring1: 'Железное Кольцо Караульного', amulet: 'Амулет Крысиной Жилы', bag: 'Походная сумка Гильдии' }, consumables: [{ id: 'Малое зелье здоровья', quantity: 3 }, { id: 'Кровяная припарка', quantity: 3 }] }),
  }),
  Archer: Object.freeze({
    established: Object.freeze({ activeIds: ['serrated_arrow', 'fire_arrow', 'finishing_shot', 'wolf_pit'], passiveIds: ['initiative'], equipment: { helmet: 'Красный Колпак Старшего Крысолова', armor: 'Плащ разведчика', legs: 'Укреплённые поножи', mainHand: 'Лук Спороносца', amulet: 'Амулет Крысиной Жилы', bag: 'Походная сумка Гильдии' }, consumables: [{ id: 'Малое зелье здоровья', quantity: 2 }, { id: 'Кровяная припарка', quantity: 2 }] }),
    prepared: Object.freeze({ activeIds: ['serrated_arrow', 'wolf_pit', 'redirect', 'arrow_volley'], passiveIds: ['initiative'], equipment: { helmet: 'Капюшон Следопыта', armor: 'Плащ разведчика', legs: 'Крысиные обмотки', mainHand: 'Лук Спороносца', ring1: 'Кольцо Меткой Тетивы', amulet: 'Амулет Крысиной Жилы', bag: 'Походная сумка Гильдии' }, consumables: [{ id: 'Малое зелье здоровья', quantity: 3 }, { id: 'Кровяная припарка', quantity: 3 }] }),
  }),
  Mage: Object.freeze({
    established: Object.freeze({ activeIds: ['fireball', 'chain_lightning', 'frost_shield', 'blizzard'], passiveIds: ['elemental_shell'], equipment: { helmet: 'Капюшон Искателя Знаков', armor: 'Плащ Тусклого Оберега', legs: 'Укреплённые поножи', mainHand: 'Фокус Ледяного Спора', offHand: 'Полевой гримуар Отступника', bag: 'Походная сумка Гильдии' }, consumables: [{ id: 'Малое зелье здоровья', quantity: 2 }, { id: 'Кровяная припарка', quantity: 2 }] }),
    prepared: Object.freeze({ activeIds: ['fireball', 'blizzard', 'storm_discharge', 'elemental_echo'], passiveIds: ['elemental_shell'], equipment: { helmet: 'Капюшон Искателя Знаков', armor: 'Мантия Погасшего Костра', legs: 'Сапоги перебежчика', mainHand: 'Фокус Ледяного Спора', offHand: 'Полевой гримуар Отступника', ring1: 'Кольцо Переменчивой Искры', amulet: 'Амулет Трёх Искр', bag: 'Походная сумка Гильдии' }, consumables: [{ id: 'Малое зелье здоровья', quantity: 3 }, { id: 'Кровяная припарка', quantity: 3 }] }),
  }),
});

const buildProfileProgression = (classId, tier, activeIds, passiveIds) => {
  const base = ensureClassProgression(); const definition = CLASS_PROGRESSION_DEFINITIONS[classId];
  const unlockedSkillIds = definition.skills.filter(skill => skill.requiredLevel <= tier.classLevel).map(skill => skill.id);
  return { ...base, [classId]: { ...base[classId], classLevel: tier.classLevel, cumulativeClassXp: tier.cumulativeClassXp, unlockedSkillIds, activeSkillIds: activeIds.map(id => getAbilityByStableId(id)?.name), purchasedPassiveIds: passiveIds, equippedPassiveIds: passiveIds, spentClassPoints: activeIds.filter(id => !definition.startingSkillIds.includes(getAbilityByStableId(id)?.name)).length + passiveIds.length } };
};

const abilitiesByStableId = Object.entries(ABILITY_LIBRARY).reduce((map, [presetKey, ability]) => {
  if (ability?.artId && !map[ability.artId]) map[ability.artId] = { ...ability, name: presetKey, presetKey };
  return map;
}, {});

export const getAbilityByStableId = id => abilitiesByStableId[id] || null;
export const getStableAbilityId = ability => ability?.artId || ability?.presetKey || null;

const setRelicLevel = (raw, relicId, level) => {
  const relic = getRelicById(relicId);
  if (!relic) throw new Error(`Unknown relic id: ${relicId}`);
  if (!Number.isInteger(level) || level < 0 || level > relic.levels.length) {
    throw new Error(`Relic level for ${relicId} must be an integer from 0 to ${relic.levels.length}`);
  }
  const ensured = ensureRelicState(raw);
  return {
    ...ensured,
    activeRelicId: relicId,
    discoveredRelicIds: [...new Set([...ensured.discoveredRelicIds, relicId])],
    progress: { ...ensured.progress, [relicId]: { level, xp: 0 } },
  };
};

const normalizeItems = items => (items || []).flatMap(entry => {
  if (typeof entry === 'string') return [entry];
  const quantity = Number(entry?.quantity ?? 1);
  if (!entry?.id || !Number.isInteger(quantity) || quantity < 0) throw new Error('Consumables require a canonical id and a non-negative integer quantity');
  return Array.from({ length: quantity }, () => entry.id);
});

const validateItems = items => items.forEach(name => {
  const definition = getItemDefinition(name);
  if (!definition) throw new Error(`Unknown combat consumable: ${name}`);
  if (!['heal', 'effects', 'cleanse', 'ability'].includes(definition.type)) throw new Error(`${name} is not combat-usable`);
});

const resolveBuild = ({ player, build = 'default', activeIds, passiveIds, allowIllegal = false }) => {
  if (build !== 'default' && (!activeIds || !Array.isArray(activeIds))) throw new Error(`Unknown simulation build: ${build}`);
  if (build === 'default' && !activeIds && !passiveIds) return { player, buildId: 'default' };
  const progression = ensureClassProgression(player.classProgression, player);
  const record = progression[player.class];
  const resolved = (activeIds || []).map(id => {
    const ability = getAbilityByStableId(id);
    if (!ability) throw new Error(`Unknown stable ability id: ${id}`);
    return ability;
  });
  if (resolved.length > ACTIVE_SKILL_SLOT_COUNT) throw new Error(`Active build exceeds ${ACTIVE_SKILL_SLOT_COUNT} slots`);
  if (new Set(activeIds || []).size !== (activeIds || []).length) throw new Error('Active build contains duplicate ability ids');
  if (!allowIllegal && resolved.some(ability => !record.unlockedSkillIds.includes(ability.name))) throw new Error('Active build contains an ability not unlocked by profile progression');
  const passives = passiveIds || [];
  const knownPassives = new Set((CLASS_PROGRESSION_DEFINITIONS[player.class]?.passiveSkills || []).map(entry => entry.id));
  if (new Set(passives).size !== passives.length || passives.some(id => !knownPassives.has(id))) throw new Error('Passive build contains an unknown or duplicate passive id');
  if (!allowIllegal && (passives.length > getPassiveSlotCount(player.class, record.classLevel) || passives.some(id => !record.purchasedPassiveIds.includes(id)))) throw new Error('Passive build is not supported by profile progression');
  const abilities = [...resolved.map(ability => createAbilityByName(ability.name, player.baseAtk ?? player.attack)), createAbilityByName('Атака', player.baseAtk ?? player.attack)];
  return { player: { ...player, abilities, abilityNames: abilities.map(entry => entry.name), equippedClassPassiveIds: [...passives] }, buildId: build === 'default' ? 'custom' : build };
};

export const snapshotSimulationPlayer = (player, { profileId, buildId } = {}) => {
  const relics = ensureRelicState(player.relics);
  const relicId = relics.activeRelicId;
  const relicLevel = relics.progress?.[relicId]?.level || 0;
  return {
    profileId, buildId, classId: player.class,
    baseStats: { ...player.baseStats },
    derivedStats: ['maxHp', 'attack', 'magAtk', 'physDef', 'magicDef', 'speed', 'critChance', 'critDamage', 'dodge'].reduce((out, key) => ({ ...out, [key]: player[key] ?? 0 }), {}),
    equipment: { ...player.equipment },
    relic: { id: relicId, name: getRelicById(relicId)?.name, level: relicLevel, xp: relics.progress?.[relicId]?.xp || 0, bonuses: getRelicBonuses(relicId, relicLevel) },
    activeAbilityIds: (player.abilities || []).filter(ability => ability.name !== 'Атака').map(getStableAbilityId),
    passiveIds: [...(player.equippedClassPassiveIds || [])],
    consumables: Object.entries((player.runInventory || []).filter(Boolean).reduce((out, stack) => { out[stack.itemId] = (out[stack.itemId] || 0) + (stack.quantity || 1); return out; }, {})).map(([id, quantity]) => ({ id, quantity })),
    classProgression: { ...ensureClassProgression(player.classProgression, player)[player.class] },
    inventoryLayout: getRunInventoryLayout(player.equipment).capacities,
    runInventory: (player.runInventory || []).filter(Boolean).map((stack, index) => ({ index, itemId: stack.itemId, quantity: stack.quantity })),
    attainability: profileId === 'fresh' || profileId === 'production_fresh' ? 'authoritative production new-character state' : 'simulator control assembled only from pre-boss level-one drops, crafts, purchases, and legal class progression',
  };
};

export const resolveSimulationPlayerProfile = ({
  profile = 'fresh', classId = 'Archer', build = 'default', activeIds,
  passiveIds, relicId = DEFAULT_RELIC_ID, relicLevel, equipment, progression,
  consumables, allowIllegal = false,
} = {}) => {
  if (!SIMULATION_PROFILE_IDS.includes(profile)) throw new Error(`Unknown simulation profile: ${profile}`);
  const definition = getPlayableClassDefinition(classId);
  if (!definition) throw new Error(`Unknown combat simulation class: ${classId}`);
  const canonicalProfile = profile === 'production_fresh' ? 'fresh' : profile;
  const control = SIMULATION_CONTROL_PROFILES[classId]?.[canonicalProfile];
  const tier = PROFILE_TIERS[canonicalProfile];
  const resolvedActiveIds = activeIds || control?.activeIds;
  const resolvedPassiveIds = passiveIds || control?.passiveIds;
  const resolvedProgression = progression || (tier && control ? buildProfileProgression(classId, tier, resolvedActiveIds, resolvedPassiveIds) : undefined);
  let player = createProductionFreshCharacter({ classId, classProgression: resolvedProgression });
  if (profile === 'bare_base') {
    player = { ...player, equipment: {}, runInventory: [], items: [] };
    player = { ...player, ...applyEquipmentPatch(player, {}, []) };
  }
  const resolvedEquipment = equipment || control?.equipment;
  if (resolvedEquipment) {
    Object.values(normalizeEquipmentLoadout(resolvedEquipment, [], classId).equipment).filter(Boolean).forEach(ref => {
      const id = typeof ref === 'string' ? ref : ref.itemId || ref.name;
      if (!allowIllegal && !validateClassEquipment(classId, equipmentByName[id]).canEquip) throw new Error(`Illegal equipment for ${classId}: ${id}`);
    });
    const { inventory: ignoredLegacyInventory, ...patch } = applyEquipmentPatch(player, resolvedEquipment, []);
    player = { ...player, ...patch };
  }
  const level = relicLevel === undefined ? (tier?.relicLevel ?? (ensureRelicState(player.relics).progress?.[relicId]?.level || 0)) : Number(relicLevel);
  player.relics = setRelicLevel(player.relics, relicId, level);
  if (progression) player.classProgression = ensureClassProgression(progression, player);
  const resolvedConsumables = consumables || control?.consumables?.filter(entry => getItemDefinition(entry.id));
  const items = resolvedConsumables === undefined
    ? (player.runInventory || []).flatMap(stack => stack ? Array.from({ length: stack.quantity || 1 }, () => stack.itemId) : []).filter(item => Boolean(getItemDefinition(item)))
    : normalizeItems(resolvedConsumables);
  validateItems(items);
  const layout = getRunInventoryLayout(player.equipment);
  const backpackItems = consumables === undefined && control?.consumables ? normalizeItems(control.consumables) : items;
  player = { ...player, items: [...items], runInventory: legacyInventoryToSlots(backpackItems, layout.totalCapacity, [], layout) };
  const built = resolveBuild({ player, build, activeIds: resolvedActiveIds, passiveIds: resolvedPassiveIds, allowIllegal });
  return { player: built.player, snapshot: snapshotSimulationPlayer(built.player, { profileId: canonicalProfile, buildId: built.buildId }) };
};
