import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import CombatScreen, { ACTION_DRAG_ACTIVATION_DISTANCE, getCombatAuxiliaryStates } from "./CombatScreen";
import { UIProvider } from "../contexts/UIContext";

jest.mock("../utils/combatUtils", () => {
  const actual = jest.requireActual("../utils/combatUtils");
  const presentation = jest.requireActual("../utils/combatPresentationEvents");
  return {
    ...actual,
    initCombatSession: (player, enemies) => ({
      state: {
        players: [{ ...player }],
        enemies: enemies.map(enemy => ({ ...enemy })),
        log: ["Бой начался!"],
        initiative: { playerReady: player.testPlayerReady !== false },
        testActionResolving: false,
      },
    }),
    performPlayerAction: session => {
      presentation.beginCombatPresentation(session);
      presentation.recordCombatPresentationEvent(session, {
        type: "actionStart",
        actor: session.state.players[0],
        action: session.state.players[0].abilities.find(ability => ability.basic),
      });
      session.state.initiative.playerReady = false;
      session.state.testActionResolving = true;
      return { session, turnConsumed: true };
    },
    processEnemyAI: session => {
      if (session.state.testActionResolving) session.state.initiative.playerReady = true;
      return { session };
    },
    checkBattleOutcome: () => ({ victory: false, defeat: false }),
  };
});

const enemy = { id: "action-state-enemy", name: "Манекен", hp: 100, maxHp: 100, effects: [] };
const createPlayer = testPlayerReady => ({
  id: "action-state-player",
  name: "Герой",
  hp: 100,
  maxHp: 100,
  effects: [],
  items: [],
  testPlayerReady,
  abilities: [
    {
      name: "Перезаряжаемая",
      cooldown: 4,
      currentCooldown: 3,
      description: "Накладывает Кровотечение на 2 хода.",
      descriptionParts: ["Накладывает ", { statusId: "bleed", text: "Кровотечение" }, " на 2 хода."],
    },
    { name: "Атака", artId: "attack", basic: true, cooldown: 0, currentCooldown: 0 },
  ],
});

const renderCombat = (ready, override = {}) => render(
  <UIProvider>
    <CombatScreen player={{ ...createPlayer(ready), ...override }} enemies={[enemy]} />
  </UIProvider>
);

const dispatchPointer = (target, type, properties) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.entries(properties).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
  act(() => target.dispatchEvent(event));
};

describe("CombatScreen action-state presentation", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("renders aggregated stacks, independent durations and unremovable resource badges", () => {
    const { container } = renderCombat(true, { effects: [
      { id: 'combat_rhythm', remainingTurns: 999 },
      { id: 'combat_rhythm', remainingTurns: 999 },
      { id: 'combat_rhythm', remainingTurns: 999 },
      { id: 'poison', remainingTurns: 1 },
      { id: 'poison', remainingTurns: 2 },
      { id: 'supplies', stacks: 2 },
    ] });
    const statuses = container.querySelectorAll('.player-party .status-icon');
    expect(statuses).toHaveLength(4);
    expect(container.querySelector('.player-party .status-overlay')).toHaveClass('status-overlay--player');
    expect(container.querySelectorAll('.status-stack-count')).toHaveLength(2);
    expect(container.querySelector('.status-stack-count')).toHaveTextContent('3');
    expect([...container.querySelectorAll('.status-turn-count')].map(node => node.textContent)).toEqual(['1', '2']);
    expect(container.querySelector('.status-icon--unremovable')).toHaveClass('status-icon--resource');
    expect(container.querySelector('.status-icon--unremovable')).toHaveAttribute('title', expect.stringContaining('Нельзя снять.'));
    expect(container.querySelector('.combined-health')).toBeInTheDocument();
    expect(container.querySelector('.compact-turn-meter')).toBeInTheDocument();
  });

  test("renders a runtime cooldown sweep without dimming an actionable panel", () => {
    const view = renderCombat(true);
    const { container } = view;
    const actionGrid = container.querySelector(".combat-action-grid");
    const cooldownAbility = screen.getByRole("button", { name: "Перезаряжаемая, Перезарядка: 3" });

    expect(actionGrid).not.toHaveClass("is-inactive");
    expect(cooldownAbility.querySelector(".ability-cooldown-mask"))
      .toHaveStyle("--cooldown-sweep: 0.75turn");
    expect(screen.getByRole("button", { name: "Атака" }).querySelector(".ability-cooldown-mask")).toBeNull();
    expect(cooldownAbility.querySelector('.ability-action-label')).toBeNull();
    expect(screen.getByRole('button', { name: 'Манекен' }).querySelector('.unit-name')).toBeNull();
  });

  test('active traps and temporary summons use separate collapsing regions', () => {
    const empty = renderCombat(true);
    expect(screen.queryByLabelText('Активные ловушки')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Временные призывы')).not.toBeInTheDocument();
    empty.unmount();

    const trap = renderCombat(true, { _armedTrap: { type: 'wolf_pit' } });
    expect(screen.getByLabelText('Активные ловушки')).toHaveTextContent('Ожидает');
    expect(screen.getByLabelText('Активные ловушки')).not.toHaveTextContent('Волчья яма');
    expect(screen.queryByLabelText('Временные призывы')).not.toBeInTheDocument();
    trap.unmount();

    renderCombat(true, { _armedTrap: { type: 'snake_trap' } });
    expect(screen.queryByLabelText('Активные ловушки')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Временные призывы')).toHaveTextContent('Ожидает');
    expect(screen.getByLabelText('Временные призывы')).not.toHaveTextContent('Змеиная ловушка');
    expect(getCombatAuxiliaryStates({ _armedTrap: { type: 'snake_trap' } }).temporarySummons).toHaveLength(1);
  });

  test("enemy cards do not keep a persistent selected-target border after target confirmation", () => {
    const { container } = renderCombat(true);
    const enemyCard = screen.getByRole("button", { name: "Манекен" }).closest(".combat-unit-card");
    expect(enemyCard).not.toHaveClass("is-selected");

    fireEvent.keyDown(screen.getByRole("button", { name: "Атака" }), { key: "Enter" });
    expect(enemyCard).toHaveClass("is-valid-target");

    fireEvent.click(screen.getByRole("button", { name: "Манекен" }));
    expect(enemyCard).not.toHaveClass("is-selected");
  });

  test("opens player combat details from a normal hero-card tap", () => {
    renderCombat(true);
    fireEvent.click(screen.getByRole("button", { name: "Герой" }));
    expect(screen.getByRole("dialog", { name: "Герой" })).toBeInTheDocument();
  });

  test("self-target keyboard selection takes precedence over player inspection", () => {
    renderCombat(true, { abilities: [{ name: "Самолечение", targeting: "self", cooldown: 0 }] });
    fireEvent.keyDown(screen.getByRole("button", { name: "Самолечение" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Герой" }));
    expect(screen.queryByRole("dialog", { name: "Герой" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Самолечение" })).toHaveAttribute('aria-disabled', 'true');
  });

  test("dims only action controls when the player is not ready without inventing cooldown", () => {
    const { container } = renderCombat(false);
    const actionGrid = container.querySelector(".combat-action-grid");
    const attack = screen.getByRole("button", { name: "Атака" });
    const logButton = screen.getByRole("button", { name: "Открыть лог боя" });

    expect(actionGrid).toHaveClass("is-inactive");
    expect(attack).toHaveAttribute('aria-disabled', 'true');
    expect(attack.querySelector(".ability-cooldown-mask")).toBeNull();
    expect(logButton).toBeEnabled();
    expect(logButton.closest(".combat-action-grid")).toBeNull();
    expect(container.querySelector('.ability-info-button')).toBeNull();
    expect(container.querySelector('.unit-info-button')).toBeNull();
  });

  test("opens and closes the enemy detail card through the existing inspector control", () => {
    renderCombat(true);
    fireEvent.click(screen.getByRole("button", { name: "Манекен" }));
    expect(screen.getByRole("dialog", { name: "Манекен" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть сведения о враге" }));
    expect(screen.queryByRole("dialog", { name: "Манекен" })).not.toBeInTheDocument();
  });

  test("ability info reuses bracketed interactive status references", () => {
    renderCombat(true);
    fireEvent.click(screen.getByRole('button', { name: 'Перезаряжаемая, Перезарядка: 3' }));
    const status = screen.getByRole("button", { name: "[Кровотечение]" });
    fireEvent.click(status);
    expect(screen.getByRole("dialog", { name: "Статус: Кровотечение" }))
      .toHaveTextContent("0,75 + 0,25 × оставшиеся ходы");
    expect(screen.getByText("Накладывает", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Накладывает [Кровотечение] на 2 хода.", { exact: true }))
      .not.toBeInTheDocument();
  });

  test("starts the canonical drag from ability artwork only after the five-pixel threshold", () => {
    const { container } = renderCombat(true);
    const attack = screen.getByRole("button", { name: "Атака" });
    const art = attack.querySelector(".ability-action-art");
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = jest.fn(() => null);

    expect(ACTION_DRAG_ACTIVATION_DISTANCE).toBe(5);
    expect(art).toHaveAttribute("draggable", "false");
    dispatchPointer(art, "pointerdown", { pointerId: 7, button: 0, clientX: 20, clientY: 20 });
    dispatchPointer(window, "pointermove", { pointerId: 7, clientX: 22, clientY: 22 });
    expect(container.querySelector(".action-drag-ghost")).toBeNull();
    dispatchPointer(window, "pointermove", { pointerId: 7, clientX: 26, clientY: 20 });
    expect(container.querySelector(".action-drag-ghost")).toBeInTheDocument();
    expect(attack).toHaveClass("is-dragging");
    dispatchPointer(window, "pointerup", { pointerId: 7, clientX: 26, clientY: 20 });

    document.elementFromPoint = elementFromPoint;
  });

  test("the tile background and cooldown layer leave drag ownership on the ability button", () => {
    const { container } = renderCombat(true);
    const attack = screen.getByRole("button", { name: "Атака" });
    const cooldown = screen.getByRole("button", { name: "Перезаряжаемая, Перезарядка: 3" })
      .querySelector(".ability-cooldown-mask");
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = jest.fn(() => null);

    dispatchPointer(attack, "pointerdown", { pointerId: 8, button: 0, clientX: 4, clientY: 4 });
    dispatchPointer(window, "pointermove", { pointerId: 8, clientX: 10, clientY: 4 });
    expect(container.querySelector(".action-drag-ghost")).toBeInTheDocument();
    expect(cooldown).toHaveAttribute("aria-hidden", "true");
    dispatchPointer(window, "pointerup", { pointerId: 8, clientX: 10, clientY: 4 });

    document.elementFromPoint = elementFromPoint;
  });

  test("tap opens details while a real drag does not also open details", () => {
    const view = renderCombat(true);
    const { container } = view;
    const attack = screen.getByRole("button", { name: "Атака" });
    const art = attack.querySelector(".ability-action-art");
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = jest.fn(() => null);

    expect(fireEvent.dragStart(art)).toBe(false);
    dispatchPointer(attack, "pointerdown", { pointerId: 9, button: 0, clientX: 10, clientY: 10 });
    dispatchPointer(window, "pointermove", { pointerId: 9, clientX: 30, clientY: 10 });
    expect(container.querySelector(".action-drag-ghost")).toBeInTheDocument();
    dispatchPointer(window, "pointerup", { pointerId: 9, clientX: 30, clientY: 10 });
    expect(screen.queryByRole("heading", { name: "Атака" })).not.toBeInTheDocument();
    view.unmount();
    renderCombat(true);
    fireEvent.click(screen.getByRole("button", { name: "Атака" }));
    expect(screen.getByRole("heading", { name: "Атака" })).toBeInTheDocument();
    document.elementFromPoint = elementFromPoint;
  });

  test("occupied and empty quick slots open the visual three-column picker while picker info does not assign", () => {
    const occupied = renderCombat(true, { items: [
      { name: 'Малое зелье здоровья' },
      { name: 'Малое зелье здоровья' },
      { name: 'Малое зелье щита' },
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать быстрый предмет' }));
    const heading = screen.getByRole('heading', { name: 'Выберите предмет' });
    const picker = heading.closest('div');
    expect(picker.querySelector('.combat-quick-item-picker')).toHaveAttribute('data-columns', '3');
    expect(picker.querySelector('.combat-quick-item-picker__name')).toBeNull();
    expect(screen.queryByText(/Предметы \(\d+\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Выбор не расходует предмет/)).not.toBeInTheDocument();
    expect(screen.getByText('2')).toHaveClass('item-icon-quantity');
    expect(screen.getByRole('button', { name: 'Подробнее: Малое зелье щита' })).toHaveClass('item-icon-info');
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Малое зелье щита' }));
    expect(screen.getByRole('dialog', { name: 'Предмет: Малое зелье щита' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выбрать быстрый предмет' })).toBeInTheDocument();
    occupied.unmount();

    renderCombat(true, { items: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать быстрый предмет' }));
    expect(screen.getByText('Нет предметов, доступных в бою.')).toBeInTheDocument();
  });

  test("active equipment appears in the item-action picker without a consumable quantity", () => {
    renderCombat(true, {
      items: [],
      equipment: { ring1: 'Печатка Всецаря' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать быстрый предмет' }));
    const assign = screen.getByRole('button', { name: 'Назначить: Печатка Всецаря' });
    expect(assign.querySelector('.item-icon-quantity')).toBeNull();

    fireEvent.click(assign);
    expect(screen.getByRole('button', { name: 'Активная экипировка: Печатка Всецаря' })).toBeInTheDocument();
  });

  test("quick-item drag suppresses the picker and main picker tile assigns without consuming", () => {
    const { container } = renderCombat(true, { items: [
      { name: 'Малое зелье здоровья' }, { name: 'Малое зелье щита' },
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать быстрый предмет' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Малое зелье здоровья/ }).find(button => button.classList.contains('combat-quick-item-picker__select')));
    let quick = screen.getByRole('button', { name: /Быстрый предмет: Малое зелье здоровья/ });
    expect(quick).not.toHaveTextContent('Малое зелье здоровья');
    fireEvent.click(quick);
    fireEvent.click(screen.getAllByRole('button', { name: /Малое зелье щита/ }).find(button => button.classList.contains('combat-quick-item-picker__select')));
    quick = screen.getByRole('button', { name: /Быстрый предмет: Малое зелье щита, 1 шт/ });
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = jest.fn(() => null);
    dispatchPointer(quick, 'pointerdown', { pointerId: 17, button: 0, clientX: 10, clientY: 10 });
    dispatchPointer(window, 'pointermove', { pointerId: 17, clientX: 30, clientY: 10 });
    expect(container.querySelector('.action-drag-ghost')).toBeInTheDocument();
    dispatchPointer(window, 'pointerup', { pointerId: 17, clientX: 30, clientY: 10 });
    fireEvent.click(quick);
    expect(screen.queryByRole('heading', { name: 'Выберите предмет' })).not.toBeInTheDocument();
    document.elementFromPoint = elementFromPoint;

    expect(screen.getByRole('button', { name: /Быстрый предмет: Малое зелье щита, 1 шт/ })).toBeInTheDocument();
  });

  test("player actions use the shared focus and directional anticipation without enemy action chrome", () => {
    jest.useFakeTimers();
    const { container } = renderCombat(true);
    const attack = screen.getByRole("button", { name: "Атака" });

    fireEvent.keyDown(attack, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Манекен" }), { key: "Enter" });

    const playerCard = container.querySelector(".player-party .combat-unit-card");
    expect(playerCard.querySelector(".combat-actor-focus.is-player")).toBeInTheDocument();
    expect(playerCard.querySelector(".combat-enemy-action-icon")).toBeNull();
    act(() => jest.runOnlyPendingTimers());
  });

  test("presentation lock dims ready actions without adding a fake cooldown", () => {
    jest.useFakeTimers();
    const { container } = renderCombat(true);
    const attack = screen.getByRole("button", { name: "Атака" });

    fireEvent.keyDown(attack, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Манекен" }), { key: "Enter" });

    expect(container.querySelector(".combat-action-grid")).toHaveClass("is-inactive");
    expect(attack.querySelector(".ability-cooldown-mask")).toBeNull();
    act(() => jest.runOnlyPendingTimers());
    expect(container.querySelector(".combat-action-grid")).not.toHaveClass("is-inactive");
  });
});
