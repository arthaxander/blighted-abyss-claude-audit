import React, { useMemo } from 'react';
import { getItemDefinition } from '../data/items';
import { ensureArenaProfile } from '../utils/playerState';
import { useToast } from '../contexts/UIContext';

const styles = {
  container: {
    padding: '20px',
    color: '#f5f5f5',
    background: '#0f0f13',
    minHeight: '100vh',
    fontFamily: 'serif',
  },
  card: {
    border: '1px solid #333',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    background: '#1b1b22',
  },
  button: {
    marginRight: 8,
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid #555',
    background: '#2d3d6a',
    color: '#fff',
    cursor: 'pointer',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  consumableList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  consumableChip: {
    border: '1px solid #555',
    borderRadius: 6,
    padding: '6px 10px',
    cursor: 'pointer',
  },
  chipActive: {
    background: '#2e864a',
    borderColor: '#43b465',
  },
};

const SnapshotCard = ({ title, snapshot }) => {
  if (!snapshot) {
    return (
      <div style={styles.card}>
        <strong>{title}</strong>
        <p>Фантом не зафиксирован.</p>
      </div>
    );
  }
  const abilityList = (snapshot.abilityNames || []).join(', ') || '—';
  return (
    <div style={styles.card}>
      <strong>{title}</strong>
      <p>{snapshot.name || 'Безымянный герой'} — {snapshot.class || 'класс не выбран'}</p>
      <p>HP: {snapshot.maxHp || snapshot.hp || 0}, Атака: {snapshot.attack || snapshot.baseAtk || 0}, Магия: {snapshot.magAtk || 0}</p>
      <p>Скорость: {snapshot.speed || snapshot.baseStats?.speed || 0}</p>
      <p>Способности: {abilityList}</p>
      {snapshot.savedAt && (
        <p style={{ opacity: 0.7 }}>Сохранено: {new Date(snapshot.savedAt).toLocaleString()}</p>
      )}
    </div>
  );
};

export const ArenaScreen = ({
  player,
  onSaveSnapshot,
  onUpdateConsumables,
  onStartBattle,
}) => {
  const arenaProfile = ensureArenaProfile(player?.arenaProfile);
  const { pushToast } = useToast();
  const consumableInventory = useMemo(() => {
    const counts = {};
    (player?.inventory || []).forEach(name => {
      const def = getItemDefinition(name);
      if (!def || def.type !== 'consumable') return;
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, quantity]) => ({
        name,
        quantity,
        definition: getItemDefinition(name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [player?.inventory]);

  const handleConsumableToggle = (name) => {
    let next = [...(arenaProfile.attackConsumables || [])];
    if (next.includes(name)) {
      next = next.filter(item => item !== name);
    } else {
      if (next.length >= 2) {
        pushToast('Для арены можно взять не более двух расходников', { tone: 'warning' });
        return;
      }
      next.push(name);
    }
    onUpdateConsumables && onUpdateConsumables(next);
  };

  const actionDisabled = !arenaProfile.attackSnapshot;
  const startDisabled = actionDisabled;

  return (
    <div style={styles.container}>
      <h2>Арена фантомов</h2>
      <div style={styles.card}>
        <p>Рейтинг: {arenaProfile.rating}</p>
        <p>
          Статистика: {arenaProfile.record.wins} побед / {arenaProfile.record.losses} поражений
        </p>
        {arenaProfile.lastArenaOpponent && (
          <p style={{ opacity: 0.8 }}>
            Последний соперник: {arenaProfile.lastArenaOpponent.name} (рейтинг {arenaProfile.lastArenaOpponent.rating})
          </p>
        )}
      </div>
      <div style={styles.card}>
        <h3>Фиксация фантомов</h3>
        <button
          style={styles.button}
          onClick={() => onSaveSnapshot && onSaveSnapshot('attack')}
        >
          Зафиксировать фантом атаки
        </button>
        <button
          style={styles.button}
          onClick={() => onSaveSnapshot && onSaveSnapshot('defense')}
        >
          Зафиксировать фантом защиты
        </button>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Фантомы сохраняют текущие характеристики, способности и экипировку персонажа на момент фиксации.
        </p>
      </div>
      <SnapshotCard title="Фантом атаки" snapshot={arenaProfile.attackSnapshot} />
      <SnapshotCard title="Фантом защиты" snapshot={arenaProfile.defenseSnapshot} />
      <div style={styles.card}>
        <h3>Расходники для арены</h3>
        <p>Выберите до двух предметов. В бою каждый даётся в двойном экземпляре и не тратится из инвентаря.</p>
        {consumableInventory.length === 0 ? (
          <p>В инвентаре нет подходящих расходников.</p>
        ) : (
          <div style={styles.consumableList}>
            {consumableInventory.map(item => {
              const isActive = arenaProfile.attackConsumables.includes(item.name);
              const chipStyle = isActive
                ? { ...styles.consumableChip, ...styles.chipActive }
                : styles.consumableChip;
              return (
                <div
                  key={item.name}
                  style={chipStyle}
                  onClick={() => handleConsumableToggle(item.name)}
                >
                  {item.name} {item.quantity > 1 ? `x${item.quantity}` : ''}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={styles.card}>
        <h3>Начать PvP-бой</h3>
        <p>Вы будете сражаться с фантомом другого героя под управлением ИИ.</p>
        <button
          style={startDisabled ? { ...styles.button, ...styles.buttonDisabled } : styles.button}
          disabled={startDisabled}
          onClick={() => onStartBattle && onStartBattle()}
        >
          Найти соперника
        </button>
        {startDisabled && <p style={{ opacity: 0.7 }}>Сначала зафиксируйте фантом атаки.</p>}
      </div>
    </div>
  );
};
