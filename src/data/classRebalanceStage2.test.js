import { CLASS_PROGRESSION_DEFINITIONS, CLASS_XP_THRESHOLDS, applyClassProgressionStats, ensureClassProgression, getClassLevelForXp, getClassStatsForLevel, getPassiveSlotCount, grantClassExperience, selectClassTalent } from './classProgression';
import * as classTalents from './classTalents.mjs';
const { CLASS_TALENT_SETS, createReadyTalentFixture } = classTalents;

test('all twenty XP thresholds have exact lower boundaries',()=>{
 expect(CLASS_XP_THRESHOLDS).toHaveLength(20);
 CLASS_XP_THRESHOLDS.forEach((threshold,index)=>{expect(getClassLevelForXp(threshold)).toBe(index+1);if(index>0)expect(getClassLevelForXp(threshold-1)).toBe(index)});
 expect(getClassLevelForXp(999999)).toBe(20);
});
test('canonical level twenty stats match all three tables',()=>{
 expect(getClassStatsForLevel('Defender',20)).toEqual({maxHp:220,attack:20,magAtk:0,physDef:24,magicDef:5,speed:115,critChance:.05,critDamage:.35,dodge:0});
 expect(getClassStatsForLevel('Mage',20)).toEqual({maxHp:137,attack:8,magAtk:25,physDef:5,magicDef:6,speed:125,critChance:.1,critDamage:.5,dodge:0});
 expect(getClassStatsForLevel('Archer',20)).toEqual({maxHp:147,attack:19,magAtk:0,physDef:6,magicDef:5,speed:176,critChance:.1,critDamage:.5,dodge:0});
});
test('derived stats are idempotent and passive slots unlock at 2 and 6',()=>{
 const progression=grantClassExperience({},'Defender',CLASS_XP_THRESHOLDS[19]).progression;
 const player={class:'Defender',maxHp:230,hp:230,attack:13,magAtk:0,physDef:20,magicDef:0,speed:115,critChance:.05,critDamage:.35,dodge:0,baseStats:getClassStatsForLevel('Defender',1)};
 const once=applyClassProgressionStats(player,progression); const twice=applyClassProgressionStats(once,progression);
 expect(twice).toEqual(once);expect(once).toMatchObject({maxHp:325,attack:23,physDef:26,magicDef:5});
 expect([1,2,5,6,20].map(level=>getPassiveSlotCount('Defender',level))).toEqual([0,1,1,2,2]);
});
test('talent registry contains 24 ability sets and all 49 stable variants are combat-ready',()=>{
 expect(CLASS_TALENT_SETS).toHaveLength(24);expect(CLASS_TALENT_SETS.flatMap(set=>set.talents)).toHaveLength(49);
 expect(new Set(CLASS_TALENT_SETS.flatMap(set=>set.talents.map(t=>t.id))).size).toBe(49);
 const ready=CLASS_TALENT_SETS.flatMap(set=>set.talents).filter(t=>t.combatReady);
 expect(ready).toHaveLength(49);
 const readyByClass=CLASS_TALENT_SETS.reduce((counts,set)=>{
  counts[set.classId]=(counts[set.classId]||0)+set.talents.filter(t=>t.combatReady).length;
  return counts;
 },{});
 expect(readyByClass).toEqual({Defender:16,Mage:17,Archer:16});
});
test('Archer level 1-20 progression keeps the authored skill, passive, talent, and slot cadence',()=>{
 const archer=CLASS_PROGRESSION_DEFINITIONS.Archer;
 expect(archer.startingSkillIds).toEqual(['Зазубренная стрела','Огненная стрела','Добивающий выстрел','Быстрый перехват']);
 expect(archer.skills.map(skill=>[skill.id,skill.requiredLevel])).toEqual([
  ['Зазубренная стрела',1],['Огненная стрела',1],['Добивающий выстрел',1],['Быстрый перехват',1],
  ['Волчья яма',3],['Перенаправление',5],['Залп стрел',7],['Змеиная ловушка',9],
 ]);
 expect(archer.passiveSkills.map(passive=>[passive.id,passive.requiredLevel])).toEqual([
  ['finish_the_prey',2],['initiative',2],['false_trail',6],['hunting_rhythm',6],
 ]);
 expect([1,2,5,6,20].map(level=>getPassiveSlotCount('Archer',level))).toEqual([0,1,1,2,2]);

 const archerTalentLevels=Object.fromEntries(
  CLASS_TALENT_SETS.filter(set=>set.classId==='Archer').map(set=>[set.abilityName,set.requiredLevel])
 );
 expect(archerTalentLevels).toEqual({
  'Зазубренная стрела':4,
  'Огненная стрела':8,
  'Добивающий выстрел':16,
  'Быстрый перехват':12,
  'Волчья яма':10,
  'Перенаправление':14,
  'Залп стрел':17,
  'Змеиная ловушка':18,
 });

 const contentLevels=[2,3,4,5,6,7,8,9,10,12,14,16,17,18];
 const statOnlyLevels=[11,13,15,19,20];
 expect([...contentLevels,...statOnlyLevels].sort((a,b)=>a-b)).toEqual(Array.from({length:19},(_,index)=>index+2));

 const level9=grantClassExperience({},'Archer',CLASS_XP_THRESHOLDS[8]).record;
 expect(level9.unlockedSkillIds).toEqual(archer.skills.map(skill=>skill.id));
 expect(level9.purchasedPassiveIds).toEqual(archer.passiveSkills.map(passive=>passive.id));
 expect(level9).not.toHaveProperty('earnedClassPoints');
 expect(level9).not.toHaveProperty('spentClassPoints');
});

test('ready talent choice is free, exclusive, persisted, and rejects every invalid gate',()=>{
 const fixtures=createReadyTalentFixture(); const registry=Object.fromEntries(fixtures.flatMap(set=>set.talents.map(t=>[t.id,{...t,classId:set.classId,abilityId:set.abilityId,requiredLevel:set.requiredLevel}])));
 let state=grantClassExperience({},'Defender',CLASS_XP_THRESHOLDS[19]).progression;
 const set=fixtures.find(x=>x.abilityId==='defender.shockwave');
 expect(selectClassTalent(state,'Defender',set.abilityId,set.talents[0].id,{location:'dungeon',talentRegistry:registry}).success).toBe(false);
 expect(selectClassTalent(state,'Mage',set.abilityId,set.talents[0].id,{location:'guild',talentRegistry:registry}).success).toBe(false);
 expect(selectClassTalent(state,'Defender',set.abilityId,'unknown',{location:'guild',talentRegistry:registry}).success).toBe(false);
 expect(selectClassTalent(state,'Defender',set.abilityId,set.talents[0].id,{location:'guild',inCombat:true,talentRegistry:registry}).success).toBe(false);
 const first=selectClassTalent(state,'Defender',set.abilityId,set.talents[0].id,{location:'guild',talentRegistry:registry});expect(first).toMatchObject({success:true});expect(first).not.toHaveProperty('cost');
 const second=selectClassTalent(first.progression,'Defender',set.abilityId,set.talents[1].id,{location:'guild',talentRegistry:registry});
 expect(Object.keys(second.record.talentSelections)).toHaveLength(1);expect(second.record.talentSelections[set.abilityId]).toBe(set.talents[1].id);
 expect(ensureClassProgression(JSON.parse(JSON.stringify(second.progression)))).toEqual(second.progression);
});
