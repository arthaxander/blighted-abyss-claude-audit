import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LockpickMinigame, { targetArcRotation, targetOpacityAt } from './LockpickMinigame';
import { LOCKPICK_CONFIG } from '../minigames/lockpickConfig';

const config = {
  ...LOCKPICK_CONFIG,
  startingDelayMs: 100,
  rotationDurationMs: 1000,
  initialTargetWidthDeg: 40,
  targetLifetimeMs: 5_000,
  targetSpawnIntervalMinMs: 50,
  targetSpawnIntervalMaxMs: 50,
  minTargetGapDegrees: 5,
  spawnPointerExclusionDegrees: 5,
  resultFadeInMs: 100,
  resultHoldMs: 100,
  resultFadeOutMs: 100,
};

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

const start = () => {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'НАЧАТЬ' }));
  expect(screen.getByLabelText('Взлом замка сокровищницы')).toHaveAttribute('data-phase', 'STARTING');
  act(() => jest.advanceTimersByTime(config.startingDelayMs));
};

test('READY has a stopped pointer and timer; start input is not a gameplay tap', () => {
  render(<LockpickMinigame config={config} random={() => 0.5} />);
  const game = screen.getByLabelText('Взлом замка сокровищницы');
  const pointer = screen.getByTestId('lock-pointer');
  expect(game).toHaveAttribute('data-phase', 'READY');
  expect(pointer).toHaveStyle('transform: rotate(0deg)');
  expect(screen.getByLabelText('Оставшееся время')).toHaveTextContent('20.0');
  act(() => jest.advanceTimersByTime(500));
  expect(pointer).toHaveStyle('transform: rotate(0deg)');
  fireEvent.pointerDown(game);
  expect(screen.getByText('0 / 4')).toBeInTheDocument();
  start();
  expect(game).toHaveAttribute('data-phase', 'PLAYING');
  expect(screen.getByText('0 / 4')).toBeInTheDocument();
});

test('timestamp cadence creates overlapping targets and expiration has no miss penalty', () => {
  const values = [0.25, 0.6, 0.9, 0.4];
  render(<LockpickMinigame config={{ ...config, targetLifetimeMs: 200 }} random={() => values.shift() ?? 0.4} />);
  start();
  act(() => jest.advanceTimersByTime(130));
  expect(screen.getAllByTestId('active-target').length).toBeGreaterThan(1);
  const before = Number(screen.getByLabelText('Оставшееся время').textContent);
  act(() => jest.advanceTimersByTime(220));
  expect(Number(screen.getByLabelText('Оставшееся время').textContent)).toBeGreaterThan(before - 0.4);
  expect(screen.getByText('0 / 4')).toBeInTheDocument();
});

test('production timing spawns immediately, overlaps, and expires only after authoritative expiry', () => {
  const values = [0.25, 0, 0.6, 0, 0.9, 0];
  render(<LockpickMinigame config={{ ...LOCKPICK_CONFIG, startingDelayMs: 100 }} random={() => values.shift() ?? 0.4} />);
  fireEvent.pointerDown(screen.getByRole('button', { name: 'НАЧАТЬ' }));
  act(() => jest.advanceTimersByTime(100));
  act(() => jest.advanceTimersByTime(40));
  const first = screen.getByTestId('active-target');
  const expiresAt = Number(first.getAttribute('data-expires-at'));
  const spawnTime = Number(first.getAttribute('data-spawn-time'));
  expect(expiresAt - spawnTime).toBe(2200);
  expect(Number(first.getAttribute('opacity'))).toBeGreaterThan(0);
  act(() => jest.advanceTimersByTime(600));
  expect(screen.getAllByTestId('active-target').length).toBeGreaterThanOrEqual(2);
  act(() => jest.advanceTimersByTime(1540));
  expect(screen.getAllByTestId('active-target').some(target => target.getAttribute('data-id') === first.getAttribute('data-id'))).toBe(true);
  act(() => jest.advanceTimersByTime(80));
  expect(screen.queryAllByTestId('active-target').some(target => target.getAttribute('data-id') === first.getAttribute('data-id'))).toBe(false);
  expect(screen.getByText('0 / 4')).toBeInTheDocument();
});

test('SVG targets expose a visible degree-length stroke and centered rotation, including wrap', () => {
  render(<LockpickMinigame config={config} random={() => 0.25} />);
  start();
  act(() => jest.advanceTimersByTime(40));
  const arc = screen.getByTestId('active-target');
  const width = Number(arc.getAttribute('data-width'));
  expect(width).toBeLessThan(config.initialTargetWidthDeg);
  expect(width).toBeGreaterThan(config.initialTargetWidthDeg * 0.98);
  expect(arc.tagName.toLowerCase()).toBe('circle');
  expect(arc).toHaveAttribute('stroke-dasharray', `${width} ${360 - width}`);
  expect(arc).toHaveAttribute('stroke-linecap', 'butt');
  expect(arc).toHaveAttribute('transform', `rotate(${90 - width / 2 - 90} 50 50)`);
  expect(Number(arc.getAttribute('opacity'))).toBeGreaterThan(0);

  const wrapTarget = { angle: 0 };
  expect(targetArcRotation(wrapTarget, 40)).toBe(-110);
  expect(targetArcRotation(wrapTarget, 10) + 10 / 2).toBe(-90);
  expect(targetOpacityAt({ spawnTime: 1000, expiresAt: 2700 }, 1120, 120, 150)).toBe(1);
  expect(targetOpacityAt({ spawnTime: 1000, expiresAt: 2700 }, 2699, 120, 150)).toBeGreaterThan(0.45);
  expect(targetOpacityAt({ spawnTime: 1000, expiresAt: 2700 }, 2700, 120, 150)).toBe(0);
});

test('each SVG target shrinks independently while retaining its center angle', () => {
  const values = [0.25, 0, 0.6, 0];
  render(<LockpickMinigame config={config} random={() => values.shift() ?? 0.9} />);
  start();
  act(() => jest.advanceTimersByTime(80));
  const [older, newer] = screen.getAllByTestId('active-target');
  const oldWidth = Number(older.getAttribute('data-width'));
  const newWidth = Number(newer.getAttribute('data-width'));
  expect(oldWidth).toBeLessThan(newWidth);
  expect(older).toHaveAttribute('data-center', '90');
  expect(newer).toHaveAttribute('data-center', '216');
});

test('miss keeps targets, applies penalty, and failure resolves only once', () => {
  const onFail = jest.fn();
  render(<LockpickMinigame config={config} random={() => 0.25} onFail={onFail} />);
  start();
  act(() => jest.advanceTimersByTime(20));
  const game = screen.getByLabelText('Взлом замка сокровищницы');
  const targetsBefore = screen.getAllByTestId('active-target').length;
  fireEvent.pointerDown(game);
  expect(screen.getAllByTestId('active-target')).toHaveLength(targetsBefore);
  expect(Number(screen.getByLabelText('Оставшееся время').textContent)).toBeLessThanOrEqual(18);
  for (let i = 0; i < 9; i += 1) fireEvent.pointerDown(game);
  expect(game).toHaveAttribute('data-phase', 'FAILURE');
  fireEvent.pointerDown(game);
  act(() => jest.advanceTimersByTime(300));
  expect(onFail).toHaveBeenCalledTimes(1);
  expect(onFail).toHaveBeenCalledWith('failure');
  expect(game).toHaveAttribute('data-phase', 'FINISHING');
});

test('miss stops only the pointer while timer, target lifetime, and spawn cadence continue', () => {
  const values = [0.25, 0, 0.6, 0, 0.9, 0];
  render(<LockpickMinigame config={config} random={() => values.shift() ?? 0.9} />);
  start();
  act(() => jest.advanceTimersByTime(20));
  const game = screen.getByLabelText('Взлом замка сокровищницы');
  const pointer = screen.getByTestId('lock-pointer');
  const firstTarget = screen.getByTestId('active-target');
  const widthBefore = Number(firstTarget.getAttribute('data-width'));
  fireEvent.pointerDown(game);
  const angleAtMiss = pointer.style.transform;
  const penalizedTime = Number(screen.getByLabelText('Оставшееся время').textContent);

  act(() => jest.advanceTimersByTime(100));
  expect(pointer.style.transform).toBe(angleAtMiss);
  expect(Number(screen.getByLabelText('Оставшееся время').textContent)).toBeLessThan(penalizedTime);
  expect(Number(firstTarget.getAttribute('data-width'))).toBeLessThan(widthBefore);
  expect(screen.getAllByTestId('active-target').length).toBeGreaterThan(1);

  act(() => jest.advanceTimersByTime(40));
  expect(pointer.style.transform).not.toBe(angleAtMiss);
  expect(game).toHaveAttribute('data-direction', '1');
});

test('a hit reverses continuously, removes only its target, and preserves other target lifetimes and spawn cadence', () => {
  const values = [0.25, 0, 0.6, 0, 0.9, 0, 0, 1 / 3];
  render(<LockpickMinigame config={config} random={() => values.shift() ?? 1 / 3} />);
  start();
  act(() => jest.advanceTimersByTime(250));
  const game = screen.getByLabelText('Взлом замка сокровищницы');
  const pointer = screen.getByTestId('lock-pointer');
  const targets = screen.getAllByTestId('active-target');
  const count = targets.length;
  const preserved = targets.slice(1).map(target => ({
    id: target.getAttribute('data-id'), expiresAt: target.getAttribute('data-expires-at'),
  }));
  const hitAngle = pointer.style.transform;
  expect(game).toHaveAttribute('data-direction', '1');
  fireEvent.pointerDown(game);
  expect(game).toHaveAttribute('data-direction', '-1');
  expect(screen.queryAllByTestId('active-target')).toHaveLength(count - 1);
  const reversalAngle = pointer.style.transform;
  expect(Math.abs(Number(reversalAngle.match(/[-\d.]+/)[0]) - Number(hitAngle.match(/[-\d.]+/)[0])))
    .toBeLessThan(360 * 17 / config.rotationDurationMs);
  preserved.forEach(({ id, expiresAt }) => {
    const target = screen.getAllByTestId('active-target').find(item => item.getAttribute('data-id') === id);
    expect(target).toHaveAttribute('data-expires-at', expiresAt);
  });
  act(() => jest.advanceTimersByTime(20));
  expect(pointer.style.transform).not.toBe(reversalAngle);
  expect(Number(pointer.style.transform.match(/[-\d.]+/)[0]))
    .toBeLessThan(Number(reversalAngle.match(/[-\d.]+/)[0]));

  act(() => jest.advanceTimersByTime(150));
  expect(screen.queryAllByTestId('active-target').length).toBeGreaterThan(count - 1);
});

test('miss and expired targets do not reverse direction', () => {
  render(<LockpickMinigame config={{ ...config, targetLifetimeMs: 10 }} random={() => 0.25} />);
  start();
  const game = screen.getByLabelText('Взлом замка сокровищницы');
  act(() => jest.advanceTimersByTime(20));
  expect(game).toHaveAttribute('data-direction', '1');
  fireEvent.pointerDown(game);
  expect(game).toHaveAttribute('data-direction', '1');
  act(() => jest.advanceTimersByTime(20));
  expect(game).toHaveAttribute('data-direction', '1');
});

test('four hits can select any active target without freezing rotation and lock result input', () => {
  const onSuccess = jest.fn();
  const values = [0.25, 0.6, 0.9, 0.25, 0.6, 0.9, 0.25];
  render(<LockpickMinigame config={config} random={() => values.shift() ?? 0.25} onSuccess={onSuccess} />);
  start();
  const game = screen.getByLabelText('Взлом замка сокровищницы');
  for (let hit = 1; hit <= 4; hit += 1) {
    act(() => jest.advanceTimersByTime(20));
    const target = screen.getAllByTestId('active-target')[0];
    const center = Number(target.getAttribute('data-center'));
    const pointer = screen.getByTestId('lock-pointer');
    const current = Number(pointer.style.transform.match(/[-\d.]+/)[0]);
    const direction = Number(game.getAttribute('data-direction'));
    const travelDegrees = direction === 1
      ? (center - current + 360) % 360
      : (current - center + 360) % 360;
    const travel = travelDegrees / 360 * config.rotationDurationMs;
    act(() => jest.advanceTimersByTime(travel));
    fireEvent.pointerDown(game);
    expect(screen.getByText(`${hit} / 4`)).toBeInTheDocument();
    expect(game).toHaveAttribute('data-direction', String(direction * -1));
  }
  expect(game).toHaveAttribute('data-phase', 'SUCCESS');
  fireEvent.pointerDown(game);
  expect(screen.getByText('4 / 4')).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(299));
  expect(onSuccess).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(onSuccess).toHaveBeenCalledTimes(1);
});

test('timeout blocks input, unmount cancels result callback, and remount resets state', () => {
  const onFail = jest.fn();
  const view = render(<LockpickMinigame config={config} random={() => 0.5} onFail={onFail} />);
  start();
  act(() => jest.advanceTimersByTime(config.timeLimitMs + 20));
  const game = screen.getByLabelText('Взлом замка сокровищницы');
  expect(game).toHaveAttribute('data-phase', 'FAILURE');
  fireEvent.pointerDown(game);
  expect(screen.getByText('0 / 4')).toBeInTheDocument();
  view.unmount();
  act(() => jest.runOnlyPendingTimers());
  expect(onFail).not.toHaveBeenCalled();
  render(<LockpickMinigame config={config} random={() => 0.5} />);
  expect(screen.getByLabelText('Взлом замка сокровищницы')).toHaveAttribute('data-phase', 'READY');
  expect(screen.getByText('0 / 4')).toBeInTheDocument();
});
