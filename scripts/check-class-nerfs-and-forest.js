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



const assert=require('assert');
const {createHexCraftingRoute}=require('../src/utils/hexCraftingSimulator');
const {simulateCombat}=require('../src/utils/combatSimulator');
const {resolveSimulationPlayerProfile,snapshotSimulationPlayer}=require('../src/utils/simulationPlayerProfiles');
const {applyEquipmentPatch}=require('../src/utils/equipmentManager');
const balance=require('../src/data/classCombatBalance');
const originalMultiplier=balance.getClassDamageMultiplier;
const {WITHERING_FOREST_NORMAL_TEMPLATES,WITHERING_FOREST_STRONG_TEMPLATES}=require('../src/utils/enemyPools');
const {enemies}=require('../src/data/enemies');
const {deriveSimulationSeed}=require('../src/utils/simulationRng');
const previous=require('../docs/simulation/equipment-tier-tempo-20261014.json');
const encounters=[];
for(const location of ['goblin','fungal','deserter'])for(let i=0;i<3;i++){
 const route=createHexCraftingRoute({location,seed:deriveSimulationSeed(20261014,i)});
 for(const phase of ['approach','sublocation','depth'])for(const c of route.route.filter(x=>x.phase===phase&&x.enemies.length).sort((a,b)=>deriveSimulationSeed(a.seed,77)-deriveSimulationSeed(b.seed,77)).slice(0,3))encounters.push({floor:1,location:route.location.name,phase,seed:c.seed,effectId:c.effectId,sublocationId:c.sublocationId,enemies:c.enemies});
}
const forest=enemies.filter(e=>e.location==='Лес Увядания'&&!e.summonOnly);
const templates=[...WITHERING_FOREST_NORMAL_TEMPLATES.map(t=>({phase:'normal',names:t.names})),...WITHERING_FOREST_STRONG_TEMPLATES.map(t=>({phase:'strong',names:t.names})),...forest.filter(e=>e.cursed||e.boss).map(e=>({phase:e.boss?'boss':'cursed',names:[e.name]}))];
for(const [i,t]of templates.entries())for(let j=0;j<5;j++){
 const roster=t.names.map(name=>forest.find(e=>e.name===name));assert(roster.every(Boolean));
 encounters.push({floor:2,location:'Лес Увядания',phase:t.phase,seed:deriveSimulationSeed(20261014+i,j),enemies:roster});
}
const results=[],snapshots={};
try{
 for(const cls of ['Archer','Defender','Mage'])for(const tier of ['floor1','floor2'])for(const variant of cls==='Mage'?['current']:cls==='Archer'?['before','current']:['current','damage_plus20']){
  balance.getClassDamageMultiplier=(source,options={})=>{
   const exempt=options.bypassDamageModifiers||options.bypassOutgoingModifiers||options.bypassClassDamageMultiplier||source?.summoned;
   if(!exempt&&cls==='Archer'&&variant==='before'&&['Archer','Лучник'].includes(source?.class))return 1;
   // Keep this dated comparison reproducible after the candidate ships.
   if(!exempt&&cls==='Defender'&&['Defender','Защитник'].includes(source?.class))return variant==='damage_plus20'?1.2:1;
   return originalMultiplier(source,options);
  };
  const base=resolveSimulationPlayerProfile({classId:cls,profile:'prepared',equipment:previous.loadouts[cls][tier],relicLevel:1,consumables:[]}).player;
  if(cls==='Archer'&&variant==='before'){
   base.baseStats={...base.baseStats,speed:220};Object.assign(base,applyEquipmentPatch(base,base.equipment,[]));
  }
  snapshots[[cls,tier,variant].join('/')]=snapshotSimulationPlayer(base);
  for(const [encounterId,e]of encounters.entries()){
   const player={...base,hp:base.maxHp,abyssLevel:e.floor,currentLocation:e.location,activeExpeditionZone:e.floor===1?e.phase:null,activeSublocationId:e.sublocationId||null,activeSublocationEffectId:e.effectId||null};
   const r=simulateCombat({player,enemies:e.enemies,seed:e.seed,policy:'competent'});
   results.push({encounterId,classId:cls,tier,variant,outcome:r.outcome,abnormal:r.abnormal,turns:r.playerTurns,enemyTurns:r.enemyTurns,hpLoss:100-r.endingPlayerHpPercentage});
  }
  process.stderr.write(`${cls}/${tier}/${variant} done\n`);
 }
}finally{balance.getClassDamageMultiplier=originalMultiplier;}
const median=a=>{if(!a.length)return null;const x=[...a].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
const grouped=new Map();
for(const r of results){const e=encounters[r.encounterId],key=[e.floor,e.phase,r.classId,r.tier,r.variant].join('/');if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
const groups=[...grouped].map(([key,rs])=>{const [floor,phase,classId,tier,variant]=key.split('/'),wins=rs.filter(r=>r.outcome==='victory');return {floor:Number(floor),phase,classId,tier,variant,n:rs.length,winRate:100*wins.length/rs.length,medianWinTurns:median(wins.map(r=>r.turns)),medianEnemyTurns:median(rs.map(r=>r.enemyTurns)),meanHpLoss:rs.reduce((s,r)=>s+r.hpLoss,0)/rs.length,abnormal:rs.filter(r=>r.abnormal).length};});
const report={baseCommit:'509a7296315a60d0605aa33b15feabaf33f051dd',heroLevel:9,equipmentBalance:'after PR174',snapshots,encounters:encounters.map(e=>({...e,enemies:e.enemies.map(x=>x.name)})),groups,resultColumns:['encounterId','classId','tier','variant','outcome','abnormal','turns','enemyTurns','hpLoss'],results:results.map(r=>[r.encounterId,r.classId,r.tier,r.variant,r.outcome,r.abnormal,r.turns,r.enemyTurns,r.hpLoss]),limits:['Floor 2 is authored Forest normal/strong templates and cursed/boss solos, equally sampled; not a hex route or phase weighting.','Level 9 fixed skill builds, relic I, full health each fight, no consumables, curses, runes or attrition.','Defender +20% damage is a simulator-only candidate; shields unchanged.','Enemy turns are aggregate actor actions, not elapsed time.','Known policy thresholds; these are not human win rates.']};
fs.writeFileSync('docs/simulation/class-nerfs-forest-20261014.json',JSON.stringify(report)+'\n');console.log(`Saved ${results.length} fights; abnormal: ${results.filter(r=>r.abnormal).length}`);
