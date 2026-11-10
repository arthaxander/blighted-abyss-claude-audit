/* eslint-disable testing-library/no-container, testing-library/no-node-access */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ExpeditionMapScreen from './ExpeditionMapScreen';
import { createExpeditionMapRun } from '../utils/expeditionMapRun';
import { applyMapProgressLocks, getAdjacentCellIds, findKnownMapTravelPath } from '../utils/expeditionMapLayout';
import { grantExpeditionKey } from '../utils/expeditionMap';

jest.mock('./DungeonRunHud', () => () => null);
jest.mock('./DungeonInventoryModal', () => () => null);
jest.mock('./FieldCraftingModal', () => () => null);

const createRun = templateId => createExpeditionMapRun({
  locationId: 'Гоблинские Норы', templateId, rng: () => .42,
});
beforeEach(() => { Element.prototype.scrollTo = jest.fn(); });

test.each(['wide-cavern-01', 'goblin-02', 'goblin-03', 'goblin-04'])(
  'renders %s with generic hex tiles, no removed painted assets', templateId => {
    const run = createRun(templateId);
    run.mainLayout.cells = run.mainLayout.cells.map(cell => ({ ...cell, revealed: true }));
    const onMove = jest.fn();
    const { container } = render(<ExpeditionMapScreen run={run} onMove={onMove} onReturnToGuild={jest.fn()} />);
    const board = container.querySelector('.expedition-map-board');
    expect(board.querySelectorAll('.expedition-tile')).toHaveLength(run.mainLayout.cells.length);
    expect(board.querySelectorAll('.expedition-tile-shape')).toHaveLength(run.mainLayout.cells.length);
    expect(container.querySelector('.goblin-map-landscape')).toBeNull();
    expect(container.querySelector('.goblin-map-event')).toBeNull();
    expect(container.querySelectorAll('img[src*="/assets/maps/"]')).toHaveLength(0);
    expect(screen.getByText('Гекс-карта · ' + templateId)).toBeInTheDocument();
    const available = board.querySelector('.expedition-tile.available');
    expect(available).not.toBeNull();
    expect(findKnownMapTravelPath(
      applyMapProgressLocks(run.mainLayout, run.state),
      available.dataset.cellId
    )?.length).toBeGreaterThan(0);
    fireEvent.click(available);
    expect(onMove).toHaveBeenCalledWith(available.dataset.cellId);
  }
);

test('sublocation gate requires key and retains exact destination', () => {
  const run = createRun('wide-cavern-01');
  const chosen = run.state.availableSublocationIds[0];
  const entrance = run.mainLayout.sublocationEntranceCellIds[chosen];
  const parent = getAdjacentCellIds(run.mainLayout, entrance)
    .find(id => run.mainLayout.cells.find(cell => cell.id === id).region === 'approach');
  run.mainLayout.currentCellId = parent;
  run.mainLayout.cells = run.mainLayout.cells.map(cell =>
    cell.id === entrance ? { ...cell, revealed: true } : cell);
  run.state = grantExpeditionKey(run.state, 'sublocation').state;
  const onMove = jest.fn();
  const { container } = render(<ExpeditionMapScreen run={run} onMove={onMove} onReturnToGuild={jest.fn()} />);
  fireEvent.click(container.querySelector('[data-cell-id="' + entrance + '"]'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Использовать ключ' }));
  expect(onMove).toHaveBeenCalledWith(entrance);
});

test('unlocked autobattle toggle is immediately accessible from the hex map and persists preference through callback', () => {
  const change = jest.fn();
  const run = createRun('goblin-02');
  const { rerender } = render(<ExpeditionMapScreen
    run={run}
    player={{ currentLocation: 'Гоблинские Норы', autobattleEnabled: false }}
    autobattleUnlocked
    onAutobattleChange={change}
    onMove={jest.fn()}
    onReturnToGuild={jest.fn()}
  />);
  const button = screen.getByRole('button', { name: 'Автобой: выключен' });
  expect(button).toBeEnabled();
  expect(button).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(button);
  expect(change).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledWith(true);
  rerender(<ExpeditionMapScreen
    run={run}
    player={{ currentLocation: 'Гоблинские Норы', autobattleEnabled: true }}
    autobattleUnlocked
    onAutobattleChange={change}
    onMove={jest.fn()}
    onReturnToGuild={jest.fn()}
  />);
  const enabled = screen.getByRole('button', { name: 'Автобой: включён' });
  expect(enabled).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(enabled);
  expect(change).toHaveBeenLastCalledWith(false);
});

test('a locked map displays disabled autobattle, even when a different location had enabled preference', () => {
  const change = jest.fn();
  render(<ExpeditionMapScreen
    run={createRun('wide-cavern-01')}
    player={{ currentLocation: 'Гоблинские Норы', autobattleEnabled: true }}
    onAutobattleChange={change}
    onMove={jest.fn()}
    onReturnToGuild={jest.fn()}
  />);
  const button = screen.getByRole('button', { name: /Автобой заблокирован/ });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(button);
  expect(change).not.toHaveBeenCalled();
});


test('new cavern renders collision separately and keeps touch-sized camera controls usable', () => {
  const run = createRun('goblin-caverns-02');
  const onMove = jest.fn();
  const { container } = render(<ExpeditionMapScreen run={run} onMove={onMove} onReturnToGuild={jest.fn()} />);
  expect(container.querySelectorAll('.expedition-tile')).toHaveLength(run.mainLayout.cells.filter(c => c.walkable !== false).length);
  expect(container.querySelectorAll('.expedition-terrain')).toHaveLength(run.mainLayout.cells.filter(c => c.walkable === false).length);
  expect(container.querySelectorAll('button[data-terrain-id]')).toHaveLength(0);
  const available = container.querySelector('.expedition-tile.available');
  fireEvent.click(available);
  expect(onMove).toHaveBeenCalledWith(available.dataset.cellId);
  fireEvent.click(screen.getByRole('button', { name: 'Отдалить карту' }));
  const board = container.querySelector('.expedition-map-board');
  expect(board.style.transform).toBe('scale(0.8)');
  expect(screen.getByText('80%')).toBeInTheDocument();
  expect(parseFloat(container.querySelector('.expedition-map-scroll-surface').style.width))
    .toBeCloseTo(parseFloat(board.style.width) * 0.8);
  for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: 'Отдалить карту' }));
  expect(screen.getByRole('button', { name: 'Отдалить карту' })).toBeDisabled();
  expect(board.style.transform).toBe('scale(0.4)');
  fireEvent.click(screen.getByRole('button', { name: 'Вернуться к герою' }));
  expect(Element.prototype.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
});
