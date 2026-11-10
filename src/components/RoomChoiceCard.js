import React, { useState } from 'react';
import { COMBAT_ART_FALLBACKS, applyCombatArtFallback, resolveEnemyPortrait } from '../data/combatAssets';
import { ROOM_TYPES } from '../utils/roomGeneration';
import { TURN_METER_THRESHOLD } from '../utils/combatUtils';
import './RoomChoiceCard.css';

export const ROOM_CHOICE_VARIANTS = {
  [ROOM_TYPES.COMBAT]: 'combat',
  [ROOM_TYPES.TREASURE]: 'treasure',
  [ROOM_TYPES.SECRET]: 'secret',
  [ROOM_TYPES.RESOURCE]: 'resource',
  [ROOM_TYPES.FISHING]: 'fishing',
  [ROOM_TYPES.CURSE_ALTAR]: 'altar',
  [ROOM_TYPES.CURSED_ENEMY]: 'cursed',
  [ROOM_TYPES.BOSS]: 'boss',
};

const getRoomDescription = (room, bossName) => {
  switch (room.roomType) {
    case ROOM_TYPES.COMBAT:
      return null;
    case ROOM_TYPES.CURSED_ENEMY: {
      if (!Array.isArray(room.enemies)) return null;
      return `Проклятый враг: ${room.enemies.map(enemy => enemy.name).join(', ')}`;
    }
    case ROOM_TYPES.BOSS:
      return `Босс: ${room.enemies?.[0]?.name || bossName}`;
    case ROOM_TYPES.TREASURE:
      return 'Запертый сундук с добычей.';
    case ROOM_TYPES.SECRET:
      return 'Скрытая развилка. Содержимое неизвестно.';
    case ROOM_TYPES.RESOURCE:
      return null;
    case ROOM_TYPES.CURSE_ALTAR:
      return `Проклятие: ${room.curseName || 'Неизвестно'}`;
    case ROOM_TYPES.FISHING:
      return 'Тихая заводь для редкого улова.';
    default:
      if (room.type === 'Ловушка') return 'Успех: металл. Ошибка: засада.';
      return room.description || null;
  }
};

export const getAlertModifierInspection = modifier => {
  if (modifier?.type === 'ready') {
    const percent = Math.round((Number(modifier.turnMeter) || 0) / TURN_METER_THRESHOLD * 100);
    return `Враги начинают бой с +${percent}% шкалы хода.`;
  }
  if (modifier?.type === 'reinforcement') return 'К группе врагов присоединяется один дополнительный обычный Отступник.';
  return null;
};

export const groupVisibleRoomEnemies = room => {
  if (![ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY, ROOM_TYPES.BOSS].includes(room.roomType)) return [];
  return (room.enemies || []).reduce((groups, enemy) => {
    if (!enemy) return groups;
    const identity = enemy.id || enemy.portraitKey || enemy.portraitId;
    const existing = identity && groups.find(group => group.identity === identity);
    if (existing) existing.count += 1;
    else groups.push({ identity: identity || enemy, enemy, count: 1 });
    return groups;
  }, []);
};

const RoomChoiceCard = ({
  room,
  pathNumber,
  disabled = false,
  onSelect,
  onInspectEnemy,
  bossName = 'Босс',
  artworkUrl = null,
}) => {
  const [modifierOpen, setModifierOpen] = useState(false);
  const variant = ROOM_CHOICE_VARIANTS[room.roomType] || 'default';
  const title = room.roomType === ROOM_TYPES.RESOURCE ? 'Ресурсы' : room.type || 'Неизвестная комната';
  const description = getRoomDescription(room, bossName);
  const titleId = `room-choice-${room.id || pathNumber}-title`;
  const visibleEnemies = groupVisibleRoomEnemies(room)
    .map(group => ({ ...group, portrait: resolveEnemyPortrait(group.enemy) }))
    .filter(group => group.portrait);

  return (
    <div
      className={`room-choice-card room-choice-card--${variant}${artworkUrl ? ' room-choice-card--with-art' : ''}${disabled ? ' is-disabled' : ''}${visibleEnemies.length ? ' room-choice-card--has-enemies' : ''}`}
      style={artworkUrl ? { '--room-artwork': `url("${artworkUrl}")` } : undefined}
    >
      <button
        type="button"
        className="room-choice-card__select"
        disabled={disabled}
        onClick={() => onSelect(room)}
        aria-labelledby={titleId}
      >
        <span className="room-choice-card__accent" aria-hidden="true" />
        <span className="room-choice-card__content">
          <span id={titleId} className="room-choice-card__title">{title}</span>
          {description && <span className="room-choice-card__description">{description}</span>}
        </span>
        <span className="room-choice-card__arrow" aria-hidden="true">›</span>
      </button>
      {room.alertModifier ? <button type="button" className="room-choice-card__modifier" disabled={disabled} aria-expanded={modifierOpen} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setModifierOpen(open => !open); }}>[{room.alertModifier.name}]</button> : null}
      {modifierOpen ? <span className="room-choice-card__modifier-popover" role="dialog" aria-label={room.alertModifier.name}>{getAlertModifierInspection(room.alertModifier)}</span> : null}
      {visibleEnemies.length ? (
        <span className="room-choice-card__enemies">
          {visibleEnemies.map(({ identity, enemy, count, portrait }) => (
            <span className="room-choice-card__enemy" key={String(identity)}>
              <button
                type="button"
                className="room-choice-card__enemy-button"
                aria-label={`Посмотреть ${enemy.name}`}
                disabled={disabled}
                onClick={() => onInspectEnemy?.(enemy)}
              >
                <img
                  src={portrait}
                  alt=""
                  onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.enemy)}
                />
              </button>
              {count > 1 ? <span className="room-choice-card__enemy-count">×{count}</span> : null}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
};

export default RoomChoiceCard;

