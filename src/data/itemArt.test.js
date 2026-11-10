import { ITEM_ART, resolveItemArt } from './itemArt';

describe('item artwork', () => {
  test.each([
    ['Куртка Мародёра', 'equipment/marauder_jacket.webp'],
    ['Булава Старого Сотника', 'equipment/old_centurion_mace.webp'],
    ['Походная сумка Гильдии', 'equipment/guild_bag.webp'],
    ['Металлические обломки', 'materials/metal_fragments.webp'],
    ['Кровяной мох', 'materials/blood_moss.webp'],
    ['Эссенция Проклятий', 'special/essence_of_corruption.webp'],
    ['Клинок должника', 'equipment/debtors_blade.webp'],
    ['Лук последнего цветения', 'equipment/last_bloom_bow.webp'],
    ['Венец Раны Великого Корня', 'equipment/great_root_wound_crown.webp'],
    ['Горькая живица', 'materials/bitter_resin.webp'],
    ['Настой последней весны', 'consumables/last_spring_infusion.webp'],
  ])('%s uses its canonical asset', (itemName, assetPath) => {
    expect(resolveItemArt(itemName)).toContain(`/assets/items/${assetPath}`);
    expect(resolveItemArt({ name: itemName })).toBe(resolveItemArt(itemName));
  });

  test('consumables use uploaded filenames and unmapped items fall back safely', () => {
    expect(resolveItemArt('Эссенция Осквернения')).toBe(resolveItemArt('Эссенция Проклятий'));
    expect(resolveItemArt({ artId: 'minor_health_potion' }))
      .toContain('/assets/items/consumables/minor_health_potion.webp');
    expect(resolveItemArt({ name: 'Малое зелье здоровья' }))
      .toBe(resolveItemArt({ artId: 'minor_health_potion' }));
    expect(resolveItemArt({ artId: 'blood_touch_scroll' }))
      .toContain('/assets/items/consumables/blood_touch_scrol.webp');
    expect(new Set(Object.values(ITEM_ART).filter(path => path.includes('/consumables/'))).size).toBe(22);
    expect(resolveItemArt('Предмет без иллюстрации')).toBeNull();
    expect(resolveItemArt(null)).toBeNull();
  });
});
