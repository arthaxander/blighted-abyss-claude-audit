import React, { useEffect, useMemo, useState } from 'react';
import { getRelicById, RELIC_XP_PER_LEVEL } from '../data/relics';
import './RelicResonanceTransfer.css';
export const RELIC_RESONANCE_TRANSFER_DURATION = 1500;
const interpolateProgress = (start, end, t) => Math.round(start + (end - start) * t);
const RelicResonanceTransfer = ({ transfer, iconUrl = null, onComplete }) => {
  const [ratio, setRatio] = useState(0); const [done, setDone] = useState(false);
  const relic = getRelicById(transfer.relicId);
  const startTotal = transfer.oldProgress.level * RELIC_XP_PER_LEVEL + transfer.oldProgress.xp;
  const endTotal = transfer.newProgress.level * RELIC_XP_PER_LEVEL + transfer.newProgress.xp;
  useEffect(() => { let frame; const start = performance.now(); const tick = now => { const next = Math.min(1, (now - start) / RELIC_RESONANCE_TRANSFER_DURATION); setRatio(next); if (next < 1) frame = requestAnimationFrame(tick); else setDone(true); }; frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame); }, []);
  const total = interpolateProgress(startTotal, endTotal, ratio); const level = Math.min(10, Math.floor(total / RELIC_XP_PER_LEVEL)); const xp = level >= 10 ? 0 : total % RELIC_XP_PER_LEVEL;
  const remaining = Math.max(0, Math.round(transfer.amount * (1 - ratio)));
  const icon = useMemo(() => iconUrl ? <img src={iconUrl} alt="" /> : <span aria-label="Реликвия">◆</span>, [iconUrl]);
  return <main className="relic-resonance-transfer" aria-label="Перенос Резонанса Бездны"><section className="relic-resonance-transfer__card"><div className="relic-resonance-transfer__icon">{icon}</div><h2>{relic?.name || 'Реликвия'}</h2><p>Уровень {level}</p><progress aria-label="Прогресс реликвии" max={RELIC_XP_PER_LEVEL} value={level >= 10 ? RELIC_XP_PER_LEVEL : xp} /><p className="relic-resonance-transfer__label">Резонанс Бездны</p><strong className="relic-resonance-transfer__counter">{remaining}</strong><button type="button" disabled={!done} onClick={onComplete}>Продолжить</button></section></main>;
};
export default RelicResonanceTransfer;
