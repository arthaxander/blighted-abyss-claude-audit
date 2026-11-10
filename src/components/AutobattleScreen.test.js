import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AutobattleScreen from './AutobattleScreen';
import { createAutobattleCheckpoint, calculateAutobattle } from '../utils/autobattle';
import { createSimulationPlayer, chooseCombatAction } from '../utils/combatSimulator';
import { createSerializedSaveQueue } from '../services/accountApi';
import { createExpeditionMapRun } from '../utils/expeditionMapRun';

jest.mock('./CombatScreen', () => props => <div data-testid="manual-combat">{props.initialCombatSnapshot?.autobattle?.phase || 'normal'}:{props.initialCombatSnapshot?.state?.players[0]?.hp}</div>);

const start = () => createAutobattleCheckpoint(createSimulationPlayer({ classId: 'Mage', hp: 40, abilityIds: ['Огненный шар', 'Атака'], items: [{ name: 'Малое зелье здоровья' }] }), [{ id: 'dummy', name: 'Манекен', hp: 60, maxHp: 60, attack: 2, speed: 70, abilities: [] }], false, 42);
const review = () => calculateAutobattle(start(), chooseCombatAction);

it('calculates during a slow start save but reveals nothing until both checkpoints are acknowledged', async () => {
  const pending = [];
  const save = jest.fn(() => new Promise(resolve => pending.push(resolve)));
  render(<AutobattleScreen initialCombatSnapshot={start()} onCheckpoint={save} />);
  await screen.findByText('Бой рассчитан. Сохраняем начало боя…');
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Результат автобоя')).toBeNull();
  await act(async () => pending.shift()());
  expect(save).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Сохраняем результат…')).toBeInTheDocument();
  expect(screen.queryByText('Принять результат')).toBeNull();
  await act(async () => pending.shift()());
  expect(await screen.findByText('Результат автобоя')).toBeInTheDocument();
});

it('shows the actual save error code instead of hiding the reason for failure', async () => {
  render(<AutobattleScreen initialCombatSnapshot={start()} onCheckpoint={jest.fn().mockRejectedValue({ status: 413, code: 'payload-too-large' })} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('PAYLOAD-TOO-LARGE');
  expect(screen.queryByText('Принять результат')).toBeNull();
  expect(screen.getByText('Повторить расчёт')).toBeEnabled();
});

it('reaches review after rapid map exploration without replaying every movement save', async () => {
  const map = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'goblin-caverns-02' });
  const travel = step => ({ currentScreen: 'dungeon', player: { expeditionMap: {
    ...map, mainLayout: { ...map.mainLayout, currentCellId: `travel-${step}` },
  } } });
  let release;
  const write = jest.fn(async request => {
    if (request.save.player?.expeditionMap.mainLayout.currentCellId === 'travel-0') {
      await new Promise(resolve => { release = resolve; });
    }
    return { account: { revision: request.revision + 1 } };
  });
  const queue = createSerializedSaveQueue({ write });
  const first = queue.enqueue(travel(0));
  await Promise.resolve();
  const moves = Array.from({ length: 30 }, (_, i) => queue.enqueue(travel(i + 1)));
  const save = snapshot => queue.enqueue({ currentScreen: 'combat', activeCombat: snapshot });
  render(<AutobattleScreen initialCombatSnapshot={start()} onCheckpoint={save} />);
  expect(screen.getByText('Сохраняем начало боя…')).toBeInTheDocument();
  expect(screen.queryByText('Результат автобоя')).toBeNull();
  await act(async () => { release(); await first; await Promise.all(moves); });
  await screen.findByText('Результат автобоя', {}, { timeout: 3000 });
  expect(write.mock.calls.map(([r]) => r.save.activeCombat?.autobattle.phase || r.save.player.expeditionMap.mainLayout.currentCellId))
    .toEqual(['travel-0', 'travel-30', 'running', 'review']);
});

it('restores the review screen without awards and saves manual choice before entering combat', async () => {
  const checkpoint = await review();
  let finish;
  const save = jest.fn(() => new Promise(resolve => { finish = resolve; }));
  const onVictory = jest.fn();
  render(<AutobattleScreen initialCombatSnapshot={checkpoint} onCheckpoint={save} onVictory={onVictory} />);
  expect(screen.getByText('Результат автобоя')).toBeTruthy();
  expect(onVictory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Сыграть вручную'));
  fireEvent.click(screen.getByText('Сыграть вручную'));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('manual-combat')).toBeNull();
  expect(save.mock.calls[0][0].state).toEqual(checkpoint.state);
  finish();
  await waitFor(() => expect(screen.getByTestId('manual-combat').textContent).toBe('manual:40'));
});

it('acceptance delegates the saved final state once to normal combat finalization', async () => {
  const checkpoint = await review();
  const save = jest.fn().mockResolvedValue(undefined);
  render(<AutobattleScreen initialCombatSnapshot={checkpoint} onCheckpoint={save} />);
  fireEvent.click(screen.getByText('Принять результат'));
  await screen.findByTestId('manual-combat');
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].state).toEqual(checkpoint.autobattle.result.state);
  expect(save.mock.calls[0][0].autobattle.phase).toBe('accepted');
});

it('a save failure keeps review open and does not enter manual combat', async () => {
  const checkpoint = await review();
  render(<AutobattleScreen initialCombatSnapshot={checkpoint} onCheckpoint={jest.fn().mockRejectedValue(new Error('offline'))} />);
  fireEvent.click(screen.getByText('Сыграть вручную'));
  await screen.findByRole('alert');
  expect(screen.queryByTestId('manual-combat')).toBeNull();
  expect(screen.getByText('Принять результат')).toBeTruthy();
});

it('resumes an interrupted calculation and persists review before displaying it', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  render(<AutobattleScreen initialCombatSnapshot={start()} onCheckpoint={save} />);
  await screen.findByText('Результат автобоя', {}, { timeout: 3000 });
  expect(save.mock.calls.map(call => call[0].autobattle.phase)).toEqual(['running', 'review']);
});

it('a persisted manual choice cannot reopen the autobattle review', () => {
  const checkpoint = { ...start(), autobattle: { version: 1, phase: 'manual' } };
  render(<AutobattleScreen enabled initialCombatSnapshot={checkpoint} onCheckpoint={jest.fn()} />);
  expect(screen.getByTestId('manual-combat')).toBeTruthy();
  expect(screen.queryByText('Принять результат')).toBeNull();
});


it('does not start autobattle in a locked location even with the preference enabled', () => {
  const save = jest.fn();
  render(<AutobattleScreen enabled unlocked={false} onCheckpoint={save} />);
  expect(screen.getByTestId('manual-combat').textContent).toBe('normal:');
  expect(save).not.toHaveBeenCalled();
});

it('shows HP change and allows inspecting spent consumables', () => {
  const initial = start();
  const current = initial.state.players[0];
  const checkpoint = { ...initial, autobattle: {
    version: 1, phase: 'review', outcome: 'victory',
    result: { state: { players: [{ ...current, hp: current.hp - 9, items: [] }] } },
  } };
  render(<AutobattleScreen initialCombatSnapshot={checkpoint} onCheckpoint={jest.fn()} />);
  expect(screen.getByLabelText('Изменение здоровья: −9')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Малое зелье здоровья' }));
  expect(screen.getByRole('dialog', { name: 'Предмет: Малое зелье здоровья' })).toBeInTheDocument();
});

