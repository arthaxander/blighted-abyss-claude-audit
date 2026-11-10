// Reproduce: node scripts/check-class-parity.cjs [output.json]
// Timing instrumentation changes only an in-memory copy, never gameplay source.
process.env.BABEL_ENV='test';process.env.NODE_ENV='test';
const fs=require('fs'),path=require('path'),assert=require('assert'),babel=require('@babel/core');
const probe=process.argv.includes('--probe');
const root=path.resolve(__dirname,'..'),loader=require.extensions['.js'];
require.extensions['.js']=(m,f)=>{
 if(!f.startsWith(root+path.sep+'src'+path.sep))return loader(m,f);
 let source=fs.readFileSync(f,'utf8');
 if(f.endsWith('/utils/combatUtils.js')){
  const marker='function incrementTurnMeters(units, session) {';
  assert.equal(source.split(marker).length,2);
  source=source.replace(marker,marker+' global.__parityTicks = (global.__parityTicks || 0) + 1;');
 }
 if(f.endsWith('/utils/combatSimulator.js')){
  const marker="  if (!actions.length) return null;";
  assert.equal(source.split(marker).length,2);
  source=source.replace(marker,marker+" if (global.__parityOpening) { const opening = actions.find(a => a.ability?.artId === global.__parityOpening); global.__parityOpening = null; if (opening) return opening; }");
 }
 m._compile(babel.transformSync(source,{filename:f,babelrc:false,configFile:false,presets:[require.resolve('babel-preset-react-app')]}).code,f);
};
const {simulateCombat}=require('../src/utils/combatSimulator');
const {createHexCraftingRoute}=require('../src/utils/hexCraftingSimulator');
const {resolveSimulationPlayerProfile,snapshotSimulationPlayer}=require('../src/utils/simulationPlayerProfiles');
const {CLASS_PROGRESSION_DEFINITIONS,selectClassTalent,getPassiveSlotCount}=require('../src/data/classProgression');
const {CLASS_TALENT_SETS}=require('../src/data/classTalents.mjs');
const gear={"Defender": {"floor1": {"helmet": "Красный Колпак Старшего Крысолова", "armor": "Куртка Мародёра", "legs": "Сапоги перебежчика", "mainHand": "Булава Старого Сотника", "offHand": "Щит Дозорного Гильдии", "ring1": "Железное Кольцо Караульного", "amulet": "Амулет Крысиной Жилы", "bag": "Походная сумка Гильдии", "ring2": "Кольцо Туманного Мха"}, "weapon2": {"helmet": "Красный Колпак Старшего Крысолова", "armor": "Куртка Мародёра", "legs": "Сапоги перебежчика", "mainHand": "Клинок должника", "offHand": "Щит Дозорного Гильдии", "ring1": "Железное Кольцо Караульного", "amulet": "Амулет Крысиной Жилы", "bag": "Походная сумка Гильдии", "ring2": "Кольцо Туманного Мха"}, "floor2": {"helmet": "Шлем чужого сигнала", "armor": "Кираса последнего в строю", "legs": "Сапоги загонщика", "mainHand": "Клинок должника", "offHand": "Щит третьей заплаты", "ring1": "Кольцо чужой смены", "amulet": "Медальон неотпетого", "bag": "Походная сумка Гильдии", "ring2": "Перстень живых шрамов"}}, "Mage": {"floor1": {"helmet": "Капюшон Искателя Знаков", "armor": "Мантия Погасшего Костра", "legs": "Сапоги перебежчика", "mainHand": "Фокус Ледяного Спора", "offHand": "Полевой гримуар Отступника", "ring1": "Кольцо Переменчивой Искры", "amulet": "Амулет Трёх Искр", "bag": "Походная сумка Гильдии", "ring2": "Кольцо Туманного Мха"}, "weapon2": {"helmet": "Капюшон Искателя Знаков", "armor": "Мантия Погасшего Костра", "legs": "Сапоги перебежчика", "mainHand": "Фокус остановленного сока", "offHand": "Полевой гримуар Отступника", "ring1": "Кольцо Переменчивой Искры", "amulet": "Амулет Трёх Искр", "bag": "Походная сумка Гильдии", "ring2": "Кольцо Туманного Мха"}, "floor2": {"helmet": "Шлем чужого сигнала", "armor": "Покров поздней весны", "legs": "Сапоги загонщика", "mainHand": "Фокус остановленного сока", "offHand": "Сосуд украденного прилива", "ring1": "Перстень цепкого плюща", "amulet": "Амулет горькой росы", "bag": "Походная сумка Гильдии", "ring2": "Перстень живых шрамов"}}, "Archer": {"floor1": {"helmet": "Капюшон Следопыта", "armor": "Плащ разведчика", "legs": "Крысиные обмотки", "mainHand": "Лук Спороносца", "ring1": "Кольцо Меткой Тетивы", "amulet": "Амулет Крысиной Жилы", "bag": "Походная сумка Гильдии", "ring2": "Кольцо Туманного Мха"}, "weapon2": {"helmet": "Капюшон Следопыта", "armor": "Плащ разведчика", "legs": "Крысиные обмотки", "mainHand": "Лук вязких жил", "ring1": "Кольцо Меткой Тетивы", "amulet": "Амулет Крысиной Жилы", "bag": "Походная сумка Гильдии", "ring2": "Кольцо Туманного Мха"}, "floor2": {"helmet": "Шлем чужого сигнала", "armor": "Покров поздней весны", "legs": "Сапоги загонщика", "mainHand": "Лук вязких жил", "ring1": "Кольцо чужой смены", "amulet": "Амулет горькой росы", "bag": "Походная сумка Гильдии", "ring2": "Перстень живых шрамов"}}};
const builds={
 Defender:[
 {id:'bleed',a4:['endurance','blood_ram','shield_bash','shockwave'],a9:['endurance','blood_ram','ram','shield_throw'],p:['blood_pressure','last_stand']},
 {id:'counter',a4:['endurance','blood_ram','shield_bash','shockwave'],a9:['endurance','blood_ram','shockwave','shield_throw'],p:['retaliatory_assault','last_stand']}],
 Archer:[
 {id:'direct',a4:['serrated_arrow','fire_arrow','finishing_shot','quick_intercept'],a9:['serrated_arrow','fire_arrow','finishing_shot','quick_intercept'],p:['initiative','finish_the_prey']},
 {id:'trap',a4:['serrated_arrow','fire_arrow','quick_intercept','wolf_pit'],a9:['serrated_arrow','wolf_pit','redirect','arrow_volley'],p:['initiative','hunting_rhythm']}],
 Mage:[
 {id:'mixed',a4:['fireball','chain_lightning','ice_lance','frost_shield'],a9:['fireball','chain_lightning','frost_shield','elemental'],p:['elemental_shell','lightning_speed']},
 {id:'ice',a4:['fireball','ice_lance','blizzard','frost_shield'],a9:['ice_lance','blizzard','frost_shield','elemental'],p:['elemental_shell','elemental_resonance']}]
};
const encounters=[];
for(const location of ['goblin','fungal','deserter'])for(const mapSeed of [20261016,20261017,20261018]){
 const route=createHexCraftingRoute({location,seed:mapSeed});
 for(const phase of ['approach','sublocation','depth']){
  const cells=route.route.filter(c=>c.phase===phase&&c.enemies.length).slice(0,2);
  assert.equal(cells.length,2);
  for(const c of cells)encounters.push({...c,location:route.location.name,mapSeed});
 }
}
const out={probe,revision:'55108268c1b2362007c9bf25ba4a531b6d4dd2c9',builds,snapshots:{},encounters:encounters.map(e=>({phase:e.phase,location:e.location,mapSeed:e.mapSeed,seed:e.seed,effectId:e.effectId,composition:e.enemies.map(x=>x.name)})),results:[]};
for(const level of [4,9])for(const [classId,variants]of Object.entries(builds))for(const b of variants){
 if(probe && (level!==9||classId!=='Mage'))continue;
 const id=level+'/'+classId+'/'+b.id;
 const passiveIds=b.p.slice(0,getPassiveSlotCount(classId,level));
 for(const p of passiveIds)assert(CLASS_PROGRESSION_DEFINITIONS[classId].passiveSkills.find(x=>x.id===p&&x.requiredLevel<=level),'illegal passive '+p);
 const p=resolveSimulationPlayerProfile({classId,profile:level===4?'established':'prepared',equipment:level===9?gear[classId].floor1:undefined,activeIds:b['a'+level],passiveIds,relicLevel:1,consumables:[{id:'Малое зелье здоровья',quantity:2},{id:'Малое зелье очищения',quantity:2}]}).player;
 for(const t of CLASS_TALENT_SETS.filter(t=>t.classId===classId&&t.requiredLevel<=level)){
  let talent=t.talents[0];
  if(classId==='Mage'&&b.id==='ice'&&t.abilityId==='mage.summon_elemental')talent=t.talents.find(x=>x.id.endsWith('.ice'));
  const result=selectClassTalent(p.classProgression,classId,t.abilityId,talent.id,{location:'guild'});assert(result.success,result.reason);p.classProgression=result.progression;
 }
 out.snapshots[id]=snapshotSimulationPlayer(p);
 for(const [index,e]of encounters.entries()){
  if(probe && ![22,28].includes(index))continue;
  global.__parityOpening=probe?'elemental':null;
  global.__parityTicks=0;
  const r=simulateCombat({player:{...p,hp:p.maxHp,abyssLevel:1,currentLocation:e.location,activeExpeditionZone:e.phase,activeSublocationId:e.sublocationId||null,activeSublocationEffectId:e.effectId||null},enemies:e.enemies,seed:e.seed,policy:'competent',verbose:true});
  assert(!r.abnormal,id+'/'+index);assert(global.__parityTicks>0);
  out.results.push({id,level,classId,build:b.id,index,phase:e.phase,location:e.location,win:r.outcome==='victory',ticks:global.__parityTicks,hp:r.endingPlayerHpPercentage,items:r.consumableUses,usage:r.abilityUsage,playerTurns:r.playerTurns,enemyTurns:r.enemyTurns,death:r.healingAtDeath,trace:r.trace,charges:r.classMetrics.elementalChargeTriggers});
 }
 process.stderr.write(id+' completed\n');
}
fs.writeFileSync(process.argv[2]||'docs/simulation/class-parity-20261016.json',JSON.stringify(out));
console.log(out.results.length+' fights');
