import { addEffect } from './effects';
import { getEntanglementStacks, ENTANGLEMENT_MAX_STACKS } from './witheringForestEntanglement';

const ROOTS_EFFECT_ID = 'roots-of-the-fallen';
const FOREST_NAME = 'Лес Увядания';

const isForestCombat = session => Boolean(session?.state && (
  session.locationEffectId === ROOTS_EFFECT_ID || session.state.locationName === FOREST_NAME
));

function getRootsState(session) {
  if (!isForestCombat(session)) return null;
  const state = (session.state.witheringForestRoots ||= {
    nextOrigin: 0,
    triggeredOrigins: [],
  });
  state.nextOrigin = Math.max(0, Math.floor(Number(state.nextOrigin) || 0));
  if (!Array.isArray(state.triggeredOrigins)) state.triggeredOrigins = [];
  return state;
}

function allocateOrigin(state) {
  state.nextOrigin += 1;
  return `forest-action:${state.nextOrigin}`;
}

/** All direct, splash, chained and secondary packets of one player action share an origin. */
export function beginForestRootsAction(session) {
  const roots = getRootsState(session);
  if (!roots) return null;
  const origin = allocateOrigin(roots);
  session.state._forestRootsActiveOrigin = origin;
  return origin;
}

export function endForestRootsAction(session, origin) {
  if (origin && session?.state?._forestRootsActiveOrigin === origin) {
    delete session.state._forestRootsActiveOrigin;
  }
}

function resolveDeathOrigin(session, roots, deliberateAction, originActionId) {
  // Periodic damage retains the originating cast recorded on the effect, even
  // if several targets die on different turns or after saving and reloading.
  if (originActionId != null && String(originActionId).trim()) return String(originActionId);
  if (session.state._forestRootsActiveOrigin) return session.state._forestRootsActiveOrigin;
  if (deliberateAction && typeof deliberateAction === 'object') {
    if (!deliberateAction.forestRootsOriginId) {
      deliberateAction.forestRootsOriginId = allocateOrigin(roots);
    }
    return deliberateAction.forestRootsOriginId;
  }
  // An isolated environment/periodic death without cast provenance is one
  // independent event. Never reuse an unscoped, session-wide fallback key.
  return allocateOrigin(roots);
}

/** Call only after lethal-damage prevention and on-death reactions confirm death. */
export function registerForestEnemyDeath({
  session,
  unit,
  deliberateAction = null,
  originActionId = null,
  logFn = () => {},
} = {}) {
  const roots = getRootsState(session);
  if (!roots || !unit || unit.hp > 0 || unit.nonActingCombatObject) return false;
  // Enemy summons are included, even when they give neither experience nor loot.
  // Hero summons are excluded by checking the actual side, not name or ownerId.
  if (!(session.state.enemies || []).includes(unit)) return false;
  const hero = (session.state.players || []).find(player => player?.hp > 0);
  if (!hero) return false;

  const origin = resolveDeathOrigin(session, roots, deliberateAction, originActionId);
  if (roots.triggeredOrigins.includes(origin)) return false;
  // The first death uses up this origin even when a seal or debuff immunity
  // prevents application. Keep the record in JSON-serializable battle state.
  roots.triggeredOrigins.push(origin);
  if (getEntanglementStacks(hero) >= ENTANGLEMENT_MAX_STACKS) return true;

  const applied = addEffect(
    hero,
    { id: 'entanglement', stacks: 1, sourceName: 'Корни павших' },
    logFn,
    null,
    { session, origin: 'locationEffect', location: FOREST_NAME }
  );
  if (applied) logFn(`🌿 Корни павших опутывают ${hero.name || 'героя'} после гибели ${unit.name || 'противника'}.`);
  return true;
}
