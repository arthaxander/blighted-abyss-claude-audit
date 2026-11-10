const test=require('node:test');
const assert=require('node:assert/strict');
const {validateSavePayload,validateProgressionRecord,firstDifference,levelForXp,pointsForLevel}=require('../saveValidation');
const {TALENT_BY_ID,TALENT_SET_BY_ABILITY_ID}=require('../../src/data/classTalents.mjs');

const defenderSkills=['Стойкость','Устрашение','Кровавый таран','Удар щитом','Ударная волна','Таран','Бросок щита','Кровавый вызов'];
const defenderPassives=['blood_pressure','last_stand','retaliatory_assault','headlong'];
const record=(overrides={})=>({
 schemaVersion:3,classLevel:20,cumulativeClassXp:16700,
 unlockedSkillIds:defenderSkills,
 activeSkillIds:['Стойкость','Ударная волна'],
 purchasedPassiveIds:defenderPassives,
 equippedPassiveIds:[],
 talentSelections:{},
 ...overrides
});
const saveFor=progression=>({player:{class:'Defender',classProgression:progression},classProgression:progression});

test('schema v3 roundtrips without class-point bookkeeping and derived stats cannot be forged',()=>{
 const progression={Defender:record()};const save=saveFor(progression);
 assert.equal(validateSavePayload(save),save);
 assert.equal(levelForXp(16699),19);
 assert.equal(pointsForLevel(20),21);
 assert.equal('earnedClassPoints' in progression.Defender,false);
 assert.equal('spentClassPoints' in progression.Defender,false);
 assert.equal('purchases' in progression.Defender,false);
 assert.throws(()=>validateSavePayload(saveFor({Defender:record({earnedClassPoints:21})})),/legacy-class-points/);
 assert.throws(()=>validateSavePayload({...save,player:{...save.player,classProgressionStatBonus:{attack:999}}}),/invalid-derived-stats/);
});

test('schema v3 requires every level-earned skill/passive and validates loadouts',()=>{
 assert.throws(()=>validateSavePayload(saveFor({Defender:record({unlockedSkillIds:defenderSkills.filter(id=>id!=='Таран')})})),/missing-level-skill/);
 assert.throws(()=>validateSavePayload(saveFor({Defender:record({purchasedPassiveIds:defenderPassives.filter(id=>id!=='headlong')})})),/missing-level-passive/);
 assert.throws(()=>validateSavePayload(saveFor({Defender:record({activeSkillIds:['Стойкость','Стойкость']})})),/invalid-class-loadout/);
 assert.throws(()=>validateSavePayload(saveFor({Defender:record({activeSkillIds:['defender.fake']})})),/invalid-class-loadout/);
 assert.throws(()=>validateSavePayload(saveFor({Defender:record({equippedPassiveIds:['blood_pressure','blood_pressure']})})),/invalid-passive-loadout/);
 const low=record({
  classLevel:1,cumulativeClassXp:0,
  unlockedSkillIds:['Стойкость','Устрашение','Кровавый таран','Удар щитом'],
  activeSkillIds:['Стойкость'],
  purchasedPassiveIds:['blood_pressure'],
  equippedPassiveIds:['blood_pressure']
 });
 assert.throws(()=>validateSavePayload(saveFor({Defender:low})),/invalid-passive-purchases|invalid-passive-loadout/);
});

test('legacy schema v1-v2 still validates point bookkeeping during migration',()=>{
 const legacy={
  schemaVersion:2,classLevel:20,cumulativeClassXp:16700,earnedClassPoints:21,spentClassPoints:1,
  unlockedSkillIds:['Стойкость','Устрашение','Кровавый таран','Удар щитом','Ударная волна'],
  activeSkillIds:['Стойкость','Ударная волна'],
  purchases:{'Ударная волна':{type:'activeSkill',cost:1}},
  purchasedPassiveIds:[],equippedPassiveIds:[],talentSelections:{}
 };
 assert.doesNotThrow(()=>validateProgressionRecord('Defender',legacy));
 assert.throws(()=>validateProgressionRecord('Defender',{...legacy,spentClassPoints:2}),/invalid-class-points/);
});

test('divergent progression copies are canonicalized',()=>{
 const root={Defender:record()},embedded={Defender:record({cumulativeClassXp:14900,classLevel:19})};
 const save={player:{class:'Defender',classProgression:embedded},classProgression:root};
 assert.equal(validateSavePayload(save),save);
 assert.deepEqual(save.player.classProgression,root);
 assert.strictEqual(save.player.classProgression,save.classProgression);
});

test('progression comparison ignores only object key order and reports the first real difference without values',()=>{
 const root={Defender:record()};
 const embedded={Defender:Object.fromEntries(Object.entries(root.Defender).reverse())};
 assert.notEqual(JSON.stringify(root),JSON.stringify(embedded));
 assert.equal(firstDifference(root,embedded),null);
 assert.doesNotThrow(()=>validateSavePayload({player:{class:'Defender',classProgression:embedded},classProgression:root}));
 const changed={Defender:{...embedded.Defender,classLevel:'20'}};
 assert.deepEqual(firstDifference(root,changed),{path:'$.Defender.classLevel',leftType:'number',rightType:'string',kind:'type'});
 let reported=null;
 const save={player:{class:'Defender',classProgression:changed},classProgression:root};
 assert.doesNotThrow(()=>validateSavePayload(save,{onDivergence:difference=>{reported=difference;}}));
 assert.deepEqual(reported,{path:'$.Defender.classLevel',leftType:'number',rightType:'string',kind:'type'});
 assert.strictEqual(save.player.classProgression,save.classProgression);
});

test('legacy empty top-level progression shell yields to the populated embedded copy',()=>{
 const embedded={Defender:record()};const save={player:{class:'Defender',classProgression:embedded},classProgression:{}};
 assert.doesNotThrow(()=>validateSavePayload(save));
 assert.deepEqual(save.classProgression,embedded);
 assert.strictEqual(save.player.classProgression,save.classProgression);
});

test('talents require exact canonical identity, readiness, level and level-earned parent skill',()=>{
 const base=record();
 assert.throws(()=>validateProgressionRecord('Defender',{...base,talentSelections:{'defender.fortitude':'defender.fortitude.imaginary'}}),/invalid-talent-selection/);
 const blocked={...TALENT_BY_ID['defender.fortitude.unbroken_will'],combatReady:false};
 const blockedRegistry={...TALENT_BY_ID,[blocked.id]:blocked};
 assert.throws(()=>validateProgressionRecord('Defender',{...base,talentSelections:{'defender.fortitude':blocked.id}},{talentById:blockedRegistry,talentSetByAbilityId:TALENT_SET_BY_ABILITY_ID}),/talent-not-combat-ready/);
 const level13={
  ...base,classLevel:13,cumulativeClassXp:6200,
  unlockedSkillIds:defenderSkills,
  purchasedPassiveIds:defenderPassives,
  talentSelections:{'defender.shockwave':'defender.shockwave.bloody_echo'}
 };
 assert.throws(()=>validateProgressionRecord('Defender',level13),/talent-level-required/);
 const missingParent={...base,unlockedSkillIds:defenderSkills.filter(id=>id!=='Ударная волна'),talentSelections:{'defender.shockwave':'defender.shockwave.bloody_echo'}};
 assert.throws(()=>validateProgressionRecord('Defender',missingParent),/missing-level-skill|talent-skill-not-unlocked/);
});

test('grandfathers only formerly legal early unlocks confirmed by the previous authoritative save',()=>{
 const level4Legacy={schemaVersion:2,classLevel:4,cumulativeClassXp:450,earnedClassPoints:3,spentClassPoints:1,unlockedSkillIds:['Стойкость','Устрашение','Кровавый таран','Удар щитом'],activeSkillIds:['Стойкость','Устрашение','Кровавый таран','Удар щитом'],purchases:{last_stand:{type:'passiveSkill',cost:1}},purchasedPassiveIds:['last_stand'],equippedPassiveIds:['last_stand'],talentSelections:{}};
 const level4V3={schemaVersion:3,classLevel:4,cumulativeClassXp:450,unlockedSkillIds:['Стойкость','Устрашение','Кровавый таран','Удар щитом','Ударная волна'],activeSkillIds:['Стойкость','Устрашение','Кровавый таран','Удар щитом'],purchasedPassiveIds:['blood_pressure','retaliatory_assault','last_stand'],equippedPassiveIds:['last_stand'],talentSelections:{}};
 assert.doesNotThrow(()=>validateSavePayload(saveFor({Defender:level4V3}),{previousSave:saveFor({Defender:level4Legacy})}));
 assert.throws(()=>validateSavePayload(saveFor({Defender:level4V3})),/invalid-passive-purchases/);

 const mage5Legacy={schemaVersion:2,classLevel:5,cumulativeClassXp:700,earnedClassPoints:4,spentClassPoints:1,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Грозовой разряд'],activeSkillIds:['Грозовой разряд'],purchases:{'Грозовой разряд':{type:'activeSkill',cost:1}},purchasedPassiveIds:[],equippedPassiveIds:[],talentSelections:{}};
 const mage5V3={schemaVersion:3,classLevel:5,cumulativeClassXp:700,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран','Призыв элементаля','Грозовой разряд'],activeSkillIds:['Грозовой разряд'],purchasedPassiveIds:['lightning_speed','elemental_shell'],equippedPassiveIds:[],talentSelections:{}};
 assert.throws(()=>validateProgressionRecord('Mage',mage5V3),/invalid-unlocked-skills/);
 assert.doesNotThrow(()=>validateProgressionRecord('Mage',mage5V3,{previousRecord:mage5Legacy}));
});

test('uses both authoritative copies as Mage grandfather evidence while Archer is active',()=>{
 const archer={schemaVersion:3,classLevel:1,cumulativeClassXp:0,unlockedSkillIds:['Зазубренная стрела','Огненная стрела','Добивающий выстрел','Быстрый перехват'],activeSkillIds:['Зазубренная стрела'],purchasedPassiveIds:[],equippedPassiveIds:[],talentSelections:{}};
 const mageWithoutLegacyStorm={schemaVersion:3,classLevel:5,cumulativeClassXp:700,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран','Призыв элементаля'],activeSkillIds:['Огненный шар'],purchasedPassiveIds:['lightning_speed','elemental_shell'],equippedPassiveIds:[],talentSelections:{}};
 const oldMage={schemaVersion:2,classLevel:5,cumulativeClassXp:700,earnedClassPoints:4,spentClassPoints:1,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран','Грозовой разряд'],activeSkillIds:['Грозовой разряд'],purchases:{'Грозовой разряд':{type:'activeSkill',cost:1}},purchasedPassiveIds:[],equippedPassiveIds:[],talentSelections:{}};
 const previousSave={classProgression:{Archer:archer,Mage:mageWithoutLegacyStorm},player:{class:'Archer',classProgression:{Archer:archer,Mage:oldMage}}};
 const migratedMage={...mageWithoutLegacyStorm,unlockedSkillIds:[...mageWithoutLegacyStorm.unlockedSkillIds,'Грозовой разряд']};
 const currentProgression={Archer:archer,Mage:migratedMage};
 const currentSave={classProgression:currentProgression,player:{class:'Archer',runSilver:1,classProgression:currentProgression}};
 assert.doesNotThrow(()=>validateSavePayload(currentSave,{previousSave}));

 const forgedMage={...mageWithoutLegacyStorm,unlockedSkillIds:[...mageWithoutLegacyStorm.unlockedSkillIds,'Стихийное эхо']};
 const forgedProgression={Archer:archer,Mage:forgedMage};
 assert.throws(()=>validateSavePayload({classProgression:forgedProgression,player:{class:'Archer',classProgression:forgedProgression}},{previousSave}),/invalid-unlocked-skills/);
});

test('repairs one corrupted schema v3 skill only when it uniquely replaces a level-earned skill',()=>{
 const archer={schemaVersion:3,classLevel:1,cumulativeClassXp:0,unlockedSkillIds:['Зазубренная стрела','Огненная стрела','Добивающий выстрел','Быстрый перехват'],activeSkillIds:['Зазубренная стрела'],purchasedPassiveIds:[],equippedPassiveIds:[],talentSelections:{}};
 const corrupted='Призыв элемен\uFFFDаля';
 const mage={schemaVersion:3,classLevel:13,cumulativeClassXp:6200,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран',corrupted,'Грозовой разряд','Стихийное эхо'],activeSkillIds:['Огненный шар',corrupted],purchasedPassiveIds:['lightning_speed','overheat','elemental_shell','elemental_resonance'],equippedPassiveIds:[],talentSelections:{}};
 const progression={Archer:archer,Mage:mage};
 const save={classProgression:progression,player:{class:'Archer',classProgression:progression}};
 assert.doesNotThrow(()=>validateSavePayload(save));
 assert.equal(save.classProgression.Mage.unlockedSkillIds[5],'Призыв элементаля');
 assert.deepEqual(save.classProgression.Mage.activeSkillIds,['Огненный шар','Призыв элементаля']);
 assert.strictEqual(save.player.classProgression,save.classProgression);
 const persisted=structuredClone(save);
 assert.doesNotThrow(()=>validateSavePayload(persisted));
 assert.deepEqual(persisted,save);
});

test('does not guess when a corrupted skill is not the unique missing level entitlement',()=>{
 const base={schemaVersion:3,classLevel:5,cumulativeClassXp:700,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран','Призыв элементаля'],activeSkillIds:['Огненный шар'],purchasedPassiveIds:['lightning_speed','elemental_shell'],equippedPassiveIds:[],talentSelections:{}};
 assert.throws(()=>validateSavePayload(saveFor({Mage:{...base,unlockedSkillIds:[...base.unlockedSkillIds,'extra\uFFFD']}})),/invalid-unlocked-skills/);
 assert.throws(()=>validateSavePayload(saveFor({Mage:{...base,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','broken\uFFFD']}})),/invalid-unlocked-skills/);
 assert.throws(()=>validateSavePayload(saveFor({Mage:{...base,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран','bad\uFFFD','extra\uFFFD']}})),/invalid-unlocked-skills/);
 assert.throws(()=>validateSavePayload(saveFor({Mage:{...base,classLevel:3,cumulativeClassXp:300,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран','Призыв элементаля'],purchasedPassiveIds:['lightning_speed','elemental_shell']}})),/invalid-unlocked-skills/);
});

test('does not repair a missing-schema legacy record',()=>{
 const corrupted='Огненный шар\uFFFD';
 const legacy={classLevel:1,cumulativeClassXp:0,earnedClassPoints:0,spentClassPoints:0,unlockedSkillIds:[corrupted,'Цепная молния','Морозный щит','Ледяное копьё'],activeSkillIds:['Цепная молния'],purchases:{},purchasedPassiveIds:[],equippedPassiveIds:[],talentSelections:{}};
 try{validateSavePayload(saveFor({Mage:legacy}));assert.fail('expected rejection');}
 catch(error){assert.equal(error.message,'invalid-unlocked-skills');assert.equal(error.saveDiagnostic.skillId,corrupted);}
});

test('canonicalizes every rebalance rename in current and authoritative legacy records',()=>{
 const cases=[
  ['Defender','Провокация','Кровавый вызов'],
  ['Mage','Горящая руна','Ледяное копьё'],
  ['Archer','Прицельный выстрел','Огненная стрела'],
 ];
 for(const [classId,legacyId,currentId] of cases){
  const definition=require('../../src/data/classProgressionRules.mjs').CLASSES[classId];
  const progression={[classId]:{schemaVersion:3,classLevel:20,cumulativeClassXp:16700,unlockedSkillIds:Object.keys(definition.skills).map(id=>id===currentId?legacyId:id),activeSkillIds:[legacyId],purchasedPassiveIds:Object.keys(definition.passives),equippedPassiveIds:[],talentSelections:{}}};
  const save={classProgression:progression,player:{class:classId,classProgression:progression}};
  assert.doesNotThrow(()=>validateSavePayload(save));
  assert.ok(save.classProgression[classId].unlockedSkillIds.includes(currentId));
  assert.deepEqual(save.classProgression[classId].activeSkillIds,[currentId]);
 }
});

test('canonicalizes legacy Elementalist passive ownership without weakening unknown-id rejection',()=>{
 const progression={Mage:{schemaVersion:3,classLevel:6,cumulativeClassXp:1000,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран','Призыв элементаля'],activeSkillIds:['Огненный шар'],purchasedPassiveIds:['catalyst','elemental_shell','polarization','elemental_resonance'],equippedPassiveIds:['catalyst','polarization'],talentSelections:{}}};
 const save={classProgression:progression,player:{class:'Mage',classProgression:progression}};
 assert.doesNotThrow(()=>validateSavePayload(save));
 assert.deepEqual(save.classProgression.Mage.equippedPassiveIds,['lightning_speed','overheat']);
 const forged=structuredClone(save);forged.classProgression.Mage.purchasedPassiveIds.push('mage.cheat');forged.player.classProgression=forged.classProgression;
 assert.throws(()=>validateSavePayload(forged),/invalid-passive-purchases/);
});

test('attaches safe class/category/field diagnostics to progression rejections',()=>{
 try{validateSavePayload(saveFor({Defender:record({unlockedSkillIds:[...defenderSkills,'forged']})}));assert.fail('expected rejection');}
 catch(error){assert.deepEqual(error.saveDiagnostic,{classId:'Defender',classLevel:20,category:'invalid-unlocked-skills',field:'unlockedSkillIds',index:defenderSkills.length,skillId:'forged',reason:'unknown-id',requiredLevel:null,legacyRequiredLevel:null,previousAuthoritativeHasCanonicalId:false});}
});

test('reports alias collisions as duplicates after canonicalization',()=>{
 const mage={schemaVersion:3,classLevel:1,cumulativeClassXp:0,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Горящая руна','Ледяное копьё'],activeSkillIds:['Огненный шар'],purchasedPassiveIds:[],equippedPassiveIds:[],talentSelections:{}};
 try{validateSavePayload(saveFor({Mage:mage}));assert.fail('expected rejection');}
 catch(error){assert.deepEqual(error.saveDiagnostic,{classId:'Mage',classLevel:1,category:'invalid-unlocked-skills',field:'unlockedSkillIds',index:4,skillId:'Ледяное копьё',reason:'duplicate-after-canonicalization',requiredLevel:1,legacyRequiredLevel:null,previousAuthoritativeHasCanonicalId:false});}
});

test('distinguishes a missing grandfather proof from an arbitrary early unlock',()=>{
 const base={schemaVersion:3,classLevel:5,cumulativeClassXp:700,unlockedSkillIds:['Огненный шар','Цепная молния','Морозный щит','Ледяное копьё','Буран','Призыв элементаля','Грозовой разряд'],activeSkillIds:['Огненный шар'],purchasedPassiveIds:['lightning_speed','elemental_shell'],equippedPassiveIds:[],talentSelections:{}};
 try{validateSavePayload(saveFor({Mage:base}));assert.fail('expected rejection');}
 catch(error){assert.equal(error.saveDiagnostic.reason,'missing-grandfather-proof');assert.equal(error.saveDiagnostic.index,6);assert.equal(error.saveDiagnostic.requiredLevel,7);assert.equal(error.saveDiagnostic.legacyRequiredLevel,5);assert.equal(error.saveDiagnostic.previousAuthoritativeHasCanonicalId,false);}
 const arbitrary={...base,unlockedSkillIds:[...base.unlockedSkillIds.slice(0,6),'Стихийное эхо']};
 try{validateSavePayload(saveFor({Mage:arbitrary}));assert.fail('expected rejection');}
 catch(error){assert.equal(error.saveDiagnostic.reason,'above-current-level');assert.equal(error.saveDiagnostic.requiredLevel,9);assert.equal(error.saveDiagnostic.legacyRequiredLevel,7);}
});


test('loadout rejection identifies the broken slot without changing validation',()=>{
 for(const [loadout,reason,index] of [
  [['Стойкость','Стойкость'],'duplicate-skill',1],
  [['defender.fake'],'unknown-skill',0],
  [['Стойкость','Ударная волна','Таран','Удар щита','Удар щитом'],'too-many-slots',4],
 ]){
  try{validateSavePayload(saveFor({Defender:record({activeSkillIds:loadout})}));assert.fail('expected rejection');}
  catch(error){assert.equal(error.message,'invalid-class-loadout');assert.equal(error.saveDiagnostic.classId,'Defender');assert.equal(error.saveDiagnostic.reason,reason);assert.equal(error.saveDiagnostic.index,index);}
 }
});

