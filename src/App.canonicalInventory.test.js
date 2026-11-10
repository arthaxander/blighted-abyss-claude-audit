import { createGuildPlayerAfterDeath, createGuildPlayerFromSelection, resolveNonCombatPendingLoot } from './App';
import { createPendingLoot, togglePendingLootSelection } from './utils/pendingLoot';
import { createExpeditionDeathResult, normalizeInventorySlots } from './utils/expeditionInventory';

test('death returns the same character to the Guild with expedition state reset', () => {
  const player = {
    name: 'Страж',
    class: 'Defender',
    hp: 0,
    maxHp: 120,
    shield: 33,
    effects: [{ id: 'poison' }],
    abyssLevel: 2,
    expeditionPhase: 'exploring',
    currentLocation: 'Лес',
    currentEnemies: [{ name: 'Враг' }],
    curses: { corruption: 2 },
    dominantCurseId: 'corruption',
    equipment: {},
    runInventoryLayoutVersion: 2,
    runInventory: [
      { itemId: 'Простая ткань', quantity: 1 },
      null,
      null,
    ],
  };
  const insuredStack = { itemId: 'Обрывки кожи', quantity: 1 };
  const result = createGuildPlayerAfterDeath({
    player,
    insurance: { successful: true, insuredStack },
  });

  expect(result).toMatchObject({
    name: 'Страж',
    class: 'Defender',
    hp: 120,
    shield: 0,
    abyssLevel: null,
    expeditionPhase: null,
    currentLocation: null,
    curses: {},
    dominantCurseId: null,
  });
  expect(result.effects).toEqual([]);
  expect(result.currentEnemies).toBeUndefined();
  expect(result.runInventory.filter(Boolean)).toEqual(expect.arrayContaining([
    expect.objectContaining({ itemId: 'Простая ткань' }),
    expect.objectContaining({ itemId: 'Обрывки кожи' }),
  ]));
});

const makeNewPlayer = () => ({ class: 'Defender', inventory: ['Простая ткань'], safeSlots: ['Простая ткань'], equipment: {}, questLog: {}, relics: {}, silver: 0 });

test('fresh character selection converts legacy definition input and strips both legacy fields', () => {
  const player = createGuildPlayerFromSelection({ newPlayer: makeNewPlayer(), carryOverRunInventory: [], classProgression: {}, relicState: {} });
  expect(player.runInventory.some(stack => stack?.itemId === 'Простая ткань')).toBe(true);
  expect(player.inventory).toBeUndefined(); expect(player.safeSlots).toBeUndefined();
});

test('typed Safe survivors retain exact positions and physical identity for the next character', () => {
  const first = { itemId: 'Капюшон Искателя Знаков', instanceId: 'safe-gear', socketedRuneId: 'stone_vigil', quantity: 1 };
  const second = { itemId: 'Простая ткань', quantity: 7 };
  const death = createExpeditionDeathResult({ equipment: {}, runInventory: normalizeInventorySlots([first, second, { itemId: 'Обрывки кожи', quantity: 2 }], 26), inventory: ['stale'], safeSlots: ['stale'] });
  const next = createGuildPlayerFromSelection({ newPlayer: makeNewPlayer(), carryOverRunInventory: death.player.runInventory.slice(0, 2), classProgression: {}, relicState: {} });
  expect(next.runInventory[0]).toEqual(first); expect(next.runInventory[1]).toEqual(second);
  expect(next.inventory).toBeUndefined(); expect(next.safeSlots).toBeUndefined();
});

test('non-combat pending cloth immediately recalculates typed inventory quest progress', () => {
  const player = createGuildPlayerFromSelection({ newPlayer: { ...makeNewPlayer(), inventory: Array(8).fill('Простая ткань') }, carryOverRunInventory: [], classProgression: {}, relicState: {} });
  let pending = createPendingLoot({ source: 'resource', loot: { items: [{ name: 'Простая ткань', quantity: 2 }] } });
  pending = togglePendingLootSelection(pending, pending.items[0].id);
  const result = resolveNonCombatPendingLoot(pending, player);
  expect(result.committed).toBe(true);
  expect(result.player.questLog['quest-stockpile-cloth']).toMatchObject({ progress: 10, completed: true });
});

test('canonical carried-item removal lowers inventory quest progress again', () => {
  const { applyRunInventoryQuestProgress } = require('./data/quests');
  let player = createGuildPlayerFromSelection({ newPlayer: { ...makeNewPlayer(), inventory: Array(10).fill('Простая ткань') }, carryOverRunInventory: [], classProgression: {}, relicState: {} });
  player = applyRunInventoryQuestProgress(player);
  expect(player.questLog['quest-stockpile-cloth'].completed).toBe(true);
  const reduced = player.runInventory.map(stack => stack?.itemId === 'Простая ткань' ? { ...stack, quantity: 4 } : stack);
  player = applyRunInventoryQuestProgress(player, reduced);
  expect(player.questLog['quest-stockpile-cloth']).toMatchObject({ progress: 4, completed: false });
});
