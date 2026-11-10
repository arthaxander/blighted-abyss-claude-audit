const { CLASSES, SKILL_LEVELS, PASSIVE_LEVELS, LEGACY_SKILL_LEVELS, LEGACY_PASSIVE_LEVELS, canonicalSkillId, canonicalPassiveId, levelForXp, pointsForLevel, passiveSlotsForLevel } = require('../src/data/classProgressionRules.mjs');
const { TALENT_BY_ID, TALENT_SET_BY_ABILITY_ID } = require('../src/data/classTalents.mjs');
const { validateExpeditionTransition } = require('./expeditionTransitionValidation');
const invalid=message=>{throw Object.assign(new Error(message),{statusCode:400})};
const unique=values=>Array.isArray(values)&&new Set(values).size===values.length;
const canonicalizeIds=(values,canonicalize)=>Array.isArray(values)?values.map(value=>value===null?null:canonicalize(value)):values;
const canonicalizeProgressionRecord=(classId,record)=>{
 if(!record||typeof record!=='object'||Array.isArray(record))return record;
 const skill=id=>canonicalSkillId(id),passive=id=>canonicalPassiveId(classId,id);
 const purchases=record.purchases&&typeof record.purchases==='object'&&!Array.isArray(record.purchases)
  ?Object.fromEntries(Object.entries(record.purchases).map(([id,value])=>[passive(skill(id)),value])):record.purchases;
 return {...record,unlockedSkillIds:canonicalizeIds(record.unlockedSkillIds,skill),activeSkillIds:canonicalizeIds(record.activeSkillIds,skill),purchasedPassiveIds:canonicalizeIds(record.purchasedPassiveIds,passive),equippedPassiveIds:canonicalizeIds(record.equippedPassiveIds,passive),...(purchases?{purchases}:{})};
};
const canonicalizeProgression=progression=>progression&&typeof progression==='object'&&!Array.isArray(progression)
 ?Object.fromEntries(Object.entries(progression).map(([classId,record])=>[classId,canonicalizeProgressionRecord(classId,record)])):progression;
// This is deliberately narrower than alias migration: it only restores an
// entitlement proven by the record's authoritative level, with no fuzzy match.
const repairSingleMissingLevelSkill=(classId,record)=>{
 const definition=CLASSES[classId];
 const schemaVersion=Number(record?.schemaVersion);
 if(!definition||!record||typeof record!=='object'||Array.isArray(record)||!Number.isFinite(schemaVersion)||schemaVersion<3||!Array.isArray(record.unlockedSkillIds))return record;
 const knownIds=new Set(Object.keys(definition.skills));
 const unknownIndexes=record.unlockedSkillIds.map((id,index)=>knownIds.has(id)?null:index).filter(index=>index!==null);
 const presentIds=new Set(record.unlockedSkillIds.filter(id=>knownIds.has(id)));
 const missingLevelSkills=[...knownIds].filter(id=>SKILL_LEVELS[classId][id]<=record.classLevel&&!presentIds.has(id));
 if(unknownIndexes.length!==1||missingLevelSkills.length!==1)return record;
 const unknownId=record.unlockedSkillIds[unknownIndexes[0]],replacement=missingLevelSkills[0];
 const unlockedSkillIds=[...record.unlockedSkillIds];
 unlockedSkillIds[unknownIndexes[0]]=replacement;
 const activeSkillIds=Array.isArray(record.activeSkillIds)?record.activeSkillIds.map(id=>id===unknownId?replacement:id):record.activeSkillIds;
 return {...record,unlockedSkillIds,activeSkillIds};
};
const repairProgression=progression=>progression&&typeof progression==='object'&&!Array.isArray(progression)
 ?Object.fromEntries(Object.entries(progression).map(([classId,record])=>[classId,repairSingleMissingLevelSkill(classId,record)])):progression;
const expectedBonus=(id,l)=>{const gained=l-1,even=Math.floor(l/2),commonPhys=[3,7,11,15,19].filter(x=>l>=x).length+(l>=20?1:0),commonMagic=[5,9,13,17].filter(x=>l>=x).length+(l>=20?1:0);return {maxHp:(id==='Defender'?5:3)*gained,attack:id==='Mage'?0:even,magAtk:id==='Mage'?even:0,physDef:id==='Mage'?commonMagic:commonPhys,magicDef:id==='Mage'?commonPhys:commonMagic,speed:0,critChance:0,critDamage:0,dodge:0}};
const firstDifference=(left,right,path='$')=>{
 if(Object.is(left,right))return null;
 const leftType=Array.isArray(left)?'array':left===null?'null':typeof left;
 const rightType=Array.isArray(right)?'array':right===null?'null':typeof right;
 if(leftType!==rightType)return {path,leftType,rightType,kind:'type'};
 if(leftType!=='object'&&leftType!=='array')return {path,leftType,rightType,kind:'value'};
 const leftKeys=Object.keys(left),rightKeys=Object.keys(right);
 if(leftType==='array'&&left.length!==right.length)return {path,leftType,rightType,kind:'array-length'};
 const missing=leftKeys.find(key=>!Object.prototype.hasOwnProperty.call(right,key));
 if(missing!==undefined)return {path:`${path}.${missing}`,leftType:typeof left[missing],rightType:'missing',kind:'missing-key'};
 const extra=rightKeys.find(key=>!Object.prototype.hasOwnProperty.call(left,key));
 if(extra!==undefined)return {path:`${path}.${extra}`,leftType:'missing',rightType:typeof right[extra],kind:'extra-key'};
 for(const key of leftKeys){const difference=firstDifference(left[key],right[key],leftType==='array'?`${path}[${key}]`:`${path}.${key}`);if(difference)return difference;}
 return null;
};
const unlockedSkillFailure=(classId,record,previousRecord)=>{
 const definition=CLASSES[classId],unlocked=record.unlockedSkillIds;
 if(!Array.isArray(unlocked))return {index:null,skillId:null,reason:'unknown-id',requiredLevel:null,legacyRequiredLevel:null,previousAuthoritativeHasCanonicalId:false};
 const seen=new Set();
 for(let index=0;index<unlocked.length;index+=1){
  const skillId=unlocked[index];
  const previousAuthoritativeHasCanonicalId=Boolean(previousRecord?.unlockedSkillIds?.includes(skillId));
  const requiredLevel=SKILL_LEVELS[classId]?.[skillId]??null;
  const legacyRequiredLevel=LEGACY_SKILL_LEVELS[classId]?.[skillId]??null;
  let reason=null;
  if(!(skillId in (definition?.skills||{})))reason='unknown-id';
  else if(seen.has(skillId))reason='duplicate-after-canonicalization';
  else if(requiredLevel>record.classLevel){
   const eligibleUnderLegacyGate=legacyRequiredLevel!==null&&legacyRequiredLevel<=record.classLevel;
   if(!(eligibleUnderLegacyGate&&previousAuthoritativeHasCanonicalId))reason=eligibleUnderLegacyGate?'missing-grandfather-proof':'above-current-level';
  }
  if(reason)return {index,skillId,reason,requiredLevel,legacyRequiredLevel,previousAuthoritativeHasCanonicalId};
  seen.add(skillId);
 }
 return null;
};
const validateProgressionRecord=(classId,record,{talentById=TALENT_BY_ID,talentSetByAbilityId=TALENT_SET_BY_ABILITY_ID,previousRecord=null}={})=>{
 const definition=CLASSES[classId];
 if(!definition||!record||typeof record!=='object'||Array.isArray(record))invalid('invalid-class-progression');
 const xp=record.cumulativeClassXp;
 const schemaVersion=Number(record.schemaVersion)||1;
 const levelDriven=schemaVersion>=3;
 if(!Number.isSafeInteger(xp)||xp<0||record.classLevel!==levelForXp(xp))invalid('invalid-class-progression');
 if(!levelDriven&&record.earnedClassPoints!==pointsForLevel(record.classLevel))invalid('invalid-class-progression');
 if(levelDriven&&(['earnedClassPoints','spentClassPoints','purchases'].some(key=>Object.prototype.hasOwnProperty.call(record,key))))invalid('legacy-class-points');

 const unlocked=record.unlockedSkillIds;
 const active=record.activeSkillIds;
 const purchasedPassives=record.purchasedPassiveIds||[];
 const equippedPassives=record.equippedPassiveIds||[];
 const previouslyOwnedSkill=id=>(previousRecord?.unlockedSkillIds?.includes(id)||!levelDriven&&record.unlockedSkillIds?.includes(id))&&record.classLevel>=(LEGACY_SKILL_LEVELS[classId]?.[id]??SKILL_LEVELS[classId][id]);
 const previouslyOwnedPassive=id=>(previousRecord?.purchasedPassiveIds?.includes(id)||!levelDriven&&record.purchasedPassiveIds?.includes(id))&&record.classLevel>=(LEGACY_PASSIVE_LEVELS[classId]?.[id]??PASSIVE_LEVELS[classId][id]);
 const levelSkills=Object.keys(definition.skills).filter(id=>SKILL_LEVELS[classId][id]<=record.classLevel);
 const levelPassives=Object.keys(definition.passives).filter(id=>PASSIVE_LEVELS[classId][id]<=record.classLevel);

 const unlockedFailure=unlockedSkillFailure(classId,record,previousRecord);
 if(unlockedFailure||!unique(unlocked)||unlocked.some(id=>!(id in definition.skills)||SKILL_LEVELS[classId][id]>record.classLevel&&!previouslyOwnedSkill(id))){
  const error=Object.assign(new Error('invalid-unlocked-skills'),{statusCode:400});
  error.saveDiagnostic={classId,classLevel:record.classLevel,category:'invalid-unlocked-skills',field:'unlockedSkillIds',...unlockedFailure};
  throw error;
 }
 if(levelDriven&&levelSkills.some(id=>!unlocked.includes(id)))invalid('missing-level-skill');
 // Reject invalid active skills but identify the exact reason for recovery diagnostics.
 const loadoutFailure=(()=>{
  if(!Array.isArray(active))return {reason:'not-array',index:null};
  if(active.length>4)return {reason:'too-many-slots',index:4};
  const seen=new Set();
  for(let index=0;index<active.length;index+=1){
   const id=active[index];
   if(id===null)continue;
   if(typeof id!=='string'||!(id in definition.skills))return {reason:'unknown-skill',index};
   if(seen.has(id))return {reason:'duplicate-skill',index};
   if(!unlocked.includes(id))return {reason:'not-unlocked',index};
   seen.add(id);
  }
  return null;
 })();
 if(loadoutFailure){
  const error=Object.assign(new Error('invalid-class-loadout'),{statusCode:400});
  error.saveDiagnostic={classId,classLevel:record.classLevel,category:'invalid-class-loadout',field:'activeSkillIds',...loadoutFailure};
  throw error;
 }

 if(!unique(purchasedPassives)||purchasedPassives.some(id=>!(id in definition.passives)||PASSIVE_LEVELS[classId][id]>record.classLevel&&!previouslyOwnedPassive(id)))invalid('invalid-passive-purchases');
 if(levelDriven&&levelPassives.some(id=>!purchasedPassives.includes(id)))invalid('missing-level-passive');
 if(!unique(equippedPassives.filter(Boolean))||equippedPassives.length>passiveSlotsForLevel(record.classLevel)||equippedPassives.some(id=>id!==null&&(!(id in definition.passives)||!purchasedPassives.includes(id))))invalid('invalid-passive-loadout');

 if(!levelDriven){
  const paidSkills=unlocked.filter(id=>definition.skills[id]>0);
  const expectedSpent=[...paidSkills.map(id=>definition.skills[id]),...purchasedPassives.map(id=>definition.passives[id])].reduce((sum,cost)=>sum+cost,0);
  if(!Number.isSafeInteger(record.spentClassPoints)||record.spentClassPoints!==expectedSpent||expectedSpent>record.earnedClassPoints)invalid('invalid-class-points');
  const purchases=record.purchases||{};
  if(Object.entries(purchases).some(([id,purchase])=>{const activeCost=definition.skills[id],passiveCost=definition.passives[id];return activeCost===undefined&&passiveCost===undefined||purchase?.cost!==(activeCost??passiveCost)||purchase?.type!==(activeCost!==undefined?'activeSkill':'passiveSkill')||!(activeCost!==undefined?unlocked:purchasedPassives).includes(id)}))invalid('invalid-purchases');
 }

 for(const [abilityId,talentId] of Object.entries(record.talentSelections||{})){
  const set=talentSetByAbilityId[abilityId],talent=talentById[talentId];
  if(!set||!talent||set.classId!==classId||talent.classId!==classId||talent.abilityId!==abilityId||!set.talents.some(entry=>entry.id===talentId))invalid('invalid-talent-selection');
  if(!talent.combatReady)invalid('talent-not-combat-ready');
  if(record.classLevel<set.requiredLevel)invalid('talent-level-required');
  if(!unlocked.includes(set.abilityName))invalid('talent-skill-not-unlocked');
 }
};
const selectCanonicalProgression=save=>{
 const root=save?.classProgression,embedded=save?.player?.classProgression;
 if(root&&(Object.keys(root).length>0||!embedded))return root;
 return embedded||root;
};
// Unlike an untrusted incoming save, both copies already persisted in the
// authoritative save are historical evidence. Old clients could leave one copy
// behind during migration, so ownership proof must consider both without using
// either copy to add anything to the current payload.
const previousOwnershipProgression=save=>{
 const copies=[save?.classProgression,save?.player?.classProgression].filter(Boolean).map(canonicalizeProgression);
 if(!copies.length)return undefined;
 const classIds=new Set(copies.flatMap(progression=>Object.keys(progression||{})));
 return Object.fromEntries([...classIds].map(classId=>{
  const records=copies.map(progression=>progression?.[classId]).filter(record=>record&&typeof record==='object'&&!Array.isArray(record));
  const base=records[0]||{};
  const union=field=>[...new Set(records.flatMap(record=>Array.isArray(record[field])?record[field]:[]))];
  return [classId,{...base,unlockedSkillIds:union('unlockedSkillIds'),purchasedPassiveIds:union('purchasedPassiveIds')}];
 }));
};
const validateSavePayload=(save,{previousSave=null,onDivergence}={})=>{
 if(!save||typeof save!=='object'||Array.isArray(save))invalid('invalid-save');
 const root=save.classProgression,embedded=save.player?.classProgression;
 // The top-level copy is canonical for current saves. Mixed/legacy clients can
 // still arrive with a stale embedded compatibility copy, so report divergence
 // for diagnostics, then collapse both wire locations onto one validated value
 // instead of rejecting an otherwise legal save.
 const progressionDifference=root&&embedded?firstDifference(root,embedded):null;
 if(progressionDifference)onDivergence?.(progressionDifference);
 const progression=selectCanonicalProgression(save);
 if(progression&&save.player){
  save.classProgression=progression;
  save.player={...save.player,classProgression:progression};
 }
 const canonicalProgression=repairProgression(canonicalizeProgression(progression));
 if(canonicalProgression&&save.player){save.classProgression=canonicalProgression;save.player={...save.player,classProgression:canonicalProgression};}
 const previousProgression=previousOwnershipProgression(previousSave);
 if(canonicalProgression)Object.entries(canonicalProgression).forEach(([id,record])=>{try{validateProgressionRecord(id,record,{previousRecord:previousProgression?.[id]});}catch(error){error.saveDiagnostic=error.saveDiagnostic||{classId:id,category:error.message,field:({
  'invalid-unlocked-skills':'unlockedSkillIds','missing-level-skill':'unlockedSkillIds','invalid-class-loadout':'activeSkillIds','invalid-passive-purchases':'purchasedPassiveIds','missing-level-passive':'purchasedPassiveIds','invalid-passive-loadout':'equippedPassiveIds','invalid-talent-selection':'talentSelections','talent-not-combat-ready':'talentSelections','talent-level-required':'talentSelections','talent-skill-not-unlocked':'talentSelections'
 }[error.message]||'classProgression')};throw error;}});
 const b=save.player?.classProgressionStatBonus;
 if(b){const id=save.player.class,record=canonicalProgression?.[id],expected=record&&expectedBonus(id,record.classLevel);if(!expected||Object.keys(expected).some(key=>b[key]!==expected[key])||Object.keys(b).some(key=>!(key in expected)))invalid('invalid-derived-stats')}
 validateExpeditionTransition(save,previousSave);
 return save;
};
module.exports={validateSavePayload,validateProgressionRecord,canonicalizeProgressionRecord,firstDifference,levelForXp,pointsForLevel};

