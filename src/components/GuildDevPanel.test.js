import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GuildDevPanel from './GuildDevPanel';
import { ITEM_DATA } from '../data/items';

/* eslint-disable testing-library/no-node-access */

const renderPanel = () => {
  const actions = { add: jest.fn(), grant: jest.fn(), reset: jest.fn(), change: jest.fn(), combat: jest.fn(), minigame: jest.fn() };
  const view = render(
    <div data-testid="guild-content" style={{ height: '100dvh', overflow: 'hidden' }}>
      <GuildDevPanel currentClass="Defender" onAddItem={actions.add} onGrantAllRelics={actions.grant} onReset={actions.reset} onChangeClass={actions.change} onCustomCombat={actions.combat} onOpenMinigame={actions.minigame} />
    </div>,
  );
  return { ...view, actions };
};

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: 'DEV' }));

test('DEV button renders', () => {
  renderPanel();
  expect(screen.getByRole('button', { name: 'DEV' })).toBeInTheDocument();
});

test('clicking DEV opens an accessible dialog in a body portal outside Guild content', () => {
  renderPanel(); openPanel();
  const dialog = screen.getByRole('dialog', { name: 'DEV' });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByTestId('guild-content')).not.toContainElement(dialog);
  expect(dialog.parentElement.parentElement).toBe(document.body);
});

test('close button closes DEV and restores trigger focus', () => {
  renderPanel(); openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть DEV' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'DEV' })).toHaveFocus();
});

test('backdrop click closes DEV', () => {
  renderPanel(); openPanel();
  fireEvent.click(document.querySelector('.guild-dev-overlay'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('clicking inside the panel does not close DEV', () => {
  renderPanel(); openPanel();
  fireEvent.click(screen.getByRole('heading', { name: 'DEV' }));
  expect(screen.getByRole('dialog', { name: 'DEV' })).toBeInTheDocument();
});

test('Escape closes DEV', () => {
  renderPanel(); openPanel();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Add Item preserves the selected-item callback', () => {
  const { actions } = renderPanel(); openPanel();
  expect(screen.getByRole('combobox', { name: 'Предмет' }).options).toHaveLength(ITEM_DATA.length);
  fireEvent.click(screen.getByRole('button', { name: 'Добавить предмет' }));
  expect(actions.add).toHaveBeenCalledWith(ITEM_DATA[0].name);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('Grant All Relics callback still fires', () => {
  const { actions } = renderPanel(); openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Открыть все реликвии' }));
  expect(actions.grant).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('all class-switch actions remain available', () => {
  renderPanel(); openPanel();
  expect(screen.getByText('Сменить класс')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Страж|Охотник|Элементалист|Инквизитор/ }).length).toBeGreaterThan(0);
});

test('Reset closes DEV before invoking its callback', () => {
  const { actions } = renderPanel();
  actions.reset.mockImplementation(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  openPanel(); fireEvent.click(screen.getByRole('button', { name: 'Сбросить весь прогресс' }));
  expect(actions.reset).toHaveBeenCalledTimes(1);
});

test('Custom Combat closes DEV before invoking its callback', () => {
  const { actions } = renderPanel();
  actions.combat.mockImplementation(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  openPanel(); fireEvent.click(screen.getByRole('button', { name: 'Кастомный бой' }));
  expect(actions.combat).toHaveBeenCalledTimes(1);
});

test('DEV exposes every audited playable mini-game and closes before launching it', () => {
  const { actions } = renderPanel();
  actions.minigame.mockImplementation(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  openPanel();
  expect(screen.getByRole('heading', { name: 'Мини-игры' })).toBeInTheDocument();
  expect(screen.getByText('Тестовый запуск — без наград')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Взлом сокровищницы' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Рыбалка' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Обезвреживание ловушки' }));
  expect(actions.minigame).toHaveBeenCalledWith('trap');
});

test('portal remains visible from a fullscreen overflow-hidden Guild/App structure', () => {
  renderPanel(); openPanel();
  const guild = screen.getByTestId('guild-content');
  expect(guild).toHaveStyle({ height: '100dvh', overflow: 'hidden' });
  expect(document.body.querySelector(':scope > .guild-dev-overlay')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'DEV' })).toBeVisible();
});

test('Audio diagnostics are read-only and commands delegate to the shared controller', () => {
  const snapshot = { src: '/guild.mp3', inGuildScope: true, paused: false, muted: false, volume: .22, currentTime: 7, duration: 90, readyState: 4, networkState: 1, errorCode: null, gestureArmed: false, gestureAttemptPending: false, hasConfirmedPlaying: true, lastMediaEvent: 'playing', playRejectionName: '', playRejectionMessage: '' };
  const controller = { getDebugSnapshot: () => snapshot, subscribeDebug: () => () => {}, testGuildMusic: jest.fn(), stopMusic: jest.fn() };
  render(<GuildDevPanel musicController={controller} currentClass="Defender" onAddItem={jest.fn()} onGrantAllRelics={jest.fn()} onReset={jest.fn()} onChangeClass={jest.fn()} onCustomCombat={jest.fn()} />);
  openPanel();
  expect(screen.getByLabelText('Audio diagnostics')).toHaveTextContent('/guild.mp3');
  fireEvent.click(screen.getByRole('button', { name: 'Test Guild Music' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop Music' }));
  expect(controller.testGuildMusic).toHaveBeenCalledTimes(1);
  expect(controller.stopMusic).toHaveBeenCalledTimes(1);
});
