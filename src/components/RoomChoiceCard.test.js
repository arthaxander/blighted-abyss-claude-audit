import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RoomChoiceCard, { ROOM_CHOICE_VARIANTS } from './RoomChoiceCard';
import { ROOM_LABELS, ROOM_TYPES } from '../utils/roomGeneration';
import { createEnemyInstanceByName } from '../data/enemies';

const rooms = Object.values(ROOM_TYPES).map((roomType, index) => ({
  id: `room-${index}`,
  roomType,
  type: ROOM_LABELS[roomType],
  ...(roomType === ROOM_TYPES.COMBAT ? { enemies: [{ name: 'Длинноимённый противник Бездны' }] } : {}),
}));

describe('RoomChoiceCard', () => {
  test.each(rooms)('maps $roomType to its semantic variant', room => {
    render(<RoomChoiceCard room={room} pathNumber={1} onSelect={jest.fn()} />);

    const accessibleName = room.roomType === ROOM_TYPES.RESOURCE ? 'Ресурсы' : room.type;
    expect(screen.getByRole('button', { name: accessibleName }).closest('.room-choice-card'))
      .toHaveClass(`room-choice-card--${ROOM_CHOICE_VARIANTS[room.roomType]}`);
  });

  test('presents room type as the accessible label without visible path metadata', () => {
    const room = rooms.find(candidate => candidate.roomType === ROOM_TYPES.COMBAT);
    render(<RoomChoiceCard room={room} pathNumber={3} onSelect={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Бой' })).toBeInTheDocument();
    expect(screen.queryByText('Путь 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Враги: Длинноимённый противник Бездны')).not.toBeInTheDocument();
  });

  test('supports optional artwork without requiring an empty artwork region', () => {
    const { rerender } = render(<RoomChoiceCard room={rooms[0]} pathNumber={1} onSelect={jest.fn()} />);
    const card = screen.getByRole('button', { name: rooms[0].type });
    expect(card.closest('.room-choice-card')).not.toHaveClass('room-choice-card--with-art');

    rerender(<RoomChoiceCard room={rooms[0]} pathNumber={1} onSelect={jest.fn()} artworkUrl="/room.webp" />);
    expect(card.closest('.room-choice-card')).toHaveClass('room-choice-card--with-art');
  });

  test('calls the supplied callback with the exact room when enabled', () => {
    const onSelect = jest.fn();
    const room = rooms[0];
    render(<RoomChoiceCard room={room} pathNumber={1} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: room.type }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(room);
  });

  test.each([[100, '+10%'], [150, '+15%'], [200, '+20%']])('shows Ready %s as an inspectable exact %s modifier without selecting', (turnMeter, expected) => {
    const onSelect = jest.fn();
    const room = { id: `ready-${turnMeter}`, roomType: ROOM_TYPES.COMBAT, type: 'Бой', alertModifier: { type: 'ready', name: 'Готовность', turnMeter, description: 'Старое длинное описание' } };
    render(<RoomChoiceCard room={room} pathNumber={1} onSelect={onSelect} />);
    expect(screen.queryByText('Старое длинное описание')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[Готовность]' }));
    expect(screen.getByRole('dialog', { name: 'Готовность' })).toHaveTextContent(expected);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('replaces ordinary Combat names with distinct inspectable portraits', () => {
    const onSelect = jest.fn();
    const onInspectEnemy = jest.fn();
    const first = createEnemyInstanceByName('Гоблин-Потрошитель');
    const second = createEnemyInstanceByName('Гоблин-Ткач');
    const room = { id: 'combat-preview', roomType: ROOM_TYPES.COMBAT, type: 'Бой', enemies: [first, second] };
    render(<RoomChoiceCard room={room} pathNumber={1} onSelect={onSelect} onInspectEnemy={onInspectEnemy} />);

    expect(screen.queryByText(/Враги:|Гоблин-Потрошитель, Гоблин-Ткач/)).not.toBeInTheDocument();
    const firstInspect = screen.getByRole('button', { name: 'Посмотреть Гоблин-Потрошитель' });
    const secondInspect = screen.getByRole('button', { name: 'Посмотреть Гоблин-Ткач' });
    expect(firstInspect.querySelector('img')).toHaveAttribute(
      'src', '/assets/combat/portraits/enemies/goblin_nests/goblin_ripper.webp'
    );
    expect(secondInspect.querySelector('img')).toHaveAttribute(
      'src', '/assets/combat/portraits/enemies/goblin_nests/goblin_weaver.webp'
    );

    fireEvent.click(firstInspect);
    expect(onInspectEnemy).toHaveBeenCalledWith(first);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Бой' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(room);
  });

  test('groups duplicate canonical enemy identities into one portrait with a count', () => {
    const enemy = createEnemyInstanceByName('Гоблин-Потрошитель');
    const duplicate = { ...enemy };
    const room = { id: 'duplicates', roomType: ROOM_TYPES.COMBAT, type: 'Бой', enemies: [enemy, duplicate] };
    render(<RoomChoiceCard room={room} pathNumber={1} onSelect={jest.fn()} onInspectEnemy={jest.fn()} />);

    expect(screen.getAllByRole('button', { name: 'Посмотреть Гоблин-Потрошитель' })).toHaveLength(1);
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  test('supports a six-unit preview in the adaptive three-column grid', () => {
    const template = createEnemyInstanceByName('Гоблин-Потрошитель');
    const enemyList = Array.from({ length: 6 }, (_, index) => ({ ...template, id: `visible-${index}`, name: `Враг ${index + 1}` }));
    const { container } = render(<RoomChoiceCard room={{ id: 'six', roomType: ROOM_TYPES.COMBAT, type: 'Бой', enemies: enemyList }} pathNumber={1} onSelect={jest.fn()} />);
    expect(enemyList).toHaveLength(6);
    expect(container.querySelectorAll('.room-choice-card__enemy')).toHaveLength(6);
    expect(container.querySelector('.room-choice-card__enemies')).toBeInTheDocument();
  });

  test.each([
    [ROOM_TYPES.BOSS, 'Босс: Пепельный Колпак Рагшнар', 'Пепельный Колпак Рагшнар'],
    [ROOM_TYPES.CURSED_ENEMY, 'Проклятый враг: Осквернённый гоблин-крысокожий', 'Осквернённый гоблин-крысокожий'],
  ])('keeps special enemy identity visible and adds inspection for %s', (roomType, visibleText, enemyName) => {
    const enemy = createEnemyInstanceByName(enemyName);
    render(
      <RoomChoiceCard
        room={{ id: roomType, roomType, type: ROOM_LABELS[roomType], enemies: [enemy] }}
        pathNumber={1}
        onSelect={jest.fn()}
        onInspectEnemy={jest.fn()}
      />
    );

    expect(screen.getByText(visibleText)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Посмотреть ${enemyName}` })).toBeInTheDocument();
  });

  test('uses native disabled behavior to prevent selection', () => {
    const onSelect = jest.fn();
    const onInspectEnemy = jest.fn();
    const room = {
      ...rooms[0],
      enemies: [createEnemyInstanceByName('Гоблин-Потрошитель')],
    };
    render(
      <RoomChoiceCard
        room={room}
        pathNumber={1}
        disabled
        onSelect={onSelect}
        onInspectEnemy={onInspectEnemy}
      />
    );

    const accessibleName = room.roomType === ROOM_TYPES.RESOURCE ? 'Ресурсы' : room.type;
      const card = screen.getByRole('button', { name: accessibleName });
    const portrait = screen.getByRole('button', { name: 'Посмотреть Гоблин-Потрошитель' });
    expect(card).toBeDisabled();
    expect(portrait).toBeDisabled();
    fireEvent.click(card);
    fireEvent.click(portrait);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onInspectEnemy).not.toHaveBeenCalled();
  });

  test('Secret presentation does not expose its hidden resolution data', () => {
    const secret = {
      id: 'secret',
      type: 'Секрет',
      roomType: ROOM_TYPES.SECRET,
      hiddenRoomType: 'SECRET_TREASURE',
      hiddenType: 'Сокровище',
      hiddenPayload: { description: 'Скрытая награда', enemies: [{ name: 'Скрытый враг' }] },
    };
    render(<RoomChoiceCard room={secret} pathNumber={2} onSelect={jest.fn()} />);

    expect(screen.getByText('Скрытая развилка. Содержимое неизвестно.')).toBeInTheDocument();
    expect(screen.queryByText(/Сокровище|Скрытая награда|Скрытый враг/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Посмотреть/ })).not.toBeInTheDocument();
  });

  test('renders long room labels and content without data truncation', () => {
    const room = {
      id: 'future-room',
      roomType: 'FUTURE_ROOM',
      type: 'Очень длинное название таинственной комнаты Бездны',
      description: 'Очень длинное описание остаётся полным и доступным игроку без программного сокращения.',
    };
    render(<RoomChoiceCard room={room} pathNumber={1} onSelect={jest.fn()} />);

    expect(screen.getByText(room.type)).toHaveTextContent(room.type);
    expect(screen.getByText(room.description)).toHaveTextContent(room.description);
  });
});
