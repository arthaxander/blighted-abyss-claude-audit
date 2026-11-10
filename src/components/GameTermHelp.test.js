import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { GameTermHelpProvider, GameTermText, parseGameTermText } from './GameTermHelp';
import { CLASS_TALENT_SETS } from '../data/classTalents.mjs';

const renderTerms = children => render(<GameTermHelpProvider><div data-testid="parent">{children}</div></GameTermHelpProvider>);

describe('shared game-term help', () => {
  test('parses canonical bracketed terms and leaves unknown brackets as text', () => {
    expect(parseGameTermText('[Оглушение] и [неизвестное]')).toEqual([
      { statusId: 'stun', text: 'Оглушение' }, ' и ', '[неизвестное]',
    ]);
  });

  test('every bracketed class-talent effect resolves to a tooltip term', () => {
    CLASS_TALENT_SETS.flatMap(set => set.talents).forEach(talent => {
      const bracketed = [...talent.description.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
      const parsed = parseGameTermText(talent.description);
      const resolved = parsed.filter(part => typeof part === 'object');
      expect(resolved).toHaveLength(bracketed.length);
    });
  });

  test('opens virtual Echo mechanic through the same shared help surface', () => {
    renderTerms(<GameTermText text="Получает [Эхо]." />);
    fireEvent.click(screen.getByRole('button', { name: '[Эхо]' }));
    const help = screen.getByRole('dialog', { name: 'Статус: Эхо' });
    expect(help).toHaveTextContent('Момент повторения определяется источником Эха');
    expect(help).toHaveTextContent('Эхо не может породить новое Эхо');
  });

  test('opens localized help from a previously display-only bracketed description', () => {
    const parentAction = jest.fn();
    render(<GameTermHelpProvider><div role="button" tabIndex={0} onClick={parentAction}><GameTermText text="Получает [Щит]." /></div></GameTermHelpProvider>);
    fireEvent.click(screen.getByRole('button', { name: '[Щит]' }));
    const help = screen.getByRole('dialog', { name: 'Статус: Щит' });
    expect(help).toHaveTextContent('сначала расходуют Щит без учёта защиты');
    expect(help).toHaveTextContent('урон, дошедший до здоровья, уменьшается соответствующей защитой');
    expect(help).toHaveAttribute('data-presentation', 'compact-centered');
    expect(help.parentElement).toHaveAttribute('data-presentation', 'centered');
    expect(parentAction).not.toHaveBeenCalled();
  });

  test('shows the registered status artwork rather than an implementation glyph', () => {
    renderTerms(<GameTermText text="[Кровотечение]" />);
    fireEvent.click(screen.getByRole('button', { name: '[Кровотечение]' }));
    const help = screen.getByRole('dialog', { name: 'Статус: Кровотечение' });
    const icon = help.querySelector('img.game-term-help-icon');
    expect(icon).toBeTruthy();
    expect(icon.getAttribute('src')).toMatch(/\.webp|\.png|\.svg/i);
  });

  test('renders effect activation as restrained inline text rather than the old chip treatment', () => {
    renderTerms(<GameTermText text="Получает [Щит]." />);
    const term = screen.getByRole('button', { name: '[Щит]' });
    expect(term).toHaveClass('game-term-inline');
    expect(term).toHaveAttribute('data-presentation', 'inline-text');
    expect(term).not.toHaveClass('game-term-reference');
    expect(term.textContent).toBe('[Щит]');
    expect(getComputedStyle(term).textDecorationLine).not.toBe('underline');
    expect(term).not.toHaveClass('game-term-reference', 'enemy-detail-status-reference');
  });

  test('renderer owns brackets and prevents duplicate bracket storage from leaking', () => {
    renderTerms(<GameTermText parts={[{ statusId: 'burn', text: '[Горение]' }]} />);
    expect(screen.getByRole('button', { name: '[Горение]' })).toHaveTextContent('[Горение]');
    expect(screen.queryByText('[[Горение]]')).not.toBeInTheDocument();
  });

  test('one click opens help and a second intentional close click is required', () => {
    renderTerms(<GameTermText text="Накладывает [Оглушение]." />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '[Оглушение]' }), { pointerType: 'touch' });
    fireEvent.pointerUp(screen.getByRole('button', { name: '[Оглушение]' }), { pointerType: 'touch' });
    fireEvent.click(screen.getByRole('button', { name: '[Оглушение]' }));
    expect(screen.getByRole('dialog', { name: 'Статус: Оглушение' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть описание статуса Оглушение' }));
    expect(screen.queryByRole('dialog', { name: 'Статус: Оглушение' })).not.toBeInTheDocument();
  });

  test('opening another term replaces the one shared surface', () => {
    renderTerms(<GameTermText text="[Кровотечение] усиливает [Уязвимость]." />);
    fireEvent.click(screen.getByRole('button', { name: '[Кровотечение]' }));
    expect(screen.getByRole('dialog', { name: 'Статус: Кровотечение' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[Уязвимость]' }));
    expect(screen.queryByRole('dialog', { name: 'Статус: Кровотечение' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Статус: Уязвимость' })).toBeInTheDocument();
  });

  test('outside click and Escape close only help, not its parent details', () => {
    const parentClose = jest.fn();
    render(<GameTermHelpProvider><section role="dialog" aria-label="Навык"><GameTermText text="[Мощное укрепление]" /><button onClick={parentClose}>Закрыть навык</button></section></GameTermHelpProvider>);
    fireEvent.click(screen.getByRole('button', { name: '[Мощное укрепление]' }));
    fireEvent.click(document.querySelector('.game-term-help-layer'));
    expect(screen.getByRole('dialog', { name: 'Навык' })).toBeInTheDocument();
    expect(parentClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '[Мощное укрепление]' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Статус: Мощное укрепление' })).not.toBeInTheDocument();
  });
});

