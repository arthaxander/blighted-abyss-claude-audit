#!/usr/bin/env node
process.env.BABEL_ENV = process.env.BABEL_ENV || 'test';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const fs = require('fs'); const path = require('path'); const babel = require('@babel/core');
const defaultLoader = require.extensions['.js']; const sourceRoot = path.resolve(__dirname, '..', 'src') + path.sep;
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(sourceRoot)) return defaultLoader(module, filename);
  const transformed = babel.transformFileSync(filename, { babelrc: false, configFile: false, presets: [require.resolve('babel-preset-react-app')], sourceMaps: 'inline' });
  module._compile(transformed.code, filename);
};
const { simulateCombatBatch, formatCombatSimulationReport } = require('../src/utils/combatSimulator');
const args = process.argv.slice(2).reduce((out, arg, index, all) => { if (!arg.startsWith('--')) return out; const [key, inline] = arg.slice(2).split('='); out[key] = inline === undefined && all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : inline ?? true; return out; }, {});
const list = value => value?.split(',').map(entry => entry.trim()).filter(Boolean);
const common = { runs: Number(args.runs || 1000), seed: Number(args.seed || 1), classId: ({ archer: 'Archer', elementalist: 'Mage', mage: 'Mage', warrior: 'Defender', defender: 'Defender' })[args.class] || args.class || 'Archer', bossPolicy: args['boss-policy'], balanceVariant: args['balance-variant'] || 'production_baseline', location: args.location || 'fungal', enemyNames: list(args.enemies), verbose: Boolean(args.verbose), profile: args.profile || 'fresh', activeIds: list(args['active-ids']), passiveIds: list(args['passive-ids']), consumables: list(args.consumables)?.map(entry => { const [id, quantity] = entry.split(':'); return { id, quantity: Number(quantity || 1) }; }), completedCombats: Number(args['completed-combats'] || 0), boss: Boolean(args.boss), playerState: args['player-state'] ? JSON.parse(fs.readFileSync(path.resolve(args['player-state']), 'utf8')) : undefined };
const policies = list(args['compare-policies']) || [args.policy || 'naive'];
const builds = list(args['compare-builds']) || [args.build || 'default'];
const relicLevels = list(args['compare-relic-levels'])?.map(Number) || [args['relic-level'] === undefined ? undefined : Number(args['relic-level'])];
const reports = policies.flatMap(policy => builds.flatMap(build => relicLevels.map(relicLevel => simulateCombatBatch({ ...common, policy, build, relicLevel }))));
process.stdout.write(`${reports.map(formatCombatSimulationReport).join('\n\n')}\n`);
if (args.output) { const output = path.resolve(args.output); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)}\n`); }
