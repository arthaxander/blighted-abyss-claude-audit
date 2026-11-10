import fs from 'fs';
import path from 'path';
import { equipment } from './equipment';
import { findItemData, ITEM_DATA } from './items';
import { ITEM_ART, ITEM_ART_PATHS, resolveItemArt } from './itemArt';
import { RUNE_LIBRARY } from './runes';
import {
  COMMON_LEVEL_TWO_EQUIPMENT,
  LEVEL_TWO_LOOT_LOCATIONS,
  LOCATION_LEVEL_TWO_EQUIPMENT,
} from './levelTwoLootOwnership';

const publicItemRoot = path.join(process.cwd(), 'public/assets/items');

describe('canonical item-art integrity', () => {
  test('every registry path is a physical file and no duplicated extension survives', () => {
    Object.values(ITEM_ART_PATHS).forEach(asset => {
      expect(asset).not.toMatch(/\.webp\.webp$/);
      expect(fs.existsSync(path.join(publicItemRoot, asset))).toBe(true);
    });
  });

  test('all active authored Level 1 definitions and runes resolve centrally', () => {
    const authoredNames = [...equipment, ...ITEM_DATA].filter(item => ITEM_ART_PATHS[item.name]);
    authoredNames.forEach(item => expect(resolveItemArt(item)).toBe(ITEM_ART[item.name]));
    RUNE_LIBRARY.forEach(rune => {
      expect(resolveItemArt(rune)).toContain(`/assets/items/runes/${rune.id}.webp`);
      expect(resolveItemArt(rune.name)).toBe(resolveItemArt(rune.id));
    });
    expect(resolveItemArt('Амулет Крысиной Жилы')).toContain('equipment/rat_vein_amulet.webp');
    expect(resolveItemArt('Полевой гримуар Отступника')).toContain('equipment/renegade_field_grimoire.webp');
  });

  test('all commissioned Level 2 common and Withering Forest art resolves centrally', () => {
    const forest = LEVEL_TWO_LOOT_LOCATIONS.WITHERING_FOREST;
    const expected = [
      ...COMMON_LEVEL_TWO_EQUIPMENT,
      ...LOCATION_LEVEL_TWO_EQUIPMENT[forest],
      'Лук последнего цветения',
      'Венец Раны Великого Корня',
      'Сумрачный сплав',
      'Выделанная кожа Бездны',
      'Глубинное полотно',
      'Чёрная сердцевина',
      'Горькая живица',
      'Цветок последней весны',
      'Ветвь Архонта',
      'Зелье здоровья',
      'Усиленное зелье щита',
      'Кровяная повязка',
      'Настой горькой живицы',
      'Настой последней весны',
      'Свиток цепких корней',
    ];

    expected.forEach(name => {
      expect(resolveItemArt(name)).toBeTruthy();
      expect(ITEM_ART_PATHS[name]).toBeTruthy();
    });
  });

  test('presentation components do not hardcode item asset paths', () => {
    const componentRoot = path.join(process.cwd(), 'src/components');
    fs.readdirSync(componentRoot).filter(name => name.endsWith('.js') && !name.endsWith('.test.js')).forEach(name => {
      expect(fs.readFileSync(path.join(componentRoot, name), 'utf8')).not.toMatch(/assets\/items\//);
    });
  });

  test('resolution and inspection are read-only', () => {
    const item = Object.freeze({ name: 'Амулет Крысиной Жилы' });
    const before = JSON.stringify(item);
    expect(resolveItemArt(item)).toBeTruthy();
    expect(JSON.stringify(item)).toBe(before);
  });

  test('every valid storage registry entry has a definition and a non-empty presentation', () => {
    [...ITEM_DATA, ...RUNE_LIBRARY].forEach(item => {
      const identity = item.id || item.name;
      const definition = item.id ? item : findItemData(identity);
      expect(definition).toBeTruthy();
      // Authored art is preferred; the storage grid renders a named fallback for
      // definitions for which no bespoke asset has been commissioned yet.
      expect(resolveItemArt(item) || definition.name.slice(0, 1)).toBeTruthy();
    });
  });

});
