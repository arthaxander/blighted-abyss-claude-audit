import { addEffect, EFFECT_LIBRARY } from './effects';
import { initCombatSession, processEnemyAI } from './combatUtils';
import { MAGIC_SCHOOLS } from '../constants/magicSchools';

const playerData = {
  name: 'Герой',
  hp: 100,
  maxHp: 100,
  attack: 10,
  magAtk: 10,
  abilities: [{ name: 'Атака', damage: 1, type: 'physical', cooldown: 0, alwaysHits: true }],
};

const enemyData = name => ({
  name,
  hp: 500,
  maxHp: 500,
  attack: 1,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  abilities: [{ name: 'Ожидание', damage: 0, type: 'physical', cooldown: 0, alwaysHits: true }],
});

const readyEnemy = (session, enemy) => {
  session.state.initiative.playerReady = false;
  session.state.players[0].turnMeter = 0;
  enemy.turnMeter = 1000;
};

const observeDamageContexts = unit => {
  const contexts = [];
  unit.abilities.push({
    name: 'Наблюдатель школы',
    passive: true,
    onOwnerDamaged: ({ context }) => contexts.push(context),
  });
  return contexts;
};

describe('current effect-generated magical school propagation', () => {
  test('Burn snapshot/Max-HP base and half-base ally splash carry Fire', () => {
    const session = initCombatSession(playerData, [enemyData('Горящая цель'), enemyData('Союзник')]);
    const [target, ally] = session.state.enemies;
    const source = { name: 'Пиромант', hp: 100, maxHp: 100, magAtk: 10 };
    const targetContexts = observeDamageContexts(target);
    const allyContexts = observeDamageContexts(ally);
    addEffect(target, { id: 'burn', duration: 1 }, jest.fn(), source, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    expect(target.hp).toBe(480);
    expect(ally.hp).toBe(490);
    expect(targetContexts).toHaveLength(1);
    expect(allyContexts).toHaveLength(1);
    [...targetContexts, ...allyContexts].forEach(context => {
      expect(context).toMatchObject({ source, isPeriodic: true, fromEffect: 'burn' });
      expect(context.magicSchool).toBe(MAGIC_SCHOOLS.FIRE);
    });
  });

  test('Poison keeps its physical component schoolless and marks only magical damage as Death', () => {
    const session = initCombatSession(playerData, [enemyData('Отравленная цель')]);
    const target = session.state.enemies[0];
    const contexts = observeDamageContexts(target);
    addEffect(target, { id: 'poison', duration: 1 }, jest.fn(), { name: 'Алхимик', hp: 100, attack: 10 }, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    expect(target.hp).toBe(485);
    expect(contexts).toHaveLength(2);
    expect(contexts.map(context => context.damageType)).toEqual(['physical', 'magical']);
    contexts.forEach(context => expect(context.isPeriodic).toBe(true));
    expect(contexts[0].magicSchool).toBeNull();
    expect(contexts[1].magicSchool).toBe(MAGIC_SCHOOLS.DEATH);
  });

  test('Gloom carries canonical Darkness through the generic helper', () => {
    const session = initCombatSession(playerData, [enemyData('Мрачная цель')]);
    const target = session.state.enemies[0];
    const contexts = observeDamageContexts(target);
    addEffect(target, { id: 'gloom', duration: 1 }, jest.fn(), { name: 'Чернокнижник', hp: 100, magAtk: 10 }, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    expect(target.hp).toBe(496);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ damageType: 'magical', isPeriodic: true, fromEffect: 'gloom' });
    expect(contexts[0].magicSchool).toBe(MAGIC_SCHOOLS.DARKNESS);
  });

  test('Searing Mark is the control case that reaches reactions as Light', () => {
    const session = initCombatSession(playerData, [enemyData('Отмеченная цель')]);
    const target = session.state.enemies[0];
    const contexts = observeDamageContexts(target);
    const source = { name: 'Жрец', hp: 100, maxHp: 100, magAtk: 10 };
    addEffect(target, { id: 'searing_mark', duration: 1 }, jest.fn(), source, { session });
    readyEnemy(session, target);

    processEnemyAI(session);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      source,
      damageType: 'magical',
      magicSchool: MAGIC_SCHOOLS.LIGHT,
      isPeriodic: true,
      fromEffect: 'searing_mark',
    });
  });

  test('Decay release explicitly requests Death and remains non-periodic', () => {
    const applyDamage = jest.fn();
    const source = { name: 'Источник порчи' };
    const target = { name: 'Цель', hp: 100, maxHp: 100, magicDef: 20 };
    const effect = { id: 'decay', sourceRef: source, extra: { accumulated: 20 } };

    EFFECT_LIBRARY.decay.onExpire({ target, effect, context: { applyDamage } });

    expect(applyDamage).toHaveBeenCalledWith(target, 20, 'magical', {
      source,
      ignoreDefenseFraction: 0.3,
      magicSchool: MAGIC_SCHOOLS.DEATH,
      fromEffect: 'decay',
    });
  });

  test('Flame Rune immediate bonus requests no school and is not periodic', () => {
    const applyDamage = jest.fn(() => 4);
    const attacker = { name: 'Маг', hp: 100, magAtk: 10 };
    const target = { name: 'Цель', hp: 100, maxHp: 100, effects: [] };
    const effect = {
      id: 'flame_rune',
      sourceRef: attacker,
      sourceSnapshot: { magAtk: 10, entity: attacker },
      extra: { bonusMultiplier: 0.4 },
    };
    target.effects.push(effect);

    EFFECT_LIBRARY.flame_rune.onDamageTaken({
      target,
      effect,
      context: {
        source: attacker,
        damageType: 'magical',
        directAttack: true,
        magicSchool: 'fire',
        applyDamage,
        log: jest.fn(),
      },
    });

    expect(EFFECT_LIBRARY.flame_rune.legacyOnly).toBe(true);
    expect(applyDamage).not.toHaveBeenCalled();
  });
});
