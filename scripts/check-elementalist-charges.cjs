// Run this same harness against each checkout: node scripts/check-elementalist-charges.cjs <repo-root> <output.json>
process.env.BABEL_ENV='test';process.env.NODE_ENV='test';
const fs=require('fs'),path=require('path'),assert=require('assert'),babel=require('@babel/core');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const loader=require.extensions['.js'];
require.extensions['.js']=(m,f)=>{if(!f.startsWith(root+path.sep+'src'+path.sep))return loader(m,f);m._compile(babel.transformFileSync(f,{babelrc:false,configFile:false,presets:[require.resolve('babel-preset-react-app')]}).code,f);};
const get=p=>require(path.join(root,'src',p));
const {simulateCombat}=get('utils/combatSimulator');
const {createHexCraftingRoute}=get('utils/hexCraftingSimulator');
const {resolveSimulationPlayerProfile,snapshotSimulationPlayer}=get('utils/simulationPlayerProfiles');
const {createAbilityByName}=get('data/abilityPresets');
const {selectClassTalent}=get('data/classProgression');
const {enemies}=get('data/enemies');
const encounters=[];
for(const location of ['goblin','fungal','deserter']){
 const route=createHexCraftingRoute({location,seed:20261016});
 for(const phase of ['approach','sublocation','depth'])for(const c of route.route.filter(c=>c.phase===phase&&c.enemies.length).slice(0,2))encounters.push({phase,location:route.location.name,seed:c.seed,enemies:c.enemies,effectId:c.effectId,sublocationId:c.sublocationId});
}
for(const name of ['Троглодит-мицелий (босс)','Мастер клинков','Архонт Цветения'])for(const seed of [1601,1602,1603]){
 const e=enemies.find(e=>e.name===name);assert(e);encounters.push({phase:'boss',location:e.location,seed,enemies:[e]});
}
const builds=[
 {id:'L4 mixed',profile:'established',activeIds:['fireball','chain_lightning','ice_lance','frost_shield']},
 {id:'L9 mixed summon',profile:'prepared',activeIds:['fireball','chain_lightning','frost_shield','elemental']},
 {id:'L9 ice summon',profile:'prepared',activeIds:['ice_lance','blizzard','frost_shield','elemental'],talent:'mage.summon_elemental.ice'},
];
const out={conditions:'Selected encounters; fresh full health, equipment from the control profile, relic I, no consumables, no altars, no route attrition. One equipped passive: Elemental Shell. Not an estimate of player win rate.',snapshots:{},results:[]};
for(const build of builds){
 const p=resolveSimulationPlayerProfile({classId:'Mage',profile:build.profile,activeIds:build.activeIds,passiveIds:['elemental_shell'],consumables:[],relicLevel:1}).player;
 if(build.talent){const t=selectClassTalent(p.classProgression,'Mage','mage.summon_elemental',build.talent,{location:'guild'});assert(t.success);p.classProgression=t.progression;}
 // Include the innate in both engines: the old simulator's explicit loadout omits it.
 p.abilities.push(createAbilityByName('Стихийный хаос'));p.abilityNames=p.abilities.map(a=>a.name);
 out.snapshots[build.id]=snapshotSimulationPlayer(p);
 for(const [index,e]of encounters.entries()){
  const player={...p,hp:p.maxHp,abyssLevel:e.enemies.some(x=>x.name==='Архонт Цветения')?2:1,currentLocation:e.location,activeExpeditionZone:e.phase==='boss'?null:e.phase,activeSublocationId:e.sublocationId||null,activeSublocationEffectId:e.effectId||null};
  const r=simulateCombat({player,enemies:e.enemies,seed:e.seed,policy:'competent',verbose:true});assert(!r.abnormal,build.id+'/'+index);
  out.results.push({build:build.id,index,phase:e.phase,composition:e.enemies.map(x=>x.name).join(' + '),seed:e.seed,outcome:r.outcome,playerTurns:r.playerTurns,enemyTurns:r.enemyTurns,hpLoss:100-r.endingPlayerHpPercentage,charges:r.classMetrics.elementalChargeTriggers||null,usage:r.abilityUsage,trace:r.trace});
 }
 process.stderr.write(build.id+' completed\n');
}
fs.mkdirSync(path.dirname(path.resolve(process.argv[3])),{recursive:true});fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2));
console.log(out.results.length+' fights');
