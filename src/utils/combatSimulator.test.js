import { createAbilityByName } from '../data/abilityPresets';
import { FIELD_CONSUMABLES } from '../data/fieldConsumables';
import { getItemDefinition } from '../data/items';
import { chooseCombatAction, createSimulationPlayer, estimateVisibleThreatBeforeNextTurn, getLegalCombatActions, scoreBossAwareAction, scoreCombatAbilityAction, simulateCombat, simulateCombatBatch } from './combatSimulator';
import { SIMULATION_BOSS_MECHANICS } from './simulationBossMechanics';
import { createSeededSimulationRng } from './simulationRng';
import { resolveSimulationPlayerProfile } from './simulationPlayerProfiles';

const dummy = (overrides = {}) => ({ name: 'Манекен', hp: 30, maxHp: 30, attack: 0, speed: 20, physDef: 0, magicDef: 0, effects: [], abilities: [], ...overrides });

describe('Combat Simulator v1 production integration', () => {
  test('same setup, seed, and policy produce identical production-engine results', () => {
    const first = simulateCombat({ classId: 'Archer', enemies: [dummy()], seed: 1234, policy: 'naive' });
    const second = simulateCombat({ classId: 'Archer', enemies: [dummy()], seed: 1234, policy: 'naive' });
    expect({ ...first, player: undefined }).toEqual({ ...second, player: undefined });
    expect(first.outcome).toBe('victory'); expect(first.playerDamageDealt).toBeGreaterThan(0);
  });

  test('production enemy turns can defeat the player and guard termination stays abnormal', () => {
    const fragile = createSimulationPlayer({ classId: 'Archer', hp: 1, abilityIds: ['Атака'] });
    expect(simulateCombat({ player: fragile, enemies: [dummy({ hp: 1000, maxHp: 1000, attack: 100, speed: 1000 })], seed: 9, policy: 'naive' }).outcome).toBe('defeat');
    expect(simulateCombat({ enemies: [dummy({ hp: 10000, maxHp: 10000 })], classId: 'Archer', seed: 9, policy: 'naive', maxActions: 1 }).outcome).toBe('abnormal');
  });

  test('production statuses, cooldowns, Turn Meter and summon actions remain legal simulator choices', () => {
    const mage = createSimulationPlayer({ classId: 'Mage', abilityIds: ['Огненный шар', 'Призыв элементаля', 'Атака'] });
    const session = { state: { players: [{ ...mage, abilities: mage.abilities.map(ability => ({ ...ability })), effects: [] }], enemies: [dummy()], initiative: { playerReady: true } }, rng: createSeededSimulationRng(1), summonPlayer: jest.fn() };
    const actions = getLegalCombatActions(session);
    expect(actions.some(action => action.ability.artId === 'fireball')).toBe(true);
    expect(actions.some(action => action.ability.artId === 'elemental')).toBe(true);
    expect(createAbilityByName('Огненный шар').cooldown).toBe(1);
    const result = simulateCombat({ player: mage, enemies: [dummy({ hp: 200, maxHp: 200 })], seed: 7, policy: 'random' });
    expect(result.actions).toBeGreaterThan(0); expect(['victory', 'defeat']).toContain(result.outcome);
  });

  test('production Burn, Shock-skip and allied summon paths are observable through simulator results', () => {
    const burnMage = createSimulationPlayer({ classId: 'Mage', abilityIds: ['Огненный шар', 'Атака'] });
    const burn = simulateCombat({ player: burnMage, enemies: [dummy({ hp: 250, maxHp: 250 })], seed: 3, policy: 'naive' });
    expect(burn.statusApplications).toBeGreaterThan(0);
    expect(burn.playerDamageDealt).toBeGreaterThan(0);

    const shockMage = createSimulationPlayer({ classId: 'Mage', abilityIds: ['Цепная молния', 'Атака'] });
    const shock = simulateCombat({ player: shockMage, enemies: [dummy({ hp: 500, maxHp: 500, speed: 100 })], seed: 1, policy: 'naive' });
    expect(shock.classMetrics.shockSkips).toBeGreaterThan(0);
    // Lightning Speed also triggers from owned three-Charge discharges, so the
    // total may legitimately exceed the number of Shock-skipped turns.
    expect(shock.classMetrics.lightningSpeedTriggers).toBeGreaterThanOrEqual(shock.classMetrics.shockSkips);

    const summoner = createSimulationPlayer({ classId: 'Mage', abilityIds: ['Призыв элементаля', 'Огненный шар', 'Атака'] });
    const summoned = simulateCombat({ player: summoner, enemies: [dummy({ hp: 150, maxHp: 150 }), dummy({ name: 'B', hp: 150, maxHp: 150 })], seed: 4, policy: 'competent' });
    expect(summoned.summonCount).toBe(1);
  });

  test.each(['withering_forest', 'restless_ruins', 'mines_of_decay'])('%s combat batches use authored floor-II groups and boss', location => {
    const normal = simulateCombatBatch({ location, runs: 1, seed: 3, classId: 'Mage',
      profile: 'prepared', policy: 'competent' });
    expect(normal.config.location).toBe(location);
    expect(normal.config.resolvedEncounterConfiguration).toHaveLength(3);
    expect(normal.outcomes.victories + normal.outcomes.defeats).toBe(1);
    const strong = simulateCombatBatch({ location, runs: 1, seed: 3, completedCombats: 14,
      classId: 'Defender', profile: 'prepared', policy: 'competent' });
    expect(strong.config.resolvedEncounterConfiguration).toHaveLength(3);
    const boss = simulateCombatBatch({ location, runs: 1, seed: 3, boss: true,
      classId: 'Mage', profile: 'prepared', policy: 'boss_aware' });
    expect(boss.config.resolvedEncounterConfiguration).toHaveLength(1);
    expect(boss.config.resolvedEncounterConfiguration[0].boss).toBe(true);
  });

  test('batch report is deterministic and labeled as simulator-policy output', () => {
    const config = { runs: 5, seed: 55, classId: 'Mage', policy: 'competent', location: 'fungal' };
    expect(simulateCombatBatch(config)).toEqual(simulateCombatBatch(config));
    expect(simulateCombatBatch(config).metadata.label).toBe('simulator-policy results');
  });
});

describe('Combat policies', () => {
  const makeSession = (classId, abilities, extra = {}) => {
    const player = createSimulationPlayer({ classId, abilityIds: abilities });
    return { state: { players: [{ ...player, effects: [], ...extra }], enemies: [dummy(), dummy({ name: 'B' })] } };
  };

  test.each(['random', 'naive', 'competent', 'strategic'])('%s always selects a legal current action and target', policy => {
    const session = makeSession('Archer', ['Зазубренная стрела', 'Змеиная ловушка', 'Перенаправление', 'Атака']);
    const legal = getLegalCombatActions(session);
    expect(legal).toContainEqual(chooseCombatAction({ policy, session, rng: createSeededSimulationRng(4) }));
  });

  test('visible threat consumes Shield before physical defense', () => {
    const player = {
      ...createSimulationPlayer({ classId: 'Defender', abilityIds: ['Атака'] }),
      hp: 500,
      maxHp: 500,
      shield: 40,
      physDef: 100,
      speed: 100,
      turnMeter: 0,
      effects: [],
    };
    const enemy = dummy({
      hp: 500,
      maxHp: 500,
      attack: 100,
      speed: 100,
      turnMeter: 1000,
      abilities: [{ name: 'Проверочный удар', damage: 100, type: 'physical', accuracy: 1, cooldown: 0 }],
    });
    const threat = estimateVisibleThreatBeforeNextTurn({ state: { players: [player], enemies: [enemy] } }, player);

    expect(threat.enemiesBeforeNextTurn).toBe(1);
    expect(threat.guaranteed).toBe(30);
    expect(threat.expected).toBe(30);
    expect(threat.maximum).toBe(30);
  });

  test('visible periodic damage spends Shield before defense mitigates HP overflow', () => {
    const player = {
      ...createSimulationPlayer({ classId: 'Defender', abilityIds: ['Атака'] }),
      hp: 500,
      maxHp: 500,
      shield: 10,
      physDef: 300,
      speed: 100,
      turnMeter: 0,
      effects: [{ id: 'bleed', value: 60, damageType: 'physical' }],
    };
    const threat = estimateVisibleThreatBeforeNextTurn({ state: { players: [player], enemies: [] } }, player);

    // 60 physical damage - 10 Shield = 50 HP overflow / (1 + 300/100) -> 13.
    expect(threat.periodic).toBe(13);
    expect(threat.guaranteed).toBe(13);
    expect(threat.expected).toBe(13);
    expect(threat.maximum).toBe(13);
  });

  test('a fully shielded DoT consumes unmitigated Shield but causes no HP loss', () => {
    const player = {
      ...createSimulationPlayer({ classId: 'Defender', abilityIds: ['Атака'] }),
      hp: 500, maxHp: 500, shield: 100, physDef: 300, speed: 100, turnMeter: 0,
      effects: [{ id: 'bleed', value: 60, damageType: 'physical' }],
    };
    const threat = estimateVisibleThreatBeforeNextTurn({ state: { players: [player], enemies: [] } }, player);
    expect(threat.periodic).toBe(0);
    expect(threat.guaranteed).toBe(0);
    expect(threat.possibleLethal).toBe(false);
  });

  test.each([
    ['gloom', 20],
    ['searing_mark', 15],
  ])('visible %s tick bypasses Shield but respects magical defense', (effectId, expectedDamage) => {
    const player = {
      ...createSimulationPlayer({ classId: 'Defender', abilityIds: ['Атака'] }),
      hp: 500,
      maxHp: 500,
      shield: 100,
      magicDef: 100,
      speed: 100,
      turnMeter: 0,
      effects: [{ id: effectId, sourceSnapshot: { magAtk: 100 } }],
    };
    const threat = estimateVisibleThreatBeforeNextTurn({ state: { players: [player], enemies: [] } }, player);

    expect(threat.periodic).toBe(expectedDamage);
    expect(threat.guaranteed).toBe(expectedDamage);
    expect(threat.expected).toBe(expectedDamage);
    expect(threat.maximum).toBe(expectedDamage);
  });

  test('visible threat resolves multihits against the remaining Shield hit by hit', () => {
    const player = {
      ...createSimulationPlayer({ classId: 'Defender', abilityIds: ['Атака'] }),
      hp: 500,
      maxHp: 500,
      shield: 70,
      physDef: 100,
      speed: 100,
      turnMeter: 0,
      effects: [],
    };
    const enemy = dummy({
      hp: 500,
      maxHp: 500,
      attack: 50,
      speed: 100,
      turnMeter: 1000,
      abilities: [{ name: 'Двойной удар', damage: 50, hits: 2, type: 'physical', accuracy: 1, cooldown: 0 }],
    });
    const threat = estimateVisibleThreatBeforeNextTurn({ state: { players: [player], enemies: [enemy] } }, player);

    expect(threat.enemiesBeforeNextTurn).toBe(1);
    expect(threat.guaranteed).toBe(15);
    expect(threat.maximum).toBe(15);
  });

  test('competent Archer recognizes unarmed Snake Trap setup', () => {
    const session = makeSession('Archer', ['Змеиная ловушка', 'Перенаправление', 'Атака']);
    expect(chooseCombatAction({ policy: 'competent', session, rng: createSeededSimulationRng(1) }).ability.artId).toBe('snake_trap');
  });

  test('generic ability scoring values authored Turn Meter utility', () => {
    const session = makeSession('Archer', ['Быстрый перехват', 'Атака']);
    session.state.enemies[0].effects = [{ id: 'bleed' }];
    const intercept = getLegalCombatActions(session).find(action => action.ability.artId === 'quick_intercept' && action.target === session.state.enemies[0]);
    expect(intercept).toBeDefined();
    expect(intercept.ability.turnMeterGain({ target: intercept.target, session })).toBe(250);
    expect(scoreCombatAbilityAction(intercept, session.state.players[0], session, 'competent')).toBeGreaterThan(intercept.expectedDamage);
  });

  test('batch exposes Quick Intercept legality, scoring, selection and finishing attribution diagnostics', () => {
    const report = simulateCombatBatch({ runs: 5, seed: 12, classId: 'Archer', policy: 'competent', location: 'goblin' });
    expect(report.diagnostics.quickIntercept).toEqual(expect.objectContaining({
      legalOpportunities: expect.any(Number), selected: expect.any(Number), scoreTotal: expect.any(Number), gain250Opportunities: expect.any(Number), gain350Opportunities: expect.any(Number), beatenBy: expect.any(Object),
      finishingShotQualifyingUses: expect.any(Number), finishingShotKills: expect.any(Number), finishingShotOverkillTransfers: expect.any(Number),
    }));
  });

  test('competent Elementalist no longer prefers a removed reaction', () => {
    const session = makeSession('Mage', ['Огненный шар', 'Ледяное копьё', 'Атака']);
    session.state.enemies[0].effects = [{ id: 'burn' }];
    expect(chooseCombatAction({ policy: 'competent', session, rng: createSeededSimulationRng(1) }).ability.artId).toBe('fireball');
  });

  test('competent policy recognizes authored debuffs for Cleansing Compound and keeps it while healthy', () => {
    const fresh = makeSession('Defender', ['Атака'], {
      items: [{ name: 'Очищающий состав' }],
      effects: [{ id: 'regeneration', remainingTurns: 2 }],
    });
    const noNeed = chooseCombatAction({ policy: 'competent', session: fresh, rng: createSeededSimulationRng(3) });
    expect(noNeed.kind).toBe('ability');
    // Overgrowth is an authored debuff, but was not in the old hardcoded list.
    fresh.state.players[0].effects = [{ id: 'overgrowth', remainingTurns: 2 }];
    const threatened = chooseCombatAction({ policy: 'competent', session: fresh, rng: createSeededSimulationRng(3) });
    expect(threatened).toMatchObject({ kind: 'item', itemName: 'Очищающий состав' });
  });

  test('strategic policy uses finite production healing and does not waste it near full HP', () => {
    const hurt = makeSession('Archer', ['Атака'], { hp: 20, maxHp: 90, items: [{ name: 'Малое зелье здоровья' }] });
    const choice = chooseCombatAction({ policy: 'strategic', session: hurt, rng: createSeededSimulationRng(1) });
    expect(choice).toMatchObject({ kind: 'item', itemName: 'Малое зелье здоровья' });
    const healthy = makeSession('Archer', ['Атака'], { hp: 85, maxHp: 90, items: [{ name: 'Малое зелье здоровья' }] });
    expect(chooseCombatAction({ policy: 'strategic', session: healthy, rng: createSeededSimulationRng(1) }).kind).toBe('ability');
  });

  test('strategic Elementalist penalizes ineffective Storm Discharge repetition when AoE control is available', () => {
    const session = makeSession('Mage', ['Грозовой разряд', 'Буран', 'Атака'], { _lastSimulationAbilityId: 'storm_discharge' });
    session.state.enemies.forEach(enemy => { enemy.effects = [{ id: 'shock' }]; enemy.hp = 200; enemy.maxHp = 200; });
    expect(chooseCombatAction({ policy: 'strategic', session, rng: createSeededSimulationRng(1) }).ability.artId).toBe('blizzard');
  });

  test('death healing diagnostics distinguish an available potion that policy declined', () => {
    const player = createSimulationPlayer({ classId: 'Archer', hp: 45, abilityIds: ['Атака'], items: ['Малое зелье здоровья'] });
    const result = simulateCombat({ player, enemies: [dummy({ hp: 1000, maxHp: 1000, attack: 200, speed: 10 })], seed: 2, policy: 'strategic' });
    expect(result.outcome).toBe('defeat');
    expect(result.healingAtDeath).toMatchObject({ physicallyRemaining: true, availableOnLastPlayerTurn: true, availableButNotChosen: true, diedBeforeNextAction: true });
  });

  test('debug decision trace contains legal action scores without inflating normal results', () => {
    const debug = simulateCombat({ classId: 'Mage', profile: 'prepared', enemies: [dummy({ hp: 200 })], seed: 3, policy: 'strategic', debugDecisions: true });
    expect(debug.decisionDiagnostics[0]).toEqual(expect.objectContaining({ player: expect.any(Object), enemies: expect.any(Array), abilities: expect.any(Array), items: expect.any(Array), legalActions: expect.arrayContaining([expect.objectContaining({ score: expect.any(Number), selected: expect.any(Boolean) })]), chosen: expect.any(String) }));
    expect(simulateCombat({ classId: 'Mage', enemies: [dummy()], seed: 3, policy: 'strategic' }).decisionDiagnostics).toBeUndefined();
    expect(() => JSON.stringify(simulateCombatBatch({ location: 'goblin', classId: 'Mage', profile: 'prepared', boss: true, runs: 1, seed: 3, verbose: true }))).not.toThrow();
  });

  test('standalone batch selects the authored boss and accepts a replayed player state', () => {
    const clean = simulateCombatBatch({ location: 'goblin', classId: 'Mage', profile: 'prepared', boss: true, runs: 1, seed: 4 });
    expect(clean.config).toMatchObject({ encounterType: 'authored-boss', replayedPlayerState: false });
    expect(clean.results[0].composition).toMatch(/Рагшнар/);
    const replay = simulateCombatBatch({ location: 'goblin', boss: true, runs: 1, seed: 4, playerState: resolveSimulationPlayerProfile({ classId: 'Mage', profile: 'prepared' }).player });
    expect(replay.config.replayedPlayerState).toBe(true);
  });

  test('production consumable quantity decrements once and is exposed in metrics', () => {
    const player = createSimulationPlayer({ classId: 'Archer', hp: 20, abilityIds: ['Атака'], items: ['Малое зелье здоровья'] });
    const result = simulateCombat({ player, enemies: [dummy({ hp: 20 })], seed: 10, policy: 'strategic', verbose: true });
    expect(result.consumableUsage['Малое зелье здоровья']).toBe(1);
    expect(result.itemsRemaining['Малое зелье здоровья']).toBeUndefined();
    expect(result.trace.some(entry => entry.kind === 'item' && entry.quantityBefore === 1 && entry.quantityAfter === 0)).toBe(true);
  });

  test('Elementalist scoring values lethal and same-school state instead of blindly reacting', () => {
    const lethal = makeSession('Mage', ['Огненный шар', 'Ледяное копьё'], { magAtk: 100 });
    lethal.state.enemies[0].hp = 10; lethal.state.enemies[0].effects = [{ id: 'burn' }];
    expect(chooseCombatAction({ policy: 'strategic', session: lethal, rng: createSeededSimulationRng(1) }).target.hp).toBe(10);
    const resonance = makeSession('Mage', ['Огненный шар', 'Ледяное копьё'], { magAtk: 30, _elementalResonance: { school: 'fire', level: 4 } });
    expect(chooseCombatAction({ policy: 'strategic', session: resonance, rng: createSeededSimulationRng(1) }).ability.artId).toBe('fireball');
  });

  test('Elemental Echo receives the same score as an equivalent spell against a lone enemy', () => {
    const session = makeSession('Mage', ['Стихийное эхо'], { _lastElementalSchool: 'fire' });
    const player = session.state.players[0];
    player._lastElementalSchool = 'fire';
    const action = getLegalCombatActions(session).find(entry => entry.ability?.artId === 'elemental_echo');
    expect(action).toBeDefined();
    const ordinary = { ...action, ability: { ...action.ability, artId: 'plain_fire', name: 'Обычный огонь', school: 'fire' } };
    expect(scoreCombatAbilityAction(action, player, session, 'strategic')).toBe(scoreCombatAbilityAction(ordinary, player, session, 'strategic'));
  });

  test('boss-aware policy is selected only for authored bosses and remains a compatible explicit batch policy', () => {
    const report = simulateCombatBatch({ location: 'goblin', classId: 'Mage', profile: 'prepared', boss: true, bossPolicy: 'boss_aware', policy: 'competent', runs: 2, seed: 9 });
    expect(report.config).toMatchObject({ policy: 'competent', bossPolicy: 'boss_aware', encounterType: 'authored-boss' });
    expect(report.bossEvaluatorCoverage.authoredBosses).toContain('Пепельный Колпак Рагшнар');
    expect(simulateCombatBatch({ location: 'goblin', boss: true, policy: 'strategic', runs: 1 }).config.bossPolicy).toBe('strategic');
    const ordinary = makeSession('Archer', ['Зазубренная стрела', 'Атака']);
    expect(chooseCombatAction({ policy: 'boss_aware', session: ordinary, rng: createSeededSimulationRng(9) })).toEqual(chooseCombatAction({ policy: 'strategic', session: ordinary, rng: createSeededSimulationRng(9) }));
  });

  test('boss-aware scoring responds to visible preparation durability and control immunity', () => {
    const player = createSimulationPlayer({ classId: 'Mage', abilityIds: ['Ледяное копьё', 'Атака'] });
    const boss = dummy({ name: 'Мастер клинков', hp: 200, maxHp: 285, boss: true, controlImmune: true, _preparation: { kind: 'blade_dance', durability: 15 } });
    const session = { state: { players: [player], enemies: [boss] } };
    const actions = getLegalCombatActions(session);
    const interrupt = actions.find(action => action.expectedDamage >= 15);
    expect(scoreBossAwareAction(interrupt, player, session)).toBeGreaterThan(interrupt.expectedDamage + 400);
    boss._preparation = null;
    const ice = actions.find(action => action.ability.artId === 'ice_lance');
    expect(scoreBossAwareAction(ice, player, session)).toBeLessThan(ice.expectedDamage);
    expect(SIMULATION_BOSS_MECHANICS['Мастер клинков'].mechanics).toContain('80-durability-interrupt');
  });

  test('paired replay keeps the identical supplied state across boss policies', () => {
    const state = resolveSimulationPlayerProfile({ classId: 'Defender', profile: 'prepared' }).player;
    const competent = simulateCombatBatch({ location: 'deserter', boss: true, playerState: state, policy: 'competent', runs: 3, seed: 44 });
    const aware = simulateCombatBatch({ location: 'deserter', boss: true, playerState: state, policy: 'competent', bossPolicy: 'boss_aware', runs: 3, seed: 44 });
    expect(competent.profile).toEqual(aware.profile);
    expect(competent.config.replayedPlayerState).toBe(true);
    expect(aware.config.replayedPlayerState).toBe(true);
  });

  test('explicit authored fungal encounter selection preserves composition and strong classification', () => {
    const report = simulateCombatBatch({ location: 'fungal', enemyNames: ['Троглодит-заражённый', 'Костестраж'], completedCombats: 7, runs: 2, seed: 77, policy: 'competent' });
    expect(report.results).toHaveLength(2);
    report.results.forEach(result => {
      expect(result.composition).toContain('Троглодит-заражённый');
      expect(result.composition).toContain('Костестраж');
      expect(result.hasStrongEnemy).toBe(true);
    });
  });
});

test('stunned actors with healing potions resolve the skipped turn instead of retrying the potion', () => {
  const player = resolveSimulationPlayerProfile({ classId: 'Defender', profile: 'prepared', relicLevel: 1,
    equipment: { helmet: 'Шлем чужого сигнала', armor: 'Кираса последнего в строю', legs: 'Сапоги загонщика', mainHand: 'Клинок должника', offHand: 'Щит третьей заплаты', ring1: 'Кольцо чужой смены', ring2: 'Перстень живых шрамов', amulet: 'Медальон неотпетого', bag: 'Походная сумка Гильдии' },
    consumables: [{ id: 'Зелье здоровья', quantity: 3 }] }).player;
  player.abyssLevel = 2; player.currentLocation = 'Лес Увядания';
  const result = simulateCombat({ player, enemyNames: ['Друид-медведь', 'Ведьма Лепестков', 'Эльфийская лучница'], seed: 775728526, policy: 'competent' });
  expect(result.abnormal).toBe(false);
  expect(result.enemyTurns).toBeGreaterThan(12);
  expect(result.consumableUses).toBeLessThanOrEqual(3);
});

describe('L2 field traps: paired synthetic combat probes (simulator policy, not human win rates)', () => {
  const traps = ['Западня хищных побегов', 'Погребальная печать', 'Огненная западня'];
  const makePlayer = item => {
    const player = createSimulationPlayer({ classId: 'Defender', hp: 240, abilityIds: ['Атака'] });
    return {
      ...player, hp: 240, maxHp: 240, attack: 52, magAtk: 16, speed: 120,
      physDef: 24, magicDef: 24,
      baseStats: { ...(player.baseStats || {}), maxHp: 240, attack: 52, magAtk: 16, speed: 120, physDef: 24, magicDef: 24 },
      items: item ? [{ name: item }] : [],
    };
  };
  const makeFoes = count => Array.from({ length: count }, (_, i) => dummy({
    name: `Синтетический враг ${i + 1}`, hp: 145, maxHp: 145, attack: 32, magAtk: 28,
    speed: 105, physDef: 10, magicDef: 10,
  }));

  test('compare trap/no-trap outcomes across groups of one, three and six', () => {
    const reports = [];
    const n = 12;
    for (const count of [1, 3, 6]) {
      const baseline = Array.from({ length: n }, (_, i) => simulateCombat({
        player: makePlayer(null), enemies: makeFoes(count), policy: 'competent',
        seed: 7411 + i, maxActions: 250,
      }));
      for (const trap of traps) {
        const treated = Array.from({ length: n }, (_, i) => simulateCombat({
          player: makePlayer(trap), enemies: makeFoes(count), policy: 'competent',
          seed: 7411 + i, maxActions: 250,
        }));
        const wins = result => result.filter(r => r.outcome === 'victory').length;
        const mean = (result, key) => Math.round(result.reduce((sum, r) => sum + (Number(r[key]) || 0), 0) / n * 10) / 10;
        reports.push({
          trap, enemies: count, runs: n,
          baselineWins: wins(baseline), trapWins: wins(treated),
          baselineDamageReceived: mean(baseline, 'damageReceived'),
          trapDamageReceived: mean(treated, 'damageReceived'),
          baselineActions: mean(baseline, 'actions'),
          trapActions: mean(treated, 'actions'),
          baselineDamageDealt: mean(baseline, 'playerDamageDealt'),
          trapDamageDealt: mean(treated, 'playerDamageDealt'),
          activated: treated.reduce((sum, r) => sum + (r.fieldTrapUsage?.[trap] || 0), 0),
          abnormal: treated.filter(r => r.abnormal).length,
        });
        expect(treated.every(r => Number.isFinite(r.actions))).toBe(true);
      }
    }
    // Log in CI for review; numbers are synthetic snapshots, not game-wide balance claims.
    console.info('L2_FIELD_TRAP_PAIRED_PROBES=' + JSON.stringify(reports));
    expect(reports).toHaveLength(9);
  }, 120000);
});

describe('Predatory Shoots trap: matched turn-meter gain experiment', () => {
  const trap = FIELD_CONSUMABLES.find(item => item.name === 'Западня хищных побегов');
  const name = trap.name;
  const gains = [0, 300, 400, 500]; // control; +30%, +40%, +50%
  const runsPerArm = 20;
  const seeded = 86520;

  const playerFor = (withTrap, classId = 'Defender') => {
    const original = createSimulationPlayer({ classId, abilityIds: ['Атака'], passiveIds: [] });
    const baseStats = { ...(original.baseStats || {}), maxHp: 390,
      attack: classId === 'Mage' ? 20 : 74, magAtk: classId === 'Mage' ? 74 : 20,
      speed: 142, physDef: 38, magicDef: 32 };
    return { ...original, ...baseStats, baseStats, hp: 390,
      items: withTrap ? [{ name }] : [] };
  };
  const weak = count => Array.from({ length: count }, (_, i) => dummy({
    name: `Испытатель ${i + 1}`,
    hp: 125, maxHp: 125, attack: 19, magAtk: 8,
    physDef: 7, magicDef: 7, speed: 110, abilities: [],
  }));
  const scenarios = [
    { label: 'synthetic-1', names: null, synthetic: 1 },
    { label: 'synthetic-3', names: null, synthetic: 3 },
    { label: 'synthetic-6', names: null, synthetic: 6 },
    { label: 'forest-witch', names: ['Ведьма Лепестков'] },
    { label: 'forest-witch-archer', names: ['Ведьма Лепестков', 'Эльфийская лучница'] },
    { label: 'forest-bear-healer', names: ['Друид-медведь'] },
    { label: 'forest-owl-tempo', names: ['Совиный друид'] },
    { label: 'forest-bear-witch', names: ['Друид-медведь', 'Ведьма Лепестков'] },
    { label: 'forest-three', names: ['Ведьма Лепестков', 'Эльфийская лучница', 'Терновый страж'] },
    { label: 'forest-six', names: ['Ведьма Лепестков', 'Эльфийская лучница', 'Терновый страж', 'Сеятель Гнуса', 'Тень чащи', 'Совиный друид'] },
  ];

  test('compare 0/30/40/50 percent against identical encounters/seeds', () => {
    const initial = trap.trap.turnMeterGain;
    const output = [];
    try {
      // Mutations are test-local and restored even if a fight throws.
      for (const scenario of scenarios) {
        const classId = 'Defender';
        const withoutTrap = Array.from({ length: runsPerArm }, (_, index) => simulateCombat({
          player: playerFor(false, classId),
          ...(scenario.names ? { enemyNames: scenario.names } : { enemies: weak(scenario.synthetic) }),
          seed: seeded + index, policy: 'competent', maxActions: 180,
        }));
        const withoutTrapMean = key => Math.round(withoutTrap.reduce((sum, r) =>
          sum + (Number(r[key]) || 0), 0) / runsPerArm * 10) / 10;
        const noTrap = {
          wins: withoutTrap.filter(r => r.outcome === 'victory').length,
          damageTaken: withoutTrapMean('damageReceived'),
          damageDealt: withoutTrapMean('playerDamageDealt'),
          totalActions: withoutTrapMean('actions'),
          enemyTurns: withoutTrapMean('enemyTurns'),
        };
        const results = {};
        for (const gain of gains) {
          trap.trap.turnMeterGain = gain;
          const fights = Array.from({ length: runsPerArm }, (_, index) => simulateCombat({
            player: playerFor(true, classId),
            ...(scenario.names ? { enemyNames: scenario.names } : { enemies: weak(scenario.synthetic) }),
            seed: seeded + index, policy: 'competent', maxActions: 180,
          }));
          const mean = key => Math.round(fights.reduce((sum, r) => sum + (Number(r[key]) || 0), 0) / runsPerArm * 10) / 10;
          results[gain] = {
            wins: fights.filter(r => r.outcome === 'victory').length,
            abnormal: fights.filter(r => r.abnormal).length,
            activations: fights.reduce((sum, r) => sum + (r.fieldTrapUsage?.[name] || 0), 0),
            damageTaken: mean('damageReceived'),
            damageDealt: mean('playerDamageDealt'),
            totalActions: mean('actions'),
            enemyTurns: mean('enemyTurns'),
          };
          expect(results[gain].abnormal).toBe(0);
        }
        // A no-use scenario cannot demonstrate a turn-meter refund.
        expect(results[0].activations).toBeGreaterThan(0);
        output.push({ scenario: scenario.label, classId, n: runsPerArm, noTrap, arms: results });
      }
    } finally {
      if (initial === undefined) delete trap.trap.turnMeterGain;
      else trap.trap.turnMeterGain = initial;
    }
    console.info('PREDATORY_TRAP_GAIN_EXPERIMENT=' + JSON.stringify(output));
    expect(output).toHaveLength(scenarios.length);
  }, 180000);
});

describe('Consumable turn-value diagnostics: authored floor-two encounters', () => {
  const names = [
    'Западня хищных побегов',
    'Погребальная печать',
    'Огненная западня',
    'Защитный настой',
    'Очищающий состав',
    'Свиток Огненного шара',
    'Свиток Ядовитого облака',
    'Свиток Конус льда',
    'Свиток уязвимости',
    'Свиток Кровавого касания',
  ];
  const scenarios = [
    { id: 'forest-bear', enemies: ['Друид-медведь'] },
    { id: 'forest-owl', enemies: ['Совиный друид'] },
    { id: 'forest-witch-archer', enemies: ['Ведьма Лепестков', 'Эльфийская лучница'] },
    { id: 'forest-three', enemies: ['Ведьма Лепестков', 'Эльфийская лучница', 'Терновый страж'] },
  ];
  const trials = 16;
  const createPlayer = item => {
    const player = createSimulationPlayer({ classId: 'Defender', abilityIds: ['Атака'], passiveIds: [] });
    const baseStats = { ...player.baseStats, maxHp: 390, attack: 74, magAtk: 20,
      physDef: 38, magicDef: 32, speed: 142 };
    return { ...player, ...baseStats, baseStats, hp: 390, items: item ? [{ name: item }] : [] };
  };
  const run = (scenario, item) => Array.from({ length: trials }, (_, i) =>
    simulateCombat({ player: createPlayer(item), enemyNames: scenario.enemies,
      seed: 97490 + i, policy: 'competent', maxActions: 180 }));
  const summarize = (results, item) => {
    const average = k => Math.round(results.reduce((total, result) => total + (Number(result[k]) || 0), 0) / trials * 10) / 10;
    return {
      wins: results.filter(result => result.outcome === 'victory').length,
      abnormal: results.filter(result => result.abnormal).length,
      uses: item ? results.reduce((sum, result) => sum +
        (result.fieldTrapUsage?.[item] || result.consumableUsage?.[item] || 0), 0) : 0,
      taken: average('damageReceived'), dealt: average('playerDamageDealt'),
      enemyTurns: average('enemyTurns'), actions: average('actions'),
    };
  };

  test('compares per-item contribution to a matching no-item baseline', () => {
    const report = scenarios.map(scenario => ({
      scenario: scenario.id, n: trials,
      noItem: summarize(run(scenario, null), null),
      items: Object.fromEntries(names.map(name => {
        const results = run(scenario, name);
        expect(results.every(result => !result.abnormal)).toBe(true);
        return [name, summarize(results, name)];
      })),
    }));
    console.info('FIELD_CONSUMABLE_PAIRED_DIAGNOSTICS=' + JSON.stringify(report));
    expect(report).toHaveLength(scenarios.length);
  }, 180000);
});

describe('L2 consumables versus simulated Ruins/Mines threat profiles (not authored enemies)', () => {
  const variants = [
    null, 'Погребальная печать', 'Огненная западня', 'Защитный настой',
    'Очищающий состав', 'Свиток кражи щита', 'Свиток рассеивания',
    'Свиток Огненного шара', 'Свиток уязвимости',
  ];
  const templates = [
    { id: 'proxy-shielded-ruins', enemies: () => [
      dummy({ name: 'Щитоносец (модель)', hp: 285, maxHp: 285,
        attack: 42, magAtk: 14, physDef: 22, magicDef: 20, speed: 112 }),
      dummy({ name: 'Заклинатель (модель)', hp: 215, maxHp: 215,
        attack: 12, magAtk: 52, physDef: 9, magicDef: 21, speed: 125 }),
    ], enemyEffects: [
      [{ id: 'shield', value: 80, duration: 3 }, { id: 'attack_boost_minor', duration: 3 }],
      [{ id: 'shield', value: 35, duration: 3 }, { id: 'magic_attack_boost_minor', duration: 3 }],
    ] },
    { id: 'proxy-magical-mines', playerEffects: [{ id: 'poison', duration: 2 }], enemies: () => [
      dummy({ name: 'Маг шахт (модель)', hp: 185, maxHp: 185, attack: 10,
        magAtk: 52, physDef: 12, magicDef: 21, speed: 116 }),
      dummy({ name: 'Страж шахт (модель)', hp: 250, maxHp: 250, attack: 36,
        magAtk: 9, physDef: 22, magicDef: 18, speed: 103 }),
      dummy({ name: 'Поджигатель (модель)', hp: 180, maxHp: 180, attack: 17,
        magAtk: 42, physDef: 12, magicDef: 14, speed: 115 }),
    ] },
  ];
  const trials = 12;
  const fighter = (classId, item) => {
    const magical = classId === 'Mage';
    const abilities = magical ? ['Огненный шар', 'Конус льда', 'Атака'] : ['Атака'];
    const base = createSimulationPlayer({ classId, abilityIds: abilities, passiveIds: [] });
    const baseStats = { ...base.baseStats, maxHp: 390,
      attack: magical ? 20 : 74, magAtk: magical ? 74 : 20,
      physDef: magical ? 25 : 38, magicDef: magical ? 38 : 32, speed: 142 };
    return { ...base, ...baseStats, baseStats, hp: 390, items: item ? [{ name: item }] : [] };
  };
  const mean = (runs, key) => Math.round(runs.reduce((acc, x) => acc + (Number(x[key]) || 0), 0) / trials * 10) / 10;

  test('paired baseline and consumables with 12 matching seeds per model and class', () => {
    const reports = [];
    for (const classId of ['Defender', 'Mage']) {
      for (const template of templates) {
        const arms = {};
        for (const item of variants) {
          const results = Array.from({ length: trials }, (_, n) => simulateCombat({
            player: fighter(classId, item), enemies: template.enemies(),
            startingEnemyEffects: template.enemyEffects || [],
            startingPlayerEffects: template.playerEffects || [],
            seed: 34000 + n, policy: 'competent', maxActions: 180,
          }));
          expect(results.every(result => !result.abnormal)).toBe(true);
          arms[item || 'none'] = {
            wins: results.filter(result => result.outcome === 'victory').length,
            uses: item ? results.reduce((n, x) =>
              n + (x.consumableUsage?.[item] || x.fieldTrapUsage?.[item] || 0), 0) : 0,
            damageTaken: mean(results, 'damageReceived'),
            damageDealt: mean(results, 'playerDamageDealt'),
            actions: mean(results, 'actions'),
          };
        }
        reports.push({ classId, scenario: template.id, trials, arms });
      }
    }
    console.info('FIELD_CONSUMABLE_L2_PROXY_DIAGNOSTICS=' + JSON.stringify(reports));
    expect(reports).toHaveLength(4);
  }, 180000);

  test('compares 20/25/35 Shield while preserving the two-turn Ward effect', () => {
    const name = 'Защитный настой';
    const definition = getItemDefinition(name);
    const shield = definition.effects.find(effect => effect.id === 'shield');
    const original = shield.value;
    const output = [];
    try {
      for (const classId of ['Defender', 'Mage']) {
        for (const template of templates) {
          const variants = [];
          for (const amount of [20, 25, 35]) {
            shield.value = amount;
            const results = Array.from({ length: trials }, (_, n) => simulateCombat({
              player: fighter(classId, name), enemies: template.enemies(),
              startingEnemyEffects: template.enemyEffects || [],
              startingPlayerEffects: template.playerEffects || [],
              seed: 34000 + n, policy: 'competent', maxActions: 180,
            }));
            expect(results.every(x => !x.abnormal)).toBe(true);
            variants.push({
              shield: amount,
              wins: results.filter(x => x.outcome === 'victory').length,
              uses: results.reduce((sum, x) => sum + (x.consumableUsage?.[name] || 0), 0),
              damageTaken: mean(results, 'damageReceived'),
              actions: mean(results, 'actions'),
            });
          }
          output.push({ classId, scenario: template.id, n: trials, variants });
        }
      }
    } finally {
      shield.value = original;
    }
    console.info('FIELD_DEFENSIVE_INFUSION_SHIELD_VARIANTS=' + JSON.stringify(output));
    expect(original).toBe(35);
    expect(output).toHaveLength(4);
  }, 180000);
});
