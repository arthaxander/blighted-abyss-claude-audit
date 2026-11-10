import React from 'react';
import { act, render } from '@testing-library/react';
import { AccountContext } from '../contexts/AccountContext';
import { getFreshPersistentGameState, usePersistentGameState } from './usePersistentGameState';

it('does not change the durable combat choice before server acknowledgement', async () => {
  let current;
  let resolveSave;
  const saveGameState = jest.fn(() => new Promise(resolve => { resolveSave = resolve; }));
  const account = { authoritative: true, account: { save: { ...getFreshPersistentGameState(), currentScreen: 'combat' } }, saveGameState };
  const Probe = () => { current = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={account}><Probe /></AccountContext.Provider>);
  const checkpoint = { state: { players: [{ hp: 10 }], enemies: [{ hp: 10 }] }, autobattle: { version: 1, phase: 'manual' } };
  let promise;
  act(() => { promise = current.commitActiveCombat(checkpoint); });
  expect(current.activeCombat).toBeNull();
  expect(saveGameState.mock.calls[0][0].activeCombat).toEqual(checkpoint);
  await act(async () => { resolveSave(); await promise; });
  expect(current.activeCombat).toEqual(checkpoint);
});

it('rejects an unavailable save without releasing the committed encounter', async () => {
  let current;
  const previous = { autobattle: { version: 1, phase: 'review' } };
  const account = { authoritative: true, account: { save: { ...getFreshPersistentGameState(), currentScreen: 'combat', activeCombat: previous } }, saveGameState: jest.fn().mockRejectedValue(new Error('offline')) };
  const Probe = () => { current = usePersistentGameState(); return null; };
  render(<AccountContext.Provider value={account}><Probe /></AccountContext.Provider>);
  await act(async () => { await expect(current.commitActiveCombat({ autobattle: { phase: 'manual' } })).rejects.toThrow('offline'); });
  expect(current.activeCombat).toEqual(previous);
});
