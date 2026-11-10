import React, { useState } from 'react';
import { equipmentByName } from '../data/equipment';
import { resolveItemArt } from '../data/itemArt';
import { getItemDefinition } from '../data/items';
import { formatItemStatValue, getMeaningfulEquipmentStatRows, getItemClassification, getItemTextSections } from '../utils/itemDetailsPresentation';
import EffectReferenceText from './EffectReferenceText';
import { equipmentSupportsRuneSocket } from '../utils/runeSockets';
import { getRuneById } from '../data/runes';

const ItemDetailsCard = ({ def, item, comparisonItem, isEquipped = false, children }) => {
  const [artFailed, setArtFailed] = useState(false);
  const art = resolveItemArt(def);
  const equipmentDefinition = def.type === 'equipment' ? equipmentByName[def.name] : null;
  const comparisonItemName = typeof comparisonItem === 'string' ? comparisonItem : comparisonItem?.itemId || comparisonItem?.name;
  const comparisonDefinition = comparisonItemName ? equipmentByName[comparisonItemName] : null;
  const selectedStats = equipmentDefinition ? { ...equipmentDefinition, stats: { ...equipmentDefinition.stats, ...(item?.stats || {}) } } : null;
  const currentStats = comparisonDefinition ? { ...comparisonDefinition, stats: { ...comparisonDefinition.stats, ...(comparisonItem?.stats || {}) } } : null;
  const comparisonStatRows = getMeaningfulEquipmentStatRows(selectedStats, currentStats);
  const textSections = getItemTextSections(def, equipmentDefinition, getItemDefinition(def.name));
  const quantity = typeof item === 'object' ? item.quantity : null;
  const socketSlot = equipmentDefinition?.type === 'Weapon' ? 'mainHand' : equipmentDefinition?.type === 'Armor' ? 'armor' : equipmentDefinition?.type === 'Amulet' ? 'amulet' : null;
  const socketedRune = getRuneById(item?.socketedRuneId);
  const comparisonRune = getRuneById(comparisonItem?.socketedRuneId);
  const runeComparisonChanged = Boolean(comparisonDefinition) && (item?.socketedRuneId || null) !== (comparisonItem?.socketedRuneId || null);
  const hasComparison = Boolean(comparisonDefinition) && (comparisonStatRows.length > 0 || runeComparisonChanged);
  const statRows = hasComparison
    ? comparisonStatRows
    : getMeaningfulEquipmentStatRows(selectedStats, null);
  const looseRune = def.type === 'rune' ? getRuneById(def.id) : null;

  const isSpecialMaterial = def.type === 'material' && (def.sourceTier === 'rareCatalyst' || /эссенци/i.test(def.name));

  return <section className={`item-details-card${isSpecialMaterial ? ' is-special' : ''}`}>
    <header className="item-details-card__header">
      <div className="item-details-card__art">
        {art && !artFailed
          ? <img src={art} alt="" aria-hidden="true" onError={() => setArtFailed(true)} />
          : <span aria-hidden="true">◇</span>}
      </div>
      <div className="item-details-card__identity">
        <h3>{def.name}</h3>
        <p className="item-details-card__classification">{getItemClassification(def, equipmentDefinition)}</p>
        <p className="item-details-card__meta">{[def.rarity, isEquipped ? 'Надето' : null, quantity > 1 ? `Количество: ${quantity}` : null].filter(Boolean).join(' · ')}</p>
      </div>
    </header>

    <div className="item-details-card__body">
      {equipmentDefinition?.type === 'MagicOffHand' && <p className="item-details-card__compatibility">Требует одноручное магическое оружие</p>}
      {def.bagCapacity > 0 && <p className="item-details-card__highlight">Вместимость: +{def.bagCapacity}</p>}
      {def.inventorySlotBonuses && <p className="item-details-card__highlight">Ячейки: +{def.inventorySlotBonuses.general || 0} обычные · +{def.inventorySlotBonuses.consumable || 0} расходные · +{def.inventorySlotBonuses.resource || 0} ресурсные</p>}
      {(statRows.length > 0 || hasComparison) && <section className={`item-details-card__stats${hasComparison ? ' is-comparison' : ''}`} aria-label={hasComparison ? 'Сравнение с надетым предметом' : 'Характеристики предмета'}>
        {hasComparison ? <header className="item-details-card__comparison-heading"><h4>Сравнение</h4><span>{comparisonDefinition.name}</span></header> : <h4>Характеристики</h4>}
        <dl>{statRows.map(row => <div key={row.key}>
          <dt>{row.label}</dt>
          <dd>{hasComparison
            ? <><span>{formatItemStatValue(row.key, row.currentValue)} → {formatItemStatValue(row.key, row.selectedValue)}</span><b className={row.delta > 0 ? 'is-positive' : row.delta < 0 ? 'is-negative' : ''}>{formatItemStatValue(row.key, row.delta, { signed: true })}</b></>
            : formatItemStatValue(row.key, row.selectedValue, { signed: true })}</dd>
        </div>)}{runeComparisonChanged && <div className="item-details-card__rune-comparison"><dt>Руна</dt><dd><span>{comparisonRune?.name || 'Пусто'} → {socketedRune?.name || 'Пусто'}</span></dd></div>}</dl>
      </section>}
      {socketSlot && equipmentSupportsRuneSocket(item || def.name, socketSlot) && <section className="item-details-card__socket" aria-label="Ячейка руны"><span>Руна</span><strong>{socketedRune ? <><span aria-hidden="true">◆ </span>{socketedRune.name}</> : 'Пусто'}</strong>{socketedRune?.effectDescription && <p>{socketedRune.effectDescription}</p>}</section>}
      {looseRune && <section className="item-details-card__description" aria-label="Свойства руны"><h4>Совместимость</h4><p>{looseRune.allowedEquipmentSlots.map(slot => ({ mainHand: 'Оружие', armor: 'Нагрудная броня', amulet: 'Амулет' }[slot] || slot)).join(', ')}</p><p>{looseRune.effectDescription}</p></section>}
      {textSections.effectParts?.length > 0 && <section className="item-details-card__description item-details-card__effect"><h4>Эффект</h4><EffectReferenceText parts={textSections.effectParts} /></section>}
      {textSections.purpose && <section className={`item-details-card__description${isSpecialMaterial ? ' is-highlighted' : ''}`}><h4>Назначение</h4><p>{textSections.purpose}</p></section>}
      {textSections.flavor && <section className="item-details-card__description"><h4>Описание</h4><p>{textSections.flavor}</p></section>}
      {textSections.usageNote && <p className="item-details-card__usage-note">{textSections.usageNote}</p>}
    </div>
    {children}
  </section>;
};

export default ItemDetailsCard;
