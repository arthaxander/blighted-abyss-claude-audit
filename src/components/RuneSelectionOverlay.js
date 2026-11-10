import React, { useState } from 'react';
import { getRuneById, getRuneSlotLabel } from '../data/runes';
import { hideMissingItemArt, resolveItemArt } from '../data/itemArt';
import NestedActionOverlay from './NestedActionOverlay';
import PickerActionFooter from './PickerActionFooter';

const getFailureReason = result => result?.reason || 'Не удалось вставить руну.';

const RuneSelectionOverlay = ({ entries, onSelect, onClose, emptyMessage = 'Нет подходящих рун в хранилище.' }) => {
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const confirm = () => {
    if (!selected) return;
    const result = onSelect(selected);
    if (result === false || result?.success === false) setError(getFailureReason(result));
  };
  return <NestedActionOverlay label="Выбор руны" onClose={onClose} showDefaultCancel={false}>
    <div className="game-picker"><h3>Выберите руну</h3>
      {entries.length === 0 ? <p role="status">{emptyMessage}</p> : <div className="game-picker-list rune-selection-list">{entries.map((entry, index) => {
        const rune = getRuneById(entry.itemId); if (!rune) return null;
        const key = entry.entryId || `${entry.itemId}-${index}`;
        const isSelected = selected === entry;
        return <button className={`game-picker-card${isSelected ? ' is-selected' : ''}`} type="button" key={key} aria-pressed={isSelected} onClick={() => { setSelected(entry); setError(null); }} aria-label={`Выбрать ${rune.name}`}><img src={resolveItemArt(entry)} alt="" draggable={false} onError={hideMissingItemArt} /><span><strong>{rune.name}</strong><small>{getRuneSlotLabel(rune.slot)} · ×{entry.quantity}</small></span></button>;
      })}</div>}
      <PickerActionFooter selected={selected} onConfirm={confirm} onClose={onClose} error={error} />
    </div>
  </NestedActionOverlay>;
};
export default RuneSelectionOverlay;
