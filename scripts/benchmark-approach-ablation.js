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
const variants = ['bare','gear','gear_hp_half','gear_defense_half','gear_attack_half','gear_all_numeric_half','gear_no_numeric','gear_named_effects_off'];
const originalStats = new Map(Object.values(equipmentByName).map(item=>[item,item.stats]));
const aliases = {};
const plainEquipment = {};
for (const classId of ['Defender','Mage','Archer']) {
  plainEquipment[classId] = Object.fromEntries(Object.entries(SIMULATION_CONTROL_PROFILES[classId].established.equipment).map(([slot,name])=>{
    const alias = `SIMULATION_PLAIN:${name}`;
    const source = equipmentByName[name];
    const plain = Object.fromEntries(['class','type','weaponType','hands','magicSchool','stats','inventorySlotBonuses'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
    equipmentByName[alias] = { ...plain, name:alias }; aliases[alias]=name;
    return [slot,alias];
  }));
}
const withVariant = (variant, fn) => {
  const reduced = variant==='gear_hp_half' ? ['maxHp'] : variant==='gear_defense_half' ? ['physDef','magicDef'] : variant==='gear_attack_half' ? ['attack','magAtk'] : null;
  try {
    for(const [item,stats] of originalStats) item.stats = Object.fromEntries(Object.entries(stats || {}).map(([key,value])=>[key, value>0 && (reduced?.includes(key) || ['gear_all_numeric_half','gear_no_numeric'].includes(variant)) ? value*(variant==='gear_no_numeric'?0:0.5) : value]));
    return fn();
  } finally {for(const [item,stats] of originalStats)item.stats=stats;}
};
const makePlayer = (classId,variant) => resolveSimulationPlayerProfile({classId,profile:'bare_base',relicLevel:1,consumables:[],equipment:variant==='bare'?{}:variant==='gear_named_effects_off'?plainEquipment[classId]:SIMULATION_CONTROL_PROFILES[classId].established.equipment}).player;
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
        withVariant(variant,()=>{
          const player=makePlayer(classId,variant);
          player.hp=player.maxHp; player.abyssLevel=1; player.currentLocation=route.location.name; player.activeExpeditionZone='approach';
          const snapshot=snapshotSimulationPlayer(player);
          assert.equal(snapshot.relic.level,1);
          assert.equal(snapshot.classProgression.classLevel,variant.startsWith('level4')?4:1);
          if(variant==='bare') assert(Object.values(player.equipment).every(x=>!x));
          if(variant!=='gear_potions') assert.equal(snapshot.consumables.length,0);
          snapshots[classId+'/'+variant]=snapshot;
          if(variant==='gear_named_effects_off') assert.deepStrictEqual(snapshot.derivedStats,snapshots[classId+'/gear'].derivedStats);
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
for(const alias of Object.keys(aliases))delete equipmentByName[alias];
const report={sourceBaseCommit:'8baa021845355fa535ab212563222d6b01eceaa6',simulatorRevision:'secondary AoE scoring and bounded competent frost-shield utility',seed,routesPerLocation:routes,policy:'competent',
  model:'Independent full-health Approach fights from legal hex routes; identical encounter and seed for every variant; fixed L1 gear control; no loot, crafting or attrition; identical minimum starter relic level 1 in all variants',
  aliases, variants, snapshots, samples,
  limits:['Synthetic competent policy, not human win rates','Approach encounters only, not route completion or deeper zones','Gear controls are assembled L1 items, not measured drop acquisition','Ablations reduce only positive item stats; core class stats and item penalties remain; effects are retained except in the explicitly named effects-off variant','Named effects-off uses temporary stat-only item aliases with unchanged type, weapon school, handedness and inventory bonuses; no production item definitions are saved','These are one-at-a-time interventions, not additive causal shares; interactions remain','Paired seeds do not ensure identical random draws after action sequences diverge','Encounter samples within a route are correlated; no independence-based confidence intervals claimed'],
  groups:[...groups.values()].map(({losses,...g})=>({...g,winRate:100*g.wins/g.n,meanHpLossPct:g.hpLossPct/g.n,medianHpLossPct:losses.sort((a,b)=>a-b)[Math.floor(losses.length/2)],meanPlayerTurns:g.playerTurns/g.n,meanEnemyTurns:g.enemyTurns/g.n,noHpLossRate:100*g.noHpLoss/g.n}))};
const output=path.resolve(args.output || 'docs/simulation/approach-power-ablation-20261013.json');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(`Saved ${report.groups.reduce((s,g)=>s+g.n,0)} independent combat comparisons to ${output}\n`);
