import { getLootOwnershipForLocation } from '../data/lootOwnership';
import { calculateEncounterResonance } from './abyssResonance';

export const ENCOUNTER_REWARD_TIERS = Object.freeze(['ordinary', 'strong', 'miniBoss', 'boss']);

export const ENCOUNTER_REWARD_PROFILES = Object.freeze({
  ordinary: Object.freeze({ silverMultiplier: 1, materialRolls: 1, equipmentChance: 0.05, materialWeights: { common: 0.4, location: 0.6 }, equipmentWeights: { common: 0.35, location: 0.65 } }),
  strong: Object.freeze({ silverMultiplier: 1.5, materialRolls: 2, equipmentChance: 0.2, materialWeights: { common: 0.3, location: 0.7 }, equipmentWeights: { common: 0.25, location: 0.75 } }),
  miniBoss: Object.freeze({ silverMultiplier: 2.5, materialRolls: 2, equipmentChance: 1, materialWeights: { common: 0.3, location: 0.7 }, equipmentWeights: { common: 0.15, location: 0.85 } }),
  boss: Object.freeze({ silverMultiplier: 4, materialRolls: 3, equipmentChance: 1, secondEquipmentChance: 0.25, materialWeights: { common: 0.2, location: 0.8 }, equipmentWeights: { common: 0, location: 1 } }),
});

export const EXPEDITION_ZONE_REWARD_MODIFIERS = Object.freeze({
  approach: Object.freeze({
    materialRollBonus: 0,
    equipmentChanceMultiplier: 1,
    materialWeights: null,
    equipmentWeights: null,
  }),
  sublocation: Object.freeze({
    materialRollBonus: 1,
    equipmentChanceMultiplier: 1.25,
    materialWeights: Object.freeze({ common: 0.2, location: 0.8 }),
    equipmentWeights: Object.freeze({ common: 0.15, location: 0.85 }),
  }),
  depth: Object.freeze({
    materialRollBonus: 1,
    equipmentChanceMultiplier: 1.5,
    materialWeights: Object.freeze({ common: 0.15, location: 0.85 }),
    equipmentWeights: Object.freeze({ common: 0.1, location: 0.9 }),
  }),
});

export const getExpeditionZoneRewardProfile = (baseProfile, expeditionZone = null) => {
  const modifier = EXPEDITION_ZONE_REWARD_MODIFIERS[expeditionZone];
  if (!modifier) return baseProfile;
  return {
    ...baseProfile,
    materialRolls: Math.max(1, baseProfile.materialRolls + modifier.materialRollBonus),
    equipmentChance: Math.min(1, baseProfile.equipmentChance * modifier.equipmentChanceMultiplier),
    materialWeights: modifier.materialWeights || baseProfile.materialWeights,
    equipmentWeights: modifier.equipmentWeights || baseProfile.equipmentWeights,
  };
};

const rankIndex = rank => Math.max(0, ENCOUNTER_REWARD_TIERS.indexOf(rank));

export const normalizeEnemyRewardRank = enemy => {
  if (enemy?.boss || enemy?.rewardRank === 'boss' || enemy?.difficultyTier === 'boss') return 'boss';
  if (enemy?.miniBoss || enemy?.rewardRank === 'miniBoss' || enemy?.difficultyTier === 'miniBoss' || enemy?.encounterPhase === 'elite') return 'miniBoss';
  if (enemy?.rewardRank === 'strong' || enemy?.rank === 'strong' || enemy?.encounterPhase === 'late') return 'strong';
  return 'ordinary';
};

export const createEncounterRewardRoster = enemies => (Array.isArray(enemies) ? enemies : [])
  .filter(enemy => enemy && !enemy.summoned && !enemy.summonOnly && enemy.rewardBearing !== false)
  .map((enemy, index) => ({
    rewardId: enemy.rewardId || `${enemy.id || enemy.name || 'enemy'}:${index}`,
    name: enemy.name,
    rank: normalizeEnemyRewardRank(enemy),
    silverReward: Number(enemy.silverReward) || 25,
    guaranteedLoot: Array.isArray(enemy.guaranteedLoot) ? enemy.guaranteedLoot.map(entry => typeof entry === 'string' ? entry : { ...entry }) : [],
    cursed: enemy.roomRole === 'cursedEnemy' || String(enemy.name || '').toLowerCase().includes('оскверн') || String(enemy.name || '').toLowerCase().includes('искаж'),
  }));

export const getEncounterRewardTier = roster => (Array.isArray(roster) ? roster : [])
  .reduce((highest, enemy) => rankIndex(enemy?.rank) > rankIndex(highest) ? enemy.rank : highest, 'ordinary');

const pick = (entries, rng) => entries.length ? entries[Math.min(entries.length - 1, Math.floor(rng() * entries.length))] : null;
const chooseOwned = (common, location, weights, rng) => {
  if (!location.length) return pick(common, rng);
  if (!common.length) return pick(location, rng);
  return pick(rng() < weights.common ? common : location, rng);
};
const eligibleEquipment = (entries, exclusions = []) => {
  const excluded = new Set(exclusions);
  return entries.filter(name => !excluded.has(name));
};

const addStack = (items, name, quantity = 1) => {
  if (!name) return;
  const existing = items.find(item => item.name === name);
  if (existing) existing.quantity += quantity;
  else items.push({ name, quantity });
};

export const resolveEncounterRewards = ({
  roster = [],
  location = null,
  expeditionZone = null,
  sublocationId = null,
} = {}, rng = Math.random) => {
  const uniqueByRewardId = new Map();
  roster.forEach(entry => {
    if (!uniqueByRewardId.has(entry.rewardId)) uniqueByRewardId.set(entry.rewardId, entry);
  });
  const uniqueRoster = Array.from(uniqueByRewardId.values());
  const tier = getEncounterRewardTier(uniqueRoster);
  const profile = getExpeditionZoneRewardProfile(
    ENCOUNTER_REWARD_PROFILES[tier],
    expeditionZone
  );
  const ownership = getLootOwnershipForLocation(location);
  const commonMaterials = [...ownership.commonMaterials];
  // New alchemy reagents get a separate supply roll: keep existing equipment-material odds.
  const locationMaterials = [...ownership.locationMaterials].filter(name => !['Слизь мохоспора', 'Пыльца серого спорника'].includes(name));
  const commonEquipment = eligibleEquipment([...ownership.commonEquipment], ownership.craftOnlyEquipment);
  const locationEquipment = eligibleEquipment([...ownership.locationEquipment], ownership.craftOnlyEquipment);
  const items = [];

  for (let roll = 0; roll < profile.materialRolls; roll += 1) {
    addStack(items, chooseOwned(commonMaterials, locationMaterials, profile.materialWeights, rng));
  }

  const rollEquipment = () => addStack(items, chooseOwned(commonEquipment, locationEquipment, profile.equipmentWeights, rng));
  if (rng() < profile.equipmentChance) rollEquipment();
  if (profile.secondEquipmentChance && rng() < profile.secondEquipmentChance) rollEquipment();

  const guaranteedSeen = new Set();
  uniqueRoster.forEach(enemy => (enemy.guaranteedLoot || []).forEach(entry => {
    const name = typeof entry === 'string' ? entry : entry?.name;
    const quantity = typeof entry === 'string' ? 1 : entry?.quantity ?? 1;
    if (!name || guaranteedSeen.has(name)) return;
    const isCursed = ownership.cursedMaterials.includes(name);
    const isBossCatalyst = ownership.bossMaterials.includes(name);
    if ((isCursed && !enemy.cursed) || (isBossCatalyst && ownership.bossMaterial !== name)) return;
    guaranteedSeen.add(name);
    addStack(items, name, quantity);
  }));

  uniqueRoster
    .filter(enemy => enemy && !enemy.summoned && !enemy.summonOnly && enemy.rewardBearing !== false)
    .forEach(enemy => {
      const primordialSource = enemy.cursed
        ? 'cursed'
        : enemy.rank === 'boss'
          ? 'boss'
          : enemy.rank === 'strong'
            ? 'strong'
            : enemy.rank === 'ordinary'
              ? 'ordinary'
              : null;
      const primordial = primordialSource ? ownership.rollPrimordial(primordialSource, rng) : null;
      addStack(items, primordial?.name, primordial?.quantity);

      const consumable = ownership.rollConsumable?.(rng) || null;
      addStack(items, consumable?.name, consumable?.quantity);
    });

  // One roll per encounter (not per enemy/summon); deeper zones already have more fights.
  if (uniqueRoster.length && rng() < (tier === 'ordinary' ? 0.35 : 0.65)) {
    addStack(items, pick(['Простая склянка', 'Кровяной мох', 'Простая ткань'], rng), tier === 'ordinary' ? 1 : 2);
    if (location === 'Грибные Пещеры') addStack(items, pick(['Слизь мохоспора', 'Пыльца серого спорника'], rng));
  }

  const baseline = uniqueRoster.length
    ? Math.max(25, Math.min(40, Math.round(uniqueRoster.reduce((sum, enemy) => sum + enemy.silverReward, 0) / uniqueRoster.length)))
    : 25;
  return {
    silver: Math.round(baseline * profile.silverMultiplier),
    items,
    tier,
    expeditionZone,
    sublocationId,
    resonance: calculateEncounterResonance(uniqueRoster, 1),
  };
};

export const resolveEncounterRewardsOnce = (session, rng = Math.random) => {
  if (!session?.state?.encounterReward) return { silver: 0, items: [], tier: 'ordinary' };
  if (session.state.encounterReward.resolvedLoot) return session.state.encounterReward.resolvedLoot;
  const resolved = resolveEncounterRewards(session.state.encounterReward, rng);
  session.state.encounterReward.resolvedLoot = resolved;
  return resolved;
};
