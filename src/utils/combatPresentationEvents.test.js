import {
  COMBAT_PRESENTATION_TIMING,
  applyCombatPresentationEvent,
  beginCombatPresentation,
  buildCombatPresentationTimeline,
  consumeCombatPresentationEvents,
  createCombatPresentationView,
  getCombatPresentationDuration,
  getCombatImpactTier,
  getCombatImpactFlavor,
  getCombatActorHandoffGap,
  getCombatPositiveVfxKind,
  getCombatStatusVfxKind,
  getEnemyActionPresentationArtId,
  recordCombatPresentationEvent,
  snapshotCombatPresentationUnit,
  setEnteringEnemyPhase,
} from "./combatPresentationEvents";

describe("combat presentation event sequencing", () => {
  test("inserts one exact opening anticipation only when the first real actor is an enemy", () => {
    const enemyA = { id: "enemy-a" };
    const enemyB = { id: "enemy-b" };
    const timeline = buildCombatPresentationTimeline([
      { type: "combatInitialized" },
      { type: "actionStart", actor: enemyA, actorId: enemyA.id, actorSide: "enemy", action: { name: "Усиление" } },
      { type: "statusApplied", actor: enemyA, target: enemyA },
      { type: "actionStart", actor: enemyB, actorId: enemyB.id, actorSide: "enemy", action: { name: "Призыв" } },
      { type: "summon", actor: enemyB, target: { id: "summon" }, side: "enemy" },
    ], { openingEnemyAnticipation: true });

    const anticipation = timeline.filter(event => event.type === "openingEnemyAnticipation");
    const starts = timeline.filter(event => event.type === "actionStart");
    expect(COMBAT_PRESENTATION_TIMING.openingEnemyAnticipation).toBe(650);
    expect(anticipation).toEqual([
      expect.objectContaining({ actorId: enemyA.id, actorSide: "enemy", at: 0 }),
    ]);
    expect(starts[0].at).toBe(650);
    expect(starts[1].at).toBeGreaterThan(starts[0].at);
  });

  test("does not anticipate a later enemy when the player owns the first action", () => {
    const player = { id: "player" };
    const enemy = { id: "enemy" };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: player, actorId: player.id, actorSide: "player" },
      { type: "actionStart", actor: enemy, actorId: enemy.id, actorSide: "enemy" },
    ], { openingEnemyAnticipation: true });

    expect(timeline.some(event => event.type === "openingEnemyAnticipation")).toBe(false);
    expect(timeline.find(event => event.type === "actionStart").at).toBe(0);
  });

  test("opening anticipation is opt-in per new encounter presentation", () => {
    const enemy = { id: "enemy" };
    const events = [{ type: "actionStart", actor: enemy, actorId: enemy.id, actorSide: "enemy" }];
    const firstEncounter = buildCombatPresentationTimeline(events, { openingEnemyAnticipation: true });
    const ordinaryLaterBatch = buildCombatPresentationTimeline(events);
    const nextEncounter = buildCombatPresentationTimeline(events, { openingEnemyAnticipation: true });

    expect(firstEncounter.filter(event => event.type === "openingEnemyAnticipation")).toHaveLength(1);
    expect(ordinaryLaterBatch.filter(event => event.type === "openingEnemyAnticipation")).toHaveLength(0);
    expect(nextEncounter.filter(event => event.type === "openingEnemyAnticipation")).toHaveLength(1);
  });

  test("records authoritative actor side independently from target-side events", () => {
    const player = { id: "player" };
    const enemy = { id: "enemy" };
    const session = { state: { players: [player], enemies: [enemy] } };
    beginCombatPresentation(session);
    recordCombatPresentationEvent(session, { type: "actionStart", actor: enemy });
    recordCombatPresentationEvent(session, { type: "damage", actor: enemy, target: player });

    expect(consumeCombatPresentationEvents(session)).toEqual([
      expect.objectContaining({ type: "actionStart", actorSide: "enemy" }),
      expect.objectContaining({ type: "damage", actorSide: "enemy", side: "player" }),
    ]);
  });

  test("uses a longer actor handoff for heavy actions and a shorter one for periodic-only beats", () => {
    expect(COMBAT_PRESENTATION_TIMING.nextActorGapLight).toBe(520);
    expect(COMBAT_PRESENTATION_TIMING.nextActorGap).toBe(700);
    expect(COMBAT_PRESENTATION_TIMING.nextActorGapHeavy).toBe(850);
    expect(getCombatActorHandoffGap("light")).toBe(COMBAT_PRESENTATION_TIMING.nextActorGapLight);
    expect(getCombatActorHandoffGap("normal")).toBe(COMBAT_PRESENTATION_TIMING.nextActorGap);
    expect(getCombatActorHandoffGap("heavy")).toBe(COMBAT_PRESENTATION_TIMING.nextActorGapHeavy);

    const first = { id: "first" };
    const target = { id: "target" };
    const second = { id: "second" };

    const periodicTimeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: first },
      { type: "damage", actor: first, target, amount: 30, maxHp: 100, isPeriodic: true },
      { type: "actionStart", actor: second },
    ]);
    const periodicStarts = periodicTimeline.filter(event => event.type === "actionStart");
    const periodicDamage = periodicTimeline.find(event => event.type === "damage");
    expect(periodicStarts[1].at - periodicDamage.at).toBe(COMBAT_PRESENTATION_TIMING.nextActorGapLight);

    const heavyTimeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: first },
      { type: "damage", actor: first, target, amount: 35, maxHp: 100 },
      { type: "actionStart", actor: second },
    ]);
    const heavyStarts = heavyTimeline.filter(event => event.type === "actionStart");
    const heavyDamage = heavyTimeline.find(event => event.type === "damage");
    expect(heavyStarts[1].at - heavyDamage.at).toBe(COMBAT_PRESENTATION_TIMING.nextActorGapHeavy);
  });

  test("gives post-impact feedback and causal consequences readable separation", () => {
    expect(COMBAT_PRESENTATION_TIMING.feedbackDelay).toBe(180);
    expect(COMBAT_PRESENTATION_TIMING.consequenceGap).toBe(220);
    expect(COMBAT_PRESENTATION_TIMING.consequenceStagger).toBe(110);
  });

  test("presents AoE as a tight impact wave and gives repeated hits room to read", () => {
    expect(COMBAT_PRESENTATION_TIMING.aoeTargetStagger).toBe(35);
    expect(COMBAT_PRESENTATION_TIMING.repeatedHitGap).toBe(320);

    const actor = {};
    const targets = Array.from({ length: 6 }, (_, index) => ({ id: `target-${index}` }));
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor },
      ...targets.map((target, index) => ({
        type: "damage",
        actor,
        target,
        amount: 10 - index,
      })),
    ]);
    const impacts = timeline.filter(event => event.type === "damage");

    expect(impacts[0].at).toBe(COMBAT_PRESENTATION_TIMING.firstImpact);
    impacts.slice(1).forEach((impact, index) => {
      expect(impact.at - impacts[index].at).toBe(COMBAT_PRESENTATION_TIMING.aoeTargetStagger);
    });
    expect(impacts[5].at - impacts[0].at).toBe(175);

    const multiHit = buildCombatPresentationTimeline([
      { type: "actionStart", actor },
      { type: "damage", actor, target: targets[0], amount: 5 },
      { type: "damage", actor, target: targets[0], amount: 5 },
    ]);
    expect(multiHit[2].at - multiHit[1].at).toBe(COMBAT_PRESENTATION_TIMING.repeatedHitGap);

    expect(getCombatPresentationDuration(timeline)).toBe(
      COMBAT_PRESENTATION_TIMING.firstImpact
      + 5 * COMBAT_PRESENTATION_TIMING.aoeTargetStagger
      + COMBAT_PRESENTATION_TIMING.essentialTail
    );
  });

  test("maps only dedicated status VFX families and excludes canonical Undeath Echo", () => {
    expect(getCombatStatusVfxKind("burn")).toBe("burn");
    expect(getCombatStatusVfxKind("poison")).toBe("poison");
    expect(getCombatStatusVfxKind("bleed")).toBe("bleed");
    expect(getCombatStatusVfxKind("entanglement")).toBe("entanglement");
    expect(getCombatStatusVfxKind("echo")).toBeNull();
    expect(getCombatStatusVfxKind("regeneration")).toBeNull();
  });

  test("applies turn-meter changes at feedback time while steal and intercept stay presentation-only", () => {
    const hero = { id: "hero", turnMeter: 200, hp: 100, maxHp: 100, effects: [] };
    const enemy = { id: "enemy", turnMeter: 700, hp: 100, maxHp: 100, effects: [] };
    const start = { players: [{ ...hero }], enemies: [{ ...enemy }] };
    const changed = applyCombatPresentationEvent(start, {
      type: "turnMeterChanged",
      targetId: hero.id,
      targetAfter: { ...hero, turnMeter: 450 },
    });
    expect(changed.players[0].turnMeter).toBe(450);
    expect(applyCombatPresentationEvent(changed, {
      type: "turnIntercept",
      actorId: hero.id,
      targetId: enemy.id,
      targetAfter: { ...enemy, turnMeter: 300 },
    })).toBe(changed);
  });

  test("gives Quick Intercept a readable hold before the next actor", () => {
    const archer = { id: "archer" };
    const enemy = { id: "enemy" };
    const next = { id: "next" };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: archer, actorId: archer.id },
      { type: "damage", actor: archer, target: enemy, targetId: enemy.id, amount: 10, maxHp: 100 },
      { type: "turnMeterChanged", actor: archer, target: enemy, targetId: enemy.id, delta: -150 },
      { type: "turnMeterChanged", actor: archer, target: archer, targetId: archer.id, delta: 400 },
      { type: "turnIntercept", actor: archer, actorId: archer.id, target: enemy, targetId: enemy.id, amount: 150 },
      { type: "actionStart", actor: next, actorId: next.id },
    ]);
    const intercept = timeline.find(event => event.type === "turnIntercept");
    const nextAction = timeline.filter(event => event.type === "actionStart")[1];
    expect(nextAction.at).toBeGreaterThanOrEqual(intercept.at + COMBAT_PRESENTATION_TIMING.turnInterceptHold);
  });

  test("maps heal, shield, buff and cleanse into distinct positive feedback families", () => {
    expect(getCombatPositiveVfxKind({ type: "heal" })).toBe("heal");
    expect(getCombatPositiveVfxKind({ type: "shieldGain" })).toBe("shield");
    expect(getCombatPositiveVfxKind({ type: "statusCleanse" })).toBe("cleanse");
    expect(getCombatPositiveVfxKind({ type: "statusApplied", statusOperation: "apply", effectType: "buff", effectId: "regeneration" })).toBe("buff");
    expect(getCombatPositiveVfxKind({ type: "statusApplied", statusOperation: "refresh", effectType: "buff", effectId: "regeneration" })).toBeNull();
    expect(getCombatPositiveVfxKind({ type: "statusApplied", statusOperation: "apply", effectType: "buff", effectId: "shield" })).toBeNull();
    expect(getCombatPositiveVfxKind({ type: "statusApplied", statusOperation: "apply", effectType: "debuff", effectId: "poison" })).toBeNull();
  });

  test("classifies physical, magical and periodic impact grammar independently from power", () => {
    expect(getCombatImpactFlavor({ damageType: "physical" })).toBe("physical");
    expect(getCombatImpactFlavor({ damageType: "magical", magicSchool: "fire" })).toBe("magical");
    expect(getCombatImpactFlavor({ damageType: "pure" })).toBe("pure");
    expect(getCombatImpactFlavor({ damageType: "magical", isPeriodic: true })).toBe("periodic");
    expect(getCombatImpactFlavor({})).toBe("neutral");
  });

  test("stores impact flavor on the timed hit event", () => {
    const actor = {};
    const target = {};
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor },
      { type: "damage", actor, target, amount: 10, maxHp: 100, damageType: "magical", magicSchool: "ice" },
    ]);
    expect(timeline[1]).toEqual(expect.objectContaining({
      impactFlavor: "magical",
      magicSchool: "ice",
    }));
  });

  test("grades impact from the real result without making periodic ticks heavy", () => {
    expect(getCombatImpactTier({ type: "damage", amount: 8, maxHp: 100 })).toBe("light");
    expect(getCombatImpactTier({ type: "damage", amount: 12, maxHp: 100 })).toBe("medium");
    expect(getCombatImpactTier({ type: "damage", amount: 30, maxHp: 100 })).toBe("heavy");
    expect(getCombatImpactTier({ type: "damage", amount: 60, maxHp: 100, isPeriodic: true })).toBe("light");
    expect(getCombatImpactTier({ type: "damage", amount: 1, maxHp: 100, lethal: true })).toBe("heavy");
    expect(getCombatImpactTier({ type: "shieldAbsorbed", amount: 0, maxHp: 100, blocked: true })).toBe("medium");
  });

  test("stores the computed impact tier on timed hit events", () => {
    const actor = {};
    const target = {};
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor },
      { type: "damage", actor, target, amount: 35, maxHp: 100 },
    ]);
    expect(timeline[1]).toEqual(expect.objectContaining({ impactTier: "heavy" }));
  });

  test("lets a boss phase transition take over the stage before the next actor", () => {
    const player = { id: "player" };
    const boss = { id: "boss", boss: true };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: player, actorId: player.id },
      { type: "damage", actor: player, target: boss, targetId: boss.id, amount: 100, maxHp: 1000 },
      { type: "bossPhaseTransition", actor: boss, target: boss, targetId: boss.id, phase: 2, label: "Увядание" },
      { type: "actionStart", actor: boss, actorId: boss.id, actorSide: "enemy" },
    ]);
    const damage = timeline.find(event => event.type === "damage");
    const phase = timeline.find(event => event.type === "bossPhaseTransition");
    const bossAction = timeline.filter(event => event.type === "actionStart")[1];
    expect(phase.at - damage.at).toBe(COMBAT_PRESENTATION_TIMING.bossPhaseDelay);
    expect(phase.stageEndAt - phase.at).toBe(COMBAT_PRESENTATION_TIMING.bossPhaseDuration);
    expect(bossAction.at).toBeGreaterThanOrEqual(phase.stageEndAt);
  });

  test("lets a lethal impact land before the death reaction begins", () => {
    expect(COMBAT_PRESENTATION_TIMING.deathReactionDelay).toBe(140);
    const attacker = { id: "attacker" };
    const target = { id: "target", hp: 0, maxHp: 100, effects: [] };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: attacker, actorId: attacker.id },
      {
        type: "damage",
        actor: attacker,
        target,
        targetId: target.id,
        amount: 100,
        maxHp: 100,
        lethal: true,
        targetAfter: { ...target },
      },
      {
        type: "death",
        actor: attacker,
        target,
        targetId: target.id,
        side: "enemy",
        targetAfter: { ...target },
      },
    ]);
    const damage = timeline.find(event => event.type === "damage");
    const death = timeline.find(event => event.type === "death");
    expect(death.at - damage.at).toBe(COMBAT_PRESENTATION_TIMING.deathReactionDelay);
  });

  test("holds boss death longer than an ordinary enemy before roster removal", () => {
    const boss = { id: "boss", hp: 0, maxHp: 1000, effects: [], boss: true };
    const enemy = { id: "enemy", hp: 0, maxHp: 100, effects: [] };
    const bossTimeline = buildCombatPresentationTimeline([
      { type: "death", target: boss, targetId: boss.id, side: "enemy", targetAfter: { ...boss } },
    ]);
    const normalTimeline = buildCombatPresentationTimeline([
      { type: "death", target: enemy, targetId: enemy.id, side: "enemy", targetAfter: { ...enemy } },
    ]);
    const bossDeath = bossTimeline.find(event => event.type === "death");
    const bossRemoval = bossTimeline.find(event => event.type === "removeFromPresentationRoster");
    const normalDeath = normalTimeline.find(event => event.type === "death");
    const normalRemoval = normalTimeline.find(event => event.type === "removeFromPresentationRoster");

    expect(bossRemoval).toMatchObject({
      boss: true,
      exitDuration: COMBAT_PRESENTATION_TIMING.bossDeathExit,
    });
    expect(bossRemoval.exitAt - bossDeath.at).toBe(COMBAT_PRESENTATION_TIMING.bossDeathHold);
    expect(bossRemoval.at - bossDeath.at).toBe(
      COMBAT_PRESENTATION_TIMING.bossDeathHold + COMBAT_PRESENTATION_TIMING.bossDeathExit
    );
    expect(bossRemoval.at - bossDeath.at).toBeGreaterThan(normalRemoval.at - normalDeath.at);
    expect(getCombatPresentationDuration(bossTimeline)).toBeGreaterThan(getCombatPresentationDuration(normalTimeline));
  });

  test("normalizes terminal victory and defeat holds without cutting the boss death sequence", () => {
    const enemy = { id: "enemy", hp: 0, maxHp: 100, effects: [] };
    const hero = { id: "hero", hp: 0, maxHp: 100, effects: [] };
    const boss = { id: "boss", hp: 0, maxHp: 1000, effects: [], boss: true };

    const victoryTimeline = buildCombatPresentationTimeline([
      { type: "damage", target: enemy, targetId: enemy.id, amount: 100, maxHp: 100, lethal: true },
      { type: "death", target: enemy, targetId: enemy.id, side: "enemy", targetAfter: { ...enemy } },
    ]);
    const victoryDeath = victoryTimeline.find(event => event.type === "death");
    expect(getCombatPresentationDuration(victoryTimeline, { resultOutcome: "victory" }) - victoryDeath.at)
      .toBe(COMBAT_PRESENTATION_TIMING.resultVictoryTail);

    const defeatTimeline = buildCombatPresentationTimeline([
      { type: "damage", target: hero, targetId: hero.id, amount: 100, maxHp: 100, lethal: true },
      { type: "death", target: hero, targetId: hero.id, side: "player", targetAfter: { ...hero } },
    ]);
    const defeatDeath = defeatTimeline.find(event => event.type === "death");
    expect(getCombatPresentationDuration(defeatTimeline, { resultOutcome: "defeat" }) - defeatDeath.at)
      .toBe(COMBAT_PRESENTATION_TIMING.resultDefeatTail);

    const bossTimeline = buildCombatPresentationTimeline([
      { type: "damage", target: boss, targetId: boss.id, amount: 1000, maxHp: 1000, lethal: true },
      { type: "death", target: boss, targetId: boss.id, side: "enemy", targetAfter: { ...boss } },
    ]);
    const bossDeath = bossTimeline.find(event => event.type === "death");
    expect(getCombatPresentationDuration(bossTimeline, { resultOutcome: "victory" }) - bossDeath.at)
      .toBe(COMBAT_PRESENTATION_TIMING.bossDeathHold + COMBAT_PRESENTATION_TIMING.bossDeathExit);
  });

  test("removes a dead allied summon without removing the hero", () => {
    const hero = { id: "hero", hp: 100, maxHp: 100, effects: [] };
    const summon = { id: "summon", hp: 0, maxHp: 20, effects: [], summoned: true };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: { id: "enemy" } },
      {
        type: "damage",
        actor: { id: "enemy" },
        target: summon,
        targetId: summon.id,
        amount: 20,
        maxHp: 20,
        lethal: true,
        side: "player",
        targetAfter: { ...summon },
      },
      {
        type: "death",
        actor: { id: "enemy" },
        target: summon,
        targetId: summon.id,
        side: "player",
        targetAfter: { ...summon },
      },
    ]);
    const removal = timeline.find(event => event.type === "removeFromPresentationRoster");
    expect(removal).toMatchObject({
      targetId: "summon",
      side: "player",
      summoned: true,
      exitDuration: COMBAT_PRESENTATION_TIMING.summonDeathExit,
    });

    const view = { players: [hero, summon], enemies: [] };
    const after = applyCombatPresentationEvent(view, removal);
    expect(after.players.map(unit => unit.id)).toEqual(["hero"]);
  });

  test("uses a shorter hold and dissolve-style exit for summoned deaths only", () => {
    const enemy = { id: "enemy", hp: 0, maxHp: 20, effects: [] };
    const summon = { id: "summon", hp: 0, maxHp: 10, effects: [], summoned: true };
    const ordinaryTimeline = buildCombatPresentationTimeline([
      { type: "death", target: enemy, targetId: enemy.id, side: "enemy", targetAfter: { ...enemy } },
    ]);
    const summonTimeline = buildCombatPresentationTimeline([
      { type: "death", target: summon, targetId: summon.id, side: "enemy", targetAfter: { ...summon } },
    ]);
    const ordinaryDeath = ordinaryTimeline.find(event => event.type === "death");
    const ordinaryRemoval = ordinaryTimeline.find(event => event.type === "removeFromPresentationRoster");
    const summonDeath = summonTimeline.find(event => event.type === "death");
    const summonRemoval = summonTimeline.find(event => event.type === "removeFromPresentationRoster");

    expect(ordinaryRemoval.exitAt - ordinaryDeath.at).toBe(COMBAT_PRESENTATION_TIMING.deathHold);
    expect(ordinaryRemoval.exitDuration).toBe(COMBAT_PRESENTATION_TIMING.deathExit);
    expect(summonRemoval.exitAt - summonDeath.at).toBe(COMBAT_PRESENTATION_TIMING.summonDeathHold);
    expect(summonRemoval.exitDuration).toBe(COMBAT_PRESENTATION_TIMING.summonDeathExit);
  });

  test("holds a death-save target at zero before restoring the authoritative saved state", () => {
    const target = { id: "hero", hp: 100, maxHp: 100, effects: [] };
    const startView = { players: [{ ...target }], enemies: [] };
    const threat = applyCombatPresentationEvent(startView, {
      type: "damage",
      targetId: "hero",
      deathSaveKind: "curse",
      targetAfter: { ...target, hp: 1 },
    });
    expect(threat.players[0]).toMatchObject({ hp: 0, presentationDeathSave: "curse" });

    const resolved = applyCombatPresentationEvent(threat, {
      type: "deathSaveResolved",
      targetId: "hero",
      targetAfter: { ...target, hp: 1, shield: 20 },
    });
    expect(resolved.players[0]).toMatchObject({ hp: 1, shield: 20 });
  });

  test("paces death-save impact, proc and recovery as a distinct T3 moment", () => {
    const enemy = { id: "enemy" };
    const hero = { id: "hero" };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: enemy, actorId: enemy.id },
      {
        type: "procTriggered",
        actor: hero,
        target: hero,
        targetId: hero.id,
        procKind: "curse",
        deathSave: true,
        label: "Хватка смерти",
        afterEventType: "damage",
        afterTargetId: hero.id,
        afterEventDirection: "following",
      },
      {
        type: "damage",
        actor: enemy,
        target: hero,
        targetId: hero.id,
        amount: 99,
        maxHp: 100,
        deathSaveKind: "curse",
      },
      {
        type: "deathSaveResolved",
        actor: hero,
        target: hero,
        targetId: hero.id,
        deathSaveKind: "curse",
        afterEventType: "procTriggered",
        afterTargetId: hero.id,
        afterEventDirection: "preceding",
      },
    ]);
    const damage = timeline.find(event => event.type === "damage");
    const proc = timeline.find(event => event.type === "procTriggered");
    const resolve = timeline.find(event => event.type === "deathSaveResolved");
    expect(proc.at - damage.at).toBe(COMBAT_PRESENTATION_TIMING.deathSaveProcDelay);
    expect(resolve.at - proc.at).toBe(COMBAT_PRESENTATION_TIMING.deathSaveResolveDelay);
    expect(damage.impactTier).toBe("heavy");
  });

  test("resolves nested shield -> proc -> status chains across causal passes", () => {
    const attacker = { id: "attacker" };
    const defender = { id: "defender" };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: attacker, actorId: attacker.id },
      {
        type: "shieldAbsorbed",
        actor: attacker,
        target: defender,
        targetId: defender.id,
        amount: 20,
        shieldBroken: true,
      },
      {
        type: "procTriggered",
        actor: defender,
        target: defender,
        targetId: defender.id,
        procKind: "equipment",
        label: "Щит тлеющей жилы",
        afterEventType: "shieldBreak",
        afterTargetId: defender.id,
        afterEventDirection: "preceding",
      },
      {
        type: "statusApplied",
        actor: defender,
        target: attacker,
        targetId: attacker.id,
        effectId: "burn",
        afterEventType: "procTriggered",
        afterTargetId: defender.id,
        afterEventDirection: "preceding",
      },
    ]);

    const shield = timeline.find(event => event.type === "shieldAbsorbed");
    const proc = timeline.find(event => event.type === "procTriggered");
    const burn = timeline.find(event => event.type === "statusApplied");
    expect(proc.at - shield.at).toBe(COMBAT_PRESENTATION_TIMING.consequenceGap);
    expect(burn.at - proc.at).toBe(COMBAT_PRESENTATION_TIMING.consequenceGap);
  });

  test("proc cues are presentation-only and never advance the unit snapshot", () => {
    const view = {
      players: [],
      enemies: [{ id: "target", hp: 100, maxHp: 100, effects: [] }],
    };
    const leakedSnapshot = {
      id: "target",
      hp: 1,
      maxHp: 100,
      effects: [{ id: "shield" }],
    };
    expect(applyCombatPresentationEvent(view, {
      type: "procTriggered",
      targetId: "target",
      targetAfter: leakedSnapshot,
      procKind: "curse",
      label: "Хватка смерти",
    })).toBe(view);
  });

  test("keeps a consequence attached to the intended following shield break", () => {
    const attacker = { id: "attacker" };
    const defender = { id: "defender" };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: attacker, actorId: attacker.id },
      {
        type: "shieldAbsorbed",
        actor: attacker,
        target: defender,
        targetId: defender.id,
        amount: 10,
        shieldBroken: true,
      },
      { type: "damage", actor: attacker, target: defender, targetId: defender.id, amount: 5, maxHp: 100 },
      {
        type: "statusApplied",
        actor: defender,
        target: attacker,
        targetId: attacker.id,
        effectId: "entanglement",
        afterEventType: "shieldBreak",
        afterTargetId: defender.id,
        afterEventDirection: "following",
      },
      {
        type: "shieldAbsorbed",
        actor: attacker,
        target: defender,
        targetId: defender.id,
        amount: 20,
        shieldBroken: true,
      },
      { type: "damage", actor: attacker, target: defender, targetId: defender.id, amount: 5, maxHp: 100 },
    ]);

    const breaks = timeline.filter(event => event.type === "shieldAbsorbed");
    const consequence = timeline.find(event => event.type === "statusApplied");
    expect(consequence.at - breaks[1].at).toBe(COMBAT_PRESENTATION_TIMING.consequenceGap);
    expect(consequence.causalAnchorSequence).toBe(breaks[1].sequence);
  });

  test("stagers multiple consequences from the same cause instead of stacking them in one frame", () => {
    const attacker = { id: "attacker" };
    const defender = { id: "defender" };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: attacker, actorId: attacker.id },
      {
        type: "shieldAbsorbed",
        actor: attacker,
        target: defender,
        targetId: defender.id,
        amount: 20,
        shieldBroken: true,
      },
      {
        type: "statusApplied",
        target: attacker,
        targetId: attacker.id,
        effectId: "burn",
        afterEventType: "shieldBreak",
        afterTargetId: defender.id,
      },
      {
        type: "statusApplied",
        target: attacker,
        targetId: attacker.id,
        effectId: "entanglement",
        afterEventType: "shieldBreak",
        afterTargetId: defender.id,
      },
    ]);

    const consequences = timeline.filter(event => event.type === "statusApplied");
    expect(consequences[1].at - consequences[0].at).toBe(COMBAT_PRESENTATION_TIMING.consequenceStagger);
  });

  test("places status feedback after impact and reactions after their trigger", () => {
    const attacker = {};
    const defender = {};
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor: attacker },
      { type: "damage", actor: attacker, target: defender, amount: 10 },
      { type: "statusApplied", actor: attacker, target: defender, label: "Burn" },
      { type: "damage", actor: defender, target: attacker, amount: 4 },
    ]);

    expect(timeline[2].at).toBeGreaterThan(timeline[1].at);
    expect(timeline[3].at).toBeGreaterThan(timeline[2].at);
    expect(getCombatPresentationDuration(timeline)).toBeGreaterThanOrEqual(900);
    expect(getCombatPresentationDuration(timeline)).toBeLessThanOrEqual(1800);
  });

  test("uses the shared attack art until an enemy-specific art hook is provided", () => {
    expect(getEnemyActionPresentationArtId({ name: "Укус" })).toBe("attack");
    expect(getEnemyActionPresentationArtId({ enemyArtId: "future_enemy_bite" }))
      .toBe("future_enemy_bite");
  });

  test("schedules summon rearrangement during anticipation", () => {
    const actor = {};
    const summon = buildCombatPresentationTimeline([
      { type: "actionStart", actor },
      { type: "summon", actor, target: {}, side: "enemy", summonedUnitId: "summon-1" },
    ]);

    expect(summon[1].at).toBe(COMBAT_PRESENTATION_TIMING.summonAnticipation);
    expect(getCombatPresentationDuration(summon)).toBeGreaterThanOrEqual(1400);
    expect(getCombatPresentationDuration(summon)).toBeLessThanOrEqual(1600);
  });

  test("keeps transient events outside combat state and consumes them once", () => {
    const session = { state: { players: [], enemies: [] } };
    beginCombatPresentation(session);
    recordCombatPresentationEvent(session, { type: "heal", amount: 12 });

    expect(session.state).toEqual({ players: [], enemies: [] });
    expect(consumeCombatPresentationEvents(session)).toEqual([
      expect.objectContaining({ type: "heal", amount: 12, sequence: 0 }),
    ]);
    expect(consumeCombatPresentationEvents(session)).toEqual([]);
  });

  test("records each successful summon immediately after its summoner action", () => {
    const actors = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const summoned = [{ id: "rat-a", hp: 5 }, { id: "rat-b", hp: 5 }, { id: "rat-c", hp: 5 }];
    const session = { state: { players: [], enemies: [...actors, ...summoned] } };
    beginCombatPresentation(session);
    actors.forEach((actor, index) => {
      recordCombatPresentationEvent(session, { type: "actionStart", actor });
      recordCombatPresentationEvent(session, {
        type: "summon",
        actor,
        target: summoned[index],
        side: "enemy",
        summonedUnitId: summoned[index].id,
        rosterIndex: index + 3,
      });
    });

    expect(consumeCombatPresentationEvents(session).map(event => [
      event.type,
      event.actorId,
      event.summonerRuntimeId,
    ])).toEqual([
      ["actionStart", "a", undefined],
      ["summon", "a", "a"],
      ["actionStart", "b", undefined],
      ["summon", "b", "b"],
      ["actionStart", "c", undefined],
      ["summon", "c", "c"],
    ]);
  });

  test("advances exact HP, Shield, and statuses only at their event boundaries", () => {
    const target = { id: "target", name: "Target", hp: 100, maxHp: 100, shield: 20, effects: [] };
    const initial = { players: [], enemies: [snapshotCombatPresentationUnit(target, 0)] };
    const absorbed = {
      type: "shieldAbsorbed",
      targetId: "target",
      targetAfter: snapshotCombatPresentationUnit({ ...target, shield: 10 }, 0),
    };
    const damaged = {
      type: "damage",
      targetId: "target",
      targetAfter: snapshotCombatPresentationUnit({ ...target, hp: 92, shield: 10 }, 0),
    };
    const status = {
      type: "statusApplied",
      targetId: "target",
      targetAfter: snapshotCombatPresentationUnit({
        ...target,
        hp: 92,
        shield: 10,
        effects: [{ id: "bleed", name: "Bleed", remainingTurns: 2 }],
      }, 0),
    };

    expect(initial.enemies[0]).toMatchObject({ hp: 100, shield: 20, effects: [] });
    const atImpact = [absorbed, damaged].reduce(applyCombatPresentationEvent, initial);
    expect(atImpact.enemies[0]).toMatchObject({ hp: 92, shield: 10, effects: [] });
    const afterStatus = applyCombatPresentationEvent(atImpact, status);
    expect(afterStatus.enemies[0]).toMatchObject({ hp: 92, shield: 10 });
    expect(afterStatus.enemies[0].effects).toEqual([expect.objectContaining({ id: "bleed" })]);
  });

  test("reveals multiple summons through intermediate stable-ID rosters", () => {
    const unit = (id, index) => snapshotCombatPresentationUnit({ id, name: id, hp: 10, maxHp: 10 }, index);
    let view = { players: [], enemies: [unit("a", 0), unit("b", 1), unit("c", 2)] };
    ["d", "e", "f"].forEach((id, offset) => {
      view = applyCombatPresentationEvent(view, {
        type: "summon",
        targetAfter: unit(id, 3 + offset),
        summonedUnitId: id,
        rosterIndex: 3 + offset,
      });
      expect(view.enemies.map(enemy => enemy.id)).toEqual(["a", "b", "c", ...["d", "e", "f"].slice(0, offset + 1)]);
    });
  });

  test("keeps only living enemies in the stable presentation roster", () => {
    const view = createCombatPresentationView({
      players: [],
      enemies: [
        { id: "alive-a", hp: 10, maxHp: 10 },
        { id: "dead", hp: 0, maxHp: 10 },
        { id: "alive-b", hp: 4, maxHp: 10 },
      ],
    });

    expect(view.enemies.map(unit => [unit.id, unit.presentationIndex])).toEqual([
      ["alive-a", 0],
      ["alive-b", 2],
    ]);
  });

  test("holds lethal cards before one simultaneous visual-roster contraction", () => {
    const actor = { id: "actor" };
    const first = { id: "first" };
    const second = { id: "second" };
    const timeline = buildCombatPresentationTimeline([
      { type: "actionStart", actor },
      { type: "damage", actor, target: first, targetId: "first", amount: 10, lethal: true },
      { type: "death", actor, target: first, targetId: "first", side: "enemy" },
      { type: "damage", actor, target: second, targetId: "second", amount: 10, lethal: true },
      { type: "death", actor, target: second, targetId: "second", side: "enemy" },
    ]);
    const removals = timeline.filter(event => event.type === "removeFromPresentationRoster");

    expect(removals).toHaveLength(2);
    expect(removals[0].at).toBe(removals[1].at);
    expect(removals[0].at).toBe(
      COMBAT_PRESENTATION_TIMING.firstImpact
      + COMBAT_PRESENTATION_TIMING.aoeTargetStagger
      + COMBAT_PRESENTATION_TIMING.deathReactionDelay
      + COMBAT_PRESENTATION_TIMING.deathHold
      + COMBAT_PRESENTATION_TIMING.deathExit
    );
  });

  test("re-expands a contracted roster when a summon reuses a dead authoritative slot", () => {
    const unit = (id, index, hp = 10) => snapshotCombatPresentationUnit({ id, hp, maxHp: 10 }, index);
    let view = { players: [], enemies: [0, 1, 2, 3, 4, 5].map(index => unit(`unit-${index}`, index)) };
    view = applyCombatPresentationEvent(view, {
      type: "removeFromPresentationRoster",
      targetId: "unit-2",
    });
    expect(view.enemies).toHaveLength(5);

    view = applyCombatPresentationEvent(view, {
      type: "summon",
      rosterIndex: 2,
      summonedUnitId: "replacement",
      targetAfter: unit("replacement", 2),
    });
    expect(view.enemies).toHaveLength(6);
    expect(view.enemies.map(enemy => enemy.presentationIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(view.enemies[2].id).toBe("replacement");
  });

  test("keeps each summon inside its summoner action before the next actor", () => {
    const actors = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const timeline = buildCombatPresentationTimeline([
      ...actors.flatMap((actor, offset) => [
        { type: "actionStart", actor, actorId: actor.id },
        {
          type: "summon",
          actor,
          actorId: actor.id,
          summonerRuntimeId: actor.id,
          target: { id: `summon-${offset}` },
          side: "enemy",
          summonedUnitId: `summon-${offset}`,
          rosterIndex: offset + 3,
        },
      ]),
    ]);
    const starts = timeline.filter(event => event.type === "actionStart");
    const summons = timeline.filter(event => event.type === "summon");

    summons.forEach((summon, index) => {
      expect(summon.summonerRuntimeId).toBe(actors[index].id);
      expect(summon.at).toBe(starts[index].at + COMBAT_PRESENTATION_TIMING.summonAnticipation);
      if (starts[index + 1]) {
        expect(starts[index + 1].at)
          .toBeGreaterThanOrEqual(summon.at + COMBAT_PRESENTATION_TIMING.summonGridTransition);
      }
    });
  });

  test("tracks independent initial and active entrance phases by summoned runtime ID", () => {
    let entrances = setEnteringEnemyPhase({}, ["rat-a"], "initial");
    entrances = setEnteringEnemyPhase(entrances, ["rat-a"], "active");
    entrances = setEnteringEnemyPhase(entrances, ["rat-b", "rat-c"], "initial");

    expect(entrances).toEqual({ "rat-a": "active", "rat-b": "initial", "rat-c": "initial" });
    expect(setEnteringEnemyPhase(entrances, ["rat-b"])).toEqual({
      "rat-a": "active",
      "rat-c": "initial",
    });
  });

  test("advances multi-hit HP through each authoritative post-hit snapshot", () => {
    const unit = hp => snapshotCombatPresentationUnit({ id: "target", name: "Target", hp, maxHp: 100 }, 0);
    let view = { players: [], enemies: [unit(100)] };
    [88, 76, 64].forEach(hp => {
      view = applyCombatPresentationEvent(view, {
        type: "damage",
        targetId: "target",
        targetAfter: unit(hp),
      });
      expect(view.enemies[0].hp).toBe(hp);
    });
  });

  test('presents shield gain before the following enemy action', () => {
    const hero = { id: 'hero' }; const enemy = { id: 'enemy' };
    const timeline = buildCombatPresentationTimeline([
      { type: 'actionStart', actor: hero, actorId: 'hero' },
      { type: 'shieldGain', actor: hero, target: hero, targetId: 'hero', amount: 20 },
      { type: 'actionStart', actor: enemy, actorId: 'enemy' },
      { type: 'shieldAbsorbed', actor: enemy, target: hero, targetId: 'hero', amount: 10 },
    ]);
    expect(timeline.find(event => event.type === 'shieldGain').at)
      .toBeLessThan(timeline.find(event => event.type === 'actionStart' && event.actorId === 'enemy').at);
  });

  test('new temporary entity receives a readable lifetime before immediate activation', () => {
    const timeline = buildCombatPresentationTimeline([
      { type: 'actionStart', actor: { id: 'hero' } },
      { type: 'temporaryEntitySpawn', entityId: 'snake_trap' },
      { type: 'temporaryEntityActivate', entityId: 'snake_trap' },
    ]);
    const spawn = timeline.find(event => event.type === 'temporaryEntitySpawn');
    const activation = timeline.find(event => event.type === 'temporaryEntityActivate');
    expect(activation.at - spawn.at).toBeGreaterThanOrEqual(900);
  });
});
