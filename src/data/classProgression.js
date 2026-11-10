import { createAbilityByName } from './abilityPresets';
import * as classTalents from './classTalents.mjs';
import * as classProgressionRules from './classProgressionRules.mjs';

const { CLASS_TALENT_SETS, TALENT_BY_ID, TALENT_SET_BY_ABILITY_ID } = classTalents;
const { XP_THRESHOLDS, PASSIVE_SLOT_LEVELS, LEGACY_SKILL_LEVELS, LEGACY_PASSIVE_LEVELS, canonicalSkillId, canonicalPassiveId } = classProgressionRules;

export const CLASS_LEVEL_CAP = 20;
export const CLASS_PROGRESSION_SCHEMA_VERSION = 3;
export const ACTIVE_SKILL_SLOT_COUNT = 4;
export const PASSIVE_SLOT_UNLOCK_LEVELS = PASSIVE_SLOT_LEVELS;
export const DEFENDER_PASSIVES = Object.freeze([
  Object.freeze({ id: 'blood_pressure', name: 'Кровавый нажим', requiredLevel: 2, description: 'Каждые 2 заряда Кровотечения на одном живом противнике дают +10% скорости. Учитывается противник с наибольшим числом зарядов. Максимум +50%.', descriptionParts: ['Каждые 2 заряда ', { statusId: 'bleed', text: 'Кровотечения' }, ' на одном живом противнике дают +10% скорости. Учитывается противник с наибольшим числом зарядов. Максимум +50%.'] }),
  Object.freeze({ id: 'last_stand', name: 'Последний рубеж', requiredLevel: 6, description: 'Один раз за поход смертельный урон оставляет Защитника с 1 ед. здоровья, восстанавливает 30% максимального здоровья, даёт Щит 50% на 3 хода и полностью заполняет шкалу хода.', descriptionParts: ['Один раз за поход смертельный урон оставляет Защитника с 1 ед. здоровья, восстанавливает 30% максимального здоровья, даёт ', { statusId: 'shield', text: 'Щит' }, ' 50% на 3 хода и полностью заполняет шкалу хода.'] }),
  Object.freeze({ id: 'retaliatory_assault', name: 'Ответный натиск', requiredLevel: 2, description: 'Каждая успешная вражеская атака даёт 1 заряд, максимум 3. При 3 зарядах следующая небазовая атакующая способность расходует их и наносит на 50% больше прямого урона.' }),
  Object.freeze({ id: 'headlong', name: 'Напролом', requiredLevel: 6, description: 'Без экипированного щита атакующая способность, нанёсшая прямой урон здоровью или Щиту, после завершения даёт Щит 12% максимального здоровья на 3 хода.', descriptionParts: ['Без экипированного щита атакующая способность, нанёсшая прямой урон здоровью или ', { statusId: 'shield', text: 'Щиту' }, ', после завершения даёт ', { statusId: 'shield', text: 'Щит' }, ' 12% максимального здоровья на 3 хода.'] }),
]);
export const CLASS_XP_THRESHOLDS = XP_THRESHOLDS;

const CLASS_LEVEL_ONE_STATS = Object.freeze({
  Defender: Object.freeze({ maxHp:125, attack:10, magAtk:0, physDef:18, magicDef:0, speed:115, critChance:.05, critDamage:.35, dodge:0 }),
  Mage: Object.freeze({ maxHp:80, attack:8, magAtk:15, physDef:0, magicDef:0, speed:125, critChance:.1, critDamage:.5, dodge:0 }),
  Archer: Object.freeze({ maxHp:90, attack:9, magAtk:0, physDef:0, magicDef:0, speed:176, critChance:.1, critDamage:.5, dodge:0 }),
});

/** Canonical, equipment-free class stats. Never accepts stat increments from saves. */
export const getClassStatsForLevel = (classId, level) => {
  const base = CLASS_LEVEL_ONE_STATS[classId];
  if (!base) return null;
  const capped = Math.max(1, Math.min(CLASS_LEVEL_CAP, Math.floor(Number(level) || 1)));
  const gained = capped - 1;
  const evenRaises = Math.floor(capped / 2);
  const commonPhysRaises = [3,7,11,15,19].filter(value => capped >= value).length + (capped >= 20 ? 1 : 0);
  const commonMagicRaises = [5,9,13,17].filter(value => capped >= value).length + (capped >= 20 ? 1 : 0);
  const physRaises = classId === 'Mage' ? commonMagicRaises : commonPhysRaises;
  const magicRaises = classId === 'Mage' ? commonPhysRaises : commonMagicRaises;
  return { ...base, maxHp: base.maxHp + (classId === 'Defender' ? 5 : 3) * gained,
    attack: base.attack + (classId === 'Mage' ? 0 : evenRaises), magAtk: base.magAtk + (classId === 'Mage' ? evenRaises : 0),
    physDef: base.physDef + physRaises, magicDef: base.magicDef + magicRaises };
};

export const DEFENDER_STARTING_SKILLS = Object.freeze([
  'Стойкость', 'Устрашение', 'Кровавый таран', 'Удар щитом',
]);

export const normalizeElementalistPassiveId = id => canonicalPassiveId('Mage', id);

export const ELEMENTALIST_PASSIVES = Object.freeze([
  Object.freeze({ id: 'lightning_speed', name: 'Скорость молнии', requiredLevel: 2, description: 'Когда враг пропускает ход из-за Шока Элементалиста или его элементаля либо на враге разряжаются 3 их Заряда, Элементалист получает 15% шкалы хода и Ускорение на 2 хода. Разряд даёт бонус не чаще одного раза за применение способности.', descriptionParts: ['Когда враг пропускает ход из-за ', { statusId: 'shock', text: 'Шока' }, ' Элементалиста или его элементаля либо на враге разряжаются 3 их ', { statusId: 'charge', text: 'Заряда' }, ', Элементалист получает 15% шкалы хода и ', { statusId: 'speed_boost_minor', text: 'Ускорение' }, ' на 2 хода. Разряд даёт бонус не чаще одного раза за применение способности.'] }),
  Object.freeze({ id: 'overheat', name: 'Перегрев', requiredLevel: 6, description: 'Способность Льда или Молнии даёт 1 заряд Перегрева, максимум 2. Следующая атакующая способность Огня расходует все заряды и получает +20% прямого урона за каждый; при 2 зарядах поражённые цели также получают 1 Обугливание на 3 хода. Морозный щит набирает заряд, Стихийное эхо учитывает повторяемую стихию; Огонь без прямого урона заряды не расходует.', descriptionParts: ['Способность Льда или Молнии даёт 1 заряд ', { statusId: 'overheat', text: 'Перегрева' }, ', максимум 2. Следующая атакующая способность Огня расходует все заряды и получает +20% прямого урона за каждый; при 2 зарядах поражённые цели также получают 1 ', { statusId: 'charring', text: 'Обугливание' }, ' на 3 хода. Морозный щит набирает заряд, Стихийное эхо учитывает повторяемую стихию; Огонь без прямого урона заряды не расходует.'] }),
  Object.freeze({ id: 'elemental_shell', name: 'Стихийная оболочка', requiredLevel: 2, description: 'При срабатывании Заряда стихий получает дополнительный Щит на 10% максимального здоровья на 2 хода.', descriptionParts: ['При срабатывании Заряда стихий получает дополнительный ', { statusId: 'shield', text: 'Щит' }, ' на 10% максимального здоровья на 2 хода.'] }),
  Object.freeze({ id: 'elemental_resonance', name: 'Стихийный резонанс', requiredLevel: 6, description: 'После применения атакующей способности Огня, Льда или Молнии поражённые цели получают один дополнительный эффект её стихии: Огонь — [Обугливание] (1 заряд) на 3 хода, Лёд — [Ледяные осколки] (1 заряд), Молния — 75% [Заряд] и 25% [Проводимость] на 2 хода. Для Молнии результат выбирается один раз на применение и одинаков для всех целей; эффект накладывается после урона и стихийных реакций.' }),
]);
export const ARCHER_PASSIVES = Object.freeze([
  Object.freeze({ id: 'finish_the_prey', name: 'Добить добычу', requiredLevel: 2, description: 'Когда враг впервые опускается до 30% здоровья от урона Лучника, шкала хода заполняется на 15%.' }),
  Object.freeze({ id: 'initiative', name: 'Опережение', requiredLevel: 2, description: 'Каждый дополнительный ход Лучника до полного хода врага увеличивает прямой урон на 10%, максимум на 30%.' }),
  Object.freeze({ id: 'false_trail', name: 'Ложный след', requiredLevel: 6, description: 'Даёт 5% Уклонения. После уклонения или Перенаправления следующая атака наносит на 20% больше прямого урона.', descriptionParts: ['Даёт 5% ', { statusId: 'evasion', text: 'Уклонения' }, '. После уклонения или Перенаправления следующая атака наносит на 20% больше прямого урона.'] }),
  Object.freeze({ id: 'hunting_rhythm', name: 'Охотничий ритм', requiredLevel: 6, description: 'Срабатывание ловушки заполняет шкалу хода на 50%.' }),
]);

export const CLASS_PROGRESSION_DEFINITIONS = Object.freeze({
  Defender: Object.freeze({
    id: 'Defender',
    name: 'Защитник',
    startingSkillIds: DEFENDER_STARTING_SKILLS,
    skills: Object.freeze([
      ...DEFENDER_STARTING_SKILLS.map(id => Object.freeze({ id, requiredLevel: 1, starting: true })),
      Object.freeze({ id: 'Ударная волна', requiredLevel: 3 }),
      Object.freeze({ id: 'Таран', requiredLevel: 5 }),
      Object.freeze({ id: 'Бросок щита', requiredLevel: 7 }),
      Object.freeze({ id: 'Кровавый вызов', requiredLevel: 9 }),
    ]),
    passiveSkills: DEFENDER_PASSIVES,
    passiveSlotUnlockLevels: PASSIVE_SLOT_UNLOCK_LEVELS,
  }),
  Mage: Object.freeze({
    id: 'Mage', name: 'Элементалист',
    startingSkillIds: Object.freeze(['Огненный шар', 'Цепная молния', 'Морозный щит', 'Ледяное копьё']),
    skills: Object.freeze([
      ...['Огненный шар', 'Цепная молния', 'Морозный щит', 'Ледяное копьё'].map(id => Object.freeze({ id, requiredLevel: 1, starting: true })),
      Object.freeze({ id: 'Буран', requiredLevel: 3 }),
      Object.freeze({ id: 'Призыв элементаля', requiredLevel: 5 }),
      Object.freeze({ id: 'Грозовой разряд', requiredLevel: 7 }),
      Object.freeze({ id: 'Стихийное эхо', requiredLevel: 9 }),
    ]), passiveSkills: ELEMENTALIST_PASSIVES, passiveSlotUnlockLevels: PASSIVE_SLOT_UNLOCK_LEVELS,
  }),
  Archer: Object.freeze({
    id: 'Archer', name: 'Лучник',
    startingSkillIds: Object.freeze(['Зазубренная стрела', 'Огненная стрела', 'Добивающий выстрел', 'Быстрый перехват']),
    skills: Object.freeze([
      ...['Зазубренная стрела', 'Огненная стрела', 'Добивающий выстрел', 'Быстрый перехват'].map(id => Object.freeze({ id, requiredLevel: 1, starting: true })),
      Object.freeze({ id: 'Волчья яма', requiredLevel: 3 }),
      Object.freeze({ id: 'Перенаправление', requiredLevel: 5 }),
      Object.freeze({ id: 'Залп стрел', requiredLevel: 7 }),
      Object.freeze({ id: 'Змеиная ловушка', requiredLevel: 9 }),
    ]), passiveSkills: ARCHER_PASSIVES, passiveSlotUnlockLevels: PASSIVE_SLOT_UNLOCK_LEVELS,
  }),
});

export const getClassLevelForXp = cumulativeXp => {
  const xp = Math.max(0, Number(cumulativeXp) || 0);
  let level = 1;
  while (level < CLASS_LEVEL_CAP && xp >= CLASS_XP_THRESHOLDS[level]) level += 1;
  return level;
};

export const getClassXpProgress = record => {
  const level = Math.max(1, Math.min(CLASS_LEVEL_CAP, record?.classLevel || getClassLevelForXp(record?.cumulativeClassXp)));
  const cumulativeXp = Math.max(0, record?.cumulativeClassXp || 0);
  const floor = CLASS_XP_THRESHOLDS[level - 1];
  const ceiling = level >= CLASS_LEVEL_CAP ? floor : CLASS_XP_THRESHOLDS[level];
  return {
    level,
    current: level >= CLASS_LEVEL_CAP ? 0 : Math.max(0, cumulativeXp - floor),
    required: level >= CLASS_LEVEL_CAP ? 0 : ceiling - floor,
    cumulativeXp,
    isMaxLevel: level >= CLASS_LEVEL_CAP,
  };
};

const uniqueKnownSkills = (values, definition) => {
  const known = new Set(definition.skills.map(skill => skill.id));
  return [...new Set((values || []).filter(id => known.has(id)))];
};

const uniqueKnownPassives = (values, definition) => {
  const known = new Set((definition.passiveSkills || []).map(passive => passive.id));
  return [...new Set((values || []).filter(id => known.has(id)))];
};

export const getPassiveSlotCount = (classId, level) => (CLASS_PROGRESSION_DEFINITIONS[classId]?.passiveSlotUnlockLevels || [])
  .filter(requiredLevel => level >= requiredLevel).length;

export const getClassPassiveById = (classId, passiveId) => {
  const canonicalId = classId === 'Mage' ? normalizeElementalistPassiveId(passiveId) : passiveId;
  return CLASS_PROGRESSION_DEFINITIONS[classId]?.passiveSkills?.find(passive => passive.id === canonicalId) || null;
};

const getLevelAvailableSkillIds = (definition, level) => definition.skills
  .filter(skill => skill.requiredLevel <= level)
  .map(skill => skill.id);

const getLevelAvailablePassiveIds = (definition, level) => (definition.passiveSkills || [])
  .filter(passive => passive.requiredLevel <= level)
  .map(passive => passive.id);

const getGrandfatheredSkillIds = (classId, values, level) => (values || []).filter(id => {
  const legacyLevel = LEGACY_SKILL_LEVELS[classId]?.[id];
  return Number.isFinite(legacyLevel) && level >= legacyLevel;
});

const getGrandfatheredPassiveIds = (classId, values, level) => (values || []).filter(id => {
  const legacyLevel = LEGACY_PASSIVE_LEVELS[classId]?.[id];
  return Number.isFinite(legacyLevel) && level >= legacyLevel;
});

export const createClassProgressionRecord = (classId, legacyAbilityNames = []) => {
  const definition = CLASS_PROGRESSION_DEFINITIONS[classId];
  if (!definition) return null;
  const compatibleLegacy = uniqueKnownSkills(legacyAbilityNames, definition);
  const equipped = [...compatibleLegacy, ...definition.startingSkillIds]
    .filter((id, index, values) => values.indexOf(id) === index)
    .slice(0, ACTIVE_SKILL_SLOT_COUNT);
  return {
    classLevel: 1,
    cumulativeClassXp: 0,
    unlockedSkillIds: [...definition.startingSkillIds],
    activeSkillIds: equipped,
    purchasedPassiveIds: [],
    equippedPassiveIds: [],
    talentSelections: {},
    schemaVersion: CLASS_PROGRESSION_SCHEMA_VERSION,
  };
};

export const ensureClassProgression = (state = {}, legacyPlayer = null) => {
  const result = state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {};
  Object.keys(CLASS_PROGRESSION_DEFINITIONS).forEach(classId => {
    const definition = CLASS_PROGRESSION_DEFINITIONS[classId];
    const rawExisting = result[classId];
    const migrateSkillId = canonicalSkillId;
    const normalizePassiveId = id => canonicalPassiveId(classId, id);
    const rawPurchases = rawExisting?.purchases && typeof rawExisting.purchases === 'object' && !Array.isArray(rawExisting.purchases)
      ? rawExisting.purchases
      : {};
    const existing = rawExisting ? {
      ...rawExisting,
      purchasedPassiveIds: (Array.isArray(rawExisting.purchasedPassiveIds) ? rawExisting.purchasedPassiveIds : []).map(normalizePassiveId),
      equippedPassiveIds: (Array.isArray(rawExisting.equippedPassiveIds) ? rawExisting.equippedPassiveIds : []).map(normalizePassiveId),
      unlockedSkillIds: (Array.isArray(rawExisting.unlockedSkillIds) ? rawExisting.unlockedSkillIds : []).map(migrateSkillId),
      activeSkillIds: (Array.isArray(rawExisting.activeSkillIds) ? rawExisting.activeSkillIds : []).map(migrateSkillId),
      purchases: Object.fromEntries(Object.entries(rawPurchases).map(([id, purchase]) => [normalizePassiveId(migrateSkillId(id)), purchase])),
    } : null;
    if (!existing) {
      result[classId] = createClassProgressionRecord(
        classId,
        legacyPlayer?.class === classId ? legacyPlayer.abilityNames : []
      );
      return;
    }

    const cumulativeClassXp = Math.max(0, existing.cumulativeClassXp ?? existing.currentClassXp ?? 0);
    const classLevel = getClassLevelForXp(cumulativeClassXp);
    const savedPassiveIds = uniqueKnownPassives([
      ...(existing.purchasedPassiveIds || []),
      ...Object.keys(existing.purchases || {}),
    ], definition);
    const unlockedSkillIds = uniqueKnownSkills([
      ...getLevelAvailableSkillIds(definition, classLevel),
      ...getGrandfatheredSkillIds(classId, existing.unlockedSkillIds || [], classLevel),
    ], definition);
    const purchasedPassiveIds = uniqueKnownPassives([
      ...getLevelAvailablePassiveIds(definition, classLevel),
      ...getGrandfatheredPassiveIds(classId, savedPassiveIds, classLevel),
    ], definition);

    const seenActive = new Set();
    const savedActiveSkillIds = existing.activeSkillIds?.length ? existing.activeSkillIds : definition.startingSkillIds;
    const activeSkillIds = Array.from({ length: ACTIVE_SKILL_SLOT_COUNT }, (_, index) => {
      const id = savedActiveSkillIds[index] || null;
      if (!id || seenActive.has(id) || !unlockedSkillIds.includes(id)) return null;
      seenActive.add(id);
      return id;
    });

    const passiveSlotCount = getPassiveSlotCount(classId, classLevel);
    const seenPassives = new Set();
    const equippedPassiveIds = !existing.equippedPassiveIds?.length ? [] : Array.from({ length: passiveSlotCount }, (_, index) => {
      const id = existing.equippedPassiveIds?.[index];
      if (!id || seenPassives.has(id) || !purchasedPassiveIds.includes(id)) return null;
      seenPassives.add(id);
      return id;
    });

    const talentSelections = Object.fromEntries(Object.entries(existing.talentSelections || {}).filter(([abilityId, talentId]) => {
      const set = TALENT_SET_BY_ABILITY_ID[abilityId];
      const talent = TALENT_BY_ID[talentId];
      return set?.classId === classId
        && talent?.classId === classId
        && talent.abilityId === abilityId
        && set.requiredLevel <= classLevel
        && unlockedSkillIds.includes(set.abilityName);
    }));

    const {
      earnedClassPoints: _legacyEarnedClassPoints,
      spentClassPoints: _legacySpentClassPoints,
      purchases: _legacyPurchases,
      currentClassXp: _legacyCurrentClassXp,
      ...existingWithoutPointEconomy
    } = existing;

    result[classId] = {
      ...existingWithoutPointEconomy,
      classLevel,
      cumulativeClassXp,
      unlockedSkillIds,
      activeSkillIds,
      purchasedPassiveIds,
      equippedPassiveIds,
      talentSelections,
      schemaVersion: CLASS_PROGRESSION_SCHEMA_VERSION,
    };
  });
  return result;
};

export const selectClassTalent = (state, classId, abilityId, talentId, { location = '', inCombat = false, inExpedition = false, talentRegistry = TALENT_BY_ID } = {}) => {
  const progression = ensureClassProgression(state); const record = progression[classId];
  if (location !== 'guild' || inCombat || inExpedition) return { success:false, progression, reason:'Таланты можно менять только в Гильдии' };
  const set = TALENT_SET_BY_ABILITY_ID[abilityId]; const talent = talentRegistry[talentId];
  if (!record || !set || !talent) return { success:false, progression, reason:'Неизвестный талант' };
  if (set.classId !== classId || talent.classId !== classId || talent.abilityId !== abilityId || !set.talents.some(entry => entry.id === talentId)) return { success:false, progression, reason:'Талант не принадлежит способности этого класса' };
  if (!talent.combatReady) return { success:false, progression, reason:'Боевая реализация таланта ещё не готова' };
  if (record.classLevel < set.requiredLevel) return { success:false, progression, reason:`Требуется уровень класса ${set.requiredLevel}` };
  const skill = CLASS_PROGRESSION_DEFINITIONS[classId].skills.find(entry => entry.id === set.abilityName);
  if (!skill || !record.unlockedSkillIds.includes(skill.id)) return { success:false, progression, reason:'Сначала откройте способность' };
  const nextRecord = { ...record, talentSelections:{ ...record.talentSelections, [abilityId]:talentId } };
  return { success:true, progression:{ ...progression, [classId]:nextRecord }, record:nextRecord };
};

export const applyClassProgressionStats = (player, progressionState) => {
  if (!player) return player;
  const record = ensureClassProgression(progressionState, player)[player.class];
  const target = getClassStatsForLevel(player.class, record?.classLevel || 1);
  if (!target) return player;
  const previous = player.classProgressionStatBonus || {};
  const base = getClassStatsForLevel(player.class, 1);
  const bonus = Object.fromEntries(Object.keys(base).map(key => [key, target[key] - base[key]]));
  const next = { ...player, classProgressionStatBonus:bonus };
  Object.keys(bonus).forEach(key => { next[key] = (Number(player[key]) || 0) - (Number(previous[key]) || 0) + bonus[key]; });
  next.baseAtk = (Number(player.baseAtk ?? player.attack) || 0) - (Number(previous.attack) || 0) + bonus.attack;
  next.baseStats = { ...(player.baseStats || {}), ...target };
  return next;
};

export const grantClassExperience = (state, classId, xpGained) => {
  const progression = ensureClassProgression(state);
  const record = progression[classId];
  if (!record || !(xpGained > 0)) return { progression, record, result: null };
  const oldProgress = getClassXpProgress(record);
  const cumulativeClassXp = record.cumulativeClassXp + Math.max(0, Math.floor(xpGained));
  const nextProgression = ensureClassProgression({
    ...progression,
    [classId]: { ...record, cumulativeClassXp },
  });
  const nextRecord = nextProgression[classId];
  const newLevel = nextRecord.classLevel;
  const oldStats = getClassStatsForLevel(classId, oldProgress.level) || {};
  const newStats = getClassStatsForLevel(classId, newLevel) || {};
  const statGains = Object.fromEntries(
    Object.keys(newStats)
      .map(key => [key, Number(newStats[key]) - Number(oldStats[key] ?? newStats[key])])
      .filter(([, value]) => value > 0)
  );
  const newlyAvailableSkills = nextRecord.unlockedSkillIds
    .filter(skillId => !record.unlockedSkillIds.includes(skillId));
  const newlyAvailablePassives = nextRecord.purchasedPassiveIds
    .filter(passiveId => !record.purchasedPassiveIds.includes(passiveId));
  const oldPassiveSlotCount = getPassiveSlotCount(classId, oldProgress.level);
  const newPassiveSlotCount = getPassiveSlotCount(classId, newLevel);
  const newlyUnlockedPassiveSlots = Array.from(
    { length: Math.max(0, newPassiveSlotCount - oldPassiveSlotCount) },
    (_, index) => oldPassiveSlotCount + index + 1
  );
  const newlyAvailableTalents = CLASS_TALENT_SETS
    .filter(set => set.classId === classId
      && set.requiredLevel > oldProgress.level
      && set.requiredLevel <= newLevel
      && nextRecord.unlockedSkillIds.includes(set.abilityName))
    .map(set => set.abilityName);
  return {
    progression: nextProgression,
    record: nextRecord,
    result: {
      classId,
      xpGained: Math.floor(xpGained),
      oldLevel: oldProgress.level,
      newLevel,
      levelsGained: newLevel - oldProgress.level,
      oldXpWithinLevel: oldProgress.current,
      newXpWithinLevel: getClassXpProgress(nextRecord).current,
      oldXpRequired: oldProgress.required,
      newXpRequired: getClassXpProgress(nextRecord).required,
      statGains,
      newlyAvailableSkills,
      newlyAvailablePassives,
      newlyUnlockedPassiveSlots,
      newlyAvailableTalents,
    },
  };
};

export const assignClassSkill = (state, classId, skillId, slotIndex, { inCombat = false } = {}) => {
  const progression = ensureClassProgression(state);
  const record = progression[classId];
  if (inCombat) return { success: false, progression, reason: 'Нельзя менять навыки во время боя' };
  if (!record?.unlockedSkillIds.includes(skillId)) return { success: false, progression, reason: 'Навык не открыт' };
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= ACTIVE_SKILL_SLOT_COUNT) return { success: false, progression, reason: 'Некорректная ячейка навыка' };
  if (record.activeSkillIds.includes(skillId)) return { success: false, progression, reason: 'Навык уже экипирован' };
  const activeSkillIds = [...record.activeSkillIds];
  activeSkillIds[slotIndex] = skillId;
  const nextRecord = { ...record, activeSkillIds };
  return { success: true, progression: { ...progression, [classId]: nextRecord }, record: nextRecord };
};

export const assignClassPassive = (state, classId, passiveId, slotIndex, { inCombat = false } = {}) => {
  const progression = ensureClassProgression(state); const record = progression[classId];
  if (inCombat) return { success: false, progression, reason: 'Нельзя менять навыки во время боя' };
  if (!getClassPassiveById(classId, passiveId)) return { success: false, progression, reason: 'Это не пассивный навык класса' };
  if (!record?.purchasedPassiveIds.includes(passiveId)) return { success: false, progression, reason: 'Пассивный навык не изучен' };
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= getPassiveSlotCount(classId, record.classLevel)) return { success: false, progression, reason: 'Ячейка пассивного навыка закрыта' };
  if (record.equippedPassiveIds.includes(passiveId)) return { success: false, progression, reason: 'Пассивный навык уже экипирован' };
  const equippedPassiveIds = [...record.equippedPassiveIds]; equippedPassiveIds[slotIndex] = passiveId;
  const nextRecord = { ...record, equippedPassiveIds };
  return { success: true, progression: { ...progression, [classId]: nextRecord }, record: nextRecord };
};

export const setClassPassiveSlots = (state, classId, equippedPassiveIds, { inCombat = false } = {}) => {
  const progression = ensureClassProgression(state); const record = progression[classId];
  if (inCombat || !record) return { success: false, progression, reason: 'Нельзя менять пассивные навыки' };
  const slots = Array.from({ length: getPassiveSlotCount(classId, record.classLevel) }, (_, index) => equippedPassiveIds[index] || null);
  const compact = slots.filter(Boolean);
  if (new Set(compact).size !== compact.length || compact.some(id => !record.purchasedPassiveIds.includes(id))) return { success: false, progression, reason: 'Некорректный набор пассивных навыков' };
  const nextRecord = { ...record, equippedPassiveIds: slots };
  return { success: true, progression: { ...progression, [classId]: nextRecord }, record: nextRecord };
};

export const swapClassSkillSlots = (state, classId, fromSlotIndex, toSlotIndex, { inCombat = false } = {}) => {
  const progression = ensureClassProgression(state);
  const record = progression[classId];
  if (inCombat) return { success: false, progression, reason: 'Нельзя менять навыки во время боя' };
  const validSlot = index => Number.isInteger(index) && index >= 0 && index < ACTIVE_SKILL_SLOT_COUNT;
  if (!record || !validSlot(fromSlotIndex) || !validSlot(toSlotIndex)) return { success: false, progression, reason: 'Некорректная ячейка навыка' };
  if (fromSlotIndex === toSlotIndex) return { success: false, progression, reason: 'Навык уже в этой ячейке' };
  const activeSkillIds = [...record.activeSkillIds];
  [activeSkillIds[fromSlotIndex], activeSkillIds[toSlotIndex]] = [activeSkillIds[toSlotIndex], activeSkillIds[fromSlotIndex]];
  const nextRecord = { ...record, activeSkillIds };
  return { success: true, progression: { ...progression, [classId]: nextRecord }, record: nextRecord };
};

export const applyClassLoadoutToPlayer = (player, progressionState) => {
  if (!player) return player;
  const progression = ensureClassProgression(progressionState, player);
  const record = progression[player.class];
  if (!record) return { ...player, classProgression: progression };
  // Persistent combat actions are sourced exclusively from the equipped ACTIVE
  // loadout. Passives are attached separately by the combat runtime.
  const abilityNames = [...record.activeSkillIds.filter(Boolean), 'Атака'];
  const progressedPlayer = applyClassProgressionStats(player, progression);
  return {
    ...progressedPlayer,
    classProgression: progression,
    abilityNames,
    abilities: abilityNames.map(name => createAbilityByName(name, progressedPlayer.baseAtk ?? progressedPlayer.attack ?? 0)),
    equippedClassPassiveIds: [...record.equippedPassiveIds],
  };
};
