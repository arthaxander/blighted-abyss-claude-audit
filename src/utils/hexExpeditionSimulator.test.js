import { advanceSimulationAltar, resolveSimulationCurseState } from './simulationAltars';
import { createHexCraftingRoute, simulateHexCraftingRun } from './hexCraftingSimulator';
import { getHexSimulationCatalog, previewHexSimulation } from './hexSimulationScenarios';
import { simulateHexExpeditions } from './hexExpeditionSimulator';

const catalog = getHexSimulationCatalog();
test('all production maps preview deterministically, including unavailable locations', () => {
  // Every authored location now offers four templates, including Goblins.
  expect(catalog.reduce((n, location) => n + location.templates.length, 0)).toBe(24);
  for (const location of catalog) for (const template of location.templates) {
    const options = { location: location.id, templateId: template.id, seed: 0 };
    const preview = previewHexSimulation(options);
    expect(preview.layout.templateId).toBe(template.id);
    expect(preview.layout.cells.length).toBeGreaterThan(100);
    expect(previewHexSimulation(options)).toEqual(preview);
  }
});
test('all playable maps and all three branches complete legal key-validated traversal', () => {
  for (const location of catalog.filter(entry => entry.combatSupported)) for (const template of location.templates) {
    for (const sublocationSlot of [0, 1, 2]) {
      const options = { location: location.id, templateId: template.id, sublocationSlot, seed: 0 };
      const route = createHexCraftingRoute(options);
      expect(route.templateId).toBe(template.id);
      expect(route.route.at(-1).phase).toBe('boss');
      expect(route.route.at(-1).enemies.length).toBeGreaterThan(0);
      expect(route.movementSteps).toBeGreaterThan(route.route.length);
      expect(route.selectedSublocationId).toBe(previewHexSimulation(options).sublocations[sublocationSlot]);
      expect(route.route.every(cell => cell.enemies.every(enemy => enemy.location === location.name))).toBe(true);
    }
  }
});
test('Ruins and Mines generate full authored routes, cursed encounters and unique bosses', () => {
  const expectedBosses = { restless_ruins: 'Легион Погребённых', mines_of_decay: 'Начальник шахт — Золотоплавец' };
  for (const location of ['restless_ruins', 'mines_of_decay']) {
    const info = catalog.find(entry => entry.id === location);
    expect(info.combatSupported).toBe(true);
    const route = createHexCraftingRoute({ location, templateId: info.templates[0].id, seed: 17 });
    const combats = route.route.filter(cell => cell.enemies.length);
    const boss = route.route.at(-1);
    expect(route.abyssLevel).toBe(2);
    expect(boss.phase).toBe('boss');
    expect(boss.enemies.map(e => e.name)).toEqual([expectedBosses[location]]);
    expect(combats.every(cell => cell.enemies.every(enemy => enemy.location === info.name))).toBe(true);
    expect(combats.filter(cell => cell.roomType === 'COMBAT').every(cell => cell.enemies.length === 3)).toBe(true);
    expect(combats.filter(cell => cell.roomType === 'CURSED_ENEMY').every(cell => cell.enemies.length === 1)).toBe(true);
    expect(route.route.filter(cell => cell.phase === 'depth' && cell.enemies.length).every(cell => cell.enemies.every(e => e.abyssPowerApplied))).toBe(true);
  }
  expect(() => createHexCraftingRoute({ location: 'fungal', templateId: 'deserter-01' })).toThrow();
  expect(() => createHexCraftingRoute({ sublocationSlot: 3 })).toThrow();
});

test.each(['restless_ruins', 'mines_of_decay'])('%s supports reproducible real combat and aggregates without traces', location => {
  const options = { location, runs: 1, seed: 17, classId: 'Mage', profile: 'prepared',
    combatPolicy: 'competent', bossPolicy: 'boss_aware', craftPolicy: 'off' };
  const report = simulateHexExpeditions(options);
  expect(report.config.locationId).toBe(location);
  expect(report.runs.completed + report.runs.deaths + report.runs.abnormal).toBe(1);
  expect(report.runs.abnormal).toBe(0);
  expect(report.simulatedCombat.averageCombatsSurvived).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(report)).not.toContain('"combats"');
});
test('real combat aggregates reproduce without retaining traces and preserve the selected scenario', () => {
  const options = { location: 'fungal', templateId: 'fungal-02', sublocationSlot: 2,
    runs: 2, seed: 0, classId: 'Archer', profile: 'fresh', combatPolicy: 'naive', bossPolicy: 'boss_aware', craftPolicy: 'off' };
  const report = simulateHexExpeditions(options);
  expect(simulateHexExpeditions(options)).toEqual(report);
  expect(report.maps.templates).toEqual({ 'fungal-02': 2 });
  expect(report.runs.completed + report.runs.deaths + report.runs.abnormal).toBe(2);
  expect(report.config).toMatchObject(options);
  expect(JSON.stringify(report)).not.toContain('combats');
  expect(JSON.stringify(report).length).toBeLessThan(50000);
});

test('altar counts and tier caps follow the shared floor rules through floor six', () => {
  const ranges = [[1, 1], [2, 2], [2, 3], [2, 3], [3, 4], [13, 13]];
  for (let abyssLevel = 1; abyssLevel <= 6; abyssLevel++) {
    const route = createHexCraftingRoute({ location: 'fungal', templateId: 'fungal-01', seed: 4, abyssLevel });
    const count = route.route.filter(cell => cell.roomType === 'CURSE_ALTAR').length;
    expect(count).toBeGreaterThanOrEqual(ranges[abyssLevel - 1][0]);
    expect(count).toBeLessThanOrEqual(ranges[abyssLevel - 1][1]);
    expect(route.altarBudget.total).toBe(count);
  }
  const full = { corruption: 5, distortion: 2, withering: 2, undeath: 2, decay: 2 };
  const route = createHexCraftingRoute({ location: 'fungal', seed: 4, abyssLevel: 6, initialCurses: full });
  expect(route.altarBudget.total).toBe(0);
  expect(route.route.some(cell => cell.roomType === 'CURSE_ALTAR')).toBe(false);
  expect(createHexCraftingRoute({ location: 'fungal', abyssLevel: 6,
    initialCurses: { ...full, decay: 1 } }).altarBudget.total).toBe(1);
});

test('shared offering rules enforce floors, one dominant curse, policies and valid imported state', () => {
  expect(() => resolveSimulationCurseState({ withering: 2 }, 1)).toThrow();
  expect(() => resolveSimulationCurseState({ withering: 3, decay: 3 }, 4)).toThrow();
  expect(() => resolveSimulationCurseState({ decay: 1.5 }, 2)).toThrow();
  const state = resolveSimulationCurseState({ withering: 2, decay: 2 }, 3);
  const dominant = advanceSimulationAltar(state, 'withering', 3);
  expect(dominant.dominantCurseId).toBe('withering');
  expect(advanceSimulationAltar(dominant, 'decay', 3).accepted).toBe(false);
  expect(advanceSimulationAltar(state, 'withering', 2).accepted).toBe(false);
  expect(advanceSimulationAltar(state, 'withering', 3, 'up_to_ii').accepted).toBe(false);
  expect(advanceSimulationAltar({}, 'withering', 1, 'skip').accepted).toBe(false);
});

test('altar effects enter actual combat only after the visited altar; skip grants nothing', () => {
  const foe = { name: 'Probe', hp: 1, maxHp: 1, attack: 0, speed: 1, physDef: 0, magicDef: 0, abilities: [] };
  const route = { location: { id: 'goblin', name: 'Гоблинские Норы' }, abyssLevel: 1, route: [
    { cellId: 'first', phase: 'approach', enemies: [foe], loot: [], trapDamage: 20, seed: 1 },
    { cellId: 'altar', phase: 'approach', roomType: 'CURSE_ALTAR', curseId: 'withering', enemies: [], loot: [], trapDamage: 0, seed: 2 },
    { cellId: 'boss', phase: 'boss', enemies: [foe], loot: [], trapDamage: 0, seed: 3 },
  ] };
  const config = { route, classId: 'Archer', profile: 'prepared', craftPolicy: 'off', playerOptions: { consumables: [] } };
  const accept = simulateHexCraftingRun({ ...config, altarPolicy: 'accept' });
  const skip = simulateHexCraftingRun({ ...config, altarPolicy: 'skip' });
  expect(accept.combats[0].curses).toEqual({});
  expect(accept.combats[1].curses).toEqual({ withering: { tier: 1 } });
  expect(accept.altars).toEqual({ visited: 1, accepted: 1, skipped: 0 });
  expect(skip.endingCurses).toEqual({});
  expect(accept.endingHp).toBeGreaterThan(skip.endingHp);
  expect(accept.endingCurses).toEqual(accept.combats[1].curses);
});

test('altar choices sample distinct eligible curses, persist, and preserve old one-offer saves', () => {
  const { rollAltarChoices, getAltarCurseIds } = require('./altarChoices');
  const { getEligibleCursePool } = require('../data/curses');
  const pool = getEligibleCursePool({ corruption: { tier: 1 } }, null, 1);
  const offers = rollAltarChoices(pool, () => 0);
  expect(offers.curseIds).toHaveLength(2);
  expect(new Set(offers.curseIds).size).toBe(2);
  expect(offers.curseIds).not.toContain('corruption');
  expect(getAltarCurseIds(JSON.parse(JSON.stringify(offers)))).toEqual(offers.curseIds);
  expect(getAltarCurseIds({ curseId: 'decay' })).toEqual(['decay']);
  expect(rollAltarChoices([pool[0], pool[0]], () => 0).curseIds).toEqual([pool[0].id]);
  expect(rollAltarChoices([], () => 0)).toEqual({});
});

test('simulator chooses only an offered acceptable curse and applies its preference', () => {
  const { chooseSimulationAltar } = require('./simulationAltars');
  const state = resolveSimulationCurseState({ withering: 2 }, 3);
  expect(chooseSimulationAltar(state, ['decay', 'withering'], 3, 'accept')).toBe('withering');
  expect(chooseSimulationAltar(state, ['decay', 'withering'], 3, 'accept', 'decay')).toBe('decay');
  expect(chooseSimulationAltar(state, ['decay', 'withering'], 3, 'up_to_ii', 'withering')).toBe('decay');
  expect(chooseSimulationAltar(state, ['decay'], 3, 'accept', 'corruption')).toBe('decay');
  expect(chooseSimulationAltar(state, ['decay', 'withering'], 3, 'skip')).toBeNull();
  const route = createHexCraftingRoute({ location: 'fungal', seed: 4, preferredCurseId: 'decay' });
  for (const altar of route.route.filter(cell => cell.roomType === 'CURSE_ALTAR')) {
    expect(altar.curseIds).toHaveLength(2);
    expect(altar.curseIds).toContain(altar.curseId);
  }
});
