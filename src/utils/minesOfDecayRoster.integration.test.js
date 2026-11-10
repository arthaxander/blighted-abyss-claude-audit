import { createAbilityByName, ABILITY_LIBRARY } from '../data/abilityPresets';
import { createEnemyInstanceByName, getEnemyBlueprintByName, enemies } from '../data/enemies';
import { MINES_LOCATION, MINES_BOSS, registerMinesBleedTick, transitionMinesBossPhase, transferMinesStatus } from '../data/minesAbilities';
import { MINES_NORMAL_TEMPLATES, MINES_STRONG_TEMPLATES, createMinesOfDecayEncounter, createCursedEncounter } from './enemyPools';
import { addEffect, cleanseEffects, getEffectStackCount, isEffectTransferable, processEffects } from './effects';
import { initCombatSession, processEnemyAI } from './combatUtils';
import levelTwoLocations from '../data/levelTwoLocations.json';
import { ENEMY_PORTRAITS, resolveEnemyPortrait } from '../data/combatAssets';
import fs from 'fs';
import path from 'path';

const normal = ['Обугленный громила','Рудный носильщик','Закованный охранник','Шахтёр с киркой','Тлеющий бык'];
const strong = ['Старший надзиратель','Мастер крепей','Забывший маркшейдер'];
const cursed = ['Искажённый взрывник','Осквернённый лекарь'];
const hero = (overrides = {}) => ({
  name: 'Герой', hp: 900, maxHp: 900, attack: 100, magAtk: 50,
  speed: 100, physDef: 0, magicDef: 0, shield: 0, effects: [], abilities: ['Атака'],
  ...overrides,
});
const prepare = (name, options = {}) => {
  const enemy = createEnemyInstanceByName(name, { rng: () => 0.01, idPrefix: 'mines-test' });
  return initCombatSession(hero(options.hero || {}), [enemy], { rng: () => 0.99 });
};

test('Mines location is selectable with its complete authored roster', () => {
  expect(levelTwoLocations.find(entry => entry.id === 'mines_of_decay')).toMatchObject({ enabled: true, name: MINES_LOCATION });
  expect(levelTwoLocations.find(entry => entry.id === 'uncharted_region')).toBeUndefined();
  expect(enemies.filter(enemy => enemy.location === MINES_LOCATION)).toHaveLength(11);
});

test('exact authored roster: 5 normal, 3 strong, 2 cursed, 1 boss; all presets are real', () => {
  const expectedStats = [
    [normal[0],350,21,18,12,8,118,'normalEnemy'],
    [normal[1],270,20,1,7,11,124,'normalEnemy'],
    [normal[2],430,17,1,21,13,107,'normalEnemy'],
    [normal[3],270,20,1,9,9,133,'normalEnemy'],
    [normal[4],370,23,1,14,9,122,'normalEnemy'],
    [strong[0],500,22,1,14,11,126,'strongEnemy'],
    [strong[1],600,24,1,22,14,112,'strongEnemy'],
    [strong[2],450,12,27,8,15,138,'strongEnemy'],
    [cursed[0],920,29,24,21,21,141,'cursedEnemy'],
    [cursed[1],880,22,31,14,19,128,'cursedEnemy'],
    [MINES_BOSS,2350,30,31,21,23,154,'boss'],
  ];
  expectedStats.forEach(([name,hp,attack,magAtk,physDef,magicDef,speed,role]) => {
    const blueprint = getEnemyBlueprintByName(name);
    expect(blueprint).toMatchObject({ maxHp: hp, hp, attack, magAtk, physDef, magicDef, speed, roomRole: role });
    const runtime = createEnemyInstanceByName(name, { rng:()=>0, idPrefix:'roster-test' });
    expect(runtime).toBeTruthy();
    blueprint.abilityNames.forEach(key => {
      expect(ABILITY_LIBRARY[key]).toBeTruthy();
      expect(createAbilityByName(key).presetKey).toBe(key);
    });
  });
});

test('authored packs include exactly 3 combatants and strong packs only 1 strong', () => {
  const mineEnemies = enemies.filter(enemy => enemy.location === MINES_LOCATION);
  expect(MINES_NORMAL_TEMPLATES).toHaveLength(8);
  expect(MINES_STRONG_TEMPLATES).toHaveLength(9);
  [...MINES_NORMAL_TEMPLATES, ...MINES_STRONG_TEMPLATES].forEach(template => {
    expect(template.names).toHaveLength(3);
    expect(template.names.filter(name => strong.includes(name))).toHaveLength(template.strength === 'strong' ? 1 : 0);
  });
  expect(createMinesOfDecayEncounter(mineEnemies, () => 0, { completedCombatRooms: 0 }).enemies).toHaveLength(3);
  const late = createMinesOfDecayEncounter(mineEnemies, () => 0, { requireStrong: true });
  expect(late.encounterStrength).toBe('strong');
  expect(late.enemies.filter(enemy => strong.includes(enemy.name))).toHaveLength(1);
  const encounter = createCursedEncounter(mineEnemies.filter(enemy => !enemy.boss), () => 0);
  expect(cursed).toContain(encounter.enemies[0].name);
  expect(encounter.enemies).toHaveLength(1);
});

test('bomber begins battle with 3 unremovable supplies, uses 3 AoE hits and triggers the discharge', () => {
  const session = prepare(cursed[0]);
  const bomber = session.state.enemies[0];
  const player = session.state.players[0];
  expect(getEffectStackCount(bomber, 'supplies')).toBe(3);
  const bomb = bomber.abilities.find(skill => skill.name === 'Бросок бомбами');
  const hits = [];
  bomb.apply({
    attacker: bomber, targets: [player], session, log: jest.fn(),
    applyDirectDamage: (target, damage) => {
      hits.push(damage);
      target.hp -= damage;
      return { damage };
    },
  });
  expect(hits).toHaveLength(3);
  expect(hits).toEqual([23,23,23]);
  expect(getEffectStackCount(bomber, 'supplies')).toBe(0);
  expect(player.effects.some(effect => effect.id === 'burn')).toBe(true);
  expect(getEffectStackCount(player, 'charge')).toBe(0);
  expect(bomb.canUse({ attacker: bomber })).toBe(false);
});

test('blood transfusion uses extending bleed duration; rapid clotting gains flat base speed', () => {
  const session = prepare(cursed[1]);
  const healer = session.state.enemies[0];
  const player = session.state.players[0];
  healer.abilities.find(skill => skill.name === 'Переливание крови').apply({
    attacker: healer, target: player, session, log: jest.fn(),
  });
  expect(player.effects.filter(effect => effect.id === 'bleed')).toHaveLength(1);
  expect(healer.effects.filter(effect => effect.id === 'bleed')).toHaveLength(1);
  expect(player.effects.find(effect => effect.id === 'bleed').remainingTurns).toBe(2);
  expect(healer.effects.find(effect => effect.id === 'bleed').remainingTurns).toBe(2);
  const before = healer.speed;
  registerMinesBleedTick(session);
  registerMinesBleedTick(session);
  expect(healer.speed).toBe(before + 10);
  expect(healer.baseStats.speed).toBe(138);
  addEffect(healer, { id: 'speed_boost_minor', duration: 2 }, jest.fn(), healer, { session });
  expect(healer.speed).toBe(Math.round(138 * 1.15));
  cleanseEffects(healer, eff => eff.id === 'speed_boost_minor', jest.fn());
  expect(healer.speed).toBe(138);
});

test('protected buffs/debuffs cannot be stolen or transferred, removable stats can', () => {
  const session = prepare(MINES_BOSS);
  const boss = session.state.enemies[0];
  const player = session.state.players[0];
  addEffect(player, { id: 'thirst' }, jest.fn(), player, { session });
  const protectedBuff = player.effects.find(effect => effect.id === 'thirst');
  expect(isEffectTransferable(protectedBuff)).toBe(false);
  expect(transferMinesStatus(player, boss, protectedBuff, boss, session)).toBe(false);
  addEffect(player, { id: 'attack_boost_minor', duration: 2 }, jest.fn(), player, { session });
  const transferable = player.effects.find(effect => effect.id === 'attack_boost_minor');
  expect(player.attack).toBe(125);
  expect(transferMinesStatus(player, boss, transferable, boss, session)).toBe(true);
  expect(player.attack).toBe(100);
  expect(boss.effects.some(effect => effect.id === 'attack_boost_minor')).toBe(true);
  expect(player.effects.some(effect => effect.id === 'thirst')).toBe(true);
});

test('boss phase triggers exactly once, applies teamwide mark and gates melt until hero turn', () => {
  const session = prepare(MINES_BOSS);
  const boss = session.state.enemies[0];
  const player = session.state.players[0];
  const summon = hero({ name:'Призыв', hp:300, maxHp:300, summoned:true });
  session.state.players.push(summon);
  boss.hp = boss.maxHp * 0.5;
  expect(transitionMinesBossPhase(boss, session, jest.fn())).toBe(true);
  expect(transitionMinesBossPhase(boss, session, jest.fn())).toBe(false);
  expect(boss._minesPhase).toBe(2);
  expect(player.effects.some(effect => effect.id === 'searing_mark')).toBe(true);
  expect(summon.effects.some(effect => effect.id === 'searing_mark')).toBe(true);
  const melt = boss.abilities.find(skill => skill.name === 'Переплавка');
  expect(melt.canUse({ attacker: boss, opponents: [player,summon] })).toBe(false);
  boss._minesPhaseAwaitingHeroTurn = false;
  expect(melt.canUse({ attacker: boss, opponents: [player,summon] })).toBe(true);
});

test('Master blocks one removable debuff for at most two turns', () => {
  const session = prepare(strong[1]);
  const master = session.state.enemies[0];
  addEffect(master, { id: 'mines_guard_block', duration: 2 }, jest.fn(), master, { session });
  expect(master.effects.some(effect => effect.id === 'mines_guard_block')).toBe(true);
  expect(addEffect(master, { id:'bleed',duration:2 }, jest.fn(), session.state.players[0], { session })).toBeNull();
  expect(master.effects.some(effect => effect.id === 'mines_guard_block')).toBe(false);
  expect(master.effects.some(effect => effect.id === 'bleed')).toBe(false);
});

test('all 11 Mines portraits resolve to real WebP files and preserve exact assigned keys', () => {
  const portraitNames = new Map([
    ['Обугленный громила', 'mines_hook_brute'],
    ['Осквернённый лекарь', 'mines_defiled_healer'],
    ['Искажённый взрывник', 'mines_warped_bomber'],
    ['Тлеющий бык', 'mines_scorched_bull'],
    ['Забывший маркшейдер', 'mines_forgotten_surveyor'],
    ['Закованный охранник', 'mines_shackled_guard'],
    ['Рудный носильщик', 'mines_ore_porter'],
    ['Шахтёр с киркой', 'mines_pickaxe_worker'],
    ['Мастер крепей', 'mines_support_master'],
    ['Старший надзиратель', 'mines_overseer'],
    [MINES_BOSS, 'mines_zolotoplavets'],
  ]);
  expect(portraitNames.size).toBe(11);
  for (const [name, portraitKey] of portraitNames) {
    const blueprint = getEnemyBlueprintByName(name);
    expect(blueprint.portraitKey).toBe(portraitKey);
    const uri = resolveEnemyPortrait(blueprint);
    expect(uri).toBe(ENEMY_PORTRAITS[portraitKey]);
    expect(uri).toContain('/portraits/enemies/mines_of_decay/');
    const relative = uri.split('/assets/combat/')[1];
    const filePath = path.join(__dirname, '../../public/assets/combat', relative);
    expect(fs.existsSync(filePath)).toBe(true);
    const header = fs.readFileSync(filePath).subarray(0, 30);
    expect(header.toString('ascii', 0, 4)).toBe('RIFF');
    expect(header.toString('ascii', 8, 12)).toBe('WEBP');
    // WebP dimensions live in the VP8/VP8L/VP8X payload header.
    const chunk = header.toString('ascii', 12, 16);
    let width = 0; let height = 0;
    if (chunk === 'VP8 ') {
      width = header.readUInt16LE(26) & 0x3fff;
      height = header.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L') {
      expect(header[20]).toBe(0x2f);
      width = 1 + header[21] + ((header[22] & 0x3f) << 8);
      height = 1 + (header[22] >> 6) + (header[23] << 2) + ((header[24] & 0x0f) << 10);
    } else if (chunk === 'VP8X') {
      width = 1 + header[24] + (header[25] << 8) + (header[26] << 16);
      height = 1 + header[27] + (header[28] << 8) + (header[29] << 16);
    }
    expect(Math.min(width, height)).toBe(512);
  }
});
