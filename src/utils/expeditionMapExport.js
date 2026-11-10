import { HEX_MACRO_TEMPLATES } from './expeditionMapLayout';

const HEX_WIDTH = 92;
const HEX_HEIGHT = 54;
const HEX_X = 74;
const HEX_Y = 41;

const EXPORT_SCALE = 4;
const EXPORT_PADDING = 56;

const HEX_CLIP_POINTS = Object.freeze([
  Object.freeze([0.50, 0.00]),
  Object.freeze([0.94, 0.24]),
  Object.freeze([0.94, 0.76]),
  Object.freeze([0.50, 1.00]),
  Object.freeze([0.06, 0.76]),
  Object.freeze([0.06, 0.24]),
]);

const REGION_FILLS = Object.freeze({
  approach: '#f2f2f2',
  'sublocation-1': '#d0d0d0',
  'sublocation-2': '#a8a8a8',
  'sublocation-3': '#808080',
  depth: '#505050',
  boss: '#fdfdfd',
});

const projectCell = ({ q, r }) => ({
  x: (Number(q) + Number(r) * 0.5) * HEX_X,
  y: Number(r) * HEX_Y,
});

const getTemplate = templateId =>
  HEX_MACRO_TEMPLATES.find(entry => entry.id === templateId) || HEX_MACRO_TEMPLATES[0];

const getTemplateCells = template => [
  ...template.approach.coordinates.map(coordinate => ({ ...coordinate, exportRegion: 'approach' })),
  ...template.sublocations.flatMap((slot, index) =>
    slot.coordinates.map(coordinate => ({
      ...coordinate,
      exportRegion: `sublocation-${index + 1}`,
    }))
  ),
  ...template.depth.coordinates.map(coordinate => ({ ...coordinate, exportRegion: 'depth' })),
  ...template.boss.coordinates.map(coordinate => ({ ...coordinate, exportRegion: 'boss' })),
];

const buildHexPath = (context, centerX, centerY) => {
  context.beginPath();
  HEX_CLIP_POINTS.forEach(([rx, ry], index) => {
    const x = centerX + (rx - 0.5) * HEX_WIDTH;
    const y = centerY + (ry - 0.5) * HEX_HEIGHT;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
};

const downloadCanvas = async (canvas, filename) => {
  const blob = await new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob(resolve, 'image/png');
  });

  const link = document.createElement('a');
  link.download = filename;
  link.style.display = 'none';

  if (blob) {
    const url = URL.createObjectURL(blob);
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const exportWideCavernTemplatePng = async ({
  templateId = 'wide-cavern-01',
  mode = 'schematic',
  scale = EXPORT_SCALE,
} = {}) => {
  try {
    if (typeof document === 'undefined') {
      return { success: false, reason: 'document недоступен' };
    }

    const template = getTemplate(templateId);
    if (!template) return { success: false, reason: 'шаблон карты не найден' };

    const cells = getTemplateCells(template).map(cell => ({
      ...cell,
      ...projectCell(cell),
    }));
    if (!cells.length) return { success: false, reason: 'в шаблоне нет клеток' };

    const minX = Math.min(...cells.map(cell => cell.x - HEX_WIDTH / 2));
    const maxX = Math.max(...cells.map(cell => cell.x + HEX_WIDTH / 2));
    const minY = Math.min(...cells.map(cell => cell.y - HEX_HEIGHT / 2));
    const maxY = Math.max(...cells.map(cell => cell.y + HEX_HEIGHT / 2));

    const logicalWidth = Math.ceil(maxX - minX + EXPORT_PADDING * 2);
    const logicalHeight = Math.ceil(maxY - minY + EXPORT_PADDING * 2);
    const safeScale = Math.max(1, Math.min(6, Number(scale) || EXPORT_SCALE));

    const canvas = document.createElement('canvas');
    canvas.width = logicalWidth * safeScale;
    canvas.height = logicalHeight * safeScale;

    const context = canvas.getContext('2d');
    if (!context) return { success: false, reason: 'Canvas 2D недоступен' };

    context.scale(safeScale, safeScale);
    context.fillStyle = '#000000';
    context.fillRect(0, 0, logicalWidth, logicalHeight);
    context.lineJoin = 'round';

    cells.forEach(cell => {
      const centerX = cell.x - minX + EXPORT_PADDING;
      const centerY = cell.y - minY + EXPORT_PADDING;
      buildHexPath(context, centerX, centerY);
      context.fillStyle = mode === 'regions'
        ? (REGION_FILLS[cell.exportRegion] || '#ffffff')
        : '#ffffff';
      context.fill();
    });

    cells.forEach(cell => {
      const centerX = cell.x - minX + EXPORT_PADDING;
      const centerY = cell.y - minY + EXPORT_PADDING;
      buildHexPath(context, centerX, centerY);
      context.strokeStyle = '#000000';
      context.lineWidth = 1.5;
      context.stroke();
    });

    const suffix = mode === 'regions' ? 'regions' : 'schematic';
    const filename = `${template.id}-${suffix}-${safeScale}x.png`;
    await downloadCanvas(canvas, filename);

    return {
      success: true,
      filename,
      width: canvas.width,
      height: canvas.height,
    };
  } catch (error) {
    return {
      success: false,
      reason: error?.message || String(error),
    };
  }
};

export const EXPEDITION_MAP_EXPORT_GEOMETRY = Object.freeze({
  hexWidth: HEX_WIDTH,
  hexHeight: HEX_HEIGHT,
  hexX: HEX_X,
  hexY: HEX_Y,
});
