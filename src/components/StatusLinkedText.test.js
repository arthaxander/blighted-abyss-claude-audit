import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import StatusLinkedText, { resolveStatusTerm } from './StatusLinkedText';
import { CURSE_DEFINITIONS } from '../data/curses';
import { getEffectDefinition } from '../utils/effects';

describe('StatusLinkedText', () => {
  test('resolves canonical and inflected curse terms into accessible status tokens', () => {
    render(<StatusLinkedText>Получает [Кровотечение], [Жажду] и [Испепеляющее клеймо].</StatusLinkedText>);
    expect(screen.getByRole('button', { name: '[Кровотечение]' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '[Жажду]' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '[Испепеляющее клеймо]' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[Жажду]' }));
    expect(screen.getByRole('dialog', { name: 'Статус: Жажда' })).toHaveTextContent('исходящего урона');
    expect(resolveStatusTerm('Эхо')).toMatchObject({ id: 'mechanic_echo', virtual: true });
  });

  test('[Эхо] uses virtual mechanic copy without changing Echo Charge or Отзвук', () => {
    expect(resolveStatusTerm('Эхо').description).toMatch(/Повторяет результат способности/);
    expect(resolveStatusTerm('Эхо').description).toMatch(/Момент повторения определяется источником/);
    expect(resolveStatusTerm('Эха').id).toBe('mechanic_echo');
    render(<StatusLinkedText>Получает [Эхо].</StatusLinkedText>);
    fireEvent.click(screen.getByRole('button', { name: '[Эхо]' }));
    expect(screen.getByRole('dialog', { name: 'Статус: Эхо' })).toHaveTextContent('Эхо не может породить новое Эхо');
    expect(getEffectDefinition('ruins_echo_charge')).toMatchObject({ name: 'Эхо', type: 'resource' });
    expect(getEffectDefinition('echo')).toMatchObject({ name: 'Отзвук', type: 'debuff' });
  });

  test('every bracketed term used by curse copy resolves to canonical or virtual terminology', () => {
    const copy = Object.values(CURSE_DEFINITIONS).flatMap(definition => [
      definition.commonText,
      ...definition.tiers.map(entry => entry.description),
    ]).filter(Boolean).join(' ');
    const terms = [...copy.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
    expect(new Set(terms)).toEqual(new Set([
      'Жажду', 'Жажда', 'Жажде', 'Кровотечение', 'Кровотечения', 'Жажды', 'Багровый экстаз',
      'Преломления', 'Преломление', 'Преломлении', 'Заряд', 'Опутывание', 'Опутыванию', 'Опутывания',
      'Опутыванием', 'Эхо', 'Эха', 'Замедление', 'Беспамятство', 'Испепеляющее клеймо',
    ]));
    expect(terms.filter(term => !resolveStatusTerm(term))).toEqual([]);
  });

  test('keeps an unknown bracketed term without throwing', () => {
    render(<StatusLinkedText>Текст [Неизвестный эффект].</StatusLinkedText>);
    expect(screen.getByText('[Неизвестный эффект]')).toBeInTheDocument();
  });
});
