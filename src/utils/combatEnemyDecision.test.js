import { getEffectStackCount } from './effects';
import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { createEnemyInstanceByName } from '../data/enemies';
import { reviveAbility } from '../components/CombatScreen';
import { addEffect } from './effects';
import { initCombatSession, processEnemyAI, selectEnemyAction } from './combatUtils';

const basic = { name: 'Атака', basic: true, damage: 1, cooldown: 0, alwaysHits: true };
const player = { name: 'Герой', hp: 100, maxHp: 100, attack: 1, speed: 100, physDef: 0, magicDef: 0, abilities: [basic] };
const enemy = (name, abilities, overrides = {}) => ({
  name,
  hp: 100,
  maxHp: 100,
  attack: 10,
  speed: 10,
  physDef: 0,
  magicDef: 0,
  abilities,
  ...overrides,
});

const makeActorReady = (session, actor) => {
  session.state.players[0].turnMeter = 999;
  session.state.enemies.forEach(unit => { unit.turnMeter = unit === actor ? 1000 : 0; });
  session.state.initiative.playerReady = false;
};

describe('conditional enemy ability and target selection', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('target modes distinguish one ally, all allies, self, and default hostile target', () => {
    const single = { name: 'Один союзник', targeting: 'ally', damage: 0, cooldown: 1, targetScore: ({ target }) => 100 - target.hp };
    const group = { name: 'Все союзники', targeting: 'allAllies', damage: 0, cooldown: 1 };
    const self = { name: 'На себя', targeting: 'self', damage: 0, cooldown: 1 };
    const hostile = { name: 'Враг', damage: 1, cooldown: 1 };
    const session = initCombatSession(player, [
      enemy('Кастер', [single, group, self, hostile, basic]),
      enemy('Раненый', [basic], { hp: 20 }),
      enemy('Здоровый', [basic], { hp: 80 }),
    ]);
    const actor = session.state.enemies[0];

    expect(selectEnemyAction({ ...actor, abilities: [single] }, session)).toMatchObject({
      primary: expect.objectContaining({ name: 'Раненый' }),
      targets: [expect.objectContaining({ name: 'Раненый' })],
    });
    expect(selectEnemyAction({ ...actor, abilities: [group] }, session).targets.map(unit => unit.name))
      .toEqual(['Кастер', 'Раненый', 'Здоровый']);
    expect(selectEnemyAction({ ...actor, abilities: [self] }, session).primary.name).toBe('Кастер');
    expect(selectEnemyAction({ ...actor, abilities: [hostile] }, session).primary.name).toBe('Герой');
  });

  test('ally effect applies once while allAllies effect applies to every living ally', () => {
    const one = {
      name: 'Одиночное усиление', targeting: 'ally', damage: 0, cooldown: 2,
      targetScore: ({ target }) => target.name === 'Цель' ? 1 : 0,
      effect: { id: 'attack_boost_minor', duration: 2, target: 'ally' },
    };
    const all = {
      name: 'Общее усиление', targeting: 'allAllies', damage: 0, cooldown: 2,
      effect: { id: 'phys_def_boost_minor', duration: 2, target: 'allAllies' },
    };
    const session = initCombatSession(player, [enemy('Кастер', [one, basic]), enemy('Цель', [basic]), enemy('Другой', [basic])]);
    const actor = session.state.enemies[0];
    makeActorReady(session, actor);
    processEnemyAI(session);
    expect(session.state.enemies.map(unit => unit.effects.some(effect => effect.id === 'attack_boost_minor')))
      .toEqual([false, true, false]);

    actor.abilities = [all, basic];
    actor.turnMeter = 1000;
    session.state.players[0].turnMeter = 999;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);
    expect(session.state.enemies.every(unit => unit.effects.some(effect => effect.id === 'phys_def_boost_minor'))).toBe(true);
  });

  test('default order, cooldowns, and canUse remain backward compatible', () => {
    const first = { name: 'Первая', damage: 1, cooldown: 2 };
    const second = { name: 'Вторая', damage: 1, cooldown: 2 };
    const blocked = { name: 'Запрещённая', damage: 1, cooldown: 2, canUse: () => false };
    const session = initCombatSession(player, [enemy('Враг', [first, second, basic])]);
    const actor = session.state.enemies[0];
    expect(selectEnemyAction(actor, session).ability.name).toBe('Первая');
    actor.abilities[0].currentCooldown = 1;
    expect(selectEnemyAction(actor, session).ability.name).toBe('Вторая');
    actor.abilities = [blocked, basic];
    expect(selectEnemyAction(actor, session).ability.name).toBe('Атака');
    actor.abilities = [{ ...blocked, name: 'Ошибка canUse', canUse: () => { throw new Error('bad gate'); } }, basic];
    expect(() => selectEnemyAction(actor, session)).not.toThrow();
    expect(selectEnemyAction(actor, session).ability.name).toBe('Атака');
  });

  test('higher ability score wins while equal and malformed scores preserve declaration order', () => {
    const low = { name: 'Ранняя', damage: 1, cooldown: 1, aiScore: () => 1 };
    const high = { name: 'Поздняя', damage: 1, cooldown: 1, aiScore: () => 2 };
    const broken = { name: 'Сломанная', damage: 1, cooldown: 1, aiScore: () => { throw new Error('bad score'); } };
    const invalid = { name: 'Неконечная', damage: 1, cooldown: 1, aiScore: () => Infinity };
    const session = initCombatSession(player, [enemy('Враг', [low, high, basic])]);
    const actor = session.state.enemies[0];
    expect(selectEnemyAction(actor, session).ability.name).toBe('Поздняя');
    actor.abilities = [{ ...low }, { ...low, name: 'Равная' }, basic];
    expect(selectEnemyAction(actor, session).ability.name).toBe('Ранняя');
    actor.abilities = [broken, invalid, basic];
    expect(() => selectEnemyAction(actor, session)).not.toThrow();
    expect(selectEnemyAction(actor, session).ability.name).toBe('Сломанная');
  });

  test('target score ties preserve authoritative roster order and failures fall back safely', () => {
    const tied = { name: 'Выбор', targeting: 'ally', damage: 0, cooldown: 1, targetScore: () => 5 };
    const broken = { ...tied, name: 'С ошибкой', targetScore: () => { throw new Error('bad target'); } };
    const session = initCombatSession(player, [enemy('Первый', [tied]), enemy('Второй', [basic])]);
    expect(selectEnemyAction(session.state.enemies[0], session).primary.name).toBe('Первый');
    session.state.enemies[0].abilities = [broken];
    expect(() => selectEnemyAction(session.state.enemies[0], session)).not.toThrow();
    expect(selectEnemyAction(session.state.enemies[0], session).primary.name).toBe('Первый');
  });

  test.each([
    ['healthy target', 100, false, 'Приговор палача'],
    ['Weak target', 100, true, 'Казнящий удар'],
    ['wounded target', 49, false, 'Казнящий удар'],
  ])('Executioner chooses setup or payoff for a %s', (_label, hp, weak, expected) => {
    const executioner = createEnemyInstanceByName('Гоблин-палач');
    const session = initCombatSession({ ...player, hp, maxHp: 100 }, [executioner]);
    if (weak) addEffect(session.state.players[0], { id: 'vulnerability', duration: 2 }, () => {}, executioner, { session });
    expect(selectEnemyAction(session.state.enemies[0], session).ability.name).toBe(expected);
  });

  test('Apothecary selects and heals the best ally without secretly reselecting', () => {
    const apothecary = createEnemyInstanceByName('Аптекарь');
    const session = initCombatSession(player, [
      { ...apothecary, hp: 90, maxHp: 100 },
      enemy('Тяжело ранен', [basic], { hp: 20 }),
      enemy('Слегка ранен', [basic], { hp: 80 }),
    ]);
    const actor = session.state.enemies[0];
    makeActorReady(session, actor);
    const decision = selectEnemyAction(actor, session);
    expect(decision.ability.name).toBe('Экстренный стимулятор');
    expect(decision.primary.name).toBe('Тяжело ранен');

    processEnemyAI(session);

    expect(session.state.enemies.map(unit => unit.hp)).toEqual([90, 35, 80]);
    expect(getEffectStackCount(actor, 'supplies')).toBe(1);
  });

  test('Apothecary preserves Field Dressing cleanse utility and skips all healing at full health', () => {
    const apothecary = createEnemyInstanceByName('Аптекарь');
    const session = initCombatSession(player, [apothecary, enemy('Союзник', [basic])]);
    const actor = session.state.enemies[0];
    addEffect(session.state.enemies[1], { id: 'attack_penalty_minor', duration: 2 }, () => {}, session.state.players[0], { session });
    expect(selectEnemyAction(actor, session)).toMatchObject({
      ability: expect.objectContaining({ name: 'Очищающий состав' }),
      primary: expect.objectContaining({ name: 'Союзник' }),
    });
    session.state.enemies[1].effects = [];
    expect(selectEnemyAction(actor, session).ability.name).toBe('Атака');
  });

  test('Field Dressing prioritizes a critical Apothecary over a mildly wounded bleeding tank', () => {
    const apothecary = createEnemyInstanceByName('Аптекарь');
    const tank = enemy('Кристаллолом', [basic], {
      hp: 253,
      maxHp: 305,
    });
    const session = initCombatSession(player, [{ ...apothecary, hp: 1, maxHp: 98 }, tank]);
    const actor = session.state.enemies[0];
    addEffect(session.state.enemies[1], { id: 'bleed', duration: 2 }, () => {}, session.state.players[0], { session });
    actor.abilities = actor.abilities.filter(ability => ['Экстренный стимулятор', 'Атака'].includes(ability.name));

    expect(selectEnemyAction(actor, session)).toMatchObject({
      ability: expect.objectContaining({ name: 'Экстренный стимулятор' }),
      primary: actor,
    });
  });

  test('raw healing prioritizes HP-percent urgency over a larger absolute tank deficit', () => {
    const apothecary = createEnemyInstanceByName('Аптекарь');
    const session = initCombatSession(player, [
      { ...apothecary, hp: 47, maxHp: 98 },
      enemy('Кристаллолом', [basic], { hp: 236, maxHp: 305 }),
    ]);
    const actor = session.state.enemies[0];
    actor.abilities = actor.abilities.filter(ability => ['Экстренный стимулятор', 'Атака'].includes(ability.name));

    expect(selectEnemyAction(actor, session).primary).toBe(actor);
  });

  test('Apothecary treats 53% HP as more urgent than 74% HP', () => {
    const apothecary = createEnemyInstanceByName('Аптекарь');
    const session = initCombatSession(player, [
      { ...apothecary, hp: 53, maxHp: 100 },
      enemy('Союзник', [basic], { hp: 74, maxHp: 100 }),
    ]);
    const actor = session.state.enemies[0];
    actor.abilities = actor.abilities.filter(ability => ['Экстренный стимулятор', 'Атака'].includes(ability.name));

    expect(selectEnemyAction(actor, session).primary).toBe(actor);
  });

  test('Apothecary urgency uses stable 20%-wide bands without a continuous urgency bonus', () => {
    const score = (hp, maxHp = 100) => ABILITY_LIBRARY['Экстренный стимулятор'].targetScore({
      target: { hp, maxHp, effects: [] },
    });

    expect(score(41)).toBe(score(59));
    expect(score(61)).toBe(score(78));

    expect(score(20) - score(20.01)).toBe(100);
    expect(score(40) - score(40.01)).toBe(100);
    expect(score(60) - score(60.01)).toBe(70);
    expect(score(80) - score(80.01)).toBe(50);
  });

  test('Apothecary urgency is independent of absolute max HP at the same health percentage', () => {
    const fieldDressing = ABILITY_LIBRARY['Экстренный стимулятор'];
    const small = fieldDressing.targetScore({ target: { hp: 50, maxHp: 100, effects: [] } });
    const scaled = fieldDressing.targetScore({ target: { hp: 500, maxHp: 1000, effects: [] } });

    expect(scaled).toBe(small);
  });

  test('healing urgency is target-based rather than a hardcoded self preference', () => {
    const apothecary = createEnemyInstanceByName('Аптекарь');
    const session = initCombatSession(player, [
      { ...apothecary, hp: 60, maxHp: 98 },
      enemy('Союзник при смерти', [basic], { hp: 5, maxHp: 100 }),
    ]);
    const actor = session.state.enemies[0];
    actor.abilities = actor.abilities.filter(ability => ['Экстренный стимулятор', 'Атака'].includes(ability.name));

    expect(selectEnemyAction(actor, session).primary.name).toBe('Союзник при смерти');
  });

  test('Apothecary prioritizes urgent healing over cleanse', () => {
    const apothecary = createEnemyInstanceByName('Аптекарь');
    const session = initCombatSession(player, [
      { ...apothecary, hp: 45, maxHp: 100 },
      enemy('Равный раненый', [basic], {
        hp: 45,
        maxHp: 100,
      }),
      enemy('Критический союзник', [basic], { hp: 10, maxHp: 100 }),
    ]);
    const actor = session.state.enemies[0];
    addEffect(session.state.enemies[1], { id: 'bleed', duration: 2 }, () => {}, session.state.players[0], { session });
    actor.abilities = actor.abilities.filter(ability => ['Экстренный стимулятор', 'Очищающий состав', 'Атака'].includes(ability.name));

    let decision = selectEnemyAction(actor, session);
    expect(decision.primary.name).toBe('Критический союзник');

    session.state.enemies[2].hp = 100;
    decision = selectEnemyAction(actor, session);
    expect(decision.primary.name).toBe('Аптекарь');
  });

  test('Rat Race advances the whole living team by 10% per living rat-pack unit', () => {
    const ratmancer = createEnemyInstanceByName('Крысомант из Нор');
    const plagueRat = createEnemyInstanceByName('Чумная крыса');
    const matriarch = createEnemyInstanceByName('Крысиный матриарх');
    const rider = createEnemyInstanceByName('Крысиный всадник');
    const executioner = createEnemyInstanceByName('Гоблин-палач');
    const session = initCombatSession(player, [ratmancer, plagueRat, matriarch, rider, executioner]);
    const [caster, rat, mother, mounted, outsider] = session.state.enemies;

    caster.turnMeter = 0;
    rat.turnMeter = 100;
    mother.turnMeter = 200;
    mounted.turnMeter = 700;
    outsider.turnMeter = 900;

    ABILITY_LIBRARY['Крысиные бега'].apply({ attacker: caster, session, log: () => {} });

    expect(session.state.enemies.map(unit => unit.turnMeter)).toEqual([400, 500, 600, 1000, 1000]);

    rat.hp = 0;
    session.state.enemies.forEach(unit => { unit.turnMeter = 0; });
    ABILITY_LIBRARY['Крысиные бега'].apply({ attacker: caster, session, log: () => {} });

    expect(caster.turnMeter).toBe(300);
    expect(mother.turnMeter).toBe(300);
    expect(mounted.turnMeter).toBe(300);
    expect(outsider.turnMeter).toBe(300);
    expect(rat.turnMeter).toBe(0);
  });

  test('Ratmancer summons first when alone, then prefers Rat Race once the pack exists', () => {
    const ratmancer = createEnemyInstanceByName('Крысомант из Нор');
    const soloSession = initCombatSession(player, [ratmancer]);
    const soloActor = soloSession.state.enemies[0];

    expect(selectEnemyAction(soloActor, soloSession).ability.name).toBe('Крысиный зов');

    soloActor.abilities.find(ability => ability.name === 'Крысиный зов').currentCooldown = 1;
    expect(selectEnemyAction(soloActor, soloSession).ability.name).toBe('Крысиные бега');

    const packSession = initCombatSession(player, [
      createEnemyInstanceByName('Крысомант из Нор'),
      createEnemyInstanceByName('Чумная крыса'),
    ]);
    expect(selectEnemyAction(packSession.state.enemies[0], packSession).ability.name).toBe('Крысиные бега');
  });

  test('revival restores all three decision callbacks from authoritative presets', () => {
    const restoredJudgment = reviveAbility({ name: 'Приговор палача', presetKey: 'Приговор палача' });
    const restoredStrike = reviveAbility({ name: 'Казнящий удар', presetKey: 'Казнящий удар' });
    const restoredHeal = reviveAbility({ name: 'Лечение', presetKey: 'Лечение' });
    expect(restoredJudgment.aiScore).toBe(ABILITY_LIBRARY['Приговор палача'].aiScore);
    expect(restoredJudgment.targetScore).toBe(ABILITY_LIBRARY['Приговор палача'].targetScore);
    expect(restoredHeal.canUse).toBe(ABILITY_LIBRARY['Лечение'].canUse);
    expect(restoredHeal.aiScore).toBe(ABILITY_LIBRARY['Лечение'].aiScore);
    expect(restoredHeal.targetScore).toBe(ABILITY_LIBRARY['Лечение'].targetScore);

    const executionSession = initCombatSession({ ...player, hp: 40 }, [
      enemy('Восстановленный палач', [restoredJudgment, restoredStrike, basic]),
    ]);
    expect(selectEnemyAction(executionSession.state.enemies[0], executionSession).ability.name).toBe('Казнящий удар');

    const healingSession = initCombatSession(player, [enemy('Восстановленный лекарь', [restoredHeal, basic])]);
    expect(selectEnemyAction(healingSession.state.enemies[0], healingSession).ability.name).toBe('Атака');
  });
});
