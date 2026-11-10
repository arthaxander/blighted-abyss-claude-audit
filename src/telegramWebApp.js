export const supportsTelegramFullscreen = webApp => {
  if (!webApp || typeof webApp.requestFullscreen !== 'function') return false;
  try {
    return typeof webApp.isVersionAtLeast === 'function' && webApp.isVersionAtLeast('8.0');
  } catch (_) {
    return false;
  }
};

const safelyCall = callback => {
  try {
    const result = callback();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (_) {
    // Telegram APIs are optional: expanded/browser mode remains fully usable.
  }
};

const setFullscreenDocumentState = (webApp, target = typeof document === 'undefined' ? undefined : document) => {
  if (!target?.documentElement) return;
  if (webApp?.isFullscreen) target.documentElement.dataset.telegramFullscreen = 'true';
  else delete target.documentElement.dataset.telegramFullscreen;
};

const insetValue = value => `${Math.max(0, Number(value) || 0)}px`;

const syncInsetSet = (root, prefix, inset = {}) => {
  ['top', 'right', 'bottom', 'left'].forEach(side => root.style.setProperty(`${prefix}-${side}`, insetValue(inset[side])));
};

export const syncTelegramSafeAreas = (webApp, target = typeof document === 'undefined' ? undefined : document) => {
  const root = target?.documentElement;
  if (!root || !webApp) return;
  syncInsetSet(root, '--tg-safe-area-inset', webApp.safeAreaInset);
  syncInsetSet(root, '--tg-content-safe-area-inset', webApp.contentSafeAreaInset);
};

export const syncTelegramContentSafeArea = syncTelegramSafeAreas;

export const initializeTelegramWebApp = (telegram = typeof window === 'undefined' ? undefined : window.Telegram) => {
  const webApp = telegram?.WebApp;
  if (!webApp) return { available: false, fullscreenRequested: false };
  if (typeof document !== 'undefined') document.documentElement.dataset.telegramWebApp = 'true';
  if (typeof webApp.ready === 'function') safelyCall(() => webApp.ready());
  if (typeof webApp.expand === 'function') safelyCall(() => webApp.expand());
  setFullscreenDocumentState(webApp);
  syncTelegramSafeAreas(webApp);
  if (typeof webApp.onEvent === 'function') {
    safelyCall(() => webApp.onEvent('fullscreenChanged', () => { setFullscreenDocumentState(webApp); syncTelegramSafeAreas(webApp); }));
    safelyCall(() => webApp.onEvent('safeAreaChanged', () => syncTelegramSafeAreas(webApp)));
    safelyCall(() => webApp.onEvent('contentSafeAreaChanged', () => syncTelegramSafeAreas(webApp)));
  }
  const fullscreenRequested = supportsTelegramFullscreen(webApp);
  if (fullscreenRequested && typeof document !== 'undefined') document.documentElement.dataset.telegramFullscreenCapable = 'true';
  if (fullscreenRequested) safelyCall(() => webApp.requestFullscreen());
  return { available: true, fullscreenRequested };
};
