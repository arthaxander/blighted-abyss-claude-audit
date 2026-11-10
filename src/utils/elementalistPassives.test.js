import { addEffect, getEffectStackCount } from './effects';
import { initCombatSession, performPlayerAction, processEnemyAI } from './combatUtils';
import { ABILITY_LIBRARY } from '../data/abilityPresets';

const playerData = () => ({
  id: 'elementalist',
  name: 'Элементалист',
  class: 'Mage',
  displayClass: 'Элементалист',
  hp: 200,
  maxHp: 200,
  attack: 10,
  magAtk: 100,
  physDef: 0,
  magicDef: 0,
  speed: 125,
  critChance: 0,
  abilities: [{ name: 'Атака', damage: 1, type: 'physical', cooldown: 0, basic: true, alwaysHits: true }],
  equippedClassPassiveIds: ['lightning_speed'],
});

const enemyData = name => ({
  id: name,
  name,
  hp: 500,
  maxHp: 500,
  attack: 1,
  magAtk: 0,
  physDef: 0,
  magicDef: 0,
  speed: 100,
  critChance: 0,
  abilities: [{ name: 'Атака', damage: 1, type: 'physical', cooldown: 0, basic: true, alwaysHits: true }],
});

const addThreeCharges = (target, source, session, deliberateAction) => {
  for (let index = 0; index < 3; index += 1) {
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session, deliberateAction });
  }
};

describe('Elementalist final passive behavior', () => {
  test('Lightning Speed rewards a Charge discharge once per ability use', () => {
    const session = initCombatSession(playerData(), [enemyData('Цель 1'), enemyData('Цель 2')]);
    const owner = session.state.players[0];
    const [first, second] = session.state.enemies;
    const action = {};
    const startingTurnMeter = owner.turnMeter;

    addThreeCharges(first, owner, session, action);

    expect(owner.turnMeter).toBe(startingTurnMeter + 150);
    expect(owner.effects.find(effect => effect.id === 'speed_boost_minor')).toMatchObject({ remainingTurns: 2 });

    addThreeCharges(second, owner, session, action);
    expect(owner.turnMeter).toBe(startingTurnMeter + 150);

    addThreeCharges(second, owner, session, {});
    expect(owner.turnMeter).toBe(startingTurnMeter + 300);
  });

  test('Lightning Speed accepts Charge discharge from the Elementalists own summon', () => {
    const session = initCombatSession(playerData(), [enemyData('Цель')]);
    const owner = session.state.players[0];
    const summon = {
      id: 'owned-elemental',
      name: 'Элементаль',
      summoned: true,
      summonerId: owner.id,
      hp: 100,
      maxHp: 100,
      magAtk: 80,
      effects: [],
      abilities: [],
    };
    session.state.players.push(summon);
    const startingTurnMeter = owner.turnMeter;

    addThreeCharges(session.state.enemies[0], summon, session, {});

    expect(owner.turnMeter).toBe(startingTurnMeter + 150);
  });

  test('Lightning Speed only reacts to Shock applied by the Elementalist or its summon', () => {
    const ownSession = initCombatSession(playerData(), [enemyData('Своя цель')], { rng: () => 0 });
    const ownOwner = ownSession.state.players[0];
    const ownTarget = ownSession.state.enemies[0];
    addEffect(ownTarget, { id: 'shock', duration: 2 }, jest.fn(), ownOwner, { session: ownSession });
    ownSession.state.initiative.playerReady = false;
    ownOwner.turnMeter = 0;
    ownTarget.turnMeter = 1000;

    processEnemyAI(ownSession);
    expect(ownSession.state.log.some(line => line.includes('Скорость молнии'))).toBe(true);

    const foreignSession = initCombatSession(playerData(), [enemyData('Чужая цель')], { rng: () => 0 });
    const foreignOwner = foreignSession.state.players[0];
    const foreignTarget = foreignSession.state.enemies[0];
    const foreignSource = { id: 'foreign-source', name: 'Чужой источник', magAtk: 100 };
    addEffect(foreignTarget, { id: 'shock', duration: 2 }, jest.fn(), foreignSource, { session: foreignSession });
    foreignSession.state.initiative.playerReady = false;
    foreignOwner.turnMeter = 0;
    foreignTarget.turnMeter = 1000;

    processEnemyAI(foreignSession);
    expect(foreignSession.state.log.some(line => line.includes('Скорость молнии'))).toBe(false);
  });
  test('Overheat builds from Ice and Lightning and empowers the next attacking Fire ability', () => {
    const elementalAbility = (name, school, damage = 100, targeting = 'enemy') => ({
      name,
      damage,
      type: damage > 0 ? 'magical' : 'support',
      school,
      targeting,
      cooldown: 0,
      alwaysHits: true,
    });
    const abilities = [
      elementalAbility('Тестовый лёд', 'ice'),
      elementalAbility('Тестовая молния', 'lightning'),
      elementalAbility('Тестовый огонь', 'fire'),
    ];
    const session = initCombatSession({
      ...playerData(),
      abilities,
      equippedClassPassiveIds: ['overheat'],
    }, [enemyData('Манекен')]);
    const owner = session.state.players[0];
    const target = session.state.enemies[0];
    const ready = () => {
      session.state.initiative.playerReady = true;
      owner.turnMeter = 1000;
    };

    ready();
    performPlayerAction(session, 'Тестовый лёд', 0);
    expect(getEffectStackCount(owner, 'overheat')).toBe(1);

    ready();
    performPlayerAction(session, 'Тестовая молния', 0);
    expect(getEffectStackCount(owner, 'overheat')).toBe(2);

    const hpBeforeFire = target.hp;
    ready();
    performPlayerAction(session, 'Тестовый огонь', 0);

    expect(hpBeforeFire - target.hp).toBe(140);
    expect(getEffectStackCount(owner, 'overheat')).toBe(0);
    expect(getEffectStackCount(target, 'charring')).toBe(1);
  });

  test('Frost Shield builds Overheat while non-attacking Fire does not spend it', () => {
    const quietFire = {
      name: 'Тихий огонь',
      damage: 0,
      type: 'support',
      school: 'fire',
      targeting: 'self',
      cooldown: 0,
    };
    const session = initCombatSession({
      ...playerData(),
      abilities: [ABILITY_LIBRARY['Морозный щит'], quietFire],
      equippedClassPassiveIds: ['overheat'],
    }, [enemyData('Манекен')]);
    const owner = session.state.players[0];
    const ready = () => {
      session.state.initiative.playerReady = true;
      owner.turnMeter = 1000;
    };

    ready();
    performPlayerAction(session, 'Морозный щит', 0);
    expect(getEffectStackCount(owner, 'overheat')).toBe(1);

    ready();
    performPlayerAction(session, 'Тихий огонь', 0);
    expect(getEffectStackCount(owner, 'overheat')).toBe(1);
  });

  test.each([
    [1, 20],
    [2, 20],
    [3, 20],
  ])('Elemental Shell grants 10% Shield on a charge trigger regardless of %i targets', (targetCount, expectedShield) => {
    const reactionFire = {
      name: 'Реакционный огонь',
      damage: 10,
      type: 'magical',
      school: 'fire',
      targeting: 'allEnemies',
      cooldown: 0,
      alwaysHits: true,
      effect: { id: 'burn', duration: 2 },
    };
    const session = initCombatSession({
      ...playerData(),
      abilities: [reactionFire],
      equippedClassPassiveIds: ['elemental_shell'],
    }, Array.from({ length: targetCount }, (_, index) => enemyData(`Цель ${index + 1}`)));
    const owner = session.state.players[0];

    session.state.enemies.forEach(target => {
      addEffect(target, { id: 'shock', duration: 2 }, jest.fn(), { id: 'setup-source', magAtk: 1 }, { session });
    });
    session.state.initiative.playerReady = true;
    owner.turnMeter = 1000;

    performPlayerAction(session, 'Реакционный огонь', 0);
    expect(owner.shield).toBe(0);
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Реакционный огонь', 0);

    expect(owner.shield).toBe(expectedShield);
    expect(owner.effects.find(effect => effect.id === 'shield')).toMatchObject({ remainingTurns: 2 });
    expect(session.state.log.some(line => line.includes('Стихийная оболочка'))).toBe(true);
  });

  test('Elemental Resonance replaces the old same-school damage and splash ramp', () => {
    const fire = {
      name: 'Резонансный огонь',
      damage: 100,
      type: 'magical',
      school: 'fire',
      targeting: 'enemy',
      cooldown: 0,
      alwaysHits: true,
    };
    const session = initCombatSession({
      ...playerData(),
      abilities: [fire],
      equippedClassPassiveIds: ['elemental_resonance'],
    }, [enemyData('Основная цель'), enemyData('Соседняя цель')]);
    const owner = session.state.players[0];
    const [primary, other] = session.state.enemies;
    const ready = () => {
      session.state.initiative.playerReady = true;
      owner.turnMeter = 1000;
    };

    ready();
    const firstBefore = primary.hp;
    const otherBefore = other.hp;
    performPlayerAction(session, 'Резонансный огонь', 0);
    expect(firstBefore - primary.hp).toBe(100);
    expect(other.hp).toBe(otherBefore);
    expect(getEffectStackCount(primary, 'charring')).toBe(1);

    ready();
    const secondBefore = primary.hp;
    performPlayerAction(session, 'Резонансный огонь', 0);
    expect(secondBefore - primary.hp).toBe(189); // 105 direct + 84 charge explosion at two Charring stacks.
    expect(other.hp).toBe(otherBefore - 75);
    expect(getEffectStackCount(primary, 'charring')).toBe(2);
  });

  test.each([
    [0, 'charge'],
    [0.99, 'conductivity'],
  ])('Lightning Resonance rolls once per use and applies %s to every hit target', (roll, expectedEffect) => {
    const lightning = {
      name: 'Резонансная молния',
      damage: 10,
      type: 'magical',
      school: 'lightning',
      targeting: 'allEnemies',
      cooldown: 0,
      alwaysHits: true,
    };
    const session = initCombatSession({
      ...playerData(),
      abilities: [lightning],
      equippedClassPassiveIds: ['elemental_resonance'],
      critChance: 0,
    }, [enemyData('Цель 1'), enemyData('Цель 2'), enemyData('Цель 3')], { rng: () => roll });
    const owner = session.state.players[0];
    session.state.initiative.playerReady = true;
    owner.turnMeter = 1000;

    performPlayerAction(session, 'Резонансная молния', 0);

    session.state.enemies.forEach(target => {
      expect(target.effects.some(effect => effect.id === expectedEffect)).toBe(true);
      const opposite = expectedEffect === 'charge' ? 'conductivity' : 'charge';
      expect(target.effects.some(effect => effect.id === opposite)).toBe(false);
    });
  });

  test('Elemental Resonance includes ordinary secondary targets of the same ability', () => {
    const session = initCombatSession({
      ...playerData(),
      abilities: [ABILITY_LIBRARY['Огненный шар']],
      equippedClassPassiveIds: ['elemental_resonance'],
    }, [enemyData('Основная цель'), enemyData('Цель 2'), enemyData('Цель 3')]);
    const owner = session.state.players[0];
    const primary = session.state.enemies[0];
    addEffect(primary, { id: 'burn', duration: 2 }, jest.fn(), owner, { session });
    session.state.initiative.playerReady = true;
    owner.turnMeter = 1000;

    performPlayerAction(session, 'Огненный шар', 0);

    session.state.enemies.forEach(target => {
      expect(getEffectStackCount(target, 'charring')).toBe(1);
    });
  });

  test('refreshed Shock uses the latest source for Lightning Speed ownership', () => {
    const session = initCombatSession(playerData(), [enemyData('Обновлённая цель')], { rng: () => 0 });
    const owner = session.state.players[0];
    const target = session.state.enemies[0];
    const foreignSource = { id: 'foreign-refresh-source', name: 'Чужой источник', magAtk: 100 };

    addEffect(target, { id: 'shock', duration: 2 }, jest.fn(), owner, { session });
    addEffect(target, { id: 'shock', duration: 2 }, jest.fn(), foreignSource, { session });
    session.state.initiative.playerReady = false;
    owner.turnMeter = 0;
    target.turnMeter = 1000;

    processEnemyAI(session);

    expect(session.state.log.some(line => line.includes('Скорость молнии'))).toBe(false);
  });

});
