import React, { useState } from 'react';
import { findItemData } from '../data/items';
import { hideMissingItemArt, resolveItemArt } from '../data/itemArt';
import { EQUIPMENT_SLOT_LABELS } from '../utils/equipmentManager';
import NestedActionOverlay from './NestedActionOverlay';
import PickerActionFooter from './PickerActionFooter';

const RuneTargetSelectionOverlay = ({ targets, onSelect, onClose }) => {
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const confirm = () => {
    if (!selected) return;
    const result = onSelect(selected);
    if (result === false || result?.success === false) setError(result?.reason || 'Не удалось вставить руну.');
  };
  const orderedTargets = [...targets].sort((left, right) => Number(right.equipped || right.location === 'equipped') - Number(left.equipped || left.location === 'equipped'));
  return <NestedActionOverlay label="Выбор снаряжения" onClose={onClose} showDefaultCancel={false}>
    <div className="game-picker"><h3>Выберите снаряжение</h3>
      {orderedTargets.length === 0 ? <p role="status">Нет подходящего снаряжения.</p> : <div className="game-picker-list rune-target-list">
        {orderedTargets.map(target => {
          const def = findItemData(target.item.itemId);
          const isSelected = selected === target;
          return <button className={`game-picker-card${isSelected ? ' is-selected' : ''}`} type="button" aria-pressed={isSelected} key={`${target.location}-${target.slot}-${target.item.instanceId}`} onClick={() => { setSelected(target); setError(null); }} aria-label={`Выбрать ${def?.name || 'Снаряжение'}${target.equipped ? ', надето' : ''}`}>
            {target.equipped && <span className="equipped-item-marker" aria-label="Надето">✓</span>}
            <img src={resolveItemArt(def || target.item)} alt="" draggable={false} onError={hideMissingItemArt} />
            <span><strong>{def?.name || 'Снаряжение'}</strong><small>{EQUIPMENT_SLOT_LABELS[target.slot] || target.slot}{target.equipped ? ' · Надето' : ' · В инвентаре'}</small></span>
          </button>;
        })}
      </div>}
      <PickerActionFooter selected={selected} onConfirm={confirm} onClose={onClose} error={error} />
    </div>
  </NestedActionOverlay>;
};

export default RuneTargetSelectionOverlay;
