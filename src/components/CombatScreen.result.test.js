import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import CombatScreen from "./CombatScreen";
import { UIProvider } from "../contexts/UIContext";
import { COMBAT_PRESENTATION_TIMING } from "../utils/combatPresentationEvents";
import * as combatUtils from "../utils/combatUtils";

jest.mock("../utils/combatUtils", () => {
  const actual = jest.requireActual("../utils/combatUtils");
  const presentation = jest.requireActual("../utils/combatPresentationEvents");
  const defaultLoot = [{ name: "Простая ткань" }, { name: "Простая ткань" }];
  let enemyAiCalls = 0;
  let lootRolls = 0;
  let nextLoot = defaultLoot;
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
    performPlayerAction: session => {
      presentation.beginCombatPresentation(session);
      const player = session.state.players[0];
      const enemy = session.state.enemies[0];
      presentation.recordCombatPresentationEvent(session, {
        type: "actionStart", actor: player, action: player.abilities[0],
      });
      if (enemy.name === "Победная цель") {
        enemy.hp = 0;
        presentation.recordCombatPresentationEvent(session, {
          type: "damage", actor: player, target: enemy, amount: enemy.maxHp, lethal: true,
        });
        presentation.recordCombatPresentationEvent(session, { type: "death", actor: player, target: enemy });
      }
      session.state.initiative.playerReady = false;
      return { session, turnConsumed: true };
    },
    processEnemyAI: session => {
      enemyAiCalls += 1;
      if (enemyAiCalls === 1 || session.state.enemies[0].hp <= 0) return { session };
      const player = session.state.players[0];
      const enemy = session.state.enemies[0];
      presentation.recordCombatPresentationEvent(session, {
        type: "actionStart", actor: enemy, action: { name: "Смертельный удар" },
      });
      player.hp = 0;
      presentation.recordCombatPresentationEvent(session, {
        type: "damage", actor: enemy, target: player, amount: player.maxHp, lethal: true,
      });
      presentation.recordCombatPresentationEvent(session, { type: "death", actor: enemy, target: player });
      return { session };
    },
    checkBattleOutcome: session => ({
      victory: session.state.enemies.every(enemy => enemy.hp <= 0),
      defeat: session.state.players[0].hp <= 0,
    }),
    rollLootForEnemies: () => {
      lootRolls += 1;
      return nextLoot;
    },
    __resetCombatResultMock: () => { enemyAiCalls = 0; lootRolls = 0; nextLoot = defaultLoot; },
    __getCombatResultLootRolls: () => lootRolls,
    __setCombatResultLoot: loot => { nextLoot = loot; },
  };
});

const player = {
  id: "result-player",
  name: "Герой",
  hp: 20,
  maxHp: 20,
  effects: [],
  items: [],
  abilities: [{ name: "Атака", basic: true, currentCooldown: 0 }],
};

const renderCombat = (enemy, callbacks = {}) => render(
  <UIProvider>
    <CombatScreen player={player} enemies={[enemy]} {...callbacks} />
  </UIProvider>
);

const expectInteractiveResultLayer = (container, title) => {
  const battlefield = container.querySelector(".battlefield");
  const battleScreen = container.querySelector(".battle-screen");
  const overlay = document.body.querySelector(".combat-result-overlay");
  const backdrop = overlay?.querySelector(".combat-result-backdrop");
  const panel = overlay?.querySelector(".combat-result-panel");
  const continueButton = screen.getByRole("button", { name: "Продолжить" });

  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(battlefield).toBeInTheDocument();
  expect(battlefield).toHaveAttribute("inert");
  expect(battlefield).toHaveClass("has-battle-result");
  expect(overlay?.parentElement).toBe(document.body);
  expect(battleScreen?.contains(overlay)).toBe(false);
  expect(overlay).not.toHaveAttribute("inert");
  expect(overlay.closest("[inert]")).toBeNull();
  expect(backdrop).toHaveAttribute("aria-hidden", "true");
  expect(backdrop?.parentElement).toBe(overlay);
  expect(panel?.parentElement).toBe(overlay);
  expect(panel?.contains(backdrop)).toBe(false);
  expect(continueButton).toBeEnabled();
};

describe("CombatScreen battle result presentation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    combatUtils.__resetCombatResultMock();
  });

  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test("holds the lethal defeat battlefield at zero HP before Continue navigates", () => {
    const onDefeat = jest.fn();
    const onClearCombatSnapshot = jest.fn();
    const onCombatSnapshot = jest.fn();
    const { container } = renderCombat(
      { id: "defeat-enemy", name: "Смертельный враг", hp: 20, maxHp: 20, effects: [] },
      { onDefeat, onClearCombatSnapshot, onCombatSnapshot }
    );

    const playerCard = screen.getByLabelText("Герой");
    expect(playerCard.querySelector('[aria-label="Здоровье: 20/20"]')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Смертельный враг" }), { key: "Enter" });

    const lethalImpactAt = COMBAT_PRESENTATION_TIMING.nextActorGapLight + COMBAT_PRESENTATION_TIMING.firstImpact;
    act(() => jest.advanceTimersByTime(lethalImpactAt - 1));
    expect(screen.queryByRole("heading", { name: "Поражение" })).not.toBeInTheDocument();
    expect(onDefeat).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(playerCard.querySelector('[aria-label="Здоровье: 0/20"]')).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Поражение" })).not.toBeInTheDocument();
    expect(onClearCombatSnapshot).not.toHaveBeenCalled();
    expect(onCombatSnapshot.mock.calls.at(-1)?.[0]?.battleResult).toEqual({
      outcome: "defeat",
    });

    act(() => jest.advanceTimersByTime(COMBAT_PRESENTATION_TIMING.resultDefeatTail - 1));
    expect(screen.queryByRole("heading", { name: "Поражение" })).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole("heading", { name: "Поражение" })).toBeInTheDocument();
    expect(container.querySelector(".battlefield")).toBeInTheDocument();
    expectInteractiveResultLayer(container, "Поражение");
    expect(onDefeat).not.toHaveBeenCalled();

    const continueButton = screen.getByRole("button", { name: "Продолжить" });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);
    expect(onDefeat).toHaveBeenCalledTimes(1);
  });

  test("does not reveal victory until the boss death sequence has completed", () => {
    const onVictory = jest.fn();
    renderCombat(
      { id: "boss-victory", name: "Победная цель", hp: 20, maxHp: 20, effects: [], boss: true },
      { onVictory }
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Победная цель" }), { key: "Enter" });

    const bossImpactAt = COMBAT_PRESENTATION_TIMING.firstImpact;
    const bossSequence = COMBAT_PRESENTATION_TIMING.bossDeathHold + COMBAT_PRESENTATION_TIMING.bossDeathExit;
    act(() => jest.advanceTimersByTime(bossImpactAt + bossSequence - 1));
    expect(screen.queryByRole("heading", { name: "Победа" })).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole("heading", { name: "Победа" })).toBeInTheDocument();
    expect(onVictory).not.toHaveBeenCalled();
  });

  test("shows stored victory loot once and waits for Continue", () => {
    const onVictory = jest.fn();
    const enemy = { id: "victory-enemy", name: "Победная цель", hp: 20, maxHp: 20, effects: [] };
    const view = renderCombat(enemy, { onVictory });

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Победная цель" }), { key: "Enter" });
    expect(onVictory).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Победа" })).not.toBeInTheDocument();

    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByRole("heading", { name: "Победа" })).toBeInTheDocument();
    expect(screen.getByText("Простая ткань")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(view.container.querySelector(".battlefield")).toBeInTheDocument();
    expectInteractiveResultLayer(view.container, "Победа");
    expect(onVictory).not.toHaveBeenCalled();
    expect(combatUtils.__getCombatResultLootRolls()).toBe(1);

    view.rerender(
      <UIProvider>
        <CombatScreen player={player} enemies={[enemy]} onVictory={onVictory} />
      </UIProvider>
    );
    expect(combatUtils.__getCombatResultLootRolls()).toBe(1);
    const continueButton = screen.getByRole("button", { name: "Продолжить" });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);
    expect(onVictory).toHaveBeenCalledTimes(1);
    expect(onVictory).toHaveBeenCalledWith(
      [{ name: "Простая ткань" }, { name: "Простая ткань" }],
      false,
      expect.objectContaining({ id: "result-player" })
    );
  });

  test("restores persisted victory loot without rerolling after a full remount", () => {
    const snapshots = [];
    const firstView = renderCombat(
      { id: "persisted-victory-enemy", name: "Победная цель", hp: 20, maxHp: 20, effects: [] },
      { onCombatSnapshot: snapshot => snapshots.push(snapshot) }
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Победная цель" }), { key: "Enter" });
    const completedSnapshot = snapshots.at(-1);
    expect(completedSnapshot.battleResult).toEqual(expect.objectContaining({
      outcome: "victory",
      loot: [{ name: "Простая ткань" }, { name: "Простая ткань" }],
      isBoss: false,
    }));
    expect(combatUtils.__getCombatResultLootRolls()).toBe(1);
    firstView.unmount();

    combatUtils.__setCombatResultLoot([{ name: "Малое зелье здоровья" }]);
    const onVictory = jest.fn();
    renderCombat(
      { id: "fallback-enemy", name: "Не используется", hp: 20, maxHp: 20, effects: [] },
      { initialCombatSnapshot: completedSnapshot, onVictory }
    );

    expect(screen.getByRole("heading", { name: "Победа" })).toBeInTheDocument();
    expect(screen.getByText("Простая ткань")).toBeInTheDocument();
    expect(screen.queryByText("Малое зелье здоровья")).not.toBeInTheDocument();
    expect(combatUtils.__getCombatResultLootRolls()).toBe(1);
    const continueButton = screen.getByRole("button", { name: "Продолжить" });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);
    expect(onVictory).toHaveBeenCalledTimes(1);
    expect(onVictory).toHaveBeenCalledWith(
      [{ name: "Простая ткань" }, { name: "Простая ткань" }],
      false,
      expect.objectContaining({ id: "result-player" })
    );
  });

  test("migrates a legacy completed victory once and reuses the persisted result", () => {
    const legacySnapshot = {
      isBoss: false,
      state: {
        players: [{ ...player }],
        enemies: [{ id: "legacy-dead", name: "Победная цель", hp: 0, maxHp: 20, effects: [] }],
        log: ["Победа"],
        initiative: { playerReady: false },
      },
    };
    const migratedSnapshots = [];
    const firstView = renderCombat(
      { id: "fallback-enemy", name: "Не используется", hp: 20, maxHp: 20, effects: [] },
      { initialCombatSnapshot: legacySnapshot, onCombatSnapshot: snapshot => migratedSnapshots.push(snapshot) }
    );

    expect(screen.getByRole("heading", { name: "Победа" })).toBeInTheDocument();
    expect(combatUtils.__getCombatResultLootRolls()).toBe(1);
    const migratedSnapshot = migratedSnapshots.at(-1);
    expect(migratedSnapshot.battleResult?.loot).toEqual([
      { name: "Простая ткань" },
      { name: "Простая ткань" },
    ]);
    firstView.unmount();

    combatUtils.__setCombatResultLoot([{ name: "Малое зелье здоровья" }]);
    renderCombat(
      { id: "fallback-enemy-2", name: "Не используется", hp: 20, maxHp: 20, effects: [] },
      { initialCombatSnapshot: migratedSnapshot }
    );
    expect(screen.getByText("Простая ткань")).toBeInTheDocument();
    expect(combatUtils.__getCombatResultLootRolls()).toBe(1);
  });

  test("restores an unfinished combat without inventing a result", () => {
    const activeSnapshot = {
      isBoss: false,
      state: {
        players: [{ ...player }],
        enemies: [{ id: "active-enemy", name: "Активный враг", hp: 20, maxHp: 20, effects: [] }],
        log: ["Бой продолжается"],
        initiative: { playerReady: true },
      },
    };
    renderCombat(
      { id: "fallback-enemy", name: "Не используется", hp: 20, maxHp: 20, effects: [] },
      { initialCombatSnapshot: activeSnapshot }
    );

    expect(screen.queryByRole("heading", { name: "Победа" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Поражение" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Атака" })).toBeEnabled();
    expect(combatUtils.__getCombatResultLootRolls()).toBe(0);
  });

  test("renders the production loot payload shape after victory", () => {
    combatUtils.__setCombatResultLoot({
      silver: 25,
      items: [{ name: "Металлические обломки", quantity: 2 }],
    });
    renderCombat({ id: "production-loot-enemy", name: "Победная цель", hp: 20, maxHp: 20, effects: [] });

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Победная цель" }), { key: "Enter" });
    act(() => jest.runOnlyPendingTimers());

    expect(screen.getByRole("heading", { name: "Победа" })).toBeInTheDocument();
    expect(screen.getByText("Металлические обломки")).toBeInTheDocument();
    expect(document.querySelector('.combat-result-loot-item img')).toHaveAttribute('src', expect.stringContaining('/assets/items/materials/metal_fragments.webp'));
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeEnabled();
  });

  test("shows a reward-free Victory splash and automatically hands off its terminal result", () => {
    combatUtils.__setCombatResultLoot({ silver: 25, items: [{ name: "Простая ткань", quantity: 2 }] });
    const enemy = { id: "merged-loot-enemy", name: "Победная цель", hp: 20, maxHp: 20, effects: [] };
    const onSplashComplete = jest.fn();
    const view = renderCombat(enemy);
    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Победная цель" }), { key: "Enter" });
    act(() => jest.runOnlyPendingTimers());
    view.rerender(<UIProvider><CombatScreen player={player} enemies={[enemy]} onVictorySplashComplete={onSplashComplete} /></UIProvider>);
    const overlay = document.body.querySelector('.combat-result-overlay');
    const title = screen.getByRole("heading", { name: "Победа" });
    expect(overlay).toHaveClass('is-victory-splash');
    expect(title).toHaveClass('combat-victory-splash-title');
    expect(overlay.querySelector('.pending-loot-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Простая ткань')).not.toBeInTheDocument();
    expect(overlay.querySelector('.combat-result-panel')).not.toBeInTheDocument();
    expect(view.container.querySelector('.battlefield')).toHaveAttribute('inert');
    expect(overlay.querySelector('button')).not.toBeInTheDocument();
    expect(onSplashComplete).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1000));
    expect(onSplashComplete).toHaveBeenCalledTimes(1);
    expect(onSplashComplete).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'victory', id: expect.any(String) }));
  });

  test("restores a terminal defeat without resuming combat", () => {
    const snapshots = [];
    const firstView = renderCombat(
      { id: "reload-defeat-enemy", name: "Смертельный враг", hp: 20, maxHp: 20, effects: [] },
      { onCombatSnapshot: snapshot => snapshots.push(snapshot) }
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Смертельный враг" }), { key: "Enter" });
    act(() => jest.runOnlyPendingTimers());
    const terminalDefeat = snapshots.at(-1);
    expect(terminalDefeat.battleResult).toEqual({ outcome: "defeat" });
    firstView.unmount();

    renderCombat(
      { id: "fallback-enemy", name: "Не используется", hp: 20, maxHp: 20, effects: [] },
      { initialCombatSnapshot: terminalDefeat }
    );
    expect(screen.getByRole("heading", { name: "Поражение" })).toBeInTheDocument();
    expect(screen.getByLabelText("Герой").querySelector('[aria-label="Здоровье: 0/20"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Атака", hidden: true })).toHaveAttribute('aria-disabled', 'true');
  });
});
