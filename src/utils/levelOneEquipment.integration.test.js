import { equipmentByName } from '../data/equipment';
import { createStarterEquipmentSlots } from '../components/CharacterSelectionScreen';
import {
  createEmptyEquipmentSlots,
  equipInventoryItemForClass,
  normalizeEquipmentLoadout,
} from './equipmentManager';
import { triggerEquipmentOnDirectDamage, TURN_METER_THRESHOLD } from './combatUtils';

const grimoire = equipmentByName['Полевой гримуар Отступника'];
const amulet = 'Амулет Крысиной Жилы';

describe('Level 1 location equipment', () => {
  test('Rat Vein grants bounded 10% tempo once per owner turn and resets next turn', () => {
    const attacker = { name: 'Лучник', turnMeter: 950, equipment: { amulet }, _equipmentTurnFlags: {} };
    const target = { hp: 20, effects: [{ id: 'bleed' }] };
    triggerEquipmentOnDirectDamage({ attacker, target, dealt: 3, ability: {} });
    expect(attacker.turnMeter).toBe(TURN_METER_THRESHOLD);
    attacker.turnMeter = 0;
    triggerEquipmentOnDirectDamage({ attacker, target, dealt: 3, ability: {} });
    expect(attacker.turnMeter).toBe(0);
    attacker._equipmentTurnFlags = {};
    triggerEquipmentOnDirectDamage({ attacker, target, dealt: 3, ability: {} });
    expect(attacker.turnMeter).toBe(100);
  });

  test('Rat Vein rejects non-direct secondary/periodic-style damage and cannot duplicate across targets', () => {
    const attacker = { turnMeter: 0, equipment: { amulet }, _equipmentTurnFlags: {} };
    const bleeding = { hp: 10, effects: [{ id: 'bleed' }] };
    triggerEquipmentOnDirectDamage({ attacker, target: bleeding, dealt: 2, ability: { isSecondaryDamage: true } });
    expect(attacker.turnMeter).toBe(0);
    triggerEquipmentOnDirectDamage({ attacker, target: bleeding, dealt: 2, ability: {} });
    triggerEquipmentOnDirectDamage({ attacker, target: { ...bleeding }, dealt: 2, ability: {} });
    expect(attacker.turnMeter).toBe(100);
  });

  test('magic off-hand accepts only a one-handed magic main hand', () => {
    const slots = createEmptyEquipmentSlots();
    slots.mainHand = 'Треснувший учебный фокус';
    const valid = equipInventoryItemForClass({ playerClass: 'Mage', equipmentState: slots, inventory: [grimoire.name], item: grimoire });
    expect(valid.canEquip).toBe(true);
    expect(valid.equipment.offHand).toBe(grimoire.name);

    ['Посох Украденной Искры', 'Старый короткий лук', 'Ржавый меч новобранца'].forEach(mainHand => {
      const state = { ...createEmptyEquipmentSlots(), mainHand };
      const result = equipInventoryItemForClass({ playerClass: 'Mage', equipmentState: state, inventory: [grimoire.name], item: grimoire });
      expect(result.canEquip).toBe(false);
      expect(result.inventory).toContain(grimoire.name);
      expect(result.equipment.mainHand).toBe(mainHand);
    });
  });

  test('incompatible weapon replacement returns the grimoire without item loss', () => {
    const normalized = normalizeEquipmentLoadout({ mainHand: 'Посох Украденной Искры', offHand: grimoire.name }, [], 'Mage');
    expect(normalized.equipment.mainHand).toBe('Посох Украденной Искры');
    expect(normalized.equipment.offHand).toBeNull();
    expect(normalized.inventory).toContain(grimoire.name);
  });

  test('physical shields and grimoires share the off-hand slot transactionally', () => {
    const state = { ...createEmptyEquipmentSlots(), mainHand: 'Треснувший учебный фокус', offHand: grimoire.name };
    const shield = equipmentByName['Щит Новобранца'];
    const result = equipInventoryItemForClass({ playerClass: 'Defender', equipmentState: state, inventory: [shield.name], item: shield });
    expect(result.canEquip).toBe(true);
    expect(result.equipment.offHand).toBe(shield.name);
    expect(result.inventory).toContain(grimoire.name);
  });

  test('Defender canonically starts with the recruit shield', () => {
    expect(equipmentByName['Щит Новобранца']).toMatchObject({ type: 'Shield', stats: { physDef: 4 } });
    expect(createStarterEquipmentSlots('Defender').offHand).toBe('Щит Новобранца');
  });
});
