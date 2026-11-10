import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getActiveExpeditionLayout } from '../utils/expeditionMapRun';
import { applyMapProgressLocks, getKnownMapTravelPaths } from '../utils/expeditionMapLayout';
import { ROOM_TYPES } from '../utils/roomGeneration';
import { getSublocationDefinition } from '../data/expeditionSublocations';
import { LOCATION_EFFECTS } from '../data/locationEffects';
import {
  formatActiveCurseText,
  getActiveCursesList,
  getCurseDefinition,
} from '../data/curses';
import DungeonRunHud from './DungeonRunHud';
import DungeonInventoryModal from './DungeonInventoryModal';
import FieldCraftingModal from './FieldCraftingModal';
import {
  getExpeditionBoardGeometry, getExpeditionCellPosition, projectExpeditionCell,
} from '../utils/expeditionMapProjection';
import './ExpeditionMapScreen.css';

const ROOM_PRESENTATION = Object.freeze({
  [ROOM_TYPES.COMBAT]: { icon: '†', label: 'БОЙ' },
  [ROOM_TYPES.TREASURE]: { icon: '◆', label: 'СОКРОВИЩЕ' },
  [ROOM_TYPES.SECRET]: { icon: '?', label: 'ТАЙНА' },
  [ROOM_TYPES.RESOURCE]: { icon: '⛏', label: 'РЕСУРСЫ' },
  [ROOM_TYPES.FISHING]: { icon: '≈', label: 'РЫБАЛКА' },
  [ROOM_TYPES.CURSE_ALTAR]: { icon: '✦', label: 'АЛТАРЬ' },
  [ROOM_TYPES.CURSED_ENEMY]: { icon: '☠', label: 'ПРОКЛЯТЫЙ' },
  [ROOM_TYPES.BOSS]: { icon: '♛', label: 'БОСС' },
});

const hasKey = (run, keyType) => Boolean(
  run?.state?.keys?.[keyType]?.owned && !run?.state?.keys?.[keyType]?.consumed
);

const getObjective = run => {
  if (Number(run?.state?.version) < 2) {
    return 'Эта экспедиция использует старую схему. Вернитесь в Гильдию и начните новый поход.';
  }
  if (run.state?.progress?.bossUnlocked) return 'Путь к боссу открыт.';
  if (run.state?.progress?.depthUnlocked) {
    return hasKey(run, 'boss')
      ? 'Ключ босса найден. Доберитесь до арены.'
      : 'Исследуйте Глубину и добудьте Ключ босса в бою.';
  }
  if (run.state?.selectedSublocationId) {
    return hasKey(run, 'depth')
      ? 'Ключ Глубины найден. Доберитесь до выхода выбранной подлокации.'
      : 'Исследуйте подлокацию и добудьте Ключ Глубины в бою.';
  }
  return hasKey(run, 'sublocation')
    ? 'Ключ подлокации найден. Выберите один из трёх входов.'
    : 'Исследуйте Подход и добудьте Ключ подлокации в бою.';
};

const getAccessStatus = run => {
  if (Number(run?.state?.version) < 2) return 'Старая карта';
  if (run.state?.progress?.depthUnlocked) return hasKey(run, 'boss') ? 'Ключ босса найден' : 'Ищем ключ босса';
  if (run.state?.selectedSublocationId) return hasKey(run, 'depth') ? 'Ключ Глубины найден' : 'Ищем ключ Глубины';
  return hasKey(run, 'sublocation') ? 'Ключ подлокации найден' : 'Ищем ключ подлокации';
};

const KEY_NOTICE_PRESENTATION = Object.freeze({
  sublocation: Object.freeze({
    title: 'Ключ подлокации найден',
    description: 'Теперь можно выбрать одну из трёх подлокаций.',
  }),
  depth: Object.freeze({
    title: 'Ключ Глубины найден',
    description: 'Теперь можно открыть переход из выбранной подлокации в Глубину.',
  }),
  boss: Object.freeze({
    title: 'Ключ босса найден',
    description: 'Теперь можно открыть путь на арену босса.',
  }),
});

const getTilePresentation = ({ cell, run }) => {
  const landmark = cell.landmark?.type;
  if (!cell.revealed && landmark !== 'boss') return { icon: '', label: '' };

  const completedOrdinary = cell.visited && cell.resolved && !landmark;
  if (completedOrdinary) return { icon: '', label: '' };

  if (landmark === 'sublocation-entrance') {
    const chosen = run.state?.selectedSublocationId;
    const isOther = chosen && chosen !== cell.landmark?.sublocationId;
    return { icon: '▽', label: isOther ? 'ЗАКРЫТО' : 'ВХОД' };
  }
  if (landmark === 'sublocation-exit') return { icon: '⇧', label: 'ВЫХОД' };
  if (landmark === 'depth-entrance') return { icon: '⬆', label: 'ГЛУБИНА' };
  if (landmark === 'depth-completion' && cell.resolved) return { icon: '', label: '' };
  if (landmark === 'boss') {
    return cell.revealed || run.state?.progress?.bossUnlocked
      ? ROOM_PRESENTATION[ROOM_TYPES.BOSS]
      : { icon: '', label: '' };
  }
  if (cell.previewRoomType) {
    return ROOM_PRESENTATION[cell.previewRoomType] || { icon: '•', label: 'СОБЫТИЕ' };
  }
  if (cell.significant && cell.revealed) return { icon: '•', label: 'СОБЫТИЕ' };
  return { icon: '', label: '' };
};

const ExpeditionMapScreen = ({
  run,
  player,
  autobattleUnlocked = false,
  onAutobattleChange,
  onMove,
  onResolveContent,
  onReturnToGuild,
  onUpdatePlayer,
  onQuestEvent,
  onDismissKeyNotice,
}) => {
  const viewportRef = useRef(null);
  const [mapZoom, setMapZoom] = useState(1);
  const initialViewportPositionedRef = useRef(false);
  const lastCenteredCellIdRef = useRef(null);
  const [pendingSublocationEntry, setPendingSublocationEntry] = useState(null);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showFieldCrafting, setShowFieldCrafting] = useState(false);
  const layout = getActiveExpeditionLayout(run);
  // One BFS for the whole board: visible destinations are clickable if a
  // safe route exists, not only when they are directly adjacent to the hero.
  const availablePaths = useMemo(
    () => getKnownMapTravelPaths(layout ? applyMapProgressLocks(layout, run.state) : null),
    [layout, run.state]
  );

  const projected = useMemo(
    () => (layout?.cells || []).map(cell => ({
      ...cell,
      ...projectExpeditionCell(cell, layout?.topology),
    })),
    [layout]
  );

  const runEffects = useMemo(() => {
    const effects = [];
    const locationName = player?.currentLocation || run?.state?.locationId || null;
    const locationEffect = LOCATION_EFFECTS[locationName];
    if (locationEffect) {
      effects.push({
        ...locationEffect,
        kind: 'location',
        symbol: 'Л',
      });
    }

    const selectedSublocation = getSublocationDefinition(
      locationName,
      run?.state?.selectedSublocationId
    );
    if (selectedSublocation) {
      effects.push({
        id: `sublocation-${selectedSublocation.id}`,
        name: selectedSublocation.name,
        description: selectedSublocation.effectSummary,
        kind: 'sublocation',
        symbol: 'П',
      });
    }

    getActiveCursesList(player?.curses).forEach(curse => {
      const definition = getCurseDefinition(curse.id);
      effects.push({
        id: `curse-${curse.id}`,
        name: `${curse.name} (${['—', 'I', 'II', 'III', 'IV', 'V'][curse.tier]})${player?.dominantCurseId === curse.id ? ' — Главное Проклятие' : ''}`,
        description: formatActiveCurseText(definition, curse.tier),
        kind: 'curse',
        symbol: definition?.presentation?.symbol,
        accent: definition?.presentation?.accent,
        dominant: player?.dominantCurseId === curse.id,
      });
    });
    return effects;
  }, [player?.curses, player?.currentLocation, player?.dominantCurseId, run?.state?.locationId, run?.state?.selectedSublocationId]);

  const geometry = useMemo(() => getExpeditionBoardGeometry(projected), [projected]);

  useEffect(() => {
    if (!run.pendingCellId || !onResolveContent) return;
    onResolveContent();
  }, [run.pendingCellId, onResolveContent]);

  const centerViewportOnCurrentCell = useCallback(behavior => {
    const viewport = viewportRef.current;
    const node = viewport?.querySelector('[data-current="true"]');
    if (!viewport || !node) return false;
    // Map cell buttons use a centered transform, irrespective of location.
    const left = node.offsetLeft * mapZoom - viewport.clientWidth / 2;
    const top = node.offsetTop * mapZoom - viewport.clientHeight * 0.58;
    viewport.scrollTo({
      left: Math.max(0, left),
      top: Math.max(0, top),
      behavior,
    });
    return true;
  }, [mapZoom]);

  useLayoutEffect(() => {
    if (initialViewportPositionedRef.current) return;
    if (!centerViewportOnCurrentCell('auto')) return;
    initialViewportPositionedRef.current = true;
    lastCenteredCellIdRef.current = layout?.currentCellId || null;
  }, [layout?.currentCellId, projected.length, centerViewportOnCurrentCell]);

  useEffect(() => {
    if (!initialViewportPositionedRef.current) return undefined;
    if (!layout?.currentCellId || lastCenteredCellIdRef.current === layout.currentCellId) {
      return undefined;
    }
    lastCenteredCellIdRef.current = layout.currentCellId;
    const frame = requestAnimationFrame(() => {
      centerViewportOnCurrentCell('smooth');
    });
    return () => cancelAnimationFrame(frame);
  }, [layout?.currentCellId, projected.length, centerViewportOnCurrentCell]);

  useLayoutEffect(() => { centerViewportOnCurrentCell('auto'); }, [mapZoom, centerViewportOnCurrentCell]);

  if (!layout) return null;

  const pendingDefinition = pendingSublocationEntry
    ? getSublocationDefinition(
        run?.state?.locationId,
        pendingSublocationEntry.landmark?.sublocationId
      )
    : null;
  const canSpendSublocationKey = hasKey(run, 'sublocation');

  const handleCellClick = cell => {
    if (
      cell?.landmark?.type === 'sublocation-entrance'
      && !run.state?.selectedSublocationId
    ) {
      setPendingSublocationEntry(cell);
      return;
    }
    onMove(cell.id);
  };

  const confirmSublocationEntry = () => {
    if (!pendingSublocationEntry || !canSpendSublocationKey) return;
    const id = pendingSublocationEntry.id;
    setPendingSublocationEntry(null);
    onMove(id);
  };

  return <main className="expedition-map-screen">
    <div className="expedition-map-viewport" ref={viewportRef} aria-label="Карта экспедиции">
      <div className="expedition-map-scroll-surface" style={{
        width: geometry.width * mapZoom,
        height: geometry.height * mapZoom,
      }}>
      <div
        className="expedition-map-board"
        style={{ width: geometry.width, height: geometry.height, transform: `scale(${mapZoom})`, transformOrigin: '0 0' }}
      >
        {projected.map(cell => {
          if (cell.walkable === false) {
            const { x: left, y: top } = getExpeditionCellPosition(cell, geometry);
            return <div key={cell.id} className={`expedition-terrain ${cell.revealed ? 'revealed' : 'unrevealed'}`}
              data-terrain-id={cell.id} style={{ left, top }} role="img"
              aria-label={cell.revealed ? 'Непроходимая территория' : 'Не разведано'} />;
          }
          const isCurrent = cell.id === layout.currentCellId;
          const available = !isCurrent
            && availablePaths.has(cell.id)
            && !cell.locked
            && !run.pendingCellId
            && Number(run?.state?.version) >= 2;
          const presentation = getTilePresentation({ cell, run });
          const completed = Boolean(cell.visited && cell.resolved);
          const className = [
            'expedition-tile',
            'region-' + (cell.region || cell.phase || 'unknown'),
            cell.phase,
            cell.revealed ? 'revealed' : 'unrevealed',
            cell.visited ? 'visited' : '',
            completed ? 'resolved' : '',
            cell.locked ? 'locked' : '',
            available ? 'available' : '',
            isCurrent ? 'current' : '',
            cell.landmark ? 'landmark' : '',
            cell.landmark?.type ? 'landmark-' + cell.landmark.type : '',
          ].filter(Boolean).join(' ');

          const { x: left, y: top } = getExpeditionCellPosition(cell, geometry);
          const ariaLabel = [
            isCurrent ? 'Вы здесь' : null,
            presentation.label || (cell.revealed ? 'Проход' : null),
            cell.locked ? 'недоступно' : null,
            available ? 'можно перейти' : null,
            completed ? 'завершено' : null,
            !cell.revealed ? 'не разведано' : null,
          ].filter(Boolean).join(', ');

          return <button
            key={cell.id}
            type="button"
            className={className}
            data-current={isCurrent}
            data-cell-id={cell.id}
            disabled={!available}
            onClick={() => handleCellClick(cell)}
            style={{ left, top }}
            aria-label={ariaLabel}
          >
            <span className="expedition-tile-shape" aria-hidden="true" />
            <span className="expedition-tile-content" aria-hidden="true">
              {presentation.icon && <span className="expedition-tile-icon">{presentation.icon}</span>}
              {presentation.label && <span className="expedition-tile-label">{presentation.label}</span>}
            </span>
            {isCurrent && <span className="expedition-tile-badge expedition-tile-badge--current">ВЫ</span>}
            {cell.locked && cell.revealed && <span className="expedition-tile-badge expedition-tile-badge--locked">×</span>}
          </button>;
        })}
      </div>
      </div>
    </div>

    <div className="expedition-map-camera-controls" aria-label="Масштаб карты">
      <button type="button" aria-label="Отдалить карту" disabled={mapZoom <= 0.4}
        onClick={() => setMapZoom(z => Math.max(0.4, Math.round((z - 0.2) * 10) / 10))}>−</button>
      <output>{Math.round(mapZoom * 100)}%</output>
      <button type="button" aria-label="Приблизить карту" disabled={mapZoom >= 1.6}
        onClick={() => setMapZoom(z => Math.min(1.6, Math.round((z + 0.2) * 10) / 10))}>+</button>
      <button type="button" aria-label="Вернуться к герою" onClick={() => centerViewportOnCurrentCell('smooth')}>◎</button>
    </div>
    <div className="expedition-map-chrome">
      <header className="expedition-map-header">
        <div className="expedition-map-heading">
          <strong>{player?.currentLocation || run?.state?.locationId || 'Экспедиция'}</strong>
          <small>{`Гекс-карта · ${layout.templateId || 'старая схема'}`}</small>
        </div>
        <span className="expedition-map-access">{getAccessStatus(run)}</span>
      </header>

      <section className="expedition-map-objective" aria-live="polite">
        <strong>Цель</strong>
        <span>{getObjective(run)}</span>
      </section>

      <div className="expedition-map-keys" aria-label="Ключи экспедиции">
        <span className={hasKey(run, 'sublocation') ? 'owned' : ''}>◆ Подлокация</span>
        <span className={hasKey(run, 'depth') ? 'owned' : ''}>◆ Глубина</span>
        <span className={hasKey(run, 'boss') ? 'owned' : ''}>◆ Босс</span>
      </div>
    </div>

    <div className="expedition-map-controls">
      <DungeonRunHud
        effects={runEffects}
        onOpenInventory={() => setShowInventoryModal(true)}
        onOpenCrafting={() => setShowFieldCrafting(true)}
        utilitiesDisabled={showInventoryModal || showFieldCrafting || Boolean(pendingSublocationEntry)}
      />
      <button
        type="button"
        className={`expedition-map-autobattle${autobattleUnlocked && player?.autobattleEnabled ? ' is-enabled' : ''}`}
        disabled={!autobattleUnlocked || showInventoryModal || showFieldCrafting || Boolean(pendingSublocationEntry)}
        aria-pressed={autobattleUnlocked && Boolean(player?.autobattleEnabled)}
        aria-label={autobattleUnlocked
          ? `Автобой: ${player?.autobattleEnabled ? 'включён' : 'выключен'}`
          : 'Автобой заблокирован: победите босса этой локации'}
        title={autobattleUnlocked ? 'Автоматическое проведение следующих боёв' : 'Победите босса этой локации, чтобы открыть автобой'}
        onClick={() => onAutobattleChange?.(!player?.autobattleEnabled)}
      >
        <span aria-hidden="true">{autobattleUnlocked ? '⚔' : '🔒'}</span>
        <span>{autobattleUnlocked ? `Автобой: ${player?.autobattleEnabled ? 'ВКЛ' : 'ВЫКЛ'}` : 'Автобой'}</span>
      </button>
    </div>

    <button className="expedition-map-exit" onClick={onReturnToGuild}>
      Гильдия
    </button>

    {run.keyNotice && KEY_NOTICE_PRESENTATION[run.keyNotice.keyType] && (
      <div className="expedition-key-notice-overlay" role="presentation">
        <section
          className="expedition-key-notice-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="expedition-key-notice-title"
        >
          <div className="expedition-key-notice-icon" aria-hidden="true">◆</div>
          <small>НАГРАДА ЗА БОЙ</small>
          <h3 id="expedition-key-notice-title">
            {KEY_NOTICE_PRESENTATION[run.keyNotice.keyType].title}
          </h3>
          <p>{KEY_NOTICE_PRESENTATION[run.keyNotice.keyType].description}</p>
          <button type="button" onClick={onDismissKeyNotice}>Продолжить</button>
        </section>
      </div>
    )}

    {showInventoryModal && player && (
      <DungeonInventoryModal
        player={player}
        onClose={() => setShowInventoryModal(false)}
        onUpdatePlayer={onUpdatePlayer}
      />
    )}

    {showFieldCrafting && player && (
      <FieldCraftingModal
        player={player}
        onClose={() => setShowFieldCrafting(false)}
        onUpdatePlayer={onUpdatePlayer}
        onQuestEvent={onQuestEvent}
      />
    )}

    {pendingSublocationEntry && (
      <div className="expedition-sublocation-overlay" role="presentation">
        <section className="expedition-sublocation-dialog" role="dialog" aria-modal="true" aria-labelledby="sublocation-entry-title">
          <small>Подлокация</small>
          <h3 id="sublocation-entry-title">{pendingDefinition?.name || 'Неизвестная подлокация'}</h3>
          <p>{pendingDefinition?.effectSummary || 'Особое правило этой подлокации ещё не определено.'}</p>
          <p className="expedition-sublocation-warning">
            Боевые клетки внутри подлокации содержат только Strong-встречи или Проклятых врагов.
          </p>
          <div className="expedition-sublocation-keyline">
            {canSpendSublocationKey ? '◆ Ключ подлокации готов' : '◇ Нужен Ключ подлокации'}
          </div>
          <div className="expedition-sublocation-actions">
            <button type="button" onClick={() => setPendingSublocationEntry(null)}>Отойти</button>
            <button
              type="button"
              className="primary"
              disabled={!canSpendSublocationKey}
              onClick={confirmSublocationEntry}
            >
              Использовать ключ
            </button>
          </div>
        </section>
      </div>
    )}
  </main>;
};

export default ExpeditionMapScreen;

