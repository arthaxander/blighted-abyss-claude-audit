import {
  CURSE_DEFINITIONS, CURSE_IDS, CURSE_PRESENTATION, ensureCurseState, formatActiveCurseText,
  getCurseProgressTotal, getEligibleCursePool, getNextCurseTierPreview,
  getRemainingCurseProgress, resolveCurseOffering,
} from './curses';
import { buildPlayerSnapshot, hydratePlayerSnapshot } from '../utils/playerState';

describe('five-tier curse progression', () => {
  test('every curse defines five cumulative display tiers', () => {
    expect(Object.values(CURSE_DEFINITIONS)).toHaveLength(5);
    Object.values(CURSE_DEFINITIONS).forEach(definition => expect(definition.tiers).toHaveLength(5));
  });

  test('player-facing copy avoids technical and legacy curse terminology', () => {
    const copy = Object.values(CURSE_DEFINITIONS).flatMap(definition => [
      definition.name, definition.shortName, definition.description, definition.commonText,
      ...definition.tiers.flatMap(entry => [entry.title, entry.description]),
    ]).filter(Boolean).join('\n');
    expect(copy).not.toMatch(/\b(?:HP|TM|currentCooldown|applicationEventId)\b/i);
    expect(copy).not.toMatch(/успешное событие наложения|действующего юнита|добавляет накопленное значение к атаке|не должен немедленно убить/i);
    expect(copy).not.toContain('[Разряд]');
    expect(copy).not.toMatch(/Принести подношение|жертвоприношение/i);
    const undeathCopy = [CURSE_DEFINITIONS.undeath.commonText, ...CURSE_DEFINITIONS.undeath.tiers.map(entry => entry.description)].join(' ');
    expect(undeathCopy).toMatch(/40%/);
    expect(undeathCopy).toMatch(/60%/);
    expect(undeathCopy).not.toMatch(/(?:\[Эхо\]|Эхо)[^.!?]*\b(?:50|75)%/);
  });

  test('all five curses have distinct subdued presentation metadata', () => {
    const presentations = Object.values(CURSE_PRESENTATION);
    expect(presentations).toHaveLength(5);
    expect(new Set(presentations.map(entry => entry.symbol)).size).toBe(5);
    expect(new Set(presentations.map(entry => entry.accent)).size).toBe(5);
    Object.values(CURSE_DEFINITIONS).forEach(definition => expect(definition.presentation).toBe(CURSE_PRESENTATION[definition.id]));
  });

  test('the dominant curse advances I through V without a fatal state', () => {
    let curses = {};
    let dominantCurseId = null;
    for (let tier = 1; tier <= 5; tier += 1) {
      const result = resolveCurseOffering(curses, CURSE_IDS.CORRUPTION, dominantCurseId);
      expect(result.accepted).toBe(true);
      expect(result.nextTier).toBe(tier);
      curses = result.nextState;
      dominantCurseId = result.dominantCurseId;
    }
    expect(curses.corruption.tier).toBe(5);
    expect(dominantCurseId).toBe(CURSE_IDS.CORRUPTION);
  });

  test('a level V curse is blocked without clearing curses or changing health state', () => {
    const state = { corruption: { tier: 5 }, decay: { tier: 2 } };
    const result = resolveCurseOffering(state, CURSE_IDS.CORRUPTION, CURSE_IDS.CORRUPTION);
    expect(result).toMatchObject({ accepted: false, canAccept: false, nextTier: null });
    expect(result).not.toHaveProperty('fatal');
    expect(result.nextState).toEqual(state);
  });

  test('different curses coexist at I-II, then only the selected dominant reaches III+', () => {
    let curses = {};
    for (const id of [CURSE_IDS.CORRUPTION, CURSE_IDS.DECAY]) {
      curses = resolveCurseOffering(curses, id).nextState;
      curses = resolveCurseOffering(curses, id).nextState;
    }
    const dominant = resolveCurseOffering(curses, CURSE_IDS.CORRUPTION);
    expect(dominant.dominantCurseId).toBe(CURSE_IDS.CORRUPTION);
    const blocked = resolveCurseOffering(dominant.nextState, CURSE_IDS.DECAY, dominant.dominantCurseId);
    expect(blocked.accepted).toBe(false);
    expect(blocked.blockedReason).toContain('главным');
    const fourth = resolveCurseOffering(dominant.nextState, CURSE_IDS.CORRUPTION, dominant.dominantCurseId);
    const fifth = resolveCurseOffering(fourth.nextState, CURSE_IDS.CORRUPTION, fourth.dominantCurseId);
    expect(fifth.nextState.corruption.tier).toBe(5);
  });

  test('legacy state remains readable and preview reports III, V, and blocked states', () => {
    expect(ensureCurseState({ decay: 2 })).toEqual({ decay: { tier: 2 } });
    expect(getNextCurseTierPreview({ decay: { tier: 2 } }, CURSE_IDS.DECAY)).toMatchObject({
      currentTier: 2, nextTier: 3, canAccept: true, requiresDominantConfirmation: true, bindsToAbyss: false,
    });
    expect(getNextCurseTierPreview({ decay: { tier: 4 } }, CURSE_IDS.DECAY, CURSE_IDS.DECAY)).toMatchObject({ nextTier: 5, canAccept: true, bindsToAbyss: true });
    expect(getNextCurseTierPreview({ decay: { tier: 2 } }, CURSE_IDS.DECAY, CURSE_IDS.CORRUPTION)).toMatchObject({ canAccept: false, requiresDominantConfirmation: false });
  });

  test('floor caps make V impossible before the fourth Abyss level', () => {
    expect(resolveCurseOffering({}, CURSE_IDS.CORRUPTION, null, { abyssLevel: 1 }).accepted).toBe(true);
    expect(resolveCurseOffering({ corruption: { tier: 1 } }, CURSE_IDS.CORRUPTION, null, { abyssLevel: 1 }).accepted).toBe(false);
    expect(getNextCurseTierPreview({ corruption: { tier: 2 } }, CURSE_IDS.CORRUPTION, null, { abyssLevel: 2 }))
      .toMatchObject({ canAccept: false, floorCap: 2 });
    expect(getNextCurseTierPreview({ corruption: { tier: 3 } }, CURSE_IDS.CORRUPTION, CURSE_IDS.CORRUPTION, { abyssLevel: 3 }))
      .toMatchObject({ canAccept: true, nextTier: 4, floorCap: 4 });
    expect(getNextCurseTierPreview({ corruption: { tier: 4 } }, CURSE_IDS.CORRUPTION, CURSE_IDS.CORRUPTION, { abyssLevel: 3 }))
      .toMatchObject({ canAccept: false, nextTier: 5, floorCap: 4 });
    expect(getNextCurseTierPreview({ corruption: { tier: 4 } }, CURSE_IDS.CORRUPTION, CURSE_IDS.CORRUPTION, { abyssLevel: 4 }))
      .toMatchObject({ canAccept: true, nextTier: 5, floorCap: 5 });
  });

  test('curse progression totals thirteen levels and eligible altars avoid blocked curses', () => {
    const state = {
      corruption: { tier: 5 },
      distortion: { tier: 2 },
      withering: { tier: 2 },
      undeath: { tier: 1 },
      decay: { tier: 1 },
    };
    expect(getCurseProgressTotal(state)).toBe(11);
    expect(getRemainingCurseProgress(state)).toBe(2);
    expect(getEligibleCursePool(state, CURSE_IDS.CORRUPTION, 6).map(entry => entry.id).sort())
      .toEqual([CURSE_IDS.DECAY, CURSE_IDS.UNDEATH].sort());
  });

  test('legacy player snapshots without a dominant curse field migrate to null', () => {
    const legacy = { name: 'Старый герой', hp: 50, maxHp: 50, attack: 5, curses: { corruption: 2 }, equipment: {} };
    expect(buildPlayerSnapshot(legacy).dominantCurseId).toBeNull();
    expect(hydratePlayerSnapshot(legacy).dominantCurseId).toBeNull();
  });

  test('HUD detail text contains every active tier', () => {
    const text = formatActiveCurseText(CURSE_DEFINITIONS[CURSE_IDS.WITHERING], 3);
    expect(text).toContain('1. Симбиоз');
    expect(text).toContain('2. Первые корни');
    expect(text).toContain('3. Общая сеть');
    expect(text).not.toContain('4. Великие корни');
  });
});

describe('Связь с Бездной', () => {
  test('is derived exclusively from current tier V curses', () => {
    const { isAbyssBound, getAbyssBindingCurse } = require('./curses');
    expect(isAbyssBound({ corruption: { tier: 4 }, decay: { tier: 4 } })).toBe(false);
    const curses = { corruption: { tier: 5 }, decay: { tier: 2 } };
    expect(isAbyssBound(curses)).toBe(true);
    expect(getAbyssBindingCurse(curses)).toMatchObject({ id: 'corruption', tier: 5 });
    curses.corruption.tier = 4;
    expect(isAbyssBound(curses)).toBe(false);
  });
});
