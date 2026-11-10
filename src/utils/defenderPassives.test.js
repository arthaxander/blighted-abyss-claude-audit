import { addEffect, EFFECT_LIBRARY, processEffects } from './effects';
import { createAbilityByName } from '../data/abilityPresets';
import { buildPlayerSnapshot, hydratePlayerSnapshot } from './playerState';
import { prepareFreshDungeonRun } from './dungeonRunState';
import { applyDamage, consumeRetaliatoryAssault, getBloodPressureSpeedBonus, getEffectiveSpeed, getRetaliatoryAssaultBonuses, initCombatSession, performPlayerAction, processEnemyAI, registerRetaliatoryAssaultAttack, TURN_METER_THRESHOLD } from './combatUtils';

const unit = (overrides={}) => ({ name:'Защитник', hp:100, maxHp:100, physDef:0, magicDef:0, shield:0, turnMeter:0, effects:[], equippedClassPassiveIds:[], ...overrides });

test('Blood Pressure uses the largest living enemy Bleed and exact speed thresholds without accumulating', () => {
  const defender = unit({ speed:100, equippedClassPassiveIds:['blood_pressure'] });
  const enemies = [unit({effects:[{id:'bleed',remainingTurns:3}]}), unit({effects:[{id:'bleed',remainingTurns:8}]})];
  const session = {state:{enemies}};
  expect(getBloodPressureSpeedBonus(defender,enemies)).toBe(.4);
  expect(getEffectiveSpeed(defender,session)).toBe(140);
  expect(getEffectiveSpeed(defender,session)).toBe(140);
  enemies[0].effects=[];
  for (const [charges, expected] of [[1,0],[2,.1],[3,.1],[9,.4],[10,.5],[20,.5]]) {
    enemies[1].effects=[{id:'bleed',remainingTurns:charges}];
    expect(getBloodPressureSpeedBonus(defender,enemies)).toBe(expected);
  }
  enemies[0].effects=[{id:'bleed',remainingTurns:3}];
  enemies[1].effects=[]; expect(getBloodPressureSpeedBonus(defender,enemies)).toBe(.1);
  enemies[0].hp=0; expect(getBloodPressureSpeedBonus(defender,enemies)).toBe(0);
  defender.passivesDisabled=true; expect(getEffectiveSpeed(defender,session)).toBe(100);
  defender.passivesDisabled=false; enemies[1].effects=[{id:'bleed',remainingTurns:6}]; expect(getEffectiveSpeed(defender,session)).toBe(130);
});

test('Retaliatory Assault counts repeated attacks to three and only then exposes its damage bonus', () => {
  const defender=unit({equippedClassPassiveIds:['retaliatory_assault']});
  expect(registerRetaliatoryAssaultAttack(defender,{id:'a'})).toBe(1);
  expect(registerRetaliatoryAssaultAttack(defender,{id:'a'})).toBe(2);
  expect(getRetaliatoryAssaultBonuses(defender)).toEqual({stacks:2,defensePercent:0,directDamagePercent:0});
  registerRetaliatoryAssaultAttack(defender,{id:'a'}); registerRetaliatoryAssaultAttack(defender,{id:'a'});
  expect(getRetaliatoryAssaultBonuses(defender)).toEqual({stacks:3,defensePercent:0,directDamagePercent:.5});
  expect(defender.effects.find(e=>e.id==='retaliatory_assault')).toMatchObject({name:'Ответный натиск',stacks:3});
});

test('real enemy actions count a shielded multihit once while a miss gives no charge', () => {
  const defender={name:'D',class:'Defender',hp:100,maxHp:100,shield:30,physDef:0,speed:1,effects:[],abilities:[],equippedClassPassiveIds:['retaliatory_assault']};
  const enemy={id:'same',name:'Враг',hp:100,maxHp:100,attack:10,physDef:0,speed:100,critChance:0,effects:[],abilities:[{name:'Серия',damage:10,type:'physical',hitCount:3,cooldown:0,alwaysHits:true}]};
  const session=initCombatSession(defender,[enemy],{rng:()=>.99});
  session.state.players[0].turnMeter=999; session.state.enemies[0].turnMeter=1000;
  processEnemyAI(session);
  expect(session.state.players[0].shield).toBe(0);
  expect(session.state.players[0].retaliatoryAssaultStacks).toBe(1);
  session.state.enemies[0].abilities=[{name:'Промах',damage:10,type:'physical',cooldown:0,accuracy:0}];
  session.state.players[0].turnMeter=999; session.state.enemies[0].turnMeter=1000;
  processEnemyAI(session);
  expect(session.state.players[0].retaliatoryAssaultStacks).toBe(1);
});

test('Last Stand intercepts one hostile lethal packet, grants canonical Shield and meter, then can die', () => {
  const log=[]; const defender=unit({equippedClassPassiveIds:['last_stand']});
  applyDamage(defender,200,'pure',{source:{id:'enemy'},logFn:text=>log.push(text)});
  expect(defender.hp).toBe(31); expect(defender.shield).toBe(50); expect(defender.turnMeter).toBe(TURN_METER_THRESHOLD); expect(log.join(' ')).toContain('Последний рубеж');
  defender.shield=0; applyDamage(defender,40,'pure',{source:{id:'enemy'}}); expect(defender.hp).toBe(0);
});

test('Last Stand is no longer amplified by Headlong and meter still clamps', () => {
  const defender=unit({turnMeter:900,equippedClassPassiveIds:['last_stand','headlong'],_hasPhysicalShield:false});
  applyDamage(defender,999,'pure',{source:{id:'enemy'}});
  expect(defender.shield).toBe(50); expect(defender.turnMeter).toBe(TURN_METER_THRESHOLD);
});

test('a real enemy multihit continues after Last Stand and cannot save twice', () => {
  const defender={name:'D',class:'Defender',hp:20,maxHp:100,physDef:0,speed:1,effects:[],abilities:[],equippedClassPassiveIds:['last_stand']};
  const enemy={id:'enemy',name:'Палач',hp:100,maxHp:100,attack:200,physDef:0,speed:100,critChance:0,effects:[],abilities:[{name:'Казнь',damage:200,type:'pure',hitCount:2,cooldown:0,alwaysHits:true}]};
  const session=initCombatSession(defender,[enemy],{rng:()=>.5});
  session.state.players[0].turnMeter=999; session.state.enemies[0].turnMeter=1000;
  processEnemyAI(session);
  expect(session.state.players[0]).toMatchObject({hp:0,lastStandConsumed:true,_lastStandConsumed:true});
});

test('Last Stand consumption survives combat reconstruction and serialization, but a fresh run resets it', () => {
  const spent=unit({class:'Defender',abilityNames:[],equipment:{},equippedClassPassiveIds:['last_stand'],lastStandConsumed:true,_lastStandConsumed:true});
  const nextFight=initCombatSession(spent,[unit({name:'Враг',hp:10})]);
  applyDamage(nextFight.state.players[0],999,'pure',{source:nextFight.state.enemies[0],session:nextFight});
  expect(nextFight.state.players[0].hp).toBe(0);
  const loaded=hydratePlayerSnapshot(JSON.parse(JSON.stringify(buildPlayerSnapshot(spent))));
  expect(loaded.lastStandConsumed).toBe(true);
  expect(prepareFreshDungeonRun(loaded,'Грибные пещеры')).toMatchObject({lastStandConsumed:false,_lastStandConsumed:false});
});

test('Last Stand triggered by start-of-turn periodic damage grants a full three-turn Shield', () => {
  const defender=unit({hp:10,equippedClassPassiveIds:['last_stand']});
  const enemy=unit({name:'Источник',attack:100});
  addEffect(defender,{id:'bleed',duration:1},jest.fn(),enemy);
  processEffects(defender,jest.fn(),{
    applyDamage:(target,amount,type,extra)=>applyDamage(target,amount,type,{...extra,source:enemy}),
    applyHealing:(target,amount)=>amount,
  });
  expect(defender.hp).toBe(31);
  expect(defender.effects.find(effect=>effect.id==='shield')).toMatchObject({remainingTurns:3});
});

const headlongSession = ({ ability={}, equipment={}, passive=true, enemyShield=0, heroShield=0, enemyHp=100, rng=()=>.5 }={}) => {
  const configured = {name:'Навык',damage:20,type:'physical',cooldown:0,alwaysHits:true,...ability};
  const session=initCombatSession({name:'D',class:'Defender',hp:100,maxHp:100,attack:20,critChance:0,speed:100,equipment,
    abilities:[configured],equippedClassPassiveIds:passive?['headlong']:[]},
  [{name:'A',hp:enemyHp,maxHp:enemyHp,shield:enemyShield,physDef:0,magicDef:0,speed:1,effects:[],abilities:[]}],{rng});
  const target=session.state.enemies[0];
  if(enemyShield) addEffect(target,{id:'shield',value:enemyShield,duration:3},jest.fn(),target,{session});
  if(heroShield) addEffect(session.state.players[0],{id:'shield',value:heroShield,duration:3},jest.fn(),session.state.players[0],{session});
  session.state.initiative.playerReady=true;
  performPlayerAction(session,configured.name,0);
  return session;
};

test('Headlong checks item classification, Shield damage, misses, basics, ticks, and Brokenness', () => {
  expect(headlongSession().state.players[0].shield).toBe(12);
  expect(headlongSession({heroShield:7}).state.players[0].shield).toBe(19);
  expect(headlongSession({enemyHp:10}).state.players[0].shield).toBe(12);
  expect(headlongSession({enemyShield:50}).state.players[0].shield).toBe(12);
  expect(headlongSession({equipment:{offHand:'Щит Дозорного Гильдии'}}).state.players[0].shield).toBe(0);
  expect(headlongSession({ability:{basic:true}}).state.players[0].shield).toBe(0);
  expect(headlongSession({ability:{alwaysHits:false,accuracy:0},rng:()=>.99}).state.players[0].shield).toBe(0);
  const broken=headlongSession({passive:false});
  const hero=broken.state.players[0]; hero.equippedClassPassiveIds=['headlong']; hero.passivesDisabled=true;
  broken.state.initiative.playerReady=true; performPlayerAction(broken,'Навык',0); expect(hero.shield).toBe(0);
  hero.passivesDisabled=false; broken.state.initiative.playerReady=true; performPlayerAction(broken,'Навык',0); expect(hero.shield).toBe(12);
  const dot=headlongSession({ability:{damage:0,apply:({target,applyDamage})=>applyDamage(target,10,'physical',{directAttack:false,fromEffect:'bleed'})}});
  expect(dot.state.players[0].shield).toBe(0);
});

test.each([{targeting:'allEnemies'},{hitCount:3}])('Headlong triggers once after an entire multi-target/multi-hit ability: %o', variant => {
  const observed=[];
  const session=headlongSession({ability:{...variant,apply:({attacker})=>observed.push(attacker.shield)}});
  expect(observed).toEqual([0]);
  expect(session.state.players[0].shield).toBe(12);
  expect(session.state.players[0].effects.filter(effect=>effect.id==='shield')).toHaveLength(1);
});

test('Retaliatory Assault preserves 1–2 charges, then empowers every direct hit and target once', () => {
  const ability={name:'Размашистый удар',damage:20,type:'physical',targeting:'allEnemies',hitCount:2,cooldown:0,alwaysHits:true};
  const make = stacks => {
    const session=initCombatSession({name:'D',class:'Defender',hp:100,maxHp:100,attack:20,critChance:0,speed:100,
      abilities:[ability],equippedClassPassiveIds:['retaliatory_assault'],retaliatoryAssaultStacks:stacks},
    [unit({name:'A',hp:100,maxHp:100}),unit({name:'B',hp:100,maxHp:100})],{rng:()=>.5});
    session.state.initiative.playerReady=true;
    performPlayerAction(session,ability.name,0);
    return session;
  };
  const held=make(2);
  expect(held.state.enemies.map(enemy=>enemy.hp)).toEqual([60,60]);
  expect(held.state.players[0].retaliatoryAssaultStacks).toBe(2);
  const spent=make(3);
  expect(spent.state.enemies.map(enemy=>enemy.hp)).toEqual([40,40]);
  expect(spent.state.players[0].retaliatoryAssaultStacks).toBe(0);
});

test('Blood Pressure updates through a real bleeding combat action', () => {
  const session=initCombatSession({name:'D',class:'Defender',hp:100,maxHp:100,attack:20,speed:100,critChance:0,
    abilities:[createAbilityByName('Кровавый таран')],equippedClassPassiveIds:['blood_pressure']},
  [{name:'A',hp:100,maxHp:100,physDef:0,magicDef:0,speed:1,effects:[],abilities:[]}],{rng:()=>.5});
  session.state.initiative.playerReady=true; performPlayerAction(session,'Ранящий удар',0);
  expect(getEffectiveSpeed(session.state.players[0],session)).toBe(100);
  session.state.enemies[0].effects.find(effect=>effect.id==='bleed').remainingTurns=2;
  expect(getEffectiveSpeed(session.state.players[0],session)).toBe(110);
});

test.each([
  ['HP нескольких целей', [unit({name:'A',hp:100}),unit({name:'B',hp:100})]],
  ['только вражеский Щит', [unit({name:'A',hp:100,shield:100})]],
])('Headlong resolves once after delayed Ram damage to %s', (_label, enemies) => {
  const session=initCombatSession({id:'hero',name:'D',class:'Defender',hp:100,maxHp:100,attack:20,speed:100,critChance:0,
    abilities:[createAbilityByName('Таран')],equippedClassPassiveIds:['headlong']},enemies,{rng:()=>.5});
  enemies.forEach((enemy,index) => {
    if(enemy.shield) addEffect(session.state.enemies[index],{id:'shield',value:enemy.shield,duration:3},jest.fn(),session.state.enemies[index],{session});
  });
  session.state.initiative.playerReady=true;
  performPlayerAction(session,'Таран',0);
  const hero=session.state.players[0];
  const preparationShield=hero.shield;
  expect(hero.effects.some(effect=>effect.id==='defender_ram_prepared')).toBe(true);
  expect(preparationShield).toBeGreaterThan(0);

  processEnemyAI(session);

  expect(hero.effects.some(effect=>effect.id==='defender_ram_prepared')).toBe(false);
  expect(hero.shield).toBe(preparationShield+12);
  expect(hero.effects.find(effect=>effect.id==='shield')?.remainingTurns).toBe(3);
  if (_label === 'HP нескольких целей') expect(session.state.enemies.map(enemy=>enemy.hp)).toEqual([70,70]);
  else expect(session.state.enemies[0].hp).toBe(100);
});

test('Ram preparation preserves retaliation and delayed impact reads current stacks for every target before consuming once', () => {
  const defender=unit({attack:40,equippedClassPassiveIds:['retaliatory_assault']});
  registerRetaliatoryAssaultAttack(defender,{id:'before'});
  createAbilityByName('Таран').apply({attacker:defender,session:{state:{players:[defender],enemies:[]}},log:jest.fn()});
  expect(getRetaliatoryAssaultBonuses(defender)).toMatchObject({stacks:1,defensePercent:0,directDamagePercent:0});
  registerRetaliatoryAssaultAttack(defender,{id:'during-a'});
  registerRetaliatoryAssaultAttack(defender,{id:'during-b'});
  const prepared=defender.effects.find(effect=>effect.id==='defender_ram_prepared');
  const enemies=[unit({name:'A'}),unit({name:'B'}),unit({name:'C'})];
  const multipliers=[];
  const consume=jest.fn(target=>consumeRetaliatoryAssault(target));
  EFFECT_LIBRARY.defender_ram_prepared.onTick({target:defender,effect:prepared,log:jest.fn(),context:{
    getOpponents:()=>enemies,
    getRetaliatoryAssaultBonuses,
    consumeRetaliatoryAssault:consume,
    applyDamage:(target,amount,type,options)=>{ multipliers.push(options.directDamageMultiplier); return applyDamage(target,amount,type,options); },
  }});
  expect(multipliers).toEqual([1.5,1.5,1.5]);
  expect(enemies.map(enemy=>enemy.hp)).toEqual([10,10,10]);
  expect(consume).toHaveBeenCalledTimes(1);
  expect(defender.retaliatoryAssaultStacks).toBe(0);
  expect(defender.effects.some(effect=>effect.id==='retaliatory_assault')).toBe(false);
});

test('Brokenness neither gains nor spends retaliation and suppresses Last Stand', () => {
  const defender=unit({equippedClassPassiveIds:['retaliatory_assault','last_stand'],retaliatoryAssaultStacks:3,passivesDisabled:true});
  expect(registerRetaliatoryAssaultAttack(defender,{id:'enemy'})).toBe(3);
  expect(getRetaliatoryAssaultBonuses(defender)).toEqual({stacks:0,defensePercent:0,directDamagePercent:0});
  applyDamage(defender,200,'pure',{source:{id:'enemy'}});
  expect(defender.hp).toBe(0);
  expect(defender.lastStandConsumed).toBeUndefined();
  expect(defender.retaliatoryAssaultStacks).toBe(3);
});
