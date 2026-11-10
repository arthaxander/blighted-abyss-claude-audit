const eventQueues = new WeakMap();
// CombatScreen shallow-copies the session wrapper, while engine-bound helpers retain
// the original wrapper. The combat state is the stable identity shared by both.
const getCombatPresentationQueueKey = session => session?.state || session;

export const COMBAT_PRESENTATION_TIMING = Object.freeze({
  openingEnemyAnticipation: 650,
  firstImpact: 650,
  repeatedHitGap: 320,
  aoeTargetStagger: 35,
  nextActorGapLight: 520,
  nextActorGap: 700,
  nextActorGapHeavy: 850,
  feedbackDelay: 180,
  consequenceGap: 220,
  consequenceStagger: 110,
  essentialTail: 650,
  resultVictoryTail: 1100,
  resultDefeatTail: 900,
  actorFocus: 650,
  actorPortraitZoom: 650,
  healthSegmentDuration: 140,
  healthTrailDelay: 150,
  healthTrailDuration: 260,
  shieldImpactDuration: 360,
  shieldBreakDuration: 520,
  floatingDuration: 850,
  statusTriggerLead: 90,
  statusDuration: 850,
  statusVfxDuration: 560,
  positiveVfxDuration: 620,
  turnMeterFeedbackDuration: 520,
  turnInterceptHold: 220,
  procDuration: 720,
  deathSaveProcDelay: 180,
  deathSaveResolveDelay: 260,
  deathSaveResolveDuration: 700,
  enemyActionIconDuration: 850,
  summonAnticipation: 550,
  summonGridTransition: 900,
  summonEntrance: 850,
  summonAccentDuration: 1050,
  deathReactionDelay: 140,
  deathReactionDuration: 520,
  summonDeathReactionDuration: 430,
  deathHold: 400,
  deathExit: 260,
  summonDeathHold: 260,
  summonDeathExit: 320,
  bossPhaseDelay: 180,
  bossPhaseDuration: 1050,
  bossDeathReactionDuration: 1050,
  bossDeathHold: 900,
  bossDeathExit: 620,
  temporaryEntityMinimumLifetime: 900,
});

export const getEnemyActionPresentationArtId = action => action?.enemyArtId || "attack";

export const getCombatPositiveVfxKind = event => {
  if (!event) return null;
  if (event.type === "heal") return "heal";
  if (event.type === "shieldGain") return "shield";
  if (event.type === "statusCleanse") return "cleanse";
  if (
    event.type === "statusApplied" &&
    (event.statusOperation || "apply") === "apply" &&
    event.effectType === "buff" &&
    event.effectId !== "shield"
  ) return "buff";
  return null;
};

export const getCombatStatusVfxKind = effectId => {
  const id = String(effectId || "").trim().toLowerCase();
  if (id === "burn") return "burn";
  if (id === "poison") return "poison";
  if (id === "bleed") return "bleed";
  if (id === "entanglement") return "entanglement";
  return null;
};

export const getCombatImpactFlavor = event => {
  if (!event) return "neutral";
  if (event.isPeriodic) return "periodic";
  if (event.damageType === "magical") return "magical";
  if (event.damageType === "physical") return "physical";
  if (event.damageType === "pure") return "pure";
  return "neutral";
};

export const getCombatActorHandoffGap = pacing => (
  pacing === "heavy"
    ? COMBAT_PRESENTATION_TIMING.nextActorGapHeavy
    : pacing === "light"
    ? COMBAT_PRESENTATION_TIMING.nextActorGapLight
    : COMBAT_PRESENTATION_TIMING.nextActorGap
);

export const getCombatImpactTier = event => {
  if (!event) return "light";
  if (event.deathSaveKind) return "heavy";
  if (event.lethal) return "heavy";
  if (event.blocked) return "medium";
  if (event.isPeriodic) return "light";
  const amount = Math.max(0, Number(event.amount) || 0);
  const maxHp = Math.max(0, Number(event.maxHp ?? event.targetAfter?.maxHp) || 0);
  const ratio = maxHp > 0 ? amount / maxHp : 0;
  if (ratio >= 0.3) return "heavy";
  if (ratio >= 0.12) return "medium";
  return "light";
};

export const setEnteringEnemyPhase = (current = {}, unitIds = [], phase = null) => {
  const next = { ...current };
  unitIds.forEach(id => {
    if (phase) next[id] = phase;
    else delete next[id];
  });
  return next;
};

export const getCombatPresentationUnitId = (unit, fallback = null) => (
  unit?.id || unit?.runtimeId || unit?.combatId || unit?.name || fallback
);

export const snapshotCombatPresentationUnit = (unit, presentationIndex = 0) => unit ? ({
  id: unit.id,
  runtimeId: unit.runtimeId,
  combatId: unit.combatId,
  name: unit.name,
  class: unit.class,
  displayClass: unit.displayClass,
  portrait: unit.portrait,
  portraitId: unit.portraitId,
  portraitKey: unit.portraitKey,
  portraitUrl: unit.portraitUrl,
  allyPortraitKey: unit.allyPortraitKey,
  allyPortraitUrl: unit.allyPortraitUrl,
  hp: unit.hp,
  maxHp: unit.maxHp,
  shield: unit.shield,
  effects: (unit.effects || []).map(effect => ({
    id: effect.id,
    name: effect.name,
    kind: effect.kind,
    type: effect.type,
    icon: effect.icon,
    iconPath: effect.iconPath,
    remainingTurns: effect.remainingTurns,
    duration: effect.duration,
    value: effect.value,
  })),
  turnMeter: unit.turnMeter,
  speed: unit.speed,
  summoned: unit.summoned,
  boss: unit.boss,
  miniBoss: unit.miniBoss,
  isBoss: unit.isBoss,
  isMiniBoss: unit.isMiniBoss,
  presentationIndex,
}) : null;

export const createCombatPresentationView = state => ({
  players: (state?.players || []).map(snapshotCombatPresentationUnit),
  enemies: (state?.enemies || [])
    .map(snapshotCombatPresentationUnit)
    .filter(unit => unit.hp > 0),
});

export const applyCombatPresentationEvent = (view, event) => {
  if (!view || !event) return view;
  if (event.type === "statusTriggered" || event.type === "statusBlocked" || event.type === "procTriggered" || event.type === "turnMeterSteal" || event.type === "turnIntercept") return view;
  if (event.type === "damage" && event.deathSaveKind && event.targetId) {
    const updateThreat = units => units.map(unit => (
      getCombatPresentationUnitId(unit) === event.targetId
        ? { ...unit, hp: 0, presentationDeathSave: event.deathSaveKind }
        : unit
    ));
    return { players: updateThreat(view.players), enemies: updateThreat(view.enemies) };
  }
  if (event.type === "summon" && event.targetAfter) {
    if (event.side === 'ally') {
      const players = view.players
        .filter(unit => getCombatPresentationUnitId(unit) !== event.targetId)
        .concat({ ...event.targetAfter, presentationIndex: event.rosterIndex })
        .sort((left, right) => left.presentationIndex - right.presentationIndex);
      return { ...view, players };
    }
    const enemies = view.enemies
      .filter(unit => unit.presentationIndex !== event.rosterIndex)
      .concat({ ...event.targetAfter, presentationIndex: event.rosterIndex })
      .sort((left, right) => left.presentationIndex - right.presentationIndex);
    return { ...view, enemies };
  }
  if (event.type === "removeFromPresentationRoster") {
    const targetsEnemyRoster = event.side === "enemy" || (
      !event.side && view.enemies.some(unit => getCombatPresentationUnitId(unit) === event.targetId)
    );
    if (targetsEnemyRoster) {
      return {
        ...view,
        enemies: view.enemies.filter(unit => getCombatPresentationUnitId(unit) !== event.targetId),
      };
    }
    if (event.summoned) {
      return {
        ...view,
        players: view.players.filter(unit => getCombatPresentationUnitId(unit) !== event.targetId),
      };
    }
    return view;
  }
  if (!event.targetId || !event.targetAfter) return view;
  const update = units => units.map(unit => (
    getCombatPresentationUnitId(unit) === event.targetId
      ? { ...unit, ...event.targetAfter, presentationIndex: unit.presentationIndex }
      : unit
  ));
  return { players: update(view.players), enemies: update(view.enemies) };
};

export const beginCombatPresentation = session => {
  if (!session || typeof session !== "object") return;
  eventQueues.set(getCombatPresentationQueueKey(session), []);
};

export const recordCombatPresentationEvent = (session, event) => {
  const queue = session && eventQueues.get(getCombatPresentationQueueKey(session));
  if (!queue || !event?.type) return;
  const actorId = event.actorId || getCombatPresentationUnitId(event.actor);
  queue.push({
    ...event,
    actorId,
    actorSide: event.actorSide || (session.state?.enemies?.includes(event.actor) ? "enemy" : "player"),
    summonerRuntimeId: event.summonerRuntimeId || (event.type === "summon" ? actorId : undefined),
    targetId: event.targetId || getCombatPresentationUnitId(event.target),
    side: event.side || (session.state?.enemies?.includes(event.target) ? "enemy" : "player"),
    targetAfter: event.targetAfter || snapshotCombatPresentationUnit(event.target, event.rosterIndex),
    sequence: queue.length,
  });
};

export const consumeCombatPresentationEvents = session => {
  const queueKey = session && getCombatPresentationQueueKey(session);
  const events = queueKey ? eventQueues.get(queueKey) || [] : [];
  if (queueKey) eventQueues.delete(queueKey);
  return events;
};

export const buildCombatPresentationTimeline = (events = [], { openingEnemyAnticipation = false } = {}) => {
  let actionOrdinal = -1;
  const sequencedEvents = events.map((event, index) => {
    if (event.type === "actionStart") actionOrdinal += 1;
    return {
      ...event,
      sequence: Number.isFinite(event.sequence) ? event.sequence : index,
      presentationActionIndex: actionOrdinal,
    };
  });
  const firstAction = sequencedEvents.find(event => event.type === "actionStart");
  const shouldAnticipateOpeningEnemy = Boolean(
    openingEnemyAnticipation && firstAction?.actorSide === "enemy"
  );
  const openingOffset = shouldAnticipateOpeningEnemy
    ? COMBAT_PRESENTATION_TIMING.openingEnemyAnticipation
    : 0;
  let actionImpactAt = COMBAT_PRESENTATION_TIMING.firstImpact;
  let maxAt = 0;
  let lastActor = null;
  let damageCounts = new Map();
  let targetImpactTimes = new Map();
  let impactTargetOrder = new Map();
  let currentActionStartAt = 0;
  let currentActionPacing = "normal";
  let nextActionEarliestAt = 0;
  const temporaryEntitySpawnAt = new Map();
  const pacingRank = { light: 0, normal: 1, heavy: 2 };
  const raiseActionPacing = pacing => {
    if ((pacingRank[pacing] ?? 0) > (pacingRank[currentActionPacing] ?? 0)) currentActionPacing = pacing;
  };

  const timeline = sequencedEvents.map((event, index) => {
    if (event.type === "actionStart") {
      const actorGap = getCombatActorHandoffGap(currentActionPacing);
      const at = event.presentationActionIndex > 0
        ? Math.max(maxAt + actorGap, nextActionEarliestAt, openingOffset)
        : openingOffset;
      currentActionStartAt = at;
      currentActionPacing = "light";
      lastActor = event.actor;
      actionImpactAt = at + COMBAT_PRESENTATION_TIMING.firstImpact;
      damageCounts = new Map();
      targetImpactTimes = new Map();
      impactTargetOrder = new Map();
      maxAt = Math.max(maxAt, at);
      return { ...event, at };
    }

    const isImpact = event.type === "damage" || event.type === "shieldAbsorbed";
    if (isImpact) {
      const isReaction = event.actor && lastActor && event.actor !== lastActor;
      if (isReaction) {
        actionImpactAt = maxAt + COMBAT_PRESENTATION_TIMING.repeatedHitGap;
        lastActor = event.actor;
        damageCounts = new Map();
        targetImpactTimes = new Map();
        impactTargetOrder = new Map();
      }
      const hitIndex = damageCounts.get(event.target) || 0;
      if (!impactTargetOrder.has(event.target)) impactTargetOrder.set(event.target, impactTargetOrder.size);
      const targetIndex = impactTargetOrder.get(event.target) || 0;
      const at = actionImpactAt
        + hitIndex * COMBAT_PRESENTATION_TIMING.repeatedHitGap
        + targetIndex * COMBAT_PRESENTATION_TIMING.aoeTargetStagger;
      if (event.type === "damage") damageCounts.set(event.target, hitIndex + 1);
      targetImpactTimes.set(event.target, at);
      maxAt = Math.max(maxAt, at);
      const impactTier = getCombatImpactTier(event);
      if (!event.isPeriodic) raiseActionPacing(impactTier === "heavy" ? "heavy" : "normal");
      return { ...event, impactTier, impactFlavor: getCombatImpactFlavor(event), at };
    }

    if (event.type === "statusTriggered") {
      const at = Math.max(currentActionStartAt, actionImpactAt - COMBAT_PRESENTATION_TIMING.statusTriggerLead);
      maxAt = Math.max(maxAt, at);
      return { ...event, at };
    }
    if (
      event.type === "heal" ||
      event.type === "shieldGain" ||
      event.type === "statusApplied" ||
      event.type === "statusBlocked" ||
      event.type === "statusCleanse"
    ) {
      raiseActionPacing("normal");
      const at = (targetImpactTimes.get(event.target) ?? actionImpactAt) + COMBAT_PRESENTATION_TIMING.feedbackDelay;
      maxAt = Math.max(maxAt, at);
      return { ...event, at };
    }
    if (event.type === "turnMeterChanged") {
      raiseActionPacing("normal");
      const at = (targetImpactTimes.get(event.target) ?? actionImpactAt) + COMBAT_PRESENTATION_TIMING.feedbackDelay;
      maxAt = Math.max(maxAt, at);
      return { ...event, at };
    }
    if (event.type === "turnMeterSteal" || event.type === "turnIntercept") {
      raiseActionPacing(event.type === "turnIntercept" ? "heavy" : "normal");
      const baseAt = (targetImpactTimes.get(event.target) ?? actionImpactAt) + COMBAT_PRESENTATION_TIMING.feedbackDelay;
      const at = Math.max(baseAt, maxAt + 40);
      if (event.type === "turnIntercept") {
        nextActionEarliestAt = Math.max(nextActionEarliestAt, at + COMBAT_PRESENTATION_TIMING.turnInterceptHold);
      }
      maxAt = Math.max(maxAt, at);
      return { ...event, at };
    }
    if (event.type === "bossPhaseTransition") {
      raiseActionPacing("heavy");
      const impactAt = targetImpactTimes.get(event.target) ?? actionImpactAt;
      const at = impactAt + COMBAT_PRESENTATION_TIMING.bossPhaseDelay;
      const stageEndAt = at + COMBAT_PRESENTATION_TIMING.bossPhaseDuration;
      nextActionEarliestAt = Math.max(nextActionEarliestAt, stageEndAt);
      maxAt = Math.max(maxAt, stageEndAt);
      return { ...event, at, stageEndAt };
    }
    if (event.type === "death") {
      raiseActionPacing("heavy");
      const impactAt = targetImpactTimes.get(event.target);
      const at = Number.isFinite(impactAt)
        ? impactAt + COMBAT_PRESENTATION_TIMING.deathReactionDelay
        : maxAt;
      maxAt = Math.max(maxAt, at);
      return { ...event, at };
    }
    if (event.type === "summon") {
      raiseActionPacing("heavy");
      const at = Math.max(maxAt, currentActionStartAt + COMBAT_PRESENTATION_TIMING.summonAnticipation);
      nextActionEarliestAt = at + COMBAT_PRESENTATION_TIMING.summonGridTransition;
      maxAt = Math.max(maxAt, at);
      return { ...event, at };
    }
    if (event.type === 'temporaryEntitySpawn') {
      const at = Math.max(maxAt, currentActionStartAt + COMBAT_PRESENTATION_TIMING.feedbackDelay);
      temporaryEntitySpawnAt.set(event.entityId, at);
      maxAt = Math.max(maxAt, at);
      return { ...event, at };
    }
    if (event.type === 'temporaryEntityActivate') {
      const spawnedAt = temporaryEntitySpawnAt.get(event.entityId) ?? maxAt;
      const at = Math.max(maxAt, spawnedAt + COMBAT_PRESENTATION_TIMING.temporaryEntityMinimumLifetime);
      nextActionEarliestAt = Math.max(nextActionEarliestAt, at);
      maxAt = at;
      return { ...event, at };
    }
    if (event.type === "procTriggered") raiseActionPacing(event.deathSave ? "heavy" : "normal");
    return { ...event, at: maxAt };
  });

  const resolveCausalTimeline = baseTimeline => {
    let resolved = baseTimeline.map(event => ({ ...event }));
    for (let pass = 0; pass < 8; pass += 1) {
      const anchorTimes = new Map();
      const setAnchor = (type, targetId, event) => {
        if (!type || !targetId || !Number.isFinite(event?.at)) return;
        const key = `${type}:${targetId}`;
        const entries = anchorTimes.get(key) || [];
        entries.push({ at: event.at, sequence: event.sequence ?? 0 });
        anchorTimes.set(key, entries);
      };
      resolved.forEach(event => {
        const targetId = event.targetId || getCombatPresentationUnitId(event.target);
        setAnchor(event.type, targetId, event);
        if (event.type === "shieldAbsorbed") {
          setAnchor("shieldImpact", targetId, event);
          if (event.shieldBroken) setAnchor("shieldBreak", targetId, event);
        }
      });

      const consequenceCounts = new Map();
      let changed = false;
      const next = resolved.map(event => {
        if (!event.afterEventType || !event.afterTargetId) return event;
        const anchorKey = `${event.afterEventType}:${event.afterTargetId}`;
        const anchors = anchorTimes.get(anchorKey) || [];
        if (anchors.length === 0) return event;
        const eventSequence = event.sequence ?? 0;
        const preceding = anchors.filter(anchor => anchor.sequence <= eventSequence).at(-1);
        const following = anchors.find(anchor => anchor.sequence > eventSequence);
        const anchor = event.afterEventDirection === "following"
          ? (following || preceding)
          : event.afterEventDirection === "preceding"
          ? (preceding || following)
          : (preceding || following);
        if (!anchor) return event;
        const occurrenceKey = `${anchorKey}:${anchor.sequence}`;
        const ordinal = consequenceCounts.get(occurrenceKey) || 0;
        consequenceCounts.set(occurrenceKey, ordinal + 1);
        const requestedDelay = Number(event.afterDelay);
        const delay = Number.isFinite(requestedDelay)
          ? Math.max(0, requestedDelay)
          : event.type === "procTriggered" && event.deathSave
          ? COMBAT_PRESENTATION_TIMING.deathSaveProcDelay
          : event.type === "deathSaveResolved"
          ? COMBAT_PRESENTATION_TIMING.deathSaveResolveDelay
          : COMBAT_PRESENTATION_TIMING.consequenceGap;
        const at = anchor.at + delay + ordinal * COMBAT_PRESENTATION_TIMING.consequenceStagger;
        if (at !== event.at || event.causalAnchorAt !== anchor.at || event.causalAnchorSequence !== anchor.sequence) {
          changed = true;
        }
        return { ...event, at, causalAnchorAt: anchor.at, causalAnchorSequence: anchor.sequence };
      });
      resolved = next;
      if (!changed) break;
    }
    return resolved;
  };

  const resolvedTimeline = resolveCausalTimeline(timeline);

  const removalCandidates = resolvedTimeline
    .filter(event => (
      event.type === "death" &&
      (event.side === "enemy" || event.targetAfter?.summoned === true)
    ))
    .map(event => {
      const summoned = event.targetAfter?.summoned === true;
      const boss = Boolean(event.targetAfter?.boss || event.targetAfter?.isBoss);
      const profile = boss ? "boss" : summoned ? "summon" : "ordinary";
      const hold = boss
        ? COMBAT_PRESENTATION_TIMING.bossDeathHold
        : summoned
        ? COMBAT_PRESENTATION_TIMING.summonDeathHold
        : COMBAT_PRESENTATION_TIMING.deathHold;
      const exitDuration = boss
        ? COMBAT_PRESENTATION_TIMING.bossDeathExit
        : summoned
        ? COMBAT_PRESENTATION_TIMING.summonDeathExit
        : COMBAT_PRESENTATION_TIMING.deathExit;
      const actionKey = event.presentationActionIndex >= 0
        ? `action:${event.presentationActionIndex}`
        : `event:${event.sequence}`;
      return {
        type: "removeFromPresentationRoster",
        targetId: event.targetId,
        side: event.side,
        summoned,
        boss,
        profile,
        actionKey,
        at: event.at + hold + exitDuration,
        exitAt: event.at + hold,
        exitDuration,
        sequence: event.sequence,
      };
    });

  const contractionAtByGroup = removalCandidates.reduce((groups, removal) => {
    const key = `${removal.actionKey}:${removal.side || "unknown"}:${removal.profile}`;
    groups.set(key, Math.max(groups.get(key) || 0, removal.at));
    return groups;
  }, new Map());

  const removals = removalCandidates.map(removal => {
    const key = `${removal.actionKey}:${removal.side || "unknown"}:${removal.profile}`;
    const at = contractionAtByGroup.get(key) || removal.at;
    const { profile, actionKey, ...event } = removal;
    return {
      ...event,
      at,
      exitAt: at - removal.exitDuration,
    };
  });

  const opening = shouldAnticipateOpeningEnemy ? [{
    type: "openingEnemyAnticipation",
    actor: firstAction.actor,
    actorId: firstAction.actorId,
    actorSide: "enemy",
    at: 0,
    sequence: -1,
  }] : [];

  return [...opening, ...resolvedTimeline, ...removals].sort((left, right) => (
    left.at - right.at || (left.sequence ?? 0) - (right.sequence ?? 0)
  ));
};

export const getCombatPresentationDuration = (timeline, { resultOutcome = null } = {}) => {
  if (!timeline.length) return 0;
  const eventEnd = event => (
    (event.at || 0) + (event.type === "removeFromPresentationRoster"
      ? 0
      : event.type === "summon"
      ? COMBAT_PRESENTATION_TIMING.summonGridTransition
      : event.type === 'temporaryEntitySpawn'
      ? COMBAT_PRESENTATION_TIMING.temporaryEntityMinimumLifetime
      : event.type === "procTriggered"
      ? COMBAT_PRESENTATION_TIMING.procDuration
      : event.type === "deathSaveResolved"
      ? COMBAT_PRESENTATION_TIMING.deathSaveResolveDuration
      : event.type === "turnMeterChanged" || event.type === "turnMeterSteal" || event.type === "turnIntercept"
      ? COMBAT_PRESENTATION_TIMING.turnMeterFeedbackDuration
      : event.type === "bossPhaseTransition"
      ? COMBAT_PRESENTATION_TIMING.bossPhaseDuration
      : event.type === "death" && (event.targetAfter?.boss || event.targetAfter?.isBoss)
      ? COMBAT_PRESENTATION_TIMING.bossDeathHold + COMBAT_PRESENTATION_TIMING.bossDeathExit
      : event.type === "death" && event.targetAfter?.summoned
      ? COMBAT_PRESENTATION_TIMING.summonDeathHold + COMBAT_PRESENTATION_TIMING.summonDeathExit
      : COMBAT_PRESENTATION_TIMING.essentialTail)
  );
  const baseDuration = Math.max(...timeline.map(eventEnd));
  if (!resultOutcome) return baseDuration;

  const deathEvents = timeline.filter(event => event.type === "death");
  if (!deathEvents.length) return baseDuration;
  const decisiveDeathAt = Math.max(...deathEvents.map(event => event.at || 0));
  const latestEventAt = Math.max(...timeline.map(event => event.at || 0));
  const resultTail = resultOutcome === "defeat"
    ? COMBAT_PRESENTATION_TIMING.resultDefeatTail
    : COMBAT_PRESENTATION_TIMING.resultVictoryTail;
  const bossSequenceEnd = Math.max(0, ...deathEvents
    .filter(event => event.targetAfter?.boss || event.targetAfter?.isBoss)
    .map(event => (event.at || 0) + COMBAT_PRESENTATION_TIMING.bossDeathHold + COMBAT_PRESENTATION_TIMING.bossDeathExit));

  return Math.max(decisiveDeathAt + resultTail, latestEventAt, bossSequenceEnd);
};
