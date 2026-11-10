import { resolvePlayerPortrait } from './combatAssets';

export const PLAYABLE_CLASS_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'Defender', englishDisplayName: 'Defender', displayName: 'Защитник',
    portrait: resolvePlayerPortrait({ class: 'Defender' }),
    stats: Object.freeze({ hp: 125, maxHp: 125, speed: 115, attack: 10, magAtk: 0, physDef: 18, magicDef: 0, critChance: 0.05, critDamage: 0.35, dodge: 0 }),
    abilityNames: Object.freeze(['Стойкость', 'Кровавый таран', 'Устрашение', 'Удар щитом', 'Атака']),
    unlockableAbilityNames: Object.freeze(['Железный контрудар', 'Щитовая волна']),
    mechanicDescription: 'Шипастый щит: враг, попавший по Защитнику прямой атакой, пока у него есть Щит, получает Кровотечение на 1 ход.',
  }),
  Object.freeze({
    name: 'Mage', englishDisplayName: 'Elementalist', displayName: 'Элементалист',
    portrait: resolvePlayerPortrait({ class: 'Mage' }),
    stats: Object.freeze({ hp: 80, maxHp: 80, speed: 125, attack: 8, magAtk: 15, physDef: 0, magicDef: 0, critChance: 0.1, critDamage: 0.5, dodge: 0 }),
    abilityNames: Object.freeze(['Заряд стихий', 'Атака', 'Огненный шар', 'Цепная молния', 'Морозный щит', 'Ледяное копьё']),
  }),
  Object.freeze({
    name: 'Archer', englishDisplayName: 'Archer', displayName: 'Лучник',
    portrait: resolvePlayerPortrait({ class: 'Archer' }),
    stats: Object.freeze({ hp: 90, maxHp: 90, speed: 176, attack: 9, magAtk: 0, physDef: 0, magicDef: 0, critChance: 0.1, critDamage: 0.5, dodge: 0 }),
    abilityNames: Object.freeze(['Сквозные раны', 'Зазубренная стрела', 'Прицельный выстрел', 'Добивающий выстрел', 'Быстрый перехват', 'Атака']),
    mechanicDescription: 'Сквозные раны: когда прямая атака добивает врага, весь избыточный урон переносится на одного случайного живого врага.',
  }),
]);

export const getPlayableClassDefinition = classId => PLAYABLE_CLASS_DEFINITIONS.find(definition => definition.name === classId) || null;

export const createClassBaseStats = classIdOrDefinition => {
  const definition = typeof classIdOrDefinition === 'string' ? getPlayableClassDefinition(classIdOrDefinition) : classIdOrDefinition;
  if (!definition) return null;
  const stats = definition.stats;
  return {
    maxHp: stats.maxHp, attack: stats.attack, magAtk: stats.magAtk ?? 0,
    physDef: stats.physDef ?? 0, magicDef: stats.magicDef ?? 0, speed: stats.speed ?? 0,
    critChance: stats.critChance ?? 0.1, critDamage: stats.critDamage ?? 0.5, dodge: stats.dodge ?? 0,
  };
};
