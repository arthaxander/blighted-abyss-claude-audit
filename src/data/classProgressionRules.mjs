/** Shared persistence rules consumed verbatim by the browser and Node server. */
const XP_THRESHOLDS=Object.freeze([0,100,250,450,700,1000,1400,1900,2500,3200,4100,5100,6200,7400,8700,10100,11600,13200,14900,16700]);
const POINT_REWARDS=Object.freeze([0,0,1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,2]);
const PASSIVE_SLOT_LEVELS=Object.freeze([2,6]);
const CLASSES=Object.freeze({
 Defender:Object.freeze({skills:Object.freeze({'Стойкость':0,'Устрашение':0,'Кровавый таран':0,'Удар щитом':0,'Ударная волна':1,'Таран':1,'Бросок щита':1,'Кровавый вызов':1}),passives:Object.freeze({blood_pressure:1,retaliatory_assault:1,headlong:1,last_stand:1})}),
 Mage:Object.freeze({skills:Object.freeze({'Огненный шар':0,'Цепная молния':0,'Морозный щит':0,'Ледяное копьё':0,'Буран':1,'Призыв элементаля':1,'Грозовой разряд':1,'Стихийное эхо':1}),passives:Object.freeze({lightning_speed:1,elemental_shell:1,overheat:1,elemental_resonance:1})}),
 Archer:Object.freeze({skills:Object.freeze({'Зазубренная стрела':0,'Огненная стрела':0,'Добивающий выстрел':0,'Быстрый перехват':0,'Волчья яма':1,'Перенаправление':1,'Залп стрел':1,'Змеиная ловушка':1}),passives:Object.freeze({finish_the_prey:1,initiative:1,false_trail:1,hunting_rhythm:1})}),
});
const SKILL_LEVELS=Object.freeze({Defender:Object.freeze({'Стойкость':1,'Устрашение':1,'Кровавый таран':1,'Удар щитом':1,'Ударная волна':3,'Таран':5,'Бросок щита':7,'Кровавый вызов':9}),Mage:Object.freeze({'Огненный шар':1,'Цепная молния':1,'Морозный щит':1,'Ледяное копьё':1,'Буран':3,'Призыв элементаля':5,'Грозовой разряд':7,'Стихийное эхо':9}),Archer:Object.freeze({'Зазубренная стрела':1,'Огненная стрела':1,'Добивающий выстрел':1,'Быстрый перехват':1,'Волчья яма':3,'Перенаправление':5,'Залп стрел':7,'Змеиная ловушка':9})});
const PASSIVE_LEVELS=Object.freeze({Defender:Object.freeze({blood_pressure:2,retaliatory_assault:2,headlong:6,last_stand:6}),Mage:Object.freeze({lightning_speed:2,elemental_shell:2,overheat:6,elemental_resonance:6}),Archer:Object.freeze({finish_the_prey:2,initiative:2,false_trail:6,hunting_rhythm:6})});
// Only gates that became stricter need grandfathering. Server validation also
// requires authoritative prior ownership for v3 saves; v1/v2 prove ownership through validated purchase bookkeeping.
const LEGACY_SKILL_LEVELS=Object.freeze({Defender:Object.freeze({'Кровавый вызов':1}),Mage:Object.freeze({'Грозовой разряд':5,'Стихийное эхо':7})});
const LEGACY_PASSIVE_LEVELS=Object.freeze({Defender:Object.freeze({last_stand:4})});
// Persistence aliases are part of the save contract, not UI copy. Keep them in
// this shared module so browser hydration and server validation cannot drift.
const SKILL_ID_ALIASES=Object.freeze({'Провокация':'Кровавый вызов','Горящая руна':'Ледяное копьё','Прицельный выстрел':'Огненная стрела'});
const PASSIVE_ID_ALIASES=Object.freeze({Mage:Object.freeze({catalyst:'lightning_speed',polarization:'overheat'})});
const canonicalSkillId=id=>SKILL_ID_ALIASES[id]||id;
const canonicalPassiveId=(classId,id)=>PASSIVE_ID_ALIASES[classId]?.[id]||id;
const levelForXp=x=>{let level=1;while(level<20&&x>=XP_THRESHOLDS[level])level+=1;return level};
const pointsForLevel=level=>POINT_REWARDS.slice(1,level+1).reduce((sum,value)=>sum+value,0);
const passiveSlotsForLevel=level=>PASSIVE_SLOT_LEVELS.filter(required=>level>=required).length;
export {XP_THRESHOLDS,POINT_REWARDS,PASSIVE_SLOT_LEVELS,CLASSES,SKILL_LEVELS,PASSIVE_LEVELS,LEGACY_SKILL_LEVELS,LEGACY_PASSIVE_LEVELS,SKILL_ID_ALIASES,PASSIVE_ID_ALIASES,canonicalSkillId,canonicalPassiveId,levelForXp,pointsForLevel,passiveSlotsForLevel};
