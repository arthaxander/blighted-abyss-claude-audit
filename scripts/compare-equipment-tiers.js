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
const {COMMON_LEVEL_TWO_EQUIPMENT,LOCATION_LEVEL_TWO_EQUIPMENT}=require('../src/data/levelTwoLootOwnership');
const {COMMON_LEVEL_ONE_EQUIPMENT,LOCATION_LEVEL_ONE_EQUIPMENT}=require('../src/data/levelOneLootOwnership');
const {deriveSimulationSeed}=require('../src/utils/simulationRng');
const changes=require('../docs/simulation/equipment-primary-stat-changes-20261014.json');
for(const change of changes)assert.deepStrictEqual(equipmentByName[change.name].stats,change.after, `Catalog drift: ${change.name}`);
const original=new Map(Object.values(equipmentByName).map(x=>[x,x.stats]));
const tierPools={floor1:new Set([...COMMON_LEVEL_ONE_EQUIPMENT,...Object.values(LOCATION_LEVEL_ONE_EQUIPMENT).flat()]),floor2:new Set([...COMMON_LEVEL_TWO_EQUIPMENT,...Object.values(LOCATION_LEVEL_TWO_EQUIPMENT).flat()])};
const args=Object.fromEntries(process.argv.slice(2).flatMap((v,i,a)=>v.startsWith('--')?[[v.slice(2),a[i+1]]]:[]));
const routes=Number(args.routes||6),seed=20261014;
assert(Number.isInteger(routes)&&routes>0&&routes<=100);
const classes=['Defender','Mage','Archer'],profiles=['established','prepared'];
const phases=['approach','sublocation','depth'];
const loadouts={};
for(const cls of classes){
 const floor1={...SIMULATION_CONTROL_PROFILES[cls].prepared.equipment};
 floor1.ring2='Кольцо Туманного Мха';
 const floor2={...floor1,helmet:'Шлем чужого сигнала',armor:cls==='Defender'?'Кираса последнего в строю':'Покров поздней весны',legs:'Сапоги загонщика',ring1:cls==='Mage'?'Перстень цепкого плюща':'Кольцо чужой смены',ring2:'Перстень живых шрамов',amulet:cls==='Defender'?'Медальон неотпетого':'Амулет горькой росы'};
 floor2.mainHand=cls==='Defender'?'Клинок должника':cls==='Mage'?'Фокус остановленного сока':'Лук вязких жил';
 if(cls==='Defender')floor2.offHand='Щит третьей заплаты';
 if(cls==='Mage')floor2.offHand='Сосуд украденного прилива';
 for(const [tier,gear]of Object.entries({floor1,floor2}))for(const [slot,name]of Object.entries(gear)){
   assert(equipmentByName[name],name);
   if(slot!=='bag')assert(tierPools[tier].has(name),`${tier}: ${name}`);
 }
 assert.deepStrictEqual(Object.keys(floor1).sort(),Object.keys(floor2).sort());
 loadouts[cls]={floor1,weapon2:{...floor1,mainHand:floor2.mainHand},floor2};
}
const snapshots={},players={};
try {
 for(const balance of ['before','after']){
  for(const item of Object.values(equipmentByName)){
   const change=changes.find(c=>c.name===(item.canonicalName||item.name));
   if(change)item.stats=change[balance];
  }
  for(const cls of classes)for(const profile of profiles)for(const tier of ['floor1','weapon2','floor2']){
   const key=[balance,cls,profile,tier].join('/');
   const player=resolveSimulationPlayerProfile({classId:cls,profile,equipment:loadouts[cls][tier],relicLevel:1,consumables:[]}).player;
   // Retain catalog variant during combat below; derived player values can be cached.
   players[key]=player;snapshots[key]=snapshotSimulationPlayer(player);
   for(const [slot,name]of Object.entries(loadouts[cls][tier]))assert.equal(player.equipment[slot],name);
   const control=snapshots[[balance,cls,profile,'floor1'].join('/')];
   assert.deepStrictEqual(snapshots[key].classProgression,control.classProgression);
   assert.deepStrictEqual(player.baseStats,players[[balance,cls,profile,'floor1'].join('/')].baseStats);
  }
 }
} finally {for(const [item,stats]of original)item.stats=stats;}
const fights=[],encounters=[];
for(const location of ['goblin','fungal','deserter'])for(let i=0;i<routes;i++){
 const routeSeed=deriveSimulationSeed(seed,i),route=createHexCraftingRoute({location,seed:routeSeed});
 const cells=phases.flatMap(phase=>route.route.filter(c=>c.phase===phase&&c.enemies.length).sort((a,b)=>deriveSimulationSeed(a.seed,77)-deriveSimulationSeed(b.seed,77)).slice(0,3));
 for(const cell of cells){
  const encounterId=encounters.length;
  encounters.push({location,routeSeed,cellId:cell.cellId,phase:cell.phase,sublocationId:cell.sublocationId,effectId:cell.effectId,seed:cell.seed,enemies:cell.enemies.map(e=>({name:e.name,hp:e.hp,attack:e.attack,speed:e.speed}))});
  for(const balance of ['before','after'])try{
   for(const item of Object.values(equipmentByName)){
    const change=changes.find(c=>c.name===(item.canonicalName||item.name));if(change)item.stats=change[balance];
   }
   for(const cls of classes)for(const profile of profiles)for(const tier of ['floor1','weapon2','floor2']){
    const player={...players[[balance,cls,profile,tier].join('/')]};
    player.hp=player.maxHp;player.abyssLevel=1;player.currentLocation=route.location.name;
    player.activeExpeditionZone=cell.phase;player.activeSublocationId=cell.sublocationId;player.activeSublocationEffectId=cell.effectId||null;
    const r=simulateCombat({player,enemies:cell.enemies,location,seed:cell.seed,policy:'competent'});
    assert(!r.abnormal,`Abnormal: ${encounterId}/${cls}/${profile}/${tier}/${balance}`);
    fights.push({encounterId,balance,classId:cls,profile,tier,outcome:r.outcome,playerTurns:r.playerTurns,enemyTurns:r.enemyTurns,hpLoss:100-r.endingPlayerHpPercentage});
   }
  }finally{for(const [item,stats]of original)item.stats=stats;}
 }
 process.stderr.write(`${location}: ${i+1}/${routes} maps\n`);
}
for(const [item,stats]of original)assert.strictEqual(item.stats,stats);
for(const [key,player]of Object.entries(players))assert.deepStrictEqual(snapshotSimulationPlayer(player),snapshots[key], `Mutated profile: ${key}`);
const median=a=>{if(!a.length)return null;const x=[...a].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
const grouped=new Map();
for(const f of fights){
 const e=encounters[f.encounterId],key=[f.balance,f.classId,f.profile,f.tier,e.phase].join('/');
 if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(f);
}
const groups=[...grouped].map(([key,rows])=>{
 const [balance,classId,profile,tier,phase]=key.split('/'),wins=rows.filter(x=>x.outcome==='victory'),fast=wins.filter(x=>x.playerTurns<=3);
 return {balance,classId,profile,tier,phase,n:rows.length,wins:wins.length,winRate:100*wins.length/rows.length,medianWinTurns:median(wins.map(x=>x.playerTurns)),medianAllTurns:median(rows.map(x=>x.playerTurns)),fastWins:fast.length,fastWinPctAll:100*fast.length/rows.length,fastWinPctVictories:wins.length?100*fast.length/wins.length:null,meanHpLoss:rows.reduce((s,x)=>s+x.hpLoss,0)/rows.length,meanWinHpLoss:wins.length?wins.reduce((s,x)=>s+x.hpLoss,0)/wins.length:null};
});
const report={sourceCommit:'d9c4b47c5f6eb3a7ebcf7fb7a89db871416962fe',seed,routesPerLocation:routes,loadouts,snapshots,encounters,fightColumns:['encounterId','balance','classId','profile','tier','outcome','playerTurns','enemyTurns','hpLoss'],fights:fights.map(f=>[f.encounterId,f.balance,f.classId,f.profile,f.tier,f.outcome,f.playerTurns,f.enemyTurns,f.hpLoss]),groups,limits:['All encounters are on floor 1; floor 2 refers to equipment origin, not tested enemies.','Two fixed hero levels (4/9), identical skills and base stats per comparison; relic I, no consumables/runes/altars.','Three fixed loadouts per class, not optimal builds or exhaustive gear ranking; named effects remain enabled.','Independent full-health fights, no attrition, loot or crafting; excludes bosses.','Medians of victories exclude defeats; fast-win percentages supplied with both all-fight and victory denominators.','Simulator playerTurns counts consumed main actions; free actions are not extra turns.','Known decision-policy thresholds and correlated encounters limit calibration; results are not human win rates.']};
const output=path.resolve(args.output||'docs/simulation/equipment-tier-tempo-20261014.json');
fs.writeFileSync(output,JSON.stringify(report)+'\n');console.log(`Saved ${fights.length} fights / ${encounters.length} encounters: ${output}`);
