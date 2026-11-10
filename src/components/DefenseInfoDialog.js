import React from 'react';
import { createPortal } from 'react-dom';
import { calcMitigation } from '../utils/combatUtils';
import './EnemyDetailCard.css';

const DEFENSE_INFO = {
  physDef: { title: 'Физическая защита', damageType: 'физический' },
  magicDef: { title: 'Магическая защита', damageType: 'магический' },
};

export const formatMitigationPercent = defense => `${Math.round(calcMitigation(defense) * 100)}%`;

export const DefenseInfoDialog = ({ statKey, value, onClose }) => {
  const info = DEFENSE_INFO[statKey];
  if (!info) return null;
  const overlay = <div className="defense-info-overlay" role="presentation" onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <section className="defense-info-dialog" role="dialog" aria-modal="true" aria-label={info.title} onMouseDown={event => event.stopPropagation()}>
      <h3>{info.title}</h3>
      <p>Снижает получаемый {info.damageType} урон.</p>
      <p>При текущем значении защиты снижение составляет примерно {formatMitigationPercent(value)}.</p>
      <p>Игнорирование защиты и другие эффекты могут изменить итоговый получаемый урон.</p>
      <button type="button" onClick={onClose}>Закрыть</button>
    </section>
  </div>;
  // The nested dialog must escape the scrolling/staking context of its parent.
  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
};

export const DefenseInfoButton = ({ statKey, value }) => {
  const [open, setOpen] = React.useState(false);
  const info = DEFENSE_INFO[statKey];
  if (!info) return null;
  return <>
    <button type="button" className="defense-info-button" aria-label={`Подробнее: ${info.title}`} onClick={event => { event.stopPropagation(); setOpen(true); }}>ⓘ</button>
    {open && <DefenseInfoDialog statKey={statKey} value={value} onClose={() => setOpen(false)} />}
  </>;
};
