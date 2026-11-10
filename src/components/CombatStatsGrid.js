import React from 'react';
import { formatItemStatValue } from '../utils/itemDetailsPresentation';
import { DefenseInfoButton } from './DefenseInfoDialog';

const CombatStatsGrid = ({ stats, ariaLabel }) => {
  return <section className="enemy-detail-stats" aria-label={ariaLabel}>
    {stats.map(stat => {
      return <div className={`enemy-detail-stat${stat.key === 'hp' ? ' enemy-detail-stat--hp' : ''}`} key={stat.key}><span className="combat-stat-label">{stat.label}<DefenseInfoButton statKey={stat.key} value={stat.value} /></span><strong>{typeof stat.value === 'number' ? formatItemStatValue(stat.key, stat.value) : stat.value}</strong></div>;
    })}
  </section>;
};

export default CombatStatsGrid;
