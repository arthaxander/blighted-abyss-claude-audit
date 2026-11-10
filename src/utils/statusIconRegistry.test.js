import fs from 'fs';
import path from 'path';
import {
  ALL_EFFECTS,
  EFFECT_ICON_BASE_PATH,
  EFFECT_ICON_FILES,
  getEffectDefinition,
} from './effects';

const repoRoot = process.cwd();
const iconDirectory = path.join(repoRoot, 'public/assets/combat/effects');
const productionEffects = ALL_EFFECTS.filter(effect => !effect.legacyOnly);
const sourceFiles = [
  'src/data/abilities.js',
  'src/data/abilityPresets.js',
  'src/data/items.js',
  'src/data/equipment.js',
  'src/utils/inventoryItemUse.js',
  'src/utils/combatUtils.js',
  'src/utils/customCombat.js',
];

const listSourceFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const absolute = path.join(directory, entry.name);
  if (entry.isDirectory()) return listSourceFiles(absolute);
  return entry.isFile() && /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [absolute] : [];
});

test('every displayed production effect has one existing canonical status icon', () => {
  expect(EFFECT_ICON_BASE_PATH).toBe('/assets/combat/effects');
  expect(Object.keys(EFFECT_ICON_FILES).sort()).toEqual(productionEffects.map(effect => effect.id).sort());

  productionEffects.forEach(effect => {
    const file = EFFECT_ICON_FILES[effect.id];
    expect(file).toMatch(/^status_[a-z0-9_]+\.webp$/);
    expect(fs.existsSync(path.join(iconDirectory, file))).toBe(true);
    expect(effect.iconPath).toBe(`${EFFECT_ICON_BASE_PATH}/${file}`);
  });
});

test('asset spelling and extension exactly match files on disk', () => {
  const diskFiles = new Set(fs.readdirSync(iconDirectory));
  Object.values(EFFECT_ICON_FILES).forEach(file => expect(diskFiles.has(file)).toBe(true));
});

test('future icons remain assets only and do not create production effects', () => {
  const futureIcons = [
    'status_arrogance.webp',
    'status_corruption.webp',
    'status_empathy.webp',

  ];
  const mapped = new Set(Object.values(EFFECT_ICON_FILES));
  futureIcons.forEach(file => {
    expect(fs.existsSync(path.join(iconDirectory, file))).toBe(true);
    expect(mapped.has(file)).toBe(false);
    expect(getEffectDefinition(file.replace(/^status_|\.webp$/g, ''))).toBeNull();
  });
});

test('effect producers in abilities, items, equipment, and combat helpers resolve through the registry', () => {
  sourceFiles.forEach(relativeFile => {
    const source = fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
    const namedReferences = [...source.matchAll(/effectId\(['"]([^'"]+)['"]\)/g)].map(match => match[1]);
    namedReferences.forEach(name => expect(getEffectDefinition(name)).not.toBeNull());

    const directAddEffectIds = [...source.matchAll(/addEffect\([\s\S]{0,160}?\{\s*id:\s*['"]([a-z][a-z0-9_]*)['"]/g)]
      .map(match => match[1]);
    directAddEffectIds.forEach(id => expect(getEffectDefinition(id)).not.toBeNull());
  });
});

test('legacy icon paths and directory are absent', () => {
  const legacyDirectory = ['public', 'assets', 'status' + '_icons'];
  const legacyPaths = ['/assets/' + 'status_icons', '/assets/' + 'effects', "'/" + "effects", '"/' + 'effects'];
  expect(fs.existsSync(path.join(repoRoot, ...legacyDirectory))).toBe(false);
  listSourceFiles(path.join(repoRoot, 'src')).forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    legacyPaths.forEach(legacyPath => expect(source).not.toContain(legacyPath));
  });
});

test('semantically distinct mechanics keep their original effect IDs', () => {
  expect(getEffectDefinition('great_bonfire_flame')).toMatchObject({
    id: 'great_bonfire_flame',
    name: 'Пламя Великого Костра',
  });
  expect(getEffectDefinition('iron_counter')).toMatchObject({ id: 'iron_counter', name: 'Контратака' });
  expect(getEffectDefinition('armor_sunder')).toMatchObject({ id: 'armor_sunder', name: 'Раскол брони' });
  expect(EFFECT_ICON_FILES.great_bonfire_flame).toBe('status_eternal_bonfire_flame.webp');
  expect(EFFECT_ICON_FILES.iron_counter).toBe('status_counterattack.webp');
  expect(EFFECT_ICON_FILES.armor_sunder).toBe('status_armor_breaker.webp');
});
