import geometry from '../data/goblinCavernsGeometry.json';

export const GOBLIN_CAVERNS_ID = geometry.id;
export const GOBLIN_CAVERNS_SPEC = {
  id: geometry.id, contentSourceId: 'goblin-02', label: 'Гоблинские Норы — широкие пещеры',
  approach: { coordinates: geometry.regions[0].cells.map(([q, r]) => ({ q, r })), start: { q: -6, r: 13 } },
  sublocations: geometry.regions.slice(1, 4).map((region, i) => ({
    coordinates: region.cells.map(([q, r]) => ({ q, r })),
    entrance: { q: -15 + i * 12, r: 6 }, approachParent: { q: -15 + i * 12, r: 7 },
    exit: { q: -9 + i * 12, r: -6 }, depthEntry: { q: -9 + i * 12, r: -7 },
  })),
  depth: { coordinates: geometry.regions[4].cells.map(([q, r]) => ({ q, r })), completion: { q: 6, r: -14 } },
  boss: { coordinates: [{ q: 6, r: -15 }], boss: { q: 6, r: -15 } },
};
const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = c => `${c.q},${c.r}`;
const distance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r)
  + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const point = ([q, r]) => ({ q, r });
const battles = new Set(['COMBAT', 'CURSED_ENEMY']);
// Fishing requires a successful minigame, SECRET has random outcomes. Neither
// is a guaranteed direct reward; both are reported separately by the audit.
export const DIRECT_MAP_REWARDS = new Set(['RESOURCE', 'TREASURE']);
// Budgets apply to each reachable region, not to all three alternative branches.
export const GOBLIN_CONTENT_BUDGETS = {
  approach: { events: 64, rewards: 18, battles: 18, fishing: 2 },
  sublocation: { events: 28, rewards: 10, battles: 8, fishing: 1 },
  depth: { events: 64, rewards: 18, battles: 18, fishing: 2 },
};
const payloadKeys = ['significant', 'resolved', 'content', 'forcedRoomType',
  'forcedRoomTypePool', 'previewRoomType', 'supplementalReward', 'supplementalContent'];

// Generate the exact old event lottery first. This projection preserves its
// ordered cells and content-weight profile, so equal seeds retain every event
// type and the existing minimum-key-fight safeguard. It runs ONLY at creation.
export const reshapeGoblinCaverns = source => {
  const slotIds = Object.keys(source.sublocationEntranceCellIds);
  const sourceGroups = [
    source.cells.filter(c => c.region === 'approach'),
    ...slotIds.map(id => source.cells.filter(c => c.sublocationId === id)),
    source.cells.filter(c => c.region === 'depth'),
    source.cells.filter(c => c.region === 'boss'),
  ];
  const coordinatesById = new Map();
  const additions = [];
  const rewardAreas = [];
  geometry.regions.forEach((spec, index) => {
    const old = sourceGroups[index];
    const occupied = new Set();
    const fixed = new Map();
    const reserve = (id, p) => { fixed.set(id, point(p)); occupied.add(p.join(',')); };
    if (index === 0) {
      reserve(source.startCellId, spec.start);
      slotIds.forEach((id, i) => {
        const entrance = source.sublocationEntranceCellIds[id];
        const parent = source.edges.find(e => (e.from === entrance && old.some(c => c.id === e.to))
          || (e.to === entrance && old.some(c => c.id === e.from)));
        reserve(parent.from === entrance ? parent.to : parent.from, [-15 + i * 12, 7]);
      });
    } else if (index < 4) {
      reserve(source.sublocationEntranceCellIds[slotIds[index - 1]], spec.entrance);
      reserve(source.sublocationExitCellIds[slotIds[index - 1]], spec.exit);
    } else if (index === 4) {
      slotIds.forEach((id, i) => reserve(source.depthEntryCellIds[id], [-9 + i * 12, -7]));
      reserve(source.depthCompletionCellId, spec.completion);
    } else reserve(source.bossCellId, spec.boss);
    const available = spec.cells.map(point).filter(c => !occupied.has(key(c)));
    old.forEach(c => coordinatesById.set(c.id, fixed.get(c.id) || available.shift()));
    available.forEach((p, i) => additions.push({
      ...old[0], ...p, id: `cavern-${spec.name}-${i}`, landmark: null,
      significant: false, resolved: true, content: null,
      visited: false, revealed: false,
    }));
    rewardAreas.push(...spec.bays.map((bay, i) => ({
      id: `${spec.name}-bay-${i + 1}`, region: old[0].region,
      sublocationId: old[0].sublocationId, guardCoordinate: point(bay.guard),
      rewardCoordinates: bay.rewards.map(point),
    })));
  });
  let cells = [...source.cells.map(c => ({
    ...c, ...coordinatesById.get(c.id), contentProfileDegree: c.pathDegree,
  })), ...additions];
  additions.forEach(c => { delete c.forcedRoomType; });
  const byCoordinate = new Map(cells.map(c => [key(c), c]));
  const edges = cells.flatMap(c => directions.flatMap(([q, r]) => {
    const neighbor = byCoordinate.get(`${c.q + q},${c.r + r}`);
    return neighbor && c.id < neighbor.id ? [{ from: c.id, to: neighbor.id }] : [];
  }));
  const degree = new Map();
  edges.forEach(({ from, to }) => { degree.set(from, (degree.get(from) || 0) + 1); degree.set(to, (degree.get(to) || 0) + 1); });
  cells = cells.map(c => ({ ...c, pathDegree: degree.get(c.id) || 0, walkable: true }));
  const blockedCells = geometry.blocked.map(([q, r]) => ({
    id: `terrain-${q}-${r}`, q, r, walkable: false, region: 'terrain',
    significant: false, resolved: true, revealed: false, visited: false,
    landmark: null, content: null, locked: true,
  }));
  return {
    ...source, templateId: GOBLIN_CAVERNS_ID, geometryRevision: 1,
    contentProfile: source.templateId, cells: [...cells, ...blockedCells], edges,
    rewardAreas: rewardAreas.map(({ guardCoordinate, rewardCoordinates, ...area }) => ({
      ...area, guardCellId: byCoordinate.get(key(guardCoordinate)).id,
      rewardCellIds: rewardCoordinates.map(p => byCoordinate.get(key(p)).id),
    })),
  };
};

// Preserve the original lottery, then fill the expanded ground with a regional
// budget of rewards, fights, fishing and secrets. No old event is removed.
// Side chambers use fights whose cut vertices are tested against
// every entrance, including the three possible entries into the Depth.
export const placeGuardedGoblinContent = layout => {
  if (layout.templateId !== GOBLIN_CAVERNS_ID) return layout;
  const cells = layout.cells.map(c => ({ ...c }));
  const byId = new Map(cells.map(c => [c.id, c]));
  const groupKeys = ['approach', ...Object.keys(layout.sublocationEntranceCellIds), 'depth'];
  for (const group of groupKeys) {
    const inGroup = c => c.region === group || (c.region === 'sublocation' && c.sublocationId === group);
    const groupCells = cells.filter(inGroup);
    const budget = GOBLIN_CONTENT_BUDGETS[groupCells[0].region];
    const movable = groupCells.filter(c => !c.landmark && c.id !== layout.startCellId);
    const payloads = movable.filter(c => c.significant).map(c =>
      Object.fromEntries(payloadKeys.filter(k => c[k] !== undefined).map(k => [k, c[k]])));
    movable.forEach(c => { payloadKeys.forEach(k => delete c[k]); Object.assign(c, { significant: false, resolved: true, content: null }); });
    const add = type => {
      const payload = { significant: true, resolved: false, content: null,
        supplementalContent: true, previewRoomType: type,
        ...(DIRECT_MAP_REWARDS.has(type) ? { supplementalReward: true } : {}),
      };
      payloads.push(payload);
      return payload;
    };
    const rewards = payloads.filter(p => DIRECT_MAP_REWARDS.has(p.previewRoomType));
    while (rewards.length < budget.rewards) {
      const resources = rewards.filter(p => p.previewRoomType === 'RESOURCE').length;
      rewards.push(add(resources <= rewards.length - resources ? 'RESOURCE' : 'TREASURE'));
    }
    const guards = payloads.filter(p => battles.has(p.previewRoomType));
    while (guards.length < budget.battles) guards.push(add('COMBAT'));
    while (payloads.filter(p => p.previewRoomType === 'FISHING').length < budget.fishing) add('FISHING');
    const fixedCount = groupCells.filter(c => c.significant && !movable.includes(c)).length;
    while (payloads.length + fixedCount < budget.events) add('SECRET');
    const areas = layout.rewardAreas.filter(inGroup).sort((a, b) => b.rewardCellIds.length - a.rewardCellIds.length);
    const protectedCount = Math.ceil(rewards.length * 0.7);
    const used = new Set();
    const placed = new Set();
    const put = (id, payload, guardCellId) => {
      Object.assign(byId.get(id), payload, guardCellId ? { guardedBy: guardCellId } : {});
      used.add(id); placed.add(payload);
    };
    const activeAreas = areas.slice(0, Math.min(guards.length, protectedCount, areas.length));
    activeAreas.forEach((area, i) => put(area.guardCellId, guards[i]));
    if (protectedCount && !activeAreas.length) throw new Error('No existing fight available to guard rewards');
    const candidatePools = activeAreas.map(area => [...area.rewardCellIds].sort((a, b) =>
      distance(byId.get(b), byId.get(area.guardCellId)) - distance(byId.get(a), byId.get(area.guardCellId))));
    for (let i = 0; i < protectedCount; i++) {
      let areaIndex = i % activeAreas.length;
      if (!candidatePools[areaIndex].length) areaIndex = candidatePools.findIndex(pool => pool.length);
      if (areaIndex < 0) throw new Error('Insufficient guarded reward space');
      const id = candidatePools[areaIndex].shift();
      if (!id) throw new Error('Insufficient guarded reward space');
      put(id, rewards[i], activeAreas[areaIndex].guardCellId);
    }
    // Fill both the open ground and unused chamber cells. Reward chambers must
    // not become nineteen-cell empty walks leading to a single chest.
    const candidates = movable;
    const anchors = groupCells.filter(c => c.landmark || c.id === layout.startCellId);
    const references = [...anchors, ...[...used].map(id => byId.get(id))];
    const nearest = new Map(candidates.map(c => [c.id, Math.min(...references.map(ref => distance(c, ref)))]));
    for (const payload of payloads.filter(p => !placed.has(p))) {
      const available = candidates.filter(c => !used.has(c.id));
      if (!available.length) throw new Error('Insufficient open event space');
      const chosen = available.reduce((best, c) => nearest.get(c.id) > nearest.get(best.id) ? c : best);
      put(chosen.id, payload);
      available.forEach(c => nearest.set(c.id, Math.min(nearest.get(c.id), distance(c, chosen))));
    }
  }
  return { ...layout, cells, contentRevision: 2, contentBudgets: GOBLIN_CONTENT_BUDGETS };
};
