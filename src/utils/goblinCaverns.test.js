import { createExpeditionMapRun, moveExpeditionRun, resolveCurrentExpeditionCell,
  cancelPendingExpeditionCell } from './expeditionMapRun';
import { applyMapProgressLocks, buildHexEdges, findKnownMapTravelPath, moveToCell,
  getHexMacroTemplatesForLocation } from './expeditionMapLayout';
import { createSeededSimulationRng } from './simulationRng';
import { auditMapGeometry, mapAdjacency, floodMap } from './expeditionGeometryAudit';
import { GOBLIN_CAVERNS_ID } from './goblinCaverns';
import { createHexCraftingRoute } from './hexCraftingSimulator';
import { isStrongEnemy } from './levelOneProgression';

const create = (seed, templateId = GOBLIN_CAVERNS_ID, abyssLevel = 1) => createExpeditionMapRun({
  locationId: 'Гоблинские Норы', templateId, abyssLevel,
  rng: typeof seed === 'function' ? seed : createSeededSimulationRng(seed),
});
const histogram = run => {
  const result = {};
  run.mainLayout.cells.filter(c => c.significant && !c.supplementalReward && !c.supplementalContent).forEach(c => {
    const key = [c.region, c.sublocationId, c.previewRoomType].join(':');
    result[key] = (result[key] || 0) + 1;
  });
  return result;
};

test('new runs replace exactly one variant; old template IDs remain loadable', () => {
  expect(getHexMacroTemplatesForLocation('Гоблинские Норы').map(t => t.id))
    .toEqual(['wide-cavern-01', GOBLIN_CAVERNS_ID, 'goblin-03', 'goblin-04']);
  for (const id of ['wide-cavern-01', 'goblin-02', 'goblin-03', 'goblin-04']) {
    const old = JSON.parse(JSON.stringify(create(13, id)));
    const before = JSON.stringify({ cells: old.mainLayout.cells.map(c => [c.id, c.q, c.r]), edges: old.mainLayout.edges });
    const destination = old.mainLayout.edges.find(e => e.from === old.mainLayout.currentCellId || e.to === old.mainLayout.currentCellId);
    const nextId = destination.from === old.mainLayout.currentCellId ? destination.to : destination.from;
    const moved = moveExpeditionRun(old, nextId);
    expect(moved.moved).toBe(true);
    expect(JSON.stringify({ cells: moved.run.mainLayout.cells.map(c => [c.id, c.q, c.r]), edges: moved.run.mainLayout.edges })).toBe(before);
    expect(moved.run.mainLayout.templateId).toBe(id);
    expect(moved.run.mainLayout.geometryRevision).toBeUndefined();
  }
});

const budgetSeedCount = Number(process.env.MAP_AUDIT_SEEDS) || 100;
test(`${budgetSeedCount} seeds preserve original events and guarantee rewards for each playable route`, () => {
  const checkRewards = run => {
    for (const slot of run.state.availableSublocationIds) {
      const route = run.mainLayout.cells.filter(c => c.region === 'approach' || c.region === 'depth'
        || (c.region === 'sublocation' && c.sublocationId === slot));
      expect(route.filter(c => c.significant).length).toBeGreaterThanOrEqual(156);
      const rewards = route.filter(c => ['RESOURCE', 'TREASURE'].includes(c.previewRoomType));
      expect(rewards.length).toBeGreaterThanOrEqual(46);
      for (const region of ['approach', 'sublocation', 'depth']) {
        expect(rewards.filter(c => c.region === region).length).toBeGreaterThanOrEqual(region === 'sublocation' ? 10 : 18);
      }
    }
  };
  for (let seed = 0; seed < budgetSeedCount; seed++) {
    const run = create(seed);
    expect(histogram(run)).toEqual(histogram(create(seed, 'goblin-02')));
    checkRewards(run);
  }
  for (const roll of [0, 0.25, 0.6, 0.999999]) {
    for (const floor of [1, 2, 6]) {
      const run = create(() => roll, GOBLIN_CAVERNS_ID, floor);
      expect(histogram(run)).toEqual(histogram(create(() => roll, 'goblin-02', floor)));
      checkRewards(run);
    }
  }
}, 60000);

test('physical geometry and reward cuts survive 40 seeds and every branch', () => {
  for (let seed = 0; seed < 40; seed++) {
    const run = create(seed);
    const result = auditMapGeometry(run.mainLayout);
    expect(result.errors).toEqual([]);
    expect(result.blocked).toBeGreaterThan(100);
    for (const route of result.routes.filter(r => r.rewards > 0)) expect(route.guardedFraction).toBeGreaterThanOrEqual(0.7);
    const guarded = run.mainLayout.cells.filter(c => c.guardedBy);
    const adjacency = mapAdjacency(run.mainLayout);
    const all = new Set(run.mainLayout.cells.filter(c => c.walkable !== false).map(c => c.id));
    for (const reward of guarded) {
      expect(floodMap(adjacency, [run.mainLayout.startCellId], all, new Set([reward.guardedBy])).has(reward.id)).toBe(false);
      expect(floodMap(adjacency, [run.mainLayout.startCellId], all).has(reward.id)).toBe(true);
    }
  }
}, 60000);

test('collision remains authoritative with stale edges and progress locks', () => {
  const run = create(42);
  const blocked = run.mainLayout.cells.find(c => c.walkable === false);
  const corrupted = { ...run.mainLayout,
    cells: run.mainLayout.cells.map(c => ({ ...c, locked: false, revealed: true, resolved: true, visited: true })),
    edges: [...run.mainLayout.edges, { from: run.mainLayout.currentCellId, to: blocked.id }],
  };
  expect(findKnownMapTravelPath(corrupted, blocked.id)).toBeNull();
  expect(moveToCell(corrupted, blocked.id).moved).toBe(false);
  expect(applyMapProgressLocks(corrupted, { ...run.state, progress: { depthUnlocked: true, bossUnlocked: true } })
    .cells.filter(c => c.walkable === false).every(c => c.locked)).toBe(true);
  expect(buildHexEdges(corrupted.cells).some(e => e.from === blocked.id || e.to === blocked.id)).toBe(false);
});

test('all chosen branches actually collect forty-six direct rewards; approach never unlocks Strong enemies', () => {
  for (const sublocationSlot of [0, 1, 2]) {
    const result = createHexCraftingRoute({ location: 'goblin', templateId: GOBLIN_CAVERNS_ID, sublocationSlot, seed: 42 });
    const rewards = result.route.filter(c => ['RESOURCE', 'TREASURE'].includes(c.roomType));
    expect(rewards.length).toBeGreaterThanOrEqual(46);
    expect(rewards.every(c => c.loot.length > 0)).toBe(true);
    const branches = new Set(result.route.filter(c => c.phase === 'sublocation').map(c => c.sublocationId));
    expect([...branches]).toEqual([result.selectedSublocationId]);
    expect(result.route.filter(c => c.phase === 'approach').flatMap(c => c.enemies).some(isStrongEnemy)).toBe(false);
    expect(result.route.filter(c => c.phase === 'sublocation' && c.roomType === 'COMBAT')
      .every(c => c.enemies.some(isStrongEnemy))).toBe(true);
  }
});

test('guards, fog and unresolved events stop long travel; a cleared guard reopens it', () => {
  const run = create(42);
  const reward = run.mainLayout.cells.find(c => c.region === 'approach' && c.guardedBy);
  const known = { ...run.mainLayout, cells: run.mainLayout.cells.map(c => ({ ...c,
    revealed: true, visited: true, resolved: c.id !== reward.guardedBy && c.id !== reward.id,
  })) };
  expect(findKnownMapTravelPath(known, reward.id)).toBeNull();
  expect(findKnownMapTravelPath(known, reward.guardedBy).length).toBeGreaterThan(1);
  const cleared = { ...known, cells: known.cells.map(c => c.id === reward.guardedBy ? { ...c, resolved: true } : c) };
  expect(findKnownMapTravelPath(cleared, reward.id).length).toBeGreaterThan(1);
  const hidden = { ...cleared, cells: cleared.cells.map(c => c.id === reward.guardedBy ? { ...c, revealed: false } : c) };
  expect(findKnownMapTravelPath(hidden, reward.id)).toBeNull();
  const moved = moveExpeditionRun({ ...run, mainLayout: known }, reward.guardedBy);
  expect(moved.moved).toBe(true);
  expect(moved.run.pendingCellId).toBe(reward.guardedBy);
  expect(moveExpeditionRun(moved.run, reward.id).moved).toBe(false);
  const backed = cancelPendingExpeditionCell(moved.run);
  expect(backed.mainLayout.currentCellId).not.toBe(reward.guardedBy);
  expect(findKnownMapTravelPath(backed.mainLayout, reward.id)).toBeNull();
  expect(moveExpeditionRun(resolveCurrentExpeditionCell(moved.run), reward.id).moved).toBe(true);
});

const travel = (initial, target, allowed) => {
  let run = initial;
  const adjacency = mapAdjacency(run.mainLayout);
  const queue = [[run.mainLayout.currentCellId]];
  const seen = new Set(queue[0]);
  let route;
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i], tail = path[path.length - 1];
    if (tail === target) { route = path.slice(1); break; }
    for (const id of adjacency.get(tail) || []) if (allowed.has(id) && !seen.has(id)) {
      seen.add(id); queue.push([...path, id]);
    }
  }
  expect(route).toBeDefined();
  for (const id of route) {
    const moved = moveExpeditionRun(run, id);
    expect(moved.moved).toBe(true);
    run = resolveCurrentExpeditionCell(moved.run);
  }
  return run;
};
const clear = (initial, predicate) => {
  let run = initial;
  const region = run.mainLayout.cells.filter(predicate);
  const allowed = new Set(region.map(c => c.id));
  for (const cell of region.filter(c => c.significant)) run = travel(run, cell.id, allowed);
  return run;
};

test.each([0, 1, 17, 42, 99, 'all-noncombat'])('all branches reach the boss with earned keys and save/reload, seed %s', seed => {
  for (let slot = 0; slot < 3; slot++) {
    let run = create(seed === 'all-noncombat' ? () => 0.999999 : seed);
    const chosen = run.state.availableSublocationIds[slot];
    const ids = predicate => new Set(run.mainLayout.cells.filter(predicate).map(c => c.id));
    const entrance = run.mainLayout.sublocationEntranceCellIds[chosen];
    const depthEntry = run.mainLayout.depthEntryCellIds[chosen];
    expect(moveExpeditionRun(run, entrance).reason).toBe('sublocation-key-required');
    run = clear(run, c => c.region === 'approach');
    expect(run.state.keys.sublocation.owned).toBe(true);
    run = travel(run, entrance, ids(c => c.region === 'approach' || c.id === entrance));
    expect(run.state.keys.sublocation.consumed).toBe(true);
    expect(run.mainLayout.cells.filter(c => c.region === 'sublocation' && c.sublocationId !== chosen).every(c => c.locked)).toBe(true);
    expect(moveExpeditionRun(run, depthEntry).reason).toBe('depth-key-required');
    run = clear(run, c => c.region === 'sublocation' && c.sublocationId === chosen);
    expect(run.state.keys.depth.owned).toBe(true);
    const saved = JSON.parse(JSON.stringify(run));
    expect(saved).toEqual(run);
    run = travel(saved, depthEntry, ids(c => (c.region === 'sublocation' && c.sublocationId === chosen) || c.id === depthEntry));
    expect(run.state.keys.depth.consumed).toBe(true);
    expect(moveExpeditionRun(run, run.mainLayout.bossCellId).reason).toBe('boss-key-required');
    run = clear(run, c => c.region === 'depth');
    expect(run.state.keys.boss.owned).toBe(true);
    run = travel(run, run.mainLayout.bossCellId, ids(c => c.region === 'depth' || c.region === 'boss'));
    expect(run.state.keys.boss.consumed).toBe(true);
    expect(run.mainLayout.currentCellId).toBe(run.mainLayout.bossCellId);
  }
}, 60000);
