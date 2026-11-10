import {
  addEffect,
  cleanseEffects,
} from "./effects";
import {
  beginCombatPresentation,
  consumeCombatPresentationEvents,
  applyCombatPresentationEvent,
  buildCombatPresentationTimeline,
  COMBAT_PRESENTATION_TIMING,
} from "./combatPresentationEvents";

const makeUnits = () => {
  const source = { id: "source", name: "Source", hp: 100, maxHp: 100, effects: [] };
  const target = { id: "target", name: "Target", hp: 100, maxHp: 100, effects: [] };
  const session = { state: { players: [source], enemies: [target] } };
  return { source, target, session };
};

describe("status presentation operations", () => {
  test("distinguishes apply, stack and refresh without changing effect mechanics", () => {
    const { source, target, session } = makeUnits();
    beginCombatPresentation(session);
    addEffect(target, { id: "poison", duration: 2 }, () => {}, source, { session });
    addEffect(target, { id: "poison", duration: 2 }, () => {}, source, { session });
    addEffect(source, { id: "regeneration", duration: 2 }, () => {}, source, { session });
    addEffect(source, { id: "regeneration", duration: 2 }, () => {}, source, { session });

    const operations = consumeCombatPresentationEvents(session)
      .filter(event => event.type === "statusApplied")
      .map(event => [event.effectId, event.statusOperation]);

    expect(operations).toEqual(expect.arrayContaining([
      ["poison", "apply"],
      ["poison", "stack"],
      ["regeneration", "apply"],
      ["regeneration", "refresh"],
    ]));
  });

  test("records blocked statuses without adding them", () => {
    const { source, target, session } = makeUnits();
    target.blockDebuffs = true;
    beginCombatPresentation(session);
    expect(addEffect(target, { id: "poison", duration: 2 }, () => {}, source, { session })).toBeNull();
    expect(target.effects.some(effect => effect?.id === "poison")).toBe(false);
    expect(consumeCombatPresentationEvents(session)).toEqual([
      expect.objectContaining({
        type: "statusBlocked",
        effectId: "poison",
        statusOperation: "blocked",
      }),
    ]);
  });

  test("aggregates user-facing cleanses by effect family", () => {
    const { source, target, session } = makeUnits();
    addEffect(target, { id: "poison", duration: 2 }, () => {}, source);
    addEffect(target, { id: "poison", duration: 2 }, () => {}, source);
    beginCombatPresentation(session);
    cleanseEffects(target, effect => effect?.id === "poison", () => {}, { session, actor: source });

    expect(consumeCombatPresentationEvents(session)).toEqual([
      expect.objectContaining({
        type: "statusCleanse",
        effectId: "poison",
        statusOperation: "cleanse",
        removedCount: 2,
      }),
    ]);
  });

  test("presentation-only status cues never advance HP or statuses early", () => {
    const view = {
      players: [],
      enemies: [{ id: "target", hp: 100, maxHp: 100, effects: [] }],
    };
    const leakedSnapshot = {
      id: "target",
      hp: 75,
      maxHp: 100,
      effects: [{ id: "poison" }],
    };
    expect(applyCombatPresentationEvent(view, {
      type: "statusTriggered",
      targetId: "target",
      targetAfter: leakedSnapshot,
    })).toBe(view);
    expect(applyCombatPresentationEvent(view, {
      type: "statusBlocked",
      targetId: "target",
      targetAfter: leakedSnapshot,
    })).toBe(view);
  });

  test("places a status trigger just before its periodic damage impact", () => {
    const actor = { id: "source" };
    const target = { id: "target" };
    const timeline = buildCombatPresentationTimeline([
      { type: "statusTriggered", actor, target, effectId: "poison", label: "Отравление" },
      { type: "damage", actor, target, amount: 10, maxHp: 100, isPeriodic: true },
    ]);
    const trigger = timeline.find(event => event.type === "statusTriggered");
    const damage = timeline.find(event => event.type === "damage");
    expect(damage.at - trigger.at).toBe(COMBAT_PRESENTATION_TIMING.statusTriggerLead);
  });
});
