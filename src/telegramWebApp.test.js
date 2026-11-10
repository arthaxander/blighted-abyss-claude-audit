import { initializeTelegramWebApp, supportsTelegramFullscreen } from './telegramWebApp';

afterEach(() => {
  document.documentElement.removeAttribute('data-telegram-web-app');
  document.documentElement.removeAttribute('data-telegram-fullscreen-capable');
  document.documentElement.removeAttribute('data-telegram-fullscreen');
  document.documentElement.removeAttribute('style');
});

describe('Telegram WebApp bootstrap', () => {
  test('readies, expands, and requests fullscreen on Bot API 8+', () => {
    const webApp = { ready: jest.fn(), expand: jest.fn(), isVersionAtLeast: jest.fn(() => true), requestFullscreen: jest.fn() };
    expect(initializeTelegramWebApp({ WebApp: webApp })).toEqual({ available: true, fullscreenRequested: true });
    expect(webApp.ready).toHaveBeenCalledTimes(1);
    expect(webApp.expand).toHaveBeenCalledTimes(1);
    expect(webApp.isVersionAtLeast).toHaveBeenCalledWith('8.0');
    expect(webApp.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  test('tracks actual fullscreen state for foreground safe-area fallbacks', () => {
    const callbacks = {};
    const webApp = { ready: jest.fn(), expand: jest.fn(), isVersionAtLeast: () => true, requestFullscreen: jest.fn(), isFullscreen: false, onEvent: jest.fn((name, callback) => { callbacks[name] = callback; }) };
    initializeTelegramWebApp({ WebApp: webApp });
    expect(document.documentElement).not.toHaveAttribute('data-telegram-fullscreen');
    expect(webApp.onEvent).toHaveBeenCalledWith('fullscreenChanged', expect.any(Function));
    webApp.isFullscreen = true; callbacks.fullscreenChanged();
    expect(document.documentElement).toHaveAttribute('data-telegram-fullscreen', 'true');
    webApp.isFullscreen = false; callbacks.fullscreenChanged();
    expect(document.documentElement).not.toHaveAttribute('data-telegram-fullscreen');
  });

  test('keeps expanded mode when fullscreen is unsupported', () => {
    const webApp = { ready: jest.fn(), expand: jest.fn(), isVersionAtLeast: jest.fn(() => false) };
    expect(supportsTelegramFullscreen(webApp)).toBe(false);
    expect(initializeTelegramWebApp({ WebApp: webApp })).toEqual({ available: true, fullscreenRequested: false });
    expect(webApp.expand).toHaveBeenCalledTimes(1);
  });

  test('syncs both canonical safe areas initially and on every Telegram change', () => {
    const callbacks = {};
    const webApp = {
      ready: jest.fn(), expand: jest.fn(), isVersionAtLeast: () => true, requestFullscreen: jest.fn(),
      safeAreaInset: { top: 24, right: 1, bottom: 5, left: 2 },
      contentSafeAreaInset: { top: 47, right: 3, bottom: 8, left: 4 },
      onEvent: jest.fn((name, callback) => { callbacks[name] = callback; }),
    };
    initializeTelegramWebApp({ WebApp: webApp });
    expect(document.documentElement).toHaveStyle('--tg-content-safe-area-inset-top: 47px');
    expect(document.documentElement).toHaveStyle('--tg-safe-area-inset-top: 24px');
    expect(document.documentElement).toHaveAttribute('data-telegram-fullscreen-capable', 'true');
    webApp.contentSafeAreaInset = { top: 61, right: 0, bottom: 9, left: 0 };
    callbacks.contentSafeAreaChanged();
    expect(document.documentElement).toHaveStyle('--tg-content-safe-area-inset-top: 61px');
    expect(document.documentElement).toHaveStyle('--tg-content-safe-area-inset-bottom: 9px');
    webApp.safeAreaInset = { top: 31, right: 2, bottom: 6, left: 1 };
    callbacks.safeAreaChanged();
    expect(document.documentElement).toHaveStyle('--tg-safe-area-inset-top: 31px');
    webApp.safeAreaInset.top = 35;
    webApp.contentSafeAreaInset.top = 70;
    callbacks.fullscreenChanged();
    expect(document.documentElement).toHaveStyle('--tg-safe-area-inset-top: 35px');
    expect(document.documentElement).toHaveStyle('--tg-content-safe-area-inset-top: 70px');
  });

  test('does not throw outside Telegram or when fullscreen fails', async () => {
    expect(() => initializeTelegramWebApp(undefined)).not.toThrow();
    const webApp = { ready: jest.fn(), expand: jest.fn(), isVersionAtLeast: () => true, requestFullscreen: () => Promise.reject(new Error('denied')) };
    expect(() => initializeTelegramWebApp({ WebApp: webApp })).not.toThrow();
    await Promise.resolve();
  });
});
