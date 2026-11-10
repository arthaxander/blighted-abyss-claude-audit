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
const groups=new Map(),snapshots={},samples=[];
const catalogChanges = require('../docs/simulation/equipment-primary-stat-changes-20261014.json');
for (const change of catalogChanges) assert.deepStrictEqual(equipmentByName[change.name].stats, change.after, `Catalog drift: ${change.name}`);
const originalStats=new Map(Object.values(equipmentByName).map(item=>[item,item.stats]));
function runVariant(classId,profile,variant,fn){
  const equipment={...SIMULATION_CONTROL_PROFILES[classId][profile==='level1'?'established':profile].equipment};
  try{
    if (variant === 'before') {
      for (const item of Object.values(equipmentByName)) {
        const change = catalogChanges.find(entry => entry.name === (item.canonicalName || item.name));
        if (change) item.stats = change.before;
      }
    }
    const player=resolveSimulationPlayerProfile({classId,profile:profile==='level1'?'bare_base':profile,equipment,relicLevel:1,consumables:[]}).player;
    const snapshot=snapshotSimulationPlayer(player);
    assert.equal(snapshot.classProgression.classLevel,profile==='level1'?1:profile==='established'?4:9);
    assert.equal(snapshot.relic.level,1);assert.equal(snapshot.consumables.length,0);
    snapshots[`${classId}/${profile}/${variant}`]=snapshot;
    return fn(player);
  }finally{
    for(const [item,stats] of originalStats)item.stats=stats;
  }
}
for(const location of ['goblin','fungal','deserter'])for(let i=0;i<routes;i++){
  const routeSeed=deriveSimulationSeed(seed,i),route=createHexCraftingRoute({location,seed:routeSeed});
  const cells=phases.flatMap(phase=>route.route.filter(c=>c.phase===phase&&c.enemies.length).sort((a,b)=>deriveSimulationSeed(a.seed,77)-deriveSimulationSeed(b.seed,77)).slice(0,cap));
  for(const cell of cells){
    samples.push({location,routeSeed,cellId:cell.cellId,phase:cell.phase,seed:cell.seed,effectId:cell.effectId,sublocationId:cell.sublocationId,enemies:cell.enemies.map(e=>({name:e.name,hp:e.hp,attack:e.attack,speed:e.speed}))});
    for(const classId of ['Defender','Mage','Archer'])for(const profile of profiles){
      const equipment=SIMULATION_CONTROL_PROFILES[classId][profile==='level1'?'established':profile].equipment;
      const variants=['before','after'];
      for(const variant of variants)runVariant(classId,profile,variant,player=>{
        player.hp=player.maxHp;player.abyssLevel=1;player.currentLocation=route.location.name;
        player.activeExpeditionZone=cell.phase;player.activeSublocationId=cell.sublocationId;player.activeSublocationEffectId=cell.effectId||null;
        const r=simulateCombat({player,enemies:cell.enemies,location,seed:cell.seed,policy:'competent'});
        assert(!r.abnormal,`${location}/${classId}/${profile}/${variant}/${cell.seed}`);
        const key=[location,cell.phase,classId,profile,variant].join('/');
        if(!groups.has(key))groups.set(key,{location,phase:cell.phase,classId,profile,variant,n:0,wins:0,hpLoss:0,turns:0,enemyTurns:0});
        const g=groups.get(key);g.n++;g.wins+=r.outcome==='victory';g.hpLoss+=100-r.endingPlayerHpPercentage;g.turns+=r.playerTurns;g.enemyTurns+=r.enemyTurns;
      });
    }
  }
  process.stderr.write(`${location}: ${i+1}/${routes} maps\n`);
}
for(const [item,stats]of originalStats)assert.strictEqual(item.stats,stats);
const report={sourceCommit:'960969651b1145001ea5373cb41046046070d213',seed,routesPerLocation:routes,maxFightsPerPhasePerMap:cap,phases,profiles,snapshots,samples,
  model:'Paired full-health fights sampled by deterministic seed order from legal hex routes; all candidates face identical encounters. All positive equipment attack/magAtk/maxHp reduced by 25%, rounded to nearest integer, including weapons. Before values restored from committed change manifest. All effects unchanged.',
  limits:['Small screening sample, not final balance calibration or human win rates','No attrition, loot, crafting, consumables, altar benefits, or in-run progression','L1/L4/L9 fixed builds and equipment; no assertion that every build should win every phase','Depth uses authored Abyss Power; current sublocation effects passed to combat','Correlated map samples and diverging random draw sequences; no confidence intervals claimed'],
  groups:[...groups.values()].map(g=>({...g,winRate:100*g.wins/g.n,meanHpLoss:g.hpLoss/g.n,meanTurns:g.turns/g.n}))};
const output=path.resolve(args.output||'docs/simulation/equipment-primary-stat-screen-20261014.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(`Saved ${report.groups.reduce((sum,g)=>sum+g.n,0)} combats, ${samples.length} encounters to ${output}\n`);
