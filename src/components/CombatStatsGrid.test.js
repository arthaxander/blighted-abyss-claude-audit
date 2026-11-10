import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { calcMitigation } from '../utils/combatUtils';
import CombatStatsGrid from './CombatStatsGrid';
import { formatMitigationPercent } from './DefenseInfoDialog';

test.each([0, 10, 25, 50, 100, 250])('mitigation display reuses the canonical nonlinear formula at %s defense', defense => {
  expect(formatMitigationPercent(defense)).toBe(`${Math.round(calcMitigation(defense) * 100)}%`);
});

test('only defense stats expose a separate mitigation dialog', () => {
  render(<CombatStatsGrid stats={[
    { key: 'speed', label: 'Скорость', value: 8 },
    { key: 'physAtk', label: 'Физическая атака', value: 12 },
    { key: 'physDef', label: 'Физическая защита', value: 25 },
    { key: 'magicDef', label: 'Магическая защита', value: 10 },
  ]} />);

  expect(screen.queryByLabelText('Подробнее: Скорость')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Подробнее: Физическая атака')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Подробнее: Физическая защита')).toBeInTheDocument();
  expect(screen.getByLabelText('Подробнее: Магическая защита')).toBeInTheDocument();
  expect(document.querySelector('.combat-defense-explanation')).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Подробнее: Физическая защита'));
  expect(screen.getByRole('dialog', { name: 'Физическая защита' })).toHaveTextContent('20%');
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(screen.queryByRole('dialog', { name: 'Физическая защита' })).not.toBeInTheDocument();
});
