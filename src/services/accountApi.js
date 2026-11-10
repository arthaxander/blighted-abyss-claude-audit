export const resolveApiBase = ({ nodeEnv = process.env.NODE_ENV, configuredBase = process.env.REACT_APP_API_BASE } = {}) => nodeEnv === 'production' ? '' : (configuredBase || '').replace(/\/$/, '');
const API_BASE = resolveApiBase();
let requestSequence = 0;
const nextRequestId = () => `save-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`;
export const firstSaveDifference = (left, right, path = '$') => {
  if (Object.is(left, right)) return null;
  const type = value => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const leftType = type(left); const rightType = type(right);
  if (leftType !== rightType) return { path, kind: 'type', leftType, rightType };
  if (leftType !== 'object' && leftType !== 'array') return { path, kind: 'value', leftType, rightType };
  if (leftType === 'array' && left.length !== right.length) return { path, kind: 'array-length', leftType, rightType };
  const leftKeys = Object.keys(left); const rightKeys = Object.keys(right);
  const missing = leftKeys.find(key => !Object.prototype.hasOwnProperty.call(right, key));
  if (missing !== undefined) return { path: `${path}.${missing}`, kind: 'missing-key', leftType: type(left[missing]), rightType: 'missing' };
  const extra = rightKeys.find(key => !Object.prototype.hasOwnProperty.call(left, key));
  if (extra !== undefined) return { path: `${path}.${extra}`, kind: 'extra-key', leftType: 'missing', rightType: type(right[extra]) };
  for (const key of leftKeys) {
    const difference = firstSaveDifference(left[key], right[key], leftType === 'array' ? `${path}[${key}]` : `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
};
const request = async (path, options = {}) => {
  // A stalled proxy must not leave the Telegram WebView loading indefinitely.
  // Do not automatically retry writes: an acknowledged network timeout can
  // still represent a committed SQLite revision on the server.
  const timeoutMs = options.method === 'PUT' || (options.method === 'POST' && path.includes('/save/')) ? 20000 : 12000;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options, ...(controller ? { signal: controller.signal } : {}) });
    // Keep the deadline active while reading the body, too. Headers alone do
    // not acknowledge a save, and a stalled body used to block the whole queue.
    const body = response.status === 204 ? null : await response.json().catch(error => {
      if (controller?.signal?.aborted) throw error;
      return {};
    });
    if (!response.ok) { const error = new Error(body?.error || 'server-request-failed'); error.code = body?.error || 'server-request-failed'; error.status = response.status; error.account = body?.account; error.diagnostic = body?.diagnostic || null; throw error; }
    return body;
  } catch (cause) {
    if (cause?.status) throw cause;
    const timedOut = cause?.name === 'AbortError' || controller?.signal?.aborted;
    throw Object.assign(new Error(timedOut ? 'api-timeout' : 'api-unreachable'), { code: timedOut ? 'api-timeout' : 'api-unreachable', cause });
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
};
export const authenticateTelegram = initData => request('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) });
export const authenticateDev = () => request('/api/auth/dev', { method: 'POST', body: '{}' });
export const loadAccount = () => request('/api/account');
export const setAccountName = name => request('/api/account/name', { method: 'PUT', body: JSON.stringify({ name }) });
export const saveAccountState = ({ save, revision, schemaVersion, requestId }) => request('/api/save', { method: 'PUT', headers: { 'x-save-request-id': requestId }, body: JSON.stringify({ save, revision, schemaVersion }) });
export const resetAccountSave = revision => request('/api/save/reset', { method: 'POST', body: JSON.stringify({ revision }) });
export const logoutAccount = () => request('/api/logout', { method: 'POST', body: '{}' });

// This is the final boundary before a save becomes a request body.  Most callers
// use serializePersistentGameState, but keeping the compatibility copy canonical
// here also covers an already-running/older gameplay path which hands the queue a
// player snapshot directly.  The server intentionally treats the root copy as
// authoritative, so never allow the embedded copy to disagree on the wire.
const canonicalizeWireProgressionCopies = save => {
  const root = save?.classProgression;
  const embedded = save?.player?.classProgression;
  const progression = root && (Object.keys(root).length > 0 || !embedded) ? root : embedded || root;
  if (!progression || !save?.player) return save;
  save.classProgression = progression;
  save.player.classProgression = progression;
  return save;
};

// Only pure map travel may supersede another pending write. Everything except
// position/fog must match, including rewards, keys, HP, resolved cells, selected
// branch, progression and combat. Thus boss/loot/level transitions stay barriers.
const mapTravelSaveKey = save => {
  const map = save?.player?.expeditionMap;
  if (save?.currentScreen !== 'dungeon' || save.activeCombat || save.pendingLoot
    || save.player?.expeditionMapRoomActive || map?.pendingCellId || !map?.mainLayout?.cells) return null;
  return JSON.stringify({ ...save, player: { ...save.player, expeditionMap: {
    ...map, mainLayout: { ...map.mainLayout, currentCellId: null,
      cells: map.mainLayout.cells.map(({ visited, revealed, ...cell }) => cell),
    },
  } } });
};

export const createSerializedSaveQueue = ({ initialRevision = 0, onConflict, write = saveAccountState } = {}) => {
  let revision = initialRevision; let tail = Promise.resolve(); let generation = 0; let latestAccount = null;
  let pendingTravel = null;
  let lastEntry = null;
  const enqueue = (save, schemaVersion = 1) => {
    const wireSave = canonicalizeWireProgressionCopies(JSON.parse(JSON.stringify(save)));
    const payload = JSON.stringify(wireSave);
    // A committed checkpoint is also observed by the autosave effect. Reuse
    // its acknowledgment instead of uploading the same map/state a second time.
    if (lastEntry?.payload === payload && lastEntry.schemaVersion === schemaVersion) return lastEntry.promise;
    const travelKey = mapTravelSaveKey(wireSave);
    if (travelKey && pendingTravel?.key === travelKey && pendingTravel.schemaVersion === schemaVersion) {
      pendingTravel.save = wireSave;
      pendingTravel.payload = payload;
      return pendingTravel.promise;
    }
    const entry = { save: wireSave, key: travelKey, schemaVersion, payload };
    lastEntry = entry;
    pendingTravel = travelKey ? entry : null;
    const requestId = nextRequestId();
    const operationGeneration = generation;
    const operation = tail.then(async () => {
      if (pendingTravel === entry) pendingTravel = null;
      if (operationGeneration !== generation) return latestAccount;
      const difference = firstSaveDifference(entry.save?.classProgression, entry.save?.player?.classProgression);
      try { const result = await write({ save: entry.save, revision, schemaVersion, requestId }); revision = result.account.revision; latestAccount = result.account; return result.account; }
      catch (error) { if (lastEntry === entry) lastEntry = null; if (error.status === 409) { revision = error.account?.revision ?? revision; onConflict?.(error.account); } console.warn('[save-request-failed]', { requestId, code: error.code || 'unknown', progressionDifference: difference }); throw error; }
    });
    entry.promise = operation;
    tail = operation.catch(() => {});
    return operation;
  };
  const replace = (save, schemaVersion = 1) => {
    pendingTravel = null;
    lastEntry = null;
    const requestId = nextRequestId();
    const wireSave = canonicalizeWireProgressionCopies(JSON.parse(JSON.stringify(save)));
    generation += 1;
    const replacementGeneration = generation;
    const operation = tail.then(async () => {
      if (replacementGeneration !== generation) return latestAccount;
      try { const result = await write({ save: wireSave, revision, schemaVersion, requestId }); revision = result.account.revision; latestAccount = result.account; return result.account; }
      catch (error) { if (error.status === 409) { revision = error.account?.revision ?? revision; onConflict?.(error.account); } throw error; }
    });
    tail = operation.catch(() => {});
    return operation;
  };
  return { enqueue, replace, getRevision: () => revision };
};

