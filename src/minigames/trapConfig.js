export const TRAP_SECTORS = Object.freeze([80, 70, 60, 50, 40, 30, 20, 10]);
export const TRAP_REVOLUTION_MS = 3000;
export const getTrapSector = angle => {
  const normalized = ((angle % 360) + 360) % 360;
  let edge = 0;
  return TRAP_SECTORS.findIndex(size => { edge += size; return normalized < edge; });
};
export const hitTrapSector = (marked, angle) => {
  const sector = getTrapSector(angle);
  if (marked.includes(sector)) return { marked, sector, result: 'failure' };
  const next = [...marked, sector];
  return { marked: next, sector, result: next.length === TRAP_SECTORS.length ? 'success' : null };
};
