import {
  canMoveToCell,
  generateMainExpeditionLayout,
  getAdjacentCellIds,
  getHexDistance,
  getHexNeighbors,
  moveToCell,
} from './expeditionMapLayout';
import { createExpeditionMapState } from './expeditionMap';

const createState = () => createExpeditionMapState({
  locationId: 'test',
  sublocations: ['a', 'b', 'c', 'd'],
  rng: () => 0.42,
});

const reachable = (layout, startId, allowed = () => true) => {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    getAdjacentCellIds(layout, queue.shift()).forEach(id => {
      const target = layout.cells.find(cell => cell.id === id);
      if (!seen.has(id) && allowed(target)) {
        seen.add(id);
        queue.push(id);
      }
    });
  }
  return seen;
};

const regionEdges = (layout, predicate) =>
  layout.edges.filter(edge => {
    const from = layout.cells.find(cell => cell.id === edge.from);
    const to = layout.cells.find(cell => cell.id === edge.to);
    return predicate(from, to);
  });

const physicalTouches = (left, right) => left.flatMap(a =>
  right.filter(b => getHexDistance(a, b) === 1).map(b => [a, b])
);

describe('expedition hand-crafted hex macro layout', () => {
  test('uses six axial neighbours', () => {
    expect(getHexNeighbors({ q: 0, r: 0 })).toEqual([
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ]);
    expect(getHexDistance({ q: 0, r: 0 }, { q: 1, r: -1 })).toBe(1);
  });

  test('legacy macro template contains 131 passable hexes', () => {
    const layout = generateMainExpeditionLayout(createState(), { rng: () => 0.42 });
    expect(layout.topology).toBe('hex-board-v2');
    expect(layout.templateId).toBe('wide-cavern-01');
    expect(layout.cells).toHaveLength(131);
  });

  test('physical region sizes and meaningful content counts match the design', () => {
    const state = createState();
    const layout = generateMainExpeditionLayout(state, { rng: () => 0.42 });
    const approach = layout.cells.filter(cell => cell.region === 'approach');
    const sublocations = state.availableSublocationIds.map(id =>
      layout.cells.filter(cell => cell.region === 'sublocation' && cell.sublocationId === id)
    );
    const depth = layout.cells.filter(cell => cell.region === 'depth');
    const boss = layout.cells.filter(cell => cell.region === 'boss');

    expect(approach).toHaveLength(29);
    expect(approach.filter(cell => cell.significant)).toHaveLength(15);

    sublocations.forEach(cells => {
      expect(cells).toHaveLength(23);
      expect(cells.filter(cell => cell.significant)).toHaveLength(14);
    });

    expect(depth).toHaveLength(32);
    expect(depth.filter(cell => cell.significant)).toHaveLength(14);
    expect(boss).toHaveLength(1);
    expect(boss.filter(cell => cell.significant)).toHaveLength(1);
  });

  test('every possible active route contains exactly the floor altar budget', () => {
    const state = createState();
    const layout = generateMainExpeditionLayout(state, { rng: () => 0.42 });
    const approach = layout.cells.filter(cell =>
      cell.region === 'approach' && cell.forcedRoomType === 'CURSE_ALTAR'
    ).length;
    const depth = layout.cells.filter(cell =>
      cell.region === 'depth' && cell.forcedRoomType === 'CURSE_ALTAR'
    ).length;
    expect(approach).toBe(state.altarBudget.approach);
    expect(depth).toBe(state.altarBudget.depth);
    state.availableSublocationIds.forEach(id => {
      const sublocation = layout.cells.filter(cell =>
        cell.sublocationId === id && cell.forcedRoomType === 'CURSE_ALTAR'
      ).length;
      expect(sublocation).toBe(state.altarBudget.sublocation);
      expect(approach + sublocation + depth).toBe(state.altarBudget.total);
    });
  });

  test('approach is a broad cluster with loops and many multi-neighbour cells', () => {
    const layout = generateMainExpeditionLayout(createState());
    const approach = layout.cells.filter(cell => cell.region === 'approach');
    const approachIds = new Set(approach.map(cell => cell.id));
    const seen = reachable(layout, layout.startCellId, cell => approachIds.has(cell?.id));
    expect(seen.size).toBe(approach.length);

    const localDegrees = approach.map(cell =>
      getAdjacentCellIds(layout, cell.id).filter(id => approachIds.has(id)).length
    );
    expect(localDegrees.filter(degree => degree >= 3).length).toBeGreaterThanOrEqual(15);

    const edges = regionEdges(layout, (from, to) =>
      from?.region === 'approach' && to?.region === 'approach'
    );
    expect(edges.length).toBeGreaterThan(approach.length - 1);
  });

  test('Approach and each sublocation are separated except for one physical entrance hex', () => {
    const state = createState();
    const layout = generateMainExpeditionLayout(state);
    const approach = layout.cells.filter(cell => cell.region === 'approach');

    state.availableSublocationIds.forEach(id => {
      const sublocation = layout.cells.filter(cell =>
        cell.region === 'sublocation' && cell.sublocationId === id
      );
      const crossings = regionEdges(layout, (from, to) =>
        (from?.region === 'approach' && to?.sublocationId === id)
        || (to?.region === 'approach' && from?.sublocationId === id)
      );
      expect(crossings).toHaveLength(1);
      expect(physicalTouches(approach, sublocation)).toHaveLength(1);
      expect(layout.sublocationEntranceCellIds[id]).toBeTruthy();
    });
  });

  test('sublocation regions never touch each other directly', () => {
    const state = createState();
    const layout = generateMainExpeditionLayout(state);
    const sublocations = state.availableSublocationIds.map(id =>
      layout.cells.filter(cell => cell.region === 'sublocation' && cell.sublocationId === id)
    );

    for (let left = 0; left < sublocations.length; left += 1) {
      for (let right = left + 1; right < sublocations.length; right += 1) {
        sublocations[left].forEach(a => {
          sublocations[right].forEach(b => {
            expect(getHexDistance(a, b)).toBeGreaterThan(1);
          });
        });
      }
    }
  });

  test('each sublocation and Depth are separated except for one physical exit hex', () => {
    const state = createState();
    const layout = generateMainExpeditionLayout(state);
    const depth = layout.cells.filter(cell => cell.region === 'depth');

    state.availableSublocationIds.forEach(id => {
      const sublocation = layout.cells.filter(cell =>
        cell.region === 'sublocation' && cell.sublocationId === id
      );
      const touches = physicalTouches(sublocation, depth);
      expect(touches).toHaveLength(1);

      const exitId = layout.sublocationExitCellIds[id];
      const depthEntryId = layout.depthEntryCellIds[id];
      const pairIds = new Set(touches[0].map(cell => cell.id));
      expect(pairIds).toEqual(new Set([exitId, depthEntryId]));
    });
  });

  test('each sublocation is a broad connected cluster, not a one-cell corridor', () => {
    const state = createState();
    const layout = generateMainExpeditionLayout(state);
    state.availableSublocationIds.forEach(id => {
      const cells = layout.cells.filter(cell =>
        cell.region === 'sublocation' && cell.sublocationId === id
      );
      const ids = new Set(cells.map(cell => cell.id));
      const start = layout.sublocationEntranceCellIds[id];
      const seen = reachable(layout, start, cell => ids.has(cell?.id));
      expect(seen.size).toBe(cells.length);

      const degrees = cells.map(cell =>
        getAdjacentCellIds(layout, cell.id).filter(cellId => ids.has(cellId)).length
      );
      expect(degrees.filter(degree => degree >= 3).length).toBeGreaterThanOrEqual(12);
      expect(degrees.filter(degree => degree === 1).length).toBeLessThanOrEqual(2);
    });
  });

  test('the full board progresses visually upward from start to boss', () => {
    const layout = generateMainExpeditionLayout(createState());
    const start = layout.cells.find(cell => cell.id === layout.startCellId);
    const boss = layout.cells.find(cell => cell.id === layout.bossCellId);
    expect(start.r).toBeGreaterThan(boss.r);
  });

  test('Depth has enough room for fourteen encounters plus structural choices', () => {
    const state = createState();
    const layout = generateMainExpeditionLayout(state);
    const depth = layout.cells.filter(cell => cell.region === 'depth');
    expect(depth).toHaveLength(32);
    expect(depth.filter(cell => cell.significant)).toHaveLength(14);
    expect(depth.filter(cell => !cell.significant)).toHaveLength(18);
    expect(Object.values(layout.depthEntryCellIds)).toHaveLength(3);
    Object.values(layout.depthEntryCellIds).forEach(id => {
      expect(layout.cells.find(cell => cell.id === id)?.landmark?.type).toBe('depth-entrance');
    });
  });

  test('Depth and the single boss cell exist physically but start locked', () => {
    const layout = generateMainExpeditionLayout(createState());
    const depth = layout.cells.filter(cell => cell.region === 'depth');
    const boss = layout.cells.filter(cell => cell.region === 'boss');
    expect(depth.every(cell => cell.locked)).toBe(true);
    expect(boss).toHaveLength(1);
    expect(boss.every(cell => cell.locked)).toBe(true);
  });

  test('movement is only along authored hex edges and permits backtracking', () => {
    let layout = generateMainExpeditionLayout(createState());
    const start = layout.currentCellId;
    const next = getAdjacentCellIds(layout, start)[0];
    expect(canMoveToCell(layout, next)).toBe(true);
    layout = moveToCell(layout, next).layout;
    expect(layout.currentCellId).toBe(next);
    expect(canMoveToCell(layout, start)).toBe(true);
    layout = moveToCell(layout, start).layout;
    expect(layout.currentCellId).toBe(start);
  });
});
