import { buildHexEdges, getHexDistance, hexKey } from './expeditionMapLayout';
import { DIRECT_MAP_REWARDS } from './goblinCaverns';

export const mapAdjacency = layout => {
  const adjacency = new Map(layout.cells.filter(c => c.walkable !== false).map(c => [c.id, []]));
  layout.edges.forEach(({ from, to }) => {
    if (adjacency.has(from) && adjacency.has(to)) {
      adjacency.get(from).push(to); adjacency.get(to).push(from);
    }
  });
  return adjacency;
};

export const floodMap = (adjacency, starts, allowed, blocked = new Set()) => {
  const queue = starts.filter(id => allowed.has(id) && !blocked.has(id));
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    for (const id of adjacency.get(queue[i]) || []) {
      if (allowed.has(id) && !blocked.has(id) && !seen.has(id)) { seen.add(id); queue.push(id); }
    }
  }
  return seen;
};

export const auditMapGeometry = layout => {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  const walkable = layout.cells.filter(c => c.walkable !== false);
  const blocked = layout.cells.filter(c => c.walkable === false);
  const byId = new Map(layout.cells.map(c => [c.id, c]));
  const adjacency = mapAdjacency(layout);
  const all = new Set(walkable.map(c => c.id));
  const pair = ({ from, to }) => [from, to].sort().join('|');
  check(byId.size === layout.cells.length, 'Duplicate cell IDs');
  check(new Set(layout.cells.map(hexKey)).size === layout.cells.length, 'Overlapping coordinates');
  check(layout.edges.every(e => all.has(e.from) && all.has(e.to)), 'Edge crosses collision terrain');
  check(layout.edges.every(e => byId.has(e.from) && byId.has(e.to)
    && getHexDistance(byId.get(e.from), byId.get(e.to)) === 1), 'Invalid physical edge');
  const physical = new Set(buildHexEdges(walkable).map(pair));
  const actual = new Set(layout.edges.map(pair));
  check(actual.size === layout.edges.length, 'Duplicate edge');
  check(physical.size === actual.size && [...physical].every(e => actual.has(e)), 'Missing physical edge');
  check(floodMap(adjacency, [layout.startCellId], all).size === all.size, 'Disconnected walkable graph');
  check(blocked.every(c => !c.significant && !c.landmark && !c.previewRoomType), 'Content on collision terrain');

  const slotIds = Object.keys(layout.sublocationEntranceCellIds);
  const groups = ['approach', ...slotIds, 'depth', 'boss'];
  const expectedCounts = [15, 14, 14, 14, 14, 1];
  const regionIndex = new Map();
  const regions = groups.map((name, index) => {
    const cells = walkable.filter(c => c.region === name || (c.region === 'sublocation' && c.sublocationId === name));
    const allowed = new Set(cells.map(c => c.id));
    cells.forEach(c => regionIndex.set(c.id, index));
    const roots = index === 0 ? [layout.startCellId]
      : index < 4 ? [layout.sublocationEntranceCellIds[name]]
        : index === 4 ? Object.values(layout.depthEntryCellIds) : [layout.bossCellId];
    check(cells.length > 0 && roots.every(id => allowed.has(id)), `Invalid roots: ${name}`);
    check(floodMap(adjacency, roots.slice(0, 1), allowed).size === cells.length, `Disconnected region: ${name}`);
    check(cells.filter(c => c.significant && !c.supplementalReward && !c.supplementalContent).length === expectedCounts[index], `Changed base event budget: ${name}`);
    const budget = layout.contentBudgets?.[cells[0]?.region];
    if (budget) check(cells.filter(c => c.significant).length >= budget.events, `Insufficient events: ${name}`);
    const eventQueue = cells.filter(c => c.significant).map(c => c.id);
    const eventDistance = new Map(eventQueue.map(id => [id, 0]));
    for (let i = 0; i < eventQueue.length; i++) {
      for (const id of adjacency.get(eventQueue[i]) || []) {
        if (allowed.has(id) && !eventDistance.has(id)) {
          eventDistance.set(id, eventDistance.get(eventQueue[i]) + 1);
          eventQueue.push(id);
        }
      }
    }
    const maxEventDistance = eventDistance.size === cells.length ? Math.max(...eventDistance.values()) : Infinity;
    if (budget) check(maxEventDistance <= 2, `Empty stretch exceeds two steps: ${name}`);
    const combat = new Set(cells.filter(c => ['COMBAT', 'CURSED_ENEMY'].includes(c.previewRoomType)).map(c => c.id));
    if (budget) check(combat.size >= budget.battles, `Insufficient battles: ${name}`);
    const withoutFights = floodMap(adjacency, roots, allowed, combat);
    const rewards = cells.filter(c => DIRECT_MAP_REWARDS.has(c.previewRoomType));
    if (budget) check(rewards.length >= budget.rewards, `Insufficient rewards: ${name}`);
    if (index < 5 && layout.minimumDirectRewardsPerRegion) {
      check(rewards.length >= layout.minimumDirectRewardsPerRegion, `Insufficient accessible rewards: ${name}`);
    }
    const byType = Object.fromEntries(['RESOURCE', 'TREASURE', 'SECRET', 'FISHING'].map(type => {
      const typed = cells.filter(c => c.previewRoomType === type);
      return [type, { total: typed.length, guarded: typed.filter(c => !withoutFights.has(c.id)).length }];
    }));
    for (const reward of rewards.filter(c => c.guardedBy)) {
      check(combat.has(reward.guardedBy), `Missing guard for ${reward.id}`);
      // Ignore ALL progression locks and allow all three branches: a guard
      // must remain a physical cut even under this stricter adversarial graph.
      check(!floodMap(adjacency, [layout.startCellId, ...roots], all, new Set([reward.guardedBy])).has(reward.id),
        `Guard bypass: ${reward.id}`);
    }
    const guarded = rewards.filter(c => !withoutFights.has(c.id)).length;
    if (layout.geometryRevision && rewards.length) check(guarded / rewards.length >= 0.7, `Unguarded reward budget: ${name}`);
    const localDegree = id => (adjacency.get(id) || []).filter(n => allowed.has(n)).length;
    const narrow = new Set(cells.filter(c => localDegree(c.id) <= 2).map(c => c.id));
    let longestThinComponent = 0;
    while (narrow.size) {
      const connected = floodMap(adjacency, [narrow.values().next().value], narrow);
      longestThinComponent = Math.max(longestThinComponent, connected.size);
      connected.forEach(id => narrow.delete(id));
    }
    const cuts = cells.filter(c => {
      const remaining = new Set([...allowed].filter(id => id !== c.id));
      return remaining.size && floodMap(adjacency, [remaining.values().next().value], remaining).size !== remaining.size;
    }).map(c => c.id);
    if (layout.geometryRevision && index < 5) {
      const plannedCuts = new Set((layout.rewardAreas || []).filter(a =>
        a.region === name || a.sublocationId === name).map(a => a.guardCellId));
      check(cuts.every(id => plannedCuts.has(id)), `Unplanned interior choke: ${name}`);
      check(longestThinComponent <= 2, `Long narrow corridor: ${name}`);
      check(cells.filter(c => localDegree(c.id) >= 3).length >= cells.length * 0.88, `Insufficient broad ground: ${name}`);
    }
    return {
      name, walkable: cells.length, events: cells.filter(c => c.significant).length, maxEventDistance,
      battles: combat.size, rewards: rewards.length, guarded, byType,
      broadCells: cells.filter(c => localDegree(c.id) >= 3).length,
      deadEnds: cells.filter(c => localDegree(c.id) === 1).length,
      longestThinComponent, articulationPoints: cuts.length, articulationCellIds: cuts,
      cycleRank: cells.reduce((sum, c) => sum + localDegree(c.id), 0) / 2 - cells.length + 1,
    };
  });
  const crossings = layout.edges.filter(e => regionIndex.get(e.from) !== regionIndex.get(e.to));
  const expectedGates = new Set([pair({ from: layout.depthCompletionCellId, to: layout.bossCellId })]);
  slotIds.forEach(id => {
    const entrance = layout.sublocationEntranceCellIds[id];
    const parents = (adjacency.get(entrance) || []).filter(n => byId.get(n)?.region === 'approach');
    check(parents.length === 1, `Unexpected entrance: ${id}`);
    expectedGates.add(pair({ from: parents[0], to: entrance }));
    expectedGates.add(pair({ from: layout.sublocationExitCellIds[id], to: layout.depthEntryCellIds[id] }));
  });
  check(crossings.length === 7 && crossings.every(e => expectedGates.has(pair(e))), 'Progression gate bypass');
  check(adjacency.get(layout.bossCellId)?.length === 1, 'Boss entrance bypass');
  const routes = slotIds.map((id, i) => {
    const selected = [regions[0], regions[i + 1], regions[4], regions[5]];
    const rewards = selected.reduce((sum, r) => sum + r.rewards, 0);
    const guarded = selected.reduce((sum, r) => sum + r.guarded, 0);
    const events = selected.reduce((sum, r) => sum + r.events, 0);
    if (layout.minimumDirectRewardsPerRegion) check(rewards >= 3 * layout.minimumDirectRewardsPerRegion, `Insufficient route rewards: ${id}`);
    return { sublocationId: id, events, rewards, guarded, guardedFraction: rewards ? guarded / rewards : null };
  });
  return { templateId: layout.templateId, ok: !errors.length, errors, walkable: walkable.length,
    blocked: blocked.length, regions, routes };
};
