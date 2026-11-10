import React, { useEffect, useState } from 'react';
import { abilities } from '../data/abilities';
import { effects } from '../data/effects';
import { applyClassLoadoutToPlayer, ensureClassProgression } from '../data/classProgression';
import { applyEquipmentPatch } from '../utils/equipmentManager';
import { ITEM_DATA } from '../data/items';
import { useToast } from '../contexts/UIContext';
import {
  COMBAT_ART_FALLBACKS,
  applyCombatArtFallback,
} from '../data/combatAssets';
import { PLAYABLE_CLASS_DEFINITIONS, createClassBaseStats } from '../data/classTemplates';
import {
  STARTING_INVENTORY, STARTER_FISHING_ROD, createStarterEquipmentSlots,
  createStartingExpeditionLoadout, createProductionFreshCharacter,
} from '../utils/characterFactory';

const DEVELOPER_PASSWORD = 'parol';
export { STARTING_INVENTORY, STARTER_FISHING_ROD, createStarterEquipmentSlots, createStartingExpeditionLoadout };

const CLASSES = PLAYABLE_CLASS_DEFINITIONS;

const getClassLabel = (classData) => (classData.displayName
  ? `${classData.englishDisplayName || classData.name} / ${classData.displayName}`
  : classData.name);

const STAT_FIELDS = [
  { key: 'hp', label: 'HP', step: 10 },
  { key: 'maxHp', label: 'Max HP', step: 10 },
  { key: 'attack', label: 'Attack', step: 1 },
  { key: 'physDef', label: 'Defense', step: 1 },
  { key: 'speed', label: 'Speed / Initiative', step: 10 },
];

const createDeveloperDraft = (classData) => ({
  silver: 0,
  inventory: [...STARTING_INVENTORY],
  hp: classData.stats.hp,
  maxHp: classData.stats.maxHp,
  attack: classData.stats.attack,
  physDef: classData.stats.physDef ?? 0,
  speed: classData.stats.speed ?? 0,
});

const toNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const EDITABLE_FIELD_ORDER = ['id', 'key', 'name', 'title', 'Name', 'description', 'Описание', 'type', 'Тип', 'target', 'cooldown', 'rarity', 'buyPrice', 'sellPrice'];
const getContentKey = (kind, entry) => `${kind}:${entry.id || entry.name || entry.title || entry.Name || ''}`;

const getEditableDraftFields = (entry) => {
  const primitiveFields = Object.entries(entry)
    .filter(([key, value]) => EDITABLE_FIELD_ORDER.includes(key) || typeof value === 'number')
    .filter(([, value]) => ['string', 'number'].includes(typeof value))
    .map(([key, value]) => ({ key, valueType: typeof value }));
  return primitiveFields.sort((left, right) => {
    const leftIndex = EDITABLE_FIELD_ORDER.indexOf(left.key);
    const rightIndex = EDITABLE_FIELD_ORDER.indexOf(right.key);
    if (leftIndex === -1 && rightIndex === -1) return left.key.localeCompare(right.key);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
};

const EFFECT_STACK_KEYS = ['effects', 'effect', 'effectList', 'actions'];
const COMPLEX_DRAFT_KEYS = [...EFFECT_STACK_KEYS, 'damage'];
const cloneContentValue = (value) => JSON.parse(JSON.stringify(value));

const createDraftForm = (entry) => {
  const primitiveDraft = getEditableDraftFields(entry).reduce((draft, field) => ({
    ...draft,
    [field.key]: entry[field.key],
  }), {});
  return COMPLEX_DRAFT_KEYS.reduce((draft, key) => {
    if (Array.isArray(entry[key])) {
      return { ...draft, [key]: cloneContentValue(entry[key]) };
    }
    return draft;
  }, primitiveDraft);
};

const buildDraftPatch = (original, draft) => Object.entries(draft).reduce((patch, [key, value]) => {
  if (original[key] !== value) {
    return { ...patch, [key]: value };
  }
  return patch;
}, {});

const CharacterSelectionScreen = ({ onCharacterSelect, classProgression, accountName = '' }) => {
  const [name, setName] = useState(accountName);
  const [selectedClass, setSelectedClass] = useState('Defender');
  const [isDeveloperEditorOpen, setIsDeveloperEditorOpen] = useState(false);
  const [activeDeveloperTab, setActiveDeveloperTab] = useState('tools');
  const [activeContentType, setActiveContentType] = useState('Skills');
  const [activeContentSubtype, setActiveContentSubtype] = useState('all');
  const [contentSearch, setContentSearch] = useState('');
  const [contentSort, setContentSort] = useState('name');
  const [classRoleFilter, setClassRoleFilter] = useState('all');
  const [skillTypeFilter, setSkillTypeFilter] = useState('all');
  const [skillTargetFilter, setSkillTargetFilter] = useState('all');
  const [skillCooldownFilter, setSkillCooldownFilter] = useState('all');
  const [itemTypeFilter, setItemTypeFilter] = useState('all');
  const [itemRarityFilter, setItemRarityFilter] = useState('all');
  const [itemPriceFilter, setItemPriceFilter] = useState('all');
  const [selectedContentEntry, setSelectedContentEntry] = useState(null);
  const [isRawDataOpen, setIsRawDataOpen] = useState(false);
  const [contentDrafts, setContentDrafts] = useState({});
  const [isDraftEditing, setIsDraftEditing] = useState(false);
  const [draftForm, setDraftForm] = useState({});
  const [draftMessage, setDraftMessage] = useState('');
  const [isDraftImportOpen, setIsDraftImportOpen] = useState(false);
  const [draftImportText, setDraftImportText] = useState('');
  const [draftImportMessage, setDraftImportMessage] = useState('');
  const [isPatchReviewOpen, setIsPatchReviewOpen] = useState(false);
  const [expandedEffectCards, setExpandedEffectCards] = useState({});
  const [isAdvancedPatchOpen, setIsAdvancedPatchOpen] = useState(false);
  const [selectedItemName, setSelectedItemName] = useState(ITEM_DATA[0]?.name || '');
  const [developerPatch, setDeveloperPatch] = useState('{}');
  const [appliedDeveloperPatch, setAppliedDeveloperPatch] = useState({});
  const [developerDraft, setDeveloperDraft] = useState(() => createDeveloperDraft(CLASSES[0]));
  const [developerMessage, setDeveloperMessage] = useState('');
  const { pushToast } = useToast();

  const selectedClassData = CLASSES.find(c => c.name === selectedClass) || CLASSES[0];
  const selectedPortrait = selectedClassData.portrait;
  const availableStatFields = STAT_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(developerDraft, field.key));
  const hasGold = Object.prototype.hasOwnProperty.call(developerDraft, 'gold');
  const itemEditorAvailable = ITEM_DATA.length > 0;
  const savedDraftCount = Object.keys(contentDrafts).length;

  const normalizedContentSearch = contentSearch.trim().toLowerCase();
  const sortEntriesByLabel = (entries) => [...entries].sort((left, right) => {
    const leftLabel = (left.name || left.title || left.Name || '').toString();
    const rightLabel = (right.name || right.title || right.Name || '').toString();
    if (contentSort === 'type') {
      const leftType = (left.type || left.rarity || left['Тип'] || '').toString();
      const rightType = (right.type || right.rarity || right['Тип'] || '').toString();
      return leftType.localeCompare(rightType) || leftLabel.localeCompare(rightLabel);
    }
    return leftLabel.localeCompare(rightLabel);
  });
  const getClassRole = (classEntry) => {
    if ((classEntry.stats.magAtk ?? 0) > (classEntry.stats.attack ?? 0)) return 'Magic';
    if ((classEntry.stats.speed ?? 0) >= 200) return 'Speed';
    return 'Physical';
  };
  const matchesSearch = (...values) => {
    if (!normalizedContentSearch) return true;
    return values
      .filter(value => value !== undefined && value !== null)
      .some(value => String(value).toLowerCase().includes(normalizedContentSearch));
  };
  const uniqueValues = (values) => [...new Set(values.filter(Boolean))].sort();
  const getSkillType = (skill) => skill.type || 'skill';
  const getSkillTarget = (skill) => skill.target || 'target varies';
  const itemSubtypeDefinitions = [
    { key: 'equipment', label: 'Equipment', defaultType: 'equipment' },
    { key: 'consumables', label: 'Consumables', defaultType: 'consumable' },
    { key: 'materials', label: 'Materials', defaultType: 'material' },
    { key: 'fishing', label: 'Fishing', defaultType: 'fish' },
    { key: 'currency', label: 'Currency', defaultType: 'currency' },
    { key: 'other', label: 'Other', defaultType: 'item' },
  ];
  const itemSubtypeKeys = itemSubtypeDefinitions.map(subtype => subtype.key);
  const getRawItemType = (item) => item.type || 'item';
  const getItemSubtypeKey = (item) => {
    const rawType = String(item.type || '').toLowerCase();
    if (rawType === 'equipment') return 'equipment';
    if (rawType === 'consumable') return 'consumables';
    if (rawType === 'material') return 'materials';
    if (['fish', 'fishingrod', 'bait'].includes(rawType)) return 'fishing';
    if (rawType === 'currency') return 'currency';
    return 'other';
  };
  const getItemSubtypeLabel = (subtypeKey) => itemSubtypeDefinitions.find(subtype => subtype.key === subtypeKey)?.label || 'Other';
  const getItemSubtype = (item) => getItemSubtypeLabel(getItemSubtypeKey(item));
  const getDefaultItemTypeForSubtype = (subtypeKey) => itemSubtypeDefinitions.find(subtype => subtype.key === subtypeKey)?.defaultType || 'item';
  const getItemRarity = (item) => item.rarity || 'Без редкости';
  const getEffectType = (effect) => effect['Тип'] || 'effect';
  const skillTypeOptions = uniqueValues(abilities.map(skill => getSkillType(skill)));
  const skillTargetOptions = uniqueValues(abilities.map(skill => getSkillTarget(skill)));
  const rawItemTypeOptions = uniqueValues(ITEM_DATA.map(item => getRawItemType(item)));
  const itemTypeOptions = itemSubtypeDefinitions;
  const itemRarityOptions = uniqueValues(ITEM_DATA.map(item => getItemRarity(item)));
  const effectTypeOptions = uniqueValues(effects.map(effect => getEffectType(effect)));
  const effectReferenceOptions = uniqueValues([
    ...effects.map(effect => effect.Name),
    ...abilities.flatMap(skill => (skill.effects || []).map(effect => effect.id || effect.type)),
  ]);
  const damageTypeOptions = uniqueValues(abilities.flatMap(skill => (skill.damage || []).map(damage => damage.type)));
  const scalingStatOptions = uniqueValues(abilities.flatMap(skill => (skill.damage || []).map(damage => {
    const formula = damage.formula || '';
    if (formula.includes('magAtk')) return 'magAtk';
    if (formula.includes('attack')) return 'attack';
    if (formula.includes('maxHp')) return 'maxHp';
    return '';
  })));
  const findSourceContent = (kind, originalKey) => {
    const source = kind === 'Skill' ? abilities : kind === 'Item' ? ITEM_DATA : effects;
    return source.find(entry => [entry.id, entry.key, entry.name, entry.title, entry.Name].filter(Boolean).includes(originalKey));
  };
  const getDraftIdentity = (kind, entry) => {
    if (kind === 'Skill') return entry.id || entry.key || entry.name || entry.title;
    if (kind === 'Item') return entry.id || entry.key || entry.name || entry.title;
    return entry.Name || entry.id || entry.name || entry.title;
  };
  const getIdentityField = (kind, entry = {}) => {
    if (kind === 'Skill') return Object.prototype.hasOwnProperty.call(entry, 'key') && !Object.prototype.hasOwnProperty.call(entry, 'id') ? 'key' : 'id';
    if (kind === 'Item') return Object.prototype.hasOwnProperty.call(entry, 'id') ? 'id' : 'name';
    return null;
  };
  const getOriginalKeyFromDraftKey = (draftKey) => draftKey.split(':').slice(1).join(':');
  const isNewLocalDraft = (kind, entry) => {
    const originalKey = getOriginalKeyFromDraftKey(getContentKey(kind, entry));
    return (kind === 'Skill' || kind === 'Item') && Boolean(contentDrafts[getContentKey(kind, entry)]) && !findSourceContent(kind, originalKey);
  };
  const getLocalNewDraftEntries = (kind) => Object.entries(contentDrafts)
    .filter(([draftKey]) => draftKey.startsWith(`${kind}:`))
    .map(([, draft]) => draft)
    .filter(draft => !findSourceContent(kind, getDraftIdentity(kind, draft)));
  const localSkillDrafts = getLocalNewDraftEntries('Skill');
  const localItemDrafts = getLocalNewDraftEntries('Item');
  const skillEntries = [...abilities, ...localSkillDrafts];
  const itemEntries = [...ITEM_DATA, ...localItemDrafts];
  const buildSubtypeOptions = (entries, getValue) => uniqueValues(entries.map(getValue)).map(value => ({
    value,
    label: value,
    total: entries.filter(entry => getValue(entry) === value).length,
  }));
  const buildItemSubtypeOptions = (entries) => [
    { value: 'all', label: 'All Items', total: entries.length },
    ...itemSubtypeDefinitions.map(subtype => ({
      value: subtype.key,
      label: subtype.label,
      total: entries.filter(entry => getItemSubtypeKey(entry) === subtype.key).length,
    })),
  ];
  const contentTypeConfig = {
    Classes: {
      entries: CLASSES,
      kind: 'Class',
      getSubtype: getClassRole,
      subtitle: 'Class presets, portraits, starting stats, and default ability kits.',
      subtypes: buildSubtypeOptions(CLASSES, getClassRole),
    },
    Skills: {
      entries: skillEntries,
      kind: 'Skill',
      getSubtype: getSkillType,
      subtitle: 'Active skills, spells, cooldowns, targeting, scaling, and effect stacks.',
      createLabel: 'Create new Skill',
      createKind: 'Skill',
      subtypes: buildSubtypeOptions(skillEntries, getSkillType),
    },
    Items: {
      entries: itemEntries,
      kind: 'Item',
      getSubtype: getItemSubtypeKey,
      subtitle: 'Inventory content, equipment, materials, consumables, rarity, and prices.',
      createLabel: 'Create new Item',
      createKind: 'Item',
      subtypes: buildItemSubtypeOptions(itemEntries),
    },
    'Buffs & Debuffs': {
      entries: effects,
      kind: 'Effect',
      getSubtype: getEffectType,
      subtitle: 'Status effects, buffs, debuffs, durations, icons, and gameplay parameters.',
      subtypes: buildSubtypeOptions(effects, getEffectType),
    },
  };
  const entryMatchesSearch = (kind, entry) => {
    if (kind === 'Class') return matchesSearch(
      entry.name,
      entry.displayName,
      entry.englishDisplayName,
      getClassRole(entry),
      entry.abilityNames.join(' '),
      (entry.unlockableAbilityNames || []).join(' ')
    );
    if (kind === 'Skill') return matchesSearch(entry.name, getSkillType(entry), getSkillTarget(entry), entry.description);
    if (kind === 'Item') return matchesSearch(entry.name, getItemSubtype(entry), getItemSubtypeKey(entry), getRawItemType(entry), getItemRarity(entry), entry.description);
    return matchesSearch(entry.Name, getEffectType(entry), entry['Описание']);
  };
  const entryMatchesSecondaryFilters = (kind, entry) => {
    if (kind === 'Class') {
      return classRoleFilter === 'all' || getClassRole(entry) === classRoleFilter;
    }
    if (kind === 'Skill') {
      const cooldown = entry.cooldown ?? 0;
      const cooldownMatches = skillCooldownFilter === 'all'
        || (skillCooldownFilter === '0' && cooldown === 0)
        || (skillCooldownFilter === '1-2' && cooldown >= 1 && cooldown <= 2)
        || (skillCooldownFilter === '3+' && cooldown >= 3);
      return (skillTypeFilter === 'all' || getSkillType(entry) === skillTypeFilter)
        && (skillTargetFilter === 'all' || getSkillTarget(entry) === skillTargetFilter)
        && cooldownMatches;
    }
    if (kind === 'Item') {
      const price = entry.buyPrice ?? entry.sellPrice ?? 0;
      const priceMatches = itemPriceFilter === 'all'
        || (itemPriceFilter === 'free' && price === 0)
        || (itemPriceFilter === '1-100' && price >= 1 && price <= 100)
        || (itemPriceFilter === '101-500' && price >= 101 && price <= 500)
        || (itemPriceFilter === '501+' && price >= 501);
      return (effectiveItemTypeFilter === 'all' || getItemSubtypeKey(entry) === effectiveItemTypeFilter)
        && (itemRarityFilter === 'all' || getItemRarity(entry) === itemRarityFilter)
        && priceMatches;
    }
    return true;
  };
  const activeBaseConfig = contentTypeConfig[activeContentType];
  const effectiveActiveSubtype = activeContentType === 'Items' && activeContentSubtype !== 'all' && !itemSubtypeKeys.includes(activeContentSubtype)
    ? 'all'
    : activeContentSubtype;
  const effectiveItemTypeFilter = itemTypeFilter === 'all' || itemSubtypeKeys.includes(itemTypeFilter) ? itemTypeFilter : 'all';
  const activeSectionEntries = activeBaseConfig.entries;
  const activeSubtypeEntries = effectiveActiveSubtype === 'all'
    ? activeSectionEntries
    : activeSectionEntries.filter(entry => activeBaseConfig.getSubtype(entry) === effectiveActiveSubtype);
  const finalVisibleEntries = sortEntriesByLabel(activeSubtypeEntries
    .filter(entry => entryMatchesSearch(activeBaseConfig.kind, entry))
    .filter(entry => entryMatchesSecondaryFilters(activeBaseConfig.kind, entry)));
  const activeContentConfig = {
    ...activeBaseConfig,
    total: activeSubtypeEntries.length,
    visible: finalVisibleEntries,
  };
  const renderedContentRows = activeContentConfig.visible;
  const activeSubtypeLabel = effectiveActiveSubtype === 'all' && activeContentType === 'Items'
    ? 'All Items'
    : effectiveActiveSubtype === 'all'
      ? 'All entries'
      : activeContentType === 'Items'
        ? getItemSubtypeLabel(effectiveActiveSubtype)
        : effectiveActiveSubtype;
  const activeSectionKey = activeContentType === 'Items' ? 'items' : activeContentType.toLowerCase().replace(/\s+/g, '-');
  const selectedNavigationKey = `${activeSectionKey}/${effectiveActiveSubtype}`;

  useEffect(() => {
    if (activeContentType === 'Items' && activeContentSubtype !== effectiveActiveSubtype) {
      setActiveContentSubtype(effectiveActiveSubtype);
    }
    if (itemTypeFilter !== effectiveItemTypeFilter) {
      setItemTypeFilter(effectiveItemTypeFilter);
    }
  }, [activeContentType, activeContentSubtype, effectiveActiveSubtype, itemTypeFilter, effectiveItemTypeFilter]);

  const createBaseStats = createClassBaseStats;

  const setDraftNumber = (field, value) => {
    setDeveloperDraft(prev => ({ ...prev, [field]: Math.max(0, toNumber(value, prev[field] ?? 0)) }));
  };

  const nudgeDraftNumber = (field, step) => {
    setDeveloperDraft(prev => ({ ...prev, [field]: Math.max(0, toNumber(prev[field]) + step) }));
  };

  const handleDeveloperAccess = () => {
    const password = window.prompt('Введите пароль разработчика');
    if (password === null) return;
    if (password !== DEVELOPER_PASSWORD) {
      pushToast('Неверный пароль разработчика', { tone: 'warning' });
      return;
    }
    setIsDeveloperEditorOpen(true);
    setDeveloperMessage('Редактор игры включён. Изменения применятся после кнопки «Apply changes».');
  };

  const handleDeveloperClassChange = (className) => {
    const classData = CLASSES.find(c => c.name === className) || CLASSES[0];
    setSelectedClass(classData.name);
    setDeveloperDraft(prev => ({
      ...prev,
      ...createDeveloperDraft(classData),
      silver: prev.silver,
      inventory: prev.inventory,
    }));
    setDeveloperMessage(`Класс в редакторе: ${classData.name}`);
  };

  const handleResetEditor = () => {
    setDeveloperDraft(createDeveloperDraft(selectedClassData));
    setDeveloperPatch('{}');
    setAppliedDeveloperPatch({});
    setDeveloperMessage('Значения редактора сброшены.');
  };

  const buildGuiPatch = () => {
    const cleanInventory = developerDraft.inventory.filter(Boolean);
    return {
      silver: Math.max(0, Math.floor(toNumber(developerDraft.silver))),
      hp: Math.max(0, Math.floor(toNumber(developerDraft.hp))),
      maxHp: Math.max(1, Math.floor(toNumber(developerDraft.maxHp, 1))),
      attack: Math.max(0, Math.floor(toNumber(developerDraft.attack))),
      physDef: Math.max(0, Math.floor(toNumber(developerDraft.physDef))),
      speed: Math.max(0, Math.floor(toNumber(developerDraft.speed))),
      inventory: cleanInventory,
      baseStats: {
        ...createBaseStats(selectedClassData),
        maxHp: Math.max(1, Math.floor(toNumber(developerDraft.maxHp, selectedClassData.stats.maxHp))),
        attack: Math.max(0, Math.floor(toNumber(developerDraft.attack, selectedClassData.stats.attack))),
        physDef: Math.max(0, Math.floor(toNumber(developerDraft.physDef))),
        speed: Math.max(0, Math.floor(toNumber(developerDraft.speed, selectedClassData.stats.speed))),
      },
    };
  };

  const handleApplyDeveloperChanges = () => {
    try {
      const guiPatch = buildGuiPatch();
      const manualPatch = isAdvancedPatchOpen && developerPatch.trim()
        ? JSON.parse(developerPatch)
        : {};
      if (!manualPatch || typeof manualPatch !== 'object' || Array.isArray(manualPatch)) {
        throw new Error('Advanced JSON patch must be an object');
      }
      const nextPatch = { ...guiPatch, ...manualPatch };
      setAppliedDeveloperPatch(nextPatch);
      setDeveloperPatch(JSON.stringify(nextPatch, null, 2));
      setDeveloperMessage('Изменения применены к будущему персонажу.');
    } catch (error) {
      setDeveloperMessage(`Ошибка: ${error.message}`);
      pushToast('Ошибка в редакторе разработчика', {
        description: error.message,
        tone: 'danger',
      });
    }
  };

  const handleCopyPatch = () => {
    const patchText = JSON.stringify(buildGuiPatch(), null, 2);
    setDeveloperPatch(patchText);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(patchText).catch(() => {});
    }
    setDeveloperMessage('JSON patch скопирован в расширенный редактор.');
  };

  const handleAddItem = () => {
    if (!selectedItemName) return;
    setDeveloperDraft(prev => ({ ...prev, inventory: [...prev.inventory, selectedItemName] }));
  };

  const handleRemoveItem = (indexToRemove) => {
    setDeveloperDraft(prev => ({
      ...prev,
      inventory: prev.inventory.filter((_, index) => index !== indexToRemove),
    }));
  };

  const openContentDetail = (kind, entry) => {
    setSelectedContentEntry({ kind, entry });
    setIsRawDataOpen(false);
    setIsDraftEditing(false);
    setDraftForm({});
    setDraftMessage('');
  };

  const getEntrySubtypeValue = (kind, entry) => {
    if (kind === 'Class') return getClassRole(entry);
    if (kind === 'Skill') return getSkillType(entry);
    if (kind === 'Item') return getItemSubtypeKey(entry);
    if (kind === 'Effect') return getEffectType(entry);
    return 'all';
  };

  const entryPassesContentPipeline = (kind, entry, sectionLabel, subtype) => {
    const sectionConfig = contentTypeConfig[sectionLabel];
    if (!sectionConfig || sectionConfig.kind !== kind) return false;
    if (subtype !== 'all' && getEntrySubtypeValue(kind, entry) !== subtype) return false;
    return entryMatchesSearch(kind, entry);
  };

  const resetSectionFilters = () => {
    setClassRoleFilter('all');
    setSkillTypeFilter('all');
    setSkillTargetFilter('all');
    setSkillCooldownFilter('all');
    setItemTypeFilter('all');
    setItemRarityFilter('all');
    setItemPriceFilter('all');
  };

  const normalizeContentSubtype = (sectionLabel, subtype) => {
    if (sectionLabel === 'Items' && subtype !== 'all' && !itemSubtypeKeys.includes(subtype)) return 'all';
    return subtype;
  };

  const handleSelectContentSection = (sectionLabel, subtype = null) => {
    const requestedSubtype = subtype ?? (sectionLabel === 'Items' ? 'equipment' : 'all');
    const nextSubtype = normalizeContentSubtype(sectionLabel, requestedSubtype);
    const selectedPreview = selectedContentEntry
      ? contentDrafts[getContentKey(selectedContentEntry.kind, selectedContentEntry.entry)] || selectedContentEntry.entry
      : null;
    const keepSelected = selectedContentEntry
      && entryPassesContentPipeline(selectedContentEntry.kind, selectedPreview, sectionLabel, nextSubtype);
    setActiveContentType(sectionLabel);
    setActiveContentSubtype(nextSubtype);
    resetSectionFilters();
    if (!keepSelected) {
      setSelectedContentEntry(null);
      setIsDraftEditing(false);
      setDraftForm({});
      setDraftMessage('');
    }
  };

  const startDraftEdit = (kind, entry) => {
    const draftKey = getContentKey(kind, entry);
    setDraftForm(createDraftForm(contentDrafts[draftKey] || entry));
    setIsDraftEditing(true);
    setDraftMessage('Draft changes are local preview only and are not written to game data yet.');
  };

  const setDraftField = (field, value) => {
    setDraftForm(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const getDraftFieldOptions = (kind, fieldKey) => {
    if (kind === 'Skill' && fieldKey === 'type') return skillTypeOptions;
    if (kind === 'Skill' && fieldKey === 'target') return skillTargetOptions;
    if (kind === 'Item' && fieldKey === 'type') return rawItemTypeOptions;
    if (kind === 'Item' && fieldKey === 'rarity') return itemRarityOptions;
    if (kind === 'Effect' && fieldKey === 'Тип') return effectTypeOptions;
    return null;
  };

  const getEffectStackKey = (entry) => EFFECT_STACK_KEYS.find(key => Array.isArray(entry[key]));

  const updateEffectStack = (stackKey, updater) => {
    setDraftForm(prev => ({
      ...prev,
      [stackKey]: updater(prev[stackKey] || []),
    }));
  };

  const getEffectCardKey = (entry, stackKey, index) => `${getContentKey(selectedContentEntry?.kind || 'Skill', entry)}:${stackKey}:${index}`;

  const getEffectTypeLabel = (effect) => effect.type || effect.id || effect.effectType || effect['Тип'] || 'generic effect';

  const getEffectDurationLabel = (effect) => {
    const duration = effect.duration ?? effect.durationTurns ?? effect.turns;
    return duration !== undefined && duration !== '' ? `Duration ${duration}` : '';
  };

  const getEffectStackCountLabel = (effect) => {
    const stackCount = effect.stackCount ?? effect.stacks ?? effect.maxStacks;
    return stackCount !== undefined && stackCount !== '' ? `Stacks ${stackCount}` : '';
  };

  const getEffectSummary = (effect) => {
    const summaryFields = Object.entries(effect)
      .filter(([key, value]) => !['id', 'type', 'effectType', 'Тип', 'duration', 'durationTurns', 'turns', 'stackCount', 'stacks', 'maxStacks'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 2)
      .map(([key, value]) => `${key}: ${value}`);
    return summaryFields.length > 0 ? summaryFields.join(' · ') : `${Object.keys(effect).length} params`;
  };

  const setAllEffectCardsExpanded = (entry, stackKey, stack, isExpanded) => {
    setExpandedEffectCards(prev => stack.reduce((next, _, index) => ({
      ...next,
      [getEffectCardKey(entry, stackKey, index)]: isExpanded,
    }), { ...prev }));
  };

  const hasUnsavedDraftChanges = (entry) => {
    const currentDraft = buildValidatedDraft(entry);
    if (currentDraft.error) return true;
    const savedDraft = contentDrafts[getContentKey(selectedContentEntry?.kind || 'Draft', entry)] || entry;
    return JSON.stringify(currentDraft.draft) !== JSON.stringify(savedDraft);
  };

  const getFieldError = (field) => {
    if (field.valueType === 'number' && !Number.isFinite(Number(draftForm[field.key]))) {
      return 'Enter a valid number.';
    }
    return '';
  };

  const buildValidatedDraft = (entry) => {
    const fields = getEditableDraftFields(entry);
    const nextDraft = { ...entry };
    for (const field of fields) {
      const rawValue = draftForm[field.key];
      if (field.valueType === 'number') {
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) {
          return { error: `Поле ${field.key} должно быть числом.` };
        }
        nextDraft[field.key] = numericValue;
      } else {
        nextDraft[field.key] = rawValue ?? '';
      }
    }
    COMPLEX_DRAFT_KEYS.forEach(key => {
      if (Array.isArray(draftForm[key])) {
        nextDraft[key] = cloneContentValue(draftForm[key]);
      }
    });
    return { draft: nextDraft };
  };

  const draftIdentityExists = (kind, identity, currentKey = '') => {
    const normalizedIdentity = String(identity || '').trim();
    if (!normalizedIdentity) return false;
    const currentOriginalKey = getOriginalKeyFromDraftKey(currentKey);
    const sourceMatch = findSourceContent(kind, normalizedIdentity);
    if (sourceMatch && normalizedIdentity !== currentOriginalKey) return true;
    return Object.entries(contentDrafts).some(([draftKey, draft]) => {
      if (draftKey === currentKey || !draftKey.startsWith(`${kind}:`)) return false;
      return getOriginalKeyFromDraftKey(draftKey) === normalizedIdentity || getDraftIdentity(kind, draft) === normalizedIdentity;
    });
  };

  const createUniqueDraftIdentity = (kind, baseIdentity) => {
    const safeBase = baseIdentity.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'local-draft';
    let candidate = safeBase;
    let index = 2;
    while (draftIdentityExists(kind, candidate)) {
      candidate = `${safeBase}-${index}`;
      index += 1;
    }
    return candidate;
  };

  const createNewLocalDraft = (kind) => {
    if (kind === 'Skill') {
      const template = abilities.find(skill => skill.id && skill.name) || abilities[0] || {};
      const draftId = createUniqueDraftIdentity('Skill', 'local-skill');
      const draftType = activeContentType === 'Skills' && activeContentSubtype !== 'all'
        ? activeContentSubtype
        : skillTypeOptions[0] || template.type || 'skill';
      return {
        ...cloneContentValue(template),
        id: draftId,
        name: 'New Local Skill',
        description: template.description || '',
        type: draftType,
        target: skillTargetOptions[0] || template.target || 'enemy',
        cooldown: Number.isFinite(Number(template.cooldown)) ? Number(template.cooldown) : 0,
      };
    }
    const preferredTemplate = activeContentType === 'Items' && effectiveActiveSubtype !== 'all'
      ? ITEM_DATA.find(item => getItemSubtypeKey(item) === effectiveActiveSubtype)
      : null;
    const template = preferredTemplate || ITEM_DATA.find(item => item.name && item.type) || ITEM_DATA[0] || {};
    const draftName = createUniqueDraftIdentity('Item', 'New Local Item');
    const draftType = activeContentType === 'Items' && effectiveActiveSubtype !== 'all'
      ? getDefaultItemTypeForSubtype(effectiveActiveSubtype)
      : template.type || rawItemTypeOptions[0] || 'item';
    return {
      ...cloneContentValue(template),
      name: draftName,
      description: template.description || '',
      type: draftType,
      rarity: itemRarityOptions[0] || template.rarity || 'Без редкости',
      buyPrice: Number.isFinite(Number(template.buyPrice)) ? Number(template.buyPrice) : 0,
      sellPrice: Number.isFinite(Number(template.sellPrice)) ? Number(template.sellPrice) : 0,
    };
  };

  const validateDraftIdentity = (kind, entry, draft) => {
    const identityField = getIdentityField(kind, draft);
    if (!identityField) return '';
    const identity = String(draft[identityField] || '').trim();
    if (!identity) return `${identityField} is required for local ${kind} drafts.`;
    if (draftIdentityExists(kind, identity, getContentKey(kind, entry))) {
      return `${identityField} must be unique across source content and local drafts.`;
    }
    return '';
  };

  const handleCreateLocalDraft = (kind) => {
    const draft = createNewLocalDraft(kind);
    const draftKey = getContentKey(kind, draft);
    setActiveContentType(kind === 'Skill' ? 'Skills' : 'Items');
    setSkillTypeFilter('all');
    setItemTypeFilter('all');
    setContentDrafts(prev => ({ ...prev, [draftKey]: draft }));
    setSelectedContentEntry({ kind, entry: draft });
    setDraftForm(createDraftForm(draft));
    setIsDraftEditing(true);
    setIsRawDataOpen(false);
    setDraftMessage('New local draft created. Save draft locally after editing; source data is unchanged.');
    setDraftImportMessage(`${kind} local draft created.`);
  };

  const saveContentDraft = (kind, entry) => {
    const { draft, error } = buildValidatedDraft(entry);
    if (error) {
      setDraftMessage(error);
      return;
    }
    const identityError = validateDraftIdentity(kind, entry, draft);
    if (identityError) {
      setDraftMessage(identityError);
      return;
    }
    const draftKey = getContentKey(kind, entry);
    const nextDraftKey = getContentKey(kind, draft);
    setContentDrafts(prev => {
      const nextDrafts = { ...prev };
      if (draftKey !== nextDraftKey) delete nextDrafts[draftKey];
      nextDrafts[nextDraftKey] = draft;
      return nextDrafts;
    });
    const isExistingSourceDraft = Boolean(findSourceContent(kind, getOriginalKeyFromDraftKey(draftKey))) && draftKey === nextDraftKey;
    setSelectedContentEntry({ kind, entry: isExistingSourceDraft ? entry : draft });
    setDraftMessage('Draft saved locally. It is still not written to game data.');
  };

  const deleteNewLocalDraft = (kind, entry) => {
    if (!isNewLocalDraft(kind, entry)) return;
    if (!window.confirm(`Delete this new local ${kind} draft?`)) return;
    const draftKey = getContentKey(kind, entry);
    setContentDrafts(prev => {
      const nextDrafts = { ...prev };
      delete nextDrafts[draftKey];
      return nextDrafts;
    });
    setSelectedContentEntry(null);
    setDraftForm({});
    setIsDraftEditing(false);
    setDraftMessage('New local draft deleted.');
    setDraftImportMessage(`${kind} local draft deleted.`);
  };

  const resetContentDraft = (kind, entry) => {
    const draftKey = getContentKey(kind, entry);
    if (isNewLocalDraft(kind, entry)) {
      const savedLocalDraft = contentDrafts[draftKey] || entry;
      setDraftForm(createDraftForm(savedLocalDraft));
      setSelectedContentEntry({ kind, entry: savedLocalDraft });
      setDraftMessage('New local draft reset to its saved local values. Use Delete new draft to remove it.');
      return;
    }
    setContentDrafts(prev => {
      const nextDrafts = { ...prev };
      delete nextDrafts[draftKey];
      return nextDrafts;
    });
    setDraftForm(createDraftForm(entry));
    setDraftMessage('Local draft reset to original data.');
  };

  const copyDraftJson = (entry) => {
    const { draft, error } = buildValidatedDraft(entry);
    if (error) {
      setDraftMessage(error);
      return;
    }
    navigator.clipboard?.writeText(JSON.stringify(draft, null, 2));
    setDraftMessage('Draft JSON copied.');
  };

  const copyDraftPatch = (entry) => {
    const { draft, error } = buildValidatedDraft(entry);
    if (error) {
      setDraftMessage(error);
      return;
    }
    navigator.clipboard?.writeText(JSON.stringify(buildDraftPatch(entry, draft), null, 2));
    setDraftMessage('Draft JSON patch copied.');
  };

  const createDraftExport = () => Object.entries(contentDrafts).reduce((exportData, [draftKey, draft]) => {
    const separatorIndex = draftKey.indexOf(':');
    const kind = draftKey.slice(0, separatorIndex);
    const originalKey = draftKey.slice(separatorIndex + 1);
    if (kind === 'Skill') {
      return {
        ...exportData,
        skills: { ...exportData.skills, [originalKey]: draft },
      };
    }
    if (kind === 'Item') {
      return {
        ...exportData,
        items: { ...exportData.items, [originalKey]: draft },
      };
    }
    return exportData;
  }, {
    version: 1,
    exportedAt: new Date().toISOString(),
    skills: {},
    items: {},
  });

  const serializeAllDrafts = () => JSON.stringify(createDraftExport(), null, 2);

  const findOriginalContent = (kind, originalKey) => {
    const source = kind === 'Skill' ? abilities : ITEM_DATA;
    return source.find(entry => [entry.id, entry.name, entry.title].filter(Boolean).includes(originalKey));
  };

  const formatPatchValue = (value) => {
    if (value === undefined) return '—';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  };

  const getPatchReview = () => Object.entries(contentDrafts).reduce((review, [draftKey, draft]) => {
    const separatorIndex = draftKey.indexOf(':');
    const kind = draftKey.slice(0, separatorIndex);
    const originalKey = draftKey.slice(separatorIndex + 1);
    if (kind !== 'Skill' && kind !== 'Item') return review;
    const original = findOriginalContent(kind, originalKey) || {};
    const changedFields = Object.keys(draft).reduce((fields, fieldName) => {
      if (original[fieldName] === draft[fieldName]) return fields;
      return [...fields, {
        fieldName,
        originalValue: original[fieldName],
        draftValue: draft[fieldName],
      }];
    }, []);
    if (changedFields.length === 0) return review;
    const entry = {
      key: originalKey,
      title: draft.name || draft.title || original.name || original.title || originalKey,
      changedFields,
    };
    const groupKey = kind === 'Skill' ? 'skills' : 'items';
    return {
      ...review,
      [groupKey]: [...review[groupKey], entry],
      totalEntries: review.totalEntries + 1,
      totalFields: review.totalFields + changedFields.length,
    };
  }, { skills: [], items: [], totalEntries: 0, totalFields: 0 });

  const createMachinePatch = () => {
    const review = getPatchReview();
    const toPatchMap = (entries) => entries.reduce((patchMap, entry) => ({
      ...patchMap,
      [entry.key]: entry.changedFields.reduce((fields, field) => ({
        ...fields,
        [field.fieldName]: field.draftValue,
      }), {}),
    }), {});
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      skills: toPatchMap(review.skills),
      items: toPatchMap(review.items),
    };
  };

  const createHumanReadablePatch = () => {
    const review = getPatchReview();
    if (review.totalEntries === 0) return 'No local draft changes.';
    const renderGroup = (label, entries) => [
      `${label}:`,
      ...entries.flatMap(entry => [
        `- ${entry.title} (${entry.key})`,
        ...entry.changedFields.map(field => `  • ${field.fieldName}: ${formatPatchValue(field.originalValue)} → ${formatPatchValue(field.draftValue)}`),
      ]),
    ].join('\n');
    return [
      `Content draft patch: ${review.totalEntries} entries, ${review.totalFields} fields`,
      renderGroup('Skills', review.skills),
      renderGroup('Items', review.items),
    ].join('\n\n');
  };

  const handleCopyHumanPatch = () => {
    navigator.clipboard?.writeText(createHumanReadablePatch());
    setDraftImportMessage('Human-readable patch copied.');
  };

  const handleCopyMachinePatch = () => {
    navigator.clipboard?.writeText(JSON.stringify(createMachinePatch(), null, 2));
    setDraftImportMessage('Machine JSON patch copied.');
  };

  const handleExportAllDrafts = () => {
    const blob = new Blob([serializeAllDrafts()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ashen-abyss-content-drafts-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDraftImportMessage('Draft export prepared.');
  };

  const handleCopyAllDrafts = () => {
    navigator.clipboard?.writeText(serializeAllDrafts());
    setDraftImportMessage('All local drafts JSON copied.');
  };

  const importDraftGroup = (kind, drafts) => {
    if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) {
      return { error: `${kind} drafts must be an object.` };
    }
    return Object.entries(drafts).reduce((result, [draftKey, draft]) => {
      if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
        return { ...result, error: `${kind} draft ${draftKey} must be an object.` };
      }
      return {
        ...result,
        drafts: { ...result.drafts, [`${kind}:${draftKey}`]: draft },
      };
    }, { drafts: {} });
  };

  const handleImportDrafts = () => {
    try {
      const parsed = JSON.parse(draftImportText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setDraftImportMessage('Import failed: root JSON must be an object.');
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(parsed, 'version') || !parsed.skills || !parsed.items) {
        setDraftImportMessage('Import failed: expected version, skills, and items fields.');
        return;
      }
      const skillImport = importDraftGroup('Skill', parsed.skills);
      if (skillImport.error) {
        setDraftImportMessage(`Import failed: ${skillImport.error}`);
        return;
      }
      const itemImport = importDraftGroup('Item', parsed.items);
      if (itemImport.error) {
        setDraftImportMessage(`Import failed: ${itemImport.error}`);
        return;
      }
      const importedDrafts = { ...skillImport.drafts, ...itemImport.drafts };
      setContentDrafts(prev => ({ ...prev, ...importedDrafts }));
      setDraftImportMessage(`Imported ${Object.keys(importedDrafts).length} local drafts.`);
    } catch (error) {
      setDraftImportMessage(`Import failed: ${error.message}`);
    }
  };

  const handleClearAllDrafts = () => {
    if (!window.confirm('Clear all local Content Database drafts?')) return;
    setContentDrafts({});
    setDraftForm({});
    setIsDraftEditing(false);
    setDraftMessage('');
    setDraftImportMessage('All local drafts cleared.');
  };

  const renderBadge = (label) => (
    <span style={styles.badge}>{label}</span>
  );

  const renderEmptyState = (label) => (
    <div style={styles.emptyState}>
      <strong>No entries in {activeSubtypeLabel} for {label}</strong>
      <p>Try a different left-nav subtype, search term, sort, or section filter.</p>
    </div>
  );

  const getContentTitle = (kind, entry) => entry.name || entry.title || entry.Name || kind;

  const getContentSubtitle = (kind, entry) => {
    if (kind === 'Class') {
      const unlockableText = entry.unlockableAbilityNames?.length
        ? ` · Unlocks: ${entry.unlockableAbilityNames.join(', ')}`
        : '';
      return `${getClassRole(entry)} · ${entry.abilityNames.join(', ')}${unlockableText}`;
    }
    if (kind === 'Skill') return `${getSkillType(entry)} · ${getSkillTarget(entry)} · CD ${entry.cooldown ?? 0}`;
    if (kind === 'Item') return `${getItemSubtype(entry)} · ${getRawItemType(entry)} · ${getItemRarity(entry)} · Buy ${entry.buyPrice ?? '—'}`;
    return `${getEffectType(entry)}`;
  };

  const getContentBadges = (kind, entry) => {
    if (kind === 'Class') {
      return [
        getClassRole(entry),
        `${entry.abilityNames.length} starter skills`,
        entry.unlockableAbilityNames?.length ? `${entry.unlockableAbilityNames.length} unlockable` : null,
      ].filter(Boolean);
    }
    if (kind === 'Skill') return [getSkillType(entry), getSkillTarget(entry), `CD ${entry.cooldown ?? 0}`];
    if (kind === 'Item') return [getItemSubtype(entry), getRawItemType(entry), getItemRarity(entry), `Buy ${entry.buyPrice ?? '—'}`];
    return [getEffectType(entry)];
  };

  const renderMiniBadge = (label, extraStyle = {}) => (
    <span style={{ ...styles.miniBadge, ...extraStyle }}>{label}</span>
  );

  const renderActiveFilters = () => (
    <div style={styles.editorFilterBar}>
      {activeContentType === 'Classes' && activeContentSubtype === 'all' && (
        <select style={styles.searchInput} value={classRoleFilter} onChange={(e) => setClassRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          <option value="Physical">Physical</option>
          <option value="Magic">Magic</option>
          <option value="Speed">Speed</option>
        </select>
      )}
      {activeContentType === 'Skills' && (
        <>
          {activeContentSubtype === 'all' && (
            <select style={styles.searchInput} value={skillTypeFilter} onChange={(e) => setSkillTypeFilter(e.target.value)}>
              <option value="all">All skill types</option>
              {skillTypeOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          )}
          <select style={styles.searchInput} value={skillTargetFilter} onChange={(e) => setSkillTargetFilter(e.target.value)}>
            <option value="all">All targets</option>
            {skillTargetOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <select style={styles.searchInput} value={skillCooldownFilter} onChange={(e) => setSkillCooldownFilter(e.target.value)}>
            <option value="all">Any cooldown</option>
            <option value="0">Cooldown 0</option>
            <option value="1-2">Cooldown 1-2</option>
            <option value="3+">Cooldown 3+</option>
          </select>
        </>
      )}
      {activeContentType === 'Items' && (
        <>
          {effectiveActiveSubtype === 'all' && (
            <select style={styles.searchInput} value={effectiveItemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value)}>
              <option value="all">All item subtypes</option>
              {itemTypeOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          )}
          <select style={styles.searchInput} value={itemRarityFilter} onChange={(e) => setItemRarityFilter(e.target.value)}>
            <option value="all">All rarities</option>
            {itemRarityOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <select style={styles.searchInput} value={itemPriceFilter} onChange={(e) => setItemPriceFilter(e.target.value)}>
            <option value="all">Any price</option>
            <option value="free">No price</option>
            <option value="1-100">1-100</option>
            <option value="101-500">101-500</option>
            <option value="501+">501+</option>
          </select>
        </>
      )}
      <select style={styles.searchInput} value={contentSort} onChange={(e) => setContentSort(e.target.value)}>
        <option value="name">Sort: name</option>
        <option value="type">Sort: type / rarity</option>
      </select>
    </div>
  );

  const renderContentTable = () => {
    const { kind, total } = activeContentConfig;
    const visible = renderedContentRows;
    if (visible.length === 0) return renderEmptyState(activeContentType);
    return (
      <div key={`${selectedNavigationKey}-${visible.length}-${getContentKey(kind, visible[0])}`} style={styles.contentTable}>
        <div style={styles.tableHeader}>
          <span>Name</span>
          <span>Type</span>
          <span>Status</span>
        </div>
        {visible.map(entry => {
          const key = getContentKey(kind, entry);
          const isSelected = selectedContentEntry?.kind === kind && getContentKey(kind, selectedContentEntry.entry) === key;
          const badges = getContentBadges(kind, entry);
          const statusLabel = isNewLocalDraft(kind, entry) ? 'New local draft' : contentDrafts[key] ? 'Local draft' : 'Source';
          return (
            <button
              key={key}
              type="button"
              style={isSelected ? { ...styles.tableRow, ...styles.tableRowSelected } : styles.tableRow}
              onClick={() => openContentDetail(kind, entry)}
            >
              <span>
                <strong>{getContentTitle(kind, entry)}</strong>
                <small>{getContentSubtitle(kind, entry)}</small>
              </span>
              <span style={styles.tableBadgeGroup}>{badges.map((badge, index) => <span key={`${badge}-${index}`} style={styles.miniBadge}>{badge}</span>)}</span>
              <span style={styles.tableBadgeGroup}>{renderMiniBadge(statusLabel, statusLabel === 'Source' ? styles.sourceBadge : styles.localDraftMiniBadge)}{renderMiniBadge(`${visible.length}/${total}`)}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderInspectorSection = (title, children, open = true) => (
    <details style={styles.inspectorSection} open={open}>
      <summary style={styles.inspectorSummary}>{title}</summary>
      <div style={styles.inspectorSectionBody}>{children}</div>
    </details>
  );

  const isDraftFieldModified = (entry, fieldKey) => draftForm[fieldKey] !== undefined && entry[fieldKey] !== draftForm[fieldKey];

  const renderDraftField = (kind, entry, field) => {
    const fieldOptions = getDraftFieldOptions(kind, field.key);
    const isModified = isDraftFieldModified(entry, field.key);
    const fieldError = getFieldError(field);
    return (
      <label key={field.key} style={isModified ? { ...styles.draftField, ...styles.modifiedDraftField } : styles.draftField}>
        <span>
          {field.key}
          {isModified && <button style={styles.resetFieldButton} onClick={() => setDraftField(field.key, entry[field.key])}>Reset</button>}
        </span>
        {field.key === 'description' || field.key === 'Описание' ? (
          <textarea
            style={styles.smallTextarea}
            value={draftForm[field.key] ?? ''}
            onChange={(e) => setDraftField(field.key, e.target.value)}
          />
        ) : fieldOptions ? (
          <select
            style={styles.searchInput}
            value={draftForm[field.key] ?? ''}
            onChange={(e) => setDraftField(field.key, e.target.value)}
          >
            {fieldOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : (
          <input
            style={styles.searchInput}
            type={field.valueType === 'number' ? 'number' : 'text'}
            value={draftForm[field.key] ?? ''}
            onChange={(e) => setDraftField(field.key, e.target.value)}
          />
        )}
        {fieldError && <small style={styles.fieldError}>{fieldError}</small>}
      </label>
    );
  };

  const renderDamageEditor = (entry) => {
    if (!Array.isArray(entry.damage) && !Array.isArray(draftForm.damage)) return null;
    const damageRows = draftForm.damage || [];
    return renderInspectorSection('Scaling', (
      <div style={styles.effectStack}>
        {damageRows.map((damage, index) => (
          <div key={`damage-${index}`} style={styles.effectCard}>
            <label style={styles.draftField}>
              <span>damage type</span>
              <select
                style={styles.searchInput}
                value={damage.type || ''}
                onChange={(e) => setDraftField('damage', damageRows.map((row, rowIndex) => rowIndex === index ? { ...row, type: e.target.value } : row))}
              >
                {damageTypeOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label style={styles.draftField}>
              <span>scaling formula</span>
              <input
                style={styles.searchInput}
                value={damage.formula || ''}
                onChange={(e) => setDraftField('damage', damageRows.map((row, rowIndex) => rowIndex === index ? { ...row, formula: e.target.value } : row))}
              />
            </label>
            <label style={styles.draftField}>
              <span>scaling stat hint</span>
              <select style={styles.searchInput} value={scalingStatOptions.find(option => (damage.formula || '').includes(option)) || ''} onChange={(e) => setDraftField('damage', damageRows.map((row, rowIndex) => rowIndex === index ? { ...row, formula: e.target.value || row.formula } : row))}>
                <option value="">Keep formula</option>
                {scalingStatOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
        ))}
      </div>
    ));
  };

  const renderEffectStackEditor = (entry) => {
    const stackKey = getEffectStackKey(entry) || getEffectStackKey(draftForm);
    if (!stackKey) return renderInspectorSection('Effects', <p style={styles.databaseMeta}>No effect stack on this ability.</p>);
    const stack = draftForm[stackKey] || [];
    const createEmptyEffect = () => ({ id: effectReferenceOptions[0] || 'effect', duration: 1 });
    return renderInspectorSection('Effects', (
      <div style={styles.effectStack}>
        <div style={styles.effectStackToolbar}>
          <button style={styles.secondaryButton} onClick={() => updateEffectStack(stackKey, prev => [...prev, createEmptyEffect()])}>Add effect</button>
          <button style={styles.tinyButton} onClick={() => setAllEffectCardsExpanded(entry, stackKey, stack, true)} disabled={stack.length === 0}>Expand all</button>
          <button style={styles.tinyButton} onClick={() => setAllEffectCardsExpanded(entry, stackKey, stack, false)} disabled={stack.length === 0}>Collapse all</button>
        </div>
        {stack.length === 0 && (
          <div style={styles.emptyState}>
            <strong>No effects in this stack</strong>
            <p>Add an effect component to start drafting this ability behavior.</p>
          </div>
        )}
        {stack.map((effect, index) => {
          const cardKey = getEffectCardKey(entry, stackKey, index);
          const isExpanded = Boolean(expandedEffectCards[cardKey]);
          const durationLabel = getEffectDurationLabel(effect);
          const stackCountLabel = getEffectStackCountLabel(effect);
          return (
            <article key={`${stackKey}-${index}`} style={styles.effectCard}>
              <div style={styles.effectCardHeader}>
                <button
                  type="button"
                  style={styles.effectExpandButton}
                  onClick={() => setExpandedEffectCards(prev => ({ ...prev, [cardKey]: !isExpanded }))}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
                <div style={styles.effectHeaderText}>
                  <strong>#{index + 1} · {getEffectTypeLabel(effect)}</strong>
                  <p style={styles.effectSummary}>{getEffectSummary(effect)}</p>
                  <div style={styles.tableBadgeGroup}>
                    {durationLabel && renderMiniBadge(durationLabel)}
                    {stackCountLabel && renderMiniBadge(stackCountLabel)}
                  </div>
                </div>
                <div style={styles.effectCardActions}>
                  <button style={{ ...styles.tinyButton, ...styles.duplicateButton }} onClick={() => updateEffectStack(stackKey, prev => prev.map((item, itemIndex) => itemIndex === index ? cloneContentValue(effect) : item).flatMap((item, itemIndex) => itemIndex === index ? [item, cloneContentValue(item)] : [item]))}>Duplicate</button>
                  <button style={{ ...styles.tinyButton, ...styles.dangerButton }} onClick={() => {
                    if (Object.keys(effect).length > 1 && !window.confirm('Remove this effect component?')) return;
                    updateEffectStack(stackKey, prev => prev.filter((_, itemIndex) => itemIndex !== index));
                  }}>Remove</button>
                  <button style={{ ...styles.tinyButton, ...styles.moveButton }} onClick={() => updateEffectStack(stackKey, prev => prev.map((item, itemIndex, arr) => itemIndex === index - 1 ? arr[index] : itemIndex === index ? arr[index - 1] : item))} disabled={index === 0}>↑</button>
                  <button style={{ ...styles.tinyButton, ...styles.moveButton }} onClick={() => updateEffectStack(stackKey, prev => prev.map((item, itemIndex, arr) => itemIndex === index ? arr[index + 1] : itemIndex === index + 1 ? arr[index] : item))} disabled={index === stack.length - 1}>↓</button>
                </div>
              </div>
              {isExpanded && (
                <div style={styles.draftGrid}>
                  {Object.entries(effect).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => {
                    const options = key === 'id' || key === 'type' ? effectReferenceOptions : null;
                    return (
                      <label key={key} style={styles.draftField}>
                        <span>{key}</span>
                        {options ? (
                          <select
                            style={styles.searchInput}
                            value={value ?? ''}
                            onChange={(e) => updateEffectStack(stackKey, prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: e.target.value } : item))}
                          >
                            {options.map(option => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input
                            style={styles.searchInput}
                            type={typeof value === 'number' ? 'number' : 'text'}
                            value={value ?? ''}
                            onChange={(e) => updateEffectStack(stackKey, prev => prev.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: typeof value === 'number' ? toNumber(e.target.value, value) : e.target.value } : item))}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
    ));
  };

  const renderSkillAbilityEditor = (entry, previewEntry, draftFields) => (
    <div>
      <div>{renderBadge(previewEntry.type || 'skill')}{renderBadge(previewEntry.target || 'target varies')}{renderBadge(`CD ${previewEntry.cooldown ?? 0}`)}</div>
      <p style={styles.databaseDescription}>{previewEntry.description || 'Описание появится позже.'}</p>
      {renderInspectorSection('Identity', isDraftEditing ? (
        <div style={styles.draftGrid}>{draftFields.filter(field => ['id', 'key', 'name', 'title', 'description'].includes(field.key)).map(field => renderDraftField('Skill', entry, field))}</div>
      ) : (
        <p style={styles.databaseDescription}>{previewEntry.name || previewEntry.title}</p>
      ))}
      {renderInspectorSection('Targeting', isDraftEditing ? (
        <div style={styles.draftGrid}>{draftFields.filter(field => ['type', 'target'].includes(field.key)).map(field => renderDraftField('Skill', entry, field))}</div>
      ) : (
        <div>{renderBadge(previewEntry.type || 'skill')}{renderBadge(previewEntry.target || 'target varies')}</div>
      ))}
      {renderInspectorSection('Timing', isDraftEditing ? (
        <div style={styles.draftGrid}>{draftFields.filter(field => ['cooldown'].includes(field.key)).map(field => renderDraftField('Skill', entry, field))}</div>
      ) : (
        <p style={styles.databaseMeta}>Cooldown: {previewEntry.cooldown ?? 0}</p>
      ))}
      {isDraftEditing ? renderDamageEditor(entry) : renderInspectorSection('Scaling', <pre style={styles.rawData}>{JSON.stringify(previewEntry.damage || [], null, 2)}</pre>)}
      {isDraftEditing ? renderEffectStackEditor(entry) : renderInspectorSection('Effects', <pre style={styles.rawData}>{JSON.stringify(previewEntry.effects || previewEntry.effectList || previewEntry.actions || [], null, 2)}</pre>)}
    </div>
  );

  const renderBuffDebuffInspector = (entry, previewEntry, draftFields) => (
    <div>
      <div>{renderBadge(previewEntry['Тип'] || 'effect')}</div>
      <p style={styles.databaseDescription}>{previewEntry['Описание'] || 'Описание появится позже.'}</p>
      {renderInspectorSection('Identity', isDraftEditing ? (
        <div style={styles.draftGrid}>{draftFields.filter(field => ['Name', 'Описание'].includes(field.key)).map(field => renderDraftField('Effect', entry, field))}</div>
      ) : (
        <p style={styles.databaseDescription}>{previewEntry.Name}</p>
      ))}
      {renderInspectorSection('Type / Visual', isDraftEditing ? (
        <div style={styles.draftGrid}>{draftFields.filter(field => ['Тип', 'Иконка'].includes(field.key)).map(field => renderDraftField('Effect', entry, field))}</div>
      ) : (
        <div>{renderBadge(previewEntry['Тип'] || 'effect')}</div>
      ))}
      {renderInspectorSection('Gameplay Parameters', isDraftEditing ? (
        <div style={styles.draftGrid}>{draftFields.filter(field => !['Name', 'Описание', 'Тип', 'Иконка'].includes(field.key)).map(field => renderDraftField('Effect', entry, field))}</div>
      ) : (
        <pre style={styles.rawData}>{JSON.stringify(previewEntry, null, 2)}</pre>
      ))}
    </div>
  );

  const renderPatchReview = () => {
    const review = getPatchReview();
    const renderGroup = (label, entries) => (
      <section style={styles.patchGroup}>
        <h5 style={styles.cardTitle}>{label}</h5>
        {entries.length === 0 ? (
          <p style={styles.databaseMeta}>No changed {label.toLowerCase()} drafts.</p>
        ) : entries.map(entry => (
          <article key={entry.key} style={styles.patchEntry}>
            <h6 style={styles.patchEntryTitle}>{entry.title}</h6>
            {entry.changedFields.map(field => (
              <div key={field.fieldName} style={styles.diffRow}>
                <strong style={styles.diffField}>{field.fieldName}</strong>
                <span style={styles.diffValue}>{formatPatchValue(field.originalValue)}</span>
                <span style={styles.diffArrow}>→</span>
                <span style={styles.diffValue}>{formatPatchValue(field.draftValue)}</span>
              </div>
            ))}
          </article>
        ))}
      </section>
    );

    return (
      <div style={styles.patchReviewPanel}>
        <div style={styles.toolbarHeader}>
          <div>
            <h4 style={styles.databaseTitle}>Content Patch Review</h4>
            <p style={styles.databaseMeta}>{review.totalEntries} changed entries · {review.totalFields} changed fields</p>
          </div>
          <div style={styles.actionRow}>
            <button style={styles.tinyButton} onClick={handleCopyHumanPatch}>Copy human-readable patch</button>
            <button style={styles.tinyButton} onClick={handleCopyMachinePatch}>Copy machine JSON patch</button>
          </div>
        </div>
        {review.totalEntries === 0 ? (
          <div style={styles.emptyState}>
            <strong>No draft changes yet</strong>
            <p>Save a Skill or Item draft to review its patch here.</p>
          </div>
        ) : (
          <div>
            {renderGroup('Skills', review.skills)}
            {renderGroup('Items', review.items)}
          </div>
        )}
      </div>
    );
  };

  const renderContentDetail = () => {
    if (!selectedContentEntry) return null;
    const { kind, entry } = selectedContentEntry;
    const draftKey = getContentKey(kind, entry);
    const savedDraft = contentDrafts[draftKey];
    const previewEntry = savedDraft || entry;
    const title = previewEntry.name || previewEntry.title || previewEntry.Name || kind;
    const isNewDraftEntry = isNewLocalDraft(kind, previewEntry);
    const canEditDraft = kind === 'Skill' || kind === 'Item' || kind === 'Effect';
    const draftFields = canEditDraft ? getEditableDraftFields(entry) : [];
    const draftPatch = savedDraft ? buildDraftPatch(entry, savedDraft) : null;
    const hasUnsavedChanges = canEditDraft && isDraftEditing && hasUnsavedDraftChanges(entry);

    return (
      <aside style={styles.detailPanel}>
        <div style={styles.detailHeader}>
          <div>
            <p style={styles.databaseMeta}>{kind}{isNewDraftEntry ? ' · new local draft' : savedDraft ? ' · local draft' : ''}</p>
            <h4 style={styles.editorTitle}>{title}</h4>
          </div>
          <button style={styles.tinyButton} onClick={() => setSelectedContentEntry(null)}>×</button>
        </div>
        {canEditDraft && (
          <div style={styles.inspectorActionBar}>
            <p style={styles.draftWarning}>Draft changes are local preview only and are not written to game data yet.</p>
            {hasUnsavedChanges && <strong style={styles.unsavedIndicator}>Unsaved draft changes</strong>}
            {!isDraftEditing ? (
              <button style={styles.secondaryButton} onClick={() => startDraftEdit(kind, entry)}>Edit draft</button>
            ) : (
              <div style={styles.actionRow}>
                <button style={styles.secondaryButton} onClick={() => saveContentDraft(kind, entry)}>Save draft locally</button>
                <button style={styles.tinyButton} onClick={() => resetContentDraft(kind, entry)}>Reset draft</button>
                <button style={styles.tinyButton} onClick={() => copyDraftJson(entry)}>Copy JSON</button>
                <button style={styles.tinyButton} onClick={() => copyDraftPatch(entry)}>Copy JSON patch</button>
                {isNewDraftEntry && <button style={{ ...styles.tinyButton, ...styles.dangerButton }} onClick={() => deleteNewLocalDraft(kind, previewEntry)}>Delete new draft</button>}
              </div>
            )}
            {isNewDraftEntry && <span style={styles.newDraftBadge}>New local draft</span>}
            {draftMessage && <p style={styles.message}>{draftMessage}</p>}
          </div>
        )}
        {kind === 'Class' && (
          <div style={styles.classPreview}>
            <img
              src={entry.portrait}
              alt={entry.name}
              style={styles.previewPortrait}
              onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.player)}
            />
            <div>
              <p style={styles.databaseMeta}>Role: {getClassRole(entry)}</p>
              <p style={styles.databaseDescription}>Starter skills: {entry.abilityNames.join(', ')}</p>
              {entry.unlockableAbilityNames?.length > 0 && (
                <p style={styles.databaseDescription}>Unlockable skills: {entry.unlockableAbilityNames.join(', ')}</p>
              )}
            </div>
          </div>
        )}
        {kind === 'Skill' && renderSkillAbilityEditor(entry, previewEntry, draftFields)}
        {kind === 'Item' && (
          <div>
            <div>{renderBadge(previewEntry.type || 'item')}{renderBadge(previewEntry.rarity || 'Без редкости')}</div>
            <p style={styles.databaseMeta}>Buy {previewEntry.buyPrice ?? '—'} · Sell {previewEntry.sellPrice ?? '—'}</p>
            <p style={styles.databaseDescription}>{previewEntry.description || 'Описание появится позже.'}</p>
          </div>
        )}
        {kind === 'Effect' && renderBuffDebuffInspector(entry, previewEntry, draftFields)}

        {canEditDraft && isDraftEditing && kind === 'Item' && (
          <div style={styles.draftPanel}>
            <div style={styles.draftGrid}>
              {draftFields.map(field => renderDraftField(kind, entry, field))}
            </div>
          </div>
        )}

        <button style={styles.secondaryButton} onClick={() => setIsRawDataOpen(prev => !prev)}>
          {isRawDataOpen ? 'Hide raw data' : 'Raw data'}
        </button>
        {isRawDataOpen && (
          <div>
            <p style={styles.databaseMeta}>Original data</p>
            <pre style={styles.rawData}>{JSON.stringify(entry, null, 2)}</pre>
            {savedDraft && (
              <>
                <p style={styles.databaseMeta}>Draft data</p>
                <pre style={styles.rawData}>{JSON.stringify(savedDraft, null, 2)}</pre>
                <p style={styles.databaseMeta}>Draft patch</p>
                <pre style={styles.rawData}>{JSON.stringify(draftPatch, null, 2)}</pre>
              </>
            )}
          </div>
        )}
      </aside>
    );
  };

  const handleSubmit = () => {
    const characterName = accountName || name;
    if (!characterName.trim()) {
      pushToast('Введите имя персонажа', { tone: 'warning' });
      return;
    }
    try {
      const canonicalCharacter = createProductionFreshCharacter({ name: characterName, classId: selectedClass, classProgression });
      const characterDraft = { ...canonicalCharacter, ...appliedDeveloperPatch };
      const equipmentPatch = applyEquipmentPatch(characterDraft, canonicalCharacter.equipment, characterDraft.inventory || []);
      onCharacterSelect(applyClassLoadoutToPlayer({
        ...characterDraft,
        ...equipmentPatch,
        classProgression: ensureClassProgression(classProgression, characterDraft),
      }, classProgression));
    } catch (error) {
      console.warn('Ошибка подготовки персонажа', error);
      pushToast('Не удалось создать персонажа. Повторите попытку.', { tone: 'error' });
    }
  };

  const styles = {
    container: {
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
      maxWidth: '100%',
      boxSizing: 'border-box',
      backgroundColor: '#1a1a1a',
      color: '#ffffff',
    },
    portrait: {
      width: '150px',
      height: '150px',
      margin: '20px auto',
      border: '2px solid #ccc',
      borderRadius: '5px',
      objectFit: 'cover',
    },
    classMechanic: {
      maxWidth: '520px',
      margin: '0 auto 12px',
      color: '#f6d58d',
      fontSize: '14px',
      lineHeight: 1.4,
    },
    input: {
      padding: '5px',
      margin: '10px',
      fontSize: '16px',
      width: '80%',
      maxWidth: '300px',
      backgroundColor: '#333',
      color: '#fff',
      border: '1px solid #555',
    },
    select: {
      padding: '5px',
      margin: '10px',
      fontSize: '16px',
      width: '80%',
      maxWidth: '300px',
      backgroundColor: '#333',
      color: '#fff',
      border: '1px solid #555',
    },
    button: {
      padding: '10px 20px',
      fontSize: '16px',
      cursor: 'pointer',
      backgroundColor: '#4CAF50',
      color: '#ffffff',
      border: 'none',
      borderRadius: '5px',
      margin: '10px',
    },
    developerButton: {
      backgroundColor: '#6f42c1',
    },
    developerEditor: {
      margin: '20px auto',
      padding: '18px',
      maxWidth: '900px',
      background: 'linear-gradient(145deg, #1b1428, #281b36 55%, #17110f)',
      border: '1px solid #9b6cff',
      borderRadius: '14px',
      boxShadow: '0 0 24px rgba(111, 66, 193, 0.35)',
      textAlign: 'left',
    },
    editorHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '16px',
      alignItems: 'center',
      flexWrap: 'wrap',
      borderBottom: '1px solid rgba(255, 203, 107, 0.25)',
      paddingBottom: '12px',
      marginBottom: '16px',
    },
    editorTitle: {
      margin: 0,
      color: '#ffcb6b',
      letterSpacing: '0.04em',
    },
    editorSubtitle: {
      margin: '6px 0 0',
      color: '#c9b8ff',
      fontSize: '14px',
    },
    editorTabs: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      marginBottom: '16px',
    },
    editorTab: {
      padding: '9px 14px',
      cursor: 'pointer',
      backgroundColor: '#21182f',
      color: '#c9b8ff',
      border: '1px solid #5c447c',
      borderRadius: '999px',
      fontWeight: 'bold',
    },
    editorTabActive: {
      backgroundColor: '#6f42c1',
      color: '#fff7dd',
      borderColor: '#ffcb6b',
      boxShadow: '0 0 12px rgba(255, 203, 107, 0.25)',
    },
    editorGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: '14px',
    },
    editorCard: {
      padding: '14px',
      backgroundColor: 'rgba(8, 8, 16, 0.72)',
      border: '1px solid rgba(255, 203, 107, 0.22)',
      borderRadius: '12px',
    },
    desktopEditor: {
      display: 'grid',
      gridTemplateColumns: '190px minmax(320px, 1fr) minmax(300px, 380px)',
      gap: '14px',
      alignItems: 'start',
    },
    editorNavPanel: {
      position: 'sticky',
      top: '12px',
      padding: '12px',
      backgroundColor: 'rgba(10, 7, 18, 0.9)',
      border: '1px solid rgba(155, 108, 255, 0.28)',
      borderRadius: '14px',
    },
    editorCenterPanel: {
      minWidth: 0,
    },
    editorInspectorPanel: {
      position: 'sticky',
      top: '12px',
      maxHeight: '82vh',
      overflow: 'auto',
      padding: '12px',
      backgroundColor: 'rgba(10, 7, 18, 0.92)',
      border: '1px solid rgba(255, 203, 107, 0.3)',
      borderRadius: '14px',
    },
    editorListPanel: {
      padding: '12px',
      backgroundColor: 'rgba(18, 13, 28, 0.82)',
      border: '1px solid rgba(155, 108, 255, 0.22)',
      borderRadius: '14px',
    },
    navTreeGroup: {
      marginBottom: '8px',
    },
    navTreeButton: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      margin: '6px 0',
      padding: '10px',
      color: '#f0e7ff',
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '10px',
      cursor: 'pointer',
      textAlign: 'left',
      gap: '8px',
    },
    navTreeButtonActive: {
      color: '#1d1203',
      backgroundColor: '#ffcb6b',
      borderColor: '#ffdf95',
      boxShadow: '0 0 12px rgba(255, 203, 107, 0.22)',
    },
    navSubtree: {
      marginLeft: '10px',
      paddingLeft: '10px',
      borderLeft: '1px solid rgba(255, 203, 107, 0.24)',
    },
    navSubtreeLabel: {
      margin: '8px 0 4px',
      color: '#ffcb6b',
      fontSize: '11px',
      fontWeight: 'bold',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
    navSubtreeButton: {
      padding: '7px 9px',
      margin: '4px 0',
      fontSize: '12px',
      borderRadius: '8px',
    },
    editorFilterBar: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: '10px',
      margin: '10px 0',
    },
    contentTable: {
      maxHeight: '58vh',
      overflow: 'auto',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '12px',
    },
    tableHeader: {
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 1.4fr) minmax(120px, 0.8fr) minmax(90px, 0.6fr)',
      gap: '10px',
      padding: '10px 12px',
      color: '#ffcb6b',
      backgroundColor: 'rgba(10, 7, 18, 0.95)',
      position: 'sticky',
      top: 0,
      zIndex: 1,
      fontSize: '12px',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    },
    tableRow: {
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 1.4fr) minmax(120px, 0.8fr) minmax(90px, 0.6fr)',
      gap: '10px',
      width: '100%',
      padding: '11px 12px',
      color: '#f0e7ff',
      backgroundColor: 'rgba(18, 13, 28, 0.72)',
      border: 0,
      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
      cursor: 'pointer',
      textAlign: 'left',
    },
    tableRowSelected: {
      backgroundColor: 'rgba(255, 203, 107, 0.16)',
      boxShadow: 'inset 3px 0 0 #ffcb6b',
      outline: '1px solid rgba(255, 203, 107, 0.32)',
    },
    tableBadgeGroup: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '5px',
      alignItems: 'center',
    },
    miniBadge: {
      display: 'inline-block',
      padding: '3px 7px',
      color: '#e8def8',
      backgroundColor: 'rgba(155, 108, 255, 0.16)',
      border: '1px solid rgba(155, 108, 255, 0.28)',
      borderRadius: '999px',
      fontSize: '11px',
      lineHeight: 1.2,
    },
    sourceBadge: {
      color: '#bdeac6',
      backgroundColor: 'rgba(61, 132, 82, 0.16)',
      borderColor: 'rgba(127, 220, 151, 0.32)',
    },
    localDraftMiniBadge: {
      color: '#1d1203',
      backgroundColor: '#ffcb6b',
      borderColor: '#ffdf95',
      fontWeight: 'bold',
    },
    databaseSection: {
      marginBottom: '18px',
    },
    databaseTitle: {
      margin: '0 0 10px',
      color: '#ffcb6b',
      letterSpacing: '0.03em',
    },
    databaseGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: '12px',
    },
    databaseCard: {
      padding: '12px',
      backgroundColor: 'rgba(14, 11, 24, 0.82)',
      border: '1px solid rgba(155, 108, 255, 0.32)',
      borderRadius: '12px',
      boxShadow: 'inset 0 0 18px rgba(0, 0, 0, 0.25)',
      cursor: 'pointer',
      textAlign: 'left',
    },
    databaseMeta: {
      margin: '5px 0',
      color: '#c9b8ff',
      fontSize: '13px',
    },
    databaseDescription: {
      margin: '8px 0 0',
      color: '#f0e7ff',
      fontSize: '13px',
      lineHeight: 1.35,
    },
    filterBar: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
      gap: '10px',
      margin: '12px 0',
      padding: '12px',
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 203, 107, 0.14)',
      borderRadius: '10px',
    },
    searchInput: {
      padding: '9px',
      backgroundColor: '#120d1c',
      color: '#fff',
      border: '1px solid #5b4b79',
      borderRadius: '7px',
    },
    badge: {
      display: 'inline-block',
      margin: '3px 5px 3px 0',
      padding: '3px 8px',
      color: '#1d1203',
      backgroundColor: '#ffcb6b',
      borderRadius: '999px',
      fontSize: '12px',
      fontWeight: 'bold',
    },
    countPill: {
      display: 'inline-block',
      marginLeft: '8px',
      color: '#c9b8ff',
      fontSize: '13px',
      fontWeight: 'normal',
    },
    emptyState: {
      padding: '18px',
      color: '#c9b8ff',
      backgroundColor: 'rgba(155, 108, 255, 0.08)',
      border: '1px dashed rgba(255, 203, 107, 0.4)',
      borderRadius: '12px',
      textAlign: 'center',
    },
    detailPanel: {
      marginTop: '16px',
      padding: '16px',
      backgroundColor: 'rgba(10, 7, 18, 0.94)',
      border: '1px solid rgba(255, 203, 107, 0.35)',
      borderRadius: '14px',
      boxShadow: '0 0 22px rgba(0, 0, 0, 0.35)',
    },
    detailHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      alignItems: 'flex-start',
      marginBottom: '10px',
    },
    rawData: {
      maxHeight: '260px',
      overflow: 'auto',
      padding: '12px',
      color: '#d9c8ff',
      backgroundColor: '#09070f',
      border: '1px solid #3d3155',
      borderRadius: '8px',
      fontSize: '12px',
    },
    draftPanel: {
      margin: '14px 0',
      padding: '14px',
      backgroundColor: 'rgba(255, 203, 107, 0.07)',
      border: '1px solid rgba(255, 203, 107, 0.22)',
      borderRadius: '12px',
    },
    inspectorActionBar: {
      position: 'sticky',
      top: 0,
      zIndex: 3,
      margin: '0 0 12px',
      padding: '12px',
      backgroundColor: 'rgba(18, 13, 28, 0.96)',
      border: '1px solid rgba(255, 203, 107, 0.3)',
      borderRadius: '12px',
      boxShadow: '0 8px 18px rgba(0, 0, 0, 0.28)',
    },
    unsavedIndicator: {
      display: 'inline-block',
      marginBottom: '6px',
      padding: '4px 8px',
      color: '#1d1203',
      backgroundColor: '#ffcb6b',
      borderRadius: '999px',
      fontSize: '12px',
    },
    newDraftBadge: {
      display: 'inline-block',
      marginTop: '8px',
      padding: '4px 9px',
      color: '#201103',
      background: 'linear-gradient(135deg, #ffd36d, #c7832f)',
      border: '1px solid rgba(255, 238, 176, 0.55)',
      borderRadius: '999px',
      fontSize: '12px',
      fontWeight: 'bold',
    },
    draftWarning: {
      margin: '0 0 10px',
      color: '#ffdf95',
      fontSize: '13px',
      lineHeight: 1.35,
    },
    draftGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '10px',
    },
    draftField: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      color: '#c9b8ff',
      fontSize: '13px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    },
    smallTextarea: {
      minHeight: '84px',
      padding: '9px',
      backgroundColor: '#120d1c',
      color: '#fff',
      border: '1px solid #5b4b79',
      borderRadius: '7px',
      resize: 'vertical',
    },
    actionRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      marginTop: '12px',
    },
    inspectorSection: {
      margin: '12px 0',
      padding: '0 0 10px',
      backgroundColor: 'rgba(18, 13, 28, 0.62)',
      border: '1px solid rgba(155, 108, 255, 0.2)',
      borderRadius: '12px',
      overflow: 'hidden',
    },
    inspectorSummary: {
      padding: '10px 12px',
      color: '#ffcb6b',
      backgroundColor: 'rgba(10, 7, 18, 0.72)',
      cursor: 'pointer',
      fontWeight: 'bold',
    },
    inspectorSectionBody: {
      padding: '12px',
    },
    modifiedDraftField: {
      borderLeft: '3px solid #ffcb6b',
      paddingLeft: '8px',
      backgroundColor: 'rgba(255, 203, 107, 0.05)',
    },
    fieldError: {
      color: '#ff8d8d',
      fontSize: '12px',
      textTransform: 'none',
      letterSpacing: 0,
    },
    resetFieldButton: {
      marginLeft: '8px',
      padding: '2px 6px',
      color: '#1d1203',
      backgroundColor: '#ffcb6b',
      border: 0,
      borderRadius: '999px',
      cursor: 'pointer',
      fontSize: '10px',
    },
    effectStack: {
      display: 'grid',
      gap: '10px',
    },
    effectCard: {
      padding: '12px',
      backgroundColor: 'rgba(38, 24, 58, 0.86)',
      border: '1px solid rgba(255, 203, 107, 0.22)',
      borderRadius: '12px',
      boxShadow: 'inset 0 0 18px rgba(0, 0, 0, 0.24)',
    },
    effectStackToolbar: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    effectCardHeader: {
      display: 'grid',
      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
      gap: '10px',
      alignItems: 'start',
    },
    effectExpandButton: {
      width: '30px',
      height: '30px',
      color: '#ffcb6b',
      backgroundColor: 'rgba(255, 203, 107, 0.08)',
      border: '1px solid rgba(255, 203, 107, 0.3)',
      borderRadius: '8px',
      cursor: 'pointer',
      fontWeight: 'bold',
    },
    effectHeaderText: {
      minWidth: 0,
      color: '#f0e7ff',
    },
    effectCardActions: {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
    },
    effectSummary: {
      margin: '4px 0 0',
      color: '#c9b8ff',
      fontSize: '12px',
    },
    duplicateButton: {
      borderColor: '#6aa6ff',
      color: '#b8d6ff',
    },
    dangerButton: {
      borderColor: '#b85f5f',
      color: '#ffb8b8',
    },
    moveButton: {
      borderColor: '#6f8f5f',
      color: '#d4ffc0',
    },
    draftsToolbar: {
      marginBottom: '14px',
      padding: '14px',
      background: 'linear-gradient(135deg, rgba(48, 29, 76, 0.9), rgba(18, 13, 28, 0.94))',
      border: '1px solid rgba(255, 203, 107, 0.28)',
      borderRadius: '14px',
      boxShadow: 'inset 0 0 20px rgba(255, 203, 107, 0.05)',
    },
    toolbarHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '10px',
      flexWrap: 'wrap',
    },
    importPanel: {
      marginTop: '12px',
      padding: '12px',
      backgroundColor: 'rgba(10, 7, 18, 0.78)',
      border: '1px solid rgba(155, 108, 255, 0.28)',
      borderRadius: '10px',
    },
    patchReviewPanel: {
      marginTop: '12px',
      padding: '14px',
      backgroundColor: 'rgba(10, 7, 18, 0.88)',
      border: '1px solid rgba(255, 203, 107, 0.3)',
      borderRadius: '12px',
      boxShadow: 'inset 0 0 18px rgba(155, 108, 255, 0.08)',
    },
    patchGroup: {
      marginTop: '12px',
    },
    patchEntry: {
      marginBottom: '10px',
      padding: '12px',
      backgroundColor: 'rgba(48, 29, 76, 0.48)',
      border: '1px solid rgba(155, 108, 255, 0.22)',
      borderRadius: '10px',
    },
    patchEntryTitle: {
      margin: '0 0 8px',
      color: '#ffdf95',
      fontSize: '14px',
    },
    diffRow: {
      display: 'grid',
      gridTemplateColumns: '130px minmax(0, 1fr) auto minmax(0, 1fr)',
      gap: '8px',
      alignItems: 'start',
      padding: '7px 0',
      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    },
    diffField: {
      color: '#ffcb6b',
      fontSize: '13px',
    },
    diffValue: {
      color: '#f0e7ff',
      fontSize: '13px',
      wordBreak: 'break-word',
    },
    diffArrow: {
      color: '#c9b8ff',
      fontWeight: 'bold',
    },
    cardTitle: {
      margin: '0 0 12px',
      color: '#ffcb6b',
      fontSize: '16px',
    },
    fieldRow: {
      display: 'grid',
      gridTemplateColumns: '1fr auto auto auto',
      gap: '8px',
      alignItems: 'center',
      marginBottom: '10px',
    },
    fieldLabel: {
      color: '#e8def8',
      fontSize: '14px',
    },
    smallInput: {
      width: '88px',
      padding: '7px',
      backgroundColor: '#130f1f',
      color: '#fff',
      border: '1px solid #5b4b79',
      borderRadius: '6px',
    },
    tinyButton: {
      padding: '7px 10px',
      cursor: 'pointer',
      backgroundColor: '#3b2b55',
      color: '#ffdf91',
      border: '1px solid #7f5fb8',
      borderRadius: '6px',
    },
    secondaryButton: {
      padding: '8px 12px',
      cursor: 'pointer',
      backgroundColor: '#2d2638',
      color: '#f6d58d',
      border: '1px solid #6e5c86',
      borderRadius: '7px',
      margin: '6px 6px 0 0',
    },
    disabledButton: {
      opacity: 0.58,
      cursor: 'not-allowed',
    },
    applyButton: {
      backgroundColor: '#b7791f',
      color: '#1d1203',
      fontWeight: 'bold',
    },
    classPreview: {
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      marginTop: '10px',
    },
    previewPortrait: {
      width: '70px',
      height: '70px',
      objectFit: 'cover',
      borderRadius: '8px',
      border: '1px solid #9b6cff',
    },
    itemList: {
      display: 'grid',
      gap: '8px',
      maxHeight: '190px',
      overflowY: 'auto',
      marginTop: '10px',
    },
    itemCard: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '10px',
      alignItems: 'center',
      padding: '8px',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '8px',
    },
    message: {
      marginTop: '12px',
      color: '#9df5c7',
      fontSize: '14px',
    },
    textarea: {
      width: '100%',
      minHeight: '140px',
      boxSizing: 'border-box',
      backgroundColor: '#111',
      color: '#fff',
      border: '1px solid #555',
      borderRadius: '5px',
      padding: '10px',
      fontFamily: 'monospace',
      fontSize: '14px',
      marginTop: '10px',
    },
  };

  return (
    <div style={styles.container}>
      <h2>Создание персонажа</h2>
      {!accountName && <div>
        <label>
          Имя:
          <input
            style={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Введите имя"
          />
        </label>
      </div>}
      <div>
        <label>
          Класс:
          <select
            style={styles.select}
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
          >
            {CLASSES.map(c => (
              <option key={c.name} value={c.name}>
                {getClassLabel(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <img
          src={selectedPortrait}
          alt={`Портрет: ${selectedClassData.name}`}
          style={styles.portrait}
          onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.player)}
        />
        {selectedClassData.mechanicDescription && (
          <p style={styles.classMechanic}>{selectedClassData.mechanicDescription}</p>
        )}
      </div>
      {process.env.NODE_ENV === 'development' && <button style={{ ...styles.button, ...styles.developerButton }} onClick={handleDeveloperAccess}>
        Разработчик
      </button>}
      {process.env.NODE_ENV === 'development' && isDeveloperEditorOpen && (
        <div style={styles.developerEditor}>
          <div style={styles.editorHeader}>
            <div>
              <h3 style={styles.editorTitle}>Редактор игры</h3>
              <p style={styles.editorSubtitle}>Внутренний RPG-инструмент для быстрой настройки нового героя.</p>
            </div>
            <div>
              <button style={{ ...styles.secondaryButton, ...styles.applyButton }} onClick={handleApplyDeveloperChanges}>
                Apply changes
              </button>
              <button style={styles.secondaryButton} onClick={handleResetEditor}>
                Reset editor values
              </button>
              <button style={styles.secondaryButton} onClick={handleCopyPatch}>
                Copy as JSON patch
              </button>
            </div>
          </div>

          <div style={styles.editorTabs}>
            <button
              style={activeDeveloperTab === 'tools' ? { ...styles.editorTab, ...styles.editorTabActive } : styles.editorTab}
              onClick={() => setActiveDeveloperTab('tools')}
            >
              Developer Tools
            </button>
            <button
              style={activeDeveloperTab === 'database' ? { ...styles.editorTab, ...styles.editorTabActive } : styles.editorTab}
              onClick={() => setActiveDeveloperTab('database')}
            >
              Content Database
            </button>
          </div>

          {activeDeveloperTab === 'tools' && (
            <>
              <div style={styles.editorGrid}>
                <section style={styles.editorCard}>
                  <h4 style={styles.cardTitle}>Казна</h4>
                  <div style={styles.fieldRow}>
                    <span style={styles.fieldLabel}>Silver</span>
                    <button style={styles.tinyButton} onClick={() => nudgeDraftNumber('silver', -100)}>-</button>
                    <input
                      style={styles.smallInput}
                      type="number"
                      min="0"
                      value={developerDraft.silver}
                      onChange={(e) => setDraftNumber('silver', e.target.value)}
                    />
                    <button style={styles.tinyButton} onClick={() => nudgeDraftNumber('silver', 100)}>+</button>
                  </div>
                  {hasGold && (
                    <div style={styles.fieldRow}>
                      <span style={styles.fieldLabel}>Gold</span>
                      <button style={styles.tinyButton} onClick={() => nudgeDraftNumber('gold', -1)}>-</button>
                      <input
                        style={styles.smallInput}
                        type="number"
                        min="0"
                        value={developerDraft.gold}
                        onChange={(e) => setDraftNumber('gold', e.target.value)}
                      />
                      <button style={styles.tinyButton} onClick={() => nudgeDraftNumber('gold', 1)}>+</button>
                    </div>
                  )}
                  <button style={styles.secondaryButton} onClick={() => setDraftNumber('silver', 9999)}>
                    Set to 9999
                  </button>
                  <button style={styles.secondaryButton} onClick={() => setDraftNumber('silver', 0)}>
                    Reset to 0
                  </button>
                </section>

                <section style={styles.editorCard}>
                  <h4 style={styles.cardTitle}>Характеристики</h4>
                  {availableStatFields.map(field => (
                    <div key={field.key} style={styles.fieldRow}>
                      <span style={styles.fieldLabel}>{field.label}</span>
                      <button style={styles.tinyButton} onClick={() => nudgeDraftNumber(field.key, -field.step)}>-</button>
                      <input
                        style={styles.smallInput}
                        type="number"
                        min="0"
                        value={developerDraft[field.key]}
                        onChange={(e) => setDraftNumber(field.key, e.target.value)}
                      />
                      <button style={styles.tinyButton} onClick={() => nudgeDraftNumber(field.key, field.step)}>+</button>
                    </div>
                  ))}
                </section>

                <section style={styles.editorCard}>
                  <h4 style={styles.cardTitle}>Класс и образ</h4>
                  <select
                    style={{ ...styles.select, width: '100%', margin: 0 }}
                    value={selectedClass}
                    onChange={(e) => handleDeveloperClassChange(e.target.value)}
                  >
                    {CLASSES.map(c => (
                      <option key={c.name} value={c.name}>
                        {getClassLabel(c)}
                      </option>
                    ))}
                  </select>
                  <div style={styles.classPreview}>
                    <img
                      src={selectedPortrait}
                      alt={selectedClass}
                      style={styles.previewPortrait}
                      onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.player)}
                    />
                    <div>
                      <strong>{getClassLabel(selectedClassData)}</strong>
                      <p style={{ margin: '4px 0', color: '#c9b8ff' }}>Портрет и стартовый набор класса.</p>
                      {selectedClassData.mechanicDescription && (
                        <p style={{ margin: '4px 0', color: '#f6d58d' }}>{selectedClassData.mechanicDescription}</p>
                      )}
                    </div>
                  </div>
                </section>

                <section style={styles.editorCard}>
                  <h4 style={styles.cardTitle}>Инвентарь</h4>
                  {itemEditorAvailable ? (
                    <>
                      <select
                        style={{ ...styles.select, width: '100%', margin: 0 }}
                        value={selectedItemName}
                        onChange={(e) => setSelectedItemName(e.target.value)}
                      >
                        {ITEM_DATA.map(item => (
                          <option key={item.name} value={item.name}>
                            {item.name} — {item.type}
                          </option>
                        ))}
                      </select>
                      <button style={styles.secondaryButton} onClick={handleAddItem}>Add item</button>
                      <div style={styles.itemList}>
                        {developerDraft.inventory.map((itemName, index) => (
                          <div key={`${itemName}-${index}`} style={styles.itemCard}>
                            <span>{itemName}</span>
                            <button style={styles.tinyButton} onClick={() => handleRemoveItem(index)}>Remove</button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p style={{ color: '#c9b8ff' }}>Item editor will be added later</p>
                  )}
                </section>
              </div>

              <button style={styles.secondaryButton} onClick={() => setIsAdvancedPatchOpen(prev => !prev)}>
                {isAdvancedPatchOpen ? 'Hide advanced JSON patch' : 'Show advanced JSON patch'}
              </button>
              {isAdvancedPatchOpen && (
                <textarea
                  style={styles.textarea}
                  value={developerPatch}
                  onChange={(e) => setDeveloperPatch(e.target.value)}
                  spellCheck={false}
                />
              )}
            </>
          )}

          {activeDeveloperTab === 'database' && (
            <div style={styles.desktopEditor}>
              <aside style={styles.editorNavPanel}>
                <h4 style={styles.databaseTitle}>Content Database</h4>
                {Object.entries(contentTypeConfig).map(([label, config]) => (
                  <div key={label} style={styles.navTreeGroup}>
                    <button
                      type="button"
                      style={activeContentType === label && label !== 'Items' && effectiveActiveSubtype === 'all' ? { ...styles.navTreeButton, ...styles.navTreeButtonActive } : styles.navTreeButton}
                      onClick={() => handleSelectContentSection(label)}
                    >
                      <span>{label}</span>
                      <small>{label === 'Items' ? config.entries.length : activeContentType === label && effectiveActiveSubtype === 'all' ? `${activeContentConfig.visible.length} / ${activeContentConfig.total}` : config.entries.length}</small>
                    </button>
                    {activeContentType === label && config.subtypes.length > 0 && (
                      <div style={styles.navSubtree}>
                        {label === 'Items' && <div style={styles.navSubtreeLabel}>Item categories</div>}
                        {config.subtypes.map(subtype => (
                          <button
                            key={subtype.value}
                            type="button"
                            style={effectiveActiveSubtype === subtype.value ? { ...styles.navTreeButton, ...styles.navTreeButtonActive, ...styles.navSubtreeButton } : { ...styles.navTreeButton, ...styles.navSubtreeButton }}
                            onClick={() => handleSelectContentSection(label, subtype.value)}
                          >
                            <span>{subtype.label}</span>
                            <small>{effectiveActiveSubtype === subtype.value ? `${activeContentConfig.visible.length} / ${activeContentConfig.total}` : subtype.total}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </aside>

              <main style={styles.editorCenterPanel}>
                <section style={styles.draftsToolbar}>
                  <div style={styles.toolbarHeader}>
                    <div>
                      <h4 style={styles.databaseTitle}>Drafts vault</h4>
                      <p style={styles.databaseMeta}>{savedDraftCount} saved local drafts</p>
                    </div>
                    <div style={styles.actionRow}>
                      <button style={styles.tinyButton} onClick={() => setIsPatchReviewOpen(prev => !prev)}>Review changes</button>
                      <button style={styles.tinyButton} onClick={handleExportAllDrafts}>Export all drafts</button>
                      <button style={styles.tinyButton} onClick={handleCopyAllDrafts}>Copy all drafts JSON</button>
                      <button style={styles.tinyButton} onClick={() => setIsDraftImportOpen(prev => !prev)}>Import drafts JSON</button>
                      <button style={styles.tinyButton} onClick={handleClearAllDrafts}>Clear all drafts</button>
                    </div>
                  </div>
                  <p style={styles.draftWarning}>Draft export/import is local preview only. It never writes to source game data.</p>
                  {isDraftImportOpen && (
                    <div style={styles.importPanel}>
                      <textarea
                        style={styles.textarea}
                        value={draftImportText}
                        onChange={(e) => setDraftImportText(e.target.value)}
                        placeholder='{
  "version": 1,
  "exportedAt": "...",
  "skills": {},
  "items": {}
}'
                        spellCheck={false}
                      />
                      <div style={styles.actionRow}>
                        <button style={styles.secondaryButton} onClick={handleImportDrafts}>Import drafts JSON</button>
                        <button style={styles.tinyButton} onClick={() => setDraftImportText(serializeAllDrafts())}>Load current export</button>
                      </div>
                    </div>
                  )}
                  {isPatchReviewOpen && renderPatchReview()}
                  {draftImportMessage && <p style={styles.message}>{draftImportMessage}</p>}
                </section>

                <section style={styles.editorListPanel}>
                  <div style={styles.toolbarHeader}>
                    <div>
                      <h4 style={styles.databaseTitle}>{activeContentType}</h4>
                      <p style={styles.databaseDescription}>{activeContentConfig.subtitle}</p>
                      <p style={styles.databaseMeta}>{activeSubtypeLabel} · {activeContentConfig.visible.length} visible / {activeContentConfig.total} total</p>
                    </div>
                    <div style={styles.actionRow}>
                      {activeContentConfig.createKind ? (
                        <button style={styles.secondaryButton} onClick={() => handleCreateLocalDraft(activeContentConfig.createKind)}>{activeContentConfig.createLabel}</button>
                      ) : (
                        <button style={{ ...styles.secondaryButton, ...styles.disabledButton }} disabled>Create not available yet</button>
                      )}
                    </div>
                  </div>
                  <div style={styles.editorFilterBar}>
                    <input
                      style={styles.searchInput}
                      type="search"
                      value={contentSearch}
                      onChange={(e) => setContentSearch(e.target.value)}
                      placeholder="Search selected content..."
                    />
                  </div>
                  {renderActiveFilters()}
                  {renderContentTable()}
                </section>
              </main>

              <aside style={styles.editorInspectorPanel}>
                <h4 style={styles.databaseTitle}>Inspector</h4>
                {selectedContentEntry ? renderContentDetail() : (
                  <div style={styles.emptyState}>
                    <strong>No entry selected</strong>
                    <p>Select a row to inspect details and edit local Skill/Item drafts.</p>
                  </div>
                )}
              </aside>
            </div>
          )}

          {developerMessage && <p style={styles.message}>{developerMessage}</p>}
        </div>
      )}
      <button style={styles.button} onClick={handleSubmit}>
        Создать персонажа
      </button>
    </div>
  );
};

export default CharacterSelectionScreen;
