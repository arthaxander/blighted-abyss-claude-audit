import React from "react";
import { hideMissingItemArt, resolveItemArt } from "../../data/itemArt";

export const GuildItemGrid = ({ label, children, className = "" }) => (
  <div className={`guild-item-grid ${className}`.trim()} role="list" aria-label={label}>{children}</div>
);

export const GuildItemCell = ({ item, name, quantity = 1, price, selected, disabled, safe, empty, badge, showName = true, onClick, onPointerDown, slotIndex, dragging, testId }) => {
  const displayName = name || item?.name || item?.itemId || "Пустая ячейка";
  const art = !empty && resolveItemArt(item || displayName);
  const contents = <>
    {art ? <img src={art} alt="" onError={hideMissingItemArt} /> : <span className="guild-item-cell__placeholder" aria-hidden="true">{empty ? "·" : "◇"}</span>}
    {safe && <span className="guild-item-cell__safe" title="Безопасная ячейка">◆</span>}
    {quantity > 1 && <span className="guild-item-badge guild-item-badge--quantity">{quantity}</span>}
    {price !== undefined && <span className="guild-item-badge guild-item-badge--price">{price} ◈</span>}
    {badge && <span className="guild-item-badge guild-item-badge--state">{badge}</span>}
    {!empty && showName && <strong>{displayName}</strong>}
    {selected && <span className="guild-item-cell__check" aria-hidden="true">✓</span>}
  </>;
  if (empty) return <div role="listitem" data-testid={testId} data-slot-index={slotIndex} className={`guild-item-cell is-empty${safe ? " is-safe" : ""}`} aria-label={displayName}>{contents}</div>;
  return <button type="button" role="listitem" data-sfx="itemSelect" data-testid={testId} data-slot-index={slotIndex} className={`guild-item-cell${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}${safe ? " is-safe" : ""}${dragging ? " is-dragging" : ""}`} aria-label={displayName} disabled={disabled && !onClick} onPointerDown={onPointerDown} onClick={onClick}>{contents}</button>;
};

export const GuildCategoryTabs = ({ label, entries, value, onChange }) => (
  <div className="guild-category-tabs" role="tablist" aria-label={label}>
    {entries.map(entry => <button key={entry.id} type="button" role="tab" aria-selected={value === entry.id} onClick={() => onChange(entry.id)}>{entry.label}</button>)}
  </div>
);
