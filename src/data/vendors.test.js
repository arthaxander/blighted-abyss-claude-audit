import { equipmentByName } from './equipment';
import { findItemData } from './items';
import VENDOR_DEFINITIONS, { getVendorCatalog } from './vendors';

describe('vendor catalogs', () => {
  test('the Quartermaster sells the existing Guild Travel Bag for 200 silver', () => {
    const bagName = 'Походная сумка Гильдии';
    const quartermaster = getVendorCatalog().find(vendor => vendor.id === 'quartermaster');
    const alchemist = getVendorCatalog().find(vendor => vendor.id === 'alchemist');
    const bagCatalogItem = quartermaster.items.find(item => item.name === bagName);

    expect(quartermaster.name).toBe('Интендант Торвальд');
    expect(bagCatalogItem).toMatchObject({
      name: bagName,
      price: 200,
      type: 'equipment',
    });
    expect(alchemist.items.some(item => item.name === bagName)).toBe(false);

    expect(findItemData(bagName)).toMatchObject({
      buyPrice: 200,
      equipmentType: 'Bag',
      inventorySlotBonuses: { general: 2, consumable: 2, resource: 2 },
    });
    expect(equipmentByName[bagName]).toMatchObject({
      type: 'Bag',
      inventorySlotBonuses: { general: 2, consumable: 2, resource: 2 },
    });
    expect(
      VENDOR_DEFINITIONS.find(vendor => vendor.id === 'quartermaster').stock
    ).toContain(bagName);
  });
});
