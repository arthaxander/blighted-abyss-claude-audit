// This projection is shared by the original hit targets and painted layers.
// It does not alter axial coordinates, adjacency, gates, or saved run data.
export const HEX_WIDTH = 92;
export const HEX_HEIGHT = 54;
export const HEX_X = 74;
export const HEX_Y = 41;
export const BOARD_PADDING_X = 110;
export const BOARD_PADDING_TOP = 420;
export const BOARD_PADDING_BOTTOM = 120;

export const projectExpeditionCell = (cell, topology) => {
  if (topology === 'hex-board-v2') {
    const q = Number(cell.q) || 0;
    const r = Number(cell.r) || 0;
    return { sx: (q + r * 0.5) * HEX_X, sy: r * HEX_Y };
  }
  const x = Number(cell.x) || 0;
  const y = Number(cell.y) || 0;
  return { sx: (x - y) * (HEX_WIDTH / 2), sy: (x + y) * (HEX_HEIGHT / 2) };
};

export const getExpeditionBoardGeometry = projected => {
  const minX = Math.min(...projected.map(cell => cell.sx), 0);
  const maxX = Math.max(...projected.map(cell => cell.sx), 0);
  const minY = Math.min(...projected.map(cell => cell.sy), 0);
  const maxY = Math.max(...projected.map(cell => cell.sy), 0);
  const contentWidth = maxX - minX + HEX_WIDTH + BOARD_PADDING_X * 2;
  const contentHeight = maxY - minY + HEX_HEIGHT + BOARD_PADDING_TOP + BOARD_PADDING_BOTTOM;
  const width = Math.max(620, contentWidth);
  const height = Math.max(520, contentHeight);
  return {
    minX, minY, width, height,
    centerOffsetX: Math.max(0, (width - contentWidth) / 2),
    centerOffsetY: Math.max(0, (height - contentHeight) / 2),
  };
};

export const getExpeditionCellPosition = (cell, geometry) => ({
  x: cell.sx - geometry.minX + BOARD_PADDING_X + geometry.centerOffsetX,
  y: cell.sy - geometry.minY + BOARD_PADDING_TOP + geometry.centerOffsetY,
});

// Overlapping polygons form one continuous floor, not individual hex textures.
// The extra shoulder keeps every hit target clear of the surrounding rock.
export const getWalkableFloorPath = (cells, geometry) => cells.filter(cell => cell.walkable !== false).map(cell => {
  const { x, y } = getExpeditionCellPosition(cell, geometry);
  return `M${x},${y - 37}L${x + 49},${y - 19}L${x + 49},${y + 19}L${x},${y + 37}L${x - 49},${y + 19}L${x - 49},${y - 19}Z`;
}).join(' ');

export const getRegionBounds = (cells, geometry) => {
  const points = cells.map(cell => getExpeditionCellPosition(cell, geometry));
  const left = Math.min(...points.map(p => p.x)) - 49;
  const top = Math.min(...points.map(p => p.y)) - 37;
  return {
    x: left, y: top,
    width: Math.max(...points.map(p => p.x)) + 49 - left,
    height: Math.max(...points.map(p => p.y)) + 37 - top,
  };
};

