const STORAGE_KEY = 'ashenAbyssClientPreferences';
const CHANGE_EVENT = 'ashen-abyss-client-preferences-change';
let orientationPermissionGranted = false;

export const DEFAULT_CLIENT_PREFERENCES = Object.freeze({ depthEffectEnabled: true });
export const CLIENT_PREFERENCE_DEFINITIONS = Object.freeze({
  depthEffectEnabled: {
    label: 'Эффект глубины',
    description: 'Лёгкое движение фоновых иллюстраций при наклоне телефона',
  },
});

export const getClientPreferences = () => {
  if (typeof window === 'undefined') return { ...DEFAULT_CLIENT_PREFERENCES };
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_CLIENT_PREFERENCES, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch (_error) { return { ...DEFAULT_CLIENT_PREFERENCES }; }
};

export const setClientPreference = (name, value) => {
  const preferences = { ...getClientPreferences(), [name]: value };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch (_error) { /* Defaults remain usable. */ }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: preferences }));
  return preferences;
};

export const subscribeToClientPreferences = callback => {
  const handleChange = event => callback(event.detail || getClientPreferences());
  window.addEventListener(CHANGE_EVENT, handleChange);
  return () => window.removeEventListener(CHANGE_EVENT, handleChange);
};

// Call from a user gesture when a settings surface is added; never call during startup.
export const enableDepthEffect = async () => {
  const OrientationEvent = window.DeviceOrientationEvent;
  if (typeof OrientationEvent?.requestPermission === 'function') {
    try {
      if (await OrientationEvent.requestPermission() !== 'granted') return false;
      orientationPermissionGranted = true;
    } catch (_error) { return false; }
  }
  setClientPreference('depthEffectEnabled', true);
  return true;
};

export const hasOrientationPermission = () => orientationPermissionGranted;

export { STORAGE_KEY as CLIENT_PREFERENCES_STORAGE_KEY };
