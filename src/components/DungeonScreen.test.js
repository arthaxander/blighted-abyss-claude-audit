import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DungeonScreen from './DungeonScreen';
import { UIProvider } from '../contexts/UIContext';
import { ROOM_TYPES, SECRET_TYPES } from '../utils/roomGeneration';
import { createEnemyInstanceByName } from '../data/enemies';
import { isStrongEnemy } from '../utils/levelOneProgression';

// Room/crafting tests do not mount the independent fishing minigame.
jest.mock('./FishingRoomModal', () => () => null);

const player = {
  currentLocation: 'Гоблинские Норы',
  roomGenerationState: {
    'Гоблинские Норы': { completedCombatRooms: 0, choiceWindowIndex: 0 },
  },
  currentDungeonChoices: [],
  curses: {},
  tarotSpread: [],
  inventory: [],
  runInventory: [],
  equipment: {},
};

describe('DungeonScreen decision layout', () => {
  test('late approach fight still has only ordinary goblins', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
    try {
      const onContent = jest.fn();
      render(<UIProvider><DungeonScreen player={{ ...player, roomGenerationState: {
        'Гоблинские Норы': { completedCombatRooms: 100, choiceWindowIndex: 0 },
      } }} expeditionCell={{ id: 'late-approach', phase: 'approach', region: 'approach', previewRoomType: ROOM_TYPES.COMBAT }}
      onExpeditionCellContent={onContent} onEnterDungeon={jest.fn()} onReturnToGuild={jest.fn()} /></UIProvider>);
      expect(onContent).toHaveBeenCalled();
      const roster = onContent.mock.calls[0][0].enemies;
      expect(roster).toHaveLength(3);
      expect(roster.some(isStrongEnemy)).toBe(false);
    } finally { random.mockRestore(); }
  });
  test('field crafting uses the shared catalogue and commits inventory with quest progress once', () => {
    let current;
    const onQuestEvent = jest.fn();
    const CraftHarness = () => {
      const [state, setState] = useState({
        ...player,
        inventory: ['Кровяной мох', 'Кровяной мох', 'Простая ткань'],
        runInventory: [
          { itemId: 'Кровяной мох', quantity: 2 },
          { itemId: 'Простая ткань', quantity: 1 },
          ...Array(10).fill(null),
        ],
      });
      current = state;
      return <DungeonScreen player={state} onEnterDungeon={jest.fn()} onReturnToGuild={jest.fn()} onUpdatePlayer={update => setState(previous => ({ ...previous, ...(typeof update === 'function' ? update(previous) : update) }))} onPendingLoot={jest.fn()} onQuestEvent={onQuestEvent} />;
    };
    render(<UIProvider><CraftHarness /></UIProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Полевой крафт' }));
    const recipe = screen.getAllByTestId('recipe-cell').find(node =>
      within(node).queryByRole('button', { name: 'Создать: Кровяная припарка' }));
    expect(recipe).toBeInTheDocument();
    const craft = within(recipe).getByRole('button', { name: 'Создать: Кровяная припарка' });
    expect(craft).toBeEnabled();
    expect(craft).toHaveClass('guild-recipe-craft');
    fireEvent.click(craft);
    expect(current.runInventory.find(entry => entry?.itemId === 'Кровяной мох')).toHaveProperty('quantity', 1);
    expect(current.runInventory.find(entry => entry?.itemId === 'Простая ткань')).toBeUndefined();
    expect(current.runInventory.find(entry => entry?.itemId === 'Кровяная припарка')).toHaveProperty('quantity', 1);
    expect(within(recipe).getByRole('button', { name: 'Создать: Кровяная припарка' })).toBeDisabled();
    expect(screen.getByText('Создано: Кровяная припарка')).toBeInTheDocument();
    expect(current.questLog['quest-brew-supplies'].progress).toBe(1);
    expect(onQuestEvent).not.toHaveBeenCalled();
  });
  test('passes stable Goblin Nests artwork to all visible room types without Secret leakage', async () => {
    const combatEnemy = createEnemyInstanceByName('Гоблин-Потрошитель');
    const onEnterDungeon = jest.fn();
    const choices = [
      { id: 'combat', roomType: ROOM_TYPES.COMBAT, type: 'Бой', enemies: [combatEnemy] },
      { id: 'resource', roomType: ROOM_TYPES.RESOURCE, type: 'Ресурсы', roomName: 'Склад' },
      {
        id: 'secret',
        roomType: ROOM_TYPES.SECRET,
        type: 'Секрет',
        hiddenRoomType: SECRET_TYPES.COMBAT,
        hiddenPayload: { enemies: [{ name: 'Скрытый гоблин' }] },
      },
    ];
    render(
      <UIProvider>
        <DungeonScreen
          player={{ ...player, currentDungeonChoices: choices, currentDungeonChoicesLocation: player.currentLocation }}
          onEnterDungeon={onEnterDungeon}
          onReturnToGuild={jest.fn()}
          onUpdatePlayer={jest.fn()}
          onPendingLoot={jest.fn()}
        />
      </UIProvider>
    );

    const combat = await screen.findByRole('button', { name: 'Бой' });
    expect(combat.closest('.room-choice-card')).toHaveClass('room-choice-card--with-art');
    expect(combat.closest('.room-choice-card').style.getPropertyValue('--room-artwork')).toMatch(/combat_0[123]\.webp/);
    expect(screen.getByRole('button', { name: 'Ресурсы' }).closest('.room-choice-card').style.getPropertyValue('--room-artwork')).toMatch(/resource_0[123]\.webp/);
    expect(screen.getByText('Ресурсы')).toBeInTheDocument();
    expect(screen.queryByText('Склад')).not.toBeInTheDocument();
    const secretCard = screen.getByRole('button', { name: 'Секрет' }).closest('.room-choice-card');
    const secretArtwork = secretCard.style.getPropertyValue('--room-artwork');
    expect(secretArtwork).toMatch(/secret_0[12]\.webp/);
    expect(screen.queryByText('Скрытый гоблин')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Посмотреть Скрытый гоблин/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Посмотреть Гоблин-Потрошитель' }));
    expect(await screen.findByRole('dialog', { name: 'Гоблин-Потрошитель' })).toBeInTheDocument();
    expect(onEnterDungeon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть сведения о враге' }));
    expect(secretCard.style.getPropertyValue('--room-artwork')).toBe(secretArtwork);
    fireEvent.click(combat);
    expect(onEnterDungeon).toHaveBeenCalledTimes(1);
  });

  test('keeps location and choices prominent while omitting old flavor and boss progress text', async () => {
    render(
      <UIProvider>
        <DungeonScreen
          player={player}
          onEnterDungeon={jest.fn()}
          onReturnToGuild={jest.fn()}
          onUpdatePlayer={jest.fn()}
          onPendingLoot={jest.fn()}
        />
      </UIProvider>
    );

    expect(screen.getByRole('heading', { name: 'Гоблинские Норы' })).toBeInTheDocument();
    expect(screen.queryByText('Тоннели, кишащие гоблинами и крысами.')).not.toBeInTheDocument();
    expect(screen.queryByText(/До появления босса осталось/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Эффекты забега')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Инвентарь' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Полевой крафт' })).toBeInTheDocument();
    expect(screen.queryByText(/Путь [123]/)).not.toBeInTheDocument();
    expect(screen.getByText('Выберите путь')).toBeInTheDocument();
    expect(screen.queryByText('Выберите комнату')).not.toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: /Бой|Сокровище|Секрет|Ресурсы|Рыбалка|Алтарь|Проклятый враг|Босс/ })).length).toBeGreaterThanOrEqual(2);
  });
});


test.each([ROOM_TYPES.RESOURCE, ROOM_TYPES.TREASURE])('Depth preserves authored %s instead of replacing it with combat', async roomType => {
  const onContent = jest.fn();
  render(<UIProvider><DungeonScreen player={player}
    expeditionCell={{ id: 'depth-noncombat', phase: 'depth', region: 'depth', previewRoomType: roomType }}
    onExpeditionCellContent={onContent} onEnterDungeon={jest.fn()} onReturnToGuild={jest.fn()} />
  </UIProvider>);
  expect(onContent).toHaveBeenCalled();
  expect(onContent.mock.calls[0][0].roomType).toBe(roomType);
  expect(onContent.mock.calls[0][0].enemies || []).toHaveLength(0);
});

test('restored altar retains both offers and grants only the selected second curse', () => {
  const offers = { curseId: 'corruption', curseIds: ['corruption', 'withering'] };
  const event = JSON.parse(JSON.stringify({ ...offers, pathId: 'saved-altar', type: 'Алтарь', status: 'active' }));
  const onUpdatePlayer = jest.fn();
  render(<UIProvider><DungeonScreen player={{ ...player, abyssLevel: 1, currentPathEvent: event }}
    expeditionCell={{ id: 'saved-altar', region: 'approach', phase: 'approach', content: { ...offers, type: 'Алтарь', roomType: ROOM_TYPES.CURSE_ALTAR } }}
    onUpdatePlayer={onUpdatePlayer} onEnterDungeon={jest.fn()} onReturnToGuild={jest.fn()} />
  </UIProvider>);
  expect(screen.getByRole('button', { name: 'Осквернение · I' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Увядание · I' }));
  const saved = onUpdatePlayer.mock.calls.map(([value]) => value).find(value => value.currentPathEvent?.curseId === 'withering');
  expect(saved.currentPathEvent.curseIds).toEqual(offers.curseIds);
  fireEvent.click(screen.getByRole('button', { name: 'Принять проклятие' }));
  const granted = onUpdatePlayer.mock.calls.map(([value]) => value).filter(value => value.curses);
  expect(granted).toHaveLength(1);
  expect(granted[0].curses).toEqual({ withering: { tier: 1 } });
});

test('leaving a saved two-choice altar grants neither curse', () => {
  const onUpdatePlayer = jest.fn();
  render(<UIProvider><DungeonScreen player={{ ...player, abyssLevel: 1,
    currentPathEvent: { type: 'Алтарь', status: 'active', pathId: 'skip', curseId: 'decay', curseIds: ['decay', 'withering'] } }}
    onUpdatePlayer={onUpdatePlayer} onEnterDungeon={jest.fn()} onReturnToGuild={jest.fn()} />
  </UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Уйти' }));
  expect(onUpdatePlayer.mock.calls.some(([value]) => value.curses)).toBe(false);
});

