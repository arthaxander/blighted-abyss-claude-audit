import FieldLoadoutPanel from './FieldLoadoutPanel';
import CraftRecipeRow from './CraftRecipeRow';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { equipmentByName } from '../data/equipment';
import { getCraftingRecipes, findItemData, normalizeItemName } from '../data/items';
import {
  DEFAULT_RELIC_ID,
  describeRelicLevel,
  ensureRelicState,
  getNextRelicDescription,
  getRelicBonuses,
  getRelicDefinitions,
} from '../data/relics';
import {
  getRuneRecipes,
  getRuneById,
} from '../data/runes';
import { getVendorCatalog, getVendorPurchaseStatus } from '../data/vendors';
import { describeQuestReward, getQuestDefinitions, QUEST_EVENTS } from '../data/quests';
import { normalizeEquipmentSlots } from '../utils/equipmentManager';
import { GUILD_STASH_CAPACITY } from '../constants/gameplay';
import { useConfirm, useToast } from '../contexts/UIContext';
import { resolvePlayerPortrait } from '../data/combatAssets';
import { canCraftFromStorage, countStorageItems, craftFromStorage, getMaxCraftableFromStorage } from '../utils/storageCrafting';
import { resolveItemArt, hideMissingItemArt } from '../data/itemArt';
import ItemDetailsModal from './ItemDetailsModal';
import { STORAGE_FILTERS, STORAGE_SORTS, discardStorageEntry, getCanonicalSellPrice, getStorageOccupancy, isItemDiscardable, isItemSellable, isStackableStorageItem, normalizeStorage, presentStorage, sellStorageSelection } from '../utils/storageManagement';
import { getRunInventoryAcceptance, getRunInventoryLayout, moveInventoryStack } from '../utils/expeditionInventory';
import RuneSelectionOverlay from './RuneSelectionOverlay';
import RuneTargetSelectionOverlay from './RuneTargetSelectionOverlay';
import { canSocketRune, extractRuneToStorage, getCompatibleRuneEntries, normalizeSocketEquipmentInstance, socketRuneIntoEquipment } from '../utils/runeSockets';
import {
  CLASS_PROGRESSION_DEFINITIONS, ensureClassProgression,
} from '../data/classProgression';
import ClassProgressionPanel from './ClassProgressionPanel';
import EquipmentSlotChoiceDialog from './EquipmentSlotChoiceDialog';
import GuildPrimaryNav from './guild/GuildPrimaryNav';
import { GUILD_SCREEN_TITLES } from './guild/guildNavigation';
import GuildHall from './guild/GuildHall';
import './guild/GuildShell.css';
import { equipRunInventoryItem, migrateRunInventory, unequipRunEquipment } from '../utils/expeditionInventory';
import { DEVELOPER_PLAYABLE_CLASSES } from '../utils/developerClassSwitch';
import { addGuildSilver, getGuildSilver } from '../utils/guildCurrency';
import { GuildCategoryTabs, GuildItemCell, GuildItemGrid } from './guild/GuildItemBrowser';
import { CharacterStatsGrid, EquipmentPaperDoll } from './EquipmentPresentation';
import { GAMEPLAY_DRAG_ACTIVATION_DISTANCE, TOUCH_DRAG_HOLD_MS, TOUCH_DRAG_MOVE_TOLERANCE } from '../constants/interaction';
import { playSfx } from '../audio/sfxController';

const GUILD_DRAG_EDGE_ZONE = 64;
const GUILD_DRAG_MIN_SCROLL_SPEED = 3;
const GUILD_DRAG_MAX_SCROLL_SPEED = 12;

const CLASS_DISPLAY_NAMES = {
  Warrior: 'Защитник',
  Defender: 'Защитник',
  Mage: 'Элементалист',
  Archer: 'Лучник',
};

const GuildScreen = ({
  player,
  onUpdatePlayer,
  onUpdateRelics,
  onQuestEvent,
  onClaimQuestReward,
  onPurchaseVendorItem,
  vendorPurchaseState,
  getServerNow,
  storageItems = [],
  onDepositItem,
  onWithdrawItem,
  onEquipStorageItem,
  onSellStorage,
  onUpdateStorage,
  onUnloadAllToStorage,
  onUnloadBackpackExceptKept,
  classProgression,
  onUpdateClassProgression,
  onStartRun,
  onChangeClass,
}) => {
  const [activeTab, setActiveTab] = useState('hall');
  const [backpackSelectionMode, setBackpackSelectionMode] = useState(false);
  const [keptBackpackSlots, setKeptBackpackSlots] = useState(() => new Set());
  const [characterMode, setCharacterMode] = useState('character');
  const [questMode, setQuestMode] = useState('guild');
  const [classMode, setClassMode] = useState('active');
  const [craftCategory, setCraftCategory] = useState('all');
  const [craftDetails, setCraftDetails] = useState(null);
  const [craftInspectItem, setCraftInspectItem] = useState(null);
  const [craftQuantity, setCraftQuantity] = useState('1');
  const [craftFeedback, setCraftFeedback] = useState(null);
  const craftingLockedRef = useRef(false);
  const [backpackDetails, setBackpackDetails] = useState(null);
  const [backpackDragIndex, setBackpackDragIndex] = useState(null);
  const [backpackDragPoint, setBackpackDragPoint] = useState(null);
  const guildViewportRef = useRef(null);
  const backpackPointerCleanupRef = useRef(null);
  const backpackSuppressClickRef = useRef(false);
  const backpackTapCandidateRef = useRef(null);
  const backpackSlotsRef = useRef([]);
  const backpackAutoScrollFrameRef = useRef(null);
  const backpackAutoScrollRef = useRef({ direction: 0, speed: 0 });
  const [vendorId, setVendorId] = useState(null);
  const [vendorDetails, setVendorDetails] = useState(null);
  const [, setVendorClockTick] = useState(0);
  const [characterDetails, setCharacterDetails] = useState(null);
  const [inspectedRelicId, setInspectedRelicId] = useState(null);
  const [storageFilter, setStorageFilter] = useState('all');
  const [storageSort, setStorageSort] = useState('type');
  const [storageSelectionMode, setStorageSelectionMode] = useState(false);
  const [selectedStorageIds, setSelectedStorageIds] = useState(() => new Set());
  const [storageDetails, setStorageDetails] = useState(null);
  const [confirmBulkSale, setConfirmBulkSale] = useState(false);
  const [runeSelection, setRuneSelection] = useState(null);
  const [runeTargetSelection, setRuneTargetSelection] = useState(null);
  const [equipSlotChoice, setEquipSlotChoice] = useState(null);
  const { pushToast } = useToast();
  const confirm = useConfirm();
  const progressionState = ensureClassProgression(classProgression || player.classProgression, player);
  const classDefinition = CLASS_PROGRESSION_DEFINITIONS[player.class];
  const itemRecipes = useMemo(() => getCraftingRecipes().map(recipe => ({ ...recipe, type: findItemData(recipe.name)?.type })), []);
  const silver = getGuildSilver(player);
  const vendors = useMemo(() => getVendorCatalog(), []);
  const selectedVendor = vendors.find(vendor => vendor.id === vendorId) || vendors[0];
  const vendorNowMs = getServerNow?.() ?? Date.now();
  const vendorDetailPurchaseStatus = vendorDetails ? getVendorPurchaseStatus(vendorDetails, vendorPurchaseState, vendorNowMs) : null;
  const runeRecipes = useMemo(() => getRuneRecipes(), []);
  const recipes = useMemo(() => [
    ...itemRecipes,
    ...runeRecipes.map(rune => ({ name: rune.name, ingredients: rune.craft, type: 'rune', runeId: rune.id, description: rune.effectDescription })),
  ], [itemRecipes, runeRecipes]);
  const storageCounts = useMemo(() => countStorageItems(storageItems), [storageItems]);
  const visibleRecipes = useMemo(() => recipes
    .filter(recipe => craftCategory === 'all' || recipe.type === craftCategory)
    .sort((a, b) => Number(canCraftFromStorage(storageItems, b)) - Number(canCraftFromStorage(storageItems, a)) || a.name.localeCompare(b.name, 'ru')),
  [recipes, craftCategory, storageItems]);
  const questDefinitions = useMemo(() => getQuestDefinitions(), []);
  const questLog = player.questLog || {};
  const equipmentSlots = useMemo(() => normalizeEquipmentSlots(player.equipment), [player.equipment]);
  const relicsState = ensureRelicState(player.relics);
  const relicDefinitions = useMemo(() => getRelicDefinitions(), []);
  const discoveredRelicDefinitions = useMemo(
    () => relicDefinitions.filter(definition => relicsState.discoveredRelicIds.includes(definition.id)),
    [relicDefinitions, relicsState.discoveredRelicIds]
  );
  const activeRelicId = relicsState.activeRelicId || DEFAULT_RELIC_ID;
  const effectiveInspectedRelicId = discoveredRelicDefinitions.some(def => def.id === inspectedRelicId) ? inspectedRelicId : (discoveredRelicDefinitions.find(def => def.id === activeRelicId)?.id || discoveredRelicDefinitions[0]?.id);
  const activeRelicProgress = relicsState.progress?.[activeRelicId] || { level: 0, xp: 0 };
  const activeRelicBonuses = useMemo(
    () => getRelicBonuses(activeRelicId, activeRelicProgress.level || 0),
    [activeRelicId, activeRelicProgress.level]
  );
  const relicBonusDescriptions = useMemo(() => {
    const entries = [];
    const formatPercent = (value) => `${Math.round(value * 100)}%`;
    if (!activeRelicBonuses) return entries;
    const { startTurnMeter, consumableTurnMeter, firstConsumableTurnMeter, preserveConsumableChance, insuranceChance, extraLootChance } = activeRelicBonuses;
    if (startTurnMeter) entries.push(`В начале боя: +${formatPercent(startTurnMeter)} шкалы хода`);
    if (consumableTurnMeter) entries.push(`Успешный расходник в бою: +${formatPercent(consumableTurnMeter)} шкалы хода`);
    if (firstConsumableTurnMeter) entries.push(`Первый расходник боя: ещё +${formatPercent(firstConsumableTurnMeter)} шкалы хода`);
    if (preserveConsumableChance) entries.push(`${formatPercent(preserveConsumableChance)} шанс не потратить расходник`);
    if (insuranceChance) entries.push(`Гильдейская страховка: ${formatPercent(insuranceChance)} шанс сохранить предмет при смерти`);
    if (extraLootChance) entries.push(`${formatPercent(extraLootChance)} шанс дополнительной обычной добычи`);
    return entries;
  }, [activeRelicBonuses]);

  const handleDeposit = item => {
    const result = onDepositItem ? onDepositItem(item) : false;
    if (result !== false) playSfx('itemToStorage');
    return result;
  };

  const handleRelicSelect = (relicId) => {
    const update = relicState => ({
      ...relicState,
      activeRelicId: relicId,
      discoveredRelicIds: [...new Set([...relicState.discoveredRelicIds, relicId])],
      progress: {
        ...relicState.progress,
        [relicId]: relicState.progress?.[relicId] || { level: 0, xp: 0 },
      },
    });
    onUpdateRelics?.(update);
  };

  const canCraft = recipe => canCraftFromStorage(storageItems, recipe);

  const finishCraftFeedback = (recipe, quantity) => {
    setCraftDetails(null); setCraftQuantity('1'); setCraftFeedback({ recipe, quantity });
    window.setTimeout(() => { setCraftFeedback(null); craftingLockedRef.current = false; }, 800);
  };

  const handleCraft = (recipe, requestedQuantity = 1) => {
    if (!recipe || craftingLockedRef.current) return false;
    const quantity = Math.floor(Number(requestedQuantity));
    if (!Number.isFinite(quantity) || quantity < 1 || !canCraftFromStorage(storageItems, recipe, quantity)) {
      pushToast('Недостаточно материалов', { tone: 'warning' });
      return false;
    }
    craftingLockedRef.current = true;
    const transaction = craftFromStorage(storageItems, { ...recipe, result: { name: recipe.runeId || recipe.name, quantity: 1 } }, quantity);
    if (!transaction.success) { craftingLockedRef.current = false; pushToast(transaction.reason === 'capacity' ? 'В Хранилище нет места' : 'Недостаточно материалов', { tone: 'warning' }); return false; }
    onUpdateStorage?.(transaction.storage);
    playSfx('craftSuccess');

    if (onQuestEvent) {
      onQuestEvent(
        [{ type: QUEST_EVENTS.CRAFT, item: recipe.name }],
        {}
      );
    }
    finishCraftFeedback(recipe, quantity);
    return true;
  };

  const handleEquip = (sourceIndex, preferredSlot = null) => {
    const result = equipRunInventoryItem(player, sourceIndex, {}, preferredSlot);
    if (result.requiresSlotChoice) {
      setEquipSlotChoice({ source: 'backpack', sourceIndex, slots: result.candidateSlots });
      return;
    }
    if (!result.success) { pushToast(result.reason, { tone: 'warning' }); return; }
    onUpdatePlayer?.(result.player);
    playSfx('itemEquip');
  };

  const handleUnequip = equipmentSlot => {
    const result = unequipRunEquipment(player, equipmentSlot);
    if (!result.success) { pushToast(result.reason, { tone: 'warning' }); return; }
    onUpdatePlayer?.(result.player);
    playSfx('itemUnequip');
  };

  const handlePurchase = (item) => {
    onPurchaseVendorItem?.(item);
  };



  const canonicalRunInventory = useMemo(() => migrateRunInventory(player.runInventory, player.equipment, player.runInventoryLayoutVersion), [player.runInventory, player.equipment, player.runInventoryLayoutVersion]);
  backpackSlotsRef.current = canonicalRunInventory;

  const stopBackpackAutoScroll = () => {
    backpackAutoScrollRef.current = { direction: 0, speed: 0 };
    if (backpackAutoScrollFrameRef.current !== null) cancelAnimationFrame(backpackAutoScrollFrameRef.current);
    backpackAutoScrollFrameRef.current = null;
  };
  useEffect(() => () => {
    backpackPointerCleanupRef.current?.();
    stopBackpackAutoScroll();
  }, []);
  useEffect(() => {
    if (activeTab !== 'vendors') return undefined;
    const timer = setInterval(() => setVendorClockTick(value => value + 1), 30000);
    return () => clearInterval(timer);
  }, [activeTab]);
  useEffect(() => {
    if (backpackSelectionMode || activeTab !== 'backpack') backpackPointerCleanupRef.current?.();
  }, [activeTab, backpackSelectionMode]);

  const beginBackpackPointerInteraction = (event, sourceIndex) => {
    if (backpackSelectionMode || (event.button !== undefined && event.button !== 0) || !backpackSlotsRef.current[sourceIndex]) return;
    backpackPointerCleanupRef.current?.();
    backpackSuppressClickRef.current = false;
    backpackTapCandidateRef.current = null;
    const pointerId = event.pointerId;
    const sourceElement = event.currentTarget;
    const sourceSnapshot = JSON.stringify(backpackSlotsRef.current[sourceIndex]);
    const startX = event.clientX;
    const startY = event.clientY;
    const usesHold = event.pointerType === 'touch';
    let currentX = startX;
    let currentY = startY;
    let dragActive = false;
    let scrollGesture = false;
    let holdTimer = null;
    const runAutoScroll = () => {
      backpackAutoScrollFrameRef.current = null;
      const viewport = guildViewportRef.current;
      const { direction, speed } = backpackAutoScrollRef.current;
      if (!dragActive || !viewport || !direction) return;
      const previous = viewport.scrollTop;
      viewport.scrollTop += direction * speed;
      if (viewport.scrollTop !== previous) backpackAutoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
      else stopBackpackAutoScroll();
    };
    const updateAutoScroll = clientY => {
      const viewport = guildViewportRef.current;
      if (!dragActive || !viewport) return stopBackpackAutoScroll();
      const rect = viewport.getBoundingClientRect();
      let direction = 0;
      let depth = 0;
      if (clientY >= rect.top && clientY < rect.top + GUILD_DRAG_EDGE_ZONE && viewport.scrollTop > 0) {
        direction = -1; depth = (rect.top + GUILD_DRAG_EDGE_ZONE - clientY) / GUILD_DRAG_EDGE_ZONE;
      } else if (clientY <= rect.bottom && clientY > rect.bottom - GUILD_DRAG_EDGE_ZONE && viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight) {
        direction = 1; depth = (clientY - (rect.bottom - GUILD_DRAG_EDGE_ZONE)) / GUILD_DRAG_EDGE_ZONE;
      }
      if (!direction) return stopBackpackAutoScroll();
      backpackAutoScrollRef.current = { direction, speed: GUILD_DRAG_MIN_SCROLL_SPEED + (GUILD_DRAG_MAX_SCROLL_SPEED - GUILD_DRAG_MIN_SCROLL_SPEED) * Math.max(0, Math.min(1, depth)) };
      if (backpackAutoScrollFrameRef.current === null) backpackAutoScrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    };
    const cleanup = () => {
      if (holdTimer !== null) clearTimeout(holdTimer);
      stopBackpackAutoScroll();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', suppressNativePan);
      sourceElement.removeEventListener?.('lostpointercapture', cancel);
      if (sourceElement.hasPointerCapture?.(pointerId)) sourceElement.releasePointerCapture(pointerId);
      backpackPointerCleanupRef.current = null;
      setBackpackDragIndex(null);
      setBackpackDragPoint(null);
    };
    const activateDrag = () => {
      holdTimer = null;
      if (scrollGesture || backpackPointerCleanupRef.current !== cleanup) return;
      dragActive = true;
      backpackSuppressClickRef.current = true;
      backpackTapCandidateRef.current = null;
      setBackpackDragIndex(sourceIndex);
      setBackpackDragPoint({ x: currentX, y: currentY });
    };
    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      currentX = moveEvent.clientX; currentY = moveEvent.clientY;
      const distance = Math.hypot(currentX - startX, currentY - startY);
      if (usesHold && !dragActive && !scrollGesture && distance > TOUCH_DRAG_MOVE_TOLERANCE) {
        scrollGesture = true; backpackTapCandidateRef.current = null;
        if (holdTimer !== null) clearTimeout(holdTimer); holdTimer = null;
      } else if (!usesHold && !dragActive && distance >= GAMEPLAY_DRAG_ACTIVATION_DISTANCE) activateDrag();
      if (dragActive) {
        moveEvent.preventDefault();
        setBackpackDragPoint({ x: currentX, y: currentY });
        updateAutoScroll(currentY);
      }
    };
    const onEnd = upEvent => {
      if (upEvent.pointerId !== pointerId) return;
      if (!dragActive) {
        if (scrollGesture) backpackSuppressClickRef.current = true;
        else backpackTapCandidateRef.current = sourceIndex;
        cleanup(); return;
      }
      upEvent.preventDefault();
      backpackSuppressClickRef.current = true;
      const destinationElement = document.elementFromPoint?.(upEvent.clientX, upEvent.clientY)?.closest?.('[data-slot-index]');
      const destinationIndex = Number(destinationElement?.dataset.slotIndex);
      const currentSlots = backpackSlotsRef.current;
      const sourceStillOwned = JSON.stringify(currentSlots[sourceIndex]) === sourceSnapshot;
      cleanup();
      if (sourceStillOwned && Number.isInteger(destinationIndex) && destinationIndex !== sourceIndex) {
        const layout = getRunInventoryLayout(player.equipment);
        const nextSlots = moveInventoryStack(currentSlots, sourceIndex, destinationIndex, layout);
        if (JSON.stringify(nextSlots) !== JSON.stringify(currentSlots)) onUpdatePlayer?.({ ...player, runInventory: nextSlots });
      }
    };
    const cancel = cancelEvent => { if (cancelEvent.pointerId === pointerId) { backpackTapCandidateRef.current = null; backpackSuppressClickRef.current = true; cleanup(); } };
    const suppressNativePan = touchEvent => { if (dragActive) touchEvent.preventDefault(); };
    backpackPointerCleanupRef.current = cleanup;
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


  const unloadBackpackExceptKept = () => {
    const result = onUnloadBackpackExceptKept?.([...keptBackpackSlots]);
    if (result?.movedQuantity) playSfx('itemToStorage');
    setBackpackSelectionMode(false); setKeptBackpackSlots(new Set());
    if (result?.remainingQuantity) pushToast('Рюкзак выгружен частично', { description: `Перемещено: ${result.movedQuantity}. Не поместилось: ${result.remainingQuantity}.`, tone: 'info' });
  };

  const requestClassSwitch = async entry => {
    const accepted = await confirm({
      title: `Сменить класс на «${entry.label}»?`,
      description: 'Смена бесплатна и произойдёт сразу. Сумка останется экипированной, остальное снаряжение переместится в Хранилище.',
      confirmLabel: 'Сменить класс', cancelLabel: 'Отмена',
    });
    if (accepted) onChangeClass?.(entry.id);
  };

  const normalizedStorage = useMemo(() => normalizeStorage(storageItems), [storageItems]);
  const storageSummary = useMemo(() => presentStorage(normalizedStorage), [normalizedStorage]);
  const visibleStorage = useMemo(() => presentStorage(normalizedStorage, storageFilter, storageSort), [normalizedStorage, storageFilter, storageSort]);
  const selectedStorageRows = useMemo(() => presentStorage(normalizedStorage).filter(row => selectedStorageIds.has(row.id)), [normalizedStorage, selectedStorageIds]);
  useEffect(() => {
    const existing = new Set(presentStorage(normalizedStorage).map(row => row.id));
    setSelectedStorageIds(previous => new Set([...previous].filter(id => existing.has(id))));
  }, [normalizedStorage]);
  const selectedStorageValue = selectedStorageRows.reduce((sum, row) => sum + row.sellPrice * row.quantity, 0);
  const transactStorageSale = (ids, options) => {
    const transaction = onSellStorage ? onSellStorage(ids, options) : sellStorageSelection(normalizedStorage, ids, options);
    if (!transaction.success) { pushToast('Продажа не выполнена', { tone: 'warning' }); return false; }
    if (!onSellStorage) {
      onUpdateStorage?.(transaction.storage);
      onUpdatePlayer?.(prev => addGuildSilver(prev, transaction.silver));
    }
    pushToast(`Получено ${transaction.silver} серебра`);
    playSfx('currencyGain');
    return true;
  };
  const getStorageRuneAction = item => {
    const looseRune = getRuneById(item?.itemId);
    if (looseRune) {
      const targets = [];
      normalizedStorage.forEach(entry => {
        if (!entry?.instanceId || entry.socketedRuneId) return;
        const slot = looseRune.allowedEquipmentSlots.find(candidate => canSocketRune(looseRune.id, entry, candidate));
        if (slot) targets.push({ location: 'storage', slot, item: entry });
      });
      Object.entries(player?.equipment || {}).forEach(([slot, rawItem]) => {
        const target = normalizeSocketEquipmentInstance(rawItem, slot);
        if (target && canSocketRune(looseRune.id, target, slot)) targets.push({ location: 'equipped', equipped: true, slot, item: target });
      });
      return { label: 'Вставить', available: targets.length > 0, reason: targets.length ? null : 'Нет подходящего снаряжения.', onClick: () => setRuneTargetSelection({ runeId: looseRune.id, runeEntry: item, targets }) };
    }
    const def = equipmentByName[item?.name];
    const slot = def?.type === 'Weapon' ? 'mainHand' : def?.type === 'Armor' ? 'armor' : def?.type === 'Amulet' ? 'amulet' : null;
    if (!slot) return null;
    if (item.socketedRuneId) return { label: 'Извлечь руну', available: true, onClick: () => {
      const result = extractRuneToStorage({ equipment: { [slot]: item }, equipmentSlot: slot, storage: normalizedStorage, inGuild: true });
      if (!result.success) { pushToast('В хранилище нет места для руны', { tone: 'warning' }); return; }
      const updatedItem = result.equipment[slot];
      onUpdateStorage?.(result.storage.map(entry => entry.instanceId === item.instanceId ? updatedItem : entry));
      setStorageDetails({ ...item, socketedRuneId: null });
    } };
    const compatible = getCompatibleRuneEntries(normalizedStorage, item, slot);
    return { label: 'Вставить руну', available: compatible.length > 0, reason: compatible.length ? null : 'Нет подходящих рун', onClick: () => setRuneSelection({ item, slot, compatible }) };
  };



  const styles = {
    guildScreen: {
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
      maxWidth: '100%',
      boxSizing: 'border-box',
    },
    tabs: {
      marginBottom: '20px',
    },
    tabButton: {
      margin: '2px',
      padding: '9px 12px',
      fontSize: '14px',
      cursor: 'pointer',
      color: '#eee5ce',
      backgroundColor: '#17231c',
      border: '1px solid #75613d',
      borderRadius: '5px',
    },
    tabButtonActive: {
      backgroundColor: 'var(--guild-accent)',
      color: '#eef6f1',
      boxShadow: '0 0 0 1px var(--guild-accent-strong) inset, 0 0 10px var(--guild-accent-glow)',
    },
    tabButtonDisabled: {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    inventory: {
      border: '1px solid #675737',
      padding: '10px',
      marginTop: '10px',
      maxWidth: '600px',
      margin: '10px auto',
      borderRadius: '5px',
    },
    recipes: {
      marginTop: '10px',
      maxWidth: '600px',
      margin: '10px auto',
    },
    recipe: {
      border: '1px solid #675737',
      padding: '10px',
      margin: '6px 0',
      backgroundColor: 'rgba(20, 31, 24, .88)',
      borderRadius: '5px',
    },
    character: {
      border: '1px solid #675737',
      padding: '10px',
      marginTop: '10px',
      maxWidth: '600px',
      margin: '10px auto',
      borderRadius: '5px',
    },
    portrait: {
      width: '100px',
      height: '100px',
      margin: '10px auto',
      border: '2px solid #ccc',
      borderRadius: '5px',
    },
    relicCard: {
      border: '1px solid #555',
      padding: '16px',
      margin: '10px auto',
      maxWidth: '520px',
      borderRadius: '6px',
      backgroundColor: '#222',
      color: '#fff',
    },
    vendors: {
      marginTop: '10px',
      maxWidth: '720px',
      margin: '10px auto',
      textAlign: 'left',
    },
    vendorCard: {
      border: '1px solid #675737',
      borderRadius: '6px',
      padding: '12px',
      marginBottom: '16px',
      backgroundColor: 'rgba(20, 31, 24, .9)',
      color: '#eee5ce',
    },
    vendorItem: {
      borderTop: '1px solid #4c4936',
      padding: '8px 0',
    },
    runeSection: {
      border: '1px solid #555',
      borderRadius: '6px',
      padding: '16px',
      margin: '10px auto',
      maxWidth: '720px',
      backgroundColor: '#1f1f1f',
      color: '#fff',
    },
    runeSlotCard: {
      border: '1px solid #777',
      borderRadius: '6px',
      padding: '10px',
      margin: '10px 0',
    },
    runeCard: {
      border: '1px solid #888',
      borderRadius: '6px',
      padding: '12px',
      margin: '10px 0',
      backgroundColor: '#2a2a2a',
    },
    progressBar: {
      backgroundColor: '#444',
      borderRadius: '4px',
      overflow: 'hidden',
      height: '12px',
      marginTop: '8px',
    },
    progressFill: {
      backgroundColor: '#4caf50',
      height: '100%',
    },
    questSection: {
      margin: '10px auto',
      maxWidth: '720px',
      textAlign: 'left',
    },
    questCard: {
      border: '1px solid #555',
      borderRadius: '6px',
      padding: '12px',
      marginBottom: '12px',
      backgroundColor: '#1f1f1f',
      color: '#fff',
    },
    questStatus: {
      fontStyle: 'italic',
      color: '#bbb',
      marginTop: '8px',
    },
    tarotSection: {
      marginTop: '10px',
      border: '1px solid #555',
      borderRadius: '8px',
      padding: '16px',
      backgroundColor: '#1f1f1f',
      color: '#fff',
    },
    tarotActions: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '10px',
      justifyContent: 'center',
      marginBottom: '16px',
    },
    tarotGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: '12px',
    },
    tarotCard: {
      border: '1px solid #777',
      borderRadius: '6px',
      padding: '12px',
      backgroundColor: '#262626',
      textAlign: 'left',
    },
    tarotPolarity: {
      fontSize: '14px',
      fontStyle: 'italic',
      margin: '4px 0 8px',
    },
  };

  return (
    <div className={`guild-shell${activeTab === 'hall' ? ' is-hall' : ''}`} style={styles.guildScreen}>
      <header className="guild-fullscreen-title"><h1>{GUILD_SCREEN_TITLES[activeTab] || 'Гильдия'}</h1></header>
      <GuildPrimaryNav activeScreen={activeTab} onNavigate={setActiveTab} />
      <main ref={guildViewportRef} className={`guild-content-viewport${activeTab === 'hall' ? ' is-hall' : ' is-service'}`}>
      {activeTab === 'hall' && <GuildHall onOpenService={setActiveTab} onStartRun={onStartRun} />}
      {activeTab === 'fieldLoadout' && <div className="guild-content guild-loadout-page"><FieldLoadoutPanel player={player} onUpdatePlayer={onUpdatePlayer} standalone /></div>}
      {activeTab === 'class' && classDefinition && (
        <div><div className="guild-internal-tabs" role="tablist" aria-label="Раздел класса"><button role="tab" aria-selected={classMode === 'active'} onClick={() => setClassMode('active')}>Активные навыки</button><button role="tab" aria-selected={classMode === 'passive'} onClick={() => setClassMode('passive')}>Пассивные навыки</button><button role="tab" aria-selected={classMode === 'switch'} onClick={() => setClassMode('switch')}>Смена класса</button></div>
        {classMode !== 'switch' ? <ClassProgressionPanel player={player} progression={progressionState} mode={classMode} showModeSwitcher={false} onUpdateProgression={onUpdateClassProgression} onMessage={message => pushToast(message, { tone: 'warning' })} /> : <section><p>Смена класса бесплатна и доступна без ограничений. Сумка останется экипированной, остальное снаряжение переместится в Хранилище.</p><div className="guild-internal-tabs">{DEVELOPER_PLAYABLE_CLASSES.map(entry => <button key={entry.id} disabled={entry.id === player.class} onClick={() => requestClassSwitch(entry)}>{entry.label}{entry.id === player.class ? ' — текущий' : ''}</button>)}</div></section>}</div>
      )}
      {activeTab === 'backpack' && (() => {
        const layout = getRunInventoryLayout(player.equipment);
        const labels = { safe: 'Безопасные', general: 'Основные', consumable: 'Расходники', resource: 'Ресурсы' };
        return <div className="guild-content guild-backpack">
          <div className="guild-service-meta"><span>{silver} ◈</span></div>
          <div className="guild-item-toolbar">
            <button type="button" aria-pressed={backpackSelectionMode} onClick={() => { setBackpackSelectionMode(value => !value); setKeptBackpackSlots(new Set()); }}>{backpackSelectionMode ? 'Отмена' : 'Выбрать'}</button>
            {backpackSelectionMode && <button type="button" onClick={unloadBackpackExceptKept}>Выгрузить остальное</button>}
            {onUnloadAllToStorage && <button type="button" aria-label="Выгрузить всё на склад" onClick={() => { const result = onUnloadAllToStorage(); if (!result?.movedQuantity) pushToast('На складе нет места', { tone: 'warning' }); else { playSfx('itemToStorage'); if (result.remainingQuantity) pushToast('Инвентарь выгружен частично', { description: `Перемещено: ${result.movedQuantity}. Не поместилось: ${result.remainingQuantity}.`, tone: 'info' }); } }}>Выгрузить всё</button>}
          </div>
          {layout.sections.map(section => <section className="guild-backpack-section" key={section.type}><h4>{labels[section.type]} <small>{section.capacity}</small></h4>
            <GuildItemGrid label={labels[section.type]}>{section.indices.map(sourceIndex => { const stack = canonicalRunInventory[sourceIndex]; const name = stack ? (getRuneById(stack.itemId)?.name || normalizeItemName(stack.itemId)) : null; return <GuildItemCell key={sourceIndex} testId="backpack-slot" slotIndex={sourceIndex} item={stack} name={name} quantity={stack?.quantity} empty={!stack} showName={false} safe={section.type === 'safe'} dragging={backpackDragIndex === sourceIndex} selected={stack && backpackSelectionMode ? keptBackpackSlots.has(sourceIndex) : undefined} onPointerDown={stack && !backpackSelectionMode ? event => beginBackpackPointerInteraction(event, sourceIndex) : undefined} onClick={!stack ? undefined : event => {
              if (backpackSelectionMode) { setKeptBackpackSlots(previous => { const next = new Set(previous); next.has(sourceIndex) ? next.delete(sourceIndex) : next.add(sourceIndex); return next; }); return; }
              if (backpackSuppressClickRef.current) { backpackSuppressClickRef.current = false; backpackTapCandidateRef.current = null; return; }
              if (event.detail === 0 || backpackTapCandidateRef.current === sourceIndex) setBackpackDetails({ ...stack, sourceIndex });
              backpackTapCandidateRef.current = null;
            }} />; })}</GuildItemGrid>
          </section>)}
          {backpackDragIndex !== null && backpackDragPoint && canonicalRunInventory[backpackDragIndex] && (() => { const dragged = canonicalRunInventory[backpackDragIndex]; const art = resolveItemArt(dragged); return <div className={`guild-backpack-drag-ghost${art ? ' has-art' : ''}`} style={{ left: backpackDragPoint.x, top: backpackDragPoint.y }} aria-hidden="true">
            {art && <img src={art} alt="" draggable={false} onDragStart={event => event.preventDefault()} onError={hideMissingItemArt} />}
            {dragged.quantity > 1 && <b>{dragged.quantity}</b>}
          </div>; })()}
        </div>;
      })()}
      {backpackDetails && <ItemDetailsModal item={backpackDetails} player={player} context={{ inGuild: true }} equipmentAction={findItemData(backpackDetails.itemId)?.type === 'equipment' ? { available: true } : undefined} depositAction={findItemData(backpackDetails.itemId)?.type !== 'currency' && onDepositItem ? { available: true } : undefined} onEquip={() => { handleEquip(backpackDetails.sourceIndex); setBackpackDetails(null); }} onDeposit={() => { handleDeposit({ ...backpackDetails, name: normalizeItemName(backpackDetails.itemId), quantityToMove: backpackDetails.quantity }); setBackpackDetails(null); }} onClose={() => setBackpackDetails(null)} />}
      {activeTab === 'storage' && (
        <div style={styles.inventory}>
          <div className="guild-service-meta"><small>{getStorageOccupancy(normalizedStorage)} / {GUILD_STASH_CAPACITY}</small></div>
          <div className="storage-toolbar" aria-label="Фильтры хранилища">
            {STORAGE_FILTERS.map(filter => <button type="button" key={filter.id} aria-pressed={storageFilter === filter.id} onClick={() => setStorageFilter(filter.id)}>{filter.label}</button>)}
          </div>
          <div className="storage-controls">
            <label>Сортировка <select value={storageSort} onChange={event => setStorageSort(event.target.value)}>{STORAGE_SORTS.map(sort => <option key={sort.id} value={sort.id}>{sort.label}</option>)}</select></label>
            <button type="button" aria-pressed={storageSelectionMode} onClick={() => { setStorageSelectionMode(value => !value); setConfirmBulkSale(false); if (storageSelectionMode) setSelectedStorageIds(new Set()); }}>Выбрать</button>
          </div>
          {storageSummary.length === 0 ? (
            <p>Хранилище пустует.</p>
          ) : (
            <ul className="storage-grid" aria-label="Предметы хранилища">
              {visibleStorage.map(item => (
                <li key={`storage-${item.id}`} className={selectedStorageIds.has(item.id) ? 'is-selected' : ''}>
                  <button type="button" aria-label={`${item.meta || getRuneById(item.itemId) ? item.name : `Неизвестный предмет: ${item.name}`}${item.quantity > 1 ? ` x${item.quantity}` : ''}`} aria-disabled={storageSelectionMode && !isItemSellable(item)} aria-pressed={storageSelectionMode ? selectedStorageIds.has(item.id) : undefined} onClick={() => storageSelectionMode ? setSelectedStorageIds(previous => { const next = new Set(previous); next.has(item.id) ? next.delete(item.id) : isItemSellable(item) && next.add(item.id); return next; }) : setStorageDetails(item)}>
                    {resolveItemArt(item) ? <img src={resolveItemArt(item)} alt="" onError={hideMissingItemArt} /> : <span className={`storage-grid__fallback${item.meta || getRuneById(item.itemId) ? '' : ' is-orphan'}`} aria-hidden="true">{item.meta || getRuneById(item.itemId) ? '◇' : '?'}</span>}
                    {item.quantity > 1 && <span className="storage-grid__quantity item-icon-quantity">{item.quantity}</span>}
                    {item.socketedRuneId && <span className="storage-grid__socket" aria-label="Установлена руна">◆</span>}
                  </button>
                  {storageSelectionMode && <button type="button" className="compact-info-button item-icon-info storage-grid__info" aria-label={`Подробнее: ${item.name}`} onClick={event => { event.stopPropagation(); setStorageDetails(item); }}>i</button>}
                </li>
              ))}
            </ul>
          )}
          {storageSelectionMode && <div className="storage-selection-bar"><span>Выбрано: {selectedStorageRows.length}</span><span>Получите: {selectedStorageValue} серебра</span><button type="button" disabled={!selectedStorageRows.length} onClick={() => setConfirmBulkSale(true)}>Продать</button><button type="button" onClick={() => { setStorageSelectionMode(false); setSelectedStorageIds(new Set()); }}>Отмена</button></div>}
          {confirmBulkSale && <div className="storage-sale-confirm" role="alertdialog" aria-label="Подтвердить продажу"><p>{selectedStorageRows.map(row => `${row.name} ×${row.quantity}`).join(', ')}</p><p>Продать выбранные предметы за {selectedStorageValue} серебра?</p><button type="button" onClick={() => { if (transactStorageSale(selectedStorageIds)) { setSelectedStorageIds(new Set()); setStorageSelectionMode(false); } setConfirmBulkSale(false); }}>Продать</button><button type="button" onClick={() => setConfirmBulkSale(false)}>Назад</button></div>}
        </div>
      )}
      {storageDetails && (() => { const acceptance = getRunInventoryAcceptance(player, storageDetails, storageDetails.quantity); const runeAction = getStorageRuneAction(storageDetails); return <ItemDetailsModal item={storageDetails} player={player} context={{ storage: true }} equipmentAction={storageDetails.category === 'equipment' && onEquipStorageItem ? { available: true } : undefined} onEquip={() => { const result = onEquipStorageItem(storageDetails); if (result?.requiresSlotChoice) setEquipSlotChoice({ item: storageDetails, slots: result.candidateSlots }); else if (result) { playSfx('itemEquip'); setStorageDetails(null); } }} maxWithdraw={acceptance.maxQuantity} withdrawalStackQuantity={acceptance.stackQuantity} onWithdraw={onWithdrawItem ? quantity => { const success = onWithdrawItem(storageDetails, quantity); if (success !== false) { playSfx('itemFromStorage'); setStorageDetails(null); } return success; } : undefined} sellPrice={getCanonicalSellPrice(storageDetails) * storageDetails.quantity} onSell={isItemSellable(storageDetails) ? quantity => { const success = transactStorageSale([storageDetails.id], { quantities: { [storageDetails.id]: quantity } }); if (success) setStorageDetails(null); return success; } : undefined} onDiscard={isItemDiscardable(storageDetails) ? () => { const result = discardStorageEntry(normalizedStorage, storageDetails.id); if (result.success) { onUpdateStorage?.(result.storage); setStorageDetails(null); } } : undefined} runeAction={runeAction} actionError={storageDetails.socketedRuneId ? { reason: 'Сначала извлеките руну из предмета.' } : undefined} onClose={() => setStorageDetails(null)} />; })()}
      {equipSlotChoice && <EquipmentSlotChoiceDialog candidates={equipSlotChoice.slots} equipment={player?.equipment} player={player} onSelect={slot => {
        if (equipSlotChoice.source === 'backpack') { handleEquip(equipSlotChoice.sourceIndex, slot); setEquipSlotChoice(null); return; }
        if (onEquipStorageItem(equipSlotChoice.item, slot)) { playSfx('itemEquip'); setEquipSlotChoice(null); setStorageDetails(null); }
      }} onCancel={() => setEquipSlotChoice(null)} />}
      {runeTargetSelection && <RuneTargetSelectionOverlay targets={runeTargetSelection.targets} onClose={() => setRuneTargetSelection(null)} onSelect={target => {
        const equipmentState = target.location === 'equipped' ? { ...player.equipment, [target.slot]: target.item } : { [target.slot]: target.item };
        const result = socketRuneIntoEquipment({ equipment: equipmentState, equipmentSlot: target.slot, runeId: runeTargetSelection.runeId, sourceEntries: normalizedStorage });
        if (!result.success) return { success: false, reason: target.item.socketedRuneId ? 'Предмет уже содержит руну.' : 'Руна несовместима с этим предметом.' };
        let nextStorage = result.sourceEntries;
        if (target.location === 'storage') nextStorage = nextStorage.map(entry => entry?.instanceId === target.item.instanceId ? result.equipment[target.slot] : entry);
        else onUpdatePlayer?.({ ...player, equipment: result.equipment });
        onUpdateStorage?.(nextStorage); setStorageDetails(null); setRuneTargetSelection(null); return { success: true };
      }} />}
      {runeSelection && <RuneSelectionOverlay entries={runeSelection.compatible} onClose={() => setRuneSelection(null)} onSelect={entry => {
        const result = socketRuneIntoEquipment({ equipment: { [runeSelection.slot]: runeSelection.item }, equipmentSlot: runeSelection.slot, runeId: entry.itemId, sourceEntries: normalizedStorage });
        if (!result.success) { pushToast('Не удалось вставить руну', { tone: 'warning' }); return { success: false, reason: runeSelection.item.socketedRuneId ? 'Предмет уже содержит руну.' : 'Руна несовместима с этим предметом.' }; }
        const updatedItem = result.equipment[runeSelection.slot];
        const next = result.sourceEntries.map(storageEntry => storageEntry.instanceId === runeSelection.item.instanceId ? updatedItem : storageEntry);
        onUpdateStorage?.(next); setStorageDetails(previous => ({ ...previous, socketedRuneId: entry.itemId })); setRuneSelection(null);
        return { success: true };
      }} />}
      {activeTab === 'craft' && <div className="guild-content guild-recipes">
        <div className="guild-service-meta"><small>Материалы и результат — в Хранилище</small></div>
        <GuildCategoryTabs label="Категории рецептов" value={craftCategory} onChange={setCraftCategory} entries={[{id:'all',label:'Все'},{id:'consumable',label:'Расходники'},{id:'equipment',label:'Снаряжение'},{id:'rune',label:'Руны'}]} />
        <div className="guild-recipe-list" role="list" aria-label="Рецепты">
          {visibleRecipes.map(recipe => {
            const available = canCraft(recipe);
            const stackable = isStackableStorageItem({ itemId: recipe.runeId || recipe.name });
            return <CraftRecipeRow key={recipe.name} name={recipe.name}
              itemName={recipe.runeId || recipe.name}
              ingredients={recipe.ingredients}
              ownedCounts={storageCounts}
              craftable={available}
              disabled={Boolean(craftFeedback)}
              onInspectItem={itemName => setCraftInspectItem({ itemId: itemName, name: itemName })}
              onCraft={() => stackable
                ? (setCraftQuantity('1'), setCraftDetails(recipe))
                : handleCraft(recipe, 1)}
            />;
          })}
        </div>
      </div>}
      {craftInspectItem && <ItemDetailsModal item={craftInspectItem} player={player} context={{ inGuild: true, inspectOnly: true }} onClose={() => setCraftInspectItem(null)} />}
      {craftDetails && (()=>{const max=getMaxCraftableFromStorage(storageItems,craftDetails);const parsed=Math.floor(Number(craftQuantity));const quantity=Number.isFinite(parsed)?Math.max(1,Math.min(max||1,parsed)):1;return <div className="item-details-overlay" role="dialog" aria-modal="true" aria-label={`Количество: ${craftDetails.name}`}><section className="item-details-panel guild-craft-quantity"><button className="guild-detail-close" aria-label="Закрыть" onClick={()=>{setCraftDetails(null);setCraftQuantity('1');}}>×</button><img src={resolveItemArt(craftDetails.runeId||craftDetails.name)} alt="" onError={hideMissingItemArt}/><h3>{craftDetails.name}</h3><div className="guild-craft-stepper"><button aria-label="Уменьшить" onClick={()=>setCraftQuantity(String(Math.max(1,quantity-1)))}>−</button><input aria-label="Количество" type="number" min="1" max={max} step="1" value={craftQuantity} onChange={event=>setCraftQuantity(event.target.value)}/><button aria-label="Увеличить" onClick={()=>setCraftQuantity(String(Math.min(max,quantity+1)))}>+</button><button onClick={()=>setCraftQuantity(String(max))}>Макс</button></div><h4>Итоговая стоимость</h4><ul>{craftDetails.ingredients.map(req=><li key={req.name}><span>{req.name}</span><strong>{(storageCounts[req.name]||0)} / {req.quantity*quantity}</strong></li>)}</ul><button className="is-primary" disabled={max<1||quantity>max||Boolean(craftFeedback)} onClick={()=>handleCraft(craftDetails,quantity)}>Создать ×{quantity}</button></section></div>;})()}
      {craftFeedback && <div className="guild-craft-feedback" role="status" aria-live="polite" aria-label={`Создано: ${craftFeedback.recipe.name}${craftFeedback.quantity>1?`, ${craftFeedback.quantity} шт.`:''}`}><div><img src={resolveItemArt(craftFeedback.recipe.runeId||craftFeedback.recipe.name)} alt="" onError={hideMissingItemArt}/>{craftFeedback.quantity>1&&<b>×{craftFeedback.quantity}</b>}</div></div>}
      {activeTab === 'character' && <div className="guild-content guild-character inventory-equipment-view">
        <GuildCategoryTabs label="Раздел персонажа" value={characterMode} onChange={setCharacterMode} entries={[{id:'character',label:'Персонаж'},{id:'effects',label:'Эффекты'}]} />
        {characterMode === 'effects' ? <section className="guild-effects"><h3>Активные эффекты</h3><h4>Реликвия</h4>{relicBonusDescriptions.length ? <ul>{relicBonusDescriptions.map((bonus,index) => <li key={index}>{bonus}</li>)}</ul> : <p>Нет активных эффектов, которые можно надёжно определить.</p>}</section> : <><header className="guild-character-identity"><h3>{player.name}</h3><strong>{CLASS_DISPLAY_NAMES[player.class] || player.class}</strong></header><EquipmentPaperDoll equipment={equipmentSlots} portrait={resolvePlayerPortrait(player)} onInspect={(slot,item) => setCharacterDetails({ slot, item })} /><CharacterStatsGrid stats={[['HP', `${player.hp}/${player.maxHp}`],['Атака', player.attack || player.baseAtk || 0],['Магическая атака', player.magAtk || 0],['Физическая защита', player.physDef || 0, 'physDef'],['Магическая защита', player.magicDef || 0, 'magicDef'],['Скорость', player.speed || 0],['Шанс крита', `${Math.round((player.critChance || 0)*100)}%`],['Критический урон', `${Math.round((1+(player.critDamage ?? .5))*100)}%`],['Уклонение', `${Math.round((player.dodge || 0)*100)}%`]]} /></>}
      </div>}
      {characterDetails && <ItemDetailsModal item={characterDetails.item} player={player} context={{ inGuild: true }} unequipAction={{ available: true }} onUnequip={() => { handleUnequip(characterDetails.slot); setCharacterDetails(null); }} onClose={() => setCharacterDetails(null)} />}
      {activeTab === 'relics' && (() => { const def = discoveredRelicDefinitions.find(entry => entry.id === effectiveInspectedRelicId); const progress = def ? (relicsState.progress?.[def.id] || { level:0,xp:0 }) : null; return <div className="guild-content guild-relics"><div className="guild-relic-selector" role="list" aria-label="Открытые реликвии">{discoveredRelicDefinitions.map(entry => { const entryProgress=relicsState.progress?.[entry.id] || {level:0}; return <button type="button" role="listitem" aria-label={`${entry.name}, уровень ${entryProgress.level || 0}${entry.id === activeRelicId ? ', активна' : ''}`} data-testid="relic-selector-cell" key={entry.id} className={`${entry.id === activeRelicId ? ' is-active' : ''}${entry.id === effectiveInspectedRelicId ? ' is-inspected' : ''}`} onClick={() => setInspectedRelicId(entry.id)}><span aria-hidden="true">◇</span><strong>{entry.name}</strong><small>Ур. {entryProgress.level || 0}</small>{entry.id === activeRelicId && <em>Активна</em>}</button>; })}</div>{def && <section className="guild-relic-detail" data-testid="relic-detail"><header><span className="guild-relic-art" aria-hidden="true">◇</span><div><h4>{def.name}</h4><p>{def.rarity} · Уровень {progress.level || 0}</p></div></header><progress max="100" value={Math.min(progress.xp || 0,100)} /><p>Опыт: {Math.min(progress.xp || 0,100)} / 100</p><dl><div><dt>Текущий эффект</dt><dd>{describeRelicLevel(def.id, progress.level || 0) || 'Эффект откроется на первом уровне'}</dd></div><div><dt>Следующий эффект</dt><dd>{getNextRelicDescription(def.id, progress.level || 0) || 'Реликвия полностью улучшена'}</dd></div></dl><button type="button" disabled={def.id === activeRelicId} onClick={() => handleRelicSelect(def.id)}>{def.id === activeRelicId ? 'Активна' : 'Сделать активной'}</button></section>}</div>; })()}
      {activeTab === 'quests' && (
        <div className="guild-content" style={styles.questSection}>
          <div className="guild-internal-tabs" role="tablist"><button onClick={() => setQuestMode('guild')}>Гильдия</button><button onClick={() => setQuestMode('active')}>Активные</button><button onClick={() => setQuestMode('journal')}>Журнал</button></div>
          {questMode === 'journal' && <p>В журнале пока нет записей.</p>}
          {questMode !== 'journal' && questDefinitions.filter(quest => questMode === 'guild' || !(questLog[quest.id]?.completed || questLog[quest.id]?.claimed)).map(quest => {
            const entry = questLog[quest.id] || { progress: 0, completed: false, claimed: false };
            const target = quest.tracking?.target ?? 1;
            const progressValue = Math.min(entry.progress || 0, target);
            const percent = Math.min(100, Math.round((progressValue / target) * 100));
            const rewardText = describeQuestReward(quest.rewards) || '—';
            return (
              <div key={quest.id} style={styles.questCard}>
                <h4>{quest.name}</h4>
                <p>{quest.description}</p>
                <div style={styles.progressBar}>
                  <div style={{ ...styles.progressFill, width: `${percent}%` }} />
                </div>
                <p>
                  {progressValue} / {target}
                </p>
                <p>Награда: {rewardText}</p>
                {entry.claimed ? (
                  <p style={styles.questStatus}>Награда получена</p>
                ) : entry.completed ? (
                  <button
                    style={styles.tabButton}
                    onClick={() => onClaimQuestReward && onClaimQuestReward(quest.id)}
                  >
                    Получить награду
                  </button>
                ) : (
                  <p style={styles.questStatus}>Прогресс: {percent}%</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {activeTab === 'vendors' && <div className="guild-content guild-vendors"><div className="guild-service-meta"><span>{silver} ◈</span></div><GuildCategoryTabs label="Торговцы" value={selectedVendor?.id} onChange={setVendorId} entries={vendors.map(vendor => ({id:vendor.id,label:vendor.name}))} /><p className="guild-vendor-description">{selectedVendor?.description}</p><GuildItemGrid label="Товары" className="guild-vendor-grid">{selectedVendor?.items.map(item => {
        const purchaseStatus = getVendorPurchaseStatus(item, vendorPurchaseState, vendorNowMs);
        return <GuildItemCell key={item.name} testId="vendor-cell" item={item} name={item.name} price={item.price} badge={purchaseStatus.limited ? `${purchaseStatus.remaining}/${purchaseStatus.limit}` : null} disabled={silver < item.price || (purchaseStatus.limited && purchaseStatus.remaining <= 0)} onClick={() => setVendorDetails(item)} />;
      })}</GuildItemGrid></div>}
      {vendorDetails && <div className="item-details-overlay" role="dialog" aria-modal="true" aria-label={`Товар: ${vendorDetails.name}`}><section className="item-details-panel guild-shop-detail"><button className="guild-detail-close" onClick={() => setVendorDetails(null)}>×</button><img src={resolveItemArt(vendorDetails)} alt="" onError={hideMissingItemArt}/><h3>{vendorDetails.name}</h3><p>{vendorDetails.description}</p><strong>{vendorDetails.price} серебра</strong>{vendorDetailPurchaseStatus?.limited && <p>Осталось сегодня: {vendorDetailPurchaseStatus.remaining} из {vendorDetailPurchaseStatus.limit}. Сброс в 00:00 UTC.</p>}<button className="is-primary" disabled={silver < vendorDetails.price || (vendorDetailPurchaseStatus?.limited && vendorDetailPurchaseStatus.remaining <= 0)} onClick={() => handlePurchase(vendorDetails)}>Купить</button></section></div>}
      {activeTab === 'runes' && (
        <div style={styles.runeSection}>

          <p>Руны хранятся как предметы. Откройте совместимое снаряжение в Хранилище, чтобы вставить или бесплатно извлечь руну.</p>
          {presentStorage(normalizedStorage, 'rune', 'name').length === 0
            ? <p>Рун в хранилище нет.</p>
            : presentStorage(normalizedStorage, 'rune', 'name').map(entry => <p key={entry.id}>{entry.name} ×{entry.quantity}</p>)}
        </div>
      )}
      </main>
    </div>
  );
};

export default GuildScreen;
