import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import EffectReferenceText from './EffectReferenceText';
import { getItemTextSections } from '../utils/itemDetailsPresentation';
import { equipment, equipmentByName } from '../data/equipment';
import { findItemData } from '../data/items';

test('canonical equipment description has a linked protection seal and clear wording', () => {
  const name = 'Кираса последнего в строю';
  const sections = getItemTextSections(findItemData(name), equipmentByName[name]);
  render(<EffectReferenceText parts={sections.effectParts} />);
  const seal = screen.getByRole('button', { name: '[Печать защиты]' });
  expect(seal).toBeInTheDocument();
  expect(screen.getByText(/После двух отдельных прямых атак/)).toBeInTheDocument();
  fireEvent.click(seal);
  expect(screen.getByRole('dialog', { name: 'Статус: Печати защиты' })).toBeInTheDocument();
});

test('legacy plain-text status names link automatically, without duplicating explicit brackets', () => {
  render(<EffectReferenceText parts={['Накладывает Кровотечение, затем [Горение].']} />);
  expect(screen.getAllByRole('button', { name: '[Кровотечение]' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: '[Горение]' })).toHaveLength(1);
  expect(screen.queryByText('[[Горение]]')).not.toBeInTheDocument();
});

test('equipment descriptions avoid technical turn-window jargon', () => {
  const offenders = equipment.filter(item => /между началами (?:собственных|ваших|его собственных) ходов|между собственными ходами/i.test(item.description || ''));
  expect(offenders.map(item => item.name)).toEqual([]);
});
