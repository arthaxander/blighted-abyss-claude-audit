import { createExpeditionMapRun } from './expeditionMapRun';
import { getAdjacentCellIds } from './expeditionMapLayout';
import {
  projectExpeditionCell, getExpeditionBoardGeometry, getExpeditionCellPosition, getWalkableFloorPath,
} from './expeditionMapProjection';

// Test the actual SVG polygon coordinates, including every traversable edge.
const polygonsFromPath = path => path.split('M').filter(Boolean).map(segment =>
  segment.replace('Z', '').split('L').map(pair => pair.split(',').map(Number)));
const inside = ([x, y], polygon) => polygon.every((a, i) => {
  const b = polygon[(i + 1) % polygon.length];
  return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -0.001;
});

test('the painted floor covers every original target and every connection', () => {
  const { mainLayout } = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'wide-cavern-01', rng: () => .42 });
  const cells = mainLayout.cells.map(cell => ({ ...cell, ...projectExpeditionCell(cell, mainLayout.topology) }));
  const geometry = getExpeditionBoardGeometry(cells);
  const polygons = polygonsFromPath(getWalkableFloorPath(cells, geometry));
  const points = Object.fromEntries(cells.map(cell => [cell.id, getExpeditionCellPosition(cell, geometry)]));
  const covered = point => polygons.some(polygon => inside(point, polygon));
  expect(cells).toHaveLength(131);
  cells.forEach((cell, index) => {
    expect(cell.sx).toBe((cell.q + cell.r * .5) * 74);
    expect(cell.sy).toBe(cell.r * 41);
    const { x, y } = points[cell.id];
    expect(inside([x, y], polygons[index])).toBe(true);
    // All six corners of the visible hex fit inside its ground shoulder.
    [[0,-26],[40,-13],[40,13],[0,26],[-40,13],[-40,-13]].forEach(([dx,dy]) => {
      expect(inside([x + dx, y + dy], polygons[index])).toBe(true);
    });
    getAdjacentCellIds(mainLayout, cell.id).forEach(id => {
      const next = points[id];
      for (let step = 0; step <= 20; step++) {
        const t = step / 20;
        expect(covered([x + (next.x - x) * t, y + (next.y - y) * t])).toBe(true);
      }
    });
  });
});



test('future floor projection excludes collision terrain on the new cavern', () => {
  const { mainLayout } = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'goblin-caverns-02', rng: () => .42 });
  const cells = mainLayout.cells.map(cell => ({ ...cell, ...projectExpeditionCell(cell, mainLayout.topology) }));
  const geometry = getExpeditionBoardGeometry(cells);
  const polygons = polygonsFromPath(getWalkableFloorPath(cells, geometry));
  expect(polygons).toHaveLength(cells.filter(c => c.walkable !== false).length);
  for (const cell of cells.filter(c => c.walkable === false)) {
    const { x, y } = getExpeditionCellPosition(cell, geometry);
    expect(polygons.some(polygon => inside([x, y], polygon))).toBe(false);
  }
});
