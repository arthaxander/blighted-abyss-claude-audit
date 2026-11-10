#!/usr/bin/env node
process.env.BABEL_ENV = process.env.BABEL_ENV || 'test';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const path = require('path'); const babel = require('@babel/core');
const defaultLoader = require.extensions['.js']; const sourceRoot = path.resolve(__dirname, '..', 'src') + path.sep;
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(sourceRoot)) return defaultLoader(module, filename);
  const transformed = babel.transformFileSync(filename, { babelrc: false, configFile: false, presets: [require.resolve('babel-preset-react-app')] });
  module._compile(transformed.code, filename);
};

const assert = require('assert/strict');
const { simulateCombatBatch } = require('../src/utils/combatSimulator');
const { simulateRuns } = require('../src/utils/runSimulator');

const seed = 20260908;
const classes = ['Archer', 'Defender', 'Mage'];
const profiles = ['established', 'prepared'];
const variants = ['production_baseline', 'blade_master_shieldbreaker_physdef_18'];
const cleanConfig = { location: 'deserter', boss: true, policy: 'boss_aware', bossPolicy: 'boss_aware', runs: 50, seed };
const routeConfig = { location: 'deserter', runs: 25, seed, policy: 'balanced', combatMode: 'simulated', combatPolicy: 'strategic', bossPolicy: 'boss_aware', lootPolicy: 'balanced', gearPolicy: 'smart', craftPolicy: 'balanced', extractionPolicy: 'balanced', tuning: 'production_7_14' };
const cells = [];

for (const classId of classes) for (const profile of profiles) {
  const clean = Object.fromEntries(variants.map(balanceVariant => [balanceVariant, simulateCombatBatch({ ...cleanConfig, classId, profile, balanceVariant })]));
  const routes = Object.fromEntries(variants.map(balanceVariant => [balanceVariant, simulateRuns({ ...routeConfig, classId, profile, balanceVariant })]));
  const baseClean = clean[variants[0]]; const aliasClean = clean[variants[1]];
  const baseRoutes = routes[variants[0]]; const aliasRoutes = routes[variants[1]];
  assert.deepStrictEqual(aliasClean.config.resolvedEncounterConfiguration, baseClean.config.resolvedEncounterConfiguration);
  assert.deepStrictEqual(aliasClean.matchedFightOutcomes, baseClean.matchedFightOutcomes);
  assert.deepStrictEqual(aliasClean.deserterMetrics, baseClean.deserterMetrics);
  assert.deepStrictEqual(aliasRoutes.matchedRunOutcomes, baseRoutes.matchedRunOutcomes);
  assert.deepStrictEqual(aliasRoutes.simulatedCombat.deserterMetrics, baseRoutes.simulatedCombat.deserterMetrics);
  cells.push({ classId, profile, cleanFightsPerVariant: 50, routesPerVariant: 25, cleanOutcomesIdentical: true, routeOutcomesAndPreBossStatesIdentical: true, childAndBossSeedsIdentical: true, shieldTelemetryIdentical: true });
}

console.log(JSON.stringify({ seed, variants, resolvedBossConfiguration: simulateCombatBatch({ ...cleanConfig, runs: 1 }).config.resolvedEncounterConfiguration[0], cells, totals: { cleanFights: cells.length * 50 * variants.length, matchedRoutes: cells.length * 25 * variants.length }, equivalent: true }, null, 2));
