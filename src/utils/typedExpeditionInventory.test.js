import { canPlaceItemInSlotType, createItemStack, getRunInventoryLayout, insertItems, migrateRunInventory, moveInventoryStack, normalizeInventorySlots, sortOrdinaryInventory } from './expeditionInventory';

describe('typed expedition inventory', () => {
  test('canonical base and Guild bag layouts', () => {
    expect(getRunInventoryLayout().capacities).toEqual({ safe: 2, general: 10, consumable: 2, resource: 12 });
    expect(getRunInventoryLayout().totalCapacity).toBe(26);
    expect(getRunInventoryLayout({ bag: 'Походная сумка Гильдии' }).capacities).toEqual({ safe: 2, general: 12, consumable: 4, resource: 14 });
    expect(getRunInventoryLayout({ bag: 'Походная сумка Гильдии' }).totalCapacity).toBe(32);
  });
  test('routes resources and consumables to specialty cells before general and safe', () => {
    let result = insertItems(normalizeInventorySlots([], 26), [createItemStack('Кровяной мох'), createItemStack('Малое зелье здоровья')], { layout: getRunInventoryLayout() });
    expect(result.slots[14]?.itemId).toBe('Кровяной мох');
    expect(result.slots[12]?.itemId).toBe('Малое зелье здоровья');
    expect(result.slots.slice(0, 2)).toEqual([null, null]);
  });
  test('does not top up Safe while non-safe capacity exists', () => {
    const slots = normalizeInventorySlots([createItemStack('Кровяной мох', 3)], 26);
    const result = insertItems(slots, [createItemStack('Кровяной мох', 2)], { layout: getRunInventoryLayout() });
    expect(result.slots[0].quantity).toBe(3);
    expect(result.slots[14].quantity).toBe(2);
  });
  test('manual placement validates both sides of a swap and preserves identity', () => {
    expect(canPlaceItemInSlotType(createItemStack('Кровяной мох'), 'resource')).toBe(true);
    const gear = { itemId: 'Куртка Новобранца', quantity: 1, instanceId: 'i-1', socketedRuneId: 'ember_heart' };
    const slots = normalizeInventorySlots([], 26); slots[2] = gear; slots[14] = createItemStack('Кровяной мох');
    expect(moveInventoryStack(slots, 2, 14, getRunInventoryLayout())).toEqual(slots);
    expect(moveInventoryStack(slots, 2, 3, getRunInventoryLayout())[3]).toEqual(gear);
  });
  test('sort preserves Safe and moves specialty content out of General', () => {
    const slots = normalizeInventorySlots([], 26); slots[0] = createItemStack('Простая ткань', 2); slots[2] = createItemStack('Кровяной мох'); slots[3] = createItemStack('Малое зелье здоровья');
    const sorted = sortOrdinaryInventory(slots, getRunInventoryLayout());
    expect(sorted[0]).toEqual(slots[0]); expect(sorted[12]?.itemId).toBe('Малое зелье здоровья'); expect(sorted[14]?.itemId).toBe('Кровяной мох');
  });
  test('legacy migration preserves Safe positions and exact equipment metadata', () => {
    const old = normalizeInventorySlots([], 12); old[0] = createItemStack('Простая ткань', 4); old[2] = { itemId: 'Куртка Новобранца', quantity: 1, instanceId: 'legacy-i', socketedRuneId: 'stone_vigil' }; old[3] = createItemStack('Кровяной мох', 5);
    const migrated = migrateRunInventory(old, {});
    expect(migrated[0]).toEqual(old[0]); expect(migrated[2]).toEqual(old[2]); expect(migrated[14]).toEqual(old[3]);
  });
});

describe('future layouts and migration overflow', () => {
  test('explicit equal-total future distribution controls routing without length inference', () => {
    const { createInventoryLayout } = require('./expeditionInventory');
    const future = createInventoryLayout({ safe: 2, general: 6, consumable: 8, resource: 10 });
    const result = insertItems(normalizeInventorySlots([], 26), [createItemStack('Кровяной мох'), createItemStack('Малое зелье здоровья')], { layout: future });
    expect(result.slots[16]?.itemId).toBe('Кровяной мох');
    expect(result.slots[8]?.itemId).toBe('Малое зелье здоровья');
  });
  test('old Guild bag with fourteen general instances preserves two as overflow through current migration', () => {
    const equipment = { bag: 'Походная сумка Гильдии' };
    const old = normalizeInventorySlots([], 16);
    old[0] = createItemStack('Простая ткань');
    for (let index = 2; index < 16; index += 1) old[index] = { itemId: `legacy-gear-${index}`, quantity: 1, instanceId: `instance-${index}`, socketedRuneId: index === 2 ? 'stone_vigil' : null };
    const migrated = migrateRunInventory(old, equipment, 0);
    expect(migrated).toHaveLength(34);
    expect(migrated.filter(Boolean)).toHaveLength(15);
    expect(migrated.slice(32).map(item => item.instanceId)).toEqual(['instance-14', 'instance-15']);
    expect(migrateRunInventory(migrated, equipment, 2)).toEqual(migrated);
  });
});

describe('overflow lifecycle', () => {
  const legacyOverflowPlayer = () => {
    const equipment={bag:'Походная сумка Гильдии'}; const old=normalizeInventorySlots([],16); old[0]=createItemStack('Простая ткань'); old[1]=createItemStack('Обрывки кожи');
    for(let i=2;i<16;i+=1) old[i]={itemId:`overflow-gear-${i}`,quantity:1,instanceId:`overflow-instance-${i}`,socketedRuneId:i===2?'stone_vigil':null};
    return {class:'Defender',equipment,runInventory:old,inventory:[],runInventoryLayoutVersion:0,abilities:[]};
  };
  test('overflow survives snapshot hydration and sorting, but not expedition death',()=>{
    const {buildPlayerSnapshot,hydratePlayerSnapshot}=require('./playerState'); const {applyExpeditionDeath}=require('./expeditionInventory');
    const hydrated=hydratePlayerSnapshot(JSON.parse(JSON.stringify(buildPlayerSnapshot(legacyOverflowPlayer()))));
    expect(hydrated.runInventory).toHaveLength(34); expect(hydrated.runInventory.filter(Boolean)).toHaveLength(16);
    const sorted=sortOrdinaryInventory(hydrated.runInventory,getRunInventoryLayout(hydrated.equipment)); expect(sorted.filter(Boolean)).toHaveLength(16); expect(sorted).toHaveLength(34);
    const dead=applyExpeditionDeath({...hydrated,runInventory:sorted}); expect(dead.runInventory.filter(Boolean)).toHaveLength(2); expect(dead.runInventory).toHaveLength(32);
  });
  test('overflow is not pickup capacity and can resolve into a cleared General slot',()=>{
    const player=legacyOverflowPlayer(); const migrated=migrateRunInventory(player.runInventory,player.equipment,0); const layout=getRunInventoryLayout(player.equipment);
    const pickup=insertItems(migrated,[{itemId:'new-general-item',quantity:1}],{layout}); expect(pickup.fits).toBe(false); expect(pickup.slots).toHaveLength(34);
    migrated[2]=null; const resolved=sortOrdinaryInventory(migrated,layout); expect(resolved).toHaveLength(33); expect(resolved.filter(Boolean)).toHaveLength(15);
  });
  test('legacy Storage conversion uses all 300 all-General cells',()=>{ const {legacyStorageToSlots}=require('./expeditionInventory'); const storage=legacyStorageToSlots(Array.from({length:300},(_,i)=>`storage-${i}`)); expect(storage).toHaveLength(300); expect(storage[0]).toBeTruthy(); expect(storage[1]).toBeTruthy(); expect(storage[299]).toBeTruthy(); });
});
