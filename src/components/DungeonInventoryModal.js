import React from 'react';
import InventoryGridModal from './InventoryGridModal';
import { applyInventoryItemUse } from '../utils/inventoryItemUse';

/** Canonical expedition inventory surface. Safe ownership is encoded by typed slots 0/1. */
const DungeonInventoryModal = ({ player, onClose, onUpdatePlayer }) => (
  <InventoryGridModal
    player={player}
    context={{ inExpedition: true, inCombat: false }}
    onClose={onClose}
    onChangeSlots={runInventory => onUpdatePlayer?.({ runInventory })}
    onChangePlayer={onUpdatePlayer}
    onUseItem={slotIndex => onUpdatePlayer?.(previous => applyInventoryItemUse(previous, slotIndex, { inExpedition: true, inCombat: false }).player)}
  />
);

export default DungeonInventoryModal;
