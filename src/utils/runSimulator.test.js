import { enemies } from '../data/enemies';
import { FUNGAL_LOCATION, GOBLIN_LOCATION, MUSHROOM_ENCOUNTER_FAMILIES } from './enemyPools';
import { acquireRunLoot, deriveRunSeed, RUN_CHOICE_POLICIES, simulateRuns, syncCombatItemsToRunInventory } from './runSimulator';
import { normalizeInventorySlots } from './expeditionInventory';
import { ROOM_TYPES } from './roomGeneration';

const smallBatch = overrides => simulateRuns({ runs: 40, seed: 8675309, policy: 'random', ...overrides });

describe('headless production run simulator', () => {
  test('loot policy uses canonical stacks/capacity and found healing persists after prior consumption', () => {
    const start = { equipment: {}, runInventory: normalizeInventorySlots([null,null,...Array(10).fill(null),{ itemId: 'Малое зелье здоровья', quantity: 2 }], 26) };
    const consumed = { ...start, runInventory: syncCombatItemsToRunInventory(start, []) };
    expect(consumed.runInventory.some(Boolean)).toBe(false);
    const pickup = acquireRunLoot(consumed, [{ name: 'Малое зелье здоровья', quantity: 1 }], 'balanced');
    expect(pickup.acquired).toEqual([{ name: 'Малое зелье здоровья', quantity: 1 }]);
    expect(pickup.player.items).toEqual(['Малое зелье здоровья']);
    const merged = acquireRunLoot({ ...start, runInventory: normalizeInventorySlots([null,null,...Array(10).fill(null),{ itemId: 'Малое зелье здоровья', quantity: 2 }], 26) }, [{ name: 'Малое зелье здоровья', quantity: 1 }], 'take_all_legal');
    expect(merged.player.runInventory[12]).toMatchObject({ itemId: 'Малое зелье здоровья', quantity: 3 });
    const full = { equipment: {}, runInventoryLayoutVersion: 2, runInventory: normalizeInventorySlots(Array.from({ length: 26 }, (_, index) => ({ itemId: `blocked-${index}`, quantity: 1 })), 26) };
    expect(acquireRunLoot(full, [{ name: 'Малое зелье здоровья', quantity: 1 }], 'balanced').leftBehind).toEqual([{ name: 'Малое зелье здоровья', quantity: 1, reason: 'capacity' }]);
  });
  test('is deterministic for the same batch seed and derives stable distinct child seeds', () => {
    expect(smallBatch({ location: 'fungal' })).toEqual(smallBatch({ location: 'fungal' }));
    expect(deriveRunSeed(42, 0)).toBe(deriveRunSeed(42, 0));
    expect(deriveRunSeed(42, 0)).not.toBe(deriveRunSeed(42, 1));
  });

  test('different seeds can produce different production reports', () => {
    expect(smallBatch({ location: 'goblin', seed: 1 })).not.toEqual(smallBatch({ location: 'goblin', seed: 2 }));
  });

  test.each(['goblin', 'fungal'])('%s batch preserves run, room, boss, and economy invariants', (location) => {
    const report = smallBatch({ location });
    expect(report.runs.completed + report.runs.abnormal).toBe(report.runs.requested);
    expect(report.encounters.bosses).toBe(report.runs.completed);
    expect(Object.values(report.rooms).every(room => room.chosen <= room.offered)).toBe(true);
    expect(Object.values(report.economy.items).every(item => item.quantity >= 0)).toBe(true);
    expect(report.economy.silver.total).toBeGreaterThanOrEqual(0);
    expect(report.modeling.authoritative).toContain('room offers and gates');
  });

  test('canonical Goblin and Mushroom batches stay in their production enemy pools', () => {
    const goblin = smallBatch({ location: 'goblin' });
    const fungal = smallBatch({ location: 'fungal' });
    const goblinNames = new Set(enemies.filter(enemy => enemy.location === GOBLIN_LOCATION).map(enemy => enemy.name));
    const fungalNames = new Set(enemies.filter(enemy => enemy.location === FUNGAL_LOCATION).map(enemy => enemy.name));
    expect(Object.keys(goblin.encounters.archetypes).every(name => goblinNames.has(name))).toBe(true);
    expect(Object.keys(fungal.encounters.archetypes).every(name => fungalNames.has(name))).toBe(true);
    expect(Object.keys(goblin.encounters.archetypes).some(name => !fungalNames.has(name))).toBe(true);
    expect(Object.keys(fungal.encounters.archetypes).some(name => !goblinNames.has(name))).toBe(true);
  });

  test('Dwoeglav remains a normal troglodyte without a forced-solo simulator rule', () => {
    const dwoeglav = enemies.find(enemy => enemy.name === 'Змеиный двоеглав');
    expect(dwoeglav).toMatchObject({ location: FUNGAL_LOCATION, encounterFamily: MUSHROOM_ENCOUNTER_FAMILIES.NORMAL });
    const report = simulateRuns({ location: 'fungal', runs: 300, seed: 410425, policy: 'combat_priority' });
    expect(report.dwoeglav.appearances).toBeGreaterThan(0);
    expect(report.dwoeglav.soloEncounters).toBe(0);
  });

  test('phase analytics are deterministic and reconcile exactly with overall encounters', () => {
    const first = smallBatch({ location: 'fungal' });
    const second = smallBatch({ location: 'fungal' });
    expect(first.encounters.phases).toEqual(second.encounters.phases);
    const phases = Object.values(first.encounters.phases);
    expect(phases.reduce((sum, phase) => sum + phase.encounters, 0)).toBe(first.encounters.total);
    expect(phases.reduce((sum, phase) => sum + phase.duplicateEncounters, 0)).toBe(first.encounters.duplicateEncounters);
    phases.forEach(phase => {
      expect(Object.values(phase.enemyCountDistribution).reduce((sum, count) => sum + count, 0)).toBe(phase.encounters);
      expect(Object.values(phase.families).reduce((sum, family) => sum + family.encounters, 0)).toBe(phase.encounters);
    });
  });
});

describe('run and combat policy integration', () => {
  test('cautious prefers a safe visible room at critical HP and greedy prefers Treasure', () => {
    const choices = [{ roomType: ROOM_TYPES.COMBAT }, { roomType: ROOM_TYPES.RESOURCE }, { roomType: ROOM_TYPES.TREASURE }];
    expect(RUN_CHOICE_POLICIES.cautious(choices, () => 0, { hp: 10, maxHp: 100 }).roomType).toBe(ROOM_TYPES.RESOURCE);
    expect(RUN_CHOICE_POLICIES.greedy(choices, () => 0, { hp: 10, maxHp: 100 }).roomType).toBe(ROOM_TYPES.TREASURE);
    expect(RUN_CHOICE_POLICIES.balanced(choices, () => 0, { hp: 100, maxHp: 100, completedCombatRooms: 0 }).roomType).toBe(ROOM_TYPES.TREASURE);
    expect(RUN_CHOICE_POLICIES.balanced(choices, () => 0, { hp: 40, maxHp: 100, completedCombatRooms: 2, hasBloodMoss: false, hasSimpleCloth: false }).roomType).toBe(ROOM_TYPES.RESOURCE);
    expect(RUN_CHOICE_POLICIES.balanced([{ roomType: ROOM_TYPES.COMBAT }, { roomType: ROOM_TYPES.SECRET }], () => 0, { hp: 100, maxHp: 100, completedCombatRooms: 0 }).roomType).toBe(ROOM_TYPES.COMBAT);
  });

  test('simulated combat is deterministic, persists entering HP, and terminates runs on death', () => {
    const config = { location: 'fungal', runs: 3, seed: 7788, policy: 'combat_priority', combatMode: 'simulated', combatPolicy: 'naive', classId: 'Archer' };
    const first = simulateRuns(config);
    expect(first).toEqual(simulateRuns(config));
    expect(first.runs.deaths).toBeGreaterThan(0);
    expect(first.runs.completed + first.runs.deaths + first.runs.abnormal).toBe(3);
    expect(first.simulatedCombat.enteringHpByCombatIndex['1'].mean).toBe(90);
    expect(first.config.profile).toBe('fresh');
    expect(first.resolvedProfile).toMatchObject({ profileId: 'fresh', classId: 'Archer' });
    const indexed = Object.values(first.simulatedCombat.byCombatIndex);
    expect(indexed.reduce((sum, metric) => sum + metric.reached, 0)).toBe(first.simulatedCombat.fights);
    expect(indexed.reduce((sum, metric) => sum + metric.victories, 0)).toBe(first.simulatedCombat.victories);
    indexed.forEach(metric => expect(metric.victories + metric.deaths).toBe(metric.reached));
    const flow = first.economy.inventory.itemFlow;
    const total = record => Object.values(record).reduce((sum, value) => sum + value, 0);
    expect(total(flow.generated)).toBe(total(flow.acquired) + total(flow.leftBehind));
    expect(first.economy.inventory.snapshots.afterRoom.samples).toBeGreaterThanOrEqual(first.runs.requested);
    expect(first.economy.inventory.capacityFailureRuns).toBeLessThanOrEqual(first.runs.requested);
  });

  test('strong and inventory aggregates are deterministic and carry mandatory denominators', () => {
    const config = { location: 'goblin', runs: 12, seed: 991, policy: 'combat_priority', combatMode: 'simulated', combatPolicy: 'competent', classId: 'Defender' };
    const report = simulateRuns(config);
    expect(report).toEqual(simulateRuns(config));
    const classes = report.simulatedCombat.strongEncounters.encounterClasses;
    expect(classes.ordinary.fights + classes.strong.fights).toBe(report.simulatedCombat.fights - report.runs.bossReached);
    report.simulatedCombat.strongEncounters.dangerousCompositions.forEach(composition => expect(composition.fights).toBeGreaterThanOrEqual(5));
    expect(report.economy.inventory.snapshots.afterCombat7?.samples || 0).toBeLessThanOrEqual(report.runs.requested);
    report.simulatedCombat.replayableBossEntryStates.forEach(entry => expect(entry.state).toEqual(expect.objectContaining({ hp: expect.any(Number), abilities: expect.any(Array), items: expect.any(Array), equipment: expect.any(Object) })));
  });

  test('extraction report keeps the combat-index denominator', () => {
    const report = simulateRuns({ location: 'goblin', runs: 30, seed: 20260901, policy: 'balanced', combatMode: 'simulated', combatPolicy: 'strategic', gearPolicy: 'smart', craftPolicy: 'balanced', extractionPolicy: 'balanced' });
    expect(Object.values(report.runs.extractionCombatIndexDistribution).reduce((sum, count) => sum + count, 0)).toBe(report.runs.extracted);
  });

  test('boss window includes simulated boss defeats, not victories only', () => {
    const report = simulateRuns({ location: 'deserter', classId: 'Defender', profile: 'prepared', runs: 20, seed: 20260901, policy: 'combat_priority', combatMode: 'simulated', combatPolicy: 'strategic' });
    if (report.runs.bossReached) expect(report.runs.bossWindow.min).toBeGreaterThan(0);
  });

  test('abstract combat remains the default and preserves previous accounting', () => {
    const report = simulateRuns({ location: 'goblin', runs: 4, seed: 88, policy: 'random' });
    expect(report.config.combatMode).toBe('abstract');
    expect(report.runs.completed + report.runs.abnormal).toBe(4);
    expect(report.simulatedCombat).toBeNull();
    const timeline = Object.values(report.encounters.structuralByCombatIndex);
    expect(timeline.reduce((sum, metric) => sum + metric.reached, 0)).toBe(report.encounters.total);
    timeline.forEach(metric => {
      expect(metric.strongFights).toBeLessThanOrEqual(metric.reached);
      expect(metric.strongFightPercentage).toBe(metric.strongFights / metric.reached * 100);
      expect(Object.values(metric.compositions).reduce((sum, count) => sum + count, 0)).toBe(metric.reached);
    });
  });
});
