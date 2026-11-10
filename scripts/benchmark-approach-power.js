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
const { createHexCraftingRoute } = require('../src/utils/hexCraftingSimulator');
const { resolveSimulationPlayerProfile, SIMULATION_CONTROL_PROFILES, snapshotSimulationPlayer } = require('../src/utils/simulationPlayerProfiles');
const { simulateCombat } = require('../src/utils/combatSimulator');
const { equipmentByName } = require('../src/data/equipment');
const { deriveSimulationSeed } = require('../src/utils/simulationRng');
const args = Object.fromEntries(process.argv.slice(2).flatMap((arg,i,all)=>arg.startsWith('--')?[[arg.slice(2),all[i+1]]]:[]));
const routes = Number(args.routes || 20), seed = Number(args.seed || 20261013);
assert(Number.isSafeInteger(routes) && routes > 0 && routes <= 1000);
const secondary = ['speed','speedPct','critChance','critDamage','dodge'];
const variants = ['bare','starter','gear','gear_secondary_half','gear_secondary_zero','level4_bare','level4_gear','gear_potions'];
const originalStats = new Map(Object.values(equipmentByName).map(item=>[item,item.stats]));
const withSecondary = (factor, fn) => {
  try {
    for (const [item,stats] of originalStats) item.stats = Object.fromEntries(Object.entries(stats || {}).map(([key,value])=>[key,secondary.includes(key) && value > 0 ? value*factor : value]));
    return fn();
  } finally { for (const [item,stats] of originalStats) item.stats = stats; }
};
const makePlayer = (classId, variant) => {
  const progressed = variant.startsWith('level4');
  const geared = !['bare','starter','level4_bare'].includes(variant);
  const player = resolveSimulationPlayerProfile({ classId, profile: progressed ? 'established' : 'bare_base',
    equipment: geared ? SIMULATION_CONTROL_PROFILES[classId].established.equipment : variant==='starter' ? undefined : {},
    relicLevel:1, consumables: variant==='gear_potions' ? [{id:'Малое зелье здоровья',quantity:2}] : [],
  }).player;
  if(variant==='starter') return resolveSimulationPlayerProfile({classId,profile:'fresh',relicLevel:1,consumables:[]}).player;
  return player;
};
const groups = new Map(), snapshots={}, samples=[];
for (const location of ['goblin','fungal','deserter']) {
  for(let i=0;i<routes;i++) {
    const routeSeed=deriveSimulationSeed(seed,i);
    const route=createHexCraftingRoute({location,seed:routeSeed});
    const cells=route.route.filter(cell=>cell.phase==='approach' && cell.enemies.length);
    assert(cells.length>0);
    for(const cell of cells) {
      samples.push({location,routeSeed,cellId:cell.cellId,seed:cell.seed,enemies:cell.enemies.map(e=>e.name)});
      for(const classId of ['Defender','Mage','Archer']) for(const variant of variants) {
        const factor=variant==='gear_secondary_half' ? 0.5 : variant==='gear_secondary_zero' ? 0 : 1;
        withSecondary(factor,()=>{
          const player=makePlayer(classId,variant);
          player.hp=player.maxHp; player.abyssLevel=1; player.currentLocation=route.location.name; player.activeExpeditionZone='approach';
          const snapshot=snapshotSimulationPlayer(player);
          assert.equal(snapshot.relic.level,1);
          assert.equal(snapshot.classProgression.classLevel,variant.startsWith('level4')?4:1);
          if(variant==='bare') assert(Object.values(player.equipment).every(x=>!x));
          if(variant!=='gear_potions') assert.equal(snapshot.consumables.length,0);
          snapshots[classId+'/'+variant]=snapshot;
          const r=simulateCombat({player,enemies:cell.enemies,location,seed:cell.seed,policy:'competent'});
          assert(!r.abnormal,`Abnormal simulation: ${location}/${classId}/${variant}/${cell.seed}`);
          const key=[location,classId,variant].join('/');
          if(!groups.has(key)) groups.set(key,{location,classId,variant,n:0,wins:0,hpRemaining:0,hpLossPct:0,playerTurns:0,enemyTurns:0,noHpLoss:0,consumables:0,losses:[]});
          const g=groups.get(key);g.n++;g.wins+=r.outcome==='victory';g.hpRemaining+=r.endingPlayerHpPercentage;
          const loss=100-r.endingPlayerHpPercentage;g.hpLossPct+=loss;g.losses.push(loss);
          g.playerTurns+=r.playerTurns;g.enemyTurns+=r.enemyTurns;g.noHpLoss+=loss<0.0001;g.consumables+=r.consumableUses;
        });
      }
    }
    if((i+1)%5===0) process.stderr.write(`${location}: ${i+1}/${routes} routes\n`);
  }
}
for(const [item,stats] of originalStats) assert.strictEqual(item.stats,stats);
const report={sourceCommit:'f8a280bd075f8cde76f4b7659c930f946dfaf705',seed,routesPerLocation:routes,policy:'competent',
  model:'Independent full-health Approach fights from legal hex routes; identical encounter and seed for every variant; fixed L1 gear control; no loot, crafting or attrition; identical minimum starter relic level 1 in all variants',
  secondaryStats:secondary, variants, snapshots, samples,
  limits:['Synthetic competent policy, not human win rates','Approach encounters only, not route completion or deeper zones','Level4 contrasts include unlocked ability/passive loadout, not only numeric growth','Gear controls are assembled L1 items, not measured drop acquisition','Secondary experiments change only positive numeric speed/crit/dodge bonuses; item procs, HP, attack, defenses and set bonuses are retained','Paired seeds do not ensure identical random draws after action sequences diverge','Encounter samples within a route are correlated; no independence-based confidence intervals claimed'],
  groups:[...groups.values()].map(({losses,...g})=>({...g,winRate:100*g.wins/g.n,meanHpLossPct:g.hpLossPct/g.n,medianHpLossPct:losses.sort((a,b)=>a-b)[Math.floor(losses.length/2)],meanPlayerTurns:g.playerTurns/g.n,meanEnemyTurns:g.enemyTurns/g.n,noHpLossRate:100*g.noHpLoss/g.n}))};
const output=path.resolve(args.output || 'docs/simulation/approach-power-benchmark-20261013.json');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(`Saved ${report.groups.reduce((s,g)=>s+g.n,0)} independent combat comparisons to ${output}\n`);
