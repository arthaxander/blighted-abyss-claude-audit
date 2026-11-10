import React from 'react';
import { act, render, screen } from '@testing-library/react';
import GuildHall from './GuildHall';
import { MAX_PARALLAX_X, MAX_PARALLAX_Y, orientationToTranslation, telegramRadiansToDegrees } from './useGuildHallParallax';
import { CLIENT_PREFERENCES_STORAGE_KEY, DEFAULT_CLIENT_PREFERENCES } from '../../utils/clientPreferences';

const originalOrientation = window.DeviceOrientationEvent;
let reduced = false;
let mediaListeners = [];

beforeEach(() => {
  localStorage.clear();
  reduced = false;
  mediaListeners = [];
  window.matchMedia = jest.fn(() => ({ get matches() { return reduced; }, addEventListener: (_type, fn) => mediaListeners.push(fn), removeEventListener: (_type, fn) => { mediaListeners = mediaListeners.filter(item => item !== fn); } }));
  window.DeviceOrientationEvent = function DeviceOrientationEvent() {};
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.cancelAnimationFrame = jest.fn();
});

afterEach(() => { window.DeviceOrientationEvent = originalOrientation; delete window.Telegram; jest.restoreAllMocks(); });

const hall = () => render(<GuildHall onOpenService={jest.fn()} onStartRun={jest.fn()} />);

test('depth effect preference is enabled by default', () => {
  expect(DEFAULT_CLIENT_PREFERENCES.depthEffectEnabled).toBe(true);
});

test('disabled preference does not attach the orientation listener', () => {
  localStorage.setItem(CLIENT_PREFERENCES_STORAGE_KEY, JSON.stringify({ depthEffectEnabled: false }));
  const add = jest.spyOn(window, 'addEventListener');
  hall();
  expect(add).not.toHaveBeenCalledWith('deviceorientation', expect.any(Function), expect.anything());
});

test('reduced motion and a missing API both keep a static fallback', () => {
  reduced = true;
  const add = jest.spyOn(window, 'addEventListener');
  const first = hall();
  expect(add).not.toHaveBeenCalledWith('deviceorientation', expect.any(Function), expect.anything());
  first.unmount();
  reduced = false;
  delete window.DeviceOrientationEvent;
  const second = hall();
  expect(screen.getByTestId('guild-hall-background')).toHaveStyle('transform: translate3d(0px, 0px, 0) scale(1.04)');
  second.unmount();
});

test('listener is removed when leaving Hall', () => {
  const remove = jest.spyOn(window, 'removeEventListener');
  const view = hall();
  view.unmount();
  expect(remove).toHaveBeenCalledWith('deviceorientation', expect.any(Function));
});

test('orientation values are clamped for every screen orientation', () => {
  [0, 90, 180, 270].forEach(angle => {
    const value = orientationToTranslation(1000, -1000, angle);
    expect(Math.abs(value.x)).toBeLessThanOrEqual(MAX_PARALLAX_X);
    expect(Math.abs(value.y)).toBeLessThanOrEqual(MAX_PARALLAX_Y);
  });
});

test('a reduced-motion change detaches an active listener and resets the layer', () => {
  const remove = jest.spyOn(window, 'removeEventListener');
  hall();
  reduced = true;
  act(() => mediaListeners.forEach(listener => listener()));
  expect(remove).toHaveBeenCalledWith('deviceorientation', expect.any(Function));
  expect(screen.getByTestId('guild-hall-background')).toHaveStyle('transform: translate3d(0px, 0px, 0) scale(1.04)');
});

test('Telegram native orientation radians move the Hall layer and are stopped on cleanup', () => {
  window.requestAnimationFrame = callback => { callback(); return null; };
  const events = {};
  const deviceOrientation = { start: jest.fn((_params, callback) => callback(true)), stop: jest.fn() };
  window.Telegram = { WebApp: {
    DeviceOrientation: deviceOrientation,
    onEvent: jest.fn((name, callback) => { events[name] = callback; }),
    offEvent: jest.fn((name, callback) => { if (events[name] === callback) delete events[name]; }),
  } };
  expect(telegramRadiansToDegrees(Math.PI / 6)).toBeCloseTo(30);
  const view = hall();
  expect(deviceOrientation.start).toHaveBeenCalledWith({ refresh_rate: 50, need_absolute: false }, expect.any(Function));
  act(() => {
    events.deviceOrientationChanged({ beta: 0, gamma: 0 });
    events.deviceOrientationChanged({ beta: Math.PI / 12, gamma: Math.PI / 10 });
  });
  expect(screen.getByTestId('guild-hall-background').style.transform).not.toBe('translate3d(0.00px, 0.00px, 0) scale(1.04)');
  view.unmount();
  expect(deviceOrientation.stop).toHaveBeenCalledTimes(1);
  expect(window.Telegram.WebApp.offEvent).toHaveBeenCalledWith('deviceOrientationChanged', expect.any(Function));
});

test('Telegram orientation failure stops native tracking and falls back without duplicate sources', () => {
  const events = {};
  const add = jest.spyOn(window, 'addEventListener');
  const deviceOrientation = { start: jest.fn(), stop: jest.fn() };
  window.Telegram = { WebApp: {
    DeviceOrientation: deviceOrientation,
    onEvent: jest.fn((name, callback) => { events[name] = callback; }),
    offEvent: jest.fn(),
  } };
  hall();
  expect(add).not.toHaveBeenCalledWith('deviceorientation', expect.any(Function), expect.anything());
  act(() => events.deviceOrientationFailed({ error: 'UNSUPPORTED' }));
  expect(deviceOrientation.stop).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledWith('deviceorientation', expect.any(Function), { passive: true });
});
