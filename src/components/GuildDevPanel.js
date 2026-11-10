import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ITEM_DATA } from '../data/items';
import { DEVELOPER_PLAYABLE_CLASSES } from '../utils/developerClassSwitch';
import { exportWideCavernTemplatePng } from '../utils/expeditionMapExport';
import './GuildDevPanel.css';

const EMPTY_AUDIO_SNAPSHOT = Object.freeze({});

const AudioDiagnostics = ({ controller }) => {
  const snapshot = useSyncExternalStore(
    controller?.subscribeDebug || (() => () => {}),
    controller?.getDebugSnapshot || (() => EMPTY_AUDIO_SNAPSHOT),
  );
  const fields = [
    ['src', snapshot.src], ['inGuildScope', snapshot.inGuildScope], ['paused', snapshot.paused],
    ['muted', snapshot.muted], ['volume', snapshot.volume], ['currentTime', snapshot.currentTime],
    ['duration', snapshot.duration], ['readyState', snapshot.readyState], ['networkState', snapshot.networkState],
    ['audio.error?.code', snapshot.errorCode], ['gestureArmed', snapshot.gestureArmed],
    ['gestureAttemptPending', snapshot.gestureAttemptPending], ['hasConfirmedPlaying', snapshot.hasConfirmedPlaying],
    ['fadeActive', snapshot.fadeActive], ['fadeTarget', snapshot.fadeTarget],
    ['fadeStartVolume', snapshot.fadeStartVolume], ['lastFadeError', snapshot.lastFadeError],
    ['last media event', snapshot.lastMediaEvent], ['last play() rejection name', snapshot.playRejectionName],
    ['last play() rejection message', snapshot.playRejectionMessage],
  ];
  return <section className="guild-dev-audio" aria-label="Audio diagnostics">
    <h3>Audio</h3>
    <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value ?? '—')}</dd></div>)}</dl>
    <button type="button" onClick={() => controller?.testGuildMusic()}>Test Guild Music</button>
    <button type="button" onClick={() => controller?.stopMusic()}>Stop Music</button>
  </section>;
};

const DEV_MINIGAMES = Object.freeze([
  { id: 'lockpick', label: 'Взлом сокровищницы' },
  { id: 'fishing', label: 'Рыбалка' },
  { id: 'trap', label: 'Обезвреживание ловушки' },
]);

const GuildDevPanel = ({ musicController, onAddItem, onGrantAllRelics, onReset, onChangeClass, onCustomCombat, onOpenMinigame, currentClass, expeditionMapEnabled, onToggleExpeditionMap }) => {
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(ITEM_DATA[0]?.name || '');
  const [mapExportStatus, setMapExportStatus] = useState('');
  const triggerRef = useRef(null);
  const closeRef = useRef(null);

  const close = () => setOpen(false);
  const handleMapExport = async mode => {
    setMapExportStatus('Готовлю PNG…');
    const result = await exportWideCavernTemplatePng({ mode });
    setMapExportStatus(
      result.success
        ? `Сохранено: ${result.filename} (${result.width}×${result.height})`
        : `Ошибка экспорта: ${result.reason || 'неизвестная ошибка'}`
    );
  };
  const closeThenRun = callback => {
    // The next top-level UI must never open underneath this modal.
    flushSync(close);
    callback();
  };

  useEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef.current;
    closeRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  const modal = open ? createPortal(
    <div className="guild-dev-overlay" onClick={event => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="guild-dev-dialog" role="dialog" aria-modal="true" aria-labelledby="guild-dev-title">
        <header className="guild-dev-dialog__header">
          <h2 id="guild-dev-title">DEV</h2>
          <button ref={closeRef} type="button" className="guild-dev-dialog__close" aria-label="Закрыть DEV" onClick={close}>×</button>
        </header>
        <div className="guild-dev-dialog__content">
          <label>Добавить предмет
            <select aria-label="Предмет" value={itemId} onChange={event => setItemId(event.target.value)}>
              {ITEM_DATA.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => onAddItem(itemId)}>Добавить предмет</button>
          <button type="button" onClick={onGrantAllRelics}>Открыть все реликвии</button>
          <h3>Сменить класс</h3>
          {DEVELOPER_PLAYABLE_CLASSES.map(entry => <button type="button" key={entry.id} disabled={entry.id === currentClass} onClick={() => onChangeClass(entry.id)}>{entry.label}</button>)}
          <button type="button" onClick={() => closeThenRun(onCustomCombat)}>Кастомный бой</button>
          <h3>Мини-игры</h3>
          <small>Тестовый запуск — без наград</small>
          {DEV_MINIGAMES.map(minigame => <button type="button" key={minigame.id}
            onClick={() => closeThenRun(() => onOpenMinigame?.(minigame.id))}>{minigame.label}</button>)}
          <h3>Карта экспедиции</h3>
          <small>Локальный DEV-переключатель. Применится к следующему походу.</small>
          <button type="button" onClick={onToggleExpeditionMap}>
            Expedition Map: {expeditionMapEnabled ? 'ВКЛ' : 'ВЫКЛ'}
          </button>
          <h3>Экспорт wide-cavern-01</h3>
          <small>Точная схема из production-layout. PNG генерируется локально в браузере, без запросов к Amvera.</small>
          <button type="button" onClick={() => handleMapExport('schematic')}>PNG ×4 — клетки</button>
          <button type="button" onClick={() => handleMapExport('regions')}>PNG ×4 — регионы</button>
          {mapExportStatus && <small role="status">{mapExportStatus}</small>}
          <AudioDiagnostics controller={musicController} />
          <button type="button" onClick={() => closeThenRun(onReset)}>Сбросить весь прогресс</button>
          <button type="button" onClick={close}>Закрыть</button>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>
    <button ref={triggerRef} type="button" className="guild-dev-entry" onClick={() => setOpen(true)}>DEV</button>
    {modal}
  </>;
};

export default GuildDevPanel;
