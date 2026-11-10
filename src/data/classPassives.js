import { ELEMENTAL_CHARGE_DESCRIPTION, ELEMENTAL_CHARGE_DESCRIPTION_PARTS } from './elementalCharges';
export const CLASS_LABELS = {
  Defender: 'Защитник',
  Warrior: 'Защитник',
  Mage: 'Элементалист',
  Elementalist: 'Элементалист',
  Archer: 'Лучник',
};

const CLASS_PASSIVES = {
  Defender: {
    name: 'Шипастый щит',
    descriptionParts: ['Прямой удар по Защитнику с активным ', { statusId: 'shield', text: 'Щитом' }, ' накладывает на атакующего ', { statusId: 'bleed', text: 'Кровотечение' }, ' на 1 ход.'],
  },
  Archer: {
    name: 'Сквозные раны',
    description: 'Когда прямая атака Лучника добивает врага, весь избыточный урон переносится на одного случайного живого врага.',
  },
  Mage: { name: 'Заряд стихий', description: ELEMENTAL_CHARGE_DESCRIPTION, descriptionParts: ELEMENTAL_CHARGE_DESCRIPTION_PARTS },
};

export const getClassCombatPassive = player => {
  const classKey = player?.class === 'Warrior' ? 'Defender' : player?.class === 'Elementalist' ? 'Mage' : player?.class;
  return CLASS_PASSIVES[classKey] || null;
};

export const getClassDisplayName = className => CLASS_LABELS[className] || className || 'Герой';
