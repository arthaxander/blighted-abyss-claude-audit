import React from 'react';
import { PendingLootContent } from './PendingLootModal';
import LootArtworkGate from './LootArtworkGate';
import './CombatLootScreen.css';

const CombatLootScreen = ({ pendingLoot, player, onChange, onResolve, onOpenInventory, onInfo, suppressAbandonWarnings, onSuppressAbandonWarningsChange }) => (
  <main className="combat-loot-screen" aria-label="Добыча после боя">
    <div className="combat-loot-screen-content">
      <LootArtworkGate pendingLoot={pendingLoot}>
      <PendingLootContent
        pendingLoot={pendingLoot}
        player={player}
        onChange={onChange}
        onResolve={onResolve}
        onOpenInventory={onOpenInventory}
        onInfo={onInfo}
        suppressAbandonWarnings={suppressAbandonWarnings}
        onSuppressAbandonWarningsChange={onSuppressAbandonWarningsChange}
        actionLabel="Забрать и продолжить"
      />
      </LootArtworkGate>
    </div>
  </main>
);

export default CombatLootScreen;
