import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import GuildScreen from './GuildScreen';
import { UIProvider } from '../contexts/UIContext';
import { GAMEPLAY_DRAG_ACTIVATION_DISTANCE, TOUCH_DRAG_HOLD_MS, TOUCH_DRAG_MOVE_TOLERANCE } from '../constants/interaction';

const basePlayer = { name: 'Герой', class: 'Defender', equipment: {}, runInventory: Array(26).fill(null), questLog: {}, relics: {}, silver: 0 };
const pointer = (target, type, x, y, pointerType = 'mouse', pointerId = 1) => {
  const event = new Event(type.toLowerCase(), { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, pointerType: { value: pointerType }, button: { value: 0 },
    clientX: { value: x }, clientY: { value: y },
  });
  fireEvent(target, event);
};

const setup = runInventory => {
  const onUpdatePlayer = jest.fn();
  render(<UIProvider><GuildScreen player={{ ...basePlayer, runInventory }} storageItems={[]} onUpdatePlayer={onUpdatePlayer} /></UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  return { onUpdatePlayer, slots: () => screen.getAllByTestId('backpack-slot'), slot: index => document.querySelector(`[data-slot-index="${index}"]`) };
};

const drag = (source, target, pointerType = 'mouse', pointerId = 1) => {
  document.elementFromPoint.mockReturnValue(target);
  pointer(source, 'pointerDown', 10, 10, pointerType, pointerId);
  if (pointerType === 'touch') act(() => jest.advanceTimersByTime(TOUCH_DRAG_HOLD_MS));
  pointer(window, 'pointerMove', 10 + GAMEPLAY_DRAG_ACTIVATION_DISTANCE + 2, 20, pointerType, pointerId);
  pointer(window, 'pointerUp', 30, 30, pointerType, pointerId);
};

describe('Guild Backpack pointer drag and drop', () => {
  beforeEach(() => { document.elementFromPoint = jest.fn(() => null); });
  afterEach(() => { delete document.elementFromPoint; jest.useRealTimers(); });

  test('occupied slots move to empty valid slots, including empty Safe targets, using runInventory only', () => {
    const inventory = Array(26).fill(null); inventory[14] = { itemId: 'Простая ткань', quantity: 1 };
    const { onUpdatePlayer, slot } = setup(inventory);
    expect(slot(0)).toHaveClass('is-empty');
    drag(slot(14), slot(0));
    const updated = onUpdatePlayer.mock.calls[0][0];
    expect(updated.runInventory[0]).toMatchObject({ itemId: 'Простая ткань', quantity: 1 });
    expect(updated.runInventory[14]).toBeNull();
    expect(updated).not.toHaveProperty('inventory');
  });

  test('valid occupied stacks swap and compatible stacks merge through canonical movement', () => {
    const swapInventory = Array(26).fill(null);
    swapInventory[2] = { itemId: 'Куртка Мародёра', quantity: 1 };
    swapInventory[3] = { itemId: 'Капюшон Искателя Знаков', quantity: 1 };
    let view = setup(swapInventory);
    drag(view.slot(2), view.slot(3));
    expect(view.onUpdatePlayer.mock.calls[0][0].runInventory.slice(2, 4)).toEqual([swapInventory[3], swapInventory[2]]);

    cleanup();
    view = setup(Object.assign(Array(26).fill(null), { 14: { itemId: 'Простая ткань', quantity: 2 }, 15: { itemId: 'Простая ткань', quantity: 3 } }));
    drag(view.slot(14), view.slot(15), 'pen', 2);
    expect(view.onUpdatePlayer.mock.calls[0][0].runInventory[15]).toMatchObject({ itemId: 'Простая ткань', quantity: 5 });
    expect(view.onUpdatePlayer.mock.calls[0][0].runInventory[14]).toBeNull();
  });

  test('invalid cross-type moves are no-ops across all typed Backpack sections', () => {
    const inventory = Array(26).fill(null); inventory[14] = { itemId: 'Простая ткань', quantity: 1 };
    const { onUpdatePlayer, slot } = setup(inventory);
    expect(slot(20)).toHaveAttribute('data-slot-index', '20');
    drag(slot(14), slot(12));
    expect(onUpdatePlayer).not.toHaveBeenCalled();
  });

  test('normal pointer tap and keyboard activation still open details', () => {
    const inventory = Array(26).fill(null); inventory[14] = { itemId: 'Простая ткань', quantity: 1 };
    const { slot } = setup(inventory);
    pointer(slot(14), 'pointerDown', 10, 10); pointer(window, 'pointerUp', 10, 10); fireEvent.click(slot(14));
    expect(screen.getByRole('dialog', { name: 'Предмет: Простая ткань' })).toBeInTheDocument();
  });

  test('post-drag synthetic click is suppressed', () => {
    const inventory = Array(26).fill(null); inventory[14] = { itemId: 'Простая ткань', quantity: 1 };
    const { slot } = setup(inventory);
    drag(slot(14), slot(15)); fireEvent.click(slot(14));
    expect(screen.queryByRole('dialog', { name: /Предмет:/ })).not.toBeInTheDocument();
  });

  test('selection mode disables dragging and keeps tap selection', () => {
    const inventory = Array(26).fill(null); inventory[14] = { itemId: 'Простая ткань', quantity: 1 };
    const { onUpdatePlayer, slot } = setup(inventory);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }));
    drag(slot(14), slot(15));
    expect(onUpdatePlayer).not.toHaveBeenCalled();
    fireEvent.click(slot(14)); expect(slot(14)).toHaveClass('is-selected');
  });

  test('touch requires its hold and movement beyond tolerance first remains scroll intent', () => {
    jest.useFakeTimers();
    const inventory = Array(26).fill(null); inventory[14] = { itemId: 'Простая ткань', quantity: 1 };
    const { onUpdatePlayer, slot } = setup(inventory);
    document.elementFromPoint.mockReturnValue(slot(15));
    pointer(slot(14), 'pointerDown', 10, 10, 'touch');
    act(() => jest.advanceTimersByTime(TOUCH_DRAG_HOLD_MS - 1));
    expect(slot(14)).not.toHaveClass('is-dragging');
    pointer(window, 'pointerMove', 10, 10 + TOUCH_DRAG_MOVE_TOLERANCE + 1, 'touch');
    act(() => jest.advanceTimersByTime(TOUCH_DRAG_HOLD_MS * 2));
    expect(slot(14)).not.toHaveClass('is-dragging');
    pointer(window, 'pointerUp', 10, 30, 'touch');
    expect(onUpdatePlayer).not.toHaveBeenCalled();
  });

  test.each(['mouse', 'pen'])('%s activates at the immediate gameplay movement threshold', pointerType => {
    const inventory = Array(26).fill(null); inventory[14] = { itemId: 'Простая ткань', quantity: 1 };
    const { slot } = setup(inventory);
    pointer(slot(14), 'pointerDown', 10, 10, pointerType);
    pointer(window, 'pointerMove', 10 + GAMEPLAY_DRAG_ACTIVATION_DISTANCE, 10, pointerType);
    expect(slot(14)).toHaveClass('is-dragging');
    expect(document.querySelector('.guild-backpack-drag-ghost')).toBeInTheDocument();
    pointer(window, 'pointerCancel', 15, 10, pointerType);
  });
});
