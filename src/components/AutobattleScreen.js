import React, { useEffect, useRef, useState } from 'react';
import CombatScreen from './CombatScreen';
import ItemDetailsModal from './ItemDetailsModal';
import { sanitizeForCombatSnapshot } from '../utils/combatSnapshot';
import { AUTOBATTLE_VERSION, createAutobattleCheckpoint, calculateAutobattle, chooseAutobattleResult, getAutobattleConsumables } from '../utils/autobattle';
import './AutobattleScreen.css';

const failureCode = failure => String(failure?.code || (failure?.status ? `HTTP_${failure.status}` : failure?.message || 'UNKNOWN'))
  .toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 64);

export default function AutobattleScreen({ enabled, unlocked = false, onCheckpoint, ...combatProps }) {
  const [checkpoint, setCheckpoint] = useState(() => {
    const saved = combatProps.initialCombatSnapshot && sanitizeForCombatSnapshot(combatProps.initialCombatSnapshot);
    if (saved || !enabled || !unlocked) return saved || null;
    const seed = window.crypto?.getRandomValues
      ? window.crypto.getRandomValues(new Uint32Array(1))[0]
      : (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
    return createAutobattleCheckpoint(combatProps.player, combatProps.enemies, combatProps.isBoss, seed);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [calculationStage, setCalculationStage] = useState('');
  const [processedCommands, setProcessedCommands] = useState(0);
  const [inspectItem, setInspectItem] = useState(null);
  const checkpointRef = useRef(onCheckpoint);
  checkpointRef.current = onCheckpoint;
  const locked = useRef(false);
  const phase = checkpoint?.autobattle?.phase;
  const supported = !phase || checkpoint.autobattle.version === AUTOBATTLE_VERSION;

  useEffect(() => {
    if (phase !== 'running' || !supported) return undefined;
    let cancelled = false;
    let failed = false;
    setBusy(true);
    setError(null);
    const run = async () => {
      try {
        // Calculate while the initial checkpoint is in flight, but never reveal
        // or persist the outcome before the server acknowledges that checkpoint.
        setCalculationStage('Сохраняем начало боя…');
        const savingStart = Promise.resolve().then(() => checkpointRef.current(checkpoint));
        const calculating = (async () => {
          const { chooseCombatAction } = await import('../utils/combatSimulator');
          if (cancelled || failed) return null;
          setCalculationStage('Рассчитываем бой…');
          const result = await calculateAutobattle(checkpoint, chooseCombatAction, undefined, count => {
            if (!cancelled && !failed) setProcessedCommands(count);
          });
          if (!cancelled && !failed) setCalculationStage('Бой рассчитан. Сохраняем начало боя…');
          return result;
        })();
        const [, result] = await Promise.all([savingStart, calculating]);
        if (cancelled) return;
        setCalculationStage('Сохраняем результат…');
        await checkpointRef.current(result);
        if (!cancelled) setCheckpoint(result);
      } catch (failure) {
        failed = true;
        if (!cancelled) setError(`Не удалось завершить или сохранить автобой. Можно повторить расчёт с теми же условиями либо сыграть вручную. Код: ${failureCode(failure)}.`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [checkpoint, phase, retry, supported]);

  const choose = async choice => {
    if (locked.current || busy) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = chooseAutobattleResult(checkpoint, choice);
      await checkpointRef.current(next);
      setCheckpoint(next);
    } catch (failure) {
      setError(`Не удалось сохранить выбор. Попробуйте ещё раз. Код: ${failureCode(failure)}.`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  if (supported && (!phase || phase === 'manual' || phase === 'accepted')) {
    return <CombatScreen {...combatProps} onClearCombatSnapshot={phase ? undefined : combatProps.onClearCombatSnapshot} initialCombatSnapshot={checkpoint || combatProps.initialCombatSnapshot}
      onCombatSnapshot={snapshot => combatProps.onCombatSnapshot?.(phase ? { ...snapshot, autobattle: checkpoint.autobattle } : snapshot)} />;
  }
  const resultPlayer = checkpoint.autobattle.result?.state.players?.[0];
  const consumables = phase === 'review' ? getAutobattleConsumables(checkpoint) : [];
  const initialHp = Math.max(0, Math.round(checkpoint.state?.players?.[0]?.hp ?? 0));
  const finalHp = resultPlayer ? Math.max(0, Math.round(resultPlayer.hp)) : initialHp;
  const hpDelta = finalHp - initialHp;
  const hpChange = hpDelta > 0 ? `+${hpDelta}` : hpDelta < 0 ? `−${Math.abs(hpDelta)}` : '0';
  const runningMessage = `${calculationStage || 'Подготавливаем бой…'}${calculationStage === 'Рассчитываем бой…' && processedCommands ? ` Выполнено действий: ${processedCommands}` : ''}`;
  return (
    <section className="autobattle-screen" aria-labelledby="autobattle-title" aria-busy={busy}>
      <div className="autobattle-screen__card">
        <h2 id="autobattle-title">{phase === 'review' ? 'Результат автобоя' : 'Автобой'}</h2>
        {!supported ? <p role="alert">Эта встреча сохранена другой версией игры. Обновите игру, чтобы продолжить.</p> : <>
          {phase === 'review' ? <>
            <h3>{checkpoint.autobattle.outcome === 'victory' ? 'Победа' : 'Поражение'}</h3>
            <p>Здоровье: {finalHp} / {Math.round(resultPlayer.maxHp)} <span className="autobattle-screen__hp-delta" aria-label={`Изменение здоровья: ${hpChange}`}>({hpChange})</span></p>
            <p>Потраченные предметы:</p>
            {consumables.length ? <ul>{consumables.map(item => <li key={item.name}><button className="autobattle-screen__item-link" type="button" onClick={() => setInspectItem(item)}>{item.name}</button> × {item.count}</li>)}</ul> : <p>Не потрачены</p>}
            <p>Принять этот результат или сыграть бой вручную с исходным здоровьем и предметами?</p>
          </> : <p role="status">{busy ? runningMessage : 'Бой ожидает продолжения.'}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="autobattle-screen__actions">
            {phase === 'review' && <button type="button" disabled={busy} onClick={() => choose('accepted')}>Принять результат</button>}
            {(phase === 'review' || error) && <button type="button" disabled={busy} onClick={() => choose('manual')}>Сыграть вручную</button>}
            {phase === 'running' && error && <button type="button" disabled={busy} onClick={() => setRetry(value => value + 1)}>Повторить расчёт</button>}
          </div>
          <small>Встреча уже началась. Отступить нельзя. Результат ручного боя будет окончательным.</small>
        </>}
      </div>
      {inspectItem && <ItemDetailsModal item={{ itemId: inspectItem.name, quantity: inspectItem.count }} context={{ inspectOnly: true, inCombat: false }} onClose={() => setInspectItem(null)} />}
    </section>
  );
}

