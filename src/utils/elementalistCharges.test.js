import { createAbilityByName } from '../data/abilityPresets';
import { getElementalChargeSchool } from '../data/elementalCharges';
import { initCombatSession, performPlayerAction, processEnemyAI } from './combatUtils';
import { addEffect, getEffectStackCount, setEffectStackCount, removeRandomPositiveEffect, countUniqueActiveBuffs } from './effects';

const spell = (school, extra = {}) => ({ name: school, school, cooldown: 0, damage: 1, type: 'magical', alwaysHits: true, ...extra });
const foe = id => ({ id, name: id, hp: 10000, maxHp: 10000, magAtk: 0, attack: 0, physDef: 0, magicDef: 0, speed: 1, abilities: [] });
const setup = (extra = {}, abilities = ['fire', 'ice', 'lightning'].map(s => spell(s))) => initCombatSession({
  id: 'hero', name: 'Mage', class: 'Mage', hp: 200, maxHp: 200, magAtk: 100, attack: 1,
  physDef: 0, magicDef: 0, speed: 100, critChance: 0, equippedClassPassiveIds: [], abilities, ...extra,
}, [foe('first'), foe('second')], { rng: () => 0.99 });
const count = (s, school) => getEffectStackCount(s.state.players[0], `elemental_charge_${school}`);
const cast = (s, name) => {
  s.state.initiative.playerReady = true;
  s.state.players[0].abilities.forEach(a => { a.currentCooldown = 0; });
  return performPlayerAction(s, name, 0);
};

test('two casts of a school trigger once; intervening schools retain independent progress', () => {
  const s = setup(); const p = s.state.players[0];
  cast(s, 'fire'); cast(s, 'ice'); cast(s, 'lightning');
  expect(['fire','ice','lightning'].map(k => count(s,k))).toEqual([1,1,1]);
  const hp = s.state.enemies.map(e => e.hp);
  cast(s, 'fire');
  expect(s.state.enemies.map((e,i) => hp[i]-e.hp)).toEqual([76,75]);
  expect(['fire','ice','lightning'].map(k => count(s,k))).toEqual([0,1,1]);
  expect(p._elementalChargeTriggers).toEqual({ fire:1,ice:0,lightning:0 });
  p.turnMeter = 0; cast(s,'lightning'); expect(p.turnMeter).toBe(300);
  cast(s,'ice'); expect(p.shield).toBe(40);
  expect(p.effects.find(e => e.id === 'shield').remainingTurns).toBe(2);
});

test('AoE and multihits give only one charge per application', () => {
  const s = setup({}, [spell('fire',{targeting:'allEnemies',hits:3})]);
  cast(s,'fire'); expect(count(s,'fire')).toBe(1);
  cast(s,'fire'); expect(s.state.players[0]._elementalChargeTriggers.fire).toBe(1);
});

test('basic attacks do not charge even with an elemental school', () => {
  const s = setup({},[spell('fire',{basic:true})]);
  cast(s,'fire'); expect(count(s,'fire')).toBe(0);
});

test('Frost Shield charges Ice and both shields coexist on the trigger', () => {
  const s = setup({}, [spell('ice'),createAbilityByName('Морозный щит')]);
  cast(s,'ice'); cast(s,'Морозный щит');
  expect(s.state.players[0].shield).toBe(165); // 25 + MA + 20% max health.
  expect(count(s,'ice')).toBe(0);
});

test.each(['fire','ice','lightning'])('summon of %s counts and can trigger that school', school => {
  const talent = school === 'fire' ? 'mage.summon_elemental.greater_fire' : `mage.summon_elemental.${school}`;
  const s=setup({classProgression:{Mage:{talentSelections:{'mage.summon_elemental':talent}}}},[spell(school),createAbilityByName('Призыв элементаля')]);
  cast(s,school);cast(s,'Призыв элементаля');
  expect(s.state.players.filter(p=>p.elementalistElemental)).toHaveLength(1);
  expect(s.state.players[0]._elementalChargeTriggers[school]).toBe(1);
  expect(count(s,school)).toBe(0);
  // Cannot summon again while it is alive; a rejected action earns nothing.
  cast(s,'Призыв элементаля');expect(count(s,school)).toBe(0);
  processEnemyAI(s);
  expect(count(s,school)).toBe(0);
});

test('failed summon earns no charge',()=>{
 const s=setup({},[createAbilityByName('Призыв элементаля')]);
 s.summonPlayer=()=>({success:false});cast(s,'Призыв элементаля');expect(count(s,'fire')).toBe(0);
});

test.each(['fire','ice','lightning'])('Echo counts the resolved %s school',school=>{
 const s=setup({},[spell(school),createAbilityByName('Стихийное эхо')]);
 cast(s,school);cast(s,'Стихийное эхо');
 expect(s.state.players[0]._elementalChargeTriggers[school]).toBe(1);
});

test('legacy Chaos save entry no longer adds random effects or consumes enemy statuses',()=>{
 const s=setup({abilityNames:['Стихийный хаос']},[createAbilityByName('Стихийный хаос'),spell('fire',{effect:{id:'burn',duration:2}})]);
 const target=s.state.enemies[0]; const p=s.state.players[0];
 addEffect(target,{id:'charge'},()=>{},p,{session:s});
 addEffect(target,{id:'shock',duration:3},()=>{},p,{session:s});
 cast(s,'fire');
 expect(getEffectStackCount(target,'charge')).toBe(1);
 expect(target.effects.some(e=>e.id==='shock')).toBe(true);
 expect(target.effects.some(e=>e.id==='freeze')).toBe(false);
 expect(s.state.log.some(l=>l.includes('Реакция стихий'))).toBe(false);
});

test('charge resource cannot be dispelled or counted as a buff, and resets for new combat',()=>{
 const s=setup();cast(s,'fire');const p=s.state.players[0];
 expect(countUniqueActiveBuffs(p)).toBe(0);
 expect(removeRandomPositiveEffect(p,()=>{},()=>0)).toBeNull();
 expect(count(s,'fire')).toBe(1);
 const next=initCombatSession(p,[foe('next')]);expect(count(next,'fire')).toBe(0);
 expect(next.state.players[0]._elementalChargeTriggers.fire).toBe(0);
});

test('Elemental Shell triggers once and adds to the Ice shield',()=>{
 const s=setup({equippedClassPassiveIds:['elemental_shell']});
 cast(s,'ice');expect(s.state.players[0].shield).toBe(0);
 cast(s,'ice');expect(s.state.players[0].shield).toBe(60);
});

test('only an Elementalist gains charges and skipped stunned actions do not charge',()=>{
 const other=setup({class:'Archer'});cast(other,'fire');expect(count(other,'fire')).toBe(0);
 const s=setup();addEffect(s.state.players[0],{id:'stun',duration:1},()=>{},s.state.enemies[0],{session:s});cast(s,'fire');expect(count(s,'fire')).toBe(0);
});

test('a lightning trigger respects the turn-meter cap',()=>{
 const s=setup();setEffectStackCount(s.state.players[0],'elemental_charge_lightning',1);
 s.state.players[0].turnMeter=900;cast(s,'lightning');expect(s.state.players[0].turnMeter).toBe(1000);
});

test('resolver is pure for a summon and defaults to Fire without a talent',()=>{
 const ability=createAbilityByName('Призыв элементаля');const p={};
 expect(getElementalChargeSchool(ability,p)).toBe('fire');expect(p).toEqual({});
});
