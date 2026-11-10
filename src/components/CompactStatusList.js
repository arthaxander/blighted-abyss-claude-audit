import React from 'react';
import { getEffectDefinition, getEffectDurationLabel } from '../utils/effects';
import EffectReferenceText from './EffectReferenceText';

const CompactStatusList = ({ effects = [], className = 'player-combat-status-list' }) => <div className={className}>
  {effects.filter(Boolean).map((effect, index) => {
    const definition = getEffectDefinition(effect.id || effect.name);
    const name = definition?.name || effect.name || effect.id || 'Эффект';
    const durationLabel = getEffectDurationLabel(effect, definition);
    const stacks = effect.stacks ?? effect.stackCount;
    return <div className="player-combat-status" key={`${effect.id || name}-${index}`}>
      <span className={`player-combat-status__icon player-combat-status__icon--${definition?.type || 'resource'}`} aria-hidden="true">{definition?.iconPath ? <img src={definition.iconPath} alt="" /> : definition?.icon || '✦'}</span>
      <EffectReferenceText parts={[{
        statusId: definition?.id || effect.id,
        text: name,
        descriptionOverride: effect?.extra?.preparedDescription || effect?.description || null,
      }]} />
      <small>{[stacks > 1 ? `×${stacks}` : null, durationLabel].filter(Boolean).join(' · ')}</small>
    </div>;
  })}
</div>;

export default CompactStatusList;
