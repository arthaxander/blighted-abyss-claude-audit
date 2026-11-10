#!/usr/bin/env node
// Rebuild src/data/imageBundles.js after committing new art.
// Bundles must stay location-scoped: never group all Abyss floors in one request.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../public/assets');
const dest = path.resolve(__dirname, '../src/data/imageBundles.js');
const allowed = /\.(?:webp|png|jpe?g|svg)$/i;
const paths = [];

const scan = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(absolute);
    else if (entry.isFile() && allowed.test(entry.name)) {
      paths.push('/assets/' + path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
};
scan(root);
paths.sort((a, b) => a.localeCompare(b));

const groups = {
  GUILD: [
    '/assets/guild/',
    '/assets/items/',
    '/assets/combat/portraits/player/',
    '/assets/portraits/',
  ],
  SHARED: [
    '/assets/combat/abilities/defender/',
    '/assets/combat/abilities/elementalist/',
    '/assets/combat/abilities/archer/',
    '/assets/combat/abilities/shared/',
    '/assets/combat/abilities/summons/',
    '/assets/combat/portraits/allies/',
    '/assets/combat/effects/',
    '/assets/combat/passives/',
    '/assets/combat/fallbacks/',
  ],
};
const locations = {
  GOBLIN: 'goblin_nests',
  FUNGAL: 'fungal',
  DESERTER: 'deserter_camp',
  WITHERING_FOREST: 'withering_forest',
  RESTLESS_RUINS: 'restless_ruins',
  MINES_OF_DECAY: 'mines_of_decay',
};
for (const [group, folder] of Object.entries(locations)) {
  groups[group] = [
    `/assets/rooms/${folder}/`,
    `/assets/combat/portraits/enemies/${folder}/`,
    `/assets/combat/abilities/${folder}/`,
  ];
}
// The new painted Goblin map lives outside the legacy room-art folder.
groups.GOBLIN.push('/assets/maps/goblin-cavern-v1/');

let output = `// Each area loads only its own authored location art plus shared combat UI art.\n`
  + `// Generated from public/assets by scripts/generate-image-bundles.cjs.\n`
  + `// Run: npm run assets:manifest after committing new images.\n`
  + `import { getLocationByName } from './locations';\n\n`
  + `const publicUrl = (process.env.PUBLIC_URL || '').replace(/\\/$/, '');\n`
  + "const asUrl = path => `${publicUrl}${path}`;\n\n";

for (const [group, folders] of Object.entries(groups)) {
  const urls = paths.filter(url => folders.some(prefix => url.startsWith(prefix)));
  output += `const ${group}_ASSETS = [\n${urls.map(url => `  ${JSON.stringify(url)},`).join('\n')}\n];\n\n`;
}
output += `const withShared = local => [...new Set([...SHARED_ASSETS, ...local])].map(asUrl);\n\n`
  + `export const IMAGE_BUNDLES = Object.freeze({\n`
  + `  guild: GUILD_ASSETS.map(asUrl),\n`
  + `  shared: SHARED_ASSETS.map(asUrl),\n`
  + Object.keys(locations).map(key => `  ${key.toLowerCase()}: withShared(${key}_ASSETS),\n`).join('')
  + `});\n\n`
  + `export const getImageBundle = id => IMAGE_BUNDLES[id] || [];\n\n`
  + `export const getLocationImageBundleId = locationName => {\n`
  + `  const id = getLocationByName(locationName)?.id;\n`
  + `  return id && IMAGE_BUNDLES[id] ? id : 'shared';\n`
  + `};\n`;

fs.writeFileSync(dest, output);
const lines = Object.entries(groups).map(([name, prefixes]) =>
  `${name.toLowerCase()}: ${paths.filter(url => prefixes.some(prefix => url.startsWith(prefix))).length}`
);
process.stdout.write(`Updated ${path.relative(process.cwd(), dest)} (${lines.join(', ')})\n`);
