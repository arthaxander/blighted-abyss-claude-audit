import { normalizeInventorySlots } from './expeditionInventory';
import { getInventoryItemUseCapability, applyInventoryItemUse } from './inventoryItemUse';
test('Blood Poultice uses metadata, consumes one, and is blocked in combat', () => {
  const player={hp:5,maxHp:30,runInventory:normalizeInventorySlots([{itemId:'Кровяная припарка',quantity:2}],10),preCombatEffects:[]};
  expect(getInventoryItemUseCapability(player.runInventory[0],{inExpedition:true,inCombat:true}).available).toBe(false);
  const result=applyInventoryItemUse(player,0,{inExpedition:true,inCombat:false}); expect(result.used).toBe(true); expect(result.player.hp).toBe(20); expect(result.player.runInventory[0].quantity).toBe(1); expect(result.player.preCombatEffects[0].id).toBe('regeneration');
});

test('Blood Poultice caps healing, removes its last stack, and rejects full health', () => {
  const wounded={hp:25,maxHp:30,runInventory:normalizeInventorySlots([{itemId:'Кровяная припарка',quantity:1}],10),preCombatEffects:[]};
  const used=applyInventoryItemUse(wounded,0,{inExpedition:true,inCombat:false});
  expect(used).toMatchObject({used:true,player:{hp:30}}); expect(used.player.runInventory[0]).toBeNull();
  const full={...wounded,hp:30}; const rejected=applyInventoryItemUse(full,0,{inExpedition:true,inCombat:false});
  expect(rejected.used).toBe(false); expect(rejected.player).toBe(full); expect(rejected.reason).toBe('Здоровье уже полностью восстановлено');
});

test('a repeated use observes the updated stack and cannot consume twice', () => {
  const player={hp:1,maxHp:100,runInventory:normalizeInventorySlots([{itemId:'Кровяная припарка',quantity:1}],10),preCombatEffects:[]};
  const first=applyInventoryItemUse(player,0,{inExpedition:true,inCombat:false});
  const second=applyInventoryItemUse(first.player,0,{inExpedition:true,inCombat:false});
  expect(first.used).toBe(true); expect(second.used).toBe(false); expect(second.player.hp).toBe(16);
});


test('Blood Bandage is Level 2 field medicine with stronger canonical healing', () => {
  const player = {
    hp: 40,
    maxHp: 100,
    runInventory: normalizeInventorySlots([{ itemId: 'Кровяная повязка', quantity: 1 }], 10),
    preCombatEffects: [],
  };
  expect(getInventoryItemUseCapability(player.runInventory[0], { inExpedition: true, inCombat: true }).available).toBe(false);

  const result = applyInventoryItemUse(player, 0, { inExpedition: true, inCombat: false });
  expect(result.used).toBe(true);
  expect(result.player.hp).toBe(70);
  expect(result.player.runInventory[0]).toBeNull();
  expect(result.player.preCombatEffects).toEqual([
    expect.objectContaining({ id: 'regeneration', duration: 2, sourceName: 'Кровяная повязка' }),
  ]);
});
