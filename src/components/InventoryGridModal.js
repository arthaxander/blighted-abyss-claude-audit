import React, { useEffect, useRef, useState } from 'react';
import { findItemData } from '../data/items';
import { discardInventoryStack, equipRunInventoryItem, getInventoryEquipmentAction, getRunInventoryLayout, isSafeSlotIndex, moveInventoryStack, preserveInventorySlots, SAFE_SLOT_COUNT, sortOrdinaryInventory, unequipRunEquipment } from '../utils/expeditionInventory';
import { EQUIPMENT_SLOT_KEYS, EQUIPMENT_SLOT_LABELS } from '../utils/equipmentManager';
import { resolvePlayerPortrait } from '../data/combatAssets';
import { hideMissingItemArt, resolveItemArt } from '../data/itemArt';
import ItemDetailsModal from './ItemDetailsModal';
import { DefenseInfoButton } from './DefenseInfoDialog';
import { formatItemStatValue } from '../utils/itemDetailsPresentation';
import './InventoryGridModal.css';
import { canSocketRune, equipmentSupportsRuneSocket, getCompatibleRuneEntries, getEquipmentInstanceItemId, normalizeSocketEquipmentInstance, socketRuneIntoEquipment, socketRuneIntoEquippedItem } from '../utils/runeSockets';
import { GAMEPLAY_DRAG_ACTIVATION_DISTANCE, TOUCH_DRAG_HOLD_MS, TOUCH_DRAG_MOVE_TOLERANCE } from '../constants/interaction';
import { getRuneById } from '../data/runes';
import RuneSelectionOverlay from './RuneSelectionOverlay';
import RuneTargetSelectionOverlay from './RuneTargetSelectionOverlay';
import EquipmentSlotChoiceDialog from './EquipmentSlotChoiceDialog';

const PAPER_DOLL_SLOT_LABELS = {
  mainHand: 'Осн. рука',
  offHand: '2-я рука',
};

const EDGE_SCROLL_ZONE_HEIGHT = 64;
const EDGE_SCROLL_MIN_SPEED = 3;
const EDGE_SCROLL_MAX_SPEED = 12;
const SCROLL_BOUND_EPSILON = 1;
export { TOUCH_DRAG_HOLD_MS, TOUCH_DRAG_MOVE_TOLERANCE } from '../constants/interaction';

const getInventoryItemPresentation = stack => {
  const definition = findItemData(stack?.itemId);
  const rune = getRuneById(stack?.itemId);
  const canonicalName = definition?.name || rune?.name || stack?.name
    || (/^[a-z0-9_-]+$/i.test(stack?.itemId || '') ? 'Предмет' : stack?.itemId)
    || 'Предмет';
  return {
    definition,
    art: resolveItemArt(definition || stack),
    canonicalName,
  };
};

const InventoryGridModal = ({ player, onChangeSlots, onChangePlayer, onUseItem, onClose, context = {}, lootContext }) => {
  const layout = getRunInventoryLayout(player?.equipment);
  const slots = preserveInventorySlots(player?.runInventory, layout.totalCapacity);
  const occupiedSlotCount = slots.slice(0, layout.totalCapacity).filter(Boolean).length;
  const freeSlotCount = layout.totalCapacity - occupiedSlotCount;
  const overflowIndices = slots.map((stack, index) => stack && index >= layout.totalCapacity ? index : null).filter(index => index !== null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragPoint, setDragPoint] = useState(null);
  const [detailsIndex, setDetailsIndex] = useState(null);
  const [equipmentDetails, setEquipmentDetails] = useState(null);
  const [discardMode, setDiscardMode] = useState(false);
  const [discardSelection, setDiscardSelection] = useState({});
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [activeView, setActiveView] = useState('inventory');
  const [actionError, setActionError] = useState(null);
  const [runeSelection, setRuneSelection] = useState(null);
  const [runeTargetSelection, setRuneTargetSelection] = useState(null);
  const [equipSlotChoice, setEquipSlotChoice] = useState(null);
  const [scrollBounds, setScrollBounds] = useState({ canScrollUp: false, canScrollDown: false, top: 0, bottom: 0, left: 0, width: 0 });
  const suppressNextClickRef = useRef(false);
  const tapCandidateRef = useRef(null);
  const pointerCleanupRef = useRef(null);
  const mountedRef = useRef(true);
  const panelRef = useRef(null);
  const headerRef = useRef(null);
  const autoScrollFrameRef = useRef(null);
  const autoScrollRef = useRef({ direction: 0, speed: 0 });
  const edgeZoneArmedRef = useRef({ top: true, bottom: true });
  const [, setEdgeArmingVersion] = useState(0);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const stopAutoScroll = () => {
    autoScrollRef.current = { direction: 0, speed: 0 };
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };
  const updateScrollBounds = () => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const headerRect = headerRef.current?.getBoundingClientRect();
    const topScrollBoundary = Math.max(rect.top, headerRect?.bottom ?? rect.top);
    const next = {
      canScrollUp: panel.scrollTop > SCROLL_BOUND_EPSILON,
      canScrollDown: panel.scrollTop + panel.clientHeight < panel.scrollHeight - SCROLL_BOUND_EPSILON,
      top: topScrollBoundary,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
    };
    setScrollBounds(current => Object.keys(next).every(key => current[key] === next[key]) ? current : next);
  };
  useEffect(() => () => {
    mountedRef.current = false;
    stopAutoScroll();
    pointerCleanupRef.current?.();
  }, []);
  useEffect(() => {
    if (discardMode) pointerCleanupRef.current?.();
  }, [discardMode]);
  useEffect(() => {
    pointerCleanupRef.current?.();
  }, [activeView]);
  const requestDiscard = sourceIndex => {
    if (sourceIndex === null) return;
    setDiscardMode(true);
    setDiscardSelection({ [sourceIndex]: JSON.stringify(slotsRef.current[sourceIndex]) });
  };
  const beginPointerInteraction = (event, sourceIndex) => {
    if (discardMode) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (!slots[sourceIndex]) return;
    pointerCleanupRef.current?.();
    suppressNextClickRef.current = false;
    tapCandidateRef.current = null;
    edgeZoneArmedRef.current = { top: true, bottom: true };
    const pointerId = event.pointerId;
    const sourceElement = event.currentTarget;
    const sourceSnapshot = JSON.stringify(slots[sourceIndex]);
    const startX = event.clientX;
    const startY = event.clientY;
    // A pen is a precise pointer, so it follows the existing mouse threshold.
    // Only coarse touch input needs hold-versus-native-scroll arbitration.
    const usesHold = event.pointerType === 'touch';
    let currentX = startX;
    let currentY = startY;
    let dragActive = false;
    let scrollGesture = false;
    let holdTimer = null;
    const runAutoScroll = () => {
      autoScrollFrameRef.current = null;
      const panel = panelRef.current;
      const { direction, speed } = autoScrollRef.current;
      if (!dragActive || !panel || !direction) return;
      const previous = panel.scrollTop;
      panel.scrollTop += direction * speed;
      updateScrollBounds();
      const atBound = panel.scrollTop === previous
        || (direction < 0 && panel.scrollTop <= SCROLL_BOUND_EPSILON)
        || (direction > 0 && panel.scrollTop + panel.clientHeight >= panel.scrollHeight - SCROLL_BOUND_EPSILON);
      if (atBound) {
        stopAutoScroll();
        return;
      }
      autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    };
    const getEdgeZonePresence = clientY => {
      const panel = panelRef.current;
      if (!panel) return { top: false, bottom: false };
      const rect = panel.getBoundingClientRect();
      const headerRect = headerRef.current?.getBoundingClientRect();
      const topScrollBoundary = Math.max(rect.top, headerRect?.bottom ?? rect.top);
      return {
        top: clientY >= topScrollBoundary && clientY < topScrollBoundary + EDGE_SCROLL_ZONE_HEIGHT,
        bottom: clientY <= rect.bottom && clientY > rect.bottom - EDGE_SCROLL_ZONE_HEIGHT,
      };
    };
    const updateAutoScroll = clientY => {
      const panel = panelRef.current;
      if (!dragActive || !panel) return stopAutoScroll();
      const rect = panel.getBoundingClientRect();
      const headerRect = headerRef.current?.getBoundingClientRect();
      const topScrollBoundary = Math.max(rect.top, headerRect?.bottom ?? rect.top);
      const inside = getEdgeZonePresence(clientY);
      let armedChanged = false;
      if (!edgeZoneArmedRef.current.top && !inside.top) { edgeZoneArmedRef.current.top = true; armedChanged = true; }
      if (!edgeZoneArmedRef.current.bottom && !inside.bottom) { edgeZoneArmedRef.current.bottom = true; armedChanged = true; }
      if (armedChanged) setEdgeArmingVersion(version => version + 1);
      let direction = 0;
      let depth = 0;
      if (inside.top && edgeZoneArmedRef.current.top && panel.scrollTop > SCROLL_BOUND_EPSILON) {
        direction = -1;
        depth = (topScrollBoundary + EDGE_SCROLL_ZONE_HEIGHT - clientY) / EDGE_SCROLL_ZONE_HEIGHT;
      } else if (inside.bottom && edgeZoneArmedRef.current.bottom && panel.scrollTop + panel.clientHeight < panel.scrollHeight - SCROLL_BOUND_EPSILON) {
        direction = 1;
        depth = (clientY - (rect.bottom - EDGE_SCROLL_ZONE_HEIGHT)) / EDGE_SCROLL_ZONE_HEIGHT;
      }
      if (!direction) return stopAutoScroll();
      autoScrollRef.current = { direction, speed: EDGE_SCROLL_MIN_SPEED + (EDGE_SCROLL_MAX_SPEED - EDGE_SCROLL_MIN_SPEED) * Math.max(0, Math.min(1, depth)) };
      if (autoScrollFrameRef.current === null) autoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    };
    const cleanup = () => {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      stopAutoScroll();
      edgeZoneArmedRef.current = { top: true, bottom: true };
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', suppressNativePan);
      sourceElement.removeEventListener?.('lostpointercapture', cancel);
      if (sourceElement.hasPointerCapture?.(pointerId)) sourceElement.releasePointerCapture(pointerId);
      pointerCleanupRef.current = null;
      if (mountedRef.current) {
        setDragIndex(null);
        setDragPoint(null);
      }
    };
    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      currentX = moveEvent.clientX;
      currentY = moveEvent.clientY;
      const distance = Math.hypot(currentX - startX, currentY - startY);
      if (usesHold && !dragActive && !scrollGesture && distance > TOUCH_DRAG_MOVE_TOLERANCE) {
        scrollGesture = true;
        tapCandidateRef.current = null;
        if (holdTimer !== null) clearTimeout(holdTimer);
        holdTimer = null;
      } else if (!usesHold && !dragActive && distance >= GAMEPLAY_DRAG_ACTIVATION_DISTANCE) {
        dragActive = true;
        const inside = getEdgeZonePresence(moveEvent.clientY);
        edgeZoneArmedRef.current = { top: !inside.top, bottom: !inside.bottom };
        setEdgeArmingVersion(version => version + 1);
      }
      if (dragActive) {
        moveEvent.preventDefault();
        setDragIndex(sourceIndex);
        setDragPoint({ x: moveEvent.clientX, y: moveEvent.clientY });
        updateScrollBounds();
        updateAutoScroll(moveEvent.clientY);
      }
    };
    const onEnd = upEvent => {
      if (upEvent.pointerId !== pointerId) return;
      if (!dragActive) {
        if (scrollGesture) suppressNextClickRef.current = true;
        else tapCandidateRef.current = sourceIndex;
        cleanup();
        return;
      }
      upEvent.preventDefault();
      suppressNextClickRef.current = true;
      const element = document.elementFromPoint?.(upEvent.clientX, upEvent.clientY);
      const slot = element?.closest?.('[data-slot-index]');
      cleanup();
      if (slot) {
        const destination = Number(slot.dataset.slotIndex);
        const currentSlots = slotsRef.current;
        const sourceStillOwned = JSON.stringify(currentSlots[sourceIndex]) === sourceSnapshot;
        if (sourceStillOwned && Number.isInteger(destination) && destination !== sourceIndex) onChangeSlots(moveInventoryStack(currentSlots, sourceIndex, destination, layout));
      }
    };
    const cancel = cancelEvent => { if (cancelEvent.pointerId === pointerId) { tapCandidateRef.current = null; suppressNextClickRef.current = true; cleanup(); } };
    // `touch-action: pan-y` keeps native scrolling available while the hold is
    // pending. Once picked up, this non-passive listener claims subsequent
    // touch movement before Chromium/WebView can turn it into a native pan.
    const suppressNativePan = touchEvent => {
      if (dragActive) touchEvent.preventDefault();
    };
    const activateDrag = () => {
      holdTimer = null;
      if (scrollGesture || pointerCleanupRef.current !== cleanup) return;
      dragActive = true;
      suppressNextClickRef.current = true;
      tapCandidateRef.current = null;
      const inside = getEdgeZonePresence(currentY);
      edgeZoneArmedRef.current = { top: !inside.top, bottom: !inside.bottom };
      setEdgeArmingVersion(version => version + 1);
      setDragIndex(sourceIndex);
      setDragPoint({ x: currentX, y: currentY });
      updateScrollBounds();
    };
    pointerCleanupRef.current = cleanup;
    sourceElement.setPointerCapture?.(pointerId);
    sourceElement.addEventListener?.('lostpointercapture', cancel);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd, { passive: false });
    window.addEventListener('pointercancel', cancel);
    if (usesHold) {
      window.addEventListener('touchmove', suppressNativePan, { passive: false });
      holdTimer = setTimeout(activateDrag, TOUCH_DRAG_HOLD_MS);
    }
  };
  const applyPlayerResult = result => {
    if (!result?.success) { setActionError(result); return; }
    setActionError(null);
    onChangePlayer?.(result.player);
    setDetailsIndex(null);
    setEquipmentDetails(null);
    setActionError(null);
  };
  const selectView = view => {
    setDetailsIndex(null);
    setEquipmentDetails(null);
    setActiveView(view);
  };
  const combatStats = [
    ['HP', `${player?.hp ?? player?.maxHp ?? 0} / ${player?.maxHp ?? player?.hp ?? 0}`],
    ['Скорость', player?.speed ?? player?.baseStats?.speed ?? 0],
    ['Маг. атака', player?.magAtk ?? 0],
    ['Физ. атака', player?.attack ?? player?.baseAtk ?? 0],
    ['Маг. защита', player?.magicDef ?? 0, 'magicDef'],
    ['Физ. защита', player?.physDef ?? 0, 'physDef'],
  ];
  const secondaryCombatStats = [
    ['Уворот', formatItemStatValue('dodge', player?.dodge ?? player?.baseStats?.dodge ?? 0)],
    ['Крит. шанс', formatItemStatValue('critChance', player?.critChance ?? player?.baseStats?.critChance ?? 0)],
    ['Крит. урон', formatItemStatValue('critDamage', 1 + (player?.critDamage ?? player?.baseStats?.critDamage ?? 0.5))],
  ];
  const playerPortrait = resolvePlayerPortrait(player);
  const renderInventorySlot = index => {
    const stack = slots[index];
    const { definition: def, art: itemArt, canonicalName } = getInventoryItemPresentation(stack);
    const isDiscardSelected = Object.prototype.hasOwnProperty.call(discardSelection, index);
    return <button key={index} type="button" aria-label={stack ? canonicalName : `Пустая ячейка ${index + 1}`} aria-pressed={discardMode && stack ? isDiscardSelected : undefined} data-slot-index={index} className={`inventory-cell${isSafeSlotIndex(index) ? ' is-safe' : ''}${stack ? ' has-item' : ''}${dragIndex === index ? ' is-dragging' : ''}${isDiscardSelected ? ' is-discard-selected' : ''}`} onPointerDown={event => stack && beginPointerInteraction(event, index)} onClick={event => {
      if (discardMode) { if (stack) setDiscardSelection(current => { const next = { ...current }; if (next[index]) delete next[index]; else next[index] = JSON.stringify(stack); return next; }); return; }
      if (suppressNextClickRef.current) { suppressNextClickRef.current = false; tapCandidateRef.current = null; return; }
      const isKeyboardActivation = event.detail === 0;
      if (stack && (isKeyboardActivation || tapCandidateRef.current === index)) setDetailsIndex(index);
      tapCandidateRef.current = null;
    }}>
      {isSafeSlotIndex(index) && <span className="safe-slot-mark" aria-label="Защищённая ячейка">🔒</span>}
      {stack ? <>{itemArt ? <img className="inventory-item-art gameplay-drag-art" src={itemArt} alt="" aria-hidden="true" draggable={false} onDragStart={event => event.preventDefault()} onError={hideMissingItemArt} /> : <span className={`inventory-item rarity-${def?.rarity || 'unknown'}`}>{canonicalName}</span>}{stack.quantity > 1 && <b className="inventory-count item-icon-quantity">{stack.quantity}</b>}</> : <span className="inventory-empty" aria-label={`Пустая ячейка ${index + 1}`}/>}
    </button>;
  };
  const draggedStack = dragIndex === null ? null : slots[dragIndex];
  const draggedPresentation = getInventoryItemPresentation(draggedStack);
  const getRuneTargets = runeId => {
    const rune = getRuneById(runeId);
    if (!rune) return [];
    const targets = [];
    Object.entries(player?.equipment || {}).forEach(([slot, rawItem]) => {
      const item = normalizeSocketEquipmentInstance(rawItem, slot);
      if (item && canSocketRune(rune.id, item, slot)) targets.push({ location: 'equipped', equipped: true, slot, item });
    });
    slots.forEach((item, index) => {
      if (!item?.instanceId || item.socketedRuneId) return;
      const slot = rune.allowedEquipmentSlots.find(candidate => equipmentSupportsRuneSocket(item, candidate));
      if (slot) targets.push({ location: 'inventory', equipped: false, slot, index, item });
    });
    return targets;
  };
  const commitRuneSocket = (runeId, target) => {
    if (context.inCombat) { const reason = 'Руны нельзя вставлять во время боя.'; setActionError({ reason }); return { success: false, reason }; }
    const authoritativeTarget = target.location === 'equipped' ? player?.equipment?.[target.slot] : slots[target.index];
    const result = target.location === 'equipped'
      ? socketRuneIntoEquippedItem({ equipment: player.equipment, equipmentSlot: target.slot, expectedItemId: getEquipmentInstanceItemId(target.item), runeId, sourceEntries: slots, inCombat: context.inCombat, preserveSourceSlots: true })
      : authoritativeTarget && getEquipmentInstanceItemId(authoritativeTarget) === getEquipmentInstanceItemId(target.item)
        ? socketRuneIntoEquipment({ equipment: { [target.slot]: authoritativeTarget }, equipmentSlot: target.slot, runeId, sourceEntries: slots, inCombat: context.inCombat, preserveSourceSlots: true })
        : { success: false, reason: 'target-not-found' };
    if (!result.success) {
      const reason = result.reason === 'target-not-found' ? 'Не удалось найти выбранное снаряжение.' : target.item?.socketedRuneId ? 'Предмет уже содержит руну.' : result.reason === 'incompatible' ? 'Руна несовместима с этим предметом.' : result.reason === 'combat' ? 'Руны нельзя вставлять во время боя.' : 'Не удалось вставить руну.';
      setActionError({ reason }); return { success: false, reason };
    }
    const nextSlots = result.sourceEntries.map(entry => entry ? { ...entry } : null);
    const nextEquipment = target.location === 'equipped' ? result.equipment : player.equipment;
    if (target.location === 'inventory') nextSlots[target.index] = result.equipment[target.slot];
    onChangePlayer?.({ ...player, equipment: nextEquipment, runInventory: nextSlots });
    if (target.location === 'equipped') setEquipmentDetails(previous => previous?.item?.instanceId === target.item.instanceId ? { ...previous, item: result.equipment[target.slot] } : previous);
    setRuneSelection(null); setRuneTargetSelection(null); setActionError(null);
    return { success: true };
  };
  const getRunRuneAction = (item, equippedSlot = null) => {
    const rune = getRuneById(item?.itemId);
    if (rune) {
      const targets = getRuneTargets(rune.id);
      return { label: 'Вставить', available: !context.inCombat && targets.length > 0, reason: context.inCombat ? 'Руны нельзя вставлять во время боя.' : targets.length ? null : 'Нет подходящего снаряжения', onClick: () => setRuneTargetSelection({ runeId: rune.id, targets }) };
    }
    const candidateSlots = equippedSlot ? [equippedSlot] : ['mainHand', 'armor', 'amulet'];
    const slot = candidateSlots.find(candidate => equipmentSupportsRuneSocket(item, candidate));
    if (!slot || item?.socketedRuneId) return null;
    const compatible = getCompatibleRuneEntries(slots.filter(Boolean), item, slot);
    return { label: 'Вставить руну', available: !context.inCombat && compatible.length > 0, reason: context.inCombat ? 'Руны нельзя вставлять во время боя.' : compatible.length ? null : 'Нет подходящих рун', onClick: () => setRuneSelection({ target: { location: equippedSlot ? 'equipped' : 'inventory', equipped: Boolean(equippedSlot), slot, index: equippedSlot ? null : detailsIndex, item }, compatible }) };
  };
  return <div className="inventory-grid-overlay" role="dialog" aria-modal="true" aria-label="Инвентарь экспедиции">
    <section ref={panelRef} className={`inventory-grid-panel${dragIndex !== null ? ' is-dragging' : ''}`} onScroll={updateScrollBounds}>
      <header ref={headerRef} className="inventory-grid-header">
        <div className="inventory-grid-heading">
          <h2>{activeView === 'inventory' ? 'Рюкзак' : 'Экипировка'}</h2>
          {activeView === 'inventory' && <>
            <p className={`inventory-capacity${freeSlotCount === 0 ? ' is-full' : ''}`}>
              {occupiedSlotCount} / {layout.totalCapacity}{freeSlotCount === 0 ? ' · Заполнено' : ''}
            </p>
            <div className="inventory-run-economy"><span>Резонанс Бездны: {player?.runResonance || 0}</span><span>Серебро за поход: {player?.runSilver || 0}</span></div>
            {lootContext && <p className="inventory-loot-count">Добыча: выбрано {lootContext.selected}/{lootContext.total}</p>}
          </>}
        </div>
        <div className="inventory-header-actions">
          {activeView === 'inventory' && <button className="inventory-icon-button" type="button" disabled={discardMode} aria-label="Сортировать инвентарь" title="Сортировать инвентарь" onClick={() => onChangeSlots(sortOrdinaryInventory(slots, layout))}>⇅</button>}
          {activeView === 'inventory' && <button className={`inventory-icon-button${discardMode ? ' is-danger' : ''}`} type="button" aria-label={discardMode ? `Подтвердить выброс: ${Object.keys(discardSelection).length}` : 'Выбросить предметы'} title="Выбросить" onClick={() => discardMode ? Object.keys(discardSelection).length && setDiscardConfirm(true) : setDiscardMode(true)}>🗑{discardMode && ` ${Object.keys(discardSelection).length}`}</button>}
          {discardMode && <button className="inventory-icon-button" type="button" aria-label="Отменить выбор" onClick={() => { setDiscardMode(false); setDiscardSelection({}); }}>↩</button>}
          <button className="inventory-icon-button" type="button" aria-label="Закрыть инвентарь" title={lootContext ? 'Вернуться к добыче' : 'Закрыть инвентарь'} onClick={onClose}>×</button>
        </div>
      </header>
      <div className="inventory-view-tabs" role="tablist" aria-label="Разделы управления забегом">
        <button type="button" role="tab" aria-selected={activeView === 'inventory'} onClick={() => selectView('inventory')}>Предметы</button>
        <button type="button" role="tab" aria-selected={activeView === 'equipment'} onClick={() => selectView('equipment')}>Экипировка</button>
      </div>
      {activeView === 'inventory' ? <div className="inventory-view" role="tabpanel">
      <p className="inventory-safe-note">Предметы в первых {SAFE_SLOT_COUNT} ячейках сохраняются после смерти.</p>
      {layout.sections.map(section => <section className={`inventory-slot-section inventory-slot-section--${section.type}`} key={section.type}>
        <h3>{({ safe: 'Безопасные', general: 'Обычные', consumable: 'Расходные', resource: 'Ресурсные' })[section.type]} <span>{section.indices.filter(index => slots[index]).length}/{section.capacity}</span></h3>
        <div className="inventory-grid" aria-label={({ safe: 'Безопасные', general: 'Обычные', consumable: 'Расходные', resource: 'Ресурсные' })[section.type]}>{section.indices.map(renderInventorySlot)}</div>
      </section>)}
      {overflowIndices.length > 0 && <section className="inventory-slot-section inventory-slot-section--overflow"><h3>Переполнение <span>{overflowIndices.length}</span></h3><p className="inventory-overflow-warning">Переместите или выбросьте эти предметы перед изменением вместимости.</p><div className="inventory-grid" aria-label="Переполнение">{overflowIndices.map(renderInventorySlot)}</div></section>}
      </div> : <div className="inventory-equipment-view" role="tabpanel">
      <section className="inventory-equipment-section" aria-labelledby="inventory-equipment-heading">
        <h3 id="inventory-equipment-heading">Снаряжение</h3>
        <div className="equipment-paper-doll">
          <div className="equipment-paper-doll__figure" aria-hidden="true">
            {playerPortrait ? <img src={playerPortrait} alt="" /> : <span className="equipment-paper-doll__silhouette" />}
          </div>
          {EQUIPMENT_SLOT_KEYS.map(key => {
            const item = player?.equipment?.[key];
            const itemName = getEquipmentInstanceItemId(item);
            const itemArt = resolveItemArt(findItemData(itemName) || itemName);
            const label = EQUIPMENT_SLOT_LABELS[key];
            const visualLabel = PAPER_DOLL_SLOT_LABELS[key] || label;
            return itemName
              ? <button className="equipment-paper-slot is-occupied" data-equipment-slot={key} key={key} type="button" aria-label={`${label}: ${itemName}`} onClick={() => setEquipmentDetails({ item: item || itemName, slot: key })}>{itemArt && <img className="equipment-item-art" src={itemArt} alt="" aria-hidden="true" onError={hideMissingItemArt} />}<span>{visualLabel}</span><small>Надето</small></button>
              : <div className="equipment-paper-slot is-empty" data-equipment-slot={key} key={key} aria-label={`${label}: пусто`}><span>{visualLabel}</span><small>Пусто</small></div>;
          })}
        </div>
        {player?.fishingTool && <div className="equipment-tool-row"><button className="equipment-paper-slot is-occupied" type="button" aria-label={`Удочка: ${player.fishingTool}`} onClick={() => setEquipmentDetails({ itemName: player.fishingTool, slot: 'fishingTool' })}>{resolveItemArt(findItemData(player.fishingTool) || player.fishingTool) && <img className="equipment-item-art" src={resolveItemArt(findItemData(player.fishingTool) || player.fishingTool)} alt="" aria-hidden="true" onError={hideMissingItemArt} />}<span>Удочка</span><small>Надето</small></button></div>}
      </section>
      <section className="inventory-stats" aria-labelledby="inventory-stats-heading">
        <h3 id="inventory-stats-heading">Боевые характеристики</h3>
        <dl>{combatStats.map(([label, value, statKey]) => <div key={label}><dt>{label}{statKey && <DefenseInfoButton statKey={statKey} value={value} />}</dt><dd>{value}</dd></div>)}</dl>
        <dl className="inventory-stats__secondary">{secondaryCombatStats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section>
      </div>}
      {draggedStack && dragPoint && <div className={`inventory-drag-ghost${draggedPresentation.art ? ' has-art' : ''}`} style={{ left: dragPoint.x, top: dragPoint.y }}>
        <span className="inventory-drag-fallback" aria-hidden={draggedPresentation.art ? 'true' : undefined}>{draggedPresentation.canonicalName}</span>
        {draggedPresentation.art && <img className="inventory-drag-art gameplay-drag-art" src={draggedPresentation.art} alt="" aria-hidden="true" draggable={false} onDragStart={event => event.preventDefault()} onError={event => {
          hideMissingItemArt(event);
          event.currentTarget.parentElement?.classList.remove('has-art');
          event.currentTarget.previousElementSibling?.removeAttribute('aria-hidden');
        }} />}
        {draggedStack.quantity > 1 && <b className="inventory-drag-count">×{draggedStack.quantity}</b>}
      </div>}
      {dragIndex !== null && edgeZoneArmedRef.current.top && scrollBounds.canScrollUp && <div className="inventory-edge-scroll-zone inventory-edge-scroll-zone--top" style={{ top: scrollBounds.top, left: scrollBounds.left, width: scrollBounds.width }} aria-hidden="true"><span>⌃</span></div>}
      {dragIndex !== null && edgeZoneArmedRef.current.bottom && scrollBounds.canScrollDown && <div className="inventory-edge-scroll-zone inventory-edge-scroll-zone--bottom" style={{ top: scrollBounds.bottom - EDGE_SCROLL_ZONE_HEIGHT, left: scrollBounds.left, width: scrollBounds.width }} aria-hidden="true"><span>⌄</span></div>}
    </section>
    {detailsIndex !== null && slots[detailsIndex] && <ItemDetailsModal item={slots[detailsIndex]} player={player} context={context} equipmentAction={getInventoryEquipmentAction(player, detailsIndex, context)} runeAction={getRunRuneAction(slots[detailsIndex])} actionError={actionError} onEquip={() => { const result = equipRunInventoryItem(player, detailsIndex, context); if (result.requiresSlotChoice) setEquipSlotChoice({ index: detailsIndex, slots: result.candidateSlots }); else applyPlayerResult(result); }} onUse={() => { onUseItem?.(detailsIndex); setDetailsIndex(null); }} onDrop={() => { const index = detailsIndex; setDetailsIndex(null); requestDiscard(index); }} onClose={() => { setDetailsIndex(null); setActionError(null); }} />}
    {equipmentDetails && <ItemDetailsModal item={equipmentDetails.item} player={player} context={context} unequipAction={{ available: !context.inCombat, reason: context.inCombat ? 'Снаряжение нельзя менять во время боя' : null }} runeAction={getRunRuneAction(equipmentDetails.item, equipmentDetails.slot)} actionError={actionError} onUnequip={() => applyPlayerResult(unequipRunEquipment(player, equipmentDetails.slot, context))} onClose={() => { setEquipmentDetails(null); setActionError(null); }} />}
    {runeTargetSelection && <RuneTargetSelectionOverlay targets={runeTargetSelection.targets} onClose={() => setRuneTargetSelection(null)} onSelect={target => commitRuneSocket(runeTargetSelection.runeId, target)} />}
    {runeSelection && <RuneSelectionOverlay entries={runeSelection.compatible} emptyMessage="Нет подходящих рун в инвентаре." onClose={() => setRuneSelection(null)} onSelect={entry => commitRuneSocket(entry.itemId, runeSelection.target)} />}
    {equipSlotChoice && <EquipmentSlotChoiceDialog candidates={equipSlotChoice.slots} equipment={player?.equipment} player={player} onSelect={slot => { applyPlayerResult(equipRunInventoryItem(player, equipSlotChoice.index, context, slot)); setEquipSlotChoice(null); }} onCancel={() => setEquipSlotChoice(null)} />}
    {discardConfirm && <div className="inventory-confirm" role="alertdialog"><p>Выбросить выбранные предметы целиком ({Object.keys(discardSelection).length})?</p><button className="ui-action--danger" type="button" onClick={() => { const currentSlots = slotsRef.current; const valid = Object.entries(discardSelection).every(([index, snapshot]) => JSON.stringify(currentSlots[Number(index)]) === snapshot); if (valid) { let next = currentSlots; Object.keys(discardSelection).map(Number).forEach(index => { next = discardInventoryStack(next, index, layout); }); onChangeSlots(next); } setDiscardConfirm(false); setDiscardMode(false); setDiscardSelection({}); }}>Выбросить</button><button className="ui-action--secondary" type="button" onClick={() => setDiscardConfirm(false)}>Отмена</button></div>}
  </div>;
};
export default InventoryGridModal;
