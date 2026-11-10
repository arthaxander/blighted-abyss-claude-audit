import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { AccountContext } from './contexts/AccountContext';
import { UIProvider } from './contexts/UIContext';
import { hydratePersistentGameState } from './hooks/usePersistentGameState';

const { validateSavePayload } = require('../server/saveValidation');

beforeEach(() => {
  jest.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  jest.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test.each([
  ['Defender', 'Защитник'],
  ['Mage', 'Элементалист'],
  ['Archer', 'Лучник'],
])('%s: Create character click produces a server-valid save that reloads in the Guild', async (classId, classLabel) => {
  let savedPayload = null;
  const saveGameState = jest.fn(async payload => {
    validateSavePayload(payload, { previousSave: savedPayload });
    savedPayload = payload;
    return { revision: saveGameState.mock.calls.length };
  });
  const view = render(
    <AccountContext.Provider value={{ authoritative: true, account: { gameName: 'Путник', save: null }, saveGameState }}>
      <UIProvider><App /></UIProvider>
    </AccountContext.Provider>,
  );

  fireEvent.change(screen.getByLabelText(/Класс:/), { target: { value: classId } });
  expect(screen.getByRole('option', { name: new RegExp(classLabel) }).selected).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Создать персонажа' }));

  await waitFor(() => expect(document.querySelector('[data-app-screen="guild"]')).toBeInTheDocument());
  await waitFor(() => expect(savedPayload).toMatchObject({ currentScreen: 'guild', player: { class: classId, name: 'Путник' } }));
  expect(() => validateSavePayload(savedPayload)).not.toThrow();
  const reloaded = hydratePersistentGameState(savedPayload);
  expect(reloaded).toMatchObject({ currentScreen: 'guild', player: { class: classId, name: 'Путник' } });

  view.unmount();
  render(
    <AccountContext.Provider value={{ authoritative: false, account: { gameName: 'Путник', save: savedPayload } }}>
      <UIProvider><App /></UIProvider>
    </AccountContext.Provider>,
  );
  expect(document.querySelector('[data-app-screen="guild"]')).toBeInTheDocument();
});
