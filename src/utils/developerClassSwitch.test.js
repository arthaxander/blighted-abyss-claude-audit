import { switchDeveloperClass } from './developerClassSwitch';
import { createClassBaseStats } from '../data/classTemplates';
import { CLASS_XP_THRESHOLDS, grantClassExperience } from '../data/classProgression';
import { createEmptyEquipmentSlots } from './equipmentManager';
import { getRunInventoryCapacity, normalizeInventorySlots } from './expeditionInventory';

test('class switch blocks combat and does not duplicate starter equipment', () => {
  const player = { class: 'Defender', attack: 10, baseAtk: 10, inventory: [], equipment: { ...createEmptyEquipmentSlots(), mainHand: 'Ржавый меч новобранца' }, silver: 77, meta: { rank: 2 } };
  expect(switchDeveloperClass(player, 'Mage', { inCombat: true })).toMatchObject({ success: false, player });
  const result = switchDeveloperClass(player, 'Mage');
  expect(result.success).toBe(true);
  expect(result.player).toMatchObject({ class: 'Mage', silver: 77, meta: { rank: 2 } });
  expect(result.player.inventory).toBeUndefined();
  expect(result.player.runInventory.some(stack => stack?.itemId === 'Ржавый меч новобранца')).toBe(true);
  expect(result.player.abilityNames).toContain('Огненный шар');
});

test('developer class switching retains the Defender progression record', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[4]).progression;
  const base = { class: 'Defender', attack: 10, inventory: [], equipment: {}, classProgression: progression };
  const away = switchDeveloperClass(base, 'Mage').player;
  const back = switchDeveloperClass(away, 'Defender').player;
  expect(back.classProgression.Defender).toEqual(progression.Defender);
  expect(back.classProgression.Defender.classLevel).toBe(5);
  expect(back.abilityNames.slice(0, 4)).toEqual(progression.Defender.activeSkillIds);
});

test.each([
  ['Defender', 'Archer'], ['Archer', 'Mage'], ['Mage', 'Defender'],
])('%s → %s reconstructs canonical base stats from the destination class', (from, to) => {
  const old = createClassBaseStats(from);
  const player = { class: from, ...old, baseStats: old, hp: old.maxHp, equipment: createEmptyEquipmentSlots(), inventory: [], classProgression: {} };
  const switched = switchDeveloperClass(player, to).player;
  expect(switched.baseStats).toEqual(createClassBaseStats(to));
  expect(switched.maxHp).toBe(createClassBaseStats(to).maxHp);
  expect(switched.attack).toBe(createClassBaseStats(to).attack);
  expect(switched.speed).toBe(createClassBaseStats(to).speed);
});

test('repeated class-switch cycles are idempotent and do not retain or accumulate prior stats', () => {
  const base = createClassBaseStats('Defender');
  const initial = { class: 'Defender', ...base, baseStats: base, hp: base.maxHp, equipment: createEmptyEquipmentSlots(), inventory: [], classProgression: {} };
  const once = switchDeveloperClass(switchDeveloperClass(initial, 'Archer').player, 'Defender').player;
  const cycled = ['Archer', 'Mage', 'Defender', 'Archer', 'Mage', 'Defender'].reduce((player, classId) => switchDeveloperClass(player, classId).player, initial);
  expect(once.baseStats).toEqual(base);
  expect(cycled.baseStats).toEqual(base);
  expect({ maxHp: cycled.maxHp, attack: cycled.attack, magAtk: cycled.magAtk, physDef: cycled.physDef, speed: cycled.speed })
    .toEqual({ maxHp: once.maxHp, attack: once.attack, magAtk: once.magAtk, physDef: once.physDef, speed: once.speed });
});

test('shared compatible equipment is applied exactly once after destination reconstruction', () => {
  const base = createClassBaseStats('Defender');
  const equipment = { ...createEmptyEquipmentSlots(), ring1: 'Кольцо Туманного Мха' };
  const initial = { class: 'Defender', ...base, baseStats: base, hp: base.maxHp, equipment, inventory: [], classProgression: {} };
  const archer = switchDeveloperClass(initial, 'Archer').player;
  expect(archer.maxHp).toBe(createClassBaseStats('Archer').maxHp + 8);
  expect(archer.speed).toBe(Math.round(createClassBaseStats('Archer').speed * 1.03));
  const back = switchDeveloperClass(archer, 'Defender').player;
  expect(back.maxHp).toBe(base.maxHp + 8);
  expect(back.speed).toBe(Math.round(base.speed * 1.03));
});

test('class reconstruction derives capacity from the compatible equipped Field Bag', () => {
  const bag = { itemId: 'Походная сумка Гильдии', instanceId: 'bag-instance', socketedRuneId: 'rune-kept' };
  const player = {
    class: 'Defender', attack: 10, inventory: [], equipment: { ...createEmptyEquipmentSlots(), bag },
    runInventory: normalizeInventorySlots([], 16),
  };
  expect(getRunInventoryCapacity({})).toBe(26);
  expect(getRunInventoryCapacity(player.equipment)).toBe(32);
  const switched = switchDeveloperClass(player, 'Mage');
  expect(switched.success).toBe(true);
  expect(switched.player.equipment.bag).toEqual(bag);
  expect(getRunInventoryCapacity(switched.player.equipment)).toBe(32);
  expect(switched.player.runInventory).toHaveLength(16);
});

test('progression markers are destination-local across every class transition', () => {
  let progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[19]).progression;
  progression = grantClassExperience(progression, 'Archer', CLASS_XP_THRESHOLDS[9]).progression;
  const defenderBase = createClassBaseStats('Defender');
  const initial = switchDeveloperClass({ class:'Defender', ...defenderBase, baseStats:defenderBase, hp:defenderBase.maxHp, equipment:createEmptyEquipmentSlots(), runInventory:[], classProgression:progression }, 'Defender').player;
  const mage = switchDeveloperClass(initial, 'Mage').player;
  expect(mage).toMatchObject({ class:'Mage', maxHp:80, hp:80, attack:8, magAtk:15, physDef:0, magicDef:0 });
  expect(mage.classProgressionStatBonus).toMatchObject({ maxHp:0, attack:0, magAtk:0 });
  const archer = switchDeveloperClass(mage, 'Archer').player;
  expect(archer).toMatchObject({ class:'Archer', maxHp:117, hp:117, attack:14, physDef:2, magicDef:2 });
  const defender = switchDeveloperClass(archer, 'Defender').player;
  expect(defender).toMatchObject({ class:'Defender', maxHp:220, hp:220, attack:20, physDef:24, magicDef:5 });
});
