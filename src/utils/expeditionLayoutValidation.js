import { auditMapGeometry } from './expeditionGeometryAudit';
import { buildHexEdges, getHexDistance, hexKey } from './expeditionMapLayout';

// Structural audit, independent of movement locks and encounter RNG.
export const auditExpeditionLayout = layout => {
  if (layout.geometryRevision) return auditMapGeometry(layout);
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  const cells = layout.cells;
  const byId = new Map(cells.map(cell => [cell.id, cell]));
  const pair = (a, b) => [a, b].sort().join('|');
  const adjacency = new Map(cells.map(cell => [cell.id, new Set()]));
  const authored = new Set();
  for (const { from, to } of layout.edges) {
    check(byId.has(from) && byId.has(to), 'Edge references missing cell');
    if (!byId.has(from) || !byId.has(to)) continue;
    check(getHexDistance(byId.get(from), byId.get(to)) === 1, 'Non-neighbour edge');
    check(!authored.has(pair(from, to)), 'Duplicate edge');
    authored.add(pair(from, to));
    adjacency.get(from).add(to); adjacency.get(to).add(from);
  }
  check(byId.size === cells.length, 'Duplicate cell ID');
  check(new Set(cells.map(hexKey)).size === cells.length, 'Overlapping hexes');
  check(cells.length >= 120 && cells.length <= 165, 'Expected 120–165 hexes');
  const physical = new Set(buildHexEdges(cells).map(({ from, to }) => pair(from, to)));
  check(physical.size === authored.size && [...physical].every(edge => authored.has(edge)), 'Physical contact without a movement edge');
  const flood = (start, allowed) => {
    const seen = new Set([start]); const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const id of adjacency.get(queue[i]) || []) {
        if (allowed.has(id) && !seen.has(id)) { seen.add(id); queue.push(id); }
      }
    }
    return seen;
  };
  check(flood(layout.startCellId, new Set(byId.keys())).size === cells.length, 'Disconnected board');
  const ids = Object.keys(layout.sublocationEntranceCellIds);
  check(ids.length === 3, 'Expected three sublocation slots');
  const groups = [cells.filter(c => c.region === 'approach'), ...ids.map(id => cells.filter(c => c.sublocationId === id && c.region === 'sublocation')), cells.filter(c => c.region === 'depth'), cells.filter(c => c.region === 'boss')];
  const expectedCounts = [15, 14, 14, 14, 14, 1];
  const protectedIds = new Set([layout.startCellId, layout.depthCompletionCellId, ...Object.values(layout.sublocationEntranceCellIds), ...Object.values(layout.sublocationExitCellIds), ...Object.values(layout.depthEntryCellIds)]);
  for (const entrance of Object.values(layout.sublocationEntranceCellIds)) {
    for (const id of adjacency.get(entrance) || []) {
      if (byId.get(id)?.region === 'approach') protectedIds.add(id);
    }
  }
  const regions = groups.map((group, index) => {
    const local = new Set(group.map(c => c.id));
    const degrees = group.map(c => [...adjacency.get(c.id)].filter(id => local.has(id)).length);
    const loops = degrees.reduce((a, b) => a + b, 0) / 2 - group.length + 1;
    check(group.filter(c => c.significant).length === expectedCounts[index], `Wrong meaningful count in region ${index}`);
    check(group.length > 0 && flood(group[0]?.id, local).size === group.length, `Disconnected region ${index}`);
    if (index < 5) {
      check(loops > 0, `No alternate paths in region ${index}`);
      check(degrees.filter(d => d >= 3).length >= group.length * 0.84, `Too many narrow cells in region ${index}`);
      check(group.every((c, i) => protectedIds.has(c.id) || degrees[i] >= 2), `Unrewarded dead end in region ${index}`);
      // A high degree alone can hide chains of tiny rooms. The interior must
      // remain connected when any one hex is blocked. Only terminal gate
      // leaves are removed from this check; gate-adjacent necks still count.
      const core = new Set(group.filter((c, i) => !(protectedIds.has(c.id) && degrees[i] === 1)).map(c => c.id));
      for (const blocked of core) {
        const remaining = new Set([...core].filter(id => id !== blocked));
        check(flood(remaining.values().next().value, remaining).size === remaining.size, `Interior chokepoint in region ${index}: ${blocked}`);
      }
      const thin = new Set(group.filter((c, i) => degrees[i] <= 2 && !protectedIds.has(c.id)).map(c => c.id));
      while (thin.size) {
        const component = flood(thin.values().next().value, thin);
        check(component.size <= 2, `Long single-cell corridor in region ${index}`);
        component.forEach(id => thin.delete(id));
      }
    }
    return { hexes: group.length, meaningful: group.filter(c => c.significant).length, loops };
  });
  const regionOf = new Map(groups.flatMap((group, i) => group.map(c => [c.id, i])));
  const crossings = layout.edges.filter(e => regionOf.get(e.from) !== regionOf.get(e.to));
  const expectedGates = new Set();
  for (const [i, id] of ids.entries()) {
    const entrance = layout.sublocationEntranceCellIds[id];
    const exit = layout.sublocationExitCellIds[id];
    const depth = layout.depthEntryCellIds[id];
    const parents = [...(adjacency.get(entrance) || [])].filter(n => regionOf.get(n) === 0);
    check(parents.length === 1, `Expected one approach entrance for slot ${i}`);
    if (parents[0]) expectedGates.add(pair(parents[0], entrance));
    expectedGates.add(pair(exit, depth));
    check(byId.get(entrance)?.sublocationId === id && byId.get(exit)?.sublocationId === id, 'Wrong sublocation landmark');
    check(byId.get(depth)?.region === 'depth', 'Missing depth entry');
    for (const other of ids.slice(i + 1)) {
      check(getHexDistance(byId.get(entrance), byId.get(layout.sublocationEntranceCellIds[other])) >= 4, 'Entrances too close together');
    }
  }
  expectedGates.add(pair(layout.depthCompletionCellId, layout.bossCellId));
  check(crossings.length === 7 && crossings.every(e => expectedGates.has(pair(e.from, e.to))), 'Unexpected zone crossing / gate bypass');
  check(groups[5].length === 1 && adjacency.get(layout.bossCellId)?.size === 1, 'Boss must have one depth entrance');
  check(byId.get(layout.startCellId)?.region === 'approach' && !byId.get(layout.startCellId)?.significant, 'Invalid starting cell');
  return { templateId: layout.templateId, ok: errors.length === 0, errors, hexes: cells.length, regions };
};

