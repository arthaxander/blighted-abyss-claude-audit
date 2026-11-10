import React, { useMemo, useState } from 'react';
import { findItemData } from '../data/items';
import { hideMissingItemArt, resolveItemArt } from '../data/itemArt';
import { getRunInventoryLayout, preserveInventorySlots } from '../utils/expeditionInventory';
import { getSelectedPendingItems, previewPendingLoot, selectFittingPendingLoot, shouldWarnAboutAbandonedLoot, togglePendingLootSelection } from '../utils/pendingLoot';
import LootArtworkGate from './LootArtworkGate';
import './PendingLootModal.css';

export const PendingLootContent = ({ pendingLoot, player, onChange, onResolve, onOpenInventory, onInfo, suppressAbandonWarnings = false, onSuppressAbandonWarningsChange, actionLabel = 'Забрать выбранное' }) => {
  const [confirmAbandon, setConfirmAbandon] = useState(null);
  const layout = useMemo(() => getRunInventoryLayout(player?.equipment), [player?.equipment]);
  const capacity = layout.totalCapacity;
  const slots = preserveInventorySlots(player?.runInventory, capacity);
  const preview = useMemo(() => previewPendingLoot(pendingLoot, slots, layout), [pendingLoot, slots, layout]);
  const selected = getSelectedPendingItems(pendingLoot);
  const occupied = slots.filter(Boolean).length;
  const finish = (candidate = pendingLoot, warnOnOverflow = false) => {
    const left = candidate.items.filter(item => !candidate.selectedIds.includes(item.id));
    if (left.length && (warnOnOverflow || shouldWarnAboutAbandonedLoot(left, suppressAbandonWarnings))) {
      setConfirmAbandon({ candidate, overflow: warnOnOverflow });
      return;
    }
    onResolve(candidate);
  };
  const takeAll = () => {
    const candidate = selectFittingPendingLoot(pendingLoot, slots, layout);
    finish(candidate, candidate.items.some(item => !candidate.selectedIds.includes(item.id)));
  };
  return <section className="pending-loot-panel">
    <div className="pending-loot-header">
      <h2>{pendingLoot.source === 'fishing' ? 'Улов' : 'Добыча'}</h2>
      {pendingLoot.silver > 0 && <p className="pending-loot-silver">+{pendingLoot.silver} серебра</p>}
      {pendingLoot.resonance > 0 && <p className="pending-loot-resonance">+{pendingLoot.resonance} Резонанса Бездны</p>}
    </div>
    <div className="pending-loot-content">
      {pendingLoot.specialRewards?.length > 0 && <section className="pending-loot-special" aria-label="Особая добыча"><h3>Особая добыча</h3>{pendingLoot.specialRewards.map(reward => <p key={reward.id}>✦ {reward.name}</p>)}</section>}
      <div className="pending-loot-grid">
        {pendingLoot.items.map(item => {
          const selectedItem = pendingLoot.selectedIds.includes(item.id);
          const def = findItemData(item.itemId);
          const itemArt = resolveItemArt(def || item);
          return <div key={item.id} className={`pending-loot-cell${selectedItem ? ' is-selected' : ''}`}>
            <button type="button" className="pending-loot-select" aria-label={`${item.itemId}${item.quantity > 1 ? `, количество ${item.quantity}` : ''}`} aria-pressed={selectedItem} onClick={() => onChange(togglePendingLootSelection(pendingLoot, item.id))}>
              {itemArt && <img className="pending-loot-art" src={itemArt} alt="" aria-hidden="true" onError={hideMissingItemArt} />}
              {item.quantity > 1 && <b className="item-icon-quantity">{item.quantity}</b>}{selectedItem && <i aria-hidden="true">✓</i>}
            </button>
            <button type="button" className="compact-info-button pending-loot-info item-icon-info" aria-label={`Подробнее: ${item.itemId}`} onClick={event => { event.stopPropagation(); onInfo?.(item, def); }}>i</button>
          </div>;
        })}
      </div>
      <div className="pending-loot-summary">
        <span>Инвентарь {occupied}/{capacity}</span><span>Выбрано: {selected.length}</span><span>Нужно ячеек: {preview.additionalSlotsRequired}</span>
      </div>
      {!preview.fits && <p className="pending-loot-error">Не хватает ячеек: {preview.additionalSlotsRequired}</p>}
      <label><input type="checkbox" checked={suppressAbandonWarnings} onChange={event => onSuppressAbandonWarningsChange?.(event.target.checked)}/> Не предупреждать об оставленной добыче</label>
    </div>
      {confirmAbandon && <div className="pending-loot-confirm" role="alertdialog"><p>{confirmAbandon.overflow ? 'Не вся добыча помещается в инвентарь. Забрать то, что влезает, а остальное оставить?' : 'Оставить невыбранную добычу?'}</p><button type="button" onClick={() => onResolve(confirmAbandon.candidate)}>Оставить</button><button type="button" onClick={() => setConfirmAbandon(null)}>Назад</button></div>}
      <div className="pending-loot-actions"><button className="ui-action--secondary" type="button" onClick={onOpenInventory}>Открыть инвентарь</button><button className="ui-action--secondary" type="button" onClick={takeAll}>Забрать всё</button><button className="ui-action--primary" type="button" disabled={!preview.fits} onClick={() => finish()}>{actionLabel}</button></div>
    </section>;
};
const PendingLootModal = props => <div className="pending-loot-overlay" role="dialog" aria-modal="true" aria-label="Добыча"><LootArtworkGate pendingLoot={props.pendingLoot}><PendingLootContent {...props}/></LootArtworkGate></div>;
export default PendingLootModal;


