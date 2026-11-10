import { getRunInventoryAcceptance, normalizeInventorySlots, RUN_INVENTORY_LAYOUT_VERSION } from './expeditionInventory';
const playerWith = entries => { const runInventory=normalizeInventorySlots([],26); entries.forEach(([index,item])=>{runInventory[index]=item;}); return {equipment:{},runInventory,runInventoryLayoutVersion:RUN_INVENTORY_LAYOUT_VERSION}; };
test.each([
 ['cloth without stack',playerWith([]),{itemId:'Простая ткань'},654,20],
 ['cloth 13/20',playerWith([[14,{itemId:'Простая ткань',quantity:13}]]),{itemId:'Простая ткань'},654,7],
 ['rune without stack',playerWith([]),{itemId:'ember_heart'},30,5],
 ['rune 3/5',playerWith([[2,{itemId:'ember_heart',quantity:3}]]),{itemId:'ember_heart'},30,2],
])('%s Стак quantity is canonical',(_label,owner,item,available,expected)=>expect(getRunInventoryAcceptance(owner,item,available).stackQuantity).toBe(expected));
test('full valid capacity allows only partial room and ignores free specialty cells',()=>{ const p=playerWith([]); [0,1,...Array.from({length:10},(_,i)=>i+2),...Array.from({length:12},(_,i)=>i+14)].forEach((i,n)=>{p.runInventory[i]={itemId:`full-${n}`,quantity:1};}); p.runInventory[14]={itemId:'Простая ткань',quantity:18}; expect(getRunInventoryAcceptance(p,{itemId:'Простая ткань'},654)).toMatchObject({stackQuantity:2,maxQuantity:2}); const gear=getRunInventoryAcceptance(p,{itemId:'Куртка Новобранца'},1); expect(gear.maxQuantity).toBe(0); });
