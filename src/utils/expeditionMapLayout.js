import { GOBLIN_CAVERNS_SPEC, reshapeGoblinCaverns } from './goblinCaverns';
import { EXPEDITION_MAP_PHASES } from './expeditionMap';
import locationLayouts from '../data/expeditionLocationLayouts.json';

export const HEX_DIRECTIONS = Object.freeze([
  Object.freeze({ q: 1, r: 0 }),
  Object.freeze({ q: 1, r: -1 }),
  Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: -1, r: 0 }),
  Object.freeze({ q: -1, r: 1 }),
  Object.freeze({ q: 0, r: 1 }),
]);

export const hexKey = ({ q, r }) => q + ',' + r;

export const getHexNeighbors = ({ q, r }) =>
  HEX_DIRECTIONS.map(({ q: dq, r: dr }) => ({ q: q + dq, r: r + dr }));

export const getHexDistance = (a, b) => {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};

const axialRows = rows => Object.entries(rows).flatMap(([rValue, qs]) =>
  Array.from(qs).map(q => ({ q, r: Number(rValue) }))
);

const coord = (q, r) => ({ q, r });

const APPROACH_COORDINATES = axialRows({
  12: [-1, 0, 1],
  11: [-2, -1, 0, 1, 2],
  10: [-3, -2, -1, 0, 1, 2],
  9: [-3, -2, -1, 0, 1, 2, 3, 4],
  8: [-2, -1, 0, 1, 2, 3],
  7: [0],
});

const SUBLOCATION_SLOT_COORDINATES = Object.freeze([
  axialRows({
    7: [-2],
    6: [-4, -3, -2],
    5: [-6, -5, -4, -3],
    4: [-7, -6, -5, -4],
    3: [-7, -6, -5, -4, -3],
    2: [-6, -5, -4, -3],
    1: [-5, -4],
  }),
  axialRows({
    6: [0],
    5: [0, 1, 2],
    4: [-1, 0, 1, 2],
    3: [-1, 0, 1, 2, 3],
    2: [-1, 0, 1, 2, 3],
    1: [-1, 0, 1, 2],
    0: [0],
  }),
  axialRows({
    8: [5],
    7: [5, 6, 7],
    6: [5, 6, 7, 8],
    5: [5, 6, 7, 8, 9],
    4: [5, 6, 7, 8, 9],
    3: [5, 6, 7, 8],
    2: [6],
  }),
]);

const DEPTH_COORDINATES = axialRows({
  1: [5, 6],
  0: [-3, -2, 4, 5, 6],
  '-1': [-3, -2, -1, 0, 2, 3, 4, 5, 6],
  '-2': [-3, -2, -1, 0, 1, 2, 3, 4, 5],
  '-3': [-2, -1, 0, 1, 2, 3],
  '-4': [1],
});

const BOSS_COORDINATES = [coord(1, -5)];

const TEMPLATE = Object.freeze({
  id: 'wide-cavern-01',
  approach: {
    coordinates: APPROACH_COORDINATES,
    start: coord(0, 12),
  },
  sublocations: [
    {
      coordinates: SUBLOCATION_SLOT_COORDINATES[0],
      entrance: coord(-2, 7),
      approachParent: coord(-2, 8),
      exit: coord(-4, 1),
      depthEntry: coord(-3, 0),
    },
    {
      coordinates: SUBLOCATION_SLOT_COORDINATES[1],
      entrance: coord(0, 6),
      approachParent: coord(0, 7),
      exit: coord(0, 0),
      depthEntry: coord(0, -1),
    },
    {
      coordinates: SUBLOCATION_SLOT_COORDINATES[2],
      entrance: coord(5, 8),
      approachParent: coord(4, 9),
      exit: coord(6, 2),
      depthEntry: coord(6, 1),
    },
  ],
  depth: {
    coordinates: DEPTH_COORDINATES,
    completion: coord(1, -4),
  },
  boss: {
    coordinates: BOSS_COORDINATES,
    boss: coord(1, -5),
  },
});

const expandRegion = ({ rows, ...region }) => ({ ...region, coordinates: axialRows(rows) });
export const LOCATION_HEX_TEMPLATES = Object.freeze(locationLayouts.map(template => ({
  ...template,
  approach: expandRegion(template.approach),
  sublocations: template.sublocations.map(expandRegion),
  depth: expandRegion(template.depth),
  boss: expandRegion(template.boss),
})));

// Four selectable Goblin layouts without the discontinued painted art.
// Retain the original wide-cavern layout for compatibility with saved runs,
// and reuse three already validated geometries from the existing atlas.
export const LEGACY_GOBLIN_HEX_TEMPLATES = Object.freeze([
  TEMPLATE,
  ...LOCATION_HEX_TEMPLATES.filter(template => template.locationKey === 'fungal').slice(0, 3)
    .map((template, index) => ({
      ...template,
      id: `goblin-${String(index + 2).padStart(2, '0')}`,
      locationId: 'Гоблинские Норы',
      locationKey: 'goblin',
      label: `Гоблинские Норы — ${String(index + 2).padStart(2, '0')}`,
    })),
]);

export const GOBLIN_HEX_TEMPLATES = Object.freeze(LEGACY_GOBLIN_HEX_TEMPLATES.map(template =>
  template.id === 'goblin-02' ? { ...template, ...GOBLIN_CAVERNS_SPEC } : template
));

export const HEX_MACRO_TEMPLATES = Object.freeze([...GOBLIN_HEX_TEMPLATES, ...LOCATION_HEX_TEMPLATES]);

export const getHexMacroTemplatesForLocation = locationId => {
  if (locationId === 'Гоблинские Норы' || locationId === 'goblin') return GOBLIN_HEX_TEMPLATES;
  const matching = LOCATION_HEX_TEMPLATES.filter(template =>
    template.locationId === locationId || template.locationKey === locationId);
  return matching.length ? matching : [TEMPLATE];
};

const cell = ({
  id,
  coordinate,
  region,
  phase,
  significant = false,
  locked = false,
  landmark = null,
  sublocationId = null,
}) => ({
  id,
  q: coordinate.q,
  r: coordinate.r,
  region,
  phase,
  sublocationId,
  significant,
  content: null,
  resolved: !significant,
  visited: false,
  revealed: false,
  landmark,
  locked,
});

const idAt = (cells, coordinate) =>
  cells.find(entry => entry.q === coordinate.q && entry.r === coordinate.r)?.id;

const buildCells = ({
  coordinates,
  prefix,
  region,
  phase,
  sublocationId = null,
  locked = false,
}) => coordinates.map((coordinate, index) => cell({
  id: prefix + '-' + (index + 1),
  coordinate,
  region,
  phase,
  sublocationId,
  locked,
}));

const pickContentIds = ({
  cells,
  count,
  rng = Math.random,
  forcedIds = [],
  excludedIds = [],
}) => {
  const forced = [...new Set(forcedIds.filter(Boolean))];
  const excluded = new Set(excludedIds.filter(Boolean));
  const pool = cells.map(entry => entry.id)
    .filter(id => !excluded.has(id) && !forced.includes(id));
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  const target = Math.max(0, Number(count) || 0);
  return new Set([...forced, ...pool.slice(0, Math.max(0, target - forced.length))]);
};

const applyContentSlots = (cells, contentIds) => cells.map(entry => {
  const significant = contentIds.has(entry.id);
  return { ...entry, significant, resolved: !significant };
});

const assignForcedRoomType = (
  cells,
  count,
  rng = Math.random,
  roomType = 'CURSE_ALTAR',
  excludedIds = []
) => {
  const excluded = new Set(excludedIds.filter(Boolean));
  const candidates = cells
    .filter(entry => entry.significant && !excluded.has(entry.id))
    .map(entry => entry.id);
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }
  const selected = new Set(candidates.slice(0, Math.max(0, Number(count) || 0)));
  return cells.map(entry => selected.has(entry.id)
    ? { ...entry, forcedRoomType: roomType }
    : entry);
};

export const buildHexEdges = cells => {
  const walkable = cells.filter(entry => entry.walkable !== false);
  const ids = new Map(walkable.map(entry => [hexKey(entry), entry.id]));
  const seen = new Set();
  return walkable.flatMap(entry => getHexNeighbors(entry).flatMap(neighbor => {
    const neighborId = ids.get(hexKey(neighbor));
    if (!neighborId) return [];
    const pair = [entry.id, neighborId].sort();
    const key = pair.join('|');
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ from: pair[0], to: pair[1] }];
  }));
};

const adjacencyMap = edges => {
  const map = new Map();
  (edges || []).forEach(({ from, to }) => {
    if (!map.has(from)) map.set(from, new Set());
    if (!map.has(to)) map.set(to, new Set());
    map.get(from).add(to);
    map.get(to).add(from);
  });
  return map;
};

export const getAdjacentCellIds = (layout, cellId) =>
  [...(adjacencyMap(layout?.edges || []).get(cellId) || [])];

const resolveTemplate = (templateId, locationId, rng) => {
  const templates = getHexMacroTemplatesForLocation(locationId);
  if (templateId) {
    const requested = templates.find(template => template.id === templateId)
      || ((locationId === 'Гоблинские Норы' || locationId === 'goblin')
        && LEGACY_GOBLIN_HEX_TEMPLATES.find(template => template.id === templateId));
    if (!requested) throw new Error(`Unknown map template ${templateId} for ${locationId}`);
    return requested;
  }
  if (templates.length === 1) return templates[0];
  const roll = Math.max(0, Math.min(0.999999999, Number(rng()) || 0));
  return templates[Math.floor(roll * templates.length)];
};

export const generateMainExpeditionLayout = (
  mapState,
  { rng = Math.random, templateId } = {}
) => {
  if (!mapState?.phaseTargets) throw new Error('Map state with phaseTargets is required');
  const template = resolveTemplate(templateId, mapState.locationId, rng);
  if (template.contentSourceId) {
    return reshapeGoblinCaverns(generateMainExpeditionLayout(mapState, { rng, templateId: template.contentSourceId }));
  }

  let approachCells = buildCells({
    coordinates: template.approach.coordinates,
    prefix: 'approach',
    region: 'approach',
    phase: EXPEDITION_MAP_PHASES.APPROACH,
  });
  const startCellId = idAt(approachCells, template.approach.start);
  const approachContentIds = pickContentIds({
    cells: approachCells,
    count: mapState.phaseTargets.approach,
    rng,
    excludedIds: [startCellId],
  });
  approachCells = applyContentSlots(approachCells, approachContentIds);
  approachCells = assignForcedRoomType(
    approachCells,
    mapState.altarBudget?.approach,
    rng,
    'CURSE_ALTAR',
    [startCellId]
  );

  const sublocationEntranceCellIds = {};
  const sublocationExitCellIds = {};
  const depthEntryCellIds = {};
  const sublocationCells = [];
  const sublocationEdges = [];
  const approachGateEdges = [];
  const depthGateEdges = [];

  mapState.availableSublocationIds.forEach((sublocationId, slotIndex) => {
    const spec = template.sublocations[slotIndex];
    let regionCells = buildCells({
      coordinates: spec.coordinates,
      prefix: 'sublocation-' + (slotIndex + 1),
      region: 'sublocation',
      phase: EXPEDITION_MAP_PHASES.SUBLOCATION,
      sublocationId,
    });
    const entranceId = idAt(regionCells, spec.entrance);
    const exitId = idAt(regionCells, spec.exit);
    const contentIds = pickContentIds({
      cells: regionCells,
      count: mapState.phaseTargets.sublocation,
      rng,
      excludedIds: [entranceId, exitId],
    });
    regionCells = applyContentSlots(regionCells, contentIds).map(entry => {
      if (entry.id === entranceId) {
        return {
          ...entry,
          landmark: { type: 'sublocation-entrance', sublocationId, slotIndex },
        };
      }
      if (entry.id === exitId) {
        return {
          ...entry,
          landmark: { type: 'sublocation-exit', sublocationId, slotIndex },
        };
      }
      return entry;
    });
    regionCells = assignForcedRoomType(
      regionCells,
      mapState.altarBudget?.sublocation,
      rng,
      'CURSE_ALTAR',
      [entranceId, exitId]
    );

    sublocationEntranceCellIds[sublocationId] = entranceId;
    sublocationExitCellIds[sublocationId] = exitId;
    sublocationCells.push(...regionCells);
    sublocationEdges.push(...buildHexEdges(regionCells));
    approachGateEdges.push({
      from: idAt(approachCells, spec.approachParent),
      to: entranceId,
    });
    depthEntryCellIds[sublocationId] = null;
  });

  let depthCells = buildCells({
    coordinates: template.depth.coordinates,
    prefix: 'depth',
    region: 'depth',
    phase: EXPEDITION_MAP_PHASES.DEPTH,
    locked: true,
  });
  const depthCompletionCellId = idAt(depthCells, template.depth.completion);
  const depthEntryIds = template.sublocations.map(spec => idAt(depthCells, spec.depthEntry));
  const depthContentIds = pickContentIds({
    cells: depthCells,
    count: mapState.phaseTargets.depth,
    rng,
    forcedIds: [depthCompletionCellId],
    excludedIds: depthEntryIds,
  });
  depthCells = applyContentSlots(depthCells, depthContentIds).map(entry =>
    entry.id === depthCompletionCellId
      ? { ...entry, landmark: { type: 'depth-completion' } }
      : entry
  );
  depthCells = assignForcedRoomType(
    depthCells,
    mapState.altarBudget?.depth,
    rng,
    'CURSE_ALTAR',
    [depthCompletionCellId, ...depthEntryIds]
  );

  mapState.availableSublocationIds.forEach((sublocationId, slotIndex) => {
    const depthEntryId = depthEntryIds[slotIndex];
    depthEntryCellIds[sublocationId] = depthEntryId;
    depthCells = depthCells.map(entry => entry.id === depthEntryId
      ? {
          ...entry,
          landmark: { type: 'depth-entrance', sublocationId, slotIndex },
        }
      : entry
    );
    depthGateEdges.push({
      from: sublocationExitCellIds[sublocationId],
      to: depthEntryId,
    });
  });

  let bossCells = buildCells({
    coordinates: template.boss.coordinates,
    prefix: 'boss-arena',
    region: 'boss',
    phase: EXPEDITION_MAP_PHASES.BOSS,
    locked: true,
  });
  const bossCellId = idAt(bossCells, template.boss.boss);
  const bossArenaEntryCellId = bossCellId;
  bossCells = bossCells.map(entry => {
    if (entry.id === bossCellId) {
      return {
        ...entry,
        significant: true,
        resolved: false,
        landmark: { type: 'boss' },
      };
    }
    return entry;
  });

  const cells = [...approachCells, ...sublocationCells, ...depthCells, ...bossCells];
  const edges = [
    ...buildHexEdges(approachCells),
    ...sublocationEdges,
    ...buildHexEdges(depthCells),
    ...approachGateEdges,
    ...depthGateEdges,
    { from: depthCompletionCellId, to: bossCellId },
  ];

  return {
    version: mapState.version,
    templateId: template.id,
    ...(template.locationKey ? { minimumKeyBattles: 2 } : {}),
    locationId: mapState.locationId,
    topology: 'hex-board-v2',
    cells: template.locationKey ? cells.map(entry => ({
      ...entry,
      pathDegree: edges.filter(edge => edge.from === entry.id || edge.to === entry.id).length,
    })) : cells,
    edges,
    currentCellId: startCellId,
    startCellId,
    sublocationEntranceCellIds,
    sublocationExitCellIds,
    depthEntryCellIds,
    depthCompletionCellId,
    depthEndCellId: depthCompletionCellId,
    bossArenaEntryCellId,
    bossCellId,
  };
};

export const applyMapProgressLocks = (layout, mapState) => ({
  ...layout,
  cells: layout.cells.map(entry => {
    if (entry.walkable === false) return { ...entry, locked: true };
    if (entry.region === 'sublocation') {
      const selected = mapState?.selectedSublocationId;
      return {
        ...entry,
        locked: Boolean(selected && entry.sublocationId !== selected),
      };
    }
    if (entry.phase === EXPEDITION_MAP_PHASES.DEPTH) {
      const selectedEntryId = layout.depthEntryCellIds?.[mapState?.selectedSublocationId];
      const depthKeyReady = Boolean(
        mapState?.keys?.depth?.owned && !mapState?.keys?.depth?.consumed
      );
      const gateReady = entry.id === selectedEntryId && depthKeyReady;
      return {
        ...entry,
        locked: !mapState?.progress?.depthUnlocked && !gateReady,
      };
    }
    if (entry.phase === EXPEDITION_MAP_PHASES.BOSS) {
      const bossKeyReady = Boolean(
        mapState?.keys?.boss?.owned && !mapState?.keys?.boss?.consumed
      );
      return {
        ...entry,
        locked: !mapState?.progress?.bossUnlocked && !bossKeyReady,
      };
    }
    return entry;
  }),
});

// A destination may be any discovered, unlocked cell. Only ordinary empty
// cells and already resolved encounters may be transit nodes. In particular,
// an unvisited gate or unresolved enemy/treasure must stop automatic travel.
export const getKnownMapTravelPaths = layout => {
  const paths = new Map();
  if (!layout?.currentCellId || !Array.isArray(layout.cells)) return paths;
  const byId = new Map(layout.cells.map(cell => [cell.id, cell]));
  const start = layout.currentCellId;
  if (byId.get(start)?.walkable === false) return paths;
  const adjacency = adjacencyMap(layout.edges);
  paths.set(start, []);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    const prefix = paths.get(at);
    for (const id of adjacency.get(at) || []) {
      if (paths.has(id)) continue;
      const cell = byId.get(id);
      if (!cell || cell.locked || cell.walkable === false) continue;
      const next = [...prefix, id];
      paths.set(id, next);
      // A single step into the fog is still legal for exploration.
      // It cannot be used as a shortcut to another hidden destination.
      const needsInteraction = !cell.revealed
        || (cell.significant && !cell.resolved)
        || (cell.landmark && !cell.visited);
      if (!needsInteraction) queue.push(id);
    }
  }
  return paths;
};

export const findKnownMapTravelPath = (layout, cellId) =>
  getKnownMapTravelPaths(layout).get(cellId) || null;

export const canMoveToCell = (layout, cellId) => Boolean(
  layout?.currentCellId
  && cellId
  && layout.cells.find(entry => entry.id === cellId)?.walkable !== false
  && !layout.cells.find(entry => entry.id === layout.currentCellId)?.locked
  && layout.cells.find(entry => entry.id === layout.currentCellId)?.walkable !== false
  && !layout.cells.find(entry => entry.id === cellId)?.locked
  && getAdjacentCellIds(layout, layout.currentCellId).includes(cellId)
);

export const moveToCell = (layout, cellId) =>
  !canMoveToCell(layout, cellId)
    ? { layout, moved: false, reason: 'cell-not-adjacent-or-locked' }
    : {
        moved: true,
        reason: null,
        layout: {
          ...layout,
          currentCellId: cellId,
          cells: layout.cells.map(entry =>
            entry.id === cellId ? { ...entry, visited: true, revealed: true } : entry
          ),
        },
      };

// Compatibility exports for older imports. New v2 runs use one physical layout.
export const generateSublocationLayout = () => null;
export const attachSublocationPortals = mainLayout => mainLayout;

