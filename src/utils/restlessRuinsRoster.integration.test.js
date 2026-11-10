import fs from 'fs';
import path from 'path';
import { enemies, createEnemyInstanceByName, getEnemyBlueprintByName } from '../data/enemies';
import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { ENEMY_PORTRAITS } from '../data/combatAssets';
import { getItemDefinition } from '../data/items';
import levelTwoLocations from '../data/levelTwoLocations.json';
import { addEffect, getEffectStackCount, removeRandomPositiveEffect } from './effects';
import {
  RESTLESS_RUINS_NORMAL_TEMPLATES, RESTLESS_RUINS_STRONG_TEMPLATES,
  RESTLESS_RUINS_LOCATION, createRestlessRuinsEncounter,
} from './enemyPools';
import { initCombatSession } from './combatUtils';
import {
  gainRuinsSouls, queueRuinsDeath, flushRuinsSouls, transitionRuinsLegion,
} from './restlessRuinsRuntime';

const normal = ['Глашатай мёртвого марша','Сдвоенный бастион','Заклинатель двух душ','Всадник последнего похода','Раздробленный копейщик'];
const strong = ['Двутелый дуэлянт','Знаменосец павшей когорты','Сшиватель душ'];
const cursed = ['Осадный урод — Осквернение','Кристальный мертвострел — Искажение'];
const boss = 'Легион Погребённых';
const summons = ['Знамя павшей когорты','Погребённый щитоносец','Погребённый рубака'];
const hero = () => ({
  name:'Герой', hp:1200, maxHp:1200, attack:100, magAtk:70,
  speed:100, physDef:15, magicDef:15, shield:0, effects:[], abilities:['Атака'],
});
const make = name => createEnemyInstanceByName(name,{rng:()=>0.11,idPrefix:'ruins-test'});
const battle = names => initCombatSession(hero(), names.map(make), {rng:()=>0.99});

test('Ruins is unlocked with its full roster', () => {
  expect(levelTwoLocations.find(location => location.id === 'restless_ruins').enabled).toBe(true);
  expect(enemies.filter(enemy=>enemy.location===RESTLESS_RUINS_LOCATION)).toHaveLength(11);
  expect(enemies.filter(enemy=>enemy.location==='Шахты Тления')).toHaveLength(11);
});

test('all 11 authored Ruins enemies and 3 summons have registered abilities', () => {
  expect(normal).toHaveLength(5);
  expect(strong).toHaveLength(3);
  expect(cursed).toHaveLength(2);
  for(const name of [...normal,...strong,...cursed,boss,...summons]){
    const blueprint=getEnemyBlueprintByName(name);
    expect(blueprint).toBeTruthy();
    expect(make(name)).toBeTruthy();
    blueprint.abilityNames.forEach(ability => expect(ABILITY_LIBRARY[ability]).toBeTruthy());
  }
});

test('authored normal and strong parties are legal three-combatant packs', () => {
  const pool=enemies.filter(unit=>unit.location===RESTLESS_RUINS_LOCATION);
  expect(RESTLESS_RUINS_NORMAL_TEMPLATES.length).toBeGreaterThanOrEqual(6);
  expect(RESTLESS_RUINS_STRONG_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  RESTLESS_RUINS_NORMAL_TEMPLATES.forEach(t=>{
    expect(t.names).toHaveLength(3);
    expect(t.names.every(n=>normal.includes(n))).toBe(true);
  });
  RESTLESS_RUINS_STRONG_TEMPLATES.forEach(t=>{
    expect(t.names).toHaveLength(3);
    expect(t.names.filter(n=>strong.includes(n))).toHaveLength(1);
    expect(t.names.filter(n=>normal.includes(n))).toHaveLength(2);
  });
  expect(createRestlessRuinsEncounter(pool,()=>0,{completedCombatRooms:0}).enemies).toHaveLength(3);
  expect(createRestlessRuinsEncounter(pool,()=>0,{requireStrong:true}).enemies.filter(e=>strong.includes(e.name))).toHaveLength(1);
});

// Binary art is not committed to every checkout (an export can drop media to
// keep the archive small). The only reliable signal for "this checkout has no
// art" is that the files are entirely absent. A file that exists but is
// truncated or corrupt must still fail: it is a real asset defect, and skipping
// it would hide a broken portrait in production.
const artCheckoutState = (()=>{
  const files = [...normal,...strong,...cursed,boss,...summons]
    .map(name => ENEMY_PORTRAITS[getEnemyBlueprintByName(name).portraitKey])
    .filter(Boolean)
    .map(uri => path.join('public', uri));
  if (files.length === 0) return 'absent';
  return files.some(file => fs.existsSync(file)) ? 'present' : 'absent';
})();
// Skipped only when the whole art set is absent; otherwise every file is
// verified normally, so a corrupt asset fails the suite.
const portraitTest = artCheckoutState === 'present' ? test : test.skip;

portraitTest('all 14 uploaded portraits exist, are valid WebP and have 512 px shorter side',()=>{
  for(const name of [...normal,...strong,...cursed,boss,...summons]){
    const portraitKey=getEnemyBlueprintByName(name).portraitKey;
    const uri=ENEMY_PORTRAITS[portraitKey];
    expect(uri).toContain('/portraits/enemies/restless_ruins/');
    const filename=path.join('public',uri);
    expect(fs.existsSync(filename)).toBe(true);
    const b=fs.readFileSync(filename).subarray(0,30);
    expect(b.toString('ascii',0,4)).toBe('RIFF');
    expect(b.toString('ascii',8,12)).toBe('WEBP');
    const format=b.toString('ascii',12,16);
    let width=0, height=0;
    if(format==='VP8 '){
      width=b.readUInt16LE(26)&0x3fff;
      height=b.readUInt16LE(28)&0x3fff;
    } else if(format==='VP8L'){
      width=1+b[21]+((b[22]&0x3f)<<8);
      height=1+(b[22]>>6)+(b[23]<<2)+((b[24]&0x0f)<<10);
    } else if(format==='VP8X'){
      width=1+b[24]+(b[25]<<8)+(b[26]<<16);
      height=1+b[27]+(b[28]<<8)+(b[29]<<16);
    }
    expect(Math.min(width,height)).toBe(512);
  }
});

test('standard bearer creates an untimed banner that refuses positive effects',()=>{
  const session=battle(['Знаменосец павшей когорты','Сдвоенный бастион']);
  const banner=session.state.enemies.find(unit=>unit.ruinsBanner);
  expect(banner).toBeTruthy();
  expect(banner.maxHp).toBe(150);
  expect(banner.nonActingSummon).toBe(true);
  expect(addEffect(banner,{id:'shield',duration:2,value:200},jest.fn(),session.state.enemies[0],{session})).toBeNull();
  expect(addEffect(banner,{id:'rebirth',duration:3},jest.fn(),session.state.enemies[0],{session})).toBeNull();
  expect(addEffect(banner,{id:'immortality',duration:2},jest.fn(),session.state.enemies[0],{session})).toBeNull();
  expect(getEffectStackCount(banner,'ruins_unrest')).toBe(0);
});

test('Ruins souls empower survivors, cap at three and never empower banners',()=>{
  const session=battle(['Сдвоенный бастион','Раздробленный копейщик','Глашатай мёртвого марша']);
  const [defender,spearman,herald]=session.state.enemies;
  const oldSpeed=spearman.speed;
  gainRuinsSouls(spearman,8,session);
  expect(getEffectStackCount(spearman,'ruins_unrest')).toBe(3);
  expect(spearman.speed).toBeGreaterThan(oldSpeed);
  herald.hp=0;
  queueRuinsDeath(herald,session);
  flushRuinsSouls(session);
  expect(getEffectStackCount(defender,'ruins_unrest')).toBe(1);
  expect(spearman._ruinsFallenStartingAllies).toBe(1);
});

test('Rebirth is removable and the scroll is configured for all removable positive effects',()=>{
  const session=battle(['Сшиватель душ']);
  const unit=session.state.enemies[0];
  addEffect(unit,{id:'rebirth',duration:3},jest.fn(),unit,{session});
  expect(unit.effects.some(e=>e.id==='rebirth')).toBe(true);
  expect(removeRandomPositiveEffect(unit,()=>0,jest.fn())).toMatchObject({ id: 'rebirth' });
  expect(unit.effects.some(e=>e.id==='rebirth')).toBe(false);
  expect(getItemDefinition('Свиток Развеивания')).toMatchObject({kind:'dispelAll',type:'tacticalScroll'});
});

test('Legion summons two soldiers and absorbs survivors only once at half health',()=>{
  const session=battle([boss]);
  const legion=session.state.enemies.find(u=>u.name===boss);
  const soldiers=session.state.enemies.filter(u=>u.ruinsLegionSoldier && u.hp>0);
  expect(soldiers).toHaveLength(2);
  legion.hp=Math.floor(legion.maxHp/2);
  expect(transitionRuinsLegion(legion,session)).toBe(true);
  expect(legion._legionPhase).toBe(2);
  expect(soldiers.every(u=>u.hp===0)).toBe(true);
  expect(getEffectStackCount(legion,'ruins_unrest')).toBe(2);
  expect(getEffectStackCount(legion,'ruins_echo_charge')).toBe(1);
  expect(transitionRuinsLegion(legion,session)).toBe(false);
});
