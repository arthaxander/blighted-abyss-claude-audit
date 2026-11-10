#!/usr/bin/env node

process.env.BABEL_ENV = process.env.BABEL_ENV || 'test';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const defaultLoader = require.extensions['.js'];
const sourceRoot = path.resolve(__dirname, '..', 'src') + path.sep;

require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(sourceRoot)) return defaultLoader(module, filename);
  const transformed = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-react-app')],
    sourceMaps: 'inline',
  });
  module._compile(transformed.code, filename);
};

const { formatRunSimulationReport, simulateRuns } = require('../src/utils/runSimulator');

const parseArguments = argv => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--verbose') options.verbose = true;
    else if (argument.startsWith('--')) {
      const [rawKey, inlineValue] = argument.slice(2).split('=');
      const value = inlineValue === undefined ? argv[++index] : inlineValue;
      options[rawKey] = value;
    }
  }
  return options;
};

const args = parseArguments(process.argv.slice(2));
const options = {
  location: args.location || 'goblin',
  runs: Number(args.runs || 1000),
  seed: Number(args.seed || 1),
  policy: args.policy || 'random',
  maxWindows: Number(args['max-windows'] || 200),
  verbose: Boolean(args.verbose),
  combatMode: args['combat-mode'] || 'abstract',
  combatPolicy: args['combat-policy'] || 'competent',
  bossPolicy: args['boss-policy'],
  balanceVariant: args['balance-variant'] || 'production_baseline',
  lootPolicy: args['loot-policy'] || 'balanced',
  gearPolicy: args['gear-policy'] || 'off',
  craftPolicy: args['craft-policy'] || 'off',
  extractionPolicy: args['extraction-policy'] || 'off',
  classId: ({ archer: 'Archer', elementalist: 'Mage', mage: 'Mage', warrior: 'Defender', defender: 'Defender' })[args.class] || args.class || 'Archer',
  profile: args.profile || 'fresh',
  build: args.build || 'default',
  relicLevel: args['relic-level'] === undefined ? undefined : Number(args['relic-level']),
  activeIds: args['active-ids']?.split(',').filter(Boolean),
  passiveIds: args['passive-ids']?.split(',').filter(Boolean),
  consumables: args.consumables?.split(',').filter(Boolean).map(entry => { const [id, quantity] = entry.split(':'); return { id, quantity: Number(quantity || 1) }; }),
  tuning: args.tuning || 'production_7_14',
};

try {
  const tuningIds = args['compare-tunings']?.split(',').filter(Boolean) || [options.tuning];
  const reports = tuningIds.map(tuning => simulateRuns({ ...options, tuning }));
  process.stdout.write(`${reports.map(formatRunSimulationReport).join('\n\n')}\n`);
  if (args.output) {
    const outputPath = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)}\n`);
    process.stdout.write(`\nJSON: ${outputPath}\n`);
  }
} catch (error) {
  process.stderr.write(`Run simulation failed: ${error.message}\n`);
  process.exitCode = 1;
}
