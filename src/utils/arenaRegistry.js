const REGISTRY_KEY = 'ashenAbyssArenaRegistry';

const readRegistry = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Ошибка чтения реестра арены', error);
    return [];
  }
};

const writeRegistry = (entries) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('Ошибка записи реестра арены', error);
  }
};

export const listArenaRegistry = () => readRegistry();

export const publishDefenseSnapshot = (snapshot, meta = {}) => {
  if (!snapshot) return null;
  const entries = readRegistry();
  const candidate = {
    id: meta.id || snapshot.id || `registry-${Math.random().toString(36).slice(2, 9)}`,
    rating: meta.rating ?? 1000,
    name: meta.name || snapshot.name || 'Фантом защитника',
    snapshot,
    updatedAt: Date.now(),
  };
  const existingIndex = entries.findIndex(entry => entry.id === candidate.id);
  if (existingIndex >= 0) {
    entries[existingIndex] = candidate;
  } else {
    entries.push(candidate);
  }
  writeRegistry(entries);
  return candidate;
};

export const pruneArenaRegistry = (maxEntries = 50, maxAgeMs = 1000 * 60 * 60 * 24 * 7) => {
  const now = Date.now();
  const entries = readRegistry()
    .filter(entry => entry.snapshot)
    .filter(entry => now - (entry.updatedAt || now) < maxAgeMs)
    .slice(-maxEntries);
  writeRegistry(entries);
  return entries;
};

