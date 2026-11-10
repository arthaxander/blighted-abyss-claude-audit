import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DeathSummary from './DeathSummary';

test('shows exact preserved stacks with canonical quantity overlay and continues explicitly', () => {
  const onContinue = jest.fn();
  render(<DeathSummary preservedStacks={[{ itemId: 'Простая ткань', quantity: 3 }]} onContinue={onContinue} />);
  expect(screen.getByRole('heading', { name: 'Поражение' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Сохранено' })).toBeInTheDocument();
  expect(screen.getByText('3')).toHaveClass('item-icon-quantity');
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

test('shows an explicit empty preservation state', () => {
  render(<DeathSummary preservedStacks={[]} onContinue={jest.fn()} />);
  expect(screen.getByText('Ничего не сохранено')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Сохранено' })).not.toBeInTheDocument();
});
