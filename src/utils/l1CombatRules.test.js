import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { allEnemies, createEnemyInstanceByName } from '../data/enemies';
import { MAGIC_SCHOOLS } from '../constants/magicSchools';
import { addEffect, cleanseEffects, processEffects, removeRandomNegativeEffect } from './effects';
import { selectEnemyAction, triggerOnDeath } from './combatUtils';

const effectTarget = () => ({ name: 'Цель', hp: 200, maxHp: 200, physDef: 0, magicDef: 0, effects: [], turnMeter: 500 });
const applyDescriptors = (target, descriptors, source) => (Array.isArray(descriptors) ? descriptors : [descriptors]).forEach(effect => addEffect(target, effect, () => {}, source));

describe('L1 enemy offensive rules', () => {
  test('basic profile is fixed from base stats while damage uses the corresponding current stat', () => {
    const basic = ABILITY_LIBRARY['Атака'];
    const physical = { baseAttack: 18, baseMagAtk: 10, attack: 7, magAtk: 30 };
    expect(basic.typeResolver({ attacker: physical })).toBe('physical');
    expect(basic.damage({ attacker: physical })).toBe(7);
    const magical = { baseAttack: 6, baseMagAtk: 15, attack: 30, magAtk: 8, primaryMagicSchool: MAGIC_SCHOOLS.NATURE };
    expect(basic.typeResolver({ attacker: magical })).toBe('magical');
    expect(basic.damage({ attacker: magical })).toBe(8);
    expect(basic.schoolResolver({ attacker: magical })).toBe(MAGIC_SCHOOLS.NATURE);
    expect(basic.typeResolver({ attacker: { baseAttack: 10, baseMagAtk: 10, attack: 1, magAtk: 99 } })).toBe('physical');
  });

  test('named Attack and MagAtk abilities never adapt to the currently higher stat', () => {
    expect(ABILITY_LIBRARY['Рваный наскок'].damage({ attacker: { attack: 5, magAtk: 99 } })).toBe(7);
    expect(ABILITY_LIBRARY['Споровой шторм'].damage({ attacker: { attack: 99, magAtk: 5 } })).toBe(5);
  });

  test('boss and elite tuning scales explicit MagAtk as a first-class offensive stat', () => {
    const boss = allEnemies.find(enemy => enemy.name === 'Троглодит-мицелий (босс)');
    const elite = allEnemies.find(enemy => enemy.name === 'Искажённый троглодит-тотемщик');
    expect(boss.magAtk).toBeGreaterThan(boss.baseMagAtk);
    expect(elite.magAtk).toBeGreaterThan(elite.baseMagAtk);
  });
});

describe('independent Poison', () => {
  test('applications retain independent durations/sources and tick independently; cleansing removes the whole type', () => {
    const target = effectTarget();
    const weak = { id: 'weak', name: 'Слабый', attack: 2 };
    const strong = { id: 'strong', name: 'Сильный', attack: 8 };
    addEffect(target, { id: 'poison', duration: 1 }, () => {}, weak);
    addEffect(target, { id: 'poison', duration: 3 }, () => {}, strong);
    expect(target.effects.map(effect => effect.remainingTurns)).toEqual([1, 3]);
    expect(target.effects.map(effect => effect.sourceSnapshot.attack)).toEqual([2, 8]);
    const before = target.hp;
    processEffects(target, () => {});
    expect(target.hp).toBeLessThan(before - 10);
    expect(target.effects.filter(effect => effect.id === 'poison')).toHaveLength(1);
    addEffect(target, { id: 'poison', duration: 2 }, () => {}, weak);
    expect(removeRandomNegativeEffect(target, () => 0)).toMatchObject({ id: 'poison' });
    expect(target.effects.filter(effect => effect.id === 'poison')).toHaveLength(0);
    cleanseEffects(target, (_effect, metadata) => metadata?.type === 'debuff');
    expect(target.effects.filter(effect => effect.id === 'poison')).toHaveLength(0);
  });

  test('snake, Spore Storm, spore death, and two heads add exact independent Poison counts', () => {
    const target = effectTarget(); const source = { attack: 10, magAtk: 10 };
    applyDescriptors(target, ABILITY_LIBRARY['Чумной укус'].effect, source);
    applyDescriptors(target, ABILITY_LIBRARY['Споровой шторм'].effect, source);
    expect(target.effects.filter(effect => effect.id === 'poison')).toHaveLength(2);
    const spore = createEnemyInstanceByName('Троглодит-споровик'); spore.hp = 0;
    triggerOnDeath(spore, null, { state: { enemies: [spore], players: [target] } });
    expect(target.effects.filter(effect => effect.id === 'poison')).toHaveLength(3);
    applyDescriptors(target, ABILITY_LIBRARY['Двойной укус'].effect, source);
    expect(target.effects.filter(effect => effect.id === 'poison')).toHaveLength(5);
  });
});

describe('Mushroom Caves redesigned kits', () => {
  test('Spearman controls with Slow but no direct TM rollback; stance is active', () => {
    const target = effectTarget(); const ability = ABILITY_LIBRARY['Сдерживающий выпад'];
    const tm = target.turnMeter; applyDescriptors(target, ability.effect, { attack: 16 });
    ability.apply?.({ target });
    expect(target.effects.some(effect => effect.id === 'speed_penalty_minor')).toBe(true);
    expect(target.turnMeter).toBe(tm);
    expect(ABILITY_LIBRARY['Стойка копья']).toMatchObject({ cooldown: 3, targeting: 'self' });
    expect(ABILITY_LIBRARY['Стойка копья'].passive).not.toBe(true);
  });

  test('Snake Caller avoids a full battlefield and failed summon grants no defense fallback', () => {
    const caller = createEnemyInstanceByName('Троглодит-заклинатель змей');
    const full = { state: { enemies: Array.from({ length: 6 }, () => ({ hp: 1 })), players: [effectTarget()] } };
    expect(ABILITY_LIBRARY['Змеиный зов'].canUse({ session: full })).toBe(false);
    ABILITY_LIBRARY['Змеиный зов'].apply({ attacker: caller, session: { ...full, summonEnemy: () => ({ success: false }) } });
    expect(full.state.enemies.every(enemy => !enemy.effects)).toBe(true);
    expect(ABILITY_LIBRARY['Хоровод ядовитых змей']).toMatchObject({ scalingStat: 'magAtk', school: MAGIC_SCHOOLS.NATURE });
  });

  test('Shaman heals 30%, cleanses one debuff, targets injured ally, and has no fungal kit', () => {
    const shaman = createEnemyInstanceByName('Троглодит-шаман');
    const healthy = { name: 'Здоровый', hp: 100, maxHp: 100, effects: [] };
    const injured = { name: 'Раненый', hp: 40, maxHp: 100, effects: [] };
    addEffect(injured, { id: 'poison', duration: 2 }, () => {}, shaman);
    ABILITY_LIBRARY['Костяной обряд'].apply({ target: injured, log: () => {} });
    expect(injured.hp).toBe(70); expect(injured.effects).toHaveLength(0);
    const decision = selectEnemyAction(shaman, { state: { enemies: [shaman, healthy, injured], players: [effectTarget()] } });
    expect(decision.primary).toBe(injured);
    expect(shaman.abilityNames).not.toEqual(expect.arrayContaining(['Споровой щит', 'Споровой шторм', 'Грибной симбиоз']));
  });

  test('Infected prepares Poison first, then steals 15% TM once per later action', () => {
    const passive = ABILITY_LIBRARY['Паразитический рефлекс']; const owner = { turnMeter: 0 }; const target = effectTarget();
    const first = {}; passive.onDamageDealt({ owner, target, context: { directAttack: true, targetWasPoisoned: false, deliberateAction: first } });
    expect([owner.turnMeter, target.turnMeter]).toEqual([0, 500]);
    const second = {}; passive.onDamageDealt({ owner, target, context: { directAttack: true, targetWasPoisoned: true, deliberateAction: second } });
    passive.onDamageDealt({ owner, target, context: { directAttack: true, targetWasPoisoned: true, deliberateAction: second } });
    expect([owner.turnMeter, target.turnMeter]).toEqual([150, 350]);
    passive.onDamageDealt({ owner, target, context: { directAttack: false, targetWasPoisoned: true, deliberateAction: {} } });
    expect([owner.turnMeter, target.turnMeter]).toEqual([150, 350]);
  });

  test('cursed and boss kits use focused Blood, Lightning, and Poison mechanics', () => {
    const snakehead = createEnemyInstanceByName('Осквернённый троглодит-змееголов');
    expect(snakehead.abilityNames).toEqual(expect.arrayContaining(['Кровавый укус', 'Кровавая линька']));
    expect(snakehead.abilityNames).not.toContain('Змеиная ловкость');
    const totemist = createEnemyInstanceByName('Искажённый троглодит-тотемщик');
    expect(totemist.abilityNames).toEqual(expect.arrayContaining(['Наращивание тотема', 'Призматический удар']));
    expect(ABILITY_LIBRARY['Призматический удар'].school).toBe(MAGIC_SCHOOLS.LIGHTNING);
    expect(totemist.abilityNames).not.toEqual(expect.arrayContaining(['Грибной симбиоз', 'Споровой шторм']));
  });

  test('Mycelium heals exactly 8% only for poisoned hero and permanently stops after phase transition', () => {
    const boss = createEnemyInstanceByName('Троглодит-мицелий (босс)'); boss.hp = boss.maxHp - 100;
    const hero = effectTarget(); const summon = effectTarget(); const session = { state: { players: [hero, summon], enemies: [boss] } };
    addEffect(summon, { id: 'poison' }, () => {}, boss); ABILITY_LIBRARY['Мицелиевое питание'].onTurnStart({ owner: boss, session });
    expect(boss.hp).toBe(boss.maxHp - 100);
    addEffect(hero, { id: 'poison' }, () => {}, boss); addEffect(hero, { id: 'poison' }, () => {}, boss);
    ABILITY_LIBRARY['Мицелиевое питание'].onTurnStart({ owner: boss, session });
    expect(boss.hp).toBe(boss.maxHp - 100 + Math.round(boss.maxHp * 0.08));
    boss.hp = Math.floor(boss.maxHp * 0.5); ABILITY_LIBRARY['Сжатие мицелия'].onTurnStart({ owner: boss, session, log: () => {} });
    const phaseHp = boss.hp; ABILITY_LIBRARY['Мицелиевое питание'].onTurnStart({ owner: boss, session });
    expect(boss.hp).toBe(phaseHp); expect(boss._myceliumPhaseTwoTriggered).toBe(true);
    expect(ABILITY_LIBRARY['Споровой паралич']).toMatchObject({ scalingStat: 'magAtk', school: MAGIC_SCHOOLS.NATURE });
  });
});
