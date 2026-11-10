import {
  BOSS_MATERIAL_BY_LOCATION,
  COMMON_LEVEL_ONE_EQUIPMENT,
  COMMON_LEVEL_ONE_MATERIALS,
  CRAFT_ONLY_SIGNATURE_EQUIPMENT,
  CURSED_ONLY_MATERIALS,
  LOCATION_LEVEL_ONE_EQUIPMENT,
  LOCATION_LEVEL_ONE_MATERIALS,
  rollLocationPrimordial,
} from './levelOneLootOwnership';
import {
  BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION,
  COMMON_LEVEL_TWO_CONSUMABLES,
  COMMON_LEVEL_TWO_EQUIPMENT,
  COMMON_LEVEL_TWO_MATERIALS,
  CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
  LOCATION_LEVEL_TWO_CONSUMABLES,
  LOCATION_LEVEL_TWO_EQUIPMENT,
  LOCATION_LEVEL_TWO_MATERIALS,
  isLevelTwoLootLocation,
  rollLevelTwoConsumable,
  rollLevelTwoPrimordial,
} from './levelTwoLootOwnership';

const EMPTY = Object.freeze([]);
const ALL_BOSS_MATERIALS = Object.freeze([
  ...Object.values(BOSS_MATERIAL_BY_LOCATION),
  ...Object.values(BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION),
]);

export const getLootOwnershipForLocation = locationName => {
  if (isLevelTwoLootLocation(locationName)) {
    return {
      abyssLevel: 2,
      commonMaterials: COMMON_LEVEL_TWO_MATERIALS,
      locationMaterials: LOCATION_LEVEL_TWO_MATERIALS[locationName] || EMPTY,
      commonEquipment: COMMON_LEVEL_TWO_EQUIPMENT,
      locationEquipment: LOCATION_LEVEL_TWO_EQUIPMENT[locationName] || EMPTY,
      commonConsumables: COMMON_LEVEL_TWO_CONSUMABLES,
      locationConsumables: LOCATION_LEVEL_TWO_CONSUMABLES[locationName] || EMPTY,
      craftOnlyEquipment: CRAFT_ONLY_LEVEL_TWO_EQUIPMENT,
      cursedMaterials: EMPTY,
      bossMaterial: BOSS_MATERIAL_BY_LEVEL_TWO_LOCATION[locationName] || null,
      bossMaterials: ALL_BOSS_MATERIALS,
      rollPrimordial: (source, rng) => rollLevelTwoPrimordial(locationName, source, rng),
      rollConsumable: rng => rollLevelTwoConsumable(locationName, rng),
    };
  }

  return {
    abyssLevel: 1,
    commonMaterials: COMMON_LEVEL_ONE_MATERIALS,
    locationMaterials: LOCATION_LEVEL_ONE_MATERIALS[locationName] || EMPTY,
    commonEquipment: COMMON_LEVEL_ONE_EQUIPMENT,
    locationEquipment: LOCATION_LEVEL_ONE_EQUIPMENT[locationName] || EMPTY,
    commonConsumables: EMPTY,
    locationConsumables: EMPTY,
    craftOnlyEquipment: CRAFT_ONLY_SIGNATURE_EQUIPMENT,
    cursedMaterials: CURSED_ONLY_MATERIALS,
    bossMaterial: BOSS_MATERIAL_BY_LOCATION[locationName] || null,
    bossMaterials: ALL_BOSS_MATERIALS,
    rollPrimordial: (source, rng) => rollLocationPrimordial(locationName, source, rng),
    rollConsumable: () => null,
  };
};
