import { createHash } from 'crypto';
import { LOCATION_HEX_TEMPLATES, getHexMacroTemplatesForLocation, generateMainExpeditionLayout } from './expeditionMapLayout';
import { auditExpeditionLayout } from './expeditionLayoutValidation';
import { createExpeditionMapState } from './expeditionMap';
import { createSeededSimulationRng } from './simulationRng';
import { createExpeditionMapRun, moveExpeditionRun, resolveCurrentExpeditionCell } from './expeditionMapRun';
import { LEVEL_TWO_LOCATIONS } from '../data/locations';

const adjacencyFor = layout => {
  const out = new Map(layout.cells.map(c => [c.id, []]));
  layout.edges.forEach(({ from, to }) => { out.get(from).push(to); out.get(to).push(from); });
  return out;
};
const travel = (initial, target, allowed) => {
  let run = initial;
  const adj = adjacencyFor(run.mainLayout);
  const queue = [[run.mainLayout.currentCellId]]; const seen = new Set(queue[0]);
  let path;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i], tail = current[current.length - 1];
    if (tail === target) { path = current.slice(1); break; }
    for (const id of adj.get(tail)) {
      if (!seen.has(id) && allowed.has(id)) { seen.add(id); queue.push([...current, id]); }
    }
  }
  expect(path).toBeDefined();
  for (const id of path) {
    const moved = moveExpeditionRun(run, id, { rng: () => 0.999999 });
    expect(moved.moved).toBe(true);
    run = resolveCurrentExpeditionCell(moved.run, { rng: () => 0.999999 });
  }
  return run;
};
const clearRegion = (initial, predicate) => {
  let run = initial;
  const cells = run.mainLayout.cells.filter(predicate), allowed = new Set(cells.map(c => c.id));
  for (const c of cells.filter(c => c.significant)) run = travel(run, c.id, allowed);
  return run;
};

test('exactly four distinct templates per non-goblin location; all three floor-II destinations are enabled', () => {
  expect(LOCATION_HEX_TEMPLATES).toHaveLength(20);
  const locations = new Set(LOCATION_HEX_TEMPLATES.map(t => t.locationId));
  expect(locations.size).toBe(5);
  for (const location of locations) expect(getHexMacroTemplatesForLocation(location)).toHaveLength(4);
  expect(new Set(LOCATION_HEX_TEMPLATES.map(t => JSON.stringify([t.approach.coordinates, t.sublocations.map(s => s.coordinates), t.depth.coordinates]))).size).toBe(20);
  expect(getHexMacroTemplatesForLocation('Гоблинские Норы').map(t => t.id)).toEqual(['wide-cavern-01', 'goblin-caverns-02', 'goblin-03', 'goblin-04']);
  expect(createHash('sha256').update(JSON.stringify(getHexMacroTemplatesForLocation('Гоблинские Норы')[0])).digest('hex')).toBe('1fa5fd2359883137971d130fb005fea07c094588109d6a4b3fd379102f8d08dc');
  expect(LEVEL_TWO_LOCATIONS.map(({ id, enabled }) => [id, enabled])).toEqual([
    ['withering_forest', true],
    ['restless_ruins', true],
    ['mines_of_decay', true],
  ]);
});

describe.each(LOCATION_HEX_TEMPLATES)('$id', template => {
  test('geometry, meaningful counts and altar budgets on every floor', () => {
    for (let floor = 1; floor <= 6; floor++) {
      const rng = createSeededSimulationRng(floor * 100);
      const state = createExpeditionMapState({ locationId: template.locationId, abyssLevel: floor, sublocations: ['a','b','c','d'], rng });
      const layout = generateMainExpeditionLayout(state, { templateId: template.id, rng });
      expect(auditExpeditionLayout(layout).errors).toEqual([]);
      for (const id of state.availableSublocationIds) {
        expect(layout.cells.filter(c => c.forcedRoomType === 'CURSE_ALTAR' && (c.region !== 'sublocation' || c.sublocationId === id)).length).toBe(state.altarBudget.total);
      }
    }
  });
  test('selection supports canonical name and ID, persists, and rejects another location', () => {
    for (const locationId of [template.locationId, template.locationKey]) {
      const run = createExpeditionMapRun({ locationId, templateId: template.id, rng: createSeededSimulationRng(1) });
      expect(run.mainLayout.templateId).toBe(template.id);
      expect(JSON.parse(JSON.stringify(run))).toEqual(run);
    }
    expect(() => createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: template.id })).toThrow(/Unknown map template/);
  });
  test.each([0,17,999,'all-noncombat'])('all three branches finish with naturally earned keys, seed %s', seed => {
    for (let slot = 0; slot < 3; slot++) {
      let run = createExpeditionMapRun({ locationId: template.locationId, templateId: template.id, abyssLevel: template.locationKey.includes('fungal') || template.locationKey === 'deserter' ? 1 : 2, rng: seed === 'all-noncombat' ? () => 0.999999 : createSeededSimulationRng(seed) });
      const chosen = run.state.availableSublocationIds[slot];
      const entrance = run.mainLayout.sublocationEntranceCellIds[chosen];
      const exit = run.mainLayout.sublocationExitCellIds[chosen];
      const depthEntry = run.mainLayout.depthEntryCellIds[chosen];
      const all = new Set(run.mainLayout.cells.map(c => c.id));
      const adj = adjacencyFor(run.mainLayout);
      const parent = adj.get(entrance).find(id => run.mainLayout.cells.find(c => c.id === id).region === 'approach');
      // No content or keys are injected: moving/clearing invokes production key pity.
      expect(run.state.keys.sublocation.owned).toBe(false);
      run = clearRegion(run, c => c.region === 'approach');
      expect(run.state.keys.sublocation.owned).toBe(true);
      expect(moveExpeditionRun({ ...run, state: { ...run.state, keys: { ...run.state.keys, sublocation: { owned: false, consumed: false } } } }, entrance).reason).toBe('sublocation-key-required');
      run = travel(run, entrance, new Set([...run.mainLayout.cells.filter(c => c.region === 'approach').map(c => c.id), entrance]));
      expect(run.state.selectedSublocationId).toBe(chosen);
      expect(run.state.keys.sublocation.consumed).toBe(true);
      expect(run.mainLayout.cells.filter(c => c.region === 'sublocation' && c.sublocationId !== chosen).every(c => c.locked)).toBe(true);
      run = travel(run, parent, all); run = travel(run, entrance, all);
      run = clearRegion(run, c => c.sublocationId === chosen && c.region === 'sublocation');
      expect(run.state.keys.depth.owned).toBe(true);
      expect(moveExpeditionRun({ ...run, state: { ...run.state, keys: { ...run.state.keys, depth: { owned: false, consumed: false } } } }, depthEntry).reason).toBe('depth-key-required');
      run = travel(run, depthEntry, new Set([...run.mainLayout.cells.filter(c => c.region === 'sublocation' && c.sublocationId === chosen).map(c => c.id), depthEntry]));
      expect(run.state.keys.depth.consumed).toBe(true);
      run = travel(run, exit, all); run = travel(run, depthEntry, all);
      run = clearRegion(run, c => c.region === 'depth');
      expect(run.state.keys.boss.owned).toBe(true);
      expect(moveExpeditionRun({ ...run, state: { ...run.state, keys: { ...run.state.keys, boss: { owned: false, consumed: false } } } }, run.mainLayout.bossCellId).reason).toBe('boss-key-required');
      run = travel(run, run.mainLayout.bossCellId, new Set(run.mainLayout.cells.filter(c => ['depth','boss'].includes(c.region)).map(c => c.id)));
      expect(run.state.keys.boss.consumed).toBe(true);
      expect(run.mainLayout.currentCellId).toBe(run.mainLayout.bossCellId);
    }
  });
});


test('all four variants can be selected without an explicit override', () => {
  const goblin = [0, 0.25, 0.5, 0.999999].map(value =>
    createExpeditionMapRun({ locationId: 'Гоблинские Норы', rng: () => value }).mainLayout.templateId);
  expect(goblin).toEqual(['wide-cavern-01', 'goblin-caverns-02', 'goblin-03', 'goblin-04']);
  for (const locationId of new Set(LOCATION_HEX_TEMPLATES.map(t => t.locationId))) {
    const ids = [0, .25, .5, .999999].map(value => createExpeditionMapRun({ locationId, rng: () => value }).mainLayout.templateId);
    expect(new Set(ids).size).toBe(4);
  }
});

test('audit rejects a removed gate and an added boss shortcut', () => {
  const t = LOCATION_HEX_TEMPLATES[0];
  const run = createExpeditionMapRun({ locationId: t.locationId, templateId: t.id, rng: createSeededSimulationRng(0) });
  const layout = run.mainLayout;
  expect(auditExpeditionLayout({ ...layout, edges: layout.edges.slice(0,-1) }).ok).toBe(false);
  expect(auditExpeditionLayout({ ...layout, edges: [...layout.edges, { from: layout.startCellId, to: layout.bossCellId }] }).ok).toBe(false);
  // Even a short spur with a high-degree connecting cell must be rejected:
  // the old degree/loop-only audit could miss such transit bottlenecks.
  const adj = adjacencyFor(layout);
  const leaf = layout.cells.find(c => c.region === 'approach' && c.id !== layout.startCellId && adj.get(c.id).length >= 3 && adj.get(c.id).every(id => layout.cells.find(n => n.id === id).region === 'approach'));
  const retained = adj.get(leaf.id)[0];
  const narrowed = { ...layout, edges: layout.edges.filter(e => (e.from !== leaf.id && e.to !== leaf.id) || e.from === retained || e.to === retained) };
  expect(auditExpeditionLayout(narrowed).errors.some(error => error.startsWith('Interior chokepoint'))).toBe(true);

});

test('new locations retain the Goblin reference encounter mix, including narrow paths', () => {
  // Reference: four authored Goblin boards, commit 4ca2fcb5, 300 seeds,
  // floor 1. Mean ranges: Approach 7.07–7.29, sublocation 8.31–8.33,
  // Depth 13.49–14. Allow 1.1 fights for differing geometry and guarded rewards.
  const reference = { approach: [7.07, 7.29], sublocation: [8.31, 8.33], depth: [13.49, 14] };
  for (const template of LOCATION_HEX_TEMPLATES) {
    const totals = { approach: 0, sublocation: 0, depth: 0 };
    for (let seed = 0; seed < 300; seed++) {
      const run = createExpeditionMapRun({ locationId: template.locationId, templateId: template.id, abyssLevel: 1, rng: createSeededSimulationRng(seed) });
      for (const cell of run.mainLayout.cells) {
        if (['COMBAT', 'CURSED_ENEMY'].includes(cell.previewRoomType)) totals[cell.region]++;
      }
      expect(['COMBAT', 'CURSED_ENEMY']).toContain(run.mainLayout.cells.find(cell => cell.id === run.mainLayout.depthCompletionCellId).previewRoomType);
    }
    for (const phase of Object.keys(totals)) {
      const mean = totals[phase] / (phase === 'sublocation' ? 900 : 300);
      expect(mean).toBeGreaterThanOrEqual(reference[phase][0] - 1.1);
      expect(mean).toBeLessThanOrEqual(reference[phase][1] + 1.1);
    }
  }
});

