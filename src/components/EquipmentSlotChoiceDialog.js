import React, { useState } from 'react';
import { findItemData } from '../data/items';
import { resolveItemArt, hideMissingItemArt } from '../data/itemArt';
import { EQUIPMENT_SLOT_LABELS } from '../utils/equipmentManager';
import { getEquipmentInstanceItemId } from '../utils/runeSockets';
import ItemDetailsModal from './ItemDetailsModal';

const EquipmentSlotChoiceDialog = ({ candidates, equipment, player, onSelect, onCancel }) => {
  const [inspectedSlot, setInspectedSlot] = useState(null);
  const inspectedItem = inspectedSlot ? equipment?.[inspectedSlot] : null;
  return <>
    <div className="inventory-confirm equipment-slot-choice" role="dialog" aria-label="Что заменить?">
      <p>Что заменить?</p>
      <div className="equipment-slot-choice__grid">{candidates.map(slot => {
        const item = equipment?.[slot];
        const itemName = getEquipmentInstanceItemId(item);
        const definition = findItemData(itemName);
        const art = resolveItemArt(definition || itemName);
        return <div key={slot} className="equipment-slot-choice__card" role="button" tabIndex="0" aria-label={`Заменить ${EQUIPMENT_SLOT_LABELS[slot]}: ${itemName}`} onClick={() => onSelect(slot)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(slot); } }}>
          <strong>{EQUIPMENT_SLOT_LABELS[slot]}</strong>
          <span className="equipment-slot-choice__art">{art && <img src={art} alt="" aria-hidden="true" onError={hideMissingItemArt} />}</span>
          <span className="equipment-slot-choice__name">{itemName}</span>
          <button className="compact-info-button equipment-slot-choice__info" type="button" aria-label={`Подробнее: ${itemName}`} onClick={event => { event.stopPropagation(); setInspectedSlot(slot); }}>i</button>
        </div>;
      })}</div>
      <button type="button" onClick={onCancel}>Отмена</button>
    </div>
    {inspectedItem && <ItemDetailsModal item={inspectedItem} player={player} context={{}} onClose={() => setInspectedSlot(null)} />}
  </>;
};

export default EquipmentSlotChoiceDialog;
