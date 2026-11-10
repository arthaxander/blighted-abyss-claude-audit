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
const {simulateCombat}=require('../src/utils/combatSimulator');
const {resolveSimulationPlayerProfile,snapshotSimulationPlayer}=require('../src/utils/simulationPlayerProfiles');
const {deriveSimulationSeed}=require('../src/utils/simulationRng');
const {enemies}=require('../src/data/enemies');
const {addEffect,getEffectStackCount,removeRandomNegativeEffect}=require('../src/utils/effects');
const {loadouts}=require('../docs/simulation/equipment-tier-tempo-20261014.json');
const boss=enemies.find(e=>e.name==='Архонт Цветения');assert(boss);
const builds={
 Defender:{reference:['endurance','shockwave','ram','shield_throw'],bleed:['endurance','blood_ram','ram','shield_throw'],guard:['endurance','blood_ram','shield_throw','blood_challenge']},
 Archer:{reference:['serrated_arrow','wolf_pit','redirect','arrow_volley'],single:['serrated_arrow','fire_arrow','finishing_shot','quick_intercept'],defensive:['serrated_arrow','fire_arrow','redirect','quick_intercept']}
};
const supplies={heal:[{id:'Зелье здоровья',quantity:3}],mixed:[{id:'Зелье здоровья',quantity:3},{id:'Малое зелье очищения',quantity:3}],cleanse:[{id:'Малое зелье очищения',quantity:6}]};
// Deterministic production-cleanse probes: one selected debuff type with all its removable charges.
const probes=[];
for(const id of ['entanglement','archon_bud']) {
 const target={hp:100,maxHp:100,speed:100,effects:[]};addEffect(target,{id,stacks:id==='entanglement'?5:1,extra:{remainingSourceTurns:2}},()=>{},boss);
 const before=target.effects.map(e=>e.id);const removed=removeRandomNegativeEffect(target,()=>0,()=>{});
 assert.equal(removed?.id,id);assert.equal(getEffectStackCount(target,id),0);
 probes.push({id,before,remaining:target.effects.map(e=>e.id),remainingStacks:getEffectStackCount(target,id)});
}
const results=[],snapshots={};
for(const [classId,variants]of Object.entries(builds)) for(const [build,activeIds]of Object.entries(variants)) for(const [supply,consumables]of Object.entries(supplies)) {
 const player=resolveSimulationPlayerProfile({classId,profile:'prepared',equipment:loadouts[classId].floor2,relicLevel:1,activeIds,consumables}).player;
 player.abyssLevel=2;player.currentLocation='Лес Увядания';snapshots[`${classId}/${build}/${supply}`]=snapshotSimulationPlayer(player);
 assert.equal(player.classProgression[classId].classLevel,9);
 for(let i=0;i<20;i++) {
  const seed=deriveSimulationSeed(20261015,i);
  const r=simulateCombat({player,enemies:[boss],seed,policy:'competent',verbose:true});assert(!r.abnormal,`${classId}/${build}/${supply}/${seed}`);
  results.push({classId,build,supply,seed,outcome:r.outcome,playerTurns:r.playerTurns,enemyTurns:r.enemyTurns,endingHp:r.endingPlayerHpPercentage,bossHp:boss.hp-r.playerDamageDealt,abilityUsage:r.abilityUsage,used:r.consumableUsage,cleanses:r.trace.filter(t=>t.itemId==='Малое зелье очищения').map(t=>({turn:t.turn,lines:t.lines})),death:r.lethalWindow,healingAtDeath:r.healingAtDeath});
 }
 process.stderr.write(`${classId}/${build}/${supply} done\n`);
}
// Causal probe only: keep AI, cooldown, stack consumption and turn-meter gain, suppress healing callback.
const healingProbe=[];
for(const [classId,build]of [['Defender','reference'],['Archer','defensive']]) for(let i=0;i<20;i++) {
 let suppressedHealingCalls=0;
 const experimentalBoss={...boss,abilities:boss.abilities.map(a=>a.name==='Цветение жизни'?{...a,apply:ctx=>a.apply({...ctx,heal:()=>{suppressedHealingCalls++;}})}:a)};
 const player=resolveSimulationPlayerProfile({classId,profile:'prepared',equipment:loadouts[classId].floor2,relicLevel:1,activeIds:builds[classId][build],consumables:supplies.heal}).player;
 player.abyssLevel=2;player.currentLocation='Лес Увядания';
 const seed=deriveSimulationSeed(20261015,i),r=simulateCombat({player,enemies:[experimentalBoss],seed,policy:'competent'});
 assert(!r.abnormal);assert(suppressedHealingCalls>0,'Healing override must actually run');
 healingProbe.push({classId,build,seed,outcome:r.outcome,bossHp:boss.hp-r.playerDamageDealt,playerTurns:r.playerTurns,suppressedHealingCalls});
}
const report={baseCommit:'2e3b0f20c130ca3cc425fcea5d7e37bf9c34f46f',bossStats:{hp:boss.hp,attack:boss.attack,magAtk:boss.magAtk},heroLevel:9,seeds:20,builds,supplies,probes,snapshots,results,healingProbe,limits:['Fixed legal L9 builds, relic I, full HP, floor-II gear; no selected talents, altars, meta or progression changes.','Competent policy has no dedicated Archon mechanic evaluator. This is a bounded build/consumable screen, not optimized play or a proof of attainability.','Cleanse removes a random eligible debuff type with all its charges; it cannot target Entanglement while other debuffs are present.','heal is 3 items; mixed and cleanse are 6. Mixed vs cleanse holds count, not effect value or cost, constant.','Archon HP 2500 to 2250; attack 43 to 34 (rounded); magAtk 30 to 24. No Mage changes.']};
fs.writeFileSync('docs/simulation/archon-stat-nerf-20261015.json',JSON.stringify(report)+'\n');
fs.writeFileSync('docs/simulation/archon-stat-nerf-20261015.json.gz',require('zlib').gzipSync(JSON.stringify(report)+'\n'));console.log(`Saved ${results.length} fights and ${healingProbe.length} healing probes`);
