import { CONSUMABLE_EFFECT_PARTS, EQUIPMENT_DETAILS } from '../data/itemDetailsPresentation';
import { createAbilityByName } from '../data/abilityPresets';
import { getEffectDefinition } from './effects';

const EQUIPMENT_TYPE_LABELS = {
  Helmet: 'Шлем',
  Armor: 'Доспех',
  Legs: 'Ноги',
  Weapon: 'Оружие',
  Shield: 'Щит',
  MagicOffHand: 'Магический фокус',
  Ring: 'Кольцо',
  Amulet: 'Амулет',
  Bag: 'Сумка',
};

const CANONICAL_MECHANICS_FIRST_EQUIPMENT = new Set([
  'Полевой гримуар Отступника', 'Натянутый охотничий лук', 'Капюшон Следопыта',
  'Плащ разведчика', 'Кольцо Меткой Тетивы', 'Пепельная Маска Отступника', 'Клятвопреступник',
]);

export const ITEM_STAT_LABELS = {
  maxHp: 'Здоровье',
  attack: 'Физическая атака',
  magAtk: 'Магическая атака',
  physDef: 'Физическая защита',
  magicDef: 'Магическая защита',
  speed: 'Скорость',
  speedPct: 'Скорость',
  critChance: 'Шанс критического удара',
  critDamage: 'Критический урон',
  dodge: 'Уклонение',
};

export const getItemClassification = (item, equipmentDefinition = null) => {
  if (!item) return 'Предмет';
  if (item.type === 'equipment') {
    const handedness = equipmentDefinition?.type === 'Weapon' && equipmentDefinition.hands === 1
      ? 'Одноручное'
      : equipmentDefinition?.type === 'Weapon' && equipmentDefinition.hands === 2 ? 'Двуручное' : null;
    return ['Снаряжение', EQUIPMENT_TYPE_LABELS[item.equipmentType] || item.equipmentType || 'Предмет', handedness].filter(Boolean).join(' · ');
  }
  if (item.type === 'consumable') {
    if (/зелье/i.test(item.name)) return 'Расходник · Зелье';
    if (/свиток/i.test(item.name)) return 'Расходник · Свиток';
    return 'Расходник';
  }
  if (item.type === 'material') {
    if (item.sourceTier === 'rareCatalyst' || /эссенци/i.test(item.name)) return 'Особый материал · Катализатор';
    return 'Материал · Ремесло';
  }
  if (item.type === 'key' || item.type === 'keyItem') return 'Ключевой предмет';
  if (item.type === 'currency') return 'Валюта';
  if (item.type === 'rune') return 'Руна';
  return item.type || 'Предмет';
};

export const getEquipmentStatRows = (selected, current = null) => {
  const selectedStats = selected?.stats || {};
  const currentStats = current?.stats || {};
  return Object.keys({ ...selectedStats, ...currentStats })
    .filter(key => Number.isFinite(selectedStats[key]) || Number.isFinite(currentStats[key]))
    .map(key => {
      const selectedValue = selectedStats[key] || 0;
      const currentValue = currentStats[key] || 0;
      return {
        key,
        label: ITEM_STAT_LABELS[key] || key,
        selectedValue,
        currentValue,
        delta: selectedValue - currentValue,
      };
    });
};

export const getMeaningfulEquipmentStatRows = (selected, current) => (
  current ? getEquipmentStatRows(selected, current).filter(row => row.delta !== 0) : getEquipmentStatRows(selected)
);

export const formatSignedValue = value => `${value > 0 ? '+' : ''}${value}`;

const statusPart = effect => {
  const definition = getEffectDefinition(effect?.id);
  return definition ? { statusId: definition.id, text: definition.name } : null;
};

const describeEffects = effects => (effects || []).flatMap((effect, index) => {
  const reference = statusPart(effect);
  if (!reference) return [];
  const value = effect.value ? ` силой ${effect.value}` : '';
  const duration = effect.duration ? ` на ${effect.duration} хода` : '';
  return [index ? ' ' : '', 'Накладывает ', reference, `${value}${duration}.`];
});

export const getItemTextSections = (item, equipmentDefinition = null, combatDefinition = null) => {
  if (item?.type === 'equipment') {
    const details = EQUIPMENT_DETAILS[item.name] || null;
    const canonicalDescription = equipmentDefinition?.description || item.description;
    const authoritativeEffectParts = equipmentDefinition?.descriptionParts
      || item.descriptionParts
      || (CANONICAL_MECHANICS_FIRST_EQUIPMENT.has(item.name) && canonicalDescription
        ? [canonicalDescription]
        : details?.effectParts || (!details && canonicalDescription ? [canonicalDescription] : []));
    return { effectParts: authoritativeEffectParts, flavor: details?.flavor || null, usageNote: null };
  }
  if (item?.type === 'material') {
    return { purpose: item.description || null, effectParts: [], flavor: null, usageNote: null };
  }
  if (item?.type !== 'consumable') {
    return { effectParts: [], flavor: item?.description || null, usageNote: null };
  }

  if (item.fieldUse?.type === 'healAndNextCombatEffect') {
    const nextEffects = item.fieldUse.nextCombatEffects || [];
    const nextParts = nextEffects.flatMap((effect, index) => {
      const reference = statusPart(effect);
      if (!reference) return [];
      return [index ? ' ' : '', 'Следующий бой начинается с ', reference, effect.duration ? ` на ${effect.duration} хода.` : '.'];
    });
    return {
      effectParts: [`Восстанавливает ${item.fieldUse.healAmount} здоровья. `, ...nextParts],
      flavor: null,
      usageNote: 'Можно использовать только вне боя во время экспедиции.',
    };
  }

  const explicitParts = CONSUMABLE_EFFECT_PARTS[item.name];
  if (explicitParts) return { effectParts: explicitParts, flavor: null, usageNote: null };
  if (combatDefinition?.type === 'ability' && combatDefinition.ability) {
    const ability = createAbilityByName(combatDefinition.ability);
    return {
      effectParts: ability?.descriptionParts || (ability?.description ? [ability.description] : []),
      flavor: null,
      usageNote: null,
    };
  }
  if (combatDefinition?.type === 'cleanse') {
    const count = combatDefinition.cleanseCount ?? 1;
    return { effectParts: [`Снимает ${count === 1 ? 'один случайный штраф' : `${count} случайных штрафа`}.`], flavor: null, usageNote: null };
  }
  if (combatDefinition?.type === 'heal') {
    return {
      effectParts: [`Восстанавливает ${combatDefinition.amount} здоровья. `, ...describeEffects(combatDefinition.effects)],
      flavor: null,
      usageNote: null,
    };
  }
  if (combatDefinition?.type === 'effects') {
    return { effectParts: describeEffects(combatDefinition.effects), flavor: null, usageNote: null };
  }
  return { effectParts: item.description ? [item.description] : [], flavor: null, usageNote: null };
};

const PERCENT_STATS = new Set([
  'critChance', 'critDamage', 'dodge', 'evasion', 'lifesteal', 'vampirism',
  'resistance', 'blockChance', 'accuracy', 'effectChance', 'speedPct',
]);

export const formatItemStatValue = (statKey, value, { signed = false } = {}) => {
  const numericValue = Number.isFinite(value) ? value : 0;
  const displayValue = PERCENT_STATS.has(statKey)
    ? `${Math.round(numericValue * 1000) / 10}%`
    : `${numericValue}`;
  return `${signed && numericValue > 0 ? '+' : ''}${displayValue}`;
};
