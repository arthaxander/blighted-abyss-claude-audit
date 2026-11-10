/* eslint-disable testing-library/no-container, testing-library/no-node-access */
// Inspect saved cell IDs and decorative SVG layers, which intentionally have no accessible roles.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { AccountContext } from './contexts/AccountContext';
import { UIProvider } from './contexts/UIContext';
import { GameTermHelpProvider } from './components/GameTermHelp';
import { createProductionFreshCharacter } from './utils/characterFactory';
import { prepareFreshDungeonRun } from './utils/dungeonRunState';
import { createExpeditionMapRun } from './utils/expeditionMapRun';
import { getAdjacentCellIds } from './utils/expeditionMapLayout';
import { createSeededSimulationRng } from './utils/simulationRng';
import { getGoblinMapThemeIds } from './data/goblinMapArt';
import { getFreshPersistentGameState, serializePersistentGameState } from './hooks/usePersistentGameState';

// Network image decoding and unrelated minigames/audio do not run in jsdom.
jest.mock('./hooks/useGoblinMapAssets', () => ({ __esModule: true,
  default: () => ({ ready: true, failed: false, completed: 18, total: 18, retry: jest.fn() }) }));
jest.mock('./components/DevMinigameSandbox', () => () => null);
jest.mock('./components/FishingRoomModal', () => () => null);
jest.mock('./audio/useAppMusic', () => ({ useAppMusic: () => {} }));
jest.mock('./audio/useAppSfx', () => ({ useAppSfx: () => {} }));
jest.mock('./audio/sfxController', () => ({ playSfx: () => {} }));

beforeEach(() => { Element.prototype.scrollTo = jest.fn(); localStorage.clear(); });

test('real App opens a map combat cell, retreats, persists, and restores identical themes', async () => {
  const run = createExpeditionMapRun({ locationId: 'Гоблинские Норы', rng: createSeededSimulationRng(7) });
  const encounter = run.mainLayout.cells.find(c => c.region === 'approach' && c.previewRoomType === 'COMBAT');
  const parentId = getAdjacentCellIds(run.mainLayout, encounter.id)
    .find(id => run.mainLayout.cells.find(c => c.id === id).region === 'approach');
  run.mainLayout.currentCellId = parentId;
  run.mainLayout.cells = run.mainLayout.cells.map(c => c.id === encounter.id ? { ...c, revealed: true } : c);
  const player = { ...prepareFreshDungeonRun(createProductionFreshCharacter({ classId: 'Defender' }), 'Гоблинские Норы'), expeditionMap: run };
  let save = serializePersistentGameState({ ...getFreshPersistentGameState(), player,
    currentScreen: 'dungeon', classProgression: player.classProgression });
  const themes = getGoblinMapThemeIds(run.mainLayout);
  const saveGameState = jest.fn(async next => { save = JSON.parse(JSON.stringify(next)); });
  const tree = () => <AccountContext.Provider value={{ authoritative: true, account: { save, revision: 1 }, saveGameState }}>
    <UIProvider><GameTermHelpProvider><App /></GameTermHelpProvider></UIProvider>
  </AccountContext.Provider>;
  const view = render(tree());
  const tile = view.container.querySelector(`[data-cell-id="${encounter.id}"]`);
  expect(tile).toBeEnabled();
  expect(tile).toHaveAttribute('data-map-event', 'combat');
  fireEvent.click(tile);
  fireEvent.click(await screen.findByRole('button', { name: 'Отойти' }));
  await waitFor(() => expect(view.container.querySelector('.expedition-map-board')).toBeInTheDocument());
  await waitFor(() => expect(save.player.expeditionMap.pendingCellId).toBeNull());
  expect(save.player.expeditionMap.mainLayout.currentCellId).toBe(parentId);
  expect(getGoblinMapThemeIds(save.player.expeditionMap.mainLayout)).toEqual(themes);
  expect(saveGameState).toHaveBeenCalled();
  view.unmount();
  const { container } = render(tree());
  expect(await screen.findByRole('button', { name: /Вы здесь/ })).toBeInTheDocument();
  expect([...container.querySelectorAll('[data-map-theme]')].map(node => node.dataset.mapTheme)).toEqual(themes);
  expect(container.querySelector('[data-current="true"]')).toHaveAttribute('data-cell-id', parentId);
  expect(container.querySelector('.expedition-map-board').textContent).toBe('');
});
