import React, { act, useCallback, useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { acceptCombatSnapshot, getCombatSnapshotState, prepareCombatLootResolution, validateCombatInput } from "./App";
import CombatScreen from "./components/CombatScreen";
import CombatLootScreen from "./components/CombatLootScreen";
import { UIProvider } from "./contexts/UIContext";
import * as combatUtils from "./utils/combatUtils";
import { createPendingLoot } from "./utils/pendingLoot";

// The loot screen gates its reward icons behind an art preload with a bounded
// timeout. This suite covers the combat lifecycle, not image loading, so the
// gate resolves immediately and the assertions never depend on timer ticks.
jest.mock("./components/LootArtworkGate", () => ({
  __esModule: true,
  default: ({ children }) => children,
}));

jest.mock("./utils/combatUtils", () => {
  const actual = jest.requireActual("./utils/combatUtils");
  const presentation = jest.requireActual("./utils/combatPresentationEvents");
  let mode = "victory";
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
      if (mode === "victory") {
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
      if (mode !== "defeat" || session.state.initiative.playerReady !== false) return { session };
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
    rollLootForEnemies: () => ({ silver: 25, items: [{ name: "Простая ткань", quantity: 2 }, { name: "Крепкая древесина", quantity: 1 }] }),
    __setAppLifecycleMode: nextMode => { mode = nextMode; },
  };
});

const player = {
  id: "app-player",
  name: "Герой",
  hp: 20,
  maxHp: 20,
  effects: [],
  items: [],
  abilities: [{ name: "Атака", basic: true, currentCooldown: 0 }],
};
const enemy = { id: "app-enemy", name: "Обычный враг", hp: 20, maxHp: 20, effects: [] };
const createInitialSnapshot = () => ({
  isBoss: false,
  state: {
    players: [{ ...player }],
    enemies: [{ ...enemy }],
    log: ["Бой продолжается"],
    initiative: { playerReady: true },
  },
});

const CombatLifecycleHarness = ({ onVictory, onDefeat, transitions }) => {
  const [currentScreen, setCurrentScreen] = useState("combat");
  const [activeCombat, setActiveCombat] = useState(createInitialSnapshot);
  const [pendingCombat, setPendingCombat] = useState(null);
  const [pendingLoot, setPendingLoot] = useState(null);
  const [inventoryPlayer, setInventoryPlayer] = useState({
    ...player,
    equipment: {},
    runInventory: [
      ...Array.from({ length: 8 }, (_, index) => ({ itemId: `occupied-${index}`, quantity: 1 })),
      null,
      null,
    ],
  });
  const [runSilver, setRunSilver] = useState(0);
  const pendingCombatRef = useRef(null);
  const validation = validateCombatInput({
    player,
    pendingCombat,
    pendingCombatRefValue: pendingCombatRef.current,
    activeCombat,
  });
  transitions.push({
    currentScreen,
    activeCombat: getCombatSnapshotState(activeCombat),
    pendingCombat: Boolean(pendingCombat),
    isValid: validation.isValid,
    battleResult: activeCombat?.battleResult?.outcome || null,
  });
  const acceptSnapshot = useCallback(snapshot => {
    let accepted = snapshot;
    if (snapshot?.battleResult?.outcome === 'victory') {
      const reward = snapshot.battleResult.pendingLoot || pendingLoot || { ...createPendingLoot({ id: snapshot.battleResult.id, source: 'combat', loot: snapshot.battleResult.loot }), silverClaimed: true };
      if (!pendingLoot) setRunSilver(value => value + reward.silver);
      setPendingLoot(reward);
      accepted = { ...snapshot, battleResult: { ...snapshot.battleResult, pendingLoot: reward } };
    }
    acceptCombatSnapshot({
    snapshot: accepted,
    pendingCombatRef,
    setPendingCombat,
    setActiveCombat,
    });
  }, [pendingLoot]);
  const clearSnapshot = useCallback(() => setActiveCombat(null), []);
  const continueVictory = (...args) => {
    onVictory(...args);
    setActiveCombat(null);
    setCurrentScreen("dungeon");
  };
  const continueDefeat = () => {
    onDefeat();
    setActiveCombat(null);
    setCurrentScreen("guild");
  };

  return (
    <div data-testid="app-route" data-screen={currentScreen} data-combat-valid={String(validation.isValid)} data-run-silver={runSilver}>
      {currentScreen === "combat" && validation.isValid ? (
        <CombatScreen
          player={player}
          enemies={validation.enemies}
          initialCombatSnapshot={validation.initialCombatSnapshot}
          onCombatSnapshot={acceptSnapshot}
          onClearCombatSnapshot={clearSnapshot}
          onVictory={continueVictory}
          onDefeat={continueDefeat}
          combatPendingLoot={pendingLoot}
          inventoryPlayer={inventoryPlayer}
          onChangeCombatPendingLoot={next => { setPendingLoot(next); setActiveCombat(prev => ({ ...prev, battleResult: { ...prev.battleResult, pendingLoot: next } })); }}
          onResolveCombatPendingLoot={result => {
            const committed = prepareCombatLootResolution(pendingLoot, inventoryPlayer);
            if (!committed.committed) return;
            setInventoryPlayer(prev => ({ ...prev, runInventory: committed.slots }));
            setPendingLoot(null);
            continueVictory(result.loot, result.isBoss, result.playerState);
          }}
          onVictorySplashComplete={() => setCurrentScreen('combatLoot')}
        />
      ) : currentScreen === 'combatLoot' && pendingLoot ? (
        <CombatLootScreen
          pendingLoot={pendingLoot}
          player={inventoryPlayer}
          onChange={setPendingLoot}
          onResolve={() => {
            const committed = prepareCombatLootResolution(pendingLoot, inventoryPlayer);
            if (!committed.committed) return;
            setInventoryPlayer(prev => ({ ...prev, runInventory: committed.slots }));
            setPendingLoot(null);
            continueVictory(activeCombat.battleResult.loot, activeCombat.battleResult.isBoss, activeCombat.battleResult.playerState);
          }}
          onOpenInventory={jest.fn()}
          onInfo={jest.fn()}
        />
      ) : currentScreen === "combat" ? <div>EMPTY COMBAT ROUTE</div> : <div>{currentScreen}</div>}
    </div>
  );
};

describe("App terminal combat lifecycle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runAllTimers());
    jest.useRealTimers();
  });

  test.each([
    ["victory", "Победа", "dungeon"],
    ["defeat", "Поражение", "guild"],
  ])("keeps ordinary %s combat mounted until Continue", (mode, title, destination) => {
    combatUtils.__setAppLifecycleMode(mode);
    const transitions = [];
    const onVictory = jest.fn();
    const onDefeat = jest.fn();
    const { container } = render(
      <UIProvider>
        <CombatLifecycleHarness onVictory={onVictory} onDefeat={onDefeat} transitions={transitions} />
      </UIProvider>
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Обычный враг" }), { key: "Enter" });
    act(() => jest.runOnlyPendingTimers());

    expect(screen.queryByText("EMPTY COMBAT ROUTE")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-route")).toHaveAttribute("data-screen", "combat");
    expect(screen.getByTestId("app-route")).toHaveAttribute("data-combat-valid", "true");
    expect(container.querySelector(".battle-screen")).toBeInTheDocument();
    expect(document.body.querySelector(".combat-result-overlay")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(onVictory).not.toHaveBeenCalled();
    expect(onDefeat).not.toHaveBeenCalled();
    expect(transitions.at(-1)).toMatchObject({
      currentScreen: "combat",
      activeCombat: `terminal-${mode}`,
      isValid: true,
      battleResult: mode,
    });

    if (mode === 'victory') {
      expect(screen.getByTestId('app-route')).toHaveAttribute('data-run-silver', '25');
      expect(screen.queryByText('Простая ткань')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Продолжить' })).not.toBeInTheDocument();
      act(() => jest.advanceTimersByTime(1000));
      expect(screen.getByTestId('app-route')).toHaveAttribute('data-screen', 'combatLoot');
      expect(container.querySelector('.battle-screen')).not.toBeInTheDocument();
      screen.getAllByRole('button', { pressed: false }).forEach(button => fireEvent.click(button));
    }
    const continueButton = screen.getByRole("button", { name: mode === 'victory' ? "Забрать и продолжить" : "Продолжить" });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);
    expect(mode === "victory" ? onVictory : onDefeat).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("app-route")).toHaveAttribute("data-screen", destination);
    expect(container.querySelector(".battle-screen")).not.toBeInTheDocument();
  });

  test("abandon confirmation resolves combat victory immediately without a reload", () => {
    combatUtils.__setAppLifecycleMode("victory");
    const onVictory = jest.fn();
    render(<UIProvider><CombatLifecycleHarness onVictory={onVictory} onDefeat={jest.fn()} transitions={[]} /></UIProvider>);
    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Обычный враг" }), { key: "Enter" });
    act(() => jest.runOnlyPendingTimers());
    act(() => jest.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole("button", { name: "Забрать и продолжить" }));
    expect(screen.getByText("Оставить невыбранную добычу?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Оставить" }));
    expect(onVictory).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("app-route")).toHaveAttribute("data-screen", "dungeon");
    expect(document.body.querySelector(".combat-result-overlay")).not.toBeInTheDocument();
  });

  test("capacity rejection leaves combat loot resolution retryable", () => {
    const reward = createPendingLoot({ id: "capacity", source: "combat", loot: { items: [{ name: "Простая ткань" }] } });
    reward.selectedIds = [reward.items[0].id];
    const fullPlayer = { equipment: {}, runInventoryLayoutVersion: 2, runInventory: Array.from({ length: 26 }, (_, index) => ({ itemId: `full-${index}`, quantity: 1 })) };
    expect(prepareCombatLootResolution(reward, fullPlayer).committed).toBe(false);
    const retryPlayer = { ...fullPlayer, runInventory: [...fullPlayer.runInventory.slice(0, 25), null] };
    expect(prepareCombatLootResolution(reward, retryPlayer).committed).toBe(true);
  });
});



test('snapshot validation uses engine outcome rules for combat objects and surviving allies', () => {
  const snapshot = {
    state: { players: [{ hp: 0 }, { hp: 10, summoned: true }], enemies: [{ hp: 20 }] },
  };
  expect(getCombatSnapshotState(snapshot)).toBe('active');
  snapshot.state.enemies = [{ hp: 0 }, { hp: 1, nonBlocking: true, nonActingCombatObject: true }];
  snapshot.battleResult = { outcome: 'victory', loot: { silver: 0, items: [] } };
  expect(getCombatSnapshotState(snapshot)).toBe('terminal-victory');
});
