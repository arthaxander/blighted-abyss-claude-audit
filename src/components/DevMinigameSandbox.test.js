import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import DevMinigameSandbox, { createDevMinigameRegistry, DEV_TRAP_CHALLENGE } from './DevMinigameSandbox';
import FishingRoomModal from './FishingRoomModal';
import LockpickMinigame from './LockpickMinigame';
import TrapDisarmModal from './TrapDisarmModal';

/* eslint-disable testing-library/render-result-naming-convention */

const player = Object.freeze({
  hp: 73,
  attack: 15,
  magAtk: 12,
  silver: 41,
  runInventory: Object.freeze([{ itemId: 'Простая ткань', quantity: 2 }]),
  equipment: Object.freeze({ weapon: 'Костяная удочка' }),
  questLog: Object.freeze({ quest: Object.freeze({ progress: 2 }) }),
  relics: Object.freeze({ activeRelicId: 'recruit_seal' }),
  fishingSetup: Object.freeze({ rod: 'Костяная удочка', bait: '' }),
});

test('sandbox supplies its own opaque isolated fullscreen backdrop', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/components/DevMinigameSandbox.css'), 'utf8');
  const wrapperRule = css.slice(css.indexOf('.dev-minigame-sandbox {'), css.indexOf('}', css.indexOf('.dev-minigame-sandbox {')) + 1);
  expect(wrapperRule).toContain('position: fixed');
  expect(wrapperRule).toContain('inset: 0');
  expect(wrapperRule).toContain('overflow: hidden');
  expect(wrapperRule).toContain('background: #071011');
  expect(wrapperRule).toContain('isolation: isolate');
  expect(wrapperRule).toContain('contain: paint');
});

test.each([
  ['lockpick', 'Взлом сокровищницы'],
  ['fishing', 'Рыбалка'],
  ['trap', 'Обезвреживание ловушки'],
])('sandbox mounts the production %s mini-game and universal exit returns to Guild', (id, accessibleName) => {
  const close = jest.fn();
  const { rerender } = render(<div><h1>Гильдия</h1><DevMinigameSandbox activeId={id} player={player} onClose={close} /></div>);
  expect(screen.getByTestId('dev-minigame-sandbox')).toHaveAttribute('data-minigame', id);
  const productionMinigame = id === 'lockpick'
    ? screen.getByLabelText('Взлом замка сокровищницы')
    : id === 'fishing' ? screen.getByLabelText(accessibleName) : screen.getByRole('heading', { name: accessibleName });
  expect(productionMinigame).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Выйти из тестовой мини-игры' }));
  expect(close).toHaveBeenCalledTimes(1);
  rerender(<div><h1>Гильдия</h1><DevMinigameSandbox activeId={null} player={player} onClose={close} /></div>);
  expect(screen.getByRole('heading', { name: 'Гильдия' })).toBeInTheDocument();
  expect(screen.queryByTestId('dev-minigame-sandbox')).not.toBeInTheDocument();
});

test('registry uses production components and every result callback only closes ephemeral UI', () => {
  const before = JSON.stringify(player);
  const close = jest.fn();
  const challenge = { location: 'Гоблинские Норы', fish: { name: 'Сумрачный пескарь', difficulty: 1 } };
  const registry = createDevMinigameRegistry({ fishingChallenge: challenge, playerStats: player, close });
  const lockpickElement = registry.lockpick.render();
  const fishingElement = registry.fishing.render();
  const trapElement = registry.trap.render();

  expect(lockpickElement.type).toBe(LockpickMinigame);
  expect(fishingElement.type).toBe(FishingRoomModal);
  expect(trapElement.type).toBe(TrapDisarmModal);
  expect(lockpickElement.props.config).toBeUndefined();
  expect(fishingElement.props.challenge).toBe(challenge);
  expect(trapElement.props.challenge).toBe(DEV_TRAP_CHALLENGE);

  lockpickElement.props.onSuccess();
  lockpickElement.props.onFail();
  fishingElement.props.onSuccess();
  fishingElement.props.onFail();
  fishingElement.props.onClose();
  ['tools', 'strength', 'magic', 'abandon'].forEach(method => trapElement.props.onResolve({ method, success: method !== 'abandon' }));
  trapElement.props.onCancel();

  expect(close).toHaveBeenCalledTimes(10);
  expect(JSON.stringify(player)).toBe(before);
  expect(lockpickElement.props).not.toHaveProperty('loot');
  expect(fishingElement.props).not.toHaveProperty('onUpdatePlayer');
  expect(trapElement.props).not.toHaveProperty('onUpdatePlayer');
  expect(trapElement.props).not.toHaveProperty('onUpdateRelics');
  expect(trapElement.props).not.toHaveProperty('onQuestEvent');
});
