import React, { useState } from 'react';
import { equipmentByName } from '../data/equipment';
import { findItemData } from '../data/items';
import { getEquipmentSlotForItem } from '../utils/equipmentManager';
import { getInventoryItemUseCapability } from '../utils/inventoryItemUse';
import ItemDetailsCard from './ItemDetailsCard';
import './InventoryGridModal.css';
import { getRuneById, RUNE_LIBRARY } from '../data/runes';
import QuantityActionOverlay from './QuantityActionOverlay';

const ItemDetailsModal = ({ item, player, context, equipmentAction, unequipAction, depositAction, actionError, onEquip, onUnequip, onDeposit, onUse, onDrop, onDiscard, sellPrice, onSell, onWithdraw, maxWithdraw = 1, withdrawalStackQuantity = maxWithdraw, runeAction, onClose }) => {
  const [quantityMode, setQuantityMode] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const itemIdentity = item?.itemId || item?.name || item;
  const rune = getRuneById(itemIdentity) || RUNE_LIBRARY.find(entry => entry.name === itemIdentity);
  const def = findItemData(itemIdentity) || findItemData(item?.name) || (rune ? { id: rune.id, name: rune.name, type: 'rune', rarity: 'Руна', description: rune.description, effectDescription: rune.effectDescription, allowedEquipmentSlots: rune.allowedEquipmentSlots } : (context?.storage ? { name: String(item?.name || itemIdentity), type: 'unknown', rarity: 'Неизвестно', description: 'Эта запись хранилища сохранена, но её идентификатор больше не зарегистрирован.' } : null));
  if (!def) return null;
  const capability = getInventoryItemUseCapability(item, { ...context, player });
  const equipmentDefinition = equipmentByName[def.name];
  const comparisonSlot = equipmentDefinition ? getEquipmentSlotForItem(equipmentDefinition, player?.equipment) : null;
  const comparisonItem = equipmentAction ? player?.equipment?.[comparisonSlot] : null;
  return <div className="item-details-overlay" role="dialog" aria-modal="true" aria-label={`Предмет: ${def.name}`}>
    <div className="item-details-panel">
      <ItemDetailsCard def={def} item={item} comparisonItem={comparisonItem} isEquipped={Boolean(unequipAction)}>
      <footer className="item-details-card__footer">
        {def.fieldUse && onUse && !context?.inspectOnly && <button className="is-primary" type="button" disabled={!capability.available} onClick={onUse}>Использовать</button>}
        {equipmentAction && <button className="is-primary" type="button" disabled={!equipmentAction.available} onClick={onEquip}>Надеть</button>}
        {unequipAction && <button className="is-primary" type="button" disabled={!unequipAction.available} onClick={onUnequip}>Снять</button>}
        {depositAction && <button className="is-primary" type="button" disabled={!depositAction.available} onClick={onDeposit}>В хранилище</button>}
        {onDrop && <button className="is-danger" type="button" onClick={onDrop}>Выбросить</button>}
        {onDiscard && <button className="is-danger" type="button" onClick={() => setConfirmDiscard(true)}>Выбросить</button>}
        {onWithdraw && <button type="button" onClick={() => (item?.quantity || 1) === 1 ? onWithdraw(1) : setQuantityMode('withdraw')}>Забрать</button>}
        {onSell && sellPrice > 0 && <button type="button" onClick={() => (item?.quantity || 1) === 1 ? onSell(1) : setQuantityMode('sell')}>Продать</button>}
        {runeAction && <button className="is-secondary" type="button" disabled={!runeAction.available} onClick={runeAction.onClick}>{runeAction.label}</button>}
        <button className="is-secondary is-close" type="button" onClick={onClose}>Закрыть</button>
      </footer>
      {capability.reason && <p className="item-use-reason">{capability.reason}</p>}
      {equipmentAction?.reason && <p className="item-use-reason">{equipmentAction.reason}</p>}
      {unequipAction?.reason && <p className="item-use-reason">{unequipAction.reason}</p>}
      {runeAction?.reason && !runeAction.available && <p className="item-action-note">{runeAction.reason}</p>}
      {actionError?.reason && <div className="item-action-error" role="alert">{actionError.title && <strong>{actionError.title}</strong>}<p>{actionError.reason}</p></div>}
      </ItemDetailsCard>
    </div>
    {quantityMode && <QuantityActionOverlay mode={quantityMode} itemName={def.name} storedQuantity={item?.quantity || 1} maxQuantity={quantityMode === 'withdraw' ? maxWithdraw : item.quantity} quickQuantity={withdrawalStackQuantity} unitPrice={sellPrice / (item?.quantity || 1)} onConfirm={quantity => { const success = quantityMode === 'withdraw' ? onWithdraw(quantity) : onSell(quantity); if (success !== false) setQuantityMode(null); }} onClose={() => setQuantityMode(null)} />}
    {confirmDiscard && <div className="inventory-confirm" role="alertdialog" aria-label="Подтвердить удаление"><p>Выбросить «{def.name}»? Это действие нельзя отменить.</p><button className="ui-action--danger" type="button" onClick={() => { onDiscard(); setConfirmDiscard(false); }}>Выбросить</button><button className="ui-action--secondary" type="button" onClick={() => setConfirmDiscard(false)}>Отмена</button></div>}
  </div>;
};
export default ItemDetailsModal;
