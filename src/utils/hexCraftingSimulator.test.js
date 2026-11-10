import { createHexCraftingRoute, simulateHexCraftingRun } from './hexCraftingSimulator';
import { createExpeditionMapRun, moveExpeditionRun, resolveCurrentExpeditionCell, setPendingExpeditionCellContent } from './expeditionMapRun';
import { getAdjacentCellIds } from './expeditionMapLayout';
import { createSeededSimulationRng } from './simulationRng';

test.each(['goblin', 'fungal', 'deserter'])('%s trace traverses actual gates, three zones and one boss without repeated loot cells', location => {
  const route = createHexCraftingRoute({ location, seed: 17 });
  expect(new Set(route.route.map(c => c.cellId)).size).toBe(route.route.length);
  expect(route.route.filter(c => c.phase === 'boss')).toHaveLength(1);
  expect([...new Set(route.route.map(c => c.phase))]).toEqual(['approach', 'sublocation', 'depth', 'boss']);
  expect(new Set(route.route.filter(c => c.phase === 'sublocation').map(c => c.sublocationId)).size).toBe(1);
  expect(route.route.filter(c => c.phase === 'depth' && c.enemies.length).every(c => c.enemies.every(e => e.abyssPowerApplied))).toBe(true);
});

test('same seeds reproduce outcomes and policy execution cannot mutate authored encounters', () => {
  const route = createHexCraftingRoute({ location: 'goblin', seed: 7 });
  const before = JSON.stringify(route);
  const options = { route, classId: 'Defender', profile: 'prepared', craftPolicy: 'prepared' };
  const first = simulateHexCraftingRun(options);
  expect(simulateHexCraftingRun(options)).toEqual(first);
  expect(JSON.stringify(route)).toBe(before);
  expect(first.abnormal).toBe(false);
  expect(simulateHexCraftingRun({ ...options, craftPolicy: 'off' }).crafted).toEqual({});
});

test('resolved resource cells cannot offer another reward after reload and re-entry', () => {
  let run = createExpeditionMapRun({ locationId: 'Гоблинские Норы', rng: createSeededSimulationRng(3) });
  const origin = run.mainLayout.currentCellId;
  const adjacent = getAdjacentCellIds(run.mainLayout, origin).find(id => moveExpeditionRun(run, id).moved);
  run.mainLayout.cells = run.mainLayout.cells.map(c => c.id === adjacent ? { ...c, significant: true, resolved: false, previewRoomType: 'RESOURCE' } : c);
  run = moveExpeditionRun(run, adjacent).run;
  run = resolveCurrentExpeditionCell(setPendingExpeditionCellContent(run, { roomType: 'RESOURCE', loot: [{ name: 'Кровяной мох', quantity: 2 }] }));
  run = JSON.parse(JSON.stringify(run));
  run = moveExpeditionRun(run, origin).run;
  const returned = moveExpeditionRun(run, adjacent);
  expect(returned.moved).toBe(true);
  expect(returned.run.pendingCellId).toBeNull();
});

test('sequential combat keeps lost HP and a custom empty consumable loadout', () => {
  const foe = { name: 'Attrition probe', hp: 1, maxHp: 1, attack: 0, speed: 1, physDef: 0, magicDef: 0, abilities: [] };
  const route = { location: { id: 'goblin', name: 'Гоблинские Норы' }, route: [
    { cellId: 'trap', phase: 'approach', enemies: [], loot: [], trapDamage: 7, seed: 1 },
    { cellId: 'first', phase: 'approach', enemies: [foe], loot: [], trapDamage: 7, seed: 2 },
    { cellId: 'second', phase: 'sublocation', enemies: [foe], loot: [], trapDamage: 0, seed: 3 },
  ] };
  const result = simulateHexCraftingRun({ route, classId: 'Archer', profile: 'prepared', craftPolicy: 'off', playerOptions: { consumables: [] } });
  expect(result.combats).toHaveLength(2);
  expect(result.combats[0].startingHp).toBe(result.combats[0].maxHp - 7);
  expect(result.combats[1].startingHp).toBe(result.combats[0].endingHp - 7);
  expect(result.phases.sublocation.hp).toBe(result.combats[1].startingHp);
  expect(result.used).toEqual({});
  expect(result.remaining).toEqual({});
});
