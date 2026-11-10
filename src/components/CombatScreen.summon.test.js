import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import CombatScreen from "./CombatScreen";
import { UIProvider } from "../contexts/UIContext";
import { COMBAT_PRESENTATION_TIMING } from "../utils/combatPresentationEvents";
import * as combatUtils from "../utils/combatUtils";

jest.mock("../utils/combatUtils", () => {
  const actual = jest.requireActual("../utils/combatUtils");
  const presentation = jest.requireActual("../utils/combatPresentationEvents");
  let enemyAiCalls = 0;
  let scenario = "three-summoners";
  const playerActionTargets = [];
  return {
    ...actual,
    initCombatSession: (player, enemies) => ({
      state: {
        players: [{ ...player }],
        enemies: enemies.map(enemy => ({ ...enemy })),
        log: ["Бой начался!"],
        initiative: { playerReady: true },
      },
    }),
    performPlayerAction: (session, abilityName, targetIndex) => {
      playerActionTargets.push({ abilityName, targetIndex, targetId: session.state.enemies[targetIndex]?.id });
      presentation.beginCombatPresentation(session);
      presentation.recordCombatPresentationEvent(session, {
        type: "actionStart",
        actor: session.state.players[0],
        action: session.state.players[0].abilities[0],
      });
      session.state.initiative.playerReady = false;
      return { session, turnConsumed: true };
    },
    processEnemyAI: session => {
      enemyAiCalls += 1;
      if (enemyAiCalls === 1) return { session };
      if (scenario === "target-churn") {
        const doomed = session.state.enemies[0];
        const ratmancer = session.state.enemies[1];
        const summon = { id: "churn-summon-runtime", name: "Чумная крыса", hp: 8, maxHp: 8, effects: [], summoned: true };
        session.state.enemies.push(summon);
        presentation.recordCombatPresentationEvent(session, {
          type: "summon", actor: ratmancer, target: summon, side: "enemy",
          summonedUnitId: summon.id, rosterIndex: 2,
        });
        [doomed, summon].forEach(target => {
          target.hp = 0;
          presentation.recordCombatPresentationEvent(session, { type: "death", actor: ratmancer, target });
        });
        session.state.enemies = [ratmancer, doomed, summon];
        session.state.initiative.playerReady = true;
        return { session };
      }
      if (scenario === "dead-slot") {
        const killer = session.state.enemies[0];
        const victim = session.state.enemies[2];
        presentation.recordCombatPresentationEvent(session, {
          type: "actionStart",
          actor: killer,
          action: { name: "Удар" },
        });
        victim.hp = 0;
        presentation.recordCombatPresentationEvent(session, {
          type: "damage",
          actor: killer,
          target: victim,
          amount: victim.maxHp,
          lethal: true,
        });
        presentation.recordCombatPresentationEvent(session, { type: "death", actor: killer, target: victim });
        const summoner = session.state.enemies[1];
        const replacement = { id: "replacement-runtime", name: "Чумная крыса", hp: 8, maxHp: 8, effects: [], summoned: true };
        presentation.recordCombatPresentationEvent(session, {
          type: "actionStart",
          actor: summoner,
          action: { name: "Крысиный зов" },
        });
        session.state.enemies[2] = replacement;
        presentation.recordCombatPresentationEvent(session, {
          type: "summon",
          actor: summoner,
          target: replacement,
          side: "enemy",
          summonedUnitId: replacement.id,
          rosterIndex: 2,
        });
        session.state.initiative.playerReady = true;
        return { session };
      }
      session.state.enemies.slice(0, 3).forEach((summoner, offset) => {
        const rat = {
          id: `rat-runtime-${offset + 1}`,
          name: "Чумная крыса",
          hp: 8,
          maxHp: 8,
          effects: [],
          summoned: true,
        };
        presentation.recordCombatPresentationEvent(session, {
          type: "actionStart",
          actor: summoner,
          action: { name: "Крысиный зов" },
        });
        session.state.enemies.push(rat);
        presentation.recordCombatPresentationEvent(session, {
          type: "summon",
          actor: summoner,
          target: rat,
          side: "enemy",
          summonedUnitId: rat.id,
          rosterIndex: offset + 3,
        });
      });
      session.state.initiative.playerReady = true;
      return { session };
    },
    checkBattleOutcome: () => ({ victory: false, defeat: false }),
    __resetCombatScreenSummonMock: () => { enemyAiCalls = 0; scenario = "three-summoners"; playerActionTargets.length = 0; },
    __setCombatScreenSummonScenario: next => { scenario = next; },
    __getCombatScreenPlayerActionTargets: () => playerActionTargets,
  };
});

const player = {
  id: "player-runtime",
  name: "Герой",
  hp: 100,
  maxHp: 100,
  effects: [],
  items: [],
  abilities: [{ name: "Атака", basic: true, currentCooldown: 0 }],
};

const summoners = [1, 2, 3].map(index => ({
  id: `summoner-runtime-${index}`,
  name: `Призыватель ${index}`,
  hp: 20,
  maxHp: 20,
  effects: [],
}));

describe("CombatScreen summon presentation integration", () => {
  let animationFrames;
  let animateCalls;
  let originalAnimate;
  let originalRect;
  let originalRaf;
  let originalCancelRaf;
  let rectSequence;

  beforeEach(() => {
    jest.useFakeTimers();
    combatUtils.__resetCombatScreenSummonMock();
    animationFrames = [];
    animateCalls = [];
    rectSequence = 0;
    originalAnimate = HTMLElement.prototype.animate;
    originalRect = HTMLElement.prototype.getBoundingClientRect;
    originalRaf = window.requestAnimationFrame;
    originalCancelRaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = callback => {
      animationFrames.push(callback);
      return animationFrames.length;
    };
    window.cancelAnimationFrame = jest.fn();
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      rectSequence += 1;
      return { left: rectSequence * 10, top: rectSequence * 5, width: 100, height: 120, right: 0, bottom: 0 };
    };
    HTMLElement.prototype.animate = function animate(keyframes, options) {
      animateCalls.push({ element: this, keyframes, options });
      return { cancel: jest.fn() };
    };
  });

  afterEach(() => {
    HTMLElement.prototype.animate = originalAnimate;
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  const enemySlots = container => [...container.querySelectorAll(".enemy-party > .combat-unit-slot")];
  const battlefield = container => container.querySelector(".enemy-party");
  const flushAnimationFrame = () => {
    const callback = animationFrames.shift();
    act(() => callback?.(performance.now()));
  };

  test("renders 3→4→5→6 with independent inner-card entrances and wrapper-owned FLIP", () => {
    const { container } = render(
      <UIProvider>
        <CombatScreen player={player} enemies={summoners} />
      </UIProvider>
    );

    expect(enemySlots(container)).toHaveLength(3);
    expect(battlefield(container)).toHaveClass("enemy-party-trio", "enemy-count-3");

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Призыватель 1" }), { key: "Enter" });

    const firstSummonAt = COMBAT_PRESENTATION_TIMING.nextActorGap + COMBAT_PRESENTATION_TIMING.summonAnticipation;
    act(() => jest.advanceTimersByTime(firstSummonAt));
    expect(enemySlots(container)).toHaveLength(4);
    expect(battlefield(container)).toHaveClass("enemy-party-quad", "enemy-count-4");
    const ratAWrapper = container.querySelector('[data-runtime-id="rat-runtime-1"].combat-unit-slot');
    const ratACard = ratAWrapper.querySelector(".combat-unit-card");
    expect(ratACard).toHaveAttribute("data-entrance-phase", "initial");
    expect(ratACard).toHaveClass("is-summoning", "is-entering-initial");

    flushAnimationFrame();
    expect(ratACard).toHaveAttribute("data-entrance-phase", "initial");
    flushAnimationFrame();
    expect(ratACard).toHaveAttribute("data-entrance-phase", "active");

    act(() => jest.advanceTimersByTime(COMBAT_PRESENTATION_TIMING.summonGridTransition + COMBAT_PRESENTATION_TIMING.summonAnticipation - 1));
    expect(enemySlots(container)).toHaveLength(4);
    expect(ratACard).not.toHaveAttribute("data-entrance-phase");
    act(() => jest.advanceTimersByTime(1));
    expect(enemySlots(container)).toHaveLength(5);
    expect(battlefield(container)).toHaveClass("enemy-party-swarm", "enemy-count-5");
    expect(container.querySelector('[data-runtime-id="rat-runtime-2"] .combat-unit-card'))
      .toHaveAttribute("data-entrance-phase", "initial");

    act(() => jest.advanceTimersByTime(COMBAT_PRESENTATION_TIMING.summonGridTransition + COMBAT_PRESENTATION_TIMING.summonAnticipation - 1));
    expect(enemySlots(container)).toHaveLength(5);
    act(() => jest.advanceTimersByTime(1));
    expect(enemySlots(container)).toHaveLength(6);
    expect(battlefield(container)).toHaveClass("enemy-party-swarm", "enemy-count-6");
    expect(container.querySelector('[data-runtime-id="rat-runtime-3"] .combat-unit-card'))
      .toHaveAttribute("data-entrance-phase", "initial");
    expect(new Set(enemySlots(container).map(slot => slot.dataset.runtimeId)).size).toBe(6);

    expect(animateCalls.length).toBeGreaterThan(0);
    animateCalls.forEach(call => {
      expect(call.element).toHaveClass("combat-unit-slot");
      expect(call.element).not.toHaveClass("combat-unit-card");
    });
  });

  test("mounts a new runtime-keyed entrance when a summon reuses a removed authoritative slot", () => {
    combatUtils.__setCombatScreenSummonScenario("dead-slot");
    const sixEnemies = [1, 2, 3, 4, 5, 6].map(index => ({
      id: `original-runtime-${index}`,
      name: `Враг ${index}`,
      hp: 20,
      maxHp: 20,
      effects: [],
    }));
    const { container } = render(
      <UIProvider>
        <CombatScreen player={player} enemies={sixEnemies} />
      </UIProvider>
    );
    const oldWrapper = container.querySelector('[data-runtime-id="original-runtime-3"].combat-unit-slot');
    expect(oldWrapper).toHaveAttribute("data-presentation-index", "2");

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Враг 1" }), { key: "Enter" });

    const deathRemovalAt = COMBAT_PRESENTATION_TIMING.nextActorGap
      + COMBAT_PRESENTATION_TIMING.firstImpact
      + COMBAT_PRESENTATION_TIMING.deathHold
      + COMBAT_PRESENTATION_TIMING.deathExit;
    act(() => jest.advanceTimersByTime(deathRemovalAt));
    expect(enemySlots(container)).toHaveLength(5);
    expect(container.querySelector('[data-runtime-id="original-runtime-3"]')).not.toBeInTheDocument();

    const replacementSummonAt = COMBAT_PRESENTATION_TIMING.nextActorGap
      + COMBAT_PRESENTATION_TIMING.firstImpact
      + COMBAT_PRESENTATION_TIMING.nextActorGap
      + COMBAT_PRESENTATION_TIMING.summonAnticipation;
    act(() => jest.advanceTimersByTime(replacementSummonAt - deathRemovalAt));
    expect(enemySlots(container)).toHaveLength(6);
    const replacementWrapper = container.querySelector('[data-runtime-id="replacement-runtime"].combat-unit-slot');
    expect(replacementWrapper).toHaveAttribute("data-presentation-index", "2");
    expect(replacementWrapper.querySelector(".combat-unit-card"))
      .toHaveAttribute("data-entrance-phase", "initial");
  });

  test("targets the final authoritative survivor by runtime identity after summon and death churn", () => {
    combatUtils.__setCombatScreenSummonScenario("target-churn");
    const churnEnemies = [
      { id: "doomed-runtime", name: "Обречённый", hp: 20, maxHp: 20, effects: [] },
      { id: "ratmancer-runtime", name: "Крысомант", hp: 20, maxHp: 20, effects: [] },
    ];
    const { container } = render(
      <UIProvider>
        <CombatScreen player={player} enemies={churnEnemies} />
      </UIProvider>
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Обречённый" }), { key: "Enter" });
    act(() => jest.runOnlyPendingTimers());

    const survivor = container.querySelector('[data-runtime-id="ratmancer-runtime"].combat-unit-card');
    expect(enemySlots(container)).toHaveLength(1);
    expect(survivor).toHaveAttribute("data-presentation-index", "0");
    expect(survivor).toHaveAttribute("data-authoritative-index", "0");
    expect(survivor).toHaveAttribute("data-combat-target", "enemy:ratmancer-runtime");

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(survivor, { key: "Enter" });
    expect(combatUtils.__getCombatScreenPlayerActionTargets().at(-1)).toEqual({
      abilityName: "Атака",
      targetIndex: 0,
      targetId: "ratmancer-runtime",
    });
  });
});
