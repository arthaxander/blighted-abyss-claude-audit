import {
  ACTIVE_SKILL_SLOT_COUNT, CLASS_XP_THRESHOLDS, DEFENDER_STARTING_SKILLS,
  applyClassLoadoutToPlayer, assignClassSkill, createClassProgressionRecord,
  ensureClassProgression,
  grantClassExperience, swapClassSkillSlots,
} from './classProgression';

describe('Defender class progression', () => {
  test('starts at level one with four starting skills and no class-point economy fields', () => {
    const record = createClassProgressionRecord('Defender');
    expect(record).toMatchObject({ classLevel: 1, cumulativeClassXp: 0, schemaVersion: 3 });
    expect(record).not.toHaveProperty('earnedClassPoints');
    expect(record).not.toHaveProperty('spentClassPoints');
    expect(record).not.toHaveProperty('purchases');
    expect(record.unlockedSkillIds).toEqual(DEFENDER_STARTING_SKILLS);
    expect(record.activeSkillIds).toHaveLength(ACTIVE_SKILL_SLOT_COUNT);
  });

  test('levels auto-unlock authored skills and cap at 20 without awarding class points', () => {
    const award = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[9] + 99999);
    expect(award.record.classLevel).toBe(20);
    expect(award.result).not.toHaveProperty('classPointsGained');
    expect(award.record.unlockedSkillIds).toEqual([
      'Стойкость', 'Устрашение', 'Кровавый таран', 'Удар щитом',
      'Ударная волна', 'Таран', 'Бросок щита', 'Кровавый вызов',
    ]);
  });

  test('one award crosses multiple levels, preserves overflow, and reports every new gate', () => {
    const award = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[5] + 37);
    expect(award.result).toMatchObject({ oldLevel: 1, newLevel: 6, levelsGained: 5, newXpWithinLevel: 37 });
    expect(award.result).not.toHaveProperty('classPointsGained');
    expect(award.result.newlyAvailableSkills).toEqual(['Ударная волна', 'Таран']);
    expect(award.result.newlyAvailablePassives).toEqual(['blood_pressure', 'last_stand', 'retaliatory_assault', 'headlong']);
    expect(award.result.newlyUnlockedPassiveSlots).toEqual([1, 2]);
    expect(award.result.newlyAvailableTalents).toEqual(['Кровавый таран']);
    expect(award.record.unlockedSkillIds).toEqual([...DEFENDER_STARTING_SKILLS, 'Ударная волна', 'Таран']);
    expect(award.record.purchasedPassiveIds).toEqual(['blood_pressure', 'last_stand', 'retaliatory_assault', 'headlong']);
  });

  test('stat-only Archer levels still report concrete growth instead of an empty level-up', () => {
    const level10 = grantClassExperience({}, 'Archer', CLASS_XP_THRESHOLDS[9]).progression;
    const level11 = grantClassExperience(level10, 'Archer', CLASS_XP_THRESHOLDS[10] - CLASS_XP_THRESHOLDS[9]);

    expect(level11.record.classLevel).toBe(11);
    expect(level11.result.newlyAvailableSkills).toEqual([]);
    expect(level11.result.newlyAvailablePassives).toEqual([]);
    expect(level11.result.newlyUnlockedPassiveSlots).toEqual([]);
    expect(level11.result.newlyAvailableTalents).toEqual([]);
    expect(level11.result.statGains).toEqual({ maxHp: 3, physDef: 1 });
  });

  test('Archer level 20 reports the capstone stat increase even without a new skill or talent', () => {
    const level19 = grantClassExperience({}, 'Archer', CLASS_XP_THRESHOLDS[18]).progression;
    const level20 = grantClassExperience(level19, 'Archer', CLASS_XP_THRESHOLDS[19] - CLASS_XP_THRESHOLDS[18]);

    expect(level20.record.classLevel).toBe(20);
    expect(level20.result.statGains).toEqual({ maxHp: 3, attack: 1, physDef: 1, magicDef: 1 });
    expect(level20.result.newlyAvailableSkills).toEqual([]);
    expect(level20.result.newlyAvailableTalents).toEqual([]);
  });

  test('gated skills become available automatically at their authored level but are not auto-equipped', () => {
    const level2 = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[1]).progression;
    expect(level2.Defender.unlockedSkillIds).not.toContain('Ударная волна');

    const level3 = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
    expect(level3.Defender.unlockedSkillIds).toContain('Ударная волна');
    expect(level3.Defender.activeSkillIds).not.toContain('Ударная волна');
  });

  test.each([['Таран', 5], ['Бросок щита', 7], ['Кровавый вызов', 9]])('%s appears exactly at level %i', (skill, level) => {
    const below = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[level - 2]).progression;
    expect(below.Defender.unlockedSkillIds).not.toContain(skill);
    const ready = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[level - 1]).progression;
    expect(ready.Defender.unlockedSkillIds).toContain(skill);
  });

  test('loadout replacement keeps exactly four unique unlocked skills and is blocked in combat', () => {
    const state = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
    const changed = assignClassSkill(state, 'Defender', 'Ударная волна', 1);
    expect(changed.success).toBe(true);
    expect(changed.record.activeSkillIds).toEqual(['Стойкость', 'Ударная волна', 'Кровавый таран', 'Удар щитом']);
    expect(new Set(changed.record.activeSkillIds).size).toBe(4);
    expect(assignClassSkill(changed.progression, 'Defender', 'Ударная волна', 2).success).toBe(false);
    expect(assignClassSkill(changed.progression, 'Defender', 'Кровавый таран', 2, { inCombat: true }).success).toBe(false);
    const player = applyClassLoadoutToPlayer({ class: 'Defender', attack: 10 }, changed.progression);
    expect(player.abilityNames.slice(0, -1)).toHaveLength(4);
  });

  test('active slot swap changes canonical order without changing membership', () => {
    const state = ensureClassProgression({});
    const swapped = swapClassSkillSlots(state, 'Defender', 0, 2);
    expect(swapped.success).toBe(true);
    expect(swapped.record.activeSkillIds).toEqual(['Кровавый таран', 'Устрашение', 'Стойкость', 'Удар щитом']);
    expect(new Set(swapped.record.activeSkillIds).size).toBe(ACTIVE_SKILL_SLOT_COUNT);
    expect(swapClassSkillSlots(swapped.progression, 'Defender', 0, 0).success).toBe(false);
    expect(swapClassSkillSlots(swapped.progression, 'Defender', 0, 1, { inCombat: true }).success).toBe(false);
  });

  test('migration preserves compatible legacy order and per-class records survive roundtrip', () => {
    const migrated = ensureClassProgression({}, { class: 'Defender', abilityNames: ['Устрашение', 'Стойкость', 'Кровавый таран', 'Удар щитом', 'Атака'] });
    expect(migrated.Defender.activeSkillIds).toEqual(['Устрашение', 'Стойкость', 'Кровавый таран', 'Удар щитом']);
    expect(ensureClassProgression(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });
});

describe('Defender passive progression', () => {
  test.each([[1,0,[]],[2,1,['blood_pressure','retaliatory_assault']],[5,1,['blood_pressure','retaliatory_assault']],[6,2,['blood_pressure','last_stand','retaliatory_assault','headlong']],[20,2,['blood_pressure','last_stand','retaliatory_assault','headlong']]])('level %i derives %i slots and expected availability', (level, slots, available) => {
    const { getPassiveSlotCount, CLASS_PROGRESSION_DEFINITIONS } = require('./classProgression');
    expect(getPassiveSlotCount('Defender', level)).toBe(slots);
    expect(CLASS_PROGRESSION_DEFINITIONS.Defender.passiveSkills.filter(p => p.requiredLevel <= level).map(p => p.id)).toEqual(available);
  });

  test('passives become available automatically by level and equip/remove still validates slots', () => {
    const { assignClassPassive, setClassPassiveSlots } = require('./classProgression');
    const state = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[3]).progression;
    expect(state.Defender.purchasedPassiveIds).toEqual(['blood_pressure', 'retaliatory_assault']);
    expect(state.Defender.equippedPassiveIds).toEqual([]);
    const equipped = assignClassPassive(state, 'Defender', 'blood_pressure', 0);
    expect(equipped.success).toBe(true);
    expect(equipped.record.equippedPassiveIds).toEqual(['blood_pressure']);
    const removed = setClassPassiveSlots(equipped.progression, 'Defender', [null]);
    expect(removed.success).toBe(true);
    expect(removed.record.equippedPassiveIds).toEqual([null]);
    expect(removed.record.purchasedPassiveIds).toContain('blood_pressure');
    expect(assignClassPassive(state, 'Defender', 'blood_pressure', 1).success).toBe(false);
  });

  test('legacy save migration strips point bookkeeping, derives level availability, and sanitizes passive state', () => {
    const legacy = { Defender: {
      classLevel: 10, cumulativeClassXp: 3200, earnedClassPoints: 9, spentClassPoints: 2,
      unlockedSkillIds: [...DEFENDER_STARTING_SKILLS, 'Ударная волна'],
      activeSkillIds: ['Ударная волна', ...DEFENDER_STARTING_SKILLS.slice(0,3)],
      purchases: { 'Ударная волна': { type: 'activeSkill', cost: 1 }, blood_pressure: { type: 'passiveSkill', cost: 1 } },
      purchasedPassiveIds: ['blood_pressure'],
      equippedPassiveIds: ['blood_pressure'],
    } };
    const migrated = ensureClassProgression(legacy).Defender;
    expect(migrated).toMatchObject({
      cumulativeClassXp: 3200,
      classLevel: 10,
      schemaVersion: 3,
      activeSkillIds: ['Ударная волна', ...DEFENDER_STARTING_SKILLS.slice(0,3)],
      purchasedPassiveIds: ['blood_pressure','last_stand','retaliatory_assault','headlong'],
    });
    expect(migrated).not.toHaveProperty('earnedClassPoints');
    expect(migrated).not.toHaveProperty('spentClassPoints');
    expect(migrated).not.toHaveProperty('purchases');
    expect(migrated.unlockedSkillIds).toEqual([
      ...DEFENDER_STARTING_SKILLS, 'Ударная волна', 'Таран', 'Бросок щита', 'Кровавый вызов',
    ]);
    const corrupt = ensureClassProgression({ Defender: {
      ...migrated,
      purchasedPassiveIds: ['blood_pressure','unknown'],
      equippedPassiveIds: ['blood_pressure','blood_pressure','headlong'],
    } }).Defender;
    expect(corrupt.purchasedPassiveIds).toEqual(['blood_pressure','last_stand','retaliatory_assault','headlong']);
    expect(corrupt.equippedPassiveIds).toEqual(['blood_pressure', null]);
  });
});

test('Class XP reports passive and slot availability only when crossing their authored levels', () => {
  let state=ensureClassProgression({});
  const level2=grantClassExperience(state,'Defender',CLASS_XP_THRESHOLDS[1]).result;
  expect(level2.newlyAvailablePassives).toEqual(['blood_pressure','retaliatory_assault']); expect(level2.newlyUnlockedPassiveSlots).toEqual([1]);
  state=grantClassExperience(state,'Defender',CLASS_XP_THRESHOLDS[5]).progression;
  const level6=grantClassExperience(ensureClassProgression({}),'Defender',CLASS_XP_THRESHOLDS[5]).result;
  expect(level6.newlyAvailablePassives).toEqual(['blood_pressure','last_stand','retaliatory_assault','headlong']); expect(level6.newlyUnlockedPassiveSlots).toEqual([1,2]);
});

test('normalizes legacy Elementalist passive IDs while schema v3 derives every level-earned passive', () => {
  const mage = ensureClassProgression({ Mage: {
    cumulativeClassXp: 3200,
    purchasedPassiveIds: ['catalyst', 'polarization'],
    equippedPassiveIds: ['catalyst', 'polarization'],
    purchases: { catalyst: { type: 'passiveSkill', cost: 1 }, polarization: { type: 'passiveSkill', cost: 1 } },
  } }).Mage;
  expect(mage.purchasedPassiveIds).toEqual(['lightning_speed', 'overheat', 'elemental_shell', 'elemental_resonance']);
  expect(mage.equippedPassiveIds).toEqual(['lightning_speed', 'overheat']);
  expect(mage).not.toHaveProperty('purchases');
});

test('XP feedback reports only actually new unlocks for grandfathered progression',()=>{
 const legacy={Defender:{
  schemaVersion:1,
  cumulativeClassXp:CLASS_XP_THRESHOLDS[3],
  earnedClassPoints:3,
  spentClassPoints:1,
  unlockedSkillIds:[...DEFENDER_STARTING_SKILLS],
  activeSkillIds:[...DEFENDER_STARTING_SKILLS],
  purchases:{last_stand:{type:'passiveSkill',cost:1}},
  purchasedPassiveIds:['last_stand'],
  equippedPassiveIds:['last_stand'],
 }};
 const migrated=ensureClassProgression(legacy);
 const award=grantClassExperience(migrated,'Defender',CLASS_XP_THRESHOLDS[5]-CLASS_XP_THRESHOLDS[3]);
 expect(award.record.classLevel).toBe(6);
 expect(award.result.newlyAvailablePassives).toEqual(['headlong']);
 expect(award.result.newlyUnlockedPassiveSlots).toEqual([2]);
 expect(award.result.newlyAvailableTalents).toEqual([]);
});

test('grandfathers a formerly legal level-four Last Stand while new level-four records do not get it',()=>{
 const legacy={Defender:{schemaVersion:1,cumulativeClassXp:CLASS_XP_THRESHOLDS[3],earnedClassPoints:3,spentClassPoints:1,unlockedSkillIds:[...DEFENDER_STARTING_SKILLS],activeSkillIds:[...DEFENDER_STARTING_SKILLS],purchases:{last_stand:{type:'passiveSkill',cost:1}},purchasedPassiveIds:['last_stand'],equippedPassiveIds:['last_stand']}};
 const migrated=ensureClassProgression(legacy).Defender;
 expect(migrated).toMatchObject({classLevel:4,purchasedPassiveIds:['blood_pressure','retaliatory_assault','last_stand'],equippedPassiveIds:['last_stand'],schemaVersion:3});
 expect(migrated).not.toHaveProperty('earnedClassPoints');
 expect(migrated).not.toHaveProperty('spentClassPoints');
 const freshLevelFour=grantClassExperience({},'Defender',CLASS_XP_THRESHOLDS[3]).progression.Defender;
 expect(freshLevelFour.purchasedPassiveIds).toEqual(['blood_pressure','retaliatory_assault']);
});

test('normalizes malformed saved progression collections instead of throwing during hydration', () => {
  const malformed = { Defender: {
    purchasedPassiveIds: {}, equippedPassiveIds: 'blood_pressure',
    unlockedSkillIds: { 0: 'Стойкость' }, activeSkillIds: 17, purchases: [],
  } };
  expect(() => ensureClassProgression(malformed)).not.toThrow();
  expect(ensureClassProgression(malformed).Defender).toMatchObject({
    purchasedPassiveIds: [], equippedPassiveIds: [], unlockedSkillIds: DEFENDER_STARTING_SKILLS,
  });
});
