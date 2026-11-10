import React, { useEffect, useRef, useState } from 'react';
import { getRelicById } from '../data/relics';
import { CLASS_PROGRESSION_DEFINITIONS } from '../data/classProgression';
import './ProgressionFeedback.css';

export const PROGRESSION_FEEDBACK_TIMING = Object.freeze({
  appear: 250,
  progress: 750,
  progressEnd: 1000,
  ordinaryHoldEnd: 1900,
  ordinaryLifetime: 2150,
  levelUpThreshold: 950,
  levelUpEmphasis: 400,
  levelUpOverflow: 1350,
  levelUpOverflowDuration: 400,
  levelUpProgressEnd: 1750,
  levelNumberPunch: 180,
  levelUpHoldEnd: 2550,
  levelUpLifetime: 2800,
});

const ProgressRow = ({ label, result, phase, relic = false }) => {
  const levelUp = !relic && result.levelsGained > 0;
  const emphasizing = levelUp && phase === 'level-up-emphasis';
  const overflowPhase = levelUp && (phase === 'overflow' || phase === 'settled' || phase === 'exiting');
  const level = emphasizing ? result.newLevel : levelUp && !overflowPhase ? result.oldLevel : result.newLevel ?? result.level;
  const required = overflowPhase || !levelUp ? result.newXpRequired ?? result.required : result.oldXpRequired;
  const oldValue = result.oldXpWithinLevel ?? result.oldValue ?? 0;
  const newValue = result.newXpWithinLevel ?? result.newValue ?? 0;
  const visualValue = phase === 'appearing' ? oldValue : levelUp && !overflowPhase ? required : newValue;
  const denominator = Math.max(1, required || 1);
  const percent = required ? Math.min(100, (visualValue / denominator) * 100) : 100;
  return <div className={`progression-feedback__row${levelUp ? ' is-level-up' : ''}${emphasizing ? ' is-level-up-emphasis' : ''}`} data-progression-kind={relic ? 'relic' : 'class'}>
    <div className="progression-feedback__identity"><strong>{label} · Ур. <span className={`progression-feedback__level-number${emphasizing ? ' is-prominent' : ''}`}>{level}</span></strong><b>+{result.xpGained ?? result.gained} опыта</b></div>
    <div className="progression-feedback__track" aria-label={`${label}: прогресс`}><span style={{ width: `${percent}%` }} /></div>
    <small>{required ? `${overflowPhase || !levelUp ? newValue : visualValue} / ${required}` : 'Макс. уровень'}</small>
  </div>;
};

const CLASS_STAT_LABELS = Object.freeze({
  maxHp: 'Макс. HP',
  attack: 'Атака',
  magAtk: 'Маг. атака',
  physDef: 'Физ. защита',
  magicDef: 'Маг. защита',
  speed: 'Скорость',
  critChance: 'Шанс крита',
  critDamage: 'Крит. урон',
  dodge: 'Уклонение',
});

const formatStatGain = (key, value) => {
  const percentStat = ['critChance', 'critDamage', 'dodge'].includes(key);
  const displayed = percentStat ? Math.round(value * 100) + ' п.п.' : value;
  return `${CLASS_STAT_LABELS[key] || key} +${displayed}`;
};

const ClassUnlocks = ({ result }) => {
  if (!result?.levelsGained) return null;
  const definition = CLASS_PROGRESSION_DEFINITIONS[result.classId || 'Defender'];
  const passiveName = passiveId => definition?.passiveSkills?.find(passive => passive.id === passiveId)?.name || passiveId;
  const statEntries = Object.entries(result.statGains || {});
  const entries = [
    ...(statEntries.length ? [{ key: 'stats', text: `Характеристики: ${statEntries.map(([key, value]) => formatStatGain(key, value)).join(', ')}` }] : []),
    ...(result.newlyAvailableSkills || []).map(name => ({ key: `skill-${name}`, text: `Новый навык: ${name}` })),
    ...(result.newlyAvailablePassives || []).map(id => ({ key: `passive-${id}`, text: `Новая пассивка: ${passiveName(id)}` })),
    ...(result.newlyUnlockedPassiveSlots || []).map(slot => ({ key: `slot-${slot}`, text: `Открыта пассивная ячейка ${slot}` })),
    ...(result.newlyAvailableTalents || []).map(name => ({ key: `talent-${name}`, text: `Доступен талант: ${name}` })),
  ];
  if (!entries.length) return null;
  return <div className="progression-feedback__unlocks" aria-label="Новые возможности">
    {entries.map(entry => <p key={entry.key} className="progression-feedback__unlock">{entry.text}</p>)}
  </div>;
};

const ProgressionFeedback = ({ event, onClose }) => {
  const [phase, setPhase] = useState('appearing');
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const meaningfulEvent = Boolean(event?.classResult || event?.relicXp > 0);
  const levelUp = Boolean(event?.classResult?.levelsGained > 0);
  useEffect(() => {
    if (!meaningfulEvent) return undefined;
    setPhase('appearing');
    const timers = [
      setTimeout(() => setPhase('animating'), PROGRESSION_FEEDBACK_TIMING.appear),
      ...(levelUp ? [
        setTimeout(() => setPhase('level-up-emphasis'), PROGRESSION_FEEDBACK_TIMING.levelUpThreshold),
        setTimeout(() => setPhase('overflow'), PROGRESSION_FEEDBACK_TIMING.levelUpOverflow),
      ] : []),
      setTimeout(() => setPhase('settled'), levelUp ? PROGRESSION_FEEDBACK_TIMING.levelUpProgressEnd : PROGRESSION_FEEDBACK_TIMING.progressEnd),
      setTimeout(() => setPhase('exiting'), levelUp ? PROGRESSION_FEEDBACK_TIMING.levelUpHoldEnd : PROGRESSION_FEEDBACK_TIMING.ordinaryHoldEnd),
      setTimeout(() => onCloseRef.current?.(), levelUp ? PROGRESSION_FEEDBACK_TIMING.levelUpLifetime : PROGRESSION_FEEDBACK_TIMING.ordinaryLifetime),
    ];
    const blockInput = inputEvent => {
      if (inputEvent.type === 'keydown' && !['Enter', ' '].includes(inputEvent.key)) return;
      inputEvent.preventDefault();
      inputEvent.stopPropagation();
    };
    document.addEventListener('click', blockInput, true);
    document.addEventListener('pointerdown', blockInput, true);
    document.addEventListener('keydown', blockInput, true);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('click', blockInput, true);
      document.removeEventListener('pointerdown', blockInput, true);
      document.removeEventListener('keydown', blockInput, true);
    };
  }, [event, levelUp, meaningfulEvent]);
  if (!meaningfulEvent) return null;
  const classResult = event.classResult;
  const relic = getRelicById(event.relicId);
  const relicResult = event.relicXp > 0 ? {
    level: event.relicLevel || 0, oldValue: event.relicOldXp || 0, newValue: event.relicNewXp || 0,
    required: event.relicRequired || 0, gained: event.relicXp,
  } : null;
  const timingStyles = {
    '--progression-progress-duration': `${PROGRESSION_FEEDBACK_TIMING.progress}ms`,
    '--progression-level-threshold-duration': `${PROGRESSION_FEEDBACK_TIMING.levelUpThreshold - PROGRESSION_FEEDBACK_TIMING.appear}ms`,
    '--progression-level-emphasis-duration': `${PROGRESSION_FEEDBACK_TIMING.levelUpEmphasis}ms`,
    '--progression-level-overflow-duration': `${PROGRESSION_FEEDBACK_TIMING.levelUpOverflowDuration}ms`,
    '--progression-level-punch-duration': `${PROGRESSION_FEEDBACK_TIMING.levelNumberPunch}ms`,
  };
  return <div className={`progression-feedback-layer is-${phase}`} role="status" aria-live="polite" data-phase={phase} style={timingStyles}>
    <section className="progression-feedback" aria-label="Получен опыт" data-anchor-vh="42.5">
      <h2>Получен опыт</h2>
      {classResult && <>
        <ProgressRow label={CLASS_PROGRESSION_DEFINITIONS[classResult.classId || 'Defender']?.name || 'Класс'} result={classResult} phase={phase} />
        <ClassUnlocks result={classResult} />
      </>}
      {relicResult && <ProgressRow label={relic?.name || 'Реликвия'} result={relicResult} phase={phase} relic />}
    </section>
  </div>;
};

export default ProgressionFeedback;
