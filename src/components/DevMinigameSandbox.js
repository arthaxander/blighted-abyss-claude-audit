import React, { useMemo } from 'react';
import { createFishingChallenge } from '../data/fishing';
import FishingRoomModal from './FishingRoomModal';
import LockpickMinigame from './LockpickMinigame';
import TrapDisarmModal from './TrapDisarmModal';
import './DevMinigameSandbox.css';

export const DEV_TRAP_CHALLENGE = Object.freeze({
  metalReward: 'Металлические обломки',
  metalQuantity: 2,
});

export const createDevMinigameRegistry = ({ fishingChallenge, close }) => Object.freeze({
  lockpick: {
    label: 'Взлом сокровищницы',
    render: () => <LockpickMinigame onSuccess={close} onFail={close} />,
  },
  fishing: {
    label: 'Рыбалка',
    render: () => <FishingRoomModal challenge={fishingChallenge} onSuccess={close} onFail={close} onClose={close} />,
  },
  trap: {
    label: 'Обезвреживание ловушки',
    render: () => <TrapDisarmModal challenge={DEV_TRAP_CHALLENGE} onResolve={close} onCancel={close} />,
  },
});

const DevMinigameSandbox = ({ activeId, player, onClose }) => {
  const fishingChallenge = useMemo(() => activeId === 'fishing'
    ? createFishingChallenge('Гоблинские Норы', player?.fishingSetup || {}) : null,
    [activeId, player?.fishingSetup]);
  const registry = createDevMinigameRegistry({
    fishingChallenge,
    close: onClose,
  });
  const definition = registry[activeId];
  if (!definition) return null;

  return <div className="dev-minigame-sandbox" data-testid="dev-minigame-sandbox" data-minigame={activeId}>
    {definition.render()}
    <button type="button" className="dev-minigame-sandbox__exit" aria-label="Выйти из тестовой мини-игры" onClick={onClose}>×</button>
  </div>;
};

export default DevMinigameSandbox;
