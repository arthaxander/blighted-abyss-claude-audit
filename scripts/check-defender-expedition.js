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



const assert = require('assert');
const {createHexCraftingRoute,simulateHexCraftingRun}=require('../src/utils/hexCraftingSimulator');
const {resolveSimulationPlayerProfile}=require('../src/utils/simulationPlayerProfiles');
const {simulateCombat}=require('../src/utils/combatSimulator');
const {applyFieldCraftingPolicy}=require('../src/utils/fieldCraftingPolicy');
const {deriveSimulationSeed}=require('../src/utils/simulationRng');
const {enemies}=require('../src/data/enemies');
const balance=require('../src/data/classCombatBalance');
const original=balance.getClassDamageMultiplier;
const previous=require('../docs/simulation/class-nerfs-forest-20261014.json');
const {loadouts}=require('../docs/simulation/equipment-tier-tempo-20261014.json');
const routeRuns=[],forestFights=[];
try {
 for(const location of ['goblin','fungal','deserter']) for(let i=0;i<10;i++) {
  const seed=deriveSimulationSeed(20261014,i),route=createHexCraftingRoute({location,seed});
  const before=JSON.stringify(route);
  for(const classId of ['Defender','Archer']) for(const tier of ['floor1','floor2']) for(const variant of classId==='Defender'?['before','current']:['current']) for(const craftPolicy of ['off','prepared']) {
   balance.getClassDamageMultiplier=(source,options={})=>variant==='before'&&['Defender','Защитник'].includes(source?.class)?1:original(source,options);
   const r=simulateHexCraftingRun({route,seed,classId,profile:'prepared',craftPolicy,playerOptions:{equipment:loadouts[classId][tier],relicLevel:1}});
   assert(!r.abnormal);routeRuns.push({...r,tier,variant});
  }
  assert.equal(JSON.stringify(route),before);
  process.stderr.write(`${location} ${i+1}/10\n`);
 }
 balance.getClassDamageMultiplier=original;
 const roster=enemies.filter(e=>e.location==='Лес Увядания'&&!e.summonOnly);
 for(const classId of ['Defender','Archer']) for(const preparation of ['none','stocked']) for(const e of previous.encounters.filter(e=>e.floor===2)) {
  const supplies=preparation==='stocked'?[{id:'Зелье здоровья',quantity:3}]:[];
  let player=resolveSimulationPlayerProfile({classId,profile:'prepared',equipment:loadouts[classId].floor2,relicLevel:1,consumables:supplies}).player;
  player={...player,abyssLevel:2,currentLocation:'Лес Увядания'};
  const encounter=e.enemies.map(name=>roster.find(x=>x.name===name));assert(encounter.every(Boolean));
  player=applyFieldCraftingPolicy(player,'prepared',{enemies:encounter}).player;
  const r=simulateCombat({player,enemies:encounter,seed:e.seed,policy:'competent'});
  if(r.abnormal)process.stderr.write(`Action limit: ${classId}/${preparation}/${e.phase}/${e.seed}
`);
  forestFights.push({classId,preparation,phase:e.phase,enemies:e.enemies,seed:e.seed,outcome:r.outcome,abnormal:r.abnormal,playerTurns:r.playerTurns,enemyTurns:r.enemyTurns,endingHp:r.endingPlayerHpPercentage,used:r.consumableUsage,enemyHpRemaining:encounter.reduce((n,e)=>n+(e.maxHp||e.hp),0)-r.playerDamageDealt,healingAtDeath:r.healingAtDeath,bossMechanicResponses:r.bossMechanicResponses});
 }
} finally {balance.getClassDamageMultiplier=original;}
const report={baseCommit:'abd8978dca281b2b4f93558377388b064c5bfc31',heroLevel:9,routeRuns,forestFights,limits:['Synthetic competent policy, not human win rates. Mage excluded pending innate redesign.','Full clear, fixed first available sublocation; no equipment changes, XP, altars, fishing or extraction mid-run.','L1 starts with 3 small healing potions and 3 poultices; off disables field preparation, not combat item use. Both policies collect the same generated loot.','L2 equally weighted templates, isolated full-health fights; stocked means 3 healing potions, not an optimized consumable build or route.','No class-level comparison; gear II on floor I is a power comparison, not assumed acquisition before its bosses.']};
fs.writeFileSync('docs/simulation/defender-expedition-20261014.json.gz',require('zlib').gzipSync(JSON.stringify(report)+'\n'));console.log(`Saved ${routeRuns.length} routes and ${forestFights.length} Forest fights`);
