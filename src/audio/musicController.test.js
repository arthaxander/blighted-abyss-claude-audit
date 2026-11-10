import { MusicController } from './musicController';
import {
  GUILD_DESCENT_FADE_OUT_MS,
  GUILD_SILENCE_MAX_MS,
  GUILD_SILENCE_MIN_MS,
  LOCATION_FADE_IN_MS,
  MUSIC_TRACKS,
  MUSIC_VOLUME,
} from './musicRegistry';

class MockAudio {
  constructor() {
    this.src = '';
    this.loop = true;
    this.currentTime = 17;
    this.volume = 1;
    this.paused = true;
    this.listeners = {};
    this.muted = true;
    this.error = null;
    this.networkState = 1;
    this.readyState = 3;
    this.duration = 91;
    this.preload = '';
    this.load = jest.fn();
    this.play = jest.fn(() => { this.paused = false; return Promise.resolve().then(() => this.emit('playing')); });
    this.pause = jest.fn(() => { this.paused = true; });
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  removeEventListener(type, fn) { if (this.listeners[type] === fn) delete this.listeners[type]; }
  emit(type) { this.listeners[type]?.(); }
}

const flush = () => Promise.resolve();

const setup = ({ random = 0.5 } = {}) => {
  let now = 0;
  let visibilityState = 'visible';
  let frameId = 0;
  const frames = new Map();
  const listeners = {};
  const document = {
    get visibilityState() { return visibilityState; },
    addEventListener: jest.fn((type, fn) => { listeners[type] = fn; }),
    removeEventListener: jest.fn((type, fn) => { if (listeners[type] === fn) delete listeners[type]; }),
  };
  const audio = new MockAudio();
  const controller = new MusicController({
    audio, document, random: () => random, now: () => now,
    requestAnimationFrame: fn => { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const advanceFrame = ms => {
    now += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(fn => fn(now));
  };
  return { audio, controller, document, listeners, advanceFrame, setNow: value => { now = value; }, setVisibility: value => { visibilityState = value; listeners.visibilitychange?.(); }, frames };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('initial Guild starts canonical track from zero and fades to background volume', async () => {
  const h = setup();
  h.controller.updateScreen('guild');
  await flush();
  expect(h.audio.src).toBe(MUSIC_TRACKS.guildHall);
  expect(h.audio.currentTime).toBe(0);
  expect(h.audio.loop).toBe(false);
  expect(h.audio.preload).toBe('auto');
  expect(h.audio.load).toHaveBeenCalledTimes(1);
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  expect(h.audio.volume).toBe(0);
  h.advanceFrame(3000);
  expect(h.audio.volume).toBeCloseTo(MUSIC_VOLUME);
  expect(h.controller.getDebugSnapshot()).toEqual(expect.objectContaining({
    fadeActive: false, fadeTarget: MUSIC_VOLUME, fadeStartVolume: 0, lastFadeError: '',
  }));
});

test('default animation wrapper calls requestAnimationFrame with Window as receiver', async () => {
  const frames = [];
  const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(function receiverSensitive(callback) {
    if (this !== window) throw new TypeError('Illegal invocation');
    frames.push(callback);
    return frames.length;
  });
  const cancelFrame = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(function receiverSensitive() {
    if (this !== window) throw new TypeError('Illegal invocation');
  });
  const audio = new MockAudio();
  const document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
  const controller = new MusicController({ audio, document, now: () => 0 });

  controller.updateScreen('guild');
  await flush();
  expect(requestFrame).toHaveBeenCalledTimes(1);
  frames[0](3000);
  expect(audio.volume).toBeCloseTo(MUSIC_VOLUME);

  controller.destroy();
  requestFrame.mockRestore();
  cancelFrame.mockRestore();
});

test('fade scheduling failure immediately restores audible Guild volume', async () => {
  const h = setup();
  const error = new TypeError('Illegal invocation');
  h.controller.requestFrame = () => { throw error; };
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  h.controller.updateScreen('guild');
  await flush();

  expect(h.audio.volume).toBe(MUSIC_VOLUME);
  expect(h.controller.getDebugSnapshot()).toEqual(expect.objectContaining({
    fadeActive: false, fadeTarget: MUSIC_VOLUME, fadeStartVolume: 0,
    lastFadeError: 'Illegal invocation',
  }));
  expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('fade scheduling failed'), error);
  consoleError.mockRestore();
});

test('debug snapshot subscription reports media state and diagnostic commands reuse the canonical audio', async () => {
  const h = setup();
  const listener = jest.fn();
  const unsubscribe = h.controller.subscribeDebug(listener);
  h.controller.updateScreen('guild');
  await flush();
  expect(h.controller.getDebugSnapshot()).toEqual(expect.objectContaining({
    src: MUSIC_TRACKS.guildHall, inGuildScope: true, readyState: 3,
    networkState: 1, hasConfirmedPlaying: true, lastMediaEvent: 'playing',
  }));
  h.controller.testGuildMusic();
  await flush();
  expect(h.audio.play).toHaveBeenCalledTimes(2);
  expect(h.audio.muted).toBe(false);
  expect(h.audio.volume).toBe(1);
  h.audio.emit('playing');
  expect(h.audio.volume).toBe(1);
  h.controller.stopMusic();
  expect(h.audio.paused).toBe(true);
  expect(h.audio.currentTime).toBe(0);
  unsubscribe();
  expect(listener).toHaveBeenCalled();
});

test('fade-out scheduling failure still stops and resets playback', async () => {
  const h = setup();
  h.controller.updateScreen('guild');
  await flush();
  h.advanceFrame(3000);
  h.audio.currentTime = 31;
  h.controller.requestFrame = () => { throw new TypeError('Illegal invocation'); };
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  h.controller.updateScreen('dungeon');

  expect(h.audio.pause).toHaveBeenCalledTimes(1);
  expect(h.audio.currentTime).toBe(0);
  expect(h.audio.volume).toBe(0);
  expect(h.controller.getDebugSnapshot().lastFadeError).toBe('Illegal invocation');
  consoleError.mockRestore();
});

test.each(['dungeon', 'combat'])('initial %s does not start Guild music', screen => {
  const h = setup();
  h.controller.updateScreen(screen);
  expect(h.audio.play).not.toHaveBeenCalled();
});

test.each([
  ['Гоблинские Норы', MUSIC_TRACKS.goblinNests],
  ['Грибные Пещеры', MUSIC_TRACKS.fungalCaves],
  ['Лагерь Отступников', MUSIC_TRACKS.deserterCamp],
  ['Лес Увядания', MUSIC_TRACKS.witheringForest],
])('known location %s starts its looping location theme', async (location, track) => {
  const h = setup();
  h.controller.updateScreen('dungeon', location);
  await flush();
  expect(h.audio.src).toBe(track);
  expect(h.audio.loop).toBe(true);
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  h.advanceFrame(LOCATION_FADE_IN_MS);
  expect(h.audio.volume).toBeCloseTo(MUSIC_VOLUME);
  expect(h.controller.getDebugSnapshot()).toEqual(expect.objectContaining({
    inGuildScope: false,
    inLocationScope: true,
    musicScope: 'location',
    locationName: location,
  }));
});

test('dungeon, combat and combat loot keep the same location track without restarting it', async () => {
  const h = setup();
  h.controller.updateScreen('dungeon', 'Лес Увядания');
  await flush();
  h.audio.currentTime = 42;
  h.controller.updateScreen('combat', 'Лес Увядания');
  h.controller.updateScreen('combatLoot', 'Лес Увядания');
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  expect(h.audio.pause).not.toHaveBeenCalled();
  expect(h.audio.currentTime).toBe(42);
  expect(h.audio.src).toBe(MUSIC_TRACKS.witheringForest);
});

test('unknown location does not start location music', () => {
  const h = setup();
  h.controller.updateScreen('dungeon', 'Неизвестная тестовая локация');
  expect(h.audio.play).not.toHaveBeenCalled();
});

test('Guild-area navigation, including location cancellation, preserves playback', async () => {
  const h = setup();
  h.controller.updateScreen('guild');
  await flush();
  h.audio.currentTime = 42;
  h.controller.updateScreen('locationSelect');
  h.controller.updateScreen('guild');
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  expect(h.audio.pause).not.toHaveBeenCalled();
  expect(h.audio.currentTime).toBe(42);
});

test('descent fades out, stops, and resets; a later Guild entry is a fresh session', async () => {
  const h = setup();
  h.controller.updateScreen('guild');
  await flush();
  h.advanceFrame(3000);
  h.audio.currentTime = 31;
  h.controller.updateScreen('locationSelect');
  h.controller.updateScreen('dungeon');
  expect(h.audio.pause).not.toHaveBeenCalled();
  h.advanceFrame(GUILD_DESCENT_FADE_OUT_MS);
  expect(h.audio.pause).toHaveBeenCalledTimes(1);
  expect(h.audio.currentTime).toBe(0);
  h.controller.updateScreen('guild');
  await flush();
  expect(h.audio.currentTime).toBe(0);
  expect(h.audio.play).toHaveBeenCalledTimes(2);
});

test('natural ending schedules a randomized silence instead of immediate replay', async () => {
  const h = setup({ random: 0.5 });
  h.controller.updateScreen('guild');
  await flush();
  h.audio.emit('ended');
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  const delay = (GUILD_SILENCE_MIN_MS + GUILD_SILENCE_MAX_MS) / 2;
  jest.advanceTimersByTime(delay - 1);
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await flush();
  expect(h.audio.play).toHaveBeenCalledTimes(2);
});

test('leaving during silence cancels delayed replay', async () => {
  const h = setup();
  h.controller.updateScreen('guild');
  await flush();
  h.audio.emit('ended');
  h.controller.updateScreen('dungeon');
  jest.runOnlyPendingTimers();
  expect(h.audio.play).toHaveBeenCalledTimes(1);
});

test('visibility pause resumes the same position with a short fade', async () => {
  const h = setup();
  h.controller.updateScreen('guild');
  await flush();
  h.audio.currentTime = 23;
  h.setVisibility('hidden');
  expect(h.audio.pause).toHaveBeenCalledTimes(1);
  h.setVisibility('visible');
  await flush();
  expect(h.audio.currentTime).toBe(23);
  expect(h.audio.play).toHaveBeenCalledTimes(2);
});

test('hidden silence retains its remaining active-time delay', async () => {
  const h = setup({ random: 0 });
  h.controller.updateScreen('guild');
  await flush();
  h.audio.emit('ended');
  h.setNow(10000);
  h.setVisibility('hidden');
  jest.advanceTimersByTime(100000);
  h.setVisibility('visible');
  jest.advanceTimersByTime(GUILD_SILENCE_MIN_MS - 10000 - 1);
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await flush();
  expect(h.audio.play).toHaveBeenCalledTimes(2);
});

test('autoplay rejection arms one gesture and retries exactly once', async () => {
  const h = setup();
  h.audio.play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })))
    .mockImplementation(() => { h.audio.paused = false; return Promise.resolve().then(() => h.audio.emit('playing')); });
  h.controller.updateScreen('guild');
  await flush();
  await flush();
  expect(h.document.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
  h.listeners.pointerdown();
  await flush();
  h.listeners.pointerdown?.();
  expect(h.audio.play).toHaveBeenCalledTimes(2);
});

test('a differently named recoverable WebView rejection keeps gesture intent and fades after playing', async () => {
  const h = setup();
  h.audio.play.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })))
    .mockImplementationOnce(() => { h.audio.paused = false; return Promise.resolve().then(() => h.audio.emit('playing')); });
  h.controller.updateScreen('guild');
  await flush(); await flush();
  expect(h.listeners.touchstart).toEqual(expect.any(Function));
  h.listeners.touchstart();
  await flush(); await flush();
  expect(h.audio.play).toHaveBeenCalledTimes(2);
  expect(h.listeners.pointerdown).toBeUndefined();
  expect(h.audio.muted).toBe(false);
  h.advanceFrame(3000);
  expect(h.audio.volume).toBeCloseTo(MUSIC_VOLUME);
});

test('media failure disarms gesture recovery and later gestures do not loop play', async () => {
  const h = setup();
  h.audio.play.mockRejectedValue(Object.assign(new Error('load failed'), { name: 'NetworkError' }));
  h.controller.updateScreen('guild');
  await flush(); await flush();
  h.audio.error = { code: 4 };
  h.audio.emit('error');
  expect(h.listeners.click).toBeUndefined();
  expect(h.audio.play).toHaveBeenCalledTimes(1);
});

test('stale autoplay rejection cannot cancel a newer successful gesture fade', async () => {
  const h = setup();
  let rejectAutoplay;
  h.audio.play.mockImplementationOnce(() => new Promise((_, reject) => { rejectAutoplay = reject; }))
    .mockImplementationOnce(() => Promise.resolve().then(() => h.audio.emit('playing')));
  h.controller.updateScreen('guild');
  h.listeners.pointerdown();
  await flush(); await flush();
  rejectAutoplay(Object.assign(new Error('late rejection'), { name: 'AbortError' }));
  await flush(); await flush();
  h.advanceFrame(3000);
  expect(h.audio.volume).toBeCloseTo(MUSIC_VOLUME);
  expect(h.listeners.pointerdown).toBeUndefined();
});

test('cleanup removes event listeners, timers, gesture intent, and animation frame', async () => {
  const h = setup();
  h.audio.play.mockRejectedValue(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  h.controller.updateScreen('guild');
  await flush();
  h.controller.armGesture();
  h.audio.emit('ended');
  h.controller.destroy();
  expect(h.frames.size).toBe(0);
  expect(h.document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  expect(h.document.removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
  expect(h.audio.listeners.ended).toBeUndefined();
  jest.runOnlyPendingTimers();
  expect(h.audio.play).toHaveBeenCalledTimes(1);
});
