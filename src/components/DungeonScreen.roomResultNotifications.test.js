import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { UIProvider } from '../contexts/UIContext';
import { ROOM_TYPES, SECRET_TYPES } from '../utils/roomGeneration';
import { createEnemyInstanceByName } from '../data/enemies';
import GuildScreen from './GuildScreen';

jest.mock('../data/fishing', () => ({
  createFishingChallenge: () => ({ rewards: { fishItem: 'Простая ткань', silver: 7 } }),
}));
jest.mock('./FishingRoomModal', () => ({ onSuccess, onFail }) => <div role="dialog" aria-label="Рыбалка"><button onClick={onSuccess}>Тест: поймать</button><button onClick={() => onFail('Неудача')}>Тест: упустить</button></div>);
jest.mock('./TrapDisarmModal', () => ({ onResolve }) => <div role="dialog" aria-label="Ловушка"><button onClick={() => onResolve({ method: 'tools', success: true })}>Тест: обезвредить</button></div>);

const basePlayer = choices => ({
  currentLocation: 'Гоблинские Норы',
  currentDungeonChoices: choices,
  currentDungeonChoicesLocation: 'Гоблинские Норы',
  roomGenerationState: { 'Гоблинские Норы': { completedCombatRooms: 0, choiceWindowIndex: 0 } },
  curses: {}, tarotSpread: [], inventory: [], runInventory: [], equipment: {}, relics: {},
});

const renderRoom = (choice, overrides = {}) => render(<UIProvider><DungeonScreenHarness choice={choice} {...overrides} /></UIProvider>);

const DungeonScreenHarness = ({ choice, withoutLocation = false }) => {
  const [pending, setPending] = useState(null);
  const choices = [
    choice,
    { id: 'filler-combat', type: 'Бой', roomType: ROOM_TYPES.COMBAT, enemies: [createEnemyInstanceByName('Гоблин-Потрошитель')] },
    choice.roomType === ROOM_TYPES.SECRET
      ? { id: 'filler-resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE, loot: [] }
      : { id: 'filler-secret', type: 'Секрет', roomType: ROOM_TYPES.SECRET, hiddenRoomType: SECRET_TYPES.RESOURCE, hiddenPayload: { loot: [] } },
  ];
  const [player, setPlayer] = useState(() => ({ ...basePlayer(choices), ...(withoutLocation ? { currentLocation: null, currentDungeonChoicesLocation: null } : {}) }));
  const DungeonScreen = require('./DungeonScreen').default;
  return <>
    <DungeonScreen player={player} onEnterDungeon={jest.fn()} onReturnToGuild={jest.fn()} onUpdatePlayer={update => setPlayer(prev => ({ ...prev, ...(typeof update === 'function' ? update(prev) : update) }))} onPendingLoot={setPending} />
    {pending && <output aria-label="Найденные ресурсы">{pending.items.map(item => `${item.name} x${item.quantity}`).join(', ')}</output>}
  </>;
};

test('Resource Room keeps actual rewards but emits no subtype/reward toast', () => {
  renderRoom({ id: 'resource', type: 'Ресурсы', roomType: ROOM_TYPES.RESOURCE, roomName: 'Поле мха', loot: [{ name: 'Простая ткань', quantity: 2 }] });
  expect(screen.getByText('Ресурсы')).toBeInTheDocument();
  expect(screen.queryByText('Поле мха')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ресурсы' }));
  expect(screen.getByLabelText('Найденные ресурсы')).toHaveTextContent('Простая ткань x2');
  expect(screen.queryByText('Сбор ресурсов')).not.toBeInTheDocument();
  expect(screen.queryByText('Выберите, что забрать.')).not.toBeInTheDocument();
});

test('fishing success and failure do not create duplicate result toasts', () => {
  const choice = { id: 'fish', type: 'Рыбалка', roomType: ROOM_TYPES.FISHING };
  const success = renderRoom(choice);
  fireEvent.click(screen.getByRole('button', { name: 'Рыбалка' }));
  fireEvent.click(screen.getByRole('button', { name: 'Тест: поймать' }));
  expect(screen.getByLabelText('Найденные ресурсы')).toHaveTextContent('Простая ткань x1');
  expect(screen.queryByText('Улов в сумке')).not.toBeInTheDocument();
  success.unmount();
  renderRoom(choice);
  fireEvent.click(screen.getByRole('button', { name: 'Рыбалка' }));
  fireEvent.click(screen.getByRole('button', { name: 'Тест: упустить' }));
  expect(screen.queryByText('Рыба сорвалась')).not.toBeInTheDocument();
});

test('trap resolution applies rewards without a duplicate result toast', () => {
  renderRoom({ id: 'trap', type: 'Секрет', roomType: ROOM_TYPES.SECRET, hiddenRoomType: SECRET_TYPES.TRAP, hiddenPayload: { damage: 10 } });
  fireEvent.click(screen.getByRole('button', { name: /Секрет/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Тест: обезвредить' }));
  expect(screen.queryByText('Ловушка обезврежена')).not.toBeInTheDocument();
});

test('the retained generic toast system still reports a real inventory failure', () => {
  render(<UIProvider><GuildScreen player={{ class: 'Defender', inventory: [], equipment: {}, questLog: {}, relics: {} }} storageItems={[]} onUpdatePlayer={jest.fn()} onUnloadAllToStorage={() => ({ movedQuantity: 0, remainingQuantity: 1 })} /></UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Рюкзак' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выгрузить всё на склад' }));
  expect(screen.getByText('На складе нет места')).toBeInTheDocument();
});

