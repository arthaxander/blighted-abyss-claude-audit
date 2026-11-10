import fs from 'fs';
import path from 'path';

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

test('canonical item-icon overlays reserve bottom-left for quantity and top-right for contextual info', () => {
  const css = read('index.css');
  expect(css).toMatch(/\.item-icon-quantity\{[^}]*left:4px!important;[^}]*right:auto!important;[^}]*bottom:4px!important;[^}]*top:auto!important/);
  expect(css).toMatch(/\.item-icon-info\{[^}]*top:-2px!important;[^}]*right:-2px!important;[^}]*bottom:auto!important;[^}]*left:auto!important/);
  expect(css).toContain('.item-icon-info::after{content:"";position:absolute;inset:-6px}');
});

test('representative combat, picker, loot, inventory, and storage surfaces use the shared overlays', () => {
  const combat = read('components/CombatScreen.js');
  const loot = read('components/PendingLootModal.js');
  const inventory = read('components/InventoryGridModal.js');
  const storage = read('components/GuildScreen.js');
  expect(combat).toContain('quick-item-quantity-badge item-icon-quantity');
  expect(combat).toContain('combat-quick-item-picker__quantity item-icon-quantity');
  expect(combat).toContain('combat-quick-item-picker__info item-icon-info');
  expect(loot).toContain('className="item-icon-quantity"');
  expect(loot).toContain('pending-loot-info item-icon-info');
  expect(inventory).toContain('inventory-count item-icon-quantity');
  expect(storage).toContain('storage-grid__quantity item-icon-quantity');
  expect(storage).toContain('item-icon-info storage-grid__info');
});
