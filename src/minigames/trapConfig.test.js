import { TRAP_SECTORS, getTrapSector, hitTrapSector } from './trapConfig';
test('eight sectors fill the circle with a constant ten-degree step', () => {
  expect(TRAP_SECTORS.reduce((sum, size) => sum + size, 0)).toBe(360);
  expect(TRAP_SECTORS.slice(1).map((size, i) => TRAP_SECTORS[i] - size)).toEqual([10, 10, 10, 10, 10, 10, 10]);
});
test.each([[0,0],[79.999,0],[80,1],[150,2],[210,3],[260,4],[300,5],[330,6],[350,7],[359.999,7],[360,0],[-1,7],[720,0]])('angle %s selects sector %s', (angle, sector) => {
  expect(getTrapSector(angle)).toBe(sector);
});
test('every sector once in arbitrary order wins; duplicate fails without clearing marks', () => {
  let marked = [];
  [355, 100, 230, 20, 310, 180, 340, 280].forEach((angle, i) => {
    const next = hitTrapSector(marked, angle);
    expect(next.result).toBe(i === 7 ? 'success' : null);
    marked = next.marked;
  });
  expect(hitTrapSector([0, 7], 359)).toEqual({ marked: [0, 7], sector: 7, result: 'failure' });
});
