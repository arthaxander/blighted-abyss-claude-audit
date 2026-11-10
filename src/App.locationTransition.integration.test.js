import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { AccountContext } from './contexts/AccountContext';
import { UIProvider } from './contexts/UIContext';
import { AVAILABLE_LOCATIONS } from './data/locations';

const player = {
  name: 'Путник', class: 'Defender', hp: 100, maxHp: 100, baseStats: { maxHp: 100 },
  equipment: {}, runInventory: [], questLog: {}, relics: {}, abilities: [], roomGenerationState: {},
};

const renderSave = (save) => render(
  <AccountContext.Provider value={{ authoritative: false, account: { gameName: 'Путник', save } }}>
    <UIProvider><App /></UIProvider>
  </AccountContext.Provider>,
);

beforeEach(() => {
  jest.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  jest.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test.each(AVAILABLE_LOCATIONS)('live Guild -> selection -> $name transition mounts a complete dungeon run', async ({ name }) => {
  const uncaught = [];
  const onError = event => uncaught.push(event.error || event.message);
  window.addEventListener('error', onError);
  renderSave({ player, currentScreen: 'guild' });
  fireEvent.click(screen.getByRole('button', { name: 'НАЧАТЬ ПОХОД' }));
  expect(document.querySelector('[data-app-screen="locationSelect"]')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Гильдия' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Спуститься в Бездну' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Вернуться в Гильдию' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
  await waitFor(() => expect(document.querySelector('[data-app-screen="dungeon"]')).toBeInTheDocument());
  expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  expect(screen.getByText('Выберите путь')).toBeInTheDocument();
  await waitFor(() => expect(document.querySelectorAll('.room-choice-card')).toHaveLength(3));
  expect(uncaught).toEqual([]);
  window.removeEventListener('error', onError);
});

test('a directly hydrated dungeon retains its saved initial paths', async () => {
  const location = AVAILABLE_LOCATIONS[0].name;
  renderSave({ player: { ...player, currentLocation: location }, currentScreen: 'dungeon' });
  expect(screen.getByRole('heading', { name: location })).toBeInTheDocument();
  await waitFor(() => expect(document.querySelectorAll('.room-choice-card')).toHaveLength(3));
});

test('tier V blocks portal extraction and severs the link through death semantics', async () => {
  const location = AVAILABLE_LOCATIONS[0].name;
  renderSave({
    player: {
      ...player,
      currentLocation: location,
      curses: { corruption: { tier: 5 } },
      portalStone: { hasStone: true, acquiredFrom: 'drop' },
      runInventory: [{ itemId: 'Простая ткань', quantity: 1 }, null, { itemId: 'Кровяной мох', quantity: 1 }],
      runSilver: 50,
    },
    currentScreen: 'dungeon',
  });
  expect(screen.getByRole('button', { name: 'Камень портала не отвечает: герой связан с Бездной' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Связь с Бездной: открыть описание' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Разорвать связь' }));
  expect(screen.getByRole('heading', { name: 'Разорвать связь с Бездной?' })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Разорвать связь' }).slice(-1)[0]);
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Связь с Бездной разорвана' })).toBeInTheDocument());
  expect(screen.getByText(/Тело осталось в Бездне/)).toBeInTheDocument();
  expect(screen.queryByText(/Гильдейская страховка/)).not.toBeInTheDocument();
});
