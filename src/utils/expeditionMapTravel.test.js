import { getKnownMapTravelPaths, findKnownMapTravelPath } from './expeditionMapLayout';
import {
  createExpeditionMapRun, moveExpeditionRun, cancelPendingExpeditionCell,
} from './expeditionMapRun';

const cell = (id, q, extra = {}) => ({
  id, q, r: 0, revealed: true, resolved: true,
  visited: false, significant: false, locked: false, landmark: null, ...extra,
});

test('visible distant cells route across empty ground, but not across an unresolved guardian', () => {
  const board = {
    currentCellId: 'start',
    cells: [
      cell('start', 0, { visited: true }),
      cell('crossing', 1),
      cell('guardian', 2, { significant: true, resolved: false }),
      cell('treasure', 3, { significant: true, resolved: false }),
    ],
    edges: [
      { from: 'start', to: 'crossing' },
      { from: 'crossing', to: 'guardian' },
      { from: 'guardian', to: 'treasure' },
    ],
  };
  expect(findKnownMapTravelPath(board, 'guardian')).toEqual(['crossing', 'guardian']);
  expect(findKnownMapTravelPath(board, 'treasure')).toBeNull();
  const resolved = { ...board, cells: board.cells.map(x =>
    x.id === 'guardian' ? { ...x, resolved: true, visited: true } : x
  ) };
  expect(findKnownMapTravelPath(resolved, 'treasure')).toEqual(['crossing', 'guardian', 'treasure']);
});

test('fog, locked tiles and unvisited landmark gates cannot become transit cells', () => {
  const board = {
    currentCellId: 'start',
    cells: [
      cell('start', 0, { visited: true }),
      cell('fog', 1, { revealed: false }),
      cell('behind-fog', 5),
      cell('locked', 2, { locked: true }),
      cell('gate', 3, { landmark: { type: 'sublocation-entrance' } }),
      cell('far', 4),
    ],
    edges: [
      { from: 'start', to: 'fog' },
      { from: 'fog', to: 'behind-fog' },
      { from: 'start', to: 'locked' },
      { from: 'start', to: 'gate' },
      { from: 'gate', to: 'far' },
    ],
  };
  const paths = getKnownMapTravelPaths(board);
  expect(paths.get('fog')).toEqual(['fog']);
  expect(paths.has('behind-fog')).toBe(false);
  expect(paths.has('locked')).toBe(false);
  expect(paths.get('gate')).toEqual(['gate']);
  expect(paths.has('far')).toBe(false);
});

test('one-click route marks intermediate hexes visited and retreats from the last step before an event', () => {
  const run = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'wide-cavern-01', rng: () => .42 });
  const layout = run.mainLayout;
  const origin = layout.currentCellId;
  const neighbors = layout.edges.filter(edge => edge.from === origin || edge.to === origin)
    .map(edge => edge.from === origin ? edge.to : edge.from);
  const mid = neighbors.find(id =>
    layout.cells.find(c => c.id === id)?.region === 'approach'
    && layout.edges.some(edge => (edge.from === id || edge.to === id)
      && ![origin, id].includes(edge.from === id ? edge.to : edge.from))
  );
  expect(mid).toBeTruthy();
  const end = layout.edges.filter(edge => edge.from === mid || edge.to === mid)
    .map(edge => edge.from === mid ? edge.to : edge.from)
    .find(id => id !== origin && layout.cells.find(c => c.id === id)?.region === 'approach');
  expect(end).toBeTruthy();
  const staged = {
    ...run,
    mainLayout: {
      ...layout,
      cells: layout.cells.map(c => c.id === mid
        ? { ...c, revealed: true, visited: false, resolved: true, significant: false, previewRoomType: null }
        : c.id === end
          ? { ...c, revealed: true, visited: false, resolved: false, significant: true, previewRoomType: 'COMBAT' }
          : c),
    },
  };
  expect(findKnownMapTravelPath(staged.mainLayout, end)).toEqual([mid, end]);
  const result = moveExpeditionRun(staged, end, { rng: () => .42 });
  expect(result.moved).toBe(true);
  expect(result.run.mainLayout.currentCellId).toBe(end);
  expect(result.run.pendingCellId).toBe(end);
  expect(result.run.mainLayout.cells.find(c => c.id === mid).visited).toBe(true);
  expect(result.run.pendingOriginCellId).toBe(mid);
  const retreated = cancelPendingExpeditionCell(result.run);
  expect(retreated.mainLayout.currentCellId).toBe(mid);
});

test('clicking far treasure cannot bypass an unresolved earlier guard', () => {
  const run = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'wide-cavern-01', rng: () => .42 });
  const origin = run.mainLayout.currentCellId;
  const mid = run.mainLayout.edges.find(edge => edge.from === origin || edge.to === origin);
  expect(mid).toBeTruthy();
  const guardId = mid.from === origin ? mid.to : mid.from;
  const second = run.mainLayout.edges.find(edge => (edge.from === guardId || edge.to === guardId)
    && edge.from !== origin && edge.to !== origin);
  expect(second).toBeTruthy();
  const treasureId = second.from === guardId ? second.to : second.from;
  const staged = {
    ...run,
    mainLayout: {
      ...run.mainLayout,
      cells: run.mainLayout.cells.map(c => c.id === guardId
        ? { ...c, revealed: true, significant: true, resolved: false, previewRoomType: 'COMBAT' }
        : c.id === treasureId
          ? { ...c, revealed: true, significant: true, resolved: false, previewRoomType: 'TREASURE' }
          : c),
    },
  };
  expect(moveExpeditionRun(staged, treasureId).moved).toBe(false);
});
