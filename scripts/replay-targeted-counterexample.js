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
const {createHexCraftingRoute}=require('../src/utils/hexCraftingSimulator');
const {resolveSimulationPlayerProfile,SIMULATION_CONTROL_PROFILES,snapshotSimulationPlayer}=require('../src/utils/simulationPlayerProfiles');
const {simulateCombat}=require('../src/utils/combatSimulator');
const {equipmentByName}=require('../src/data/equipment');
const {deriveSimulationSeed}=require('../src/utils/simulationRng');
const args=Object.fromEntries(process.argv.slice(2).flatMap((a,i,all)=>a.startsWith('--')?[[a.slice(2),all[i+1]]]:[]));
const routes=Number(args.routes||6), seed=Number(args.seed||20261014), cap=3;
assert(Number.isSafeInteger(routes)&&routes>0&&routes<=100);
const phases=['approach','sublocation','depth'];
const profiles=['level1','established','prepared'];
const groups=new Map(),snapshots={},samples=[],changes={},aliases={};
const originalStats=new Map(Object.values(equipmentByName).map(item=>[item,item.stats]));
function runVariant(classId,profile,variant,fn){
  const equipment={...SIMULATION_CONTROL_PROFILES[classId][profile==='level1'?'established':profile].equipment};
  let alias;
  try{
    if(variant.startsWith('attack_extra_')){
      const factor=variant==='attack_extra_75'?0.75:0.5;
      for(const [slot,name] of Object.entries(equipment)){
        if(slot==='mainHand')continue;
        const item=equipmentByName[name];const stats={...item.stats};
        for(const key of ['attack','magAtk']) if(stats[key]>0)stats[key]=Math.round(stats[key]*factor);
        item.stats=stats;
        if(JSON.stringify(stats)!==JSON.stringify(originalStats.get(item)))changes[`${variant}/${name}`]={name,before:originalStats.get(item),after:stats};
      }
    }
    if(variant.startsWith('effect_off_')){
      const slot=variant.slice('effect_off_'.length),name=equipment[slot],source=equipmentByName[name];
      assert(source);
      alias=`SIMULATION_SINGLE:${name}`; assert(!equipmentByName[alias]);aliases[alias]=name;
      equipmentByName[alias]={name:alias,...Object.fromEntries(['class','type','weaponType','hands','magicSchool','stats','inventorySlotBonuses'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]))};
      equipment[slot]=alias;
    }
    const player=resolveSimulationPlayerProfile({classId,profile:profile==='level1'?'bare_base':profile,equipment,relicLevel:1,consumables:[]}).player;
    const snapshot=snapshotSimulationPlayer(player);
    assert.equal(snapshot.classProgression.classLevel,profile==='level1'?1:profile==='established'?4:9);
    assert.equal(snapshot.relic.level,1);assert.equal(snapshot.consumables.length,0);
    if(variant.startsWith('effect_off_'))assert.deepStrictEqual(snapshot.derivedStats,snapshots[`${classId}/${profile}/baseline`].derivedStats);
    snapshots[`${classId}/${profile}/${variant}`]=snapshot;
    return fn(player);
  }finally{
    for(const [item,stats] of originalStats)item.stats=stats;
    if(alias)delete equipmentByName[alias];
  }
}

let found;
outer:for(const location of ['goblin','fungal','deserter'])for(let i=0;i<6;i++){
 const route=createHexCraftingRoute({location,seed:deriveSimulationSeed(20261014,i)});
 const cells=route.route.filter(c=>c.phase==='depth'&&c.enemies.length).sort((a,b)=>deriveSimulationSeed(a.seed,77)-deriveSimulationSeed(b.seed,77)).slice(0,3);
 for(const cell of cells){
  const run=variant=>runVariant('Mage','established',variant,player=>{
   Object.assign(player,{hp:player.maxHp,abyssLevel:1,currentLocation:route.location.name,activeExpeditionZone:cell.phase,activeSublocationId:cell.sublocationId,activeSublocationEffectId:cell.effectId||null});
   const r=simulateCombat({player,enemies:cell.enemies,location,seed:cell.seed,policy:'competent',verbose:true,debugDecisions:true});
   return {outcome:r.outcome,endingHp:r.endingPlayerHp,stats:r.profile.derivedStats,trace:r.trace,decisions:r.decisionDiagnostics};
  });
  const base=run('baseline'),reduced=run('attack_extra_75');
  if(base.outcome==='defeat'&&reduced.outcome==='victory'){found={location,seed:cell.seed,enemies:cell.enemies.map(e=>e.name),base,reduced};break outer;}
 }
}
assert(found);fs.writeFileSync('docs/simulation/targeted-policy-counterexample-20261014.json',JSON.stringify(found,null,2)+'\n');
process.stdout.write(JSON.stringify({location:found.location,seed:found.seed,enemies:found.enemies,base:found.base.stats,reduced:found.reduced.stats,before:found.base.trace.map(t=>[t.abilityId,t.target,t.hp]),after:found.reduced.trace.map(t=>[t.abilityId,t.target,t.hp])},null,2));
