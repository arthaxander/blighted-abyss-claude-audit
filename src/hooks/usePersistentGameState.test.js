import React from 'react';
import { act, render } from '@testing-library/react';
import { getFreshPersistentGameState, hydratePersistentGameState, serializePersistentGameState, usePersistentGameState } from "./usePersistentGameState";
import { AccountContext } from '../contexts/AccountContext';
import { CLASS_XP_THRESHOLDS, applyClassLoadoutToPlayer, grantClassExperience, selectClassTalent } from '../data/classProgression';
import { CLASS_TALENT_SETS, TALENT_BY_ID } from '../data/classTalents.mjs';
import { createSerializedSaveQueue, firstSaveDifference } from '../services/accountApi';
import { LEVEL_TWO_LOCATIONS } from '../data/locations';

describe("persistent New Game reset", () => {
  test("returns the canonical no-character creation state", () => {
    const fresh = getFreshPersistentGameState();
    expect(fresh.player).toBeNull();
    expect(fresh.currentScreen).toBe("character");
    expect(fresh.activeCombat).toBeNull();
    expect(fresh.arenaBattle).toBeNull();
    expect(fresh.encountersCleared).toBe(0);
    expect(fresh.locationEncounterCounters).toEqual({});
    expect(fresh.storageItems).toEqual([]);
    expect(fresh.carryOverRunInventory).toEqual([null, null]);
  });

  test("creates fresh nested collections for persistence", () => {
    const first = getFreshPersistentGameState();
    first.locationEncounterCounters.test = 1;
    first.storageItems.push("old item");
    first.vendorPurchaseState.counts['Простая ткань'] = 20;
    const second = getFreshPersistentGameState();
    expect(second.locationEncounterCounters).toEqual({});
    expect(second.storageItems).toEqual([]);
    expect(second.vendorPurchaseState).toEqual({ periodId: null, counts: {} });
  });
});

test('server account state is authoritative and historical local save is ignored', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[3] + 20).progression;
  window.localStorage.setItem('ashenAbyssSave', JSON.stringify({ version: 4, player: null, classProgression: progression, currentScreen: 'character' }));
  let state;
  const saveGameState = jest.fn(() => Promise.resolve());
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: { version: 5, player: null, classProgression: progression, currentScreen: 'character' } }, saveGameState }}><Harness /></AccountContext.Provider>);
  expect(state.player).toBeNull();
  expect(state.classProgression.Defender).toEqual(progression.Defender);
  act(() => state.setPlayer({ class: 'Defender', classProgression: progression }));
  act(() => state.setPlayer(null));
  expect(state.classProgression.Defender.classLevel).toBe(4);
  expect(state.classProgression.Defender.cumulativeClassXp).toBe(CLASS_XP_THRESHOLDS[3] + 20);
  expect(JSON.parse(window.localStorage.getItem('ashenAbyssSave')).version).toBe(4);
});

test('failed hydration preserves the server payload and never autosaves a blank state', () => {
  const brokenSave = { version: 7, player: 'invalid-player', carryOverItems: {} };
  const saveGameState = jest.fn(() => Promise.resolve());
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: brokenSave }, saveGameState }}><Harness /></AccountContext.Provider>);
  expect(state.hydrationError).toContain('не изменён');
  expect(state.hydrationErrorCode).toBe('HYDRATE_PLAYER');
  expect(state.unhydratedSave).toBe(brokenSave);
  expect(saveGameState).not.toHaveBeenCalled();
});

test('optional malformed legacy carry-over items are ignored without losing the saved hero', () => {
  const recovered = hydratePersistentGameState({ version: 7, player: { name: 'Ветеран' }, carryOverItems: {} });
  expect(recovered.hydrationError).toBeUndefined();
  expect(recovered.player?.name).toBe('Ветеран');
  expect(recovered.carryOverRunInventory).toEqual([null, null]);
});

test('confirmed recovery replaces the corrupt save once and persists the first user transition', async () => {
  const { validateSavePayload } = require('../../server/saveValidation');
  const replaceGameState = jest.fn(save => {
    expect(() => validateSavePayload(save)).not.toThrow();
    return Promise.resolve({ revision: 8 });
  });
  const saveGameState = jest.fn(() => Promise.resolve());
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: { player: 'invalid-player' } }, saveGameState, replaceGameState }}><Harness /></AccountContext.Provider>);
  expect(state.hydrationErrorCode).toBe('HYDRATE_PLAYER');
  await act(async () => { await state.resetCorruptSave(); });
  expect(replaceGameState).toHaveBeenCalledWith(expect.objectContaining({ player: null, currentScreen: 'character' }));
  expect(state).toMatchObject({ player: null, currentScreen: 'character', resetting: false });
  expect(state.hydrationError).toBeUndefined();
  expect(saveGameState).not.toHaveBeenCalled();
  act(() => state.setCurrentScreen('guild'));
  await act(async () => {});
  expect(saveGameState).toHaveBeenCalledTimes(1);
  expect(saveGameState).toHaveBeenCalledWith(expect.objectContaining({ currentScreen: 'guild' }));
  expect(replaceGameState).toHaveBeenCalledTimes(1);
});

test('confirmed reset of JSON-valid but unreadable save uses archived server reset instead of ordinary write',async()=>{
  const resetGameState=jest.fn().mockResolvedValue({revision:3});
  const replaceGameState=jest.fn();
  const saveGameState=jest.fn().mockResolvedValue({});
  let state;
  const Harness=()=>{state=usePersistentGameState();return null;};
  render(<AccountContext.Provider value={{
    authoritative:true, account:{save:{version:7,player:'broken'}},
    saveGameState, replaceGameState, resetGameState,
  }}><Harness /></AccountContext.Provider>);
  expect(state.hydrationErrorCode).toBe('HYDRATE_PLAYER');
  await act(async()=>{await state.resetCorruptSave();});
  expect(resetGameState).toHaveBeenCalledTimes(1);
  expect(replaceGameState).not.toHaveBeenCalled();
  expect(saveGameState).not.toHaveBeenCalled();
  act(()=>state.setCurrentScreen('guild'));
  await act(async()=>{});
  expect(saveGameState).toHaveBeenCalledWith(expect.objectContaining({currentScreen:'guild'}));
});

test('rejected recovery keeps the hydration error and exposes a server failure', async () => {
  const replaceGameState = jest.fn(() => Promise.reject(new Error('offline')));
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: { player: 'invalid-player' } }, saveGameState: jest.fn(), replaceGameState }}><Harness /></AccountContext.Provider>);
  await act(async () => { await state.resetCorruptSave(); });
  expect(state.hydrationErrorCode).toBe('HYDRATE_PLAYER');
  expect(state.resetError).toContain('Сервер не смог удалить');
});

test('a rejected server write is exposed to the UI state', async () => {
  const saveGameState = jest.fn(() => Promise.reject(Object.assign(new Error('server details are not shown'), { code: 'invalid-save', status: 400 })));
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: null }, saveGameState }}><Harness /></AccountContext.Provider>);
  await act(async () => {});
  expect(state.saveError).toMatchObject({ code: 'SAVE_INVALID_SAVE', message: expect.stringContaining('Сервер отклонил сохранение'), diagnostic: null });
});

test('absence of a server save remains a clean character-creation state', () => {
  const fresh = hydratePersistentGameState(null);
  expect(fresh).toMatchObject({ player: null, currentScreen: 'character' });
  expect(fresh.hydrationError).toBeUndefined();
});

test('level-two selection transition emits one canonical autosave checkpoint', async () => {
  const { createProductionFreshCharacter } = require('../utils/characterFactory');
  const { prepareLevelTwoSelection } = require('../utils/dungeonRunState');
  const basePlayer = createProductionFreshCharacter({ classId: 'Defender' });
  const bossPlayer = {
    ...basePlayer,
    abyssLevel: 1,
    expeditionPhase: 'boss-defeated',
    bossClearId: 'boss-fungal',
    currentLocation: 'Грибные Пещеры',
    portalStone: { acquiredFrom: 'boss' },
  };
  const initialSave = {
    ...getFreshPersistentGameState(),
    player: bossPlayer,
    currentScreen: 'dungeon',
    locationEncounterCounters: { 'Грибные Пещеры': 14 },
    classProgression: basePlayer.classProgression,
  };
  const saveGameState = jest.fn(() => Promise.resolve({ revision: 2 }));
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: initialSave }, saveGameState }}><Harness /></AccountContext.Provider>);
  await act(async () => {});
  expect(saveGameState).not.toHaveBeenCalled();

  const nextPlayer = prepareLevelTwoSelection(state.player);
  act(() => state.enterLevelTwoSelection(nextPlayer, 'Грибные Пещеры'));
  await act(async () => {});

  expect(saveGameState).toHaveBeenCalledTimes(1);
  expect(saveGameState.mock.calls[0][0]).toMatchObject({
    currentScreen: 'levelTwoLocationSelect',
    activeCombat: null,
    locationEncounterCounters: { 'Грибные Пещеры': 0 },
    player: {
      abyssLevel: 2,
      expeditionPhase: 'level-selection',
      currentLocation: null,
    },
  });
});

test('level-two serialization canonicalizes the enabled forest before sending it', () => {
  const basePlayer = require('../utils/characterFactory').createProductionFreshCharacter({ classId: 'Defender' });
  const serializedById = serializePersistentGameState({
    ...getFreshPersistentGameState(),
    player: {
      ...basePlayer,
      abyssLevel: 2,
      expeditionPhase: 'exploring',
      currentLocation: 'withering_forest',
    },
    currentScreen: 'dungeon',
    classProgression: basePlayer.classProgression,
  });
  expect(serializedById.player.currentLocation).toBe('Лес Увядания');

  const serializedFallback = serializePersistentGameState({
    ...getFreshPersistentGameState(),
    player: {
      ...basePlayer,
      abyssLevel: 2,
      expeditionPhase: 'exploring',
      currentLocation: 'stale-runtime-location',
      currentDungeonChoicesLocation: 'Лес Увядания',
    },
    currentScreen: 'dungeon',
    classProgression: basePlayer.classProgression,
  });
  expect(serializedFallback.player.currentLocation).toBe('Лес Увядания');
  expect(serializedFallback.player.currentDungeonChoicesLocation).toBe('Лес Увядания');
});

test('level-two selection survives hydration and unavailable location combat recovers to selection', () => {
  const selection = hydratePersistentGameState({ currentScreen: 'levelTwoLocationSelect', player: { abyssLevel: 2, expeditionPhase: 'level-selection', currentLocation: null } });
  expect(selection).toMatchObject({ currentScreen: 'levelTwoLocationSelect', player: { abyssLevel: 2, expeditionPhase: 'level-selection', currentLocation: null } });
  // Recovery only applies to a location that exists in the catalog but is
  // disabled. Ship-state has every Level 2 location enabled, so the fixture
  // must say which one is off instead of relying on the default catalog.
  const onlyForest = LEVEL_TWO_LOCATIONS.map(location => ({ ...location, enabled: location.id === 'withering_forest' }));
  const invalidCombat = hydratePersistentGameState({ currentScreen: 'dungeon', player: { abyssLevel: 2, expeditionPhase: 'exploring', currentLocation: 'Руины Неупокоенных', currentEnemies: [{ id: 'fake' }] } }, { levelTwoLocations: onlyForest });
  expect(invalidCombat).toMatchObject({ currentScreen: 'levelTwoLocationSelect', player: { expeditionPhase: 'level-selection', currentLocation: null } });
  expect(invalidCombat.player.currentEnemies).toBeUndefined();
});

test('an enabled forest dungeon and active combat survive hydration unchanged', () => {
  const enabledForest = LEVEL_TWO_LOCATIONS.map(location => ({ ...location, enabled: location.id === 'withering_forest' }));
  const basePlayer = require('../utils/characterFactory').createProductionFreshCharacter({ classId: 'Defender' });
  const forestPlayer = { ...basePlayer, abyssLevel: 2, expeditionPhase: 'exploring', currentLocation: 'Лес Увядания', hp: 19 };
  const dungeon = hydratePersistentGameState({ currentScreen: 'dungeon', player: forestPlayer, classProgression: basePlayer.classProgression }, { levelTwoLocations: enabledForest });
  expect(dungeon).toMatchObject({ currentScreen: 'dungeon', player: { abyssLevel: 2, expeditionPhase: 'exploring', currentLocation: 'Лес Увядания', hp: 19 } });
  const activeCombat = { state: { players: [{ hp: 18 }], enemies: [{ id: 'forest-enemy', hp: 9 }] } };
  const parsed = { currentScreen: 'combat', player: { ...forestPlayer, currentEnemies: [{ id: 'forest-enemy' }] }, classProgression: basePlayer.classProgression, activeCombat };
  const restored = hydratePersistentGameState(parsed, { levelTwoLocations: enabledForest });
  expect(restored.currentScreen).toBe('combat');
  expect(restored.player).toMatchObject({ abyssLevel: 2, expeditionPhase: 'exploring', currentLocation: 'Лес Увядания' });
  expect(restored.activeCombat).toEqual(activeCombat);
});

test.each(['Руины Неупокоенных'])('%s remains blocked when the forest is enabled', currentLocation => {
  const enabledForest = LEVEL_TWO_LOCATIONS.map(location => ({ ...location, enabled: location.id === 'withering_forest' }));
  const restored = hydratePersistentGameState({ currentScreen: 'dungeon', player: { abyssLevel: 2, expeditionPhase: 'exploring', currentLocation } }, { levelTwoLocations: enabledForest });
  expect(restored).toMatchObject({ currentScreen: 'levelTwoLocationSelect', player: { expeditionPhase: 'level-selection', currentLocation: null } });
});

// An unknown location name cannot be resolved to a catalog entry at all, so it
// must not be treated as "disabled": the player is returned to location
// selection with permanent progress intact and no unreachable combat left over.
test.each(['Неизведанная область', 'Удалённая локация'])('%s recovers to location selection without losing progress', currentLocation => {
  const restored = hydratePersistentGameState({
    currentScreen: 'combat',
    player: { abyssLevel: 2, expeditionPhase: 'exploring', currentLocation, runSilver: 77, currentEnemies: [{ id: 'fake' }] },
    activeCombat: { state: { players: [{ hp: 5 }], enemies: [{ id: 'fake', hp: 3 }] } },
  });
  expect(restored.currentScreen).toBe('levelTwoLocationSelect');
  expect(restored.player).toMatchObject({ expeditionPhase: 'level-selection', currentLocation: null, runSilver: 77 });
  expect(restored.player.currentEnemies).toBeUndefined();
  expect(restored.activeCombat).toBeNull();
});

// A finished battle whose reward was never picked up must stay claimable even
// when its location disappears. The combat loot screen is the only surface that
// can grant its items, and handleVictory needs the battle snapshot for the boss
// flag, the special rewards and the encounter location.
const unclaimedCombatSave = currentLocation => ({
  currentScreen: 'combat',
  player: { abyssLevel: 2, expeditionPhase: 'exploring', currentLocation, runSilver: 10 },
  activeCombat: {
    state: { players: [{ id: 'p', hp: 5, maxHp: 10 }], enemies: [{ id: 'e', hp: 0 }] },
    battleResult: {
      outcome: 'victory', id: 'reward-1', isBoss: false,
      loot: { silver: 25, resonance: 3, items: [{ name: 'Простая ткань', quantity: 2 }] },
    },
  },
  pendingLoot: {
    id: 'reward-1', source: 'combat', silver: 25, resonance: 3, silverClaimed: true,
    specialRewards: [], items: [{ id: 'Простая ткань-0', itemId: 'Простая ткань', quantity: 2 }],
    selectedIds: [], continuation: { screen: 'dungeon', isBoss: false },
  },
});

test('an unclaimed combat reward stays reachable when its location is unknown', () => {
  const restored = hydratePersistentGameState(unclaimedCombatSave('Удалённая локация'));
  // The only screen that can grant combat loot.
  expect(restored.currentScreen).toBe('combatLoot');
  expect(restored.activeCombat?.battleResult?.id).toBe('reward-1');
  expect(restored.pendingLoot).toMatchObject({ source: 'combat', silver: 25, silverClaimed: true });
  expect(restored.pendingLoot.items).toHaveLength(1);
  expect(restored.pendingLoot.recoveredFromUnavailableLocation).toBe(true);
  // The dead location itself is gone, and silver is not re-granted on load.
  expect(restored.player).toMatchObject({ currentLocation: null, expeditionPhase: 'level-selection', runSilver: 10 });
  expect(restored.player.currentEnemies).toBeUndefined();
});

test('an unclaimed reward survives a disabled location too', () => {
  const onlyForest = LEVEL_TWO_LOCATIONS.map(location => ({ ...location, enabled: location.id === 'withering_forest' }));
  const restored = hydratePersistentGameState(unclaimedCombatSave('Руины Неупокоенных'), { levelTwoLocations: onlyForest });
  expect(restored.currentScreen).toBe('combatLoot');
  expect(restored.activeCombat?.battleResult?.id).toBe('reward-1');
});

test('without pending loot the same broken save falls back to location selection', () => {
  const save = unclaimedCombatSave('Удалённая локация');
  delete save.pendingLoot;
  const restored = hydratePersistentGameState(save);
  expect(restored.currentScreen).toBe('levelTwoLocationSelect');
  expect(restored.activeCombat).toBeNull();
  expect(restored.pendingLoot).toBeNull();
});

test('the recovery marker does not persist into a later reachable save', () => {
  const save = unclaimedCombatSave('Удалённая локация');
  const recovered = hydratePersistentGameState(save);
  expect(recovered.pendingLoot.recoveredFromUnavailableLocation).toBe(true);
  // The player picks a valid location afterwards; the marker must not linger.
  const resumed = hydratePersistentGameState({
    ...recovered,
    currentScreen: 'combat',
    player: { ...recovered.player, currentLocation: 'Лес Увядания', expeditionPhase: 'exploring' },
  });
  expect(resumed.pendingLoot.recoveredFromUnavailableLocation).toBeUndefined();
});

test('a reachable location is never rewritten by the recovery path', () => {
  const restored = hydratePersistentGameState(unclaimedCombatSave('Лес Увядания'));
  expect(restored.currentScreen).toBe('combat');
  expect(restored.player.currentLocation).toBe('Лес Увядания');
  expect(restored.pendingLoot.recoveredFromUnavailableLocation).toBeUndefined();
});

test('non-array class progression collections no longer cause HYDRATE_PROGRESSION', () => {
  const restored = hydratePersistentGameState({
    currentScreen: 'guild',
    classProgression: { Defender: { unlockedSkillIds: {}, activeSkillIds: 'Стойкость', purchasedPassiveIds: {}, equippedPassiveIds: 1 } },
  });
  expect(restored.hydrationError).toBeUndefined();
  expect(restored.classProgression.Defender.unlockedSkillIds).toEqual(expect.arrayContaining(['Стойкость']));
});

test('legacy player-only progression wins over an empty top-level migration shell', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[3]).progression;
  const restored = hydratePersistentGameState({
    currentScreen: 'guild',
    classProgression: {},
    player: { class: 'Defender', classProgression: progression },
  });
  expect(restored.hydrationError).toBeUndefined();
  expect(restored.classProgression.Defender).toEqual(progression.Defender);
  expect(restored.player.classProgression).toEqual(restored.classProgression);
});

test('serialization uses top-level progression for both copies after level and talent changes', () => {
  const { createProductionFreshCharacter } = require('../utils/characterFactory');
  const player = createProductionFreshCharacter({ classId: 'Defender' });
  let progression = grantClassExperience(player.classProgression, 'Defender', CLASS_XP_THRESHOLDS[19]).progression;
  const talentSet = CLASS_TALENT_SETS.find(set => set.abilityId === 'defender.wounding_strike');
  const talent = talentSet.talents.find(entry => TALENT_BY_ID[entry.id]?.combatReady);
  progression = selectClassTalent(progression, 'Defender', talentSet.abilityId, talent.id, { location: 'guild' }).progression;
  const serialized = serializePersistentGameState({ ...getFreshPersistentGameState(), player: applyClassLoadoutToPlayer(player, progression), classProgression: progression });
  expect(serialized.player.classProgression).toEqual(serialized.classProgression);
  expect(serialized.classProgression.Defender.talentSelections[talentSet.abilityId]).toBe(talent.id);
  expect(() => require('../../server/saveValidation').validateSavePayload(serialized)).not.toThrow();
});

test('rapid progression updates only emit internally consistent saves', async () => {
  const { createProductionFreshCharacter } = require('../utils/characterFactory');
  const { validateSavePayload } = require('../../server/saveValidation');
  const player = createProductionFreshCharacter({ classId: 'Defender' });
  const saveGameState = jest.fn(save => {
    expect(save.player.classProgression).toEqual(save.classProgression);
    expect(() => validateSavePayload(save)).not.toThrow();
    return Promise.resolve({ revision: saveGameState.mock.calls.length });
  });
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: { ...getFreshPersistentGameState(), player, classProgression: player.classProgression } }, saveGameState }}><Harness /></AccountContext.Provider>);
  const levelTwo = grantClassExperience(state.classProgression, 'Defender', CLASS_XP_THRESHOLDS[1]).progression;
  const levelThree = grantClassExperience(levelTwo, 'Defender', CLASS_XP_THRESHOLDS[2] - CLASS_XP_THRESHOLDS[1]).progression;
  act(() => state.setClassProgression(levelTwo));
  act(() => state.setClassProgression(levelThree));
  await act(async () => {});
  expect(state.player.classProgression).toEqual(state.classProgression);
  expect(state.classProgression.Defender.classLevel).toBe(3);
  expect(saveGameState.mock.calls.length).toBeGreaterThanOrEqual(1);
});

test('loading an existing server save does not autosave until game state changes', async () => {
  const { createProductionFreshCharacter } = require('../utils/characterFactory');
  const player = createProductionFreshCharacter({ classId: 'Defender' });
  const saveGameState = jest.fn(() => Promise.resolve());
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  const replaceGameState = jest.fn();
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: { ...getFreshPersistentGameState(), player, classProgression: player.classProgression } }, saveGameState, replaceGameState }}><Harness /></AccountContext.Provider>);
  await act(async () => {});
  expect(saveGameState).not.toHaveBeenCalled();
  expect(replaceGameState).not.toHaveBeenCalled();
  act(() => state.setActiveCombat({ state: { players: [], enemies: [] } }));
  await act(async () => {});
  expect(saveGameState).toHaveBeenCalledTimes(1);
});

test('restored combat last-enemy kill, loot transition, XP award and confirmation enqueue wire-consistent saves', async () => {
  const { createProductionFreshCharacter } = require('../utils/characterFactory');
  const { createPendingLoot } = require('../utils/pendingLoot');
  const { validateSavePayload } = require('../../server/saveValidation');
  const player = createProductionFreshCharacter({ classId: 'Defender' });
  player.currentEnemies = [{ id: 'last-enemy', name: 'Последний враг', hp: 2, maxHp: 20, location: 'goblin' }];
  const restoredCombat = { state: { players: [{ ...player }], enemies: [{ ...player.currentEnemies[0] }], initiative: { playerReady: true }, log: [] } };
  const initialSave = { ...getFreshPersistentGameState(), currentScreen: 'combat', player, classProgression: player.classProgression, activeCombat: restoredCombat };
  const requests = [];
  let previousSave = JSON.parse(JSON.stringify(initialSave));
  const queue = createSerializedSaveQueue({ initialRevision: 12, write: async request => {
    const wireRequest = JSON.parse(JSON.stringify(request));
    const difference = firstSaveDifference(wireRequest.save.classProgression, wireRequest.save.player.classProgression);
    requests.push({ ...wireRequest, difference });
    expect(difference).toBeNull();
    expect(() => validateSavePayload(wireRequest.save, { previousSave })).not.toThrow();
    previousSave = wireRequest.save;
    return { account: { revision: request.revision + 1 } };
  } });
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: initialSave }, saveGameState: save => queue.enqueue(save, 7) }}><Harness /></AccountContext.Provider>);
  await act(async () => {});

  const firstHit = JSON.parse(JSON.stringify(restoredCombat));
  firstHit.state.enemies[0].hp = 1;
  act(() => state.setActiveCombat(firstHit));
  await act(async () => {});

  const reward = { ...createPendingLoot({ id: 'restored-final-hit', source: 'combat', loot: { silver: 25, items: [] }, continuation: { screen: 'dungeon' } }), silverClaimed: true };
  const terminal = JSON.parse(JSON.stringify(firstHit));
  terminal.state.enemies[0].hp = 0;
  terminal.battleResult = { id: reward.id, outcome: 'victory', loot: { silver: 25, items: [] }, pendingLoot: reward, playerState: terminal.state.players[0] };
  act(() => {
    state.setPlayer(current => ({ ...current, runSilver: (current.runSilver || 0) + reward.silver }));
    state.setPendingLoot(reward);
    state.setActiveCombat(terminal);
  });
  await act(async () => {});
  act(() => state.setCurrentScreen('combatLoot'));
  await act(async () => {});

  const award = grantClassExperience(state.classProgression, 'Defender', 100).progression;
  act(() => {
    state.setPendingLoot(null);
    state.setActiveCombat(null);
    state.setClassProgression(award);
    state.setPlayer(current => ({ ...current, classProgression: award }));
    state.setCurrentScreen('dungeon');
  });
  await act(async () => {});

  expect(requests.map(entry => ({ screen: entry.save.currentScreen, terminal: entry.save.activeCombat?.battleResult?.outcome || null, pendingLoot: Boolean(entry.save.pendingLoot), xp: entry.save.classProgression.Defender.cumulativeClassXp }))).toEqual([
    { screen: 'combat', terminal: null, pendingLoot: false, xp: 0 },
    { screen: 'combat', terminal: 'victory', pendingLoot: true, xp: 0 },
    { screen: 'combatLoot', terminal: 'victory', pendingLoot: true, xp: 0 },
    { screen: 'dungeon', terminal: null, pendingLoot: false, xp: 100 },
  ]);
  expect(requests.every(entry => entry.requestId && entry.difference === null)).toBe(true);
});

test('save error clears only when the latest state is confirmed', async () => {
  const pending = [];
  const saveGameState = jest.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: null }, saveGameState }}><Harness /></AccountContext.Provider>);
  await act(async () => { pending[0].reject(Object.assign(new Error('no'), { code: 'invalid-save' })); });
  expect(state.saveError?.code).toBe('SAVE_INVALID_SAVE');
  act(() => state.setCurrentScreen('guild'));
  expect(state.saveError?.code).toBe('SAVE_INVALID_SAVE');
  await act(async () => { pending[1].resolve({ revision: 2 }); });
  expect(state.saveError).toBeNull();
});

test('vendor purchase quota survives server-save hydration and serialization', () => {
  const vendorPurchaseState = { periodId: '2026-10-02', counts: { 'Простая ткань': 7 } };
  const restored = hydratePersistentGameState({ ...getFreshPersistentGameState(), vendorPurchaseState });
  expect(restored.vendorPurchaseState).toEqual(vendorPurchaseState);
  expect(serializePersistentGameState(restored).vendorPurchaseState).toEqual(vendorPurchaseState);
});

test('legacy flat death carry-over migrates once and serialization persists only typed Safe slots', () => {
  const { hydratePersistentGameState, serializePersistentGameState } = require('./usePersistentGameState');
  const old = hydratePersistentGameState({ carryOverItems: [{ itemId: 'Капюшон Искателя Знаков', instanceId: 'legacy-safe', socketedRuneId: 'stone_vigil' }, 'Простая ткань'] });
  expect(old.carryOverRunInventory[0]).toMatchObject({ instanceId: 'legacy-safe', socketedRuneId: 'stone_vigil' });
  expect(old.carryOverRunInventory[1]).toMatchObject({ itemId: 'Простая ткань' });
  const saved = serializePersistentGameState(old);
  expect(saved.carryOverRunInventory).toEqual(old.carryOverRunInventory);
  expect(saved.carryOverItems).toBeUndefined();
});

test('class HP migration is one-shot across serialize and repeated hydrate',()=>{
 const { hydratePersistentGameState, serializePersistentGameState } = require('./usePersistentGameState');
 const { createProductionFreshCharacter } = require('../utils/characterFactory');
 const progression=grantClassExperience({},'Defender',CLASS_XP_THRESHOLDS[19]).progression;
 const legacyPlayer=createProductionFreshCharacter({classId:'Defender'});
 delete progression.Defender.schemaVersion;
 delete legacyPlayer.classProgressionStatBonus;
 const raw={version:6,currentScreen:'guild',player:{...legacyPlayer,hp:63,maxHp:125,classProgression:progression},classProgression:progression};
 const first=hydratePersistentGameState(raw);expect(first.player.maxHp).toBe(220);expect(first.player.hp).toBe(111);
 const saved=serializePersistentGameState(first);const second=hydratePersistentGameState(saved);const savedAgain=serializePersistentGameState(second);
 expect(second.player.hp).toBe(first.player.hp);expect(second.player.maxHp).toBe(first.player.maxHp);
 expect(savedAgain.player.classProgressionStatBonus).toEqual(saved.player.classProgressionStatBonus);
});

test.each([
  ['Defender', 1, 450, ['Стойкость','Устрашение','Кровавый таран','Удар щитом','Провокация'], ['Провокация'], ['last_stand'], ['last_stand']],
  ['Mage', 2, 700, ['Огненный шар','Цепная молния','Морозный щит','Горящая руна','Грозовой разряд'], ['Горящая руна','Грозовой разряд'], ['catalyst'], ['catalyst']],
  ['Archer', 3, 0, ['Зазубренная стрела','Прицельный выстрел','Добивающий выстрел','Быстрый перехват'], ['Прицельный выстрел'], [], []],
])('production class save migrates through hydration, unrelated mutation and server validation: %s schema v%s', (classId, schemaVersion, xp, unlockedSkillIds, activeSkillIds, purchasedPassiveIds, equippedPassiveIds) => {
  const { validateSavePayload } = require('../../server/saveValidation');
  const legacyRecord = {
    schemaVersion,
    classLevel: xp >= 700 ? 5 : xp >= 450 ? 4 : 1,
    cumulativeClassXp: xp,
    earnedClassPoints: xp >= 700 ? 4 : xp >= 450 ? 3 : 0,
    spentClassPoints: 0,
    purchases: {},
    unlockedSkillIds,
    activeSkillIds,
    purchasedPassiveIds,
    equippedPassiveIds,
    talentSelections: {},
  };
  const previousProgression = { [classId]: legacyRecord };
  const previousSave = { classProgression: previousProgression, player: { class: classId, classProgression: previousProgression } };
  const hydrated = hydratePersistentGameState({ ...previousSave, currentScreen: 'guild' });
  const afterUnrelatedMutation = { ...hydrated, currentScreen: 'character' };
  const wire = JSON.parse(JSON.stringify(serializePersistentGameState(afterUnrelatedMutation)));
  expect(() => validateSavePayload(wire, { previousSave })).not.toThrow();
  expect(wire.classProgression).toEqual(wire.player.classProgression);
});

test('legacy save without expedition map state still hydrates', () => {
  const restored = hydratePersistentGameState({ currentScreen: 'dungeon', player: { class: 'Defender', currentLocation: 'Гоблинские норы', abyssLevel: 1 } });
  expect(restored.player).toBeTruthy();
  expect(restored.player.expeditionMap).toBeUndefined();
  expect(restored.currentScreen).toBe('dungeon');
});


test('failed save offers a retry of the current state without reloading older server data', async () => {
  const rejection = Object.assign(new Error('invalid-class-loadout'), {
    code: 'invalid-class-loadout', diagnostic: { classId: 'Mage', reason: 'duplicate-skill', index: 1 },
  });
  const saveGameState = jest.fn().mockRejectedValueOnce(rejection).mockResolvedValueOnce({ revision: 3 });
  let state;
  const Harness = () => { state = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={{ authoritative: true, account: { save: { version: 7, player: null, currentScreen: 'character' } }, saveGameState }}><Harness /></AccountContext.Provider>);
  act(() => state.setCurrentScreen('guild'));
  await act(async () => {});
  expect(state.saveError).toMatchObject({ code: 'SAVE_INVALID_CLASS_LOADOUT', diagnostic: { classId: 'Mage', index: 1 } });
  await act(async () => { await state.retryPersistentSave(); });
  expect(saveGameState).toHaveBeenCalledTimes(2);
  expect(saveGameState.mock.calls[1][0]).toMatchObject({ currentScreen: 'guild' });
  expect(state.saveError).toBeNull();
});

