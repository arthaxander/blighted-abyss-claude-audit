import React, { useState } from 'react';
import './DungeonRunHud.css';
import StatusLinkedText from './StatusLinkedText';

const EffectIcon = ({ effect, onOpen }) => (
  <button
    type="button"
    className={`dungeon-effect-icon dungeon-effect-icon--${effect.kind || 'modifier'}${effect.dominant ? ' dungeon-effect-icon--dominant' : ''}`}
    style={effect.accent ? { '--curse-accent': effect.accent } : undefined}
    onClick={() => onOpen(effect)}
    aria-label={`${effect.name}: открыть описание`}
  >
    <span aria-hidden="true">{effect.symbol || effect.name.charAt(0)}</span>
  </button>
);

const UtilityButton = ({ symbol, label, onClick, disabled = false, tone = 'default' }) => (
  <button
    type="button"
    className={`dungeon-utility-button dungeon-utility-button--${tone}`}
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
  >
    <span className="dungeon-utility-button__symbol" aria-hidden="true">{symbol}</span>
  </button>
);

const DungeonRunHud = ({
  effects = [],
  onOpenInventory,
  onOpenCrafting,
  onUsePortal,
  portalAvailable = false,
  portalBlockedReason = null,
  onSeverAbyssLink,
  abyssBound = false,
  utilitiesDisabled = false,
}) => {
  const [selectedEffect, setSelectedEffect] = useState(null);

  return (
    <div className="dungeon-run-hud">
      {effects.length > 0 && (
        <div className="dungeon-effect-row" aria-label="Эффекты забега">
          {effects.map(effect => (
            <EffectIcon key={effect.id} effect={effect} onOpen={setSelectedEffect} />
          ))}
        </div>
      )}

      <div className="dungeon-utility-row" aria-label="Действия в походе">
        <UtilityButton symbol="И" label="Инвентарь" onClick={onOpenInventory} disabled={utilitiesDisabled} />
        <UtilityButton symbol="К" label="Полевой крафт" onClick={onOpenCrafting} disabled={utilitiesDisabled} />
        {portalAvailable && (
          <UtilityButton
            symbol="↩"
            label={portalBlockedReason || 'Вернуться в Гильдию'}
            onClick={onUsePortal}
            disabled={utilitiesDisabled || Boolean(portalBlockedReason)}
            tone="portal"
          />
        )}
        {abyssBound && onSeverAbyssLink && (
          <button type="button" className="dungeon-utility-button dungeon-utility-button--danger" onClick={onSeverAbyssLink} disabled={utilitiesDisabled}>
            Разорвать связь
          </button>
        )}
      </div>

      {selectedEffect && (
        <div className="dungeon-effect-popover" role="dialog" aria-modal="true" aria-labelledby="run-effect-title">
          <div className="dungeon-effect-popover__panel">
            <h3 id="run-effect-title">{selectedEffect.name}</h3>
            <StatusLinkedText className="dungeon-effect-popover__description">{selectedEffect.description}</StatusLinkedText>
            {selectedEffect.alertScale ? (() => {
              const battles = Number(selectedEffect.completedCombatRooms) || 0;
              const level = battles >= 9 ? 3 : battles >= 6 ? 2 : battles >= 3 ? 1 : 0;
              return <div className={`camp-alert-scale camp-alert-scale--${level}`} aria-label={`Уровень тревоги: ${level === 0 ? '0' : ['I','II','III'][level - 1]}`}>
                {[0,1,2,3].map(segment => <span key={segment} className={segment <= level ? 'is-active' : ''} />)}
              </div>;
            })() : null}
            <button type="button" onClick={() => setSelectedEffect(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DungeonRunHud;
