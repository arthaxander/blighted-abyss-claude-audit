import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DungeonRunHud from './DungeonRunHud';

const effects = [
  { id: 'location', name: 'Нашествие крыс', description: 'Описание эффекта локации.', kind: 'location', symbol: 'Л' },
  { id: 'curse', name: 'Осквернение (1)', description: 'Описание проклятия с [Кровотечением].', kind: 'curse' },
];

describe('DungeonRunHud', () => {
  test('renders the seven-slot maximum in location, curse, then future modifier order', () => {
    const maximumEffects = [
      { id: 'location-max', name: 'Локация', description: 'Локация', kind: 'location' },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `curse-${index}`,
        name: `Проклятие ${index + 1}`,
        description: 'Проклятие',
        kind: 'curse',
      })),
      { id: 'future-tarot', name: 'Гадание', description: 'Гадание', kind: 'tarot' },
    ];
    render(<DungeonRunHud effects={maximumEffects} onOpenInventory={jest.fn()} onOpenCrafting={jest.fn()} />);

    const slots = screen.getByLabelText('Эффекты забега').querySelectorAll('.dungeon-effect-icon');
    expect(slots).toHaveLength(7);
    expect(Array.from(slots).map(slot => slot.getAttribute('aria-label'))).toEqual(
      maximumEffects.map(effect => `${effect.name}: открыть описание`)
    );
    expect(slots[0]).toHaveClass('dungeon-effect-icon--location');
    expect(slots[6]).toHaveClass('dungeon-effect-icon--tarot');
  });

  test('renders effect icons in a compact row and opens their description', () => {
    render(<DungeonRunHud effects={effects} onOpenInventory={jest.fn()} onOpenCrafting={jest.fn()} />);
    const row = screen.getByLabelText('Эффекты забега');
    const locationEffect = screen.getByRole('button', { name: 'Нашествие крыс: открыть описание' });
    expect(row).toContainElement(locationEffect);
    expect(row).toContainElement(screen.getByRole('button', { name: 'Осквернение (1): открыть описание' }));

    fireEvent.click(locationEffect);
    expect(screen.getByRole('dialog', { name: 'Нашествие крыс' })).toBeInTheDocument();
    expect(screen.getByText('Описание эффекта локации.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Осквернение (1): открыть описание' }));
    const inlineTerm = screen.getByRole('button', { name: '[Кровотечением]' });
    expect(inlineTerm).toHaveClass('game-term-inline');
    expect(screen.getByRole('button', { name: 'Закрыть' })).not.toHaveClass('game-term-inline');
  });

  test('renders compact utility controls and only shows portal when available', () => {
    const onInventory = jest.fn();
    const onCrafting = jest.fn();
    const onPortal = jest.fn();
    const { rerender } = render(
      <DungeonRunHud effects={[]} onOpenInventory={onInventory} onOpenCrafting={onCrafting} onUsePortal={onPortal} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Инвентарь' }));
    fireEvent.click(screen.getByRole('button', { name: 'Полевой крафт' }));
    expect(onInventory).toHaveBeenCalledTimes(1);
    expect(onCrafting).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Инвентарь' })).toHaveClass('dungeon-utility-button');
    expect(screen.queryByRole('button', { name: 'Вернуться в Гильдию' })).not.toBeInTheDocument();

    rerender(
      <DungeonRunHud effects={[]} onOpenInventory={onInventory} onOpenCrafting={onCrafting} onUsePortal={onPortal} portalAvailable />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться в Гильдию' }));
    expect(onPortal).toHaveBeenCalledTimes(1);
  });

  test('uses native disabled semantics while another dungeon interaction is active', () => {
    render(
      <DungeonRunHud
        effects={[]}
        onOpenInventory={jest.fn()}
        onOpenCrafting={jest.fn()}
        portalAvailable
        onUsePortal={jest.fn()}
        utilitiesDisabled
      />
    );
    screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled());
  });

  test('keeps the portal visible but blocked and exposes the abyss sever action', () => {
    const sever = jest.fn();
    render(<DungeonRunHud
      effects={[{ id: 'abyss-binding', name: 'Связь с Бездной', description: 'Обычная эвакуация невозможна.', symbol: '⛓' }]}
      onOpenInventory={jest.fn()}
      onOpenCrafting={jest.fn()}
      portalAvailable
      portalBlockedReason="Камень портала не отвечает: герой связан с Бездной"
      abyssBound
      onSeverAbyssLink={sever}
    />);
    expect(screen.getByRole('button', { name: 'Камень портала не отвечает: герой связан с Бездной' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Разорвать связь' }));
    expect(sever).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Связь с Бездной: открыть описание' }));
    expect(screen.getByText('Обычная эвакуация невозможна.')).toBeInTheDocument();
  });

  test('uses curse sigils and a distinct dominant-curse presentation state', () => {
    render(<DungeonRunHud
      effects={[
        { id: 'curse-corruption', name: 'Осквернение (II)', description: 'Описание', kind: 'curse', symbol: '◆', accent: '#9f4555' },
        { id: 'curse-distortion', name: 'Искажение (III) — Главное Проклятие', description: 'Описание', kind: 'curse', symbol: '◇', accent: '#765a9d', dominant: true },
      ]}
      onOpenInventory={jest.fn()}
      onOpenCrafting={jest.fn()}
    />);
    expect(screen.getByRole('button', { name: 'Осквернение (II): открыть описание' })).toHaveTextContent('◆');
    const dominant = screen.getByRole('button', { name: 'Искажение (III) — Главное Проклятие: открыть описание' });
    expect(dominant).toHaveTextContent('◇');
    expect(dominant).toHaveClass('dungeon-effect-icon--dominant');
  });
});
