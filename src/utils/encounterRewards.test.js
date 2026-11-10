import { initCombatSession } from './combatUtils';
import {
  ENCOUNTER_REWARD_PROFILES,
  createEncounterRewardRoster,
  getEncounterRewardTier,
  getExpeditionZoneRewardProfile,
  normalizeEnemyRewardRank,
  resolveEncounterRewards,
  resolveEncounterRewardsOnce,
} from './encounterRewards';
import { COMMON_LEVEL_ONE_EQUIPMENT, CRAFT_ONLY_SIGNATURE_EQUIPMENT, LOCATION_LEVEL_ONE_EQUIPMENT } from '../data/levelOneLootOwnership';

const LOCATION = 'Гоблинские Норы';
const enemy = (overrides = {}) => ({ id: 'enemy', name: 'Враг', location: LOCATION, silverReward: 30, ...overrides });
const itemNames = reward => reward.items.map(item => item.name);
const lcg = seed => { let value = seed; return () => ((value = value * 48271 % 0x7fffffff) / 0x7fffffff); };

describe('encounter rank rewards v1', () => {
  test('normalizes authoritative ranks and mixed rosters use the highest tier', () => {
    expect(normalizeEnemyRewardRank(enemy())).toBe('ordinary');
    expect(normalizeEnemyRewardRank(enemy({ encounterPhase: 'late' }))).toBe('strong');
    expect(normalizeEnemyRewardRank(enemy({ miniBoss: true }))).toBe('miniBoss');
    expect(normalizeEnemyRewardRank(enemy({ boss: true }))).toBe('boss');
    expect(getEncounterRewardTier(createEncounterRewardRoster([enemy(), enemy({ encounterPhase: 'late' })]))).toBe('strong');
  });

  test.each([
    ['ordinary', {}, 1, 30],
    ['strong', { encounterPhase: 'late' }, 2, 45],
    ['miniBoss', { miniBoss: true }, 2, 75],
    ['boss', { boss: true }, 3, 120],
  ])('%s profile has its exact material count and silver target', (tier, metadata, materialCount, silver) => {
    const reward = resolveEncounterRewards({ roster: createEncounterRewardRoster([enemy(metadata)]), location: LOCATION }, () => 0.99);
    expect(reward.tier).toBe(tier);
    const equipment = new Set(LOCATION_LEVEL_ONE_EQUIPMENT[LOCATION]);
    expect(reward.items.filter(item => !equipment.has(item.name)).reduce((sum, item) => sum + item.quantity, 0)).toBe(materialCount);
    expect(reward.silver).toBe(silver);
  });

  test('expedition zones shift loot density without changing the base reward tables', () => {
    const base = ENCOUNTER_REWARD_PROFILES.strong;
    const approach = getExpeditionZoneRewardProfile(base, 'approach');
    const sublocation = getExpeditionZoneRewardProfile(base, 'sublocation');
    const depth = getExpeditionZoneRewardProfile(base, 'depth');

    expect(approach).toMatchObject({ materialRolls: 2, equipmentChance: 0.2 });
    expect(sublocation.materialRolls).toBe(3);
    expect(sublocation.equipmentChance).toBeCloseTo(0.25);
    expect(sublocation.materialWeights).toEqual({ common: 0.2, location: 0.8 });
    expect(depth.materialRolls).toBe(3);
    expect(depth.equipmentChance).toBeCloseTo(0.3);
    expect(depth.equipmentWeights).toEqual({ common: 0.1, location: 0.9 });
    expect(ENCOUNTER_REWARD_PROFILES.strong.materialRolls).toBe(2);
  });

  test('mini-boss and boss guarantee valid equipment, while boss second equipment is only 25%', () => {
    const mini = resolveEncounterRewards({ roster: createEncounterRewardRoster([enemy({ miniBoss: true })]), location: LOCATION }, () => 0);
    expect(mini.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(5); // 2 additional basic supplies
    const bossWithSecond = resolveEncounterRewards({ roster: createEncounterRewardRoster([enemy({ boss: true })]), location: LOCATION }, () => 0);
    const bossWithoutSecond = resolveEncounterRewards({ roster: createEncounterRewardRoster([enemy({ boss: true })]), location: LOCATION }, () => 0.99);
    expect(bossWithSecond.items.filter(item => LOCATION_LEVEL_ONE_EQUIPMENT[LOCATION].includes(item.name)).reduce((n, x) => n + x.quantity, 0)).toBe(2);
    expect(bossWithoutSecond.items.filter(item => LOCATION_LEVEL_ONE_EQUIPMENT[LOCATION].includes(item.name)).reduce((n, x) => n + x.quantity, 0)).toBe(1);
  });

  test('boss catalyst and cursed Essence compose with rank rewards exactly once', () => {
    const boss = createEncounterRewardRoster([enemy({ id: 'boss', boss: true, guaranteedLoot: ['Сердце костра', 'Сердце костра'] })]);
    const bossReward = resolveEncounterRewards({ roster: boss, location: LOCATION }, () => 0.99);
    expect(bossReward.items.find(item => item.name === 'Сердце костра')).toEqual({ name: 'Сердце костра', quantity: 1 });
    const cursed = createEncounterRewardRoster([enemy({ id: 'cursed', miniBoss: true, roomRole: 'cursedEnemy', guaranteedLoot: ['Эссенция Проклятий'] })]);
    const cursedReward = resolveEncounterRewards({ roster: cursed, location: LOCATION }, () => 0.99);
    expect(itemNames(cursedReward)).toContain('Эссенция Проклятий');
    expect(itemNames(cursedReward).some(name => LOCATION_LEVEL_ONE_EQUIPMENT[LOCATION].includes(name))).toBe(true);
    expect(itemNames(resolveEncounterRewards({ roster: createEncounterRewardRoster([enemy({ guaranteedLoot: ['Эссенция Проклятий'] })]), location: LOCATION }, () => 0.99))).not.toContain('Эссенция Проклятий');
  });

  test('random equipment excludes craft-only signatures and wrong-location ownership', () => {
    ['miniBoss', 'boss'].forEach(tier => {
      for (let index = 1; index <= 200; index += 1) {
        const metadata = tier === 'boss' ? { boss: true } : { miniBoss: true };
        const reward = resolveEncounterRewards({ roster: createEncounterRewardRoster([enemy(metadata)]), location: LOCATION }, lcg(index));
        CRAFT_ONLY_SIGNATURE_EQUIPMENT.forEach(name => expect(itemNames(reward)).not.toContain(name));
        Object.entries(LOCATION_LEVEL_ONE_EQUIPMENT).filter(([location]) => location !== LOCATION).flatMap(([, names]) => names)
          .forEach(name => expect(itemNames(reward)).not.toContain(name));
      }
    });
  });

  test('summons, revives, and roster churn cannot increase rank or reward value', () => {
    const ordinary = enemy({ rewardId: 'authored:0' });
    const summon = enemy({ id: 'summon', boss: true, summoned: true, silverReward: 999, guaranteedLoot: ['Сердце костра'] });
    expect(createEncounterRewardRoster([ordinary, summon])).toHaveLength(1);
    const duplicatedReviveRoster = [
      ...createEncounterRewardRoster([ordinary]),
      ...createEncounterRewardRoster([ordinary]).map(entry => ({ ...entry, rewardId: 'authored:0', rank: 'boss' })),
    ];
    const reward = resolveEncounterRewards({ roster: duplicatedReviveRoster, location: LOCATION }, () => 0.99);
    expect(reward.tier).toBe('ordinary');
    expect(reward.silver).toBe(30);
  });

  test('session stores the authored roster and resolves immutable reward payload once', () => {
    const session = initCombatSession({ name: 'Герой', hp: 50, maxHp: 50 }, [enemy({ miniBoss: true })]);
    const first = resolveEncounterRewardsOnce(session, () => 0);
    session.state.enemies.splice(0, 1, enemy({ boss: true, summoned: true }));
    const second = resolveEncounterRewardsOnce(session, () => 0.99);
    expect(second).toBe(first);
    expect(second.tier).toBe('miniBoss');
  });

  test('deterministic simulation matches configured equipment rates and ownership weights', () => {
    const cases = [
      ['ordinary', {}, 0.05, 0.65], ['strong', { encounterPhase: 'late' }, 0.2, 0.75],
      ['miniBoss', { miniBoss: true }, 1, 0.85], ['boss', { boss: true }, 1.25, 1],
    ];
    cases.forEach(([tier, metadata, expectedEquipment, expectedLocation]) => {
      const rng = lcg(1337 + tier.length); let equipment = 0; let locationEquipment = 0; const runs = 5000;
      for (let i = 0; i < runs; i += 1) {
        const reward = resolveEncounterRewards({ roster: createEncounterRewardRoster([enemy(metadata)]), location: LOCATION }, rng);
        reward.items.forEach(item => {
          if ([...LOCATION_LEVEL_ONE_EQUIPMENT[LOCATION], ...COMMON_LEVEL_ONE_EQUIPMENT].includes(item.name)) {
            equipment += item.quantity;
            if (LOCATION_LEVEL_ONE_EQUIPMENT[LOCATION].includes(item.name)) locationEquipment += item.quantity;
          }
        });
      }
      expect(equipment / runs).toBeCloseTo(expectedEquipment, 1);
      expect(locationEquipment / Math.max(1, equipment)).toBeCloseTo(expectedLocation, 1);
      expect(ENCOUNTER_REWARD_PROFILES[tier].materialRolls).toBeGreaterThanOrEqual(1);
    });
  });
});
