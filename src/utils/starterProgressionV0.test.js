import { ABILITY_LIBRARY, createAbilityByName } from '../data/abilityPresets';
import { CLASS_PROGRESSION_DEFINITIONS, createClassProgressionRecord } from '../data/classProgression';
import { createFireElemental, initCombatSession, notifyElementalReaction, applyDamage, processEnemyAI } from './combatUtils';
import { beginCombatPresentation, consumeCombatPresentationEvents } from './combatPresentationEvents';
import { addEffect, EFFECT_LIBRARY } from './effects';
import { createEncounterPair, FUNGAL_LOCATION, MUSHROOM_DUPLICATE_CHANCE, MUSHROOM_DUPLICATE_WEIGHTS } from './enemyPools';
import { BASE_RESONANCE_BY_ENEMY_RANK, calculateEncounterResonance, shouldShowRelicResonanceTransfer, transferRunResonance } from './abyssResonance';

describe('starter progression v0', () => {
  test.each([
    ['Mage', ['Буран','Призыв элементаля','Грозовой разряд','Стихийное эхо'], ['lightning_speed','overheat','elemental_shell','elemental_resonance']],
    ['Archer', ['Волчья яма','Перенаправление','Залп стрел','Змеиная ловушка'], ['finish_the_prey','initiative','false_trail','hunting_rhythm']],
  ])('%s exposes four authored actives and passives', (id, actives, passives) => {
    const def=CLASS_PROGRESSION_DEFINITIONS[id];
    expect(def.skills.slice(-4).map(x=>x.id)).toEqual(actives);
    expect(def.skills.slice(-4).map(x=>x.requiredLevel)).toEqual([3,5,7,9]);
    expect(def.passiveSkills.map(x=>x.id)).toEqual(passives);
    expect(createClassProgressionRecord(id).activeSkillIds).toHaveLength(4);
  });
  test('Blood Challenge keeps Provocation status and exact structured terms', () => {
    const ability=createAbilityByName('Кровавый вызов'); expect(ability.name).toBe('Кровавый вызов');
    expect(EFFECT_LIBRARY.provoked.name).toBe('Провокация');
    expect(ability.descriptionParts.filter(x=>x?.statusId).map(x=>x.statusId)).toEqual(['provoked','provoked','shield','bleed']);
  });
  test('Blizzard and Storm Discharge use pre-existing conditions', () => {
    const blizzard=ABILITY_LIBRARY['Буран']; const fresh={effects:[]}; expect(blizzard.damage({attacker:{magAtk:100},target:fresh})).toBe(120); expect(fresh._blizzardWasSlowed).toBe(false);
    const slowed={effects:[{id:'speed_penalty_minor'}]}; blizzard.damage({attacker:{magAtk:100},target:slowed}); expect(slowed._blizzardWasSlowed).toBe(true);
    const storm=ABILITY_LIBRARY['Грозовой разряд']; const target={effects:[],turnMeter:500}; expect(storm.damage({attacker:{magAtk:100},target})).toBe(175); addEffect(target,{id:'shock',duration:1}); expect(storm.damage({attacker:{magAtk:100},target})).toBe(225); storm.apply({target}); expect(target.turnMeter).toBe(300);
  });
  test('Echo has no default school and independently rolls secondary statuses', () => {
    const echo=ABILITY_LIBRARY['Стихийное эхо']; expect(echo.canUse({attacker:{}})).toBe(false); expect(echo.canUse({attacker:{_lastElementalSchool:'fire'}})).toBe(true);
    const targets=[{hp:10,effects:[]},{hp:10,effects:[]},{hp:10,effects:[]}]; const session={rng:jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(.99)};
    echo.apply({attacker:{_lastElementalSchool:'fire'},target:targets[0],targets,session,log:jest.fn()}); expect(targets[1].effects[0].id).toBe('burn'); expect(targets[2].effects[0].id).toBe('shock');
  });
  test('Fire Elemental snapshots permanent base stats and owns exact kit', () => {
    const ally=createFireElemental({baseStats:{maxHp:101,attack:21,magAtk:31,physDef:11,magicDef:21,speed:101},magAtk:999});
    expect(ally).toMatchObject({maxHp:51,attack:4,magAtk:19,physDef:6,magicDef:13,speed:91,primaryMagicSchool:'fire'});
    expect(ally.abilities.map(x=>x.name)).toEqual(['Огненный сгусток','Разжечь','Пылающее ядро']);
    expect(ABILITY_LIBRARY['Разжечь'].damage({attacker:{magAtk:100}})).toBe(110);
  });
  test('Fire Elemental actions enter the shared combat presentation queue', () => {
    const session = initCombatSession({ name: 'Маг', class: 'Mage', hp: 100, maxHp: 100, attack: 5, magAtk: 50, speed: 100, abilities: [createAbilityByName('Атака')] }, [{ name: 'Манекен', hp: 500, maxHp: 500, attack: 0, speed: 1, abilities: [] }]);
    const ally = session.summonPlayer('fire_elemental', { source: session.state.players[0] }).ally;
    beginCombatPresentation(session);
    session.state.players[0].turnMeter = 0; ally.turnMeter = 1000; session.state.enemies[0].turnMeter = 0;
    processEnemyAI(session);
    const action = consumeCombatPresentationEvents(session).find(event => event.type === 'actionStart' && event.actor === ally);
    expect(action?.action?.name).toBe('Разжечь');
  });
  test('Elemental Shell is limited once per owner turn', () => {
    const owner={class:'Mage',id:'hero',hp:100,maxHp:100,turnMeter:0,effects:[],equippedClassPassiveIds:['lightning_speed','elemental_shell','overheat'],_turnSerial:1}; const target={effects:[]}; const session={state:{players:[owner],enemies:[target]}};
    notifyElementalReaction(owner,target,'fire',session); notifyElementalReaction(owner,target,'ice',session);
    expect(owner.turnMeter).toBe(0); expect(owner.shield).toBe(10); expect(target._polarizationSchool).toBeUndefined();
  });
});

describe('Mushroom duplicate packs and Resonance', () => {
  const unit=(name,family='normal_troglodytes',phase='early')=>({name,location:FUNGAL_LOCATION,encounterFamily:family,encounterPhase:phase});
  test('20% duplicate branch respects allowlist, family and max two',()=>{
    expect(MUSHROOM_DUPLICATE_CHANCE).toBe(.2); expect(MUSHROOM_DUPLICATE_WEIGHTS['Одичавший троглодит']).toBe(.5);
    const pool=[unit('Троглодит-копейщик'),unit('Троглодит-шаман')]; const pack=createEncounterPair(pool,jest.fn().mockReturnValueOnce(.1).mockReturnValueOnce(0),{location:FUNGAL_LOCATION}); expect(pack.map(x=>x.name)).toEqual(['Троглодит-копейщик','Троглодит-копейщик']); expect(pack).toHaveLength(2);
    const excluded=createEncounterPair([unit('Троглодит-шаман'),unit('Троглодит-заклинатель змей')],()=>.1,{location:FUNGAL_LOCATION}); expect(excluded).toHaveLength(2); expect(new Set(excluded.map(x=>x.name)).size).toBe(2);
  });
  test('central Resonance values are per authored reward enemy and exclude summons',()=>{
    expect(BASE_RESONANCE_BY_ENEMY_RANK).toEqual({ordinary:1,strong:3,cursed:5,boss:15});
    expect(calculateEncounterResonance([{rewardId:'a',rank:'ordinary'},{rewardId:'b',rank:'strong'},{rewardId:'c',rank:'miniBoss',cursed:true},{rewardId:'d',rank:'boss'},{rewardId:'s',rank:'boss',summoned:true}],1)).toBe(24);
  });
  test('extraction transfer is 1:1 and clears run counter',()=>{ const result=transferRunResonance({runResonance:125,relics:{activeRelicId:'recruit_seal',progress:{recruit_seal:{level:0,xp:0}}}}); expect(result.player.runResonance).toBe(0); expect(result.oldProgress).toEqual({level:1,xp:0}); expect(result.newProgress).toEqual({level:2,xp:25}); expect(shouldShowRelicResonanceTransfer(result)).toBe(true); expect(shouldShowRelicResonanceTransfer({...result,amount:0})).toBe(false); expect(shouldShowRelicResonanceTransfer({...result,oldProgress:{level:10,xp:0}})).toBe(false); });
});

describe('direct class combat hooks', () => {
  test('Blood Challenge converts only direct HP loss and scales with Bleed turns', () => {
    const hero={id:'hero',name:'Защитник',hp:100,maxHp:100,shield:0,effects:[]}; const enemy={id:'enemy',name:'Враг',hp:100,maxHp:100,attack:20,physDef:0,magicDef:0,effects:[]}; const session={state:{players:[hero],enemies:[enemy]}};
    ABILITY_LIBRARY['Кровавый вызов'].apply({attacker:hero,targets:[enemy],session,log:jest.fn()});
    applyDamage(hero,20,'physical',{source:enemy,session,directAttack:true}); expect(hero.hp).toBe(80); expect(hero.shield).toBe(10);
    hero.effects=[]; hero.shield=0; enemy.effects=[]; ABILITY_LIBRARY['Кровавый вызов'].apply({attacker:hero,targets:[enemy],session,log:jest.fn()}); addEffect(enemy,{id:'bleed',duration:6},jest.fn(),hero,{session});
    applyDamage(hero,20,'physical',{source:enemy,session,directAttack:true}); expect(hero.shield).toBe(16);
    hero.effects=[]; hero.shield=20; enemy.effects=[]; ABILITY_LIBRARY['Кровавый вызов'].apply({attacker:hero,targets:[enemy],session,log:jest.fn()}); applyDamage(hero,10,'physical',{source:enemy,session,directAttack:true}); expect(hero.hp).toBe(60); expect(hero.shield).toBe(10);
  });
});
