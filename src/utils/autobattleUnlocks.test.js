import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { GOBLIN_LOCATION } from './enemyPools';
import { isAutobattleUnlocked, recordBossClear, hydrateBossClears } from './autobattleUnlocks';
import { getFreshPersistentGameState, hydratePersistentGameState, serializePersistentGameState, usePersistentGameState } from '../hooks/usePersistentGameState';
import { AccountContext } from '../contexts/AccountContext';
import ExpeditionCombatPreview from '../components/ExpeditionCombatPreview';

it('unlocks only the defeated boss location and deduplicates name/id aliases', () => {
  const clears = recordBossClear([], GOBLIN_LOCATION);
  expect(clears).toEqual(['goblin']);
  expect(recordBossClear(clears, 'goblin')).toEqual(clears);
  expect(isAutobattleUnlocked(clears, GOBLIN_LOCATION)).toBe(true);
  expect(isAutobattleUnlocked(clears, 'fungal')).toBe(false);
  expect(isAutobattleUnlocked(clears, 'withering_forest')).toBe(false);
  expect(isAutobattleUnlocked(clears, 'unknown')).toBe(false);
});

it('old saves migrate only a currently completed boss, never floor or combat counts', () => {
  expect(hydrateBossClears({ player: { currentLocation: GOBLIN_LOCATION, expeditionPhase: 'boss-defeated' } })).toEqual(['goblin']);
  expect(hydrateBossClears({ player: { currentLocation: GOBLIN_LOCATION, abyssLevel: 2, bossClearId: 'previous-boss' }, encountersCleared: 100 })).toEqual([]);
  expect(hydrateBossClears(null)).toEqual([]);
});

it('account unlocks survive saving, loading and replacement of the hero', () => {
  let current;
  const Probe = () => { current = usePersistentGameState(); return null; };
  const account = { authoritative: false, account: { save: getFreshPersistentGameState() } };
  render(<AccountContext.Provider value={account}><Probe /></AccountContext.Provider>);
  act(() => current.recordLocationBossClear('fungal'));
  act(() => current.setPlayer(null));
  expect(current.clearedBossLocations).toEqual(['fungal']);
  const saved = serializePersistentGameState(current);
  expect(hydratePersistentGameState(JSON.parse(JSON.stringify(saved))).clearedBossLocations).toEqual(['fungal']);
  expect(getFreshPersistentGameState().clearedBossLocations).toEqual([]);
});

it('disables and unchecks the checkbox in a locked location, including a stored enabled preference', () => {
  const change = jest.fn();
  render(<ExpeditionCombatPreview room={{ enemies: [] }} player={{ autobattleEnabled: true }} onAutobattleChange={change} />);
  const checkbox = screen.getByRole('checkbox', { name: 'Автобой' });
  expect(checkbox.disabled).toBe(true);
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByText(/Победите босса этой локации/)).toBeTruthy();
});

it('allows the checkbox after clearing the current location', () => {
  const change = jest.fn();
  render(<ExpeditionCombatPreview room={{ enemies: [] }} player={{}} autobattleUnlocked onAutobattleChange={change} />);
  const checkbox = screen.getByRole('checkbox', { name: 'Автобой' });
  // The checkbox must share the persistent bottom footer with fight buttons:
  // in the old layout it was obscured by absolutely positioned actions.
  expect(checkbox.closest('footer')).toContainElement(screen.getByRole('button', { name: 'Вступить в бой' }));
  expect(checkbox.disabled).toBe(false);
  fireEvent.click(checkbox);
  expect(change).toHaveBeenCalledWith(true);
});
