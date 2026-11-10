import { createEnemyInstanceByName, getEnemyBlueprintByName } from '../data/enemies';
import { applySimulationBossVariant, applySimulationEncounterVariant, resolveSimulationBalanceVariant } from './simulationBalanceVariants';
import { chooseCombatAction, estimateVisibleThreatBeforeNextTurn, simulateCombatBatch } from './combatSimulator';
import { applyDamage, calculateVisibleDamage, initCombatSession, processEnemyAI } from './combatUtils';
import { addEffect, cleanseEffects, triggerEffectTick } from './effects';
import { simulateRuns } from './runSimulator';
import shieldbreakerReport from '../../docs/simulation/blade-master-shieldbreaker-ab-20260908.json';

describe('simulator-only balance variants', () => {
  test('baseline is immutable and contains no override', () => {
    expect(resolveSimulationBalanceVariant()).toEqual(expect.objectContaining({ id: 'production_baseline', overrides: [] }));
    expect(() => resolveSimulationBalanceVariant('missing')).toThrow(/Unknown simulator balance variant/);
  });

  test('early double-infected override is isolated to pre-strong encounters', () => {
    const pair = [createEnemyInstanceByName('Троглодит-заражённый'), createEnemyInstanceByName('Троглодит-заражённый')];
    expect(applySimulationEncounterVariant({ encounter: pair, variant: 'production_baseline', completedCombatRooms: 0 }).encounter.map(enemy => enemy.name)).toEqual(['Троглодит-заражённый', 'Троглодит-заражённый']);
    expect(applySimulationEncounterVariant({ encounter: pair, variant: 'fungal_early_no_double_infected', completedCombatRooms: 0 }).encounter.map(enemy => enemy.name)).toEqual(['Троглодит-споровик', 'Троглодит-заражённый']);
    expect(applySimulationEncounterVariant({ encounter: pair, variant: 'fungal_early_no_double_infected', completedCombatRooms: 7 }).encounter).toHaveLength(2);
    const rerolled = [createEnemyInstanceByName('Троглодит-копейщик'), createEnemyInstanceByName('Троглодит-шаман')];
    expect(applySimulationEncounterVariant({ encounter: pair, variant: 'fungal_early_no_double_infected', completedCombatRooms: 0, rerollEncounter: () => rerolled }).encounter).toStrictEqual(rerolled);
  });

  test('two-headed solo remains a legal authored strong encounter', () => {
    const pair = [createEnemyInstanceByName('Змеиный двоеглав'), createEnemyInstanceByName('Троглодит-шаман')];
    const result = applySimulationEncounterVariant({ encounter: pair, variant: 'two_headed_solo', completedCombatRooms: 7 });
    expect(result.encounter.map(enemy => enemy.name)).toEqual(['Змеиный двоеглав']);
    expect(result.encounter[0].encounterPhase).toBe('late');
  });

  test('boss overrides clone abilities without mutating production instances', () => {
    const production = createEnemyInstanceByName('Троглодит-мицелий (босс)');
    const feeding = production.abilities.find(ability => ability.artId === 'mycelium_feeding');
    const experimental = applySimulationBossVariant(production, 'mycelium_healing_reduced');
    expect(experimental).not.toBe(production);
    expect(experimental.abilities.find(ability => ability.artId === 'mycelium_feeding').onTurnStart).not.toBe(feeding.onTurnStart);
    expect(production._simulationBalanceVariant).toBeUndefined();
  });

  test('capped feeding consumes its three-turn cycle only after actual poison-fed healing', () => {
    const boss = applySimulationBossVariant(createEnemyInstanceByName('Троглодит-мицелий (босс)'), 'mycelium_healing_capped');
    const feeding = boss.abilities.find(ability => ability.artId === 'mycelium_feeding');
    const hero = { effects: [] }; const context = { owner: boss, session: { state: { players: [hero] } }, log: jest.fn() };
    boss.hp = 300;
    feeding.onTurnStart(context); expect(boss.hp).toBe(300);
    hero.effects = [{ id: 'poison' }]; feeding.onTurnStart(context); expect(boss.hp).toBe(356);
    feeding.onTurnStart(context); feeding.onTurnStart(context); expect(boss.hp).toBe(356);
    feeding.onTurnStart(context); expect(boss.hp).toBe(412);
  });

  test('reports preserve deterministic resolved overrides and encounter configuration', () => {
    const config = { location: 'fungal', classId: 'Archer', profile: 'fresh', completedCombats: 0, balanceVariant: 'fungal_early_no_double_infected', runs: 10, seed: 20260901 };
    const first = simulateCombatBatch(config);
    expect(first).toEqual(simulateCombatBatch(config));
    expect(first.config).toEqual(expect.objectContaining({ balanceVariant: 'fungal_early_no_double_infected', balanceOverrides: expect.any(Array), resolvedEncounter: expect.any(String), resolvedEncounterConfiguration: expect.any(Array), seed: 20260901 }));
  });

  test('seeded simulator contains authored hooks that use global randomness', () => {
    const config = { location: 'fungal', classId: 'Archer', profile: 'prepared', policy: 'competent', completedCombats: 7, runs: 50, seed: 20260901 };
    expect(simulateCombatBatch(config)).toEqual(simulateCombatBatch(config));
  });

  test('promoted fungal HP is production-authored and cannot be applied twice', () => {
    const infected = createEnemyInstanceByName('Троглодит-заражённый');
    const spore = createEnemyInstanceByName('Троглодит-споровик');
    const late = createEnemyInstanceByName('Змеиный двоеглав');
    const production = applySimulationEncounterVariant({ encounter: [infected, spore, late], variant: 'production_baseline' }).encounter;
    const alias = applySimulationEncounterVariant({ encounter: [infected, spore, late], variant: 'fungal_infected_hp_minus_15' });
    expect(production.map(enemy => enemy.maxHp)).toEqual([75, 68, 136]);
    expect(alias.encounter.map(enemy => enemy.maxHp)).toEqual(production.map(enemy => enemy.maxHp));
    expect(alias.variant).toEqual(expect.objectContaining({ status: 'promoted_to_production', overrides: [] }));
    const broad = applySimulationEncounterVariant({ encounter: [infected, spore, late], variant: 'fungal_early_all_hp_minus_10' }).encounter;
    expect(broad.map(enemy => enemy.maxHp)).toEqual([68, 61, 136]);
  });

  test.each([
    ['ragshnar_hp_minus_100_resolved', 'Пепельный Колпак Рагшнар', -100, 0],
    ['blade_master_hp_plus_100_resolved', 'Мастер клинков', 100, 0],
    ['blade_master_speed_plus_10_resolved', 'Мастер клинков', 0, 10],
    ['blade_master_hp_plus_100_speed_plus_10', 'Мастер клинков', 100, 10],
  ])('%s applies exact resolved deltas', (variant, name, hp, speed) => {
    const production = createEnemyInstanceByName(name);
    const changed = applySimulationBossVariant(production, variant);
    expect(changed.maxHp).toBe(production.maxHp + hp);
    expect(changed.hp).toBe(production.hp + hp);
    expect(changed.speed).toBe(production.speed + speed);
  });

  test('authored Blade Master candidate uses canonical scaling and cannot mutate production', () => {
    const blueprint = getEnemyBlueprintByName('Мастер клинков');
    const blueprintBefore = JSON.parse(JSON.stringify(blueprint));
    const production = createEnemyInstanceByName(blueprint.name);
    const productionBefore = { ...production, abilities: production.abilities.map(ability => ({ ...ability })) };
    const candidate = applySimulationBossVariant(production, 'blade_master_attack_plus_5_speed_plus_10_authored');
    expect(blueprint).toMatchObject({ maxHp: 285, hp: 285, attack: 24, speed: 100 });
    expect(candidate._simulationAuthoredIntent).toEqual({ maxHp: 285, attack: 29, speed: 110 });
    expect(candidate).toMatchObject({ maxHp: 499, hp: 499, attack: 39, speed: 121 });
    expect(candidate._simulationResolvedStats).toEqual({ maxHp: 499, attack: 39, speed: 121 });
    expect(candidate).toMatchObject({ physDef: production.physDef, magicDef: production.magicDef });
    expect(candidate.abilities.map(({ name, artId, cooldown }) => ({ name, artId, cooldown }))).toEqual(production.abilities.map(({ name, artId, cooldown }) => ({ name, artId, cooldown })));
    expect(candidate.abilities.find(ability => ability.name === 'Нарушенная клятва').hpThresholdPreparation).toEqual(production.abilities.find(ability => ability.name === 'Нарушенная клятва').hpThresholdPreparation);
    expect(blueprint).toEqual(blueprintBefore);
    expect(production).toEqual(productionBefore);
    expect(resolveSimulationBalanceVariant('blade_master_attack_plus_5_speed_plus_10_authored')).toEqual(expect.objectContaining({ status: 'screened_rejected' }));
  });

  test('authored Blade Master candidate is boss-local, deterministic, and reports intent', () => {
    const otherBoss = createEnemyInstanceByName('Пепельный Колпак Рагшнар');
    expect(applySimulationBossVariant(otherBoss, 'blade_master_attack_plus_5_speed_plus_10_authored')).toMatchObject({ maxHp: otherBoss.maxHp, attack: otherBoss.attack, speed: otherBoss.speed });
    const ordinary = createEnemyInstanceByName('Гоблин-боец');
    expect(applySimulationBossVariant(ordinary, 'blade_master_attack_plus_5_speed_plus_10_authored')).toBe(ordinary);
    const config = { location: 'deserter', classId: 'Mage', profile: 'established', balanceVariant: 'blade_master_shieldbreaker_physdef_18', boss: true, policy: 'boss_aware', runs: 4, seed: 20260908 };
    const first = simulateCombatBatch(config); const second = simulateCombatBatch(config);
    expect(first.matchedFightOutcomes).toEqual(second.matchedFightOutcomes);
    expect(first.config).toEqual(expect.objectContaining({ balanceVariantStatus: 'promoted_to_production', balanceOverrides: [], promotedOverrides: ['boss.bladeMaster.authoredPhysDef', 'boss.bladeMaster.preciseStrike.shieldDamageMultiplier'] }));
    expect(first.config.resolvedEncounterConfiguration[0]).toMatchObject({ maxHp: 499, attack: 32, physDef: 23, magicDef: 13, speed: 110 });
  });

  test('paired Blade Master route variants preserve every reached pre-boss state and seed', () => {
    const config = { location: 'deserter', classId: 'Archer', profile: 'prepared', runs: 8, seed: 20260908, policy: 'balanced', combatMode: 'simulated', combatPolicy: 'strategic', bossPolicy: 'boss_aware', lootPolicy: 'balanced', gearPolicy: 'smart', craftPolicy: 'balanced', extractionPolicy: 'balanced', tuning: 'production_7_14' };
    const baseline = simulateRuns({ ...config, balanceVariant: 'production_baseline' });
    const candidate = simulateRuns({ ...config, balanceVariant: 'blade_master_shieldbreaker_physdef_18' });
    expect(baseline.matchedRunOutcomes).toHaveLength(config.runs);
    expect(candidate.matchedRunOutcomes).toHaveLength(config.runs);
    baseline.matchedRunOutcomes.forEach((row, index) => {
      const paired = candidate.matchedRunOutcomes[index];
      if (row.bossReached && paired.bossReached) {
        expect(paired.bossEntryState).toBe(row.bossEntryState);
        expect(paired.bossSeed).toBe(row.bossSeed);
      }
    });
  });

  test('production shieldbreaker canonically resolves defense and its alias is a no-op', () => {
    const blueprint = getEnemyBlueprintByName('Мастер клинков'); const before = JSON.parse(JSON.stringify(blueprint));
    const baseline = createEnemyInstanceByName(blueprint.name);
    const alias = applySimulationBossVariant(baseline, 'blade_master_shieldbreaker_physdef_18');
    expect(blueprint).toMatchObject({ maxHp: 285, hp: 285, attack: 24, physDef: 18, magicDef: 10, speed: 100 });
    expect(baseline).toMatchObject({ maxHp: 499, hp: 499, attack: 32, physDef: 23, magicDef: 13, speed: 110 });
    expect(alias).toMatchObject({ maxHp: 499, hp: 499, attack: 32, physDef: 23, magicDef: 13, speed: 110 });
    const strike = alias.abilities.find(ability => ability.name === 'Точный выпад');
    expect(strike).toMatchObject({ cooldown: 2, shieldDamageMultiplier: 2, description: 'Наносит 145% физического урона. Наносит двойной урон Щиту.' });
    expect(strike.damage({ attacker: alias })).toBe(Math.round(alias.attack * 1.45));
    alias.abilities.filter(ability => ability.name !== 'Точный выпад').forEach(ability => expect(ability.shieldDamageMultiplier).toBeUndefined());
    expect(createEnemyInstanceByName('Костестраж').abilities.every(ability => ability.shieldDamageMultiplier === undefined)).toBe(true);
    expect(blueprint).toEqual(before);
    expect(createEnemyInstanceByName(blueprint.name).abilities.find(ability => ability.name === 'Точный выпад')).toHaveProperty('shieldDamageMultiplier', 2);
    expect(alias.abilities).toEqual(baseline.abilities);
    expect(resolveSimulationBalanceVariant('blade_master_shieldbreaker_physdef_18')).toEqual(expect.objectContaining({ status: 'promoted_to_production', overrides: [] }));
    const ragshnar = createEnemyInstanceByName('Пепельный Колпак Рагшнар');
    expect(applySimulationBossVariant(ragshnar, 'blade_master_shieldbreaker_physdef_18')).toMatchObject({ maxHp: ragshnar.maxHp, attack: ragshnar.attack, physDef: ragshnar.physDef, speed: ragshnar.speed });
  });

  test.each([[60, 0, 60], [20, 20, 20], [100, 0, 80], [0, 40, 0]])('canonical shield multiplier preserves HP overflow semantics for shield %i', (shield, expectedHpLoss, expectedShieldLoss) => {
    const target = { hp: 100, maxHp: 100, shield, physDef: 0, effects: [] };
    const dealt = applyDamage(target, 40, 'physical', { shieldDamageMultiplier: 2, directAttack: true });
    expect(100 - target.hp).toBe(expectedHpLoss); expect(shield - target.shield).toBe(expectedShieldLoss); expect(dealt).toBe(expectedHpLoss);
  });

  test('missed candidate Precise Strike cannot damage Shield', () => {
    const boss = applySimulationBossVariant(createEnemyInstanceByName('Мастер клинков'), 'blade_master_shieldbreaker_physdef_18');
    boss.abilities = [boss.abilities.find(ability => ability.name === 'Точный выпад')];
    const hero = { name: 'hero', hp: 100, maxHp: 100, shield: 80, physDef: 0, speed: 1000, turnMeter: 900, effects: [], abilities: [] };
    const session = initCombatSession(hero, [boss], { rng: () => .99 }); addEffect(session.state.players[0], { id: 'shield', value: 80, duration: 3 }); session.state.enemies[0].abilities = [session.state.enemies[0].abilities.find(ability => ability.name === 'Точный выпад')]; session.state.enemies[0].abilities[0].accuracy = 0; session.state.initiative.playerReady = false; session.state.enemies[0].turnMeter = 1000;
    processEnemyAI(session);
    expect(session.state.players[0]).toMatchObject({ hp: 100, shield: 80 });
    expect(session.state.metrics.preciseStrikeHits || 0).toBe(0);
  });

  test('shieldbreaker screening report has complete paired arithmetic and zero overflow', () => {
    expect(shieldbreakerReport.validation).toMatchObject({ expectedCleanFights: 3600, actualCleanFights: 3600, expectedRoutes: 1800, actualRoutes: 1800, allReachedPreBossStatesMatched: true, shieldOverflowCases: 0, complete: true });
    expect(shieldbreakerReport.clean).toHaveLength(18); expect(shieldbreakerReport.routes).toHaveLength(18);
    expect(shieldbreakerReport.clean.every(cell => cell.fights === 200 && cell.victories + cell.defeats === 200)).toBe(true);
    expect(shieldbreakerReport.routes.every(cell => cell.runs === 100 && cell.bossVictories + cell.bossDefeats === cell.bossReach)).toBe(true);
    expect(shieldbreakerReport.metadata.rejectedCandidateRerun).toBe(false);
  });

  test('production Inferno and its promoted alias use canonical statuses with unchanged lifecycle', () => {
    const blueprint = getEnemyBlueprintByName('Пепельный Колпак Рагшнар');
    expect(blueprint).toMatchObject({ maxHp: 375, hp: 375, attack: 27, magAtk: 10, physDef: 20, magicDef: 20, speed: 120 });
    const production = createEnemyInstanceByName(blueprint.name);
    const baseStats = { attack: production.attack, speed: production.speed };
    const boss = applySimulationBossVariant(production, 'production_baseline');
    const alias = applySimulationBossVariant(production, 'ragshnar_standard_inferno_buffs');
    expect(alias.abilities.map(ability => ability.onTurnStart)).toEqual(boss.abilities.map(ability => ability.onTurnStart));
    expect(resolveSimulationBalanceVariant('ragshnar_standard_inferno_buffs')).toEqual(expect.objectContaining({ status: 'promoted_to_production', overrides: [] }));

    boss.hp = Math.floor(boss.maxHp * .3); boss.effects = [];
    const inferno = boss.abilities.find(ability => ability.artId === 'inferno');
    const active = boss.abilities.find(ability => !ability.passive); active.currentCooldown = 2;
    const hero = { hp: 1, effects: [{ id: 'burn' }] }; const session = { state: { enemies: [boss], players: [hero], metrics: {} } };
    inferno.onTurnStart({ owner: boss, ability: inferno, session });
    expect(boss.attack).toBe(Math.round(baseStats.attack * 1.25));
    expect(boss.speed).toBe(Math.round(baseStats.speed * 1.3));
    expect(boss.statMultipliers).toEqual(expect.objectContaining({ attack: 1.25, speed: 1.3 }));
    expect(boss.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'attack_boost_minor', durationTotal: 3, remainingTurns: 3 }),
      expect.objectContaining({ id: 'speed_boost_major', durationTotal: 2, remainingTurns: 2 }),
    ]));
    expect(active.currentCooldown).toBe(1);
    expect(session.state.metrics).toEqual({ infernoAttackActivations: 1, infernoSpeedActivations: 1 });

    const speed = boss.effects.find(effect => effect.id === 'speed_boost_major'); speed.remainingTurns = 1;
    inferno.onTurnStart({ owner: boss, ability: inferno, session });
    expect(speed.remainingTurns).toBe(2);
    expect(session.state.metrics).toEqual({ infernoAttackActivations: 1, infernoSpeedActivations: 2 });
    hero.effects = []; inferno.onTurnStart({ owner: boss, ability: inferno, session });
    expect(boss.speed).toBe(baseStats.speed);
    inferno.onTurnStart({ owner: boss, ability: inferno, session });
    expect(session.state.metrics.infernoAttackActivations).toBe(1);
    cleanseEffects(boss, effect => effect.id === 'attack_boost_minor');
    expect(boss.attack).toBe(baseStats.attack);
    expect(boss.statMultipliers).toEqual(expect.objectContaining({ attack: 1, speed: 1 }));
    expect(boss.effects.some(effect => effect.id.startsWith('inferno_'))).toBe(false);
  });

  test('fixed-seed production and promoted aliases resolve equivalently', () => {
    const fungalConfig = { location: 'fungal', enemyNames: ['Троглодит-заражённый', 'Троглодит-споровик'], runs: 2, seed: 20260908 };
    const fungalProduction = simulateCombatBatch({ ...fungalConfig, balanceVariant: 'production_baseline' });
    const fungalAlias = simulateCombatBatch({ ...fungalConfig, balanceVariant: 'fungal_infected_hp_minus_15' });
    expect(fungalAlias.config.resolvedEncounterConfiguration).toEqual(fungalProduction.config.resolvedEncounterConfiguration);
    expect(fungalAlias.config).toEqual(expect.objectContaining({ balanceVariantStatus: 'promoted_to_production', balanceOverrides: [] }));

    const ragshnarConfig = { location: 'goblin', boss: true, runs: 2, seed: 20260908, profile: 'prepared', policy: 'boss_aware' };
    const ragshnarProduction = simulateCombatBatch({ ...ragshnarConfig, balanceVariant: 'production_baseline' });
    const ragshnarAlias = simulateCombatBatch({ ...ragshnarConfig, balanceVariant: 'ragshnar_standard_inferno_buffs' });
    expect(ragshnarAlias.config.resolvedEncounterConfiguration).toEqual(ragshnarProduction.config.resolvedEncounterConfiguration);
    expect(ragshnarAlias.config).toEqual(expect.objectContaining({ balanceVariantStatus: 'promoted_to_production', balanceOverrides: [] }));
    expect(ragshnarAlias.deserterMetrics).toEqual(ragshnarProduction.deserterMetrics);
    expect(ragshnarAlias.matchedFightOutcomes).toEqual(ragshnarProduction.matchedFightOutcomes);
  });

  test('double-bite variants preserve snapshot coefficient and use independent poison rolls', () => {
    const serpent = createEnemyInstanceByName('Змеиный двоеглав');
    const [changed] = applySimulationEncounterVariant({ encounter: [serpent], variant: 'two_headed_multihit_poison_50' }).encounter;
    const bite = changed.abilities.find(ability => ability.artId === 'double_bite');
    const target = { effects: [] };
    expect(bite.hits).toBe(2);
    expect(bite.damage({ attacker: changed, target }) * 2).toBe(changed.attack * 1.05);
    target.effects.push({ id: 'poison' });
    expect(bite.damage({ attacker: changed, target }) * 2).toBe(changed.attack * 1.3);
    const previous = Math.random; const rolls = [0.49, 0.51]; Math.random = () => rolls.shift();
    try { expect(bite.effect()).toEqual({ id: 'poison', duration: 2 }); expect(bite.effect()).toBeNull(); } finally { Math.random = previous; }
  });

  test('two independent 50% rolls produce the deterministic 0/1/2 poison distribution', () => {
    const serpent = applySimulationEncounterVariant({ encounter: [createEnemyInstanceByName('Змеиный двоеглав')], variant: 'two_headed_multihit_poison_50' }).encounter[0];
    const effect = serpent.abilities.find(ability => ability.artId === 'double_bite').effect;
    let state = 20260901; const previous = Math.random;
    Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    const distribution = [0, 0, 0];
    try { for (let index = 0; index < 10000; index += 1) distribution[Number(Boolean(effect())) + Number(Boolean(effect()))] += 1; } finally { Math.random = previous; }
    distribution.forEach((count, index) => expect(count / 10000).toBeCloseTo([.25, .5, .25][index], 1));
    expect(distribution.reduce((sum, count) => sum + count, 0)).toBe(10000);
  });

  test('threat forecast is RNG-free and policy reacts above legacy HP threshold', () => {
    const player = { name: 'hero', class: 'Archer', hp: 80, maxHp: 100, speed: 100, turnMeter: 0, physDef: 0, magicDef: 0, effects: [], abilities: [{ name: 'Interrupt', artId: 'interrupt', damage: 100, type: 'physical', currentCooldown: 0 }], items: [{ name: 'Малое зелье здоровья' }] };
    const enemy = { name: 'visible threat', hp: 100, maxHp: 100, speed: 100, turnMeter: 1000, attack: 90, physDef: 0, effects: [], _preparation: { durability: 50, damageMultiplier: 1, hits: 1 }, abilities: [{ name: 'Удар', damage: 10, type: 'physical', currentCooldown: 0 }] };
    const session = { state: { players: [player], enemies: [enemy], turnState: {} } };
    const rng = jest.fn(() => { throw new Error('future RNG peek'); });
    expect(estimateVisibleThreatBeforeNextTurn(session).lethal).toBe(true);
    const decision = chooseCombatAction({ policy: 'competent', session, rng });
    expect(rng).not.toHaveBeenCalled();
    expect(decision.reason).toMatch(/threat-aware/);
  });

  test('threat forecast accounts for visible DoT, multihits, and Preparation', () => {
    const hero = { hp: 100, maxHp: 100, speed: 100, turnMeter: 0, physDef: 0, magicDef: 0, effects: [{ id: 'poison', sourceSnapshot: { attack: 20 } }] };
    const enemy = { hp: 100, speed: 200, turnMeter: 1000, attack: 20, effects: [], abilities: [{ name: 'multi', damage: 20, hits: 3, type: 'physical', currentCooldown: 0 }] };
    const session = { state: { players: [hero], enemies: [enemy] } };
    const multi = estimateVisibleThreatBeforeNextTurn(session, hero);
    expect(multi.periodic).toBe(25);
    expect(multi.direct).toBe(120);
    enemy._preparation = { durability: 80, resolveName: 'Телеграф', damageMultiplier: 2, hits: 3 };
    const prepared = estimateVisibleThreatBeforeNextTurn(session, hero);
    expect(prepared.sources[0].telegraphed).toBe(true);
    expect(prepared.direct).toBe(240);
  });

  test('canonical clean-boss report is isolated and arithmetically consistent', () => {
    const report = simulateCombatBatch({ location: 'deserter', classId: 'Defender', profile: 'established', boss: true, bossPolicy: 'boss_aware', runs: 20, seed: 20260901 });
    expect(report.config).toEqual(expect.objectContaining({ canonicalCleanBoss: true, bossPolicy: 'boss_aware', replayedPlayerState: false, resolvedPlayerSnapshot: expect.any(Object) }));
    expect(report.outcomes.victories + report.outcomes.defeats + report.outcomes.abnormal).toBe(20);
    expect(Object.values(report.defeatDiagnostics.hpBuckets).reduce((sum, count) => sum + count, 0)).toBe(report.defeatDiagnostics.deathsFrom55PlusHp);
  });

  test('forecast includes cooldown-one abilities, repeated fast turns, mitigation, shield, damageTaken and stays pure', () => {
    const hero = { hp: 100, maxHp: 100, shield: 10, speed: 100, turnMeter: 0, physDef: 100, magicDef: 0, statMultipliers: { damageTaken: 1.5 }, effects: [] };
    const enemy = { hp: 100, maxHp: 100, speed: 200, turnMeter: 1000, attack: 10, effects: [], abilities: [{ name: 'Ready after tick', damage: 40, type: 'physical', currentCooldown: 1 }] };
    const session = { state: { players: [hero], enemies: [enemy] }, rng: jest.fn(() => { throw new Error('RNG peek'); }) };
    const before = JSON.stringify(session.state); const forecast = estimateVisibleThreatBeforeNextTurn(session, hero);
    expect(forecast.enemiesBeforeNextTurn).toBe(2);
    expect(forecast.guaranteed).toBe(50); // two 30-damage hits, then current Shield
    expect(session.rng).not.toHaveBeenCalled(); expect(JSON.stringify(session.state)).toBe(before);
  });

  test('heal cap rejects false survival and insufficient defense yields to a saving interrupt', () => {
    const hero = { name: 'hero', class: 'Archer', hp: 90, maxHp: 100, shield: 0, speed: 100, turnMeter: 0, physDef: 0, magicDef: 0, effects: [], abilities: [{ name: 'Break', artId: 'break', damage: 60, type: 'physical', currentCooldown: 0 }], items: [{ name: 'Малое зелье здоровья' }, { name: 'Малое зелье щита' }] };
    const enemy = { name: 'boss', hp: 200, maxHp: 200, speed: 100, turnMeter: 1000, attack: 90, physDef: 0, effects: [], _preparation: { kind: 'generic', durability: 50, damageMultiplier: 1, hits: 1 }, abilities: [{ name: 'follow-up', damage: 25, type: 'physical', currentCooldown: 0 }] };
    const session = { state: { players: [hero], enemies: [enemy], turnState: {} } };
    const action = chooseCombatAction({ policy: 'competent', session, rng: jest.fn() });
    expect(action.ability?.artId).toBe('break');
    expect(action.reason).toMatch(/interrupt/);
  });

  test('raw damage does not become a guaranteed kill through defense or evasion', () => {
    expect(calculateVisibleDamage(120, 'physical', { hp: 100, physDef: 100 })).toBe(60);
    const hero = { name: 'hero', class: 'Archer', hp: 50, maxHp: 100, speed: 100, turnMeter: 1000, effects: [], abilities: [{ name: 'Risky', damage: 120, type: 'physical', currentCooldown: 0 }], items: [] };
    const enemy = { name: 'enemy', hp: 100, maxHp: 100, shield: 0, physDef: 100, speed: 100, turnMeter: 1000, effects: [{ id: 'evasion' }], abilities: [{ name: 'kill', damage: 100, type: 'physical', currentCooldown: 0 }] };
    const action = chooseCombatAction({ policy: 'competent', session: { state: { players: [hero], enemies: [enemy], turnState: {} } }, rng: jest.fn() });
    expect(action.reason || '').not.toMatch(/guaranteed-kill/);
  });

  test.each([['production_baseline', 1], ['global_poison_damage_minus_25', .75], ['global_poison_damage_minus_40', .6]])('%s uses exact symmetric poison components', (variant, multiplier) => {
    const make = sourceIsPlayer => {
      const source = { name: sourceIsPlayer ? 'hero' : 'enemy', hp: 100, attack: 40, effects: [] };
      const target = { name: sourceIsPlayer ? 'enemy' : 'hero', hp: 200, maxHp: 200, physDef: 100, magicDef: 100, shield: 0, effects: [] };
      const marked = applySimulationEncounterVariant({ encounter: [sourceIsPlayer ? target : source], variant }).encounter[0];
      const session = initCombatSession(sourceIsPlayer ? source : target, [marked], { rng: () => .99 });
      const actualSource = sourceIsPlayer ? session.state.players[0] : session.state.enemies[0];
      const actualTarget = sourceIsPlayer ? session.state.enemies[0] : session.state.players[0];
      const effect = addEffect(actualTarget, { id: 'poison', duration: 2 }, undefined, actualSource, { session });
      const before = actualTarget.hp; triggerEffectTick(actualTarget, effect, { session, applyDamage: (unit, amount, type, extra) => applyDamage(unit, amount, type, { ...extra, session }) });
      return { damage: before - actualTarget.hp, metrics: session.state.metrics };
    };
    const expected = calculateVisibleDamage(Math.max(1, Math.round(40 * .5 * multiplier)), 'physical', { physDef: 100 }) + calculateVisibleDamage(Math.max(1, Math.round(200 * .02 * multiplier)), 'magical', { magicDef: 100 });
    expect(make(true).damage).toBe(expected); expect(make(false).damage).toBe(expected);
  });

  test('turn reports expose source, ability, damage, hp and generic Preparation', () => {
    const hero = { name: 'hero', hp: 200, maxHp: 200, speed: 1, turnMeter: 0, physDef: 0, abilities: [{ name: 'Атака', damage: 1 }], effects: [] };
    const enemy = { name: 'enemy', hp: 100, maxHp: 100, attack: 10, speed: 1000, turnMeter: 1000, effects: [], _preparation: { kind: 'generic_test', resolveName: 'Generic Telegraph', damageMultiplier: 1, hits: 1 }, abilities: [{ name: 'Follow-up', artId: 'follow_up', damage: 5, type: 'physical', currentCooldown: 0 }] };
    const session = initCombatSession(hero, [enemy], { rng: () => .99 });
    const report = processEnemyAI(session).turnReports[0];
    expect(report).toEqual(expect.objectContaining({ enemyName: 'enemy', actorName: 'enemy', abilityId: 'follow_up', abilityName: 'Follow-up', directHits: 2, directDamage: 15, hpBefore: 200, hpAfter: 185, death: false, preparationResolution: expect.objectContaining({ kind: 'generic_test' }) }));
  });

  test('fungal Poison slowdown changes order and Double Bite forecasts independent new ticks', () => {
    const hero = { name: 'hero', hp: 200, maxHp: 200, speed: 100, turnMeter: 0, physDef: 0, magicDef: 0, effects: [], abilities: [], items: [] };
    const serpent = createEnemyInstanceByName('Змеиный двоеглав'); serpent.turnMeter = 0;
    const session = initCombatSession(hero, [serpent], { rng: () => .99 }); session.location = 'Грибные Пещеры'; session.state.encounterReward.location = 'Грибные Пещеры';
    const clean = estimateVisibleThreatBeforeNextTurn(session, session.state.players[0]);
    addEffect(session.state.enemies[0], { id: 'poison', duration: 2 }, undefined, session.state.players[0], { session });
    const slowed = estimateVisibleThreatBeforeNextTurn(session, session.state.players[0]);
    expect(slowed.enemiesBeforeNextTurn).toBeLessThanOrEqual(clean.enemiesBeforeNextTurn);
    session.state.enemies[0].turnMeter = 1000;
    const bite = estimateVisibleThreatBeforeNextTurn(session, session.state.players[0]);
    expect(bite.sources.some(source => source.ability?.artId === 'double_bite' && source.guaranteedPoisons === 2)).toBe(true);
    expect(bite.periodic).toBeGreaterThan(0);
  });
});
