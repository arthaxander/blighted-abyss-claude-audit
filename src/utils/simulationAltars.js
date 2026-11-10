import { CURSE_DEFINITIONS, ensureCurseState, getCurseProgressTotal, getCurseTierCapForAbyssLevel, resolveCurseOffering, TOTAL_CURSE_PROGRESS_CAP } from '../data/curses';

export const ALTAR_POLICIES = ['accept', 'up_to_ii', 'skip'];
export const resolveSimulationCurseState = (initialCurses = {}, abyssLevel = 1) => {
  const cap = getCurseTierCapForAbyssLevel(abyssLevel);
  for (const [id, entry] of Object.entries(initialCurses)) {
    const value = typeof entry === 'number' ? entry : entry?.tier;
    if (!CURSE_DEFINITIONS[id] || !Number.isInteger(value) || value < 0 || value > cap)
      throw new Error(`Invalid starting curse ${id}: floor ${abyssLevel} allows tiers 0–${cap}`);
  }
  const curses = ensureCurseState(initialCurses);
  const dominant = Object.keys(curses).filter(id => curses[id].tier >= 3);
  if (dominant.length > 1 || getCurseProgressTotal(curses) > TOTAL_CURSE_PROGRESS_CAP)
    throw new Error('Only one dominant curse and at most 13 total curse levels are allowed');
  return { curses, dominantCurseId: dominant[0] || null };
};

export const advanceSimulationAltar = (state, curseId, abyssLevel, policy = 'accept') => {
  if (!ALTAR_POLICIES.includes(policy)) throw new Error(`Unknown altar policy: ${policy}`);
  const offer = resolveCurseOffering(state.curses, curseId, state.dominantCurseId, { abyssLevel });
  if (policy === 'skip' || (policy === 'up_to_ii' && offer.nextTier > 2) || !offer.accepted)
    return { ...state, accepted: false };
  return { curses: offer.nextState, dominantCurseId: offer.dominantCurseId, accepted: true };
};

// Pick only among the saved offers; a preference never guarantees its appearance.
export const chooseSimulationAltar = (state, curseIds, abyssLevel, policy, preferredCurseId = null) => {
  if (preferredCurseId && !CURSE_DEFINITIONS[preferredCurseId]) throw new Error('Unknown preferred curse');
  const accepted = curseIds.filter(id => advanceSimulationAltar(state, id, abyssLevel, policy).accepted);
  if (accepted.includes(preferredCurseId)) return preferredCurseId;
  return accepted.sort((a, b) => (state.curses?.[b]?.tier || 0) - (state.curses?.[a]?.tier || 0))[0] || null;
};
