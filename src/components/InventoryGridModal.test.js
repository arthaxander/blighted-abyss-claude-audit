import React, { act, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import InventoryGridModal, { TOUCH_DRAG_HOLD_MS, TOUCH_DRAG_MOVE_TOLERANCE } from './InventoryGridModal';
import { createItemStack, normalizeInventorySlots, SAFE_SLOT_COUNT } from '../utils/expeditionInventory';
import { EQUIPMENT_SLOT_KEYS } from '../utils/equipmentManager';
import { equipmentByName } from '../data/equipment';
import { GAMEPLAY_DRAG_ACTIVATION_DISTANCE } from '../constants/interaction';
import { resolveItemArt } from '../data/itemArt';
import { buildPlayerSnapshot, hydratePlayerSnapshot } from '../utils/playerState';

describe('InventoryGridModal', () => {
  let elementFromPoint;
  beforeEach(() => { elementFromPoint = jest.fn(() => null); document.elementFromPoint = elementFromPoint; });
  afterEach(() => { delete document.elementFromPoint; });
  const player = { runInventory: normalizeInventorySlots([{ itemId: 'Простая ткань', quantity: 8 }, { itemId: 'Простая ткань', quantity: 17 }, { itemId: 'Эссенция Проклятий', quantity: 1 }], 10) };
  test('shows authoritative current-expedition resonance', () => {
    render(<InventoryGridModal player={{ ...player, runResonance: 47 }} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('Резонанс Бездны: 47')).toBeInTheDocument();
  });
  const pointer = (target, type, x, y, pointerId = 1, pointerType = 'mouse') => {
    const event = new Event(type.toLowerCase(), { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: pointerId }, clientX: { value: x }, clientY: { value: y },
      button: { value: 0 }, pointerType: { value: pointerType }
    });
    fireEvent(target, event);
  };
  const touchPointer = (target, type, x, y, pointerId = 1) => pointer(target, type, x, y, pointerId, 'touch');

  describe('touch hold gesture arbitration', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('quick tap opens details once without activating drag', () => {
      render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const source = document.querySelector('[data-slot-index="0"]');
      touchPointer(source, 'pointerDown', 10, 10);
      act(() => jest.advanceTimersByTime(TOUCH_DRAG_HOLD_MS - 1));
      expect(document.querySelector('.inventory-drag-ghost')).not.toBeInTheDocument();
      touchPointer(window, 'pointerUp', 10, 10);
      fireEvent.click(source);
      expect(screen.getByRole('dialog', { name: 'Предмет: Простая ткань' })).toBeInTheDocument();
    });

    test('stationary hold and sub-tolerance jitter pick up immediately at the current point', () => {
      render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const source = document.querySelector('[data-slot-index="0"]');
      touchPointer(source, 'pointerDown', 10, 10);
      touchPointer(window, 'pointerMove', 10 + TOUCH_DRAG_MOVE_TOLERANCE - 1, 10);
      act(() => jest.advanceTimersByTime(TOUCH_DRAG_HOLD_MS));
      expect(source).toHaveClass('is-dragging');
      expect(document.querySelector('.inventory-drag-ghost')).toHaveStyle({ left: '17px', top: '10px' });
      const nativeMove = new Event('touchmove', { bubbles: true, cancelable: true });
      window.dispatchEvent(nativeMove);
      expect(nativeMove.defaultPrevented).toBe(true);
      touchPointer(window, 'pointerCancel', 17, 10);
    });

    test('movement beyond tolerance becomes scroll permanently and cannot open details', () => {
      render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const source = document.querySelector('[data-slot-index="0"]');
      touchPointer(source, 'pointerDown', 10, 10);
      touchPointer(window, 'pointerMove', 10 + TOUCH_DRAG_MOVE_TOLERANCE + 1, 10);
      const nativeMove = new Event('touchmove', { bubbles: true, cancelable: true });
      window.dispatchEvent(nativeMove);
      expect(nativeMove.defaultPrevented).toBe(false);
      act(() => jest.advanceTimersByTime(TOUCH_DRAG_HOLD_MS * 2));
      expect(document.querySelector('.inventory-drag-ghost')).not.toBeInTheDocument();
      touchPointer(window, 'pointerUp', 19, 10);
      fireEvent.click(source);
      expect(screen.queryByRole('dialog', { name: /^Предмет:/ })).not.toBeInTheDocument();
    });

    test.each([['before', 0], ['after', TOUCH_DRAG_HOLD_MS]])('pointercancel %s hold cancels without mutation or details', (_label, elapsed) => {
      const onChangeSlots = jest.fn();
      render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
      const source = document.querySelector('[data-slot-index="0"]');
      touchPointer(source, 'pointerDown', 10, 10);
      act(() => jest.advanceTimersByTime(elapsed));
      touchPointer(window, 'pointerCancel', 10, 10);
      act(() => jest.runOnlyPendingTimers());
      fireEvent.click(source);
      expect(document.querySelector('.inventory-drag-ghost')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: /^Предмет:/ })).not.toBeInTheDocument();
      expect(onChangeSlots).not.toHaveBeenCalled();
    });

    test('held drop preserves same/invalid slots and moves to a legal destination', () => {
      const onChangeSlots = jest.fn();
      render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
      const source = document.querySelector('[data-slot-index="0"]');
      const target = document.querySelector('[data-slot-index="4"]');
      for (const [pointerId, destination] of [[1, source], [2, null], [3, target]]) {
        elementFromPoint.mockReturnValue(destination);
        touchPointer(source, 'pointerDown', 10, 10, pointerId);
        act(() => jest.advanceTimersByTime(TOUCH_DRAG_HOLD_MS));
        touchPointer(window, 'pointerUp', 20, 20, pointerId);
      }
      expect(onChangeSlots).toHaveBeenCalledTimes(1);
      expect(onChangeSlots.mock.calls[0][0][4]).toMatchObject({ itemId: 'Простая ткань', quantity: 8 });
      fireEvent.click(source);
      expect(screen.queryByRole('dialog', { name: /^Предмет:/ })).not.toBeInTheDocument();
    });

    test('lost capture and unmount clear pending hold timers', () => {
      const view = render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const source = document.querySelector('[data-slot-index="0"]');
      touchPointer(source, 'pointerDown', 10, 10);
      touchPointer(source, 'lostPointerCapture', 10, 10);
      act(() => jest.runOnlyPendingTimers());
      expect(document.querySelector('.inventory-drag-ghost')).not.toBeInTheDocument();
      touchPointer(source, 'pointerDown', 10, 10, 2);
      view.unmount();
      expect(jest.getTimerCount()).toBe(0);
    });
  });
  const mockScrollablePanel = (panel, { scrollTop = 0, clientHeight = 200, scrollHeight = 600, headerBottom = 52 } = {}) => {
    Object.defineProperties(panel, {
      scrollTop: { value: scrollTop, writable: true, configurable: true },
      clientHeight: { value: clientHeight, configurable: true },
      scrollHeight: { value: scrollHeight, configurable: true },
    });
    panel.getBoundingClientRect = jest.fn(() => ({ top: 0, bottom: clientHeight, left: 0, right: 320, width: 320, height: clientHeight }));
    panel.querySelector('.inventory-grid-header').getBoundingClientRect = jest.fn(() => ({ top: 0, bottom: headerBottom, left: 0, right: 320, width: 320, height: headerBottom }));
  };
  describe('drag edge auto-scroll', () => {
    let frames;
    let nextFrame;
    beforeEach(() => {
      frames = new Map(); nextFrame = 1;
      window.requestAnimationFrame = jest.fn(callback => { const id = nextFrame++; frames.set(id, callback); return id; });
      window.cancelAnimationFrame = jest.fn(id => frames.delete(id));
    });
    afterEach(() => {
      delete window.requestAnimationFrame;
      delete window.cancelAnimationFrame;
    });
    const runFrame = () => {
      const entry = frames.entries().next().value;
      if (!entry) return;
      frames.delete(entry[0]);
      act(() => entry[1](performance.now()));
    };
    const beginDrag = (source, y = 100, pointerId = 1) => {
      pointer(source, 'pointerDown', 20, y, pointerId);
      pointer(window, 'pointerMove', 20 + GAMEPLAY_DRAG_ACTIVATION_DISTANCE, y, pointerId);
    };

    test('zones appear only after activation and reflect the authoritative panel scroll bounds', () => {
      render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const panel = document.querySelector('.inventory-grid-panel');
      const source = document.querySelector('[data-slot-index="0"]');
      mockScrollablePanel(panel);
      expect(document.querySelectorAll('.inventory-edge-scroll-zone')).toHaveLength(0);
      pointer(source, 'pointerDown', 20, 100);
      pointer(window, 'pointerMove', 23, 100);
      expect(document.querySelectorAll('.inventory-edge-scroll-zone')).toHaveLength(0);
      pointer(window, 'pointerMove', 25, 126);
      expect(document.querySelector('.inventory-edge-scroll-zone--top')).not.toBeInTheDocument();
      expect(document.querySelector('.inventory-edge-scroll-zone--bottom')).toBeInTheDocument();
      panel.scrollTop = 400;
      fireEvent.scroll(panel);
      expect(document.querySelector('.inventory-edge-scroll-zone--top')).toHaveStyle({ top: '52px' });
      expect(document.querySelector('.inventory-edge-scroll-zone--bottom')).not.toBeInTheDocument();
      pointer(window, 'pointerCancel', 25, 100);
      expect(document.querySelectorAll('.inventory-edge-scroll-zone')).toHaveLength(0);
    });

    test('sticky header is excluded from top activation while the zone immediately below it scrolls upward', () => {
      const onChangeSlots = jest.fn();
      render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
      const panel = document.querySelector('.inventory-grid-panel');
      const source = document.querySelector('[data-slot-index="0"]');
      mockScrollablePanel(panel, { scrollTop: 100, headerBottom: 52 });
      beginDrag(source, 150);
      expect(document.querySelector('.inventory-edge-scroll-zone--top')).toHaveStyle({ top: '52px' });
      pointer(window, 'pointerMove', 25, 30);
      expect(frames.size).toBe(0);
      pointer(window, 'pointerMove', 25, 53);
      expect(frames.size).toBe(1);
      runFrame();
      expect(panel.scrollTop).toBeLessThan(100);
      expect(onChangeSlots).not.toHaveBeenCalled();
      pointer(window, 'pointerMove', 25, 126);
      expect(frames.size).toBe(0);
      expect(source).toHaveClass('is-dragging');
      pointer(window, 'pointerCancel', 25, 126);
    });

    test('bottom-zone RAF scroll is progressive, stops outside, and hides at the bound without changing slots or layout', () => {
      const onChangeSlots = jest.fn();
      render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
      const panel = document.querySelector('.inventory-grid-panel');
      const source = document.querySelector('[data-slot-index="0"]');
      const cellCount = document.querySelectorAll('.inventory-cell').length;
      mockScrollablePanel(panel, { clientHeight: 200, scrollHeight: 220 });
      beginDrag(source);
      pointer(window, 'pointerMove', 25, 199);
      expect(window.requestAnimationFrame).toHaveBeenCalled();
      runFrame();
      expect(panel.scrollTop).toBeGreaterThanOrEqual(10);
      expect(onChangeSlots).not.toHaveBeenCalled();
      expect(document.querySelectorAll('.inventory-cell')).toHaveLength(cellCount);
      pointer(window, 'pointerMove', 25, 126);
      expect(frames.size).toBe(0);
      expect(source).toHaveClass('is-dragging');
      panel.scrollTop = 19;
      pointer(window, 'pointerMove', 25, 199);
      runFrame();
      expect(document.querySelector('.inventory-edge-scroll-zone--bottom')).not.toBeInTheDocument();
      expect(frames.size).toBe(0);
      pointer(window, 'pointerCancel', 25, 199);
    });

    test('a bottom zone containing the activation point requires exit and re-entry while top remains armed', () => {
      render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const panel = document.querySelector('.inventory-grid-panel');
      const source = document.querySelector('[data-slot-index="0"]');
      mockScrollablePanel(panel, { scrollTop: 100 });

      beginDrag(source, 190);
      expect(frames.size).toBe(0);
      expect(document.querySelector('.inventory-edge-scroll-zone--bottom')).not.toBeInTheDocument();
      expect(document.querySelector('.inventory-edge-scroll-zone--top')).toBeInTheDocument();

      pointer(window, 'pointerMove', 25, 126);
      expect(document.querySelector('.inventory-edge-scroll-zone--bottom')).toBeInTheDocument();
      expect(frames.size).toBe(0);
      pointer(window, 'pointerMove', 25, 199);
      expect(frames.size).toBe(1);
      runFrame();
      expect(panel.scrollTop).toBeGreaterThan(100);
      pointer(window, 'pointerCancel', 25, 199);
    });

    test('touch hold in the bottom zone disarms it until exit and re-entry', () => {
      jest.useFakeTimers();
      render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const panel = document.querySelector('.inventory-grid-panel');
      const source = document.querySelector('[data-slot-index="0"]');
      mockScrollablePanel(panel, { scrollTop: 100 });
      touchPointer(source, 'pointerDown', 20, 190);
      act(() => jest.advanceTimersByTime(TOUCH_DRAG_HOLD_MS));
      expect(source).toHaveClass('is-dragging');
      expect(document.querySelector('.inventory-edge-scroll-zone--bottom')).not.toBeInTheDocument();
      expect(document.querySelector('.inventory-edge-scroll-zone--top')).toBeInTheDocument();
      touchPointer(window, 'pointerMove', 20, 126);
      expect(document.querySelector('.inventory-edge-scroll-zone--bottom')).toBeInTheDocument();
      touchPointer(window, 'pointerMove', 20, 199);
      act(() => jest.advanceTimersByTime(20));
      expect(panel.scrollTop).toBeGreaterThan(100);
      touchPointer(window, 'pointerCancel', 20, 199);
      jest.useRealTimers();
    });

    test('each new drag derives fresh edge arming from its own activation point', () => {
      render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const panel = document.querySelector('.inventory-grid-panel');
      const source = document.querySelector('[data-slot-index="0"]');
      mockScrollablePanel(panel);

      beginDrag(source, 190);
      expect(frames.size).toBe(0);
      pointer(window, 'pointerCancel', 25, 190);

      beginDrag(source, 126, 2);
      pointer(window, 'pointerMove', 25, 199, 2);
      expect(frames.size).toBe(1);
      pointer(window, 'pointerCancel', 25, 199, 2);
    });

    test.each(['pointerUp', 'pointerCancel', 'lostPointerCapture'])('%s cleanup cancels the active animation frame', eventType => {
      render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
      const panel = document.querySelector('.inventory-grid-panel');
      const source = document.querySelector('[data-slot-index="0"]');
      mockScrollablePanel(panel);
      beginDrag(source);
      pointer(window, 'pointerMove', 25, 199);
      expect(frames.size).toBe(1);
      pointer(eventType === 'lostPointerCapture' ? source : window, eventType, 25, 199);
      expect(window.cancelAnimationFrame).toHaveBeenCalled();
      expect(frames.size).toBe(0);
      expect(document.querySelector('.inventory-drag-ghost')).not.toBeInTheDocument();
    });

    test('a real slot remains a valid drop after scrolling while release without one preserves inventory', () => {
      const onChangeSlots = jest.fn();
      render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
      const panel = document.querySelector('.inventory-grid-panel');
      const source = document.querySelector('[data-slot-index="0"]');
      const target = document.querySelector('[data-slot-index="4"]');
      mockScrollablePanel(panel);
      beginDrag(source);
      pointer(window, 'pointerMove', 25, 199); runFrame();
      elementFromPoint.mockReturnValue(target);
      pointer(window, 'pointerUp', 25, 199);
      expect(onChangeSlots.mock.calls[0][0][4]).toMatchObject({ itemId: 'Простая ткань', quantity: 8 });
      beginDrag(source, 100, 2);
      pointer(window, 'pointerMove', 25, 199, 2); runFrame();
      elementFromPoint.mockReturnValue(null);
      pointer(window, 'pointerUp', 25, 199, 2);
      expect(onChangeSlots).toHaveBeenCalledTimes(1);
    });
  });
  test('pointer tap and sub-threshold movement open details without dragging', () => {
    const onUseItem = jest.fn(); render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onUseItem={onUseItem} onClose={jest.fn()} context={{ inExpedition: true }} />);
    const source=document.querySelector('[data-slot-index="0"]'); pointer(source,'pointerDown',10,10); pointer(window,'pointerMove',13,13); expect(screen.queryByText(/Выбросить/)).not.toBeInTheDocument(); pointer(window,'pointerUp',13,13); expect(screen.queryByRole('dialog', { name: 'Предмет: Простая ткань' })).not.toBeInTheDocument(); fireEvent.click(source);
    expect(screen.getByRole('dialog', { name: 'Предмет: Простая ткань' })).toBeInTheDocument(); expect(onUseItem).not.toHaveBeenCalled();
  });
  test('one touch gesture opens amulet details only; equip requires a second activation', () => {
    const carried={itemId:'Амулет Крысиной Жилы',instanceId:'carried-amulet',socketedRuneId:'astral_focus',quantity:1};
    const equipped={itemId:'Амулет Ветерана Бездны',instanceId:'equipped-amulet',socketedRuneId:null,quantity:1};
    const equipmentPlayer={...player,class:'Defender',equipment:{amulet:equipped},runInventory:normalizeInventorySlots([null,null,null,carried],10)};
    const onChangePlayer=jest.fn(); const onChangeSlots=jest.fn(); render(<InventoryGridModal player={equipmentPlayer} onChangeSlots={onChangeSlots} onChangePlayer={onChangePlayer} onClose={jest.fn()} context={{inCombat:false}}/>);
    const source=document.querySelector('[data-slot-index="3"]'); pointer(source,'pointerDown',40,120); pointer(window,'pointerMove',42,122); pointer(window,'pointerUp',42,122);
    expect(screen.queryByRole('dialog',{name:'Предмет: Амулет Крысиной Жилы'})).not.toBeInTheDocument(); expect(onChangePlayer).not.toHaveBeenCalled();
    fireEvent.click(source);
    expect(screen.getByRole('dialog',{name:'Предмет: Амулет Крысиной Жилы'})).toBeInTheDocument(); expect(onChangePlayer).not.toHaveBeenCalled(); expect(onChangeSlots).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Надеть'})); expect(onChangePlayer).toHaveBeenCalledTimes(1);
    expect(onChangePlayer.mock.calls[0][0].equipment.amulet).toMatchObject({instanceId:'carried-amulet',socketedRuneId:'astral_focus'});
  });
  test('the whole item tile owns five-pixel gameplay dragging while artwork cannot start native drag', () => {
    const onChangeSlots = jest.fn();
    render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
    const source = document.querySelector('[data-slot-index="0"]');
    const art = source.querySelector('.inventory-item-art');
    const target = document.querySelector('[data-slot-index="4"]');
    elementFromPoint.mockReturnValue(target);

    expect(GAMEPLAY_DRAG_ACTIVATION_DISTANCE).toBe(5);
    expect(art).toHaveAttribute('draggable', 'false');
    expect(fireEvent.dragStart(art)).toBe(false);
    pointer(art, 'pointerDown', 20, 20);
    pointer(window, 'pointerMove', 26, 20);
    expect(source).toHaveClass('is-dragging');
    expect(document.querySelector('.inventory-trash')).not.toBeInTheDocument();
    const preview = document.querySelector('.inventory-drag-ghost');
    expect(preview).toHaveClass('has-art');
    expect(preview.querySelector('img')).toHaveAttribute('src', resolveItemArt({ itemId: 'Простая ткань' }));
    expect(preview.querySelector('.inventory-drag-count')).toHaveTextContent('×8');
    expect(preview.querySelector('.inventory-drag-fallback')).toHaveAttribute('aria-hidden', 'true');
    expect(fireEvent.dragStart(preview.querySelector('img'))).toBe(false);
    pointer(window, 'pointerUp', 26, 20);
    expect(onChangeSlots.mock.calls[0][0][4]).toMatchObject({ itemId: 'Простая ткань', quantity: 8 });
  });
  test('presentation-only quantity and safe-slot badges do not block the parent tile drag', () => {
    render(<InventoryGridModal player={player} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    const source = document.querySelector('[data-slot-index="0"]');
    const quantity = source.querySelector('.inventory-count');
    expect(quantity).toHaveClass('item-icon-quantity');
    const safeMarker = source.querySelector('.safe-slot-mark');

    pointer(quantity, 'pointerDown', 10, 10);
    pointer(window, 'pointerMove', 15, 10);
    expect(source).toHaveClass('is-dragging');
    pointer(window, 'pointerCancel', 15, 10);
    expect(source).not.toHaveClass('is-dragging');

    pointer(safeMarker, 'pointerDown', 10, 10, 2);
    pointer(window, 'pointerMove', 15, 10, 2);
    expect(source).toHaveClass('is-dragging');
    pointer(window, 'pointerCancel', 15, 10, 2);
  });
  test('equipment instance and socket identity survive the existing inventory slot transaction', () => {
    const instance = { itemId: 'Плащ Тусклого Оберега', instanceId: 'armor-drag-1', socketedRuneId: 'stone_vigil', quantity: 1 };
    const instancePlayer = { ...player, runInventory: normalizeInventorySlots([instance], 10) };
    const onChangeSlots = jest.fn();
    render(<InventoryGridModal player={instancePlayer} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
    const source = document.querySelector('[data-slot-index="0"]');
    const target = document.querySelector('[data-slot-index="4"]');
    elementFromPoint.mockReturnValue(target);

    pointer(source, 'pointerDown', 1, 1);
    pointer(window, 'pointerMove', 6, 1);
    const preview = document.querySelector('.inventory-drag-ghost');
    expect(preview).toHaveClass('has-art');
    expect(preview.querySelector('img')).toHaveAttribute('src', resolveItemArt(instance));
    expect(preview.querySelector('.inventory-drag-fallback')).toHaveTextContent('Плащ Тусклого Оберега');
    pointer(window, 'pointerUp', 6, 1);
    expect(onChangeSlots.mock.calls[0][0][4]).toMatchObject(instance);
    expect(onChangeSlots.mock.calls[0][0][0]).toBeNull();
  });
  test.each([
    ['consumable', { itemId: 'Малое зелье здоровья', quantity: 3 }],
    ['loose rune', { itemId: 'stone_vigil', quantity: 4 }],
  ])('%s drag preview resolves canonical artwork instead of legacy text', (_label, stack) => {
    const categoryPlayer = { ...player, runInventory: normalizeInventorySlots([stack], 10) };
    render(<InventoryGridModal player={categoryPlayer} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    const source = document.querySelector('[data-slot-index="0"]');

    pointer(source, 'pointerDown', 1, 1);
    pointer(window, 'pointerMove', 6, 1);
    const preview = document.querySelector('.inventory-drag-ghost');
    expect(preview).toHaveClass('has-art');
    expect(preview.querySelector('img')).toHaveAttribute('src', resolveItemArt(stack));
    expect(preview.querySelector('.inventory-drag-count')).toHaveTextContent(`×${stack.quantity}`);
    pointer(window, 'pointerCancel', 6, 1);
  });
  test('missing artwork uses a safe canonical text fallback and cancel remains read-only', () => {
    const unknown = { itemId: 'Неизвестная реликвия', instanceId: 'missing-art-1', quantity: 1 };
    const unknownPlayer = { ...player, runInventory: normalizeInventorySlots([unknown], 10) };
    const onChangeSlots = jest.fn();
    render(<InventoryGridModal player={unknownPlayer} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
    const source = document.querySelector('[data-slot-index="0"]');

    pointer(source, 'pointerDown', 1, 1);
    pointer(window, 'pointerMove', 6, 1);
    const preview = document.querySelector('.inventory-drag-ghost');
    expect(preview).not.toHaveClass('has-art');
    expect(preview.querySelector('img')).toBeNull();
    expect(preview).toHaveTextContent('Неизвестная реликвия');
    expect(preview).not.toHaveTextContent('missing-art-1');
    pointer(window, 'pointerCancel', 6, 1);
    expect(onChangeSlots).not.toHaveBeenCalled();
  });
  test('equipped fishing rod resolves its canonical artwork through the paper-doll consumer', () => {
    render(<InventoryGridModal player={{ ...player, fishingTool: 'Костяная удочка', equipment: {} }} onClose={jest.fn()} context={{}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Экипировка' }));
    expect(screen.getByRole('button', { name: 'Удочка: Костяная удочка' }).querySelector('img')).toHaveAttribute('src', expect.stringContaining('/assets/items/equipment/bone_fishing_rod.webp'));
  });
  test('pointer drag merges compatible stacks, preserves overflow, and suppresses details click', () => {
    const onChangeSlots = jest.fn(); render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
    const source=document.querySelector('[data-slot-index="0"]'); const target=document.querySelector('[data-slot-index="1"]'); elementFromPoint.mockReturnValue(target); pointer(source,'pointerDown',10,10); pointer(window,'pointerMove',30,30); expect(document.querySelector('.inventory-trash')).not.toBeInTheDocument(); pointer(window,'pointerUp',30,30); fireEvent.click(source);
    expect(onChangeSlots.mock.calls[0][0].slice(0,2)).toEqual([{ itemId:'Простая ткань',quantity:5},{ itemId:'Простая ткань',quantity:20}]);
    expect(screen.queryByRole('dialog',{name:'Предмет: Простая ткань'})).not.toBeInTheDocument();
  });
  test('pointer drag moves to empty, swaps incompatible, and same/invalid/cancel are no-ops', () => {
    const onChangeSlots=jest.fn(); render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()}/>); const source=document.querySelector('[data-slot-index="0"]'); const empty=document.querySelector('[data-slot-index="4"]'); elementFromPoint.mockReturnValue(empty); pointer(source,'pointerDown',1,1); pointer(window,'pointerMove',20,20); pointer(window,'pointerUp',20,20); expect(onChangeSlots.mock.calls[0][0][4].itemId).toBe('Простая ткань');
    const incompatible=document.querySelector('[data-slot-index="2"]'); elementFromPoint.mockReturnValue(incompatible); pointer(source,'pointerDown',1,1,2); pointer(window,'pointerMove',20,20,2); pointer(window,'pointerUp',20,20,2); expect(onChangeSlots.mock.calls[1][0][0].itemId).toBe('Эссенция Проклятий');
    elementFromPoint.mockReturnValue(source); pointer(source,'pointerDown',1,1,3); pointer(window,'pointerMove',20,20,3); pointer(window,'pointerUp',20,20,3); expect(onChangeSlots).toHaveBeenCalledTimes(2);
    elementFromPoint.mockReturnValue(null); pointer(source,'pointerDown',1,1,4); pointer(window,'pointerMove',20,20,4); pointer(window,'pointerUp',20,20,4); pointer(source,'pointerDown',1,1,5); pointer(window,'pointerMove',20,20,5); pointer(window,'pointerCancel',20,20,5); expect(onChangeSlots).toHaveBeenCalledTimes(2);
  });
  test('dedicated discard mode toggles multiple whole stacks and never exposes drag trash', () => {
    const onChangeSlots=jest.fn(); render(<InventoryGridModal player={player} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);
    const geometry=document.querySelectorAll('.inventory-cell').length;
    fireEvent.click(screen.getByRole('button',{name:'Выбросить предметы'}));
    expect(document.querySelectorAll('.inventory-cell')).toHaveLength(geometry);
    const first=document.querySelector('[data-slot-index="0"]'); const second=document.querySelector('[data-slot-index="1"]');
    fireEvent.click(first); fireEvent.click(second); expect(first).toHaveClass('is-discard-selected'); expect(second).toHaveClass('is-discard-selected');
    expect(screen.getByRole('button',{name:'Сортировать инвентарь'})).toBeDisabled(); expect(document.querySelector('.inventory-trash')).toBeNull();
    fireEvent.click(first); expect(first).not.toHaveClass('is-discard-selected'); fireEvent.click(first);
    fireEvent.click(screen.getByRole('button',{name:/Подтвердить выброс: 2/})); fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Выбросить'}));
    expect(onChangeSlots.mock.calls[0][0][0]).toBeNull(); expect(onChangeSlots.mock.calls[0][0][1]).toBeNull();
  });
  test('pointercancel and lost capture after drag start restore the exact sparse inventory', () => {
    const gear={itemId:'Плащ Тусклого Оберега',instanceId:'safe-gear',socketedRuneId:'stone_vigil',quantity:1};
    const sparse={...player,runInventory:normalizeInventorySlots([null,null,null,gear,null,{itemId:'Простая ткань',quantity:9}],10)};
    const onChangeSlots=jest.fn(); render(<InventoryGridModal player={sparse} onChangeSlots={onChangeSlots} onClose={jest.fn()}/>);
    const source=document.querySelector('[data-slot-index="3"]'); pointer(source,'pointerDown',2,2,7); pointer(window,'pointerMove',12,12,7); expect(source).toHaveClass('is-dragging'); pointer(window,'pointerCancel',12,12,7); expect(document.querySelector('.inventory-drag-ghost')).not.toBeInTheDocument(); expect(onChangeSlots).not.toHaveBeenCalled();
    pointer(source,'pointerDown',2,2,8); pointer(window,'pointerMove',12,12,8); pointer(source,'lostPointerCapture',12,12,8); expect(document.querySelector('.inventory-drag-ghost')).not.toBeInTheDocument(); expect(onChangeSlots).not.toHaveBeenCalled();
  });
  test('equipment details exposes Equip outside combat and disables it in combat', () => {
    const gearPlayer={...player, class:'Defender', equipment:{}, runInventory:normalizeInventorySlots([{itemId:'Ржавый меч новобранца',quantity:1}],10)};
    const view=render(<InventoryGridModal player={gearPlayer} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} context={{inCombat:false}}/>);
    fireEvent.click(document.querySelector('[data-slot-index="0"]')); expect(screen.getByRole('button',{name:'Надеть'})).toBeEnabled();
    view.unmount(); render(<InventoryGridModal player={gearPlayer} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} context={{inCombat:true}}/>); fireEvent.click(document.querySelector('[data-slot-index="0"]')); expect(screen.getByRole('button',{name:'Надеть'})).toBeDisabled();
  });
  test('details card presents artwork, fallback, classification, and context actions', () => {
    const onChangeSlots = jest.fn();
    const detailsPlayer = {
      ...player,
      equipment: {},
      runInventory: normalizeInventorySlots([
        { itemId: 'Малое зелье здоровья', quantity: 3 },
        { itemId: 'Простая ткань', quantity: 2 },
        { itemId: 'Эссенция Проклятий', quantity: 1 },
      ], 12),
    };
    render(<InventoryGridModal player={detailsPlayer} onChangeSlots={onChangeSlots} onClose={jest.fn()} />);

    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByText('Расходник · Зелье')).toBeInTheDocument();
    expect(screen.getByText(/Количество: 3/)).toBeInTheDocument();
    expect(document.querySelector('.item-details-card__art img')).toHaveAttribute('src', expect.stringContaining('/assets/items/consumables/'));
    expect(screen.queryByRole('button', { name: 'Использовать' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выбросить' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    fireEvent.click(document.querySelector('[data-slot-index="1"]'));
    expect(screen.getByText('Материал · Ремесло')).toBeInTheDocument();
    expect(document.querySelector('.item-details-card__art img')).toHaveAttribute('src', expect.stringContaining('/assets/items/materials/simple_cloth.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    fireEvent.click(document.querySelector('[data-slot-index="2"]'));
    expect(screen.getByText('Особый материал · Катализатор')).toBeInTheDocument();
    expect(document.querySelector('.item-details-card__description')).toHaveClass('is-highlighted');
  });

  test('equipment details compares selected stats with the item in the same slot', () => {
    const comparisonPlayer = {
      ...player,
      class: 'Defender',
      equipment: { armor: 'Плащ Тусклого Оберега' },
      runInventory: normalizeInventorySlots([{ itemId: 'Куртка Мародёра', quantity: 1 }], 12),
    };
    render(<InventoryGridModal player={comparisonPlayer} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} context={{ inCombat: false }} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByText('Снаряжение · Доспех')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Сравнение' })).toBeInTheDocument();
    expect(screen.getByText('Плащ Тусклого Оберега')).toBeInTheDocument();
    expect(screen.getByText('22 → 18')).toBeInTheDocument();
    expect(screen.getByText('-4')).toHaveClass('is-negative');
    expect(screen.getByRole('button', { name: 'Надеть' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Снять' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /Сравнение|Характеристики/ })).toHaveLength(1);
  });
  test('identical equipped and carried items hide comparison and zero deltas', () => {
    const equipped = { itemId: 'Амулет Крысиной Жилы', instanceId: 'same-equipped', socketedRuneId: null, quantity: 1 };
    const carried = { itemId: 'Амулет Крысиной Жилы', instanceId: 'same-carried', socketedRuneId: null, quantity: 1 };
    render(<InventoryGridModal player={{ ...player, class: 'Defender', equipment: { amulet: equipped }, runInventory: normalizeInventorySlots([carried], 12) }} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.queryByRole('heading', { name: 'Сравнение' })).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
  test('same canonical item still compares a meaningful socket difference', () => {
    const equipped = { itemId: 'Амулет Крысиной Жилы', instanceId: 'rune-equipped', socketedRuneId: null, quantity: 1 };
    const carried = { itemId: 'Амулет Крысиной Жилы', instanceId: 'rune-carried', socketedRuneId: 'astral_focus', quantity: 1 };
    render(<InventoryGridModal player={{ ...player, class: 'Defender', equipment: { amulet: equipped }, runInventory: normalizeInventorySlots([carried], 12) }} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByRole('heading', { name: 'Сравнение' })).toBeInTheDocument();
    expect(screen.getByText(/Пусто → Руна Астрального эха/)).toBeInTheDocument();
  });
  test('empty socket is compact and unavailable rune insertion is quiet and disabled', () => {
    const amulet = { itemId: 'Амулет Крысиной Жилы', instanceId: 'empty-socket', socketedRuneId: null, quantity: 1 };
    render(<InventoryGridModal player={{ ...player, class: 'Defender', equipment: {}, runInventory: normalizeInventorySlots([amulet], 12) }} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    const socket = screen.getByRole('region', { name: 'Ячейка руны' });
    expect(socket).toHaveClass('item-details-card__socket');
    expect(socket).toHaveTextContent('РунаПусто');
    expect(within(socket).queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вставить руну' })).toBeDisabled();
    expect(screen.getByText('Нет подходящих рун')).not.toHaveClass('item-action-error');
    expect(screen.queryByText('Нет подходящих рун в инвентаре.')).not.toBeInTheDocument();
  });
  test('equipment details separates passive and flavor while status references stay interactive', () => {
    const equipmentPlayer = { ...player, equipment: { armor: 'Хитиновый Панцирь Мясного Жука' } };
    render(<InventoryGridModal player={equipmentPlayer} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Экипировка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Доспех: Хитиновый Панцирь Мясного Жука' }));
    expect(screen.getByRole('heading', { name: 'Характеристики' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Эффект' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Описание' })).toBeInTheDocument();
    expect(screen.getByText('Прочная пластина из грибных каверн.')).toBeInTheDocument();
    expect(screen.queryByText(/\+10 здоровья|\+5 физической защиты/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[Кровотечение]' }));
    expect(screen.getByLabelText('Статус: Кровотечение')).toBeInTheDocument();
  });
  test('regeneration potion keeps item contribution concise and links authoritative status mechanics', () => {
    const potionPlayer = { ...player, runInventory: normalizeInventorySlots([{ itemId: 'Малое зелье регенерации', quantity: 1 }], 10) };
    render(<InventoryGridModal player={potionPlayer} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    const itemDialog = screen.getByRole('dialog', { name: 'Предмет: Малое зелье регенерации' });
    expect(itemDialog).toHaveTextContent('Накладывает [Регенерация] на 2 хода.');
    expect(itemDialog).not.toHaveTextContent('15% максимального здоровья');
    fireEvent.click(within(itemDialog).getByRole('button', { name: '[Регенерация]' }));
    expect(screen.getByRole('dialog', { name: 'Статус: Регенерация' })).toHaveTextContent('15% максимального здоровья');
  });
  test('equipment comparison formats ratio stats as percentages', () => {
    const ratioPlayer = {
      ...player,
      equipment: { helmet: 'Красный Колпак Старшего Крысолова' },
      runInventory: normalizeInventorySlots([{ itemId: 'Грибная Маска Споровика', quantity: 1 }], 12),
    };
    render(<InventoryGridModal player={ratioPlayer} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByText('2% → 0%')).toBeInTheDocument();
    expect(screen.getByText('-2%')).toHaveClass('is-negative');
  });
  test('consumable mechanics reuse clickable status references', () => {
    const consumablePlayer = {
      ...player,
      equipment: {},
      runInventory: normalizeInventorySlots([{ itemId: 'Малое зелье антимагии', quantity: 1 }], 12),
    };
    render(<InventoryGridModal player={consumablePlayer} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByRole('heading', { name: 'Эффект' })).toBeInTheDocument();
    const ward = screen.getByRole('button', { name: '[Оберег]' });
    fireEvent.click(ward);
    expect(screen.getByLabelText('Статус: Оберег')).toBeInTheDocument();
    expect(screen.getByText(/Накладывает/).querySelector('button')).toBe(ward);
  });
  test('fireball scroll shows all authoritative mechanics with interactive Burn', () => {
    const scrollPlayer = { ...player, equipment: {}, runInventory: normalizeInventorySlots([{ itemId: 'Свиток Огненного шара', quantity: 1 }], 12) };
    render(<InventoryGridModal player={scrollPlayer} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByText(/140% магической атаки/)).toBeInTheDocument();
    const burn = screen.getByRole('button', { name: '[Горение]' });
    fireEvent.click(burn);
    expect(screen.getByLabelText('Статус: Горение')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '[Магическую слабость]' })).not.toBeInTheDocument();
  });
  test('Primordial Censer details keep their modal open around the Great Bonfire Flame GameTerm', () => {
    const censerPlayer = {
      ...player,
      equipment: {},
      runInventory: normalizeInventorySlots([{ itemId: 'Кадило Отца Костров', quantity: 1 }], 12),
    };
    render(<InventoryGridModal player={censerPlayer} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByRole('heading', { name: 'Кадило Отца Костров' })).toBeInTheDocument();
    expect(screen.getByText('Первозданная')).toBeInTheDocument();
    expect(screen.getByText('Снаряжение · Магический фокус')).toBeInTheDocument();
    const flame = screen.getByRole('button', { name: '[Пламя Великого Костра]' });
    expect(flame).toHaveAttribute('data-presentation', 'inline-text');
    expect(flame).toHaveClass('game-term-inline');
    fireEvent.click(flame);
    expect(screen.getByLabelText('Статус: Пламя Великого Костра')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть описание статуса Пламя Великого Костра' }));
    expect(screen.getByRole('heading', { name: 'Кадило Отца Костров' })).toBeInTheDocument();
  });
  test('Serpent Carapace details render Primordial stats and interactive Poison and Shield terms', () => {
    const primordialPlayer = { ...player, equipment: {}, runInventory: normalizeInventorySlots([{ itemId: 'Панцирь Змеиного Полубога', quantity: 1 }], 12) };
    render(<InventoryGridModal player={primordialPlayer} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByRole('heading', { name: 'Панцирь Змеиного Полубога' })).toBeInTheDocument();
    expect(screen.getByText('Первозданная')).toBeInTheDocument();
    expect(screen.getByText('+40')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '[Отравление]' })[0]);
    expect(screen.getByLabelText('Статус: Отравление')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть описание статуса Отравление' }));
    fireEvent.click(screen.getByRole('button', { name: '[Щитом]' }));
    expect(screen.getByLabelText('Статус: Щит')).toBeInTheDocument();
  });
  test('First Traitor Cloak details render percentages and open Betrayal without leaking internal type', () => {
    const primordialPlayer = { ...player, equipment: {}, runInventory: normalizeInventorySlots([{ itemId: 'Плащ Первого Предателя', quantity: 1 }], 12) };
    render(<InventoryGridModal player={primordialPlayer} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(document.querySelector('[data-slot-index="0"]'));
    expect(screen.getByRole('heading', { name: 'Плащ Первого Предателя' })).toBeInTheDocument();
    expect(screen.getByText('Снаряжение · Доспех')).toBeInTheDocument();
    expect(screen.getByText('+30')).toBeInTheDocument();
    expect(screen.getByText('+7')).toBeInTheDocument();
    expect(screen.getByText('+15')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[Предательство]' }));
    expect(screen.getByLabelText('Статус: Предательство')).toBeInTheDocument();
  });
  test('defaults to inventory with capacity, protected slots, and no equipment content below the grid', () => {
    const onChangeSlots = jest.fn(); const onClose = jest.fn();
    const partialSlots = normalizeInventorySlots([null, null, ...Array.from({ length: 7 }, (_, index) => ({ itemId: `Предмет ${index}`, quantity: 1 }))], 12);
    render(<InventoryGridModal player={{ runInventory: partialSlots, equipment: { helmet: 'Капюшон Искателя Знаков' } }} onChangeSlots={onChangeSlots} onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Рюкзак' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Предметы' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('7 / 26')).toBeInTheDocument();
    expect(screen.queryByText(/Свободно:/)).not.toBeInTheDocument();
    expect(screen.getByText(`Предметы в первых ${SAFE_SLOT_COUNT} ячейках сохраняются после смерти.`)).toBeInTheDocument();
    expect(screen.getByLabelText('Обычные')).toBeInTheDocument(); expect(screen.getByLabelText('Расходные')).toBeInTheDocument(); expect(screen.getByLabelText('Ресурсные')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Снаряжение' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.inventory-cell.is-safe')).toHaveLength(SAFE_SLOT_COUNT);
    expect(document.querySelector('[data-slot-index="0"]')).not.toHaveClass('has-item');
    fireEvent.click(screen.getByRole('button', { name: 'Сортировать инвентарь' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть инвентарь' }));
    expect(onChangeSlots).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });
  test('switches to real equipment slots and stats without mutating inventory', () => {
    const onChangeSlots = jest.fn(); const onChangePlayer = jest.fn();
    const runInventory = normalizeInventorySlots([{ itemId: 'Простая ткань', quantity: 1 }], 12);
    const equipment = { helmet: 'Капюшон Искателя Знаков', mainHand: 'Ржавый меч новобранца', offHand: 'Щит Дозорного Гильдии' };
    render(<InventoryGridModal player={{ runInventory, equipment, fishingTool: 'Костяная удочка', hp: 80, maxHp: 100, attack: 12, magAtk: 7, physDef: 9, magicDef: 4, speed: 110, dodge: 0.05, critChance: 0.33, critDamage: 0.85 }} onChangeSlots={onChangeSlots} onChangePlayer={onChangePlayer} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Экипировка' }));
    expect(screen.getByRole('tab', { name: 'Экипировка' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText('Переносимый инвентарь')).not.toBeInTheDocument();
    expect(screen.queryByText(/Свободно:/)).not.toBeInTheDocument();
    ['Шлем', 'Доспех', 'Осн. рука', '2-я рука', 'Кольцо 1', 'Кольцо 2', 'Амулет', 'Сумка'].forEach(label => expect(screen.getByText(label)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Шлем: Капюшон Искателя Знаков' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Основная рука: Ржавый меч новобранца' })).toHaveTextContent('Осн. рука');
    expect(screen.getByRole('button', { name: 'Вторая рука: Щит Дозорного Гильдии' })).toHaveTextContent('2-я рука');
    expect(screen.getByLabelText('Доспех: пусто')).toBeInTheDocument();
    const visualSlots = Array.from(document.querySelectorAll('.equipment-paper-slot'));
    expect(visualSlots).toHaveLength(EQUIPMENT_SLOT_KEYS.length + 1);
    expect(visualSlots.every(slot => slot.classList.contains('equipment-paper-slot'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Удочка: Костяная удочка' }).className).toBe(screen.getByRole('button', { name: 'Основная рука: Ржавый меч новобранца' }).className);
    expect(screen.queryByText('Инструмент')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Снять' })).not.toBeInTheDocument();
    const statLabels = Array.from(document.querySelectorAll('.inventory-stats dt')).map(node => node.textContent);
    expect(statLabels).toEqual(['HP', 'Скорость', 'Маг. атака', 'Физ. атака', 'Маг. защитаⓘ', 'Физ. защитаⓘ', 'Уворот', 'Крит. шанс', 'Крит. урон']);
    const statValues = Array.from(document.querySelectorAll('.inventory-stats dd')).map(node => node.textContent);
    expect(statValues).toEqual(['80 / 100', '110', '7', '12', '4', '9', '5%', '33%', '185%']);
    expect(screen.queryByRole('button', { name: /Подробнее: Скорость/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Магическая защита' }));
    expect(screen.getByRole('dialog', { name: 'Магическая защита' })).toHaveTextContent('примерно 4%');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Физическая защита' }));
    expect(screen.getByRole('dialog', { name: 'Физическая защита' })).toHaveTextContent('примерно 8%');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(document.querySelector('[data-equipment-slot="helmet"]').className).not.toMatch(/rarity/i);
    fireEvent.click(screen.getByRole('button', { name: 'Шлем: Капюшон Искателя Знаков' }));
    expect(screen.getByRole('dialog', { name: 'Предмет: Капюшон Искателя Знаков' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Снять' }));
    expect(onChangePlayer).toHaveBeenCalledTimes(1); expect(onChangeSlots).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Предметы' }));
    expect(document.querySelector('[data-slot-index="0"] img')).toHaveAttribute('src', expect.stringContaining('/assets/items/materials/simple_cloth.png'));
  });
  test('does not present empty trailing migration overflow as capacity or a section', () => {
    const trailing=normalizeInventorySlots([],28); trailing[2]=createItemStack('Плащ Тусклого Оберега');
    render(<InventoryGridModal player={{runInventory:trailing,runInventoryLayoutVersion:2,equipment:{}}} onChangeSlots={jest.fn()} onClose={jest.fn()}/>);
    expect(screen.getByText('1 / 26')).toBeInTheDocument(); expect(screen.queryByText('Переполнение')).not.toBeInTheDocument();
  });
  test('reports zero free slots for a full capacity-derived inventory', () => {
    const fullSlots = normalizeInventorySlots(Array.from({ length: 26 }, (_, index) => ({ itemId: `Предмет ${index}`, quantity: 1 })), 26);
    render(<InventoryGridModal player={{ runInventory: fullSlots, equipment: {} }} onChangeSlots={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText(/26 \/ 26/)).toHaveTextContent('Заполнено');
    expect(screen.getByText(/26 \/ 26/)).toHaveClass('is-full');
    expect(document.querySelector('.inventory-bag-extension')).not.toBeInTheDocument();
  });
  test('groups Guild bag capacity into the four typed sections', () => {
    const bag=equipmentByName['Походная сумка Гильдии']; render(<InventoryGridModal player={{runInventory:normalizeInventorySlots([],32),equipment:{bag:bag.name}}} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()}/>);
    expect(screen.getByText('0 / 32')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Безопасные')).getAllByRole('button')).toHaveLength(2);
    expect(within(screen.getByLabelText('Обычные')).getAllByRole('button')).toHaveLength(12);
    expect(within(screen.getByLabelText('Расходные')).getAllByRole('button')).toHaveLength(4);
    expect(within(screen.getByLabelText('Ресурсные')).getAllByRole('button')).toHaveLength(14);
    expect(document.querySelector('.inventory-bag-extension')).toBeNull();
  });
  test('keeps bag details open with capacity and authoritative removal error', () => {
    const bag = equipmentByName['Походная сумка Гильдии'];
    const slots = normalizeInventorySlots([createItemStack('Простая ткань'),createItemStack('Простая ткань'),...Array(12).fill(createItemStack('Ржавый меч новобранца'))],32);
    render(<InventoryGridModal player={{ runInventory: slots, equipment: { bag: bag.name } }} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Экипировка' }));
    fireEvent.click(screen.getByRole('button', { name: `Сумка: ${bag.name}` }));
    expect(screen.getByText(/Ячейки: \+2 обычные/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Снять' }));
    expect(screen.getByRole('dialog', { name: `Предмет: ${bag.name}` })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Нельзя снять сумку');
    expect(screen.getByRole('alert')).toHaveTextContent('Освободите 3 ячеек');
  });
  test('keeps equipped-item Unequip disabled in combat', () => {
    render(<InventoryGridModal player={{ runInventory: normalizeInventorySlots([], 12), equipment: { helmet: 'Капюшон Искателя Знаков' } }} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} context={{ inCombat: true }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Экипировка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Шлем: Капюшон Искателя Знаков' }));
    expect(screen.getByRole('button', { name: 'Снять' })).toBeDisabled();
    expect(screen.getByText('Снаряжение нельзя менять во время боя')).toBeInTheDocument();
  });
  test('presents loose runes canonically and sockets rune-first into the exact equipped instance', () => {
    const equipped = { instanceId: 'equipped-sword', itemId: 'Ржавый меч новобранца', socketedRuneId: null, quantity: 1 };
    const carried = { instanceId: 'carried-sword', itemId: 'Ржавый меч новобранца', socketedRuneId: null, quantity: 1 };
    let state;
    const Harness = () => {
      const [current, setCurrent] = useState({
        class: 'Defender', equipment: { mainHand: equipped },
        runInventory: normalizeInventorySlots([{ itemId: 'ember_heart', quantity: 2 }, carried], 12),
      });
      state = current;
      return <InventoryGridModal player={current} onChangeSlots={jest.fn()} onChangePlayer={setCurrent} onClose={jest.fn()} context={{ inExpedition: true, inCombat: false }} />;
    };
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Руна Пламенного сердца' })).toBeInTheDocument();
    expect(screen.queryByText('ember_heart')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Руна Пламенного сердца' }));
    const details = screen.getByRole('dialog', { name: 'Предмет: Руна Пламенного сердца' });
    expect(details.querySelector('img')).toHaveAttribute('src', '/assets/items/runes/ember_heart.webp');
    expect(details).toHaveTextContent('Каждое третье атакующее действие');
    fireEvent.click(screen.getByRole('button', { name: 'Вставить' }));
    const picker = screen.getByRole('dialog', { name: 'Выбор снаряжения' });
    expect(picker).toHaveTextContent('Ржавый меч новобранца');
    expect(picker.querySelectorAll('.rune-target-list button')).toHaveLength(2);
    expect(screen.getByLabelText('Надето')).toHaveClass('equipped-item-marker');
    const confirm = within(picker).getByRole('button', { name: 'Вставить' });
    expect(confirm).toBeDisabled();
    const target = within(picker).getByRole('button', { name: 'Выбрать Ржавый меч новобранца, надето' });
    fireEvent.click(target);
    expect(target).toHaveAttribute('aria-pressed', 'true'); expect(target).toHaveClass('is-selected');
    expect(confirm).toBeEnabled();
    expect(state.equipment.mainHand.socketedRuneId).toBeNull();
    fireEvent.click(confirm);
    expect(state.equipment.mainHand).toMatchObject({ instanceId: 'equipped-sword', socketedRuneId: 'ember_heart' });
    expect(state.runInventory.find(item => item?.itemId === 'ember_heart').quantity).toBe(1);
    expect(state.runInventory.find(item => item?.instanceId === 'carried-sword')).toMatchObject({ socketedRuneId: null });
    expect(screen.queryByRole('dialog', { name: 'Выбор снаряжения' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Предмет: Руна Пламенного сердца' })).toBeInTheDocument();
  });
  test('equipment-first run socketing reads loose Run Inventory runes and combat blocks mutation', () => {
    const armor = { instanceId: 'run-armor', itemId: 'Куртка Мародёра', socketedRuneId: null, quantity: 1 };
    let state;
    const Harness = ({ inCombat = false }) => {
      const [current, setCurrent] = useState({ class: 'Defender', equipment: { armor }, runInventory: normalizeInventorySlots([{ itemId: 'stone_vigil', quantity: 2 }, { itemId: 'ember_heart', quantity: 2 }], 12) });
      state = current;
      return <InventoryGridModal player={current} onChangeSlots={jest.fn()} onChangePlayer={setCurrent} onClose={jest.fn()} context={{ inExpedition: true, inCombat }} />;
    };
    const first = render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Экипировка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Доспех: Куртка Мародёра' }));
    fireEvent.click(screen.getByRole('button', { name: 'Вставить руну' }));
    const picker = screen.getByRole('dialog', { name: 'Выбор руны' });
    expect(picker).toHaveTextContent('Руна Стального Отпора'); expect(picker).toHaveTextContent('Нагрудник · ×2');
    expect(picker).not.toHaveTextContent('Руна Пламенного сердца');
    const runeCandidate = within(picker).getByRole('button', { name: 'Выбрать Руна Стального Отпора' });
    const confirm = within(picker).getByRole('button', { name: 'Вставить' });
    expect(confirm).toBeDisabled();
    expect(picker).not.toHaveTextContent('20% шанс после прямого урона');
    fireEvent.click(runeCandidate);
    expect(runeCandidate).toHaveClass('game-picker-card', 'is-selected');
    expect(state.equipment.armor.socketedRuneId).toBeNull();
    fireEvent.click(confirm);
    expect(state.equipment.armor).toMatchObject({ instanceId: 'run-armor', socketedRuneId: 'stone_vigil' });
    expect(state.runInventory.find(item => item?.itemId === 'stone_vigil').quantity).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'Выбор руны' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Предмет: Куртка Мародёра' })).toHaveTextContent('Руна Стального Отпора');
    first.unmount();
    render(<Harness inCombat />);
    fireEvent.click(screen.getByRole('tab', { name: 'Экипировка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Доспех: Куртка Мародёра' }));
    expect(screen.getByRole('button', { name: 'Вставить руну' })).toBeDisabled();
    expect(screen.getByText('Руны нельзя вставлять во время боя.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Извлечь руну' })).not.toBeInTheDocument();
  });
  test('picker revalidates combat on confirmation, keeps selection, and does not consume the rune', () => {
    const weapon = { instanceId: 'revalidate-weapon', itemId: 'Ржавый меч новобранца', socketedRuneId: null, quantity: 1 };
    const current = { class: 'Defender', equipment: { mainHand: weapon }, runInventory: normalizeInventorySlots([{ itemId: 'ember_heart', quantity: 1 }], 12) };
    const onChangePlayer = jest.fn();
    const { rerender } = render(<InventoryGridModal player={current} onChangeSlots={jest.fn()} onChangePlayer={onChangePlayer} onClose={jest.fn()} context={{ inExpedition: true, inCombat: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Руна Пламенного сердца' }));
    fireEvent.click(screen.getByRole('button', { name: 'Вставить' }));
    const picker = screen.getByRole('dialog', { name: 'Выбор снаряжения' });
    const candidate = within(picker).getByRole('button', { name: 'Выбрать Ржавый меч новобранца, надето' });
    fireEvent.click(candidate);
    rerender(<InventoryGridModal player={current} onChangeSlots={jest.fn()} onChangePlayer={onChangePlayer} onClose={jest.fn()} context={{ inExpedition: true, inCombat: true }} />);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Выбор снаряжения' })).getByRole('button', { name: 'Вставить' }));
    expect(within(screen.getByRole('dialog', { name: 'Выбор снаряжения' })).getByRole('alert')).toHaveTextContent('Руны нельзя вставлять во время боя.');
    expect(candidate).toHaveAttribute('aria-pressed', 'true');
    expect(onChangePlayer).not.toHaveBeenCalled();
    expect(current.runInventory[0].quantity).toBe(1); expect(current.equipment.mainHand.socketedRuneId).toBeNull();
  });
  test('rune with no target is unavailable without opening a picker', () => {
    const current = { equipment: {}, runInventory: normalizeInventorySlots([{ itemId: 'ember_heart', quantity: 1 }], 12) };
    render(<InventoryGridModal player={current} onChangeSlots={jest.fn()} onChangePlayer={jest.fn()} onClose={jest.fn()} context={{ inExpedition: true, inCombat: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Руна Пламенного сердца' }));
    expect(screen.getByRole('button', { name: 'Вставить' })).toBeDisabled();
    expect(screen.getByText('Нет подходящего снаряжения')).toHaveClass('item-action-note');
    expect(screen.queryByRole('dialog', { name: 'Выбор снаряжения' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Предмет: Руна Пламенного сердца' })).toBeInTheDocument();
  });
  test('Astral Echo sockets into a legacy equipped amulet without requiring unequip', () => {
    let state;
    const Harness = () => {
      const [current, setCurrent] = useState({ class: 'Defender', equipment: { helmet: 'Капюшон Искателя Знаков', amulet: 'Амулет Крысиной Жилы' }, runInventory: normalizeInventorySlots([null, { itemId: 'astral_focus', quantity: 1 }, { instanceId: 'carried-duplicate', itemId: 'Амулет Крысиной Жилы', socketedRuneId: null, quantity: 1 }], 12) });
      state = current;
      return <InventoryGridModal player={current} onChangeSlots={jest.fn()} onChangePlayer={setCurrent} onClose={jest.fn()} context={{ inExpedition: true, inCombat: false }} />;
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Руна Астрального эха' }));
    fireEvent.click(screen.getByRole('button', { name: 'Вставить' }));
    const picker = screen.getByRole('dialog', { name: 'Выбор снаряжения' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Выбрать Амулет Крысиной Жилы, надето' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Вставить' }));
    expect(state.equipment.amulet).toMatchObject({ itemId: 'Амулет Крысиной Жилы', instanceId: expect.any(String), socketedRuneId: 'astral_focus' });
    expect(state.equipment.helmet).toBe('Капюшон Искателя Знаков');
    expect(state.runInventory.some(item => item?.itemId === 'astral_focus')).toBe(false);
    expect(state.runInventory.find(item => item?.instanceId === 'carried-duplicate')).toMatchObject({ socketedRuneId: null });
    expect(screen.queryByRole('dialog', { name: 'Выбор снаряжения' })).not.toBeInTheDocument();
    const restored = hydratePlayerSnapshot(JSON.parse(JSON.stringify(buildPlayerSnapshot(state))));
    expect(restored.equipment.amulet).toMatchObject({ instanceId: state.equipment.amulet.instanceId, itemId: 'Амулет Крысиной Жилы', socketedRuneId: 'astral_focus' });
    expect(restored.runInventory.some(item => item?.itemId === 'astral_focus')).toBe(false);
  });

});
