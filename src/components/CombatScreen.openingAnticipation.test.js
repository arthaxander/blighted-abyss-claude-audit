import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import CombatScreen from "./CombatScreen";
import { UIProvider } from "../contexts/UIContext";
import { COMBAT_PRESENTATION_TIMING } from "../utils/combatPresentationEvents";
import * as combatUtils from "../utils/combatUtils";

jest.mock("../utils/combatUtils", () => {
  const actual = jest.requireActual("../utils/combatUtils");
  const presentation = jest.requireActual("../utils/combatPresentationEvents");
  let playerActions = 0;
  return {
    ...actual,
    initCombatSession: (player, enemies) => ({
      state: {
        players: [{ ...player }],
        enemies: enemies.map(enemy => ({ ...enemy })),
        log: ["Бой начался!"],
        initiative: { playerReady: false },
      },
    }),
    processEnemyAI: session => {
      presentation.beginCombatPresentation(session);
      presentation.recordCombatPresentationEvent(session, {
        type: "actionStart",
        actor: session.state.enemies[0],
        action: { name: "Боевой клич" },
      });
      session.state.initiative.playerReady = true;
      return { session };
    },
    performPlayerAction: session => {
      playerActions += 1;
      return { session, turnConsumed: false };
    },
    checkBattleOutcome: () => ({ victory: false, defeat: false }),
    __resetOpeningAnticipationMock: () => { playerActions = 0; },
    __getOpeningAnticipationPlayerActions: () => playerActions,
  };
});

const player = {
  id: "opening-player",
  name: "Герой",
  hp: 100,
  maxHp: 100,
  effects: [],
  items: [],
  abilities: [{ name: "Атака", artId: "attack", basic: true, currentCooldown: 0 }],
};
const enemy = {
  id: "opening-enemy",
  name: "Быстрый враг",
  hp: 100,
  maxHp: 100,
  effects: [],
  portraitUrl: "/assets/test-enemy.webp",
};

const renderCombat = () => render(
  <UIProvider>
    <CombatScreen player={player} enemies={[enemy]} />
  </UIProvider>
);

describe("CombatScreen opening enemy anticipation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    combatUtils.__resetOpeningAnticipationMock();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("renders and locks the battlefield until the delayed first enemy presentation begins", () => {
    const { container, rerender } = renderCombat();
    const enemyCard = screen.getByRole("button", { name: "Быстрый враг" });
    const attack = screen.getByRole("button", { name: "Атака" });
    const actionIcon = container.querySelector(".combat-enemy-action-icon");
    const actorFocus = container.querySelector(".combat-actor-focus.is-enemy");
    const actorPortrait = container.querySelector(".combat-actor-portrait-zoom.is-enemy");

    expect(enemyCard).toHaveClass("is-opening-enemy");
    expect(actorFocus).toHaveStyle(`animation-delay: ${COMBAT_PRESENTATION_TIMING.openingEnemyAnticipation}ms`);
    expect(actorPortrait).toHaveStyle(`animation-delay: ${COMBAT_PRESENTATION_TIMING.openingEnemyAnticipation}ms`);
    expect(actionIcon).toHaveStyle(`animation-delay: ${COMBAT_PRESENTATION_TIMING.openingEnemyAnticipation}ms`);
    expect(attack).toHaveAttribute('aria-disabled', 'true');

    fireEvent.keyDown(attack, { key: "Enter" });
    fireEvent.click(enemyCard);
    act(() => { jest.advanceTimersByTime(COMBAT_PRESENTATION_TIMING.openingEnemyAnticipation); });
    expect(combatUtils.__getOpeningAnticipationPlayerActions()).toBe(0);

    act(() => { jest.runOnlyPendingTimers(); });
    expect(attack).toBeEnabled();
    expect(combatUtils.__getOpeningAnticipationPlayerActions()).toBe(0);
    fireEvent.keyDown(attack, { key: "Enter" });
    fireEvent.click(enemyCard);
    expect(combatUtils.__getOpeningAnticipationPlayerActions()).toBe(1);

    rerender(
      <UIProvider>
        <CombatScreen player={player} enemies={[enemy]} />
      </UIProvider>
    );
    expect(screen.getByRole("button", { name: "Быстрый враг" })).not.toHaveClass("is-opening-enemy");
  });
});
