import { allEnemies } from './enemies';
import {
  BOSS_MATERIAL_BY_LOCATION,
  COMMON_LEVEL_ONE_EQUIPMENT,
  COMMON_LEVEL_ONE_MATERIALS,
  CRAFT_ONLY_SIGNATURE_EQUIPMENT,
  CURSED_ONLY_MATERIALS,
  LEVEL_ONE_LOCATIONS,
  LOCATION_LEVEL_ONE_EQUIPMENT,
  LOCATION_LEVEL_ONE_MATERIALS,
  TREASURE_EQUIPMENT_SOURCE_WEIGHTS,
  selectTreasureEquipmentSource,
} from './levelOneLootOwnership';
import { getTreasureEquipmentPoolsForLocation, getTreasurePoolNamesForLocation, rollChestLoot } from './items';
import { buildResourceRoomPayload, getOrdinaryMaterialPoolForLocation, getResourceRoomTable } from '../utils/roomGeneration';

const locations = Object.values(LEVEL_ONE_LOCATIONS);
const forbiddenSpecial = [...CURSED_ONLY_MATERIALS, ...Object.values(BOSS_MATERIAL_BY_LOCATION)];

describe('Level 1 thematic loot ownership', () => {
  test('every location receives the common foundation plus only its native materials', () => {
    locations.forEach(location => {
      const pool = getOrdinaryMaterialPoolForLocation(location);
      expect(pool).toEqual(expect.arrayContaining(COMMON_LEVEL_ONE_MATERIALS));
      expect(pool).toEqual(expect.arrayContaining(LOCATION_LEVEL_ONE_MATERIALS[location]));
      locations.filter(other => other !== location).forEach(other => {
        LOCATION_LEVEL_ONE_MATERIALS[other].forEach(name => expect(pool).not.toContain(name));
      });
      forbiddenSpecial.forEach(name => expect(pool).not.toContain(name));
    });
  });

  test('Resource tables are location-aware and exclude cursed and boss materials', () => {
    locations.forEach(location => {
      const names = getResourceRoomTable(location).map(entry => entry.name);
      expect(names).toEqual(expect.arrayContaining(COMMON_LEVEL_ONE_MATERIALS));
      expect(names).toEqual(expect.arrayContaining(LOCATION_LEVEL_ONE_MATERIALS[location]));
      forbiddenSpecial.forEach(name => expect(names).not.toContain(name));
    });
    expect(getResourceRoomTable(LEVEL_ONE_LOCATIONS.GOBLIN).find(x => x.name === 'Кровяной мох').weight).toBeGreaterThan(20);
  });

  test('equipment ownership is disjoint and includes the two location designs', () => {
    expect(LOCATION_LEVEL_ONE_EQUIPMENT[LEVEL_ONE_LOCATIONS.GOBLIN]).toContain('Амулет Крысиной Жилы');
    expect(LOCATION_LEVEL_ONE_EQUIPMENT[LEVEL_ONE_LOCATIONS.DESERTER]).toContain('Полевой гримуар Отступника');
    const themed = Object.values(LOCATION_LEVEL_ONE_EQUIPMENT).flat();
    themed.forEach(name => expect(COMMON_LEVEL_ONE_EQUIPMENT).not.toContain(name));
  });

  test('Treasure ownership is explicit 40/60 and independent of pool lengths', () => {
    expect(TREASURE_EQUIPMENT_SOURCE_WEIGHTS).toEqual({ common: 0.4, location: 0.6 });
    expect(selectTreasureEquipmentSource({ hasCommon: true, hasLocation: true }, () => 0.399)).toBe('common');
    expect(selectTreasureEquipmentSource({ hasCommon: true, hasLocation: true }, () => 0.4)).toBe('location');
    expect(selectTreasureEquipmentSource({ hasCommon: true, hasLocation: false }, () => 0.99)).toBe('common');
    locations.forEach(location => {
      const pools = getTreasureEquipmentPoolsForLocation(location);
      expect(pools.common.map(item => item.name)).toEqual(expect.arrayContaining(COMMON_LEVEL_ONE_EQUIPMENT));
      expect(pools.location.length).toBeGreaterThan(0);
    });
  });

  test('generic and location Treasure pools never expose special materials or craft-only signatures', () => {
    [null, ...locations].forEach(location => {
      const names = getTreasurePoolNamesForLocation(location);
      forbiddenSpecial.forEach(name => expect(names).not.toContain(name));
      CRAFT_ONLY_SIGNATURE_EQUIPMENT.forEach(name => expect(names).not.toContain(name));
    });
  });

  test('legacy generic chest callers cannot leak faction, cursed, or boss materials', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      for (let index = 0; index < 100; index += 1) {
        const names = rollChestLoot().map(entry => entry.name);
        forbiddenSpecial.forEach(name => expect(names).not.toContain(name));
        Object.values(LOCATION_LEVEL_ONE_MATERIALS).flat().forEach(name => expect(names).not.toContain(name));
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test('ordinary enemy tables respect material ownership and special-source locks', () => {
    allEnemies.filter(enemy => !enemy.boss && enemy.roomRole !== 'cursedEnemy' && !enemy.name.toLowerCase().includes('оскверн') && !enemy.name.toLowerCase().includes('искаж')).forEach(enemy => {
      const allowed = getOrdinaryMaterialPoolForLocation(enemy.location);
      Object.values(LOCATION_LEVEL_ONE_MATERIALS).flat().forEach(name => {
        if (!allowed.includes(name)) expect(enemy.lootTable).not.toContain(name);
      });
      forbiddenSpecial.forEach(name => expect(enemy.lootTable).not.toContain(name));
    });
  });

  test('pre-resolved Resource payload remains deterministic for saved-run choices', () => {
    const sequence = values => { let index = 0; return () => values[index++ % values.length]; };
    const values = [0.17, 0.83, 0.41, 0.62, 0.29, 0.73];
    expect(buildResourceRoomPayload({ locationName: LEVEL_ONE_LOCATIONS.FUNGAL, rng: sequence(values) }))
      .toEqual(buildResourceRoomPayload({ locationName: LEVEL_ONE_LOCATIONS.FUNGAL, rng: sequence(values) }));
  });
});
