import React, { useEffect, useRef, useState } from 'react';
import { TRAP_SECTORS, TRAP_REVOLUTION_MS, hitTrapSector } from '../minigames/trapConfig';
import TrapMechanism from './TrapMechanism';
import './TrapDisarmModal.css';

const haptic = success => {
  try {
    const api = window.Telegram?.WebApp?.HapticFeedback;
    if (success === false) api?.notificationOccurred?.('error');
    else api?.impactOccurred?.('light');
  } catch (_) { /* Unsupported feedback must not interrupt the minigame. */ }
};

const TrapDisarmModal = ({ challenge, onResolve, onCancel }) => {
  const [phase, setPhase] = useState('ready');
  const phaseRef = useRef('ready');
  const [angle, setAngle] = useState(0);
  const angleRef = useRef(0);
  const [marked, setMarked] = useState([]);
  const markedRef = useRef([]);
  const [failedSector, setFailedSector] = useState(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const lastFrame = useRef(null);
  const resolved = useRef(false);

  useEffect(() => {
    const pause = () => {
      if (phaseRef.current !== 'playing') return;
      pausedRef.current = true;
      setPaused(true);
      lastFrame.current = null;
    };
    const visibility = () => { if (document.hidden) pause(); };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'playing') return undefined;
    let frame;
    const tick = timestamp => {
      if (phaseRef.current !== 'playing') return;
      if (pausedRef.current || document.hidden) lastFrame.current = null;
      else {
        if (lastFrame.current !== null) {
          angleRef.current = (angleRef.current + (timestamp - lastFrame.current) * 360 / TRAP_REVOLUTION_MS) % 360;
          setAngle(angleRef.current);
        }
        lastFrame.current = timestamp;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const start = () => {
    if (phaseRef.current !== 'ready') return;
    phaseRef.current = 'playing';
    lastFrame.current = null;
    setPhase('playing');
  };
  const hit = () => {
    if (phaseRef.current !== 'playing' || pausedRef.current || document.hidden) return;
    const next = hitTrapSector(markedRef.current, angleRef.current);
    markedRef.current = next.marked;
    setMarked(next.marked);
    haptic(next.result !== 'failure');
    if (next.result) {
      phaseRef.current = next.result;
      setPhase(next.result);
      if (next.result === 'failure') setFailedSector(next.sector);
    }
  };
  const resolve = () => {
    if (resolved.current || !['success', 'failure'].includes(phaseRef.current)) return;
    resolved.current = true;
    onResolve?.({ method: 'sectors', success: phaseRef.current === 'success' });
  };
  return <div className={`trap-disarm trap-disarm--${phase}`} role="dialog" aria-modal="true" aria-labelledby="trap-title">
    <div className="trap-disarm__window">
      <header className="trap-disarm__header"><span className="trap-disarm__eyebrow">ЛОВУШКА</span>
      <h2 id="trap-title">Обезвреживание</h2></header>
      <TrapMechanism angle={angle} marked={marked} failedSector={failedSector} />
      <div className="trap-disarm__controls">
      <p className="trap-disarm__progress" role="status">{phase === 'success' ? 'Ловушка обезврежена' : phase === 'failure' ? 'Ловушка сработала' : `Обезврежено: ${marked.length}/${TRAP_SECTORS.length}`}</p>      <p className="trap-disarm__hint">{phase === 'failure' ? 'Повторное попадание в сектор подняло тревогу. Враги приближаются.'
        : phase === 'success' ? `Материалы: ${challenge?.metalReward || 'Металлические обломки'} · ${challenge?.metalQuantity || '1–3'}`
          : phase === 'playing' ? <>Касайтесь в любом месте<span className="trap-disarm__subhint">Повтор — провал</span></> : 'Отметьте каждый сектор один раз. Касайтесь в любом месте. Повтор — провал.'}</p>
      {phase === 'ready' && <>
        <p className="trap-disarm__stakes">Провал: обычный бой, на одного врага меньше. Врагам +40% шкалы хода поверх эффектов локации.</p>
        <button className="trap-disarm__action" onClick={start}>Начать обезвреживание</button>
        {onCancel && <button className="trap-disarm__leave" onClick={onCancel}>Обойти ловушку</button>}
      </>}
      {phase === 'playing' && (paused
        ? <button className="trap-disarm__action" onClick={() => { pausedRef.current = false; lastFrame.current = null; setPaused(false); }}>Продолжить</button>
        : <button type="button" className="trap-disarm__tap-surface" aria-label="Зафиксировать сектор" onPointerDown={event => {
          if (event.isPrimary === false || (event.button != null && event.button !== 0)) return;
          event.preventDefault();
          hit();
        }} onClick={event => { if (event.detail === 0) hit(); }} onKeyDown={event => { if (event.repeat) event.preventDefault(); }} />)}
      {['success', 'failure'].includes(phase) && <button className="trap-disarm__action" onClick={resolve}>{phase === 'success' ? 'Забрать материалы' : 'К бою'}</button>}
      </div>
    </div>
  </div>;
};
export default TrapDisarmModal;
