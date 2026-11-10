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

const { createHexCraftingRoute, simulateHexCraftingRun } = require('../src/utils/hexCraftingSimulator');
const { getFieldCraftingRecipes } = require('../src/data/recipes');
const { deriveSimulationSeed } = require('../src/utils/simulationRng');
const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) => arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : []).filter(x => x.length));
const runs = Number(args.runs || 30);
const seed = Number(args.seed || 20261013);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10000) throw new Error('runs must be 1..10000');
const sum = record => Object.values(record || {}).reduce((a, b) => a + b, 0);
const merge = (out, record) => Object.entries(record || {}).forEach(([key, n]) => { out[key] = (out[key] || 0) + n; });
const categories = Object.fromEntries(getFieldCraftingRecipes().map(r => [r.name, r.category === 'survival' ? 'medicine' : r.category]));
const groups = new Map();
const rows = [];
const routeMetrics = [];
const disabled = args.ablation === 'true' ? ['medicine', 'scroll', 'trap'] : [];
for (const location of (args.locations || 'goblin,fungal,deserter').split(',')) {
  for (let i = 0; i < runs; i++) {
    const childSeed = deriveSimulationSeed(seed, i);
    const route = createHexCraftingRoute({ location, seed: childSeed });
    routeMetrics.push({ location, seed: childSeed, cells: route.route.length, sublocation: route.selectedSublocationId, phases: Object.fromEntries(['approach','sublocation','depth','boss'].map(phase => {
      const cells = route.route.filter(c => c.phase === phase);const resources = {};
      cells.forEach(c => c.loot.forEach(item => { resources[item.name] = (resources[item.name] || 0) + item.quantity; }));
      return [phase, { cells: cells.length, combats: cells.filter(c => c.enemies.length).length, resources }];
    })) });
    for (const classId of ['Defender', 'Mage', 'Archer']) for (const profile of (args.profiles || 'fresh,established,prepared').split(',')) {
      const policies = ['off', 'moderate', 'prepared'].map(craftPolicy => ({ craftPolicy, disabledCategories: [] }));
      if (profile === 'prepared') disabled.forEach(category => policies.push({ craftPolicy: 'prepared', disabledCategories: [category] }));
      for (const policy of policies) {
        const result = simulateHexCraftingRun({ route, seed: childSeed, classId, profile, ...policy });
        const label = policy.disabledCategories.length ? `prepared-without-${policy.disabledCategories[0]}` : policy.craftPolicy;
        const key = [location, classId, profile, label].join('/');
        if (!groups.has(key)) groups.set(key, { location, classId, profile, policy: label, n: 0, victories: 0, abnormal: 0, encounters: 0, crafted: {}, used: {}, usedCategories: {}, ingredientsConsumed: {}, missingIngredients: 0, noSpace: 0, lootLeftBehind: {}, resourcesAcquired: {}, phases: {}, remaining: {}, beforeBoss: {}, reachedBoss: 0 });
        const g = groups.get(key);g.n++;g.victories += result.outcome === 'victory' ? 1 : 0;g.abnormal += result.abnormal ? 1 : 0;
        for (const k of ['encounters','missingIngredients','noSpace']) g[k] += result[k];
        for (const k of ['crafted','used','ingredientsConsumed','lootLeftBehind','resourcesAcquired','remaining']) merge(g[k],result[k]);
        merge(g.used,result.trapUsed);
        for (const [name,n] of Object.entries({...result.used})) g.usedCategories[categories[name] || 'medicine'] = (g.usedCategories[categories[name] || 'medicine'] || 0)+n;
        g.usedCategories.trap=(g.usedCategories.trap||0)+sum(result.trapUsed);
        for(const [phase,snapshot] of Object.entries(result.phases)) {
          g.phases[phase] ||= { reached:0, availableChoices:0, repeatable:{}, carried:{} };
          const p=g.phases[phase];p.reached++;p.availableChoices+=snapshot.available.length;merge(p.repeatable,snapshot.repeatable);merge(p.carried,snapshot.carried);
        }
        if(result.beforeBoss){g.reachedBoss++;merge(g.beforeBoss,result.beforeBoss.carried);}
        rows.push({location,seed:childSeed,classId,profile,policy:label,outcome:result.outcome,encounters:result.encounters,crafted:sum(result.crafted),used:sum(result.used)+sum(result.trapUsed),missing:result.missingIngredients,noSpace:result.noSpace});
      }
    }
    if ((i+1)%10===0) process.stderr.write(`${location}: ${i+1}/${runs} routes compared\n`);
  }
}
const report = {
  version: 1, seed, runsPerGroup: runs, sourceCommit: 'e574cdce8562561d98a6842923d4dc844699aa24',
  model: 'Actual hex-board-v2 transitions, full-clear traversal, same encounter and loot seeds across strategies; competent combat policy; fixed equipment/profile; no enemy stat changes',
  limits: ['Synthetic policy outcomes, not human win rates', 'Full clear including 14 Depth cells is deliberately more demanding than shortest-path extraction', 'No mid-run equipment or class progression, altar benefits, fishing rewards or voluntary extraction', 'Three authored Level 1 locations; Level 2 recipes tested functionally, not claimed as a Level 2 route balance study', 'Phase crafting alternatives compete for ingredients and must not be summed; phase snapshots are conditional on reaching that phase', 'Ablation disables crafting of a category and allows remaining crafting choices to adapt; found/starting items still usable'],
  groups: [...groups.values()], rows, routeMetrics,
};
const output=path.resolve(args.output || 'docs/simulation/field-crafting-20261013.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(`Saved ${rows.length} policy runs to ${output}\n`);
