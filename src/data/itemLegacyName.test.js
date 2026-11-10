import { findItemData, normalizeItemName } from './items';

test('Curse Essence is canonical while the old save name resolves safely', () => {
  expect(normalizeItemName('Эссенция Осквернения')).toBe('Эссенция Проклятий');
  expect(findItemData('Эссенция Осквернения')).toMatchObject({ name: 'Эссенция Проклятий', type: 'material' });
});
