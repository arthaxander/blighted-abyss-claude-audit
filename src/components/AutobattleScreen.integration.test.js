import React from 'react';
import { UIProvider } from '../contexts/UIContext';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AutobattleScreen from './AutobattleScreen';
import { createAutobattleCheckpoint, calculateAutobattle } from '../utils/autobattle';
import { createSimulationPlayer, chooseCombatAction } from '../utils/combatSimulator';
import { createAbilityByName } from '../data/abilityPresets';

it.each([['victory', 1], ['defeat', 999]])('accepted %s uses normal finalization only once', async (outcome, attack) => {
  const player = createSimulationPlayer({ classId: 'Mage', hp: 40, abilityIds: ['Огненный шар', 'Атака'] });
  const enemies = [{ id: 'dummy', name: 'Манекен', hp: 60, maxHp: 60, attack, speed: 150, abilities: [createAbilityByName('Атака', attack)] }];
  const result = await calculateAutobattle(createAutobattleCheckpoint(player, enemies, false, 42), chooseCombatAction);
  expect(result.autobattle.outcome).toBe(outcome);
  const onVictory = jest.fn(); const onDefeat = jest.fn(); const onCombatSnapshot = jest.fn();
  render(<UIProvider><AutobattleScreen player={player} enemies={enemies} initialCombatSnapshot={result}
    onCheckpoint={jest.fn().mockResolvedValue(undefined)} onCombatSnapshot={onCombatSnapshot} onVictory={onVictory} onDefeat={onDefeat} /></UIProvider>);
  expect(onCombatSnapshot).not.toHaveBeenCalled();
  expect(onVictory).not.toHaveBeenCalled(); expect(onDefeat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Принять результат'));
  await waitFor(() => expect(screen.getByText('Продолжить')).toBeTruthy());
  expect(onCombatSnapshot).toHaveBeenCalledTimes(1);
  expect(onCombatSnapshot.mock.calls[0][0].battleResult.outcome).toBe(outcome);
  fireEvent.click(screen.getByText('Продолжить'));
  fireEvent.click(screen.getByText('Продолжить'));
  expect(outcome === 'victory' ? onVictory : onDefeat).toHaveBeenCalledTimes(1);
  expect(outcome === 'victory' ? onDefeat : onVictory).not.toHaveBeenCalled();
});
