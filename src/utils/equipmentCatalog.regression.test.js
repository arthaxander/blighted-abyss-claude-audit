import { equipment, equipmentByName } from '../data/equipment';
import { getEffectDefinition } from './effects';
import {
  applyEquipmentPatch,
  createEmptyEquipmentSlots,
  equipInventoryItemForClass,
  getEquipmentSlotCandidates,
  validateClassEquipment,
} from './equipmentManager';
import { initCombatSession } from './combatUtils';

const classForItem = item => {
  if (item.type === 'Shield') return 'Defender';
  if (item.type === 'MagicOffHand') return 'Elementalist';
  if (item.type === 'Weapon') {
    if (item.weaponType === 'bow') return 'Archer';
    if (['staff', 'wand', 'scepter', 'focus'].includes(item.weaponType)) return 'Elementalist';
    return 'Defender';
  }
  if (item.classBound && item.class !== 'Any') return item.class;
  return 'Defender';
};

const initialEquipmentFor = item => {
  const slots = createEmptyEquipmentSlots();
  if (item.type === 'MagicOffHand') slots.mainHand = 'Треснувший учебный фокус';
  return slots;
};

describe('equipment catalogue combat regression smoke test', () => {
  test.each(equipment.map(item => [item.name, item]))(
    '%s is indexed, equippable by an eligible class, and safe at combat initialization',
    (_name, item) => {
      expect(equipmentByName[item.name]).toBe(item);
      expect(getEquipmentSlotCandidates(item)).not.toHaveLength(0);

      const playerClass = classForItem(item);
      expect(validateClassEquipment(playerClass, item)).toEqual({ canEquip: true, message: null });
      const equipped = equipInventoryItemForClass({
        playerClass,
        equipmentState: initialEquipmentFor(item),
        inventory: [item.name],
        item,
      });
      expect(equipped.canEquip).toBe(true);
      expect(Object.values(equipped.equipment)).toContain(item.name);

      expect(() => initCombatSession({
        name: 'Регрессионный герой',
        class: playerClass,
        hp: 100,
        maxHp: 100,
        attack: 20,
        magAtk: 20,
        physDef: 10,
        magicDef: 10,
        speed: 100,
        equipment: equipped.equipment,
      }, [{
        name: 'Манекен',
        hp: 100,
        maxHp: 100,
        attack: 1,
        physDef: 0,
        magicDef: 0,
        speed: 1,
        abilities: [],
      }], { rng: () => 0.5 })).not.toThrow();
    },
  );

  test('all structured status references used by equipment resolve to runtime effects', () => {
    const references = equipment.flatMap(item => (item.descriptionParts || [])
      .filter(part => part && typeof part === 'object' && part.statusId)
      .map(part => ({ item: item.name, statusId: part.statusId })));

    expect(references.length).toBeGreaterThan(0);
    references.forEach(({ item, statusId }) => {
      expect({ item, statusId, definition: getEffectDefinition(statusId) }).toEqual({
        item,
        statusId,
        definition: expect.objectContaining({ id: expect.any(String) }),
      });
    });
  });
});

// Existing saves carry base stats separately from their old equipped totals.
test('recalculates saved equipment without stacking bonuses or healing missing health', () => {
  const baseStats = { maxHp: 100, attack: 10, magAtk: 0, physDef: 0, magicDef: 0, speed: 100 };
  const saved = {
    class: 'Defender', baseStats,
    equipment: { mainHand: 'Ржавый меч новобранца', armor: 'Куртка Мародёра' },
    maxHp: 118, hp: 59, attack: 17,
  };
  const patch = applyEquipmentPatch(saved, saved.equipment, []);
  expect(patch).toMatchObject({ maxHp: 114, hp: 57, attack: 15, physDef: 9, baseStats });
  const reloaded = applyEquipmentPatch({ ...saved, ...patch }, patch.equipment, []);
  expect(reloaded).toEqual(patch);
  const naked = applyEquipmentPatch({ ...saved, ...patch }, {}, []);
  expect(naked).toMatchObject({ maxHp: 100, hp: 50, attack: 10, baseStats });
});
