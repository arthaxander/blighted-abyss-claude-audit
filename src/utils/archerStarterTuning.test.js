import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { TALENT_BY_ID } from '../data/classTalents.mjs';
import { beginCombatPresentation, consumeCombatPresentationEvents } from './combatPresentationEvents';
import {
  applyArcherRedirectHuntingMark,
  consumeArcherRedirect,
  initCombatSession,
  performPlayerAction,
  processEnemyAI,
  triggerArcherRedirectReturnShot,
  triggerArcherTrap,
} from './combatUtils';

const unit = (name, hp, maxHp = hp) => ({ name, hp, maxHp, physDef: 0, magicDef: 0, speed: 0, effects: [], abilities: [] });
const archerProgression = talentId => ({
  Archer: { talentSelections: { 'archer.fire_arrow': talentId } },
});
const archerBarbedProgression = talentId => ({
  Archer: { talentSelections: { 'archer.barbed_arrow': talentId } },
});
const archerFinishingProgression = talentId => ({
  Archer: { talentSelections: { 'archer.finishing_shot': talentId } },
});
const archerQuickProgression = talentId => ({
  Archer: { talentSelections: { 'archer.quick_intercept': talentId } },
});
const archerWolfPitProgression = talentId => ({
  Archer: { talentSelections: { 'archer.wolf_pit': talentId } },
});
const archerRedirectProgression = talentId => ({
  Archer: { talentSelections: { 'archer.redirect': talentId } },
});
const archerVolleyProgression = talentId => ({
  Archer: { talentSelections: { 'archer.volley': talentId } },
});
const archerSnakeTrapProgression = talentId => ({
  Archer: { talentSelections: { 'archer.snake_trap': talentId } },
});

describe('approved Archer starter tuning', () => {
  test('Designate Prey leaves a two-turn Hunting Mark after Barbed Arrow lands', () => {
    const target = { ...unit('Цель', 400), turnMeter: 600 };
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0,
      abilities: [{ ...ABILITY_LIBRARY['Зазубренная стрела'] }], equippedClassPassiveIds: [],
      classProgression: archerBarbedProgression('archer.barbed_arrow.designate_prey'),
    }, [target]);
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Зазубренная стрела', 0);

    expect(target.hp).toBe(270);
    expect(target.effects.find(effect => effect.id === 'bleed')).toBeTruthy();
    expect(target.effects.find(effect => effect.id === 'hunting_mark')).toMatchObject({ remainingTurns: 2 });
  });

  test('Binding Tip applies two-turn Slow and removes 15% turn meter after Barbed Arrow lands', () => {
    const target = { ...unit('Цель', 400), turnMeter: 600 };
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0,
      abilities: [{ ...ABILITY_LIBRARY['Зазубренная стрела'] }], equippedClassPassiveIds: [],
      classProgression: archerBarbedProgression('archer.barbed_arrow.binding_tip'),
    }, [target]);
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Зазубренная стрела', 0);

    expect(target.hp).toBe(270);
    expect(target.turnMeter).toBe(450);
    expect(target.effects.find(effect => effect.id === 'speed_penalty_minor')).toMatchObject({ remainingTurns: 2 });
  });

  test('both Barbed Arrow talents are combat-ready', () => {
    expect(TALENT_BY_ID['archer.barbed_arrow.designate_prey']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['archer.barbed_arrow.binding_tip']?.combatReady).toBe(true);
  });

  test('Fire Arrow replaces Aimed Shot with one 100% physical + 40% Fire hit and Burn', () => {
    const ability = ABILITY_LIBRARY['Огненная стрела'];
    expect(ability).toBeTruthy();
    expect(ABILITY_LIBRARY['Прицельный выстрел']).toBeUndefined();
    expect(ability.damage({ attacker: { attack: 100 } })).toBe(100);
    expect(ability.cooldown).toBe(2);
    expect(ability.effect({ attacker: { attack: 100 } })).toMatchObject({ id: 'burn', duration: 2, sourceScaling: 100 });

    const target = unit('Цель', 300);
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0, critDamage: 0.5,
      abilities: [{ ...ability }], equippedClassPassiveIds: [],
    }, [target]);
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Огненная стрела', 0);
    expect(target.hp).toBe(160);
    const burn = target.effects.find(effect => effect.id === 'burn');
    expect(burn).toBeTruthy();
    expect(burn.sourceSnapshot.scaling).toBe(100);
  });

  test('Fire Arrow shares one critical result between both damage components', () => {
    const ability = ABILITY_LIBRARY['Огненная стрела'];
    const target = unit('Цель', 400);
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 1, critDamage: 0.5,
      abilities: [{ ...ability }], equippedClassPassiveIds: [],
    }, [target]);
    session.rng = () => 0;
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Огненная стрела', 0);
    expect(target.hp).toBe(190);
  });

  test('Fire Arrow combined overkill feeds Piercing Wounds as one Archer shot', () => {
    const ability = ABILITY_LIBRARY['Огненная стрела'];
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0,
      abilities: [{ ...ability }], equippedClassPassiveIds: [],
    }, [unit('Первая', 120), unit('Вторая', 100)]);
    session.rng = () => 0;
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Огненная стрела', 0);
    expect(session.state.enemies[0].hp).toBe(0);
    expect(session.state.enemies[1].hp).toBe(80);
    expect(session.state.log.join(' ')).toContain('Сквозные раны');
  });

  test('Tar Arrow applies Slow and Charring only after the Fire Arrow damage is resolved', () => {
    const target = unit('Цель', 300);
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0,
      abilities: [{ ...ABILITY_LIBRARY['Огненная стрела'] }], equippedClassPassiveIds: [],
      classProgression: archerProgression('archer.fire_arrow.tar_arrow'),
    }, [target]);
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Огненная стрела', 0);

    expect(target.hp).toBe(160);
    expect(target.effects.find(effect => effect.id === 'speed_penalty_minor')).toMatchObject({ remainingTurns: 2 });
    expect(target.effects.filter(effect => effect.id === 'charring')).toHaveLength(1);
    expect(target.effects.find(effect => effect.id === 'charring')).toMatchObject({ remainingTurns: 3 });
  });

  test('Explosive Arrow deals 60% Attack Fire damage to other enemies without Burn or Piercing Wounds', () => {
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0,
      abilities: [{ ...ABILITY_LIBRARY['Огненная стрела'] }], equippedClassPassiveIds: [],
      classProgression: archerProgression('archer.fire_arrow.explosive_arrow'),
    }, [unit('Основная', 300), unit('Вторая', 50), unit('Третья', 200)]);
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Огненная стрела', 0);

    expect(session.state.enemies.map(enemy => enemy.hp)).toEqual([160, 0, 140]);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'burn')).toBe(true);
    expect(session.state.enemies[1].effects.some(effect => effect.id === 'burn')).toBe(false);
    expect(session.state.enemies[2].effects.some(effect => effect.id === 'burn')).toBe(false);
  });

  test('both Fire Arrow talents are combat-ready', () => {
    expect(TALENT_BY_ID['archer.fire_arrow.tar_arrow']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['archer.fire_arrow.explosive_arrow']?.combatReady).toBe(true);
  });

  test('Finishing Shot keeps 150% base, doubles at and below 50%, and remains CD 3', () => {
    const ability = ABILITY_LIBRARY['Добивающий выстрел'];
    const damage = hp => ability.damage({ attacker: { attack: 100 }, target: { hp, maxHp: 100 } });
    expect(damage(51)).toBe(150);
    expect(damage(50)).toBe(300);
    expect(damage(20)).toBe(300);
    expect(ability.cooldown).toBe(3);
  });

  test('Continue Hunt grants 30% turn meter only when Finishing Shot kills its primary target', () => {
    const survivingSession = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0, turnMeter: 0,
      abilities: [{ ...ABILITY_LIBRARY['Добивающий выстрел'] }], equippedClassPassiveIds: [],
      classProgression: archerFinishingProgression('archer.finishing_shot.continue_hunt'),
    }, [unit('Живая цель', 400)]);
    survivingSession.state.initiative.playerReady = true;
    performPlayerAction(survivingSession, 'Добивающий выстрел', 0);
    expect(survivingSession.state.players[0].turnMeter).toBe(0);

    const killSession = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0, turnMeter: 0,
      abilities: [{ ...ABILITY_LIBRARY['Добивающий выстрел'] }], equippedClassPassiveIds: [],
      classProgression: archerFinishingProgression('archer.finishing_shot.continue_hunt'),
    }, [unit('Добиваемая цель', 40, 100), unit('Вторая цель', 500)]);
    killSession.state.initiative.playerReady = true;
    performPlayerAction(killSession, 'Добивающий выстрел', 0);
    expect(killSession.state.players[0].turnMeter).toBe(300);
  });

  test('Through Shot increases only Piercing Wounds overkill transfer by 50%', () => {
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0,
      abilities: [{ ...ABILITY_LIBRARY['Добивающий выстрел'] }], equippedClassPassiveIds: [],
      classProgression: archerFinishingProgression('archer.finishing_shot.through_shot'),
    }, [unit('Основная', 40, 100), unit('Вторая цель', 500)]);
    session.rng = () => 0;
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Добивающий выстрел', 0);

    expect(session.state.enemies[0].hp).toBe(0);
    expect(session.state.enemies[1].hp).toBe(110);
  });

  test('both Finishing Shot talents are combat-ready', () => {
    expect(TALENT_BY_ID['archer.finishing_shot.continue_hunt']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['archer.finishing_shot.through_shot']?.combatReady).toBe(true);
  });

  test('Finishing Shot remains a direct Archer overkill source', () => {
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0,
      abilities: [{ ...ABILITY_LIBRARY['Добивающий выстрел'] }], equippedClassPassiveIds: [],
    }, [unit('Цель', 40, 100), unit('Вторая цель', 200)]);
    session.rng = () => 0;
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Добивающий выстрел', 0);
    expect(session.state.enemies[0].hp).toBe(0);
    expect(session.state.enemies[1].hp).toBeLessThan(200);
    expect(session.state.log.join(' ')).toContain('Сквозные раны');
  });

  test('Quick Intercept uses the target meter to choose damage or tempo', () => {
    const ability = ABILITY_LIBRARY['Быстрый перехват'];
    const lowMeter = { ...unit('A', 100), turnMeter: 499 };
    const highMeter = { ...unit('B', 100), turnMeter: 500 };
    expect(ability.damage({ attacker: { attack: 100 }, target: lowMeter })).toBe(150);
    expect(ability.damage({ attacker: { attack: 100 }, target: highMeter })).toBe(120);
    expect(ability.turnMeterGain({ target: lowMeter })).toBe(250);
    expect(ability.turnMeterGain({ target: highMeter })).toBe(400);
    expect(ability.cooldown).toBe(3);
  });

  test('Quick Intercept always grants 25% TM and steals 15% from a high-meter target', () => {
    const ability = ABILITY_LIBRARY['Быстрый перехват'];
    const target = { ...unit('A', 100), turnMeter: 650 };
    const attacker = { id: 'archer', name: 'Лучник', turnMeter: 0, effects: [] };
    const session = { state: { players: [attacker], enemies: [target] } };
    beginCombatPresentation(session);
    ability.apply({
      attacker,
      target,
      preHitTargetStates: [{ target, turnMeter: 650 }],
      session,
      log: jest.fn(),
    });
    const presentationEvents = consumeCombatPresentationEvents(session);
    expect(target.turnMeter).toBe(500);
    expect(attacker.turnMeter).toBe(400);
    expect(presentationEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'turnMeterChanged', targetId: 'A', delta: -150 }),
      expect.objectContaining({ type: 'turnMeterChanged', targetId: 'archer', delta: 400 }),
      expect.objectContaining({ type: 'turnIntercept', actorId: 'archer', targetId: 'A', stolen: 150, gained: 400 }),
    ]));
  });

  test('Quick Intercept low-meter branch grants only its unconditional 25% TM', () => {
    const ability = ABILITY_LIBRARY['Быстрый перехват'];
    const target = { ...unit('A', 100), turnMeter: 400 };
    const attacker = { name: 'Лучник', turnMeter: 0 };
    ability.apply({
      attacker,
      target,
      preHitTargetStates: [{ target, turnMeter: 400 }],
      session: { state: { enemies: [target] } },
      log: jest.fn(),
    });
    expect(target.turnMeter).toBe(400);
    expect(attacker.turnMeter).toBe(250);
  });

  test('Light Step grants one refreshable two-turn Evasion buff', () => {
    const ability = ABILITY_LIBRARY['Быстрый перехват'];
    const attacker = {
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, turnMeter: 0, effects: [],
      classProgression: archerQuickProgression('archer.quick_intercept.light_step'),
    };
    const target = { ...unit('Цель', 500), turnMeter: 400 };
    const session = { state: { players: [attacker], enemies: [target] } };

    ability.apply({
      attacker, target,
      preHitTargetStates: [{ target, turnMeter: 400, hadHuntingMark: false }],
      session, log: jest.fn(),
    });
    ability.apply({
      attacker, target,
      preHitTargetStates: [{ target, turnMeter: 400, hadHuntingMark: false }],
      session, log: jest.fn(),
    });

    expect(attacker.effects.filter(effect => effect.id === 'evasion')).toHaveLength(1);
    expect(attacker.effects.find(effect => effect.id === 'evasion')).toMatchObject({ remainingTurns: 2 });
  });

  test('Seize Initiative removes an extra 15% TM, or 25% when Hunting Mark existed before the shot', () => {
    const ability = ABILITY_LIBRARY['Быстрый перехват'];

    const unmarkedTarget = { ...unit('Без метки', 500), turnMeter: 650 };
    const unmarkedAttacker = {
      name: 'Лучник', class: 'Archer', turnMeter: 0, effects: [],
      classProgression: archerQuickProgression('archer.quick_intercept.seize_initiative'),
    };
    ability.apply({
      attacker: unmarkedAttacker, target: unmarkedTarget,
      preHitTargetStates: [{ target: unmarkedTarget, turnMeter: 650, hadHuntingMark: false }],
      session: { state: { enemies: [unmarkedTarget] } }, log: jest.fn(),
    });
    expect(unmarkedTarget.turnMeter).toBe(350);
    expect(unmarkedAttacker.turnMeter).toBe(400);

    const markedTarget = { ...unit('С меткой', 500), turnMeter: 650 };
    const markedAttacker = {
      name: 'Лучник', class: 'Archer', turnMeter: 0, effects: [],
      classProgression: archerQuickProgression('archer.quick_intercept.seize_initiative'),
    };
    ability.apply({
      attacker: markedAttacker, target: markedTarget,
      preHitTargetStates: [{ target: markedTarget, turnMeter: 650, hadHuntingMark: true }],
      session: { state: { enemies: [markedTarget] } }, log: jest.fn(),
    });
    expect(markedTarget.turnMeter).toBe(250);
    expect(markedAttacker.turnMeter).toBe(400);
  });

  test('Seize Initiative remembers a pre-hit Hunting Mark even when the shot consumes it', () => {
    const target = { ...unit('Цель', 500), turnMeter: 650, effects: [{ id: 'hunting_mark', remainingTurns: 2, duration: 2 }] };
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 100, critChance: 0, critDamage: 0.5,
      abilities: [{ ...ABILITY_LIBRARY['Быстрый перехват'] }], equippedClassPassiveIds: [],
      classProgression: archerQuickProgression('archer.quick_intercept.seize_initiative'),
    }, [target]);
    session.rng = () => 0.99;
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Быстрый перехват', 0);

    expect(target.effects.some(effect => effect.id === 'hunting_mark')).toBe(false);
    expect(target.turnMeter).toBe(250);
  });

  test('both Quick Intercept talents are combat-ready', () => {
    expect(TALENT_BY_ID['archer.quick_intercept.light_step']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['archer.quick_intercept.seize_initiative']?.combatReady).toBe(true);
  });

  test('Drive Prey applies a two-turn Hunting Mark when Wolf Pit resolves after the enemy action', () => {
    const archer = {
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, effects: [],
      classProgression: archerWolfPitProgression('archer.wolf_pit.drive_prey'),
    };
    ABILITY_LIBRARY['Волчья яма'].apply({ attacker: archer });
    const enemy = { ...unit('Цель', 500), controlImmune: false };
    const session = { state: { players: [archer], enemies: [enemy] } };

    expect(triggerArcherTrap(archer, enemy, session, jest.fn(), 'before_action')).toBe(false);
    expect(archer._armedTrap).toBeTruthy();

    expect(triggerArcherTrap(archer, enemy, session, jest.fn(), 'after_action')).toBe(true);
    expect(archer._armedTrap).toBeNull();
    expect(enemy.effects.filter(effect => effect.id === 'bleed')).toHaveLength(2);
    expect(enemy.effects.find(effect => effect.id === 'hunting_mark')).toMatchObject({ remainingTurns: 2 });
  });

  test('Snare Wolf Pit waits for pre-action timing and marks a successful stun as cancelling that action', () => {
    const archer = {
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, effects: [],
      classProgression: archerWolfPitProgression('archer.wolf_pit.trap'),
    };
    ABILITY_LIBRARY['Волчья яма'].apply({ attacker: archer });
    const enemy = { ...unit('Цель', 500), controlImmune: false, _effectTurnActive: true, _effectTurnEpoch: 7 };
    const session = { state: { players: [archer], enemies: [enemy] } };

    expect(triggerArcherTrap(archer, enemy, session, jest.fn(), 'after_action')).toBe(false);
    expect(archer._armedTrap).toBeTruthy();

    expect(triggerArcherTrap(archer, enemy, session, jest.fn(), 'before_action')).toBe(true);
    expect(archer._armedTrap).toBeNull();
    expect(enemy.effects.filter(effect => effect.id === 'bleed')).toHaveLength(2);
    const stun = enemy.effects.find(effect => effect.id === 'stun');
    expect(stun).toBeTruthy();
    expect(stun._appliedTurnEpoch).toBeUndefined();
    expect(enemy._archerTrapCancelledAction).toBe(true);
  });

  test('Snare does not cancel the action when the enemy is immune to control', () => {
    const archer = {
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, effects: [],
      classProgression: archerWolfPitProgression('archer.wolf_pit.trap'),
    };
    ABILITY_LIBRARY['Волчья яма'].apply({ attacker: archer });
    const enemy = { ...unit('Цель', 500), controlImmune: true };
    const session = { state: { players: [archer], enemies: [enemy] } };

    expect(triggerArcherTrap(archer, enemy, session, jest.fn(), 'before_action')).toBe(true);
    expect(enemy.effects.filter(effect => effect.id === 'bleed')).toHaveLength(3);
    expect(enemy.effects.some(effect => effect.id === 'stun')).toBe(false);
    expect(enemy._archerTrapCancelledAction).toBeUndefined();
  });

  test('both Wolf Pit talents are combat-ready', () => {
    expect(TALENT_BY_ID['archer.wolf_pit.drive_prey']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['archer.wolf_pit.trap']?.combatReady).toBe(true);
  });

  test('Offer Prey prefers a marked redirect target and consumes the Mark only for a landed redirected attack', () => {
    const archer = {
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, effects: [],
      classProgression: archerRedirectProgression('archer.redirect.offer_prey'),
    };
    ABILITY_LIBRARY['Перенаправление'].apply({ attacker: archer });
    const attacker = { ...unit('Атакующий', 500), attack: 100 };
    const unmarked = unit('Без метки', 500);
    const marked = { ...unit('С меткой', 500), effects: [{ id: 'hunting_mark', remainingTurns: 2, duration: 2 }] };
    const session = { state: { players: [archer], enemies: [attacker, unmarked, marked] }, rng: () => 0 };

    const redirect = consumeArcherRedirect(attacker, archer, { name: 'Удар', type: 'physical' }, 100, session, jest.fn());

    expect(redirect.target).toBe(marked);
    expect(redirect.consumeHuntingMark).toBe(true);
    expect(marked.effects.some(effect => effect.id === 'hunting_mark')).toBe(true);

    const deliberateAction = {};
    expect(applyArcherRedirectHuntingMark(redirect, marked, deliberateAction, jest.fn())).toBe(true);
    expect(marked.effects.some(effect => effect.id === 'hunting_mark')).toBe(false);
    expect(deliberateAction.redirectHuntingMarkCrit).toBe(true);
  });

  test('Return Shot deals 100% Archer Attack after a redirect and does nothing if the original attacker is dead', () => {
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, critChance: 0,
      abilities: [{ ...ABILITY_LIBRARY['Перенаправление'] }], equippedClassPassiveIds: [],
      classProgression: archerRedirectProgression('archer.redirect.return_shot'),
    }, [unit('Атакующий', 300)]);
    const archer = session.state.players[0];
    const enemy = session.state.enemies[0];

    expect(triggerArcherRedirectReturnShot(archer, enemy, session, jest.fn())).toBe(100);
    expect(enemy.hp).toBe(200);

    enemy.hp = 0;
    expect(triggerArcherRedirectReturnShot(archer, enemy, session, jest.fn())).toBe(0);
  });

  test('both Redirect talents are combat-ready', () => {
    expect(TALENT_BY_ID['archer.redirect.offer_prey']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['archer.redirect.return_shot']?.combatReady).toBe(true);
  });

  test('Wide Barrage marks the selected surviving primary target after Volley damage', () => {
    const ability = ABILITY_LIBRARY['Залп стрел'];
    const attacker = {
      name: 'Лучник', class: 'Archer', effects: [],
      classProgression: archerVolleyProgression('archer.volley.wide_barrage'),
    };
    const primary = unit('Основная', 300);
    const other = unit('Другая', 300);
    const session = { state: { players: [attacker], enemies: [primary, other] }, rng: () => 0.99 };

    ability.apply({
      attacker,
      target: primary,
      hitTargets: [primary, other],
      session,
      log: jest.fn(),
    });

    expect(primary.effects.find(effect => effect.id === 'hunting_mark')).toMatchObject({ remainingTurns: 2 });
    expect(other.effects.some(effect => effect.id === 'hunting_mark')).toBe(false);
  });

  test('Wide Barrage picks a random surviving hit target when the selected primary did not survive', () => {
    const ability = ABILITY_LIBRARY['Залп стрел'];
    const attacker = {
      name: 'Лучник', class: 'Archer', effects: [],
      classProgression: archerVolleyProgression('archer.volley.wide_barrage'),
    };
    const primary = unit('Основная', 0, 100);
    const first = unit('Первая', 300);
    const second = unit('Вторая', 300);
    const session = { state: { players: [attacker], enemies: [primary, first, second] }, rng: () => 0.99 };

    ability.apply({
      attacker,
      target: primary,
      hitTargets: [primary, first, second],
      session,
      log: jest.fn(),
    });

    expect(first.effects.some(effect => effect.id === 'hunting_mark')).toBe(false);
    expect(second.effects.find(effect => effect.id === 'hunting_mark')).toMatchObject({ remainingTurns: 2 });
  });

  test('Suppressive Fire applies two-turn Weakening only to surviving enemies hit by Volley', () => {
    const ability = ABILITY_LIBRARY['Залп стрел'];
    const attacker = {
      name: 'Лучник', class: 'Archer', effects: [],
      classProgression: archerVolleyProgression('archer.volley.suppressive_fire'),
    };
    const hitOne = unit('Первая', 300);
    const hitTwo = unit('Вторая', 300);
    const missed = unit('Мимо', 300);
    const deadHit = unit('Погибшая', 0, 100);
    const session = { state: { players: [attacker], enemies: [hitOne, hitTwo, missed, deadHit] } };

    ability.apply({
      attacker,
      target: hitOne,
      hitTargets: [hitOne, hitTwo, deadHit],
      session,
      log: jest.fn(),
    });

    expect(hitOne.effects.find(effect => effect.id === 'attack_penalty_minor')).toMatchObject({ remainingTurns: 2 });
    expect(hitTwo.effects.find(effect => effect.id === 'attack_penalty_minor')).toMatchObject({ remainingTurns: 2 });
    expect(missed.effects.some(effect => effect.id === 'attack_penalty_minor')).toBe(false);
    expect(deadHit.effects.some(effect => effect.id === 'attack_penalty_minor')).toBe(false);
  });

  test('both Volley talents are combat-ready', () => {
    expect(TALENT_BY_ID['archer.volley.wide_barrage']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['archer.volley.suppressive_fire']?.combatReady).toBe(true);
  });

  test('Long Poison makes both Snake Trap poison instances last four turns', () => {
    const archer = {
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, effects: [],
      classProgression: archerSnakeTrapProgression('archer.snake_trap.long_poison'),
    };
    ABILITY_LIBRARY['Змеиная ловушка'].apply({ attacker: archer });
    const enemy = unit('Цель', 500);
    const session = { state: { players: [archer], enemies: [enemy] } };

    expect(triggerArcherTrap(archer, enemy, session, jest.fn(), 'after_action')).toBe(true);

    expect(enemy.hp).toBe(380);
    const poisons = enemy.effects.filter(effect => effect.id === 'poison');
    expect(poisons).toHaveLength(2);
    expect(poisons.every(effect => effect.remainingTurns === 4)).toBe(true);
    expect(archer._armedTrap).toBeNull();
  });

  test('Snake Tangle stays armed after its first activation and disappears after the second', () => {
    const archer = {
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, effects: [],
      classProgression: archerSnakeTrapProgression('archer.snake_trap.snake_tangle'),
    };
    ABILITY_LIBRARY['Змеиная ловушка'].apply({ attacker: archer });
    const firstEnemy = unit('Первая цель', 500);
    const secondEnemy = unit('Вторая цель', 500);
    const session = { state: { players: [archer], enemies: [firstEnemy, secondEnemy] } };

    expect(archer._armedTrap?.activationsRemaining).toBe(2);

    expect(triggerArcherTrap(archer, firstEnemy, session, jest.fn(), 'after_action')).toBe(true);
    expect(firstEnemy.hp).toBe(380);
    expect(firstEnemy.effects.filter(effect => effect.id === 'poison')).toHaveLength(2);
    expect(archer._armedTrap).toBeTruthy();
    expect(archer._armedTrap.activationsRemaining).toBe(1);

    expect(triggerArcherTrap(archer, secondEnemy, session, jest.fn(), 'after_action')).toBe(true);
    expect(secondEnemy.hp).toBe(380);
    expect(secondEnemy.effects.filter(effect => effect.id === 'poison')).toHaveLength(2);
    expect(archer._armedTrap).toBeNull();
  });

  test('Snake Tangle keeps a full two-activation summon template for temporary-summon copying', () => {
    const archer = {
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, effects: [],
      classProgression: archerSnakeTrapProgression('archer.snake_trap.snake_tangle'),
    };

    ABILITY_LIBRARY['Змеиная ловушка'].apply({ attacker: archer });

    expect(archer._armedTrap?._summonTemplate?.payload).toMatchObject({
      type: 'snake_trap',
      talentId: 'archer.snake_trap.snake_tangle',
      activationsRemaining: 2,
    });
  });

  test('both Snake Trap talents are combat-ready', () => {
    expect(TALENT_BY_ID['archer.snake_trap.long_poison']?.combatReady).toBe(true);
    expect(TALENT_BY_ID['archer.snake_trap.snake_tangle']?.combatReady).toBe(true);
  });

  test('Finish the Prey grants 15% turn meter only on the first crossing to 30% HP or lower', () => {
    const target = unit('Цель', 100);
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 90, maxHp: 90, attack: 75, critChance: 0,
      abilities: [{ name: 'Пороговый выстрел', damage: 75, cooldown: 0, type: 'physical', alwaysHits: true }],
      equippedClassPassiveIds: ['finish_the_prey'],
    }, [target]);
    session.state.initiative.playerReady = true;

    performPlayerAction(session, 'Пороговый выстрел', 0);

    expect(target.hp).toBe(25);
    expect(session.state.players[0].turnMeter).toBe(150);
    expect(target._finishThePreyTriggered).toBe(true);

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Пороговый выстрел', 0);

    expect(target.hp).toBe(0);
    expect(session.state.players[0].turnMeter).toBe(150);
  });

  test('False Trail grants 5% dodge, arms on a dodged fallback attack, then boosts and consumes the next attack', () => {
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, critChance: 0, dodge: 0,
      abilities: [{ name: 'Ответный тест', damage: 100, cooldown: 0, type: 'physical', alwaysHits: true }],
      equippedClassPassiveIds: ['false_trail'],
    }, [{
      name: 'Манекен', hp: 300, maxHp: 300, attack: 50, speed: 1,
      physDef: 0, magicDef: 0, abilities: [],
    }]);
    const archer = session.state.players[0];
    const enemy = session.state.enemies[0];

    expect(archer.dodge).toBeCloseTo(0.05);

    session.rng = () => 0.99;
    archer.turnMeter = 0;
    enemy.turnMeter = 1000;
    session.state.initiative.playerReady = false;
    processEnemyAI(session);

    expect(archer.hp).toBe(100);
    expect(archer._falseTrailReady).toBe(true);

    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Ответный тест', 0);

    expect(enemy.hp).toBe(180);
    expect(archer._falseTrailReady).toBe(false);
  });

  test('Hunting Rhythm grants 50% turn meter every time an Archer trap resolves', () => {
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 100, critChance: 0,
      abilities: [{ ...ABILITY_LIBRARY['Змеиная ловушка'] }],
      equippedClassPassiveIds: ['hunting_rhythm'],
    }, [unit('Цель', 500)]);
    const archer = session.state.players[0];
    const target = session.state.enemies[0];

    ABILITY_LIBRARY['Змеиная ловушка'].apply({ attacker: archer });
    expect(triggerArcherTrap(archer, target, session, jest.fn(), 'after_action')).toBe(true);

    expect(archer.turnMeter).toBe(500);
  });

  test('Initiative grants 10% direct damage per stack, capped at 30%', () => {
    const passive = ABILITY_LIBRARY.initiative;
    const ability = { name: 'Проверочный выстрел' };
    expect(passive.modifyDamage({ damage: 100, attacker: { _initiativeStacks: 1 }, ability })).toBe(110);
    expect(passive.modifyDamage({ damage: 100, attacker: { _initiativeStacks: 3 }, ability })).toBe(130);
    expect(passive.modifyDamage({ damage: 100, attacker: { _initiativeStacks: 5 }, ability })).toBe(130);
    expect(passive.modifyDamage({ damage: 100, attacker: { _initiativeStacks: 3 }, ability: { ...ability, isSecondaryDamage: true } })).toBe(100);
  });
});
