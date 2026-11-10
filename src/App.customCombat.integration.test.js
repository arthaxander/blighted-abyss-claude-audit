import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./hooks/usePersistentGameState', () => ({
  usePersistentGameState: jest.fn(),
}));
jest.mock('./contexts/AccountContext', () => ({
  useAccount: () => ({ account: { gameName: 'Tester' } }),
}));
jest.mock('./contexts/UIContext', () => ({
  useToast: () => ({ pushToast: jest.fn() }),
}));
jest.mock('./components/GuildScreen', () => () => <div>Гильдия</div>);

const { usePersistentGameState } = require('./hooks/usePersistentGameState');

const persistentGuildState = () => ({
  player: { name: 'Tester', class: 'Defender', hp: 50, runInventory: [], equipment: {}, abilities: [] },
  setPlayer: jest.fn(),
  currentScreen: 'guild',
  setCurrentScreen: jest.fn(),
  locationEncounterCounters: {},
  setLocationEncounterCounters: jest.fn(),
  storageItems: [],
  setStorageItems: jest.fn(),
  commitStoragePlayer: jest.fn(),
  carryOverRunInventory: [],
  setCarryOverRunInventory: jest.fn(),
  carryOverSilver: 0,
  setCarryOverSilver: jest.fn(),
  relicState: {},
  setRelicState: jest.fn(),
  classProgression: {},
  setClassProgression: jest.fn(),
  activeCombat: null,
  setActiveCombat: jest.fn(),
  pendingLoot: null,
  setPendingLoot: jest.fn(),
  deathSummary: null,
  setDeathSummary: jest.fn(),
  reset: jest.fn(),
});

test('production Guild DEV opens Custom Combat and closing it returns to Guild', () => {
  const originalEnvironment = process.env.NODE_ENV;
  Object.defineProperty(process.env, 'NODE_ENV', { configurable: true, value: 'production' });
  usePersistentGameState.mockReturnValue(persistentGuildState());
  render(<App />);

  expect(screen.getByText('Гильдия')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'DEV' }));
  expect(screen.getByRole('dialog', { name: 'DEV' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Кастомный бой' }));
  expect(screen.queryByRole('dialog', { name: 'DEV' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Кастомный бой' })).toBeInTheDocument();
  expect(screen.queryByText('Гильдия')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Вернуться' }));
  expect(screen.queryByRole('heading', { name: 'Кастомный бой' })).not.toBeInTheDocument();
  expect(screen.getByText('Гильдия')).toBeInTheDocument();
  Object.defineProperty(process.env, 'NODE_ENV', { configurable: true, value: originalEnvironment });
});
