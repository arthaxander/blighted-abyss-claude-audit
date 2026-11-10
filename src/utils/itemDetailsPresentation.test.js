import { formatItemStatValue, formatSignedValue, getEquipmentStatRows, getItemClassification, getItemTextSections, getMeaningfulEquipmentStatRows } from './itemDetailsPresentation';
import { equipment, equipmentByName } from '../data/equipment';
import { EQUIPMENT_DETAILS } from '../data/itemDetailsPresentation';
import { findItemData, getItemDefinition } from '../data/items';

describe('item details presentation', () => {
  test('derives compact classifications from canonical fields', () => {
    expect(getItemClassification({ type: 'equipment', equipmentType: 'Armor' })).toBe('Снаряжение · Доспех');
    expect(getItemClassification({ type: 'consumable', name: 'Малое зелье здоровья' })).toBe('Расходник · Зелье');
    expect(getItemClassification({ type: 'consumable', name: 'Свиток Лечения' })).toBe('Расходник · Свиток');
    expect(getItemClassification({ type: 'material', name: 'Простая ткань' })).toBe('Материал · Ремесло');
    expect(getItemClassification({ type: 'material', name: 'Эссенция Проклятий', sourceTier: 'rareCatalyst' })).toBe('Особый материал · Катализатор');
    expect(getItemClassification({ type: 'key', name: 'Ключ' })).toBe('Ключевой предмет');
  });

  test('uses authored weapon hands for handedness labels', () => {
    const item = { type: 'equipment', equipmentType: 'Weapon' };
    expect(getItemClassification(item, { type: 'Weapon', hands: 1 })).toBe('Снаряжение · Оружие · Одноручное');
    expect(getItemClassification(item, { type: 'Weapon', hands: 2 })).toBe('Снаряжение · Оружие · Двуручное');
    expect(getItemClassification({ type: 'equipment', equipmentType: 'Armor' }, { type: 'Armor' })).toBe('Снаряжение · Доспех');
  });

  test('compares only stats present on selected or equipped items', () => {
    expect(getEquipmentStatRows(
      { stats: { attack: 8, speed: 2 } },
      { stats: { attack: 4, physDef: 3 } }
    )).toEqual([
      expect.objectContaining({ key: 'attack', selectedValue: 8, currentValue: 4, delta: 4 }),
      expect.objectContaining({ key: 'speed', selectedValue: 2, currentValue: 0, delta: 2 }),
      expect.objectContaining({ key: 'physDef', selectedValue: 0, currentValue: 3, delta: -3 }),
    ]);
    expect(formatSignedValue(4)).toBe('+4');
    expect(formatSignedValue(-3)).toBe('-3');
  });

  test('meaningful comparison rows omit unchanged values', () => {
    expect(getMeaningfulEquipmentStatRows(
      { stats: { critChance: 0.03, attack: 6 } },
      { stats: { critChance: 0.03, attack: 4 } }
    )).toEqual([expect.objectContaining({ key: 'attack', delta: 2 })]);
  });

  test('localizes uncommon equipment types instead of exposing internal metadata', () => {
    expect(getItemClassification({ type: 'equipment', equipmentType: 'MagicOffHand' })).toBe('Снаряжение · Магический фокус');
    expect(getItemClassification({ type: 'equipment', equipmentType: 'MagicOffHand' })).not.toMatch(/Archer|support|self/);
  });

  test('formats semantic percentage stats without changing absolute stats', () => {
    expect(formatItemStatValue('critChance', 0.03)).toBe('3%');
    expect(formatItemStatValue('critChance', -0.03, { signed: true })).toBe('-3%');
    expect(formatItemStatValue('critChance', 0.03, { signed: true })).toBe('+3%');
    expect(formatItemStatValue('dodge', 0.05)).toBe('5%');
    expect(formatItemStatValue('critChance', 0.33)).toBe('33%');
    expect(formatItemStatValue('critDamage', 1.85)).toBe('185%');
    expect(formatItemStatValue('speed', 3, { signed: true })).toBe('+3');
    expect(formatItemStatValue('physDef', 5, { signed: true })).toBe('+5');
  });

  test('separates equipment flavor and effects without repeating structured stats', () => {
    const item = findItemData('Куртка Мародёра');
    const sections = getItemTextSections(item, equipmentByName[item.name]);
    expect(sections.flavor).toBe('Потрёпанная куртка лагерного налётчика.');
    expect(sections.effectParts.join('')).toBe('После победы восстанавливает 5% максимального здоровья.');
    expect(`${sections.flavor} ${sections.effectParts.join('')}`).not.toMatch(/\+12|\+4/);
  });

  test('seven recently changed items resolve mechanics from canonical equipment definitions', () => {
    const expected = {
      'Полевой гримуар Отступника': 'Первый раз за бой',
      'Натянутый охотничий лук': 'уникального врага с Кровотечением',
      'Капюшон Следопыта': '17 п.п.',
      'Плащ разведчика': 'на 40% меньше урона',
      'Кольцо Меткой Тетивы': '+0, +10 и затем +20 п.п.',
      'Пепельная Маска Отступника': 'Не продлевает Оглушение',
      'Клятвопреступник': '1 заряд Боевого ритма',
    };
    Object.entries(expected).forEach(([name, text]) => {
      const item = findItemData(name);
      const sections = getItemTextSections(item, equipmentByName[name]);
      expect(sections.effectParts.map(part => typeof part === 'string' ? part : part.text).join('')).toContain(text);
    });
    expect(getItemTextSections(findItemData('Пепельная Маска Отступника'), equipmentByName['Пепельная Маска Отступника']).effectParts.join(''))
      .not.toContain('безопасно продлеваемый');
  });

  test('audited equipment effects omit raw stats while canonical stat data remains intact', () => {
    const expectedStats = {
      'Полевой гримуар Отступника': { magAtk: 3, magicDef: 4 },
      'Натянутый охотничий лук': { attack: 12, speedPct: 0.03 },
      'Капюшон Следопыта': { maxHp: 11, physDef: 9, speedPct: 0.04, critChance: 0.03 },
      'Плащ разведчика': { maxHp: 15, physDef: 9, speedPct: 0.04 },
      'Кольцо Меткой Тетивы': { attack: 4, speedPct: 0.04 },
      'Пепельная Маска Отступника': { maxHp: 11, physDef: 7, magAtk: 3 },
    };
    Object.entries(expectedStats).forEach(([name, stats]) => {
      const item = findItemData(name);
      const effect = getItemTextSections(item, equipmentByName[name]).effectParts.join('');
      expect(equipmentByName[name].stats).toEqual(stats);
      expect(effect).not.toMatch(/Даёт \+|магической атаки и \+|скорости и \+|физической защиты\.$/);
      expect(effect.length).toBeGreaterThan(20);
    });
  });

  test('all equipment resolves presentation text, using canonical descriptions when curated copy is absent', () => {
    equipment.forEach(item => {
      const details = EQUIPMENT_DETAILS[item.name];
      const itemData = findItemData(item.name);
      const sections = getItemTextSections(itemData, item);

      expect(Boolean(sections.flavor) || sections.effectParts.length > 0).toBe(true);

      if (!details) {
        expect(sections.flavor).toBeNull();
        expect(sections.effectParts).toEqual(item.descriptionParts || [item.description]);
        return;
      }

      const presentationText = [details.flavor, ...(details.effectParts || [])]
        .filter(part => typeof part === 'string').join(' ');
      Object.values(item.stats || {}).forEach(value => expect(presentationText).not.toContain(`+${value} `));
    });
  });

  test('level-two equipment cards expose their authored mechanics through the fallback', () => {
    const item = findItemData('Лук последнего цветения');
    const sections = getItemTextSections(item, equipmentByName[item.name]);

    expect(EQUIPMENT_DETAILS[item.name]).toBeUndefined();
    expect(sections.flavor).toBeNull();
    expect(sections.effectParts).toEqual([equipmentByName[item.name].description]);
    expect(sections.effectParts.join('')).toContain('Семя увядания');
  });

  test('derives concise consumable mechanics from authoritative definitions', () => {
    const antimagic = findItemData('Малое зелье антимагии');
    const antimagicSections = getItemTextSections(antimagic, null, getItemDefinition(antimagic.name));
    expect(antimagicSections.effectParts).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Оберег' })]));
    expect(antimagicSections.effectParts.join('')).toContain('на 2 хода');
    const poultice = getItemTextSections(findItemData('Кровяная припарка'));
    expect(poultice.effectParts.join('')).toContain('Восстанавливает 15 здоровья');
    expect(poultice.effectParts).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Регенерация' })]));
    expect(poultice.usageNote).toContain('только вне боя');

    const regeneration = findItemData('Малое зелье регенерации');
    const regenerationSections = getItemTextSections(regeneration, null, getItemDefinition(regeneration.name));
    expect(regenerationSections.effectParts).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Регенерация' })]));
    expect(regenerationSections.effectParts.join('')).toContain('на 2 хода');
    expect(regenerationSections.effectParts.join('')).not.toContain('15%');
  });

  test('cleansing potion presentation follows its canonical cleanse count', () => {
    const item = findItemData('Малое зелье очищения');
    const definition = getItemDefinition(item.name);
    const details = getItemTextSections(item, null, definition);

    expect(definition.cleanseCount).toBe(1);
    expect(details.effectParts.join(' ')).toContain('Снимает один случайный штраф.');
  });

  test('uses authoritative ability mechanics for every combat scroll', () => {
    const fireball = getItemTextSections(findItemData('Свиток Огненного шара'), null, getItemDefinition('Свиток Огненного шара'));
    expect(fireball.effectParts).toEqual(expect.arrayContaining([expect.objectContaining({ statusId: 'burn', text: 'Горение' })]));
    expect(fireball.effectParts.map(part => typeof part === 'string' ? part : part.text).join('')).toContain('140% магической атаки');
    expect(fireball.effectParts).not.toEqual(expect.arrayContaining([expect.objectContaining({ statusId: 'magic_def_penalty_minor' })]));

    const poison = getItemTextSections(findItemData('Свиток Ядовитого облака'), null, getItemDefinition('Свиток Ядовитого облака'));
    expect(poison.effectParts.map(part => typeof part === 'string' ? part : part.text).join('')).toContain('110% магической атаки');
    expect(poison.effectParts).toEqual(expect.arrayContaining([expect.objectContaining({ statusId: 'poison', text: 'Отравление' })]));
    expect(poison.effectParts.join('')).toContain('на 3 хода');
  });
});
