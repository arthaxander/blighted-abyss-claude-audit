import React from 'react';
import { act, createEvent, fireEvent, render as renderUi, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import FishingRoomModal from './FishingRoomModal';
import { FISHING_CONFIG } from '../minigames/fishingConfig';

const render = (...args) => {
  const result = renderUi(...args);
  const artwork = result.container.querySelector('.fishing__artwork');
  if (artwork) fireEvent.load(artwork);
  return result;
};

const challenge = {
  location: 'Гоблинские Норы', fish: { name: 'Сумрачный пескарь', difficulty: 1 },
  setup: { rod: 'Костяная удочка', bait: '' }, controlBonus: 0, calmDurationBonusMs: 0,
  rewards: { fishItem: 'Сумрачный пескарь', silver: 18 },
};
const config = { ...FISHING_CONFIG, startingDelayMs: 100, calmDurationMinMs: 300, calmDurationMaxMs: 300, warningDurationMinMs: 100, warningDurationMaxMs: 100, surgeDurationMinMs: 200, surgeDurationMaxMs: 200, resultFadeInMs: 100, resultHoldMs: 100, resultFadeOutMs: 100 };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('scene has an opaque isolated artwork root and one permanently mounted directional canvas', () => {
  render(<FishingRoomModal challenge={challenge} config={config} random={() => 0.5} />);
  const game = screen.getByLabelText('Рыбалка');
  const canvas = screen.getByTestId('directional-canvas');
  expect(game).toHaveAttribute('data-wake-visible', 'false');
  expect(game).toHaveAttribute('data-directional-renderer', 'canvas-2d');
  expect(screen.getAllByTestId('directional-canvas')).toHaveLength(1);
  expect(canvas).toBeInTheDocument();
  expect(game.style.backgroundImage).toContain('fishing_goblins_water');

  const css = fs.readFileSync(path.join(process.cwd(), 'src/components/FishingRoomModal.css'), 'utf8');
  const rootRule = css.slice(css.indexOf('.fishing{'), css.indexOf('}', css.indexOf('.fishing{')) + 1);
  expect(rootRule).toContain('position:fixed');
  expect(rootRule).toContain('inset:0');
  expect(rootRule).toContain('background-color:#071011');
  expect(rootRule).toContain('isolation:isolate');
  expect(rootRule).toContain('contain:paint');
  expect(rootRule).toContain('overflow:hidden');
});

const start = () => {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'НАЧАТЬ' }), { pointerId: 1 });
  expect(screen.getByLabelText('Рыбалка')).toHaveAttribute('data-phase', 'STARTING');
  act(() => jest.advanceTimersByTime(config.startingDelayMs));
};

test('READY is inert and start pointer does not become gameplay hold', () => {
  render(<FishingRoomModal challenge={challenge} config={config} random={() => 0.5} />);
  const game = screen.getByLabelText('Рыбалка');
  expect(game).toHaveAttribute('data-phase', 'READY');
  expect(game).toHaveAttribute('data-pulling', 'false');
  const progress = screen.getByLabelText('Прогресс поимки').textContent;
  fireEvent.pointerDown(game, { pointerId: 2 });
  act(() => jest.advanceTimersByTime(500));
  expect(screen.getByLabelText('Прогресс поимки')).toHaveTextContent(progress);
  start();
  expect(game).toHaveAttribute('data-phase', 'PLAYING');
  expect(game).toHaveAttribute('data-pulling', 'false');
});

test('PLAYING pointer down/up/cancel toggle pulling across the full playfield', () => {
  render(<FishingRoomModal challenge={challenge} config={config} random={() => 0.5} />);
  start();
  const game = screen.getByLabelText('Рыбалка');
  fireEvent.pointerDown(game, { pointerId: 3 });
  expect(game).toHaveAttribute('data-pulling', 'true');
  fireEvent.pointerUp(game, { pointerId: 3 });
  expect(game).toHaveAttribute('data-pulling', 'false');
  fireEvent.pointerDown(game, { pointerId: 4 });
  fireEvent.pointerCancel(game, { pointerId: 4 });
  expect(game).toHaveAttribute('data-pulling', 'false');
});

test('directional pointer trajectory follows a surge and pointercancel clears tracking', () => {
  const directional = { ...config, calmDurationMinMs: 100, calmDurationMaxMs: 100,
    warningDurationMinMs: 500, warningDurationMaxMs: 500, directionalSurgeChance: 1 };
  render(<FishingRoomModal challenge={challenge} config={directional} random={() => 0} />);
  start();
  const game = screen.getByLabelText('Рыбалка');
  const down = createEvent.pointerDown(game);
  Object.assign(down, { pointerId: 9, clientX: 20, clientY: 20 });
  fireEvent(game, down);
  act(() => jest.advanceTimersByTime(120));
  expect(game).toHaveAttribute('data-directional', 'true');
  expect(game).toHaveAttribute('data-wake-visible', 'true');
  const fishBeforeMove = game.getAttribute('data-fish-x');
  const move = createEvent.pointerMove(game);
  Object.assign(move, { pointerId: 9, clientX: 80, clientY: 20 });
  fireEvent(game, move);
  expect(game).toHaveAttribute('data-directional-followed', 'true');
  expect(game).toHaveAttribute('data-fish-x', fishBeforeMove);
  expect(screen.getByTestId('directional-canvas')).toBeInTheDocument();
  const cancel = createEvent.pointerCancel(game);
  Object.assign(cancel, { pointerId: 9 });
  fireEvent(game, cancel);
  expect(game).toHaveAttribute('data-pulling', 'false');
});

test('directional canvas stays mounted across surge state changes', () => {
  render(<FishingRoomModal challenge={challenge} config={config} random={() => 0.5} />);
  const canvas = screen.getByTestId('directional-canvas');
  expect(screen.getByTestId('shimmer-highlight')).toBeInTheDocument();
  start();
  act(() => jest.advanceTimersByTime(700));
  expect(screen.getByTestId('directional-canvas')).toBe(canvas);
  expect(screen.getAllByTestId('directional-canvas')).toHaveLength(1);
});

test('result locks input, resolves once after lifecycle animation, and remount resets', () => {
  const onSuccess = jest.fn();
  const fast = { ...config, catchProgressStart: 99, calmPullProgressPerSec: 100 };
  const view = render(<FishingRoomModal challenge={challenge} config={fast} random={() => 0.5} onSuccess={onSuccess} />);
  start();
  const game = screen.getByLabelText('Рыбалка');
  fireEvent.pointerDown(game, { pointerId: 5 });
  act(() => jest.advanceTimersByTime(40));
  expect(game).toHaveAttribute('data-phase', 'SUCCESS');
  expect(screen.getByText('РЫБА ПОЙМАНА')).toBeInTheDocument();
  fireEvent.pointerDown(game, { pointerId: 6 });
  expect(game).toHaveAttribute('data-pulling', 'false');
  act(() => jest.advanceTimersByTime(300));
  expect(onSuccess).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<FishingRoomModal challenge={challenge} config={config} random={() => 0.5} />);
  expect(screen.getByLabelText('Рыбалка')).toHaveAttribute('data-phase', 'READY');
  expect(screen.getByLabelText('Прогресс поимки')).toHaveTextContent('0%');
});

test('failure locks input and resolves its callback exactly once', () => {
  const onFail = jest.fn();
  const breaking = { ...config, tensionStart: 99, surgePullTensionPerSec: 100, calmPullTensionPerSec: 100 };
  render(<FishingRoomModal challenge={challenge} config={breaking} random={() => 0.5} onFail={onFail} />);
  start();
  const game = screen.getByLabelText('Рыбалка');
  fireEvent.pointerDown(game, { pointerId: 7 });
  act(() => jest.advanceTimersByTime(40));
  expect(screen.getByText('ЛЕСКА ОБОРВАЛАСЬ')).toBeInTheDocument();
  fireEvent.pointerDown(game, { pointerId: 8 });
  expect(game).toHaveAttribute('data-pulling', 'false');
  act(() => jest.advanceTimersByTime(300));
  expect(onFail).toHaveBeenCalledTimes(1);
  expect(onFail).toHaveBeenCalledWith('Леска оборвалась.');
});



test('StrictMode starts the game and allows leaving during play', () => {
  const close = jest.fn();
  render(<React.StrictMode><FishingRoomModal challenge={challenge} config={config} onClose={close} /></React.StrictMode>);
  start();
  expect(screen.getByLabelText('Рыбалка')).toHaveAttribute('data-phase', 'PLAYING');
  fireEvent.click(screen.getByRole('button', { name: 'Прекратить ловлю' }));
  expect(close).toHaveBeenCalledTimes(1);
});

test('a second finger cannot replace or release the active finger', () => {
  render(<FishingRoomModal challenge={challenge} config={config} />);
  start();
  const game = screen.getByLabelText('Рыбалка');
  const pointer = (type, id) => {
    const event = createEvent[type](game);
    Object.assign(event, { pointerId: id, clientX: 100, clientY: 200 });
    fireEvent(game, event);
  };
  pointer('pointerDown', 1);
  pointer('pointerDown', 2);
  pointer('pointerUp', 2);
  expect(game).toHaveAttribute('data-pulling', 'true');
  pointer('pointerUp', 1);
  expect(game).toHaveAttribute('data-pulling', 'false');
});

test('slack produces its own failure message once', () => {
  const onFail = jest.fn();
  render(<FishingRoomModal challenge={challenge} config={{ ...config, tensionStart: 0.1 }} onFail={onFail} />);
  start();
  act(() => jest.advanceTimersByTime(40));
  expect(screen.getByText('РЫБА СОШЛА')).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(500));
  expect(onFail).toHaveBeenCalledTimes(1);
  expect(onFail).toHaveBeenCalledWith('Рыба сошла с крючка.');
});

test('does not start on an empty scene and allows retrying failed artwork', () => {
  const { container } = renderUi(<FishingRoomModal challenge={challenge} />);
  expect(screen.getByRole('button', { name: 'ЗАГРУЗКА ВОДОЁМА…' })).toBeDisabled();
  fireEvent.error(container.querySelector('.fishing__artwork'));
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить водоём');
  fireEvent.click(screen.getByRole('button', { name: 'ПОВТОРИТЬ ЗАГРУЗКУ' }));
  expect(container.querySelector('.fishing__artwork').src).toContain('?retry=1');
  fireEvent.load(container.querySelector('.fishing__artwork'));
  expect(screen.getByRole('button', { name: 'НАЧАТЬ' })).toBeEnabled();
});



test.each([[0, 305], [40, 197], [100, 35]])('tension %s uses the fixed arc position and remains separate from catch progress', (tension, y) => {
  render(<FishingRoomModal challenge={challenge} config={{ ...config, tensionStart: tension }} />);
  expect(screen.getByRole('meter', { name: 'Натяжение лески' })).toHaveAttribute('aria-valuenow', String(tension));
  expect(screen.getByTestId('tension-marker').getAttribute('d')).toContain(` ${y - 8} l6 8`);
  expect(screen.getByRole('progressbar', { name: 'Поимка' })).toHaveAttribute('aria-valuenow', '0');
});

test('slack warning takes priority over releasing during an ordinary surge', () => {
  render(<FishingRoomModal challenge={challenge} config={{ ...config, tensionStart: 14, releasedTensionRecoveryPerSec: 0, directionalSurgeChance: 0 }} random={() => 0.5} />);
  start();
  act(() => jest.advanceTimersByTime(340));
  expect(screen.getByRole('status')).toHaveTextContent('ТЯНИТЕ — СЛАБИНА');
});
