import { prepareFreshDungeonRun, prepareLevelTwoDungeonRun, resetDungeonRunState } from './dungeonRunState';
import { migrateRunInventory, normalizeInventorySlots, RUN_INVENTORY_LAYOUT_VERSION } from './expeditionInventory';

test('fresh expedition actually migrates a conflict-free legacy inventory before marking it current', () => {
  const gear={itemId:'Куртка Новобранца',quantity:1,instanceId:'legacy-gear',socketedRuneId:'stone_vigil'};
  const legacy=normalizeInventorySlots([null,null,gear,{itemId:'Простая ткань',quantity:4},{itemId:'Малое зелье здоровья',quantity:2}],12);
  const player={runInventory:legacy,inventory:[],equipment:{},fishingTool:'Жезл глубинного лова',runSilver:0};
  const started=prepareFreshDungeonRun(player,'Гоблинские норы');
  expect(started.runInventory).toHaveLength(26);
  expect(started.runInventory[2]).toEqual(gear);
  expect(started.runInventory[12]).toMatchObject({itemId:'Малое зелье здоровья',quantity:2});
  expect(started.runInventory[14]).toMatchObject({itemId:'Простая ткань',quantity:4});
  expect(started.runInventoryLayoutVersion).toBe(RUN_INVENTORY_LAYOUT_VERSION);
  expect(migrateRunInventory(started.runInventory,started.equipment,started.runInventoryLayoutVersion)).toEqual(started.runInventory);
  expect(started.fishingTool).toBe('Жезл глубинного лова');
});

test('new run starts in map mode by default and clears map at run end', () => {
  const previous = process.env.REACT_APP_EXPEDITION_MAP_V1;
  delete process.env.REACT_APP_EXPEDITION_MAP_V1;
  const legacyFlow = prepareFreshDungeonRun({ equipment: {}, runInventory: [] }, 'Гоблинские норы');
  expect(legacyFlow.expeditionMap?.mainLayout?.topology).toBe('hex-board-v2');
  const ended = resetDungeonRunState({ ...legacyFlow, expeditionMap: { version: 1 }, expeditionMapRoomActive: true });
  expect(ended.expeditionMap).toBeUndefined();
  expect(ended.expeditionMapRoomActive).toBe(false);
  process.env.REACT_APP_EXPEDITION_MAP_V1 = previous;
});

test('fresh expedition de-duplicates an equipped instance after legacy typed migration',()=>{
  const duplicate={itemId:'Куртка Новобранца',quantity:1,instanceId:'equipped-armor',socketedRuneId:'stone_vigil'};
  const other={itemId:'Ржавый меч новобранца',quantity:1,instanceId:'carried-weapon',socketedRuneId:null};
  const legacy=normalizeInventorySlots([null,null,duplicate,other,{itemId:'Кровяной мох',quantity:3}],12);
  const started=prepareFreshDungeonRun({runInventory:legacy,inventory:[duplicate,other],equipment:{armor:duplicate}},'Грибные пещеры');
  expect(started.runInventory.filter(item=>item?.instanceId==='equipped-armor')).toHaveLength(0);
  expect(started.runInventory.filter(item=>item?.instanceId==='carried-weapon')).toHaveLength(1);
  expect(started.runInventory[14]).toMatchObject({itemId:'Кровяной мох',quantity:3});
  expect(started.inventory).toBeUndefined();
  expect(started.runInventoryLayoutVersion).toBe(RUN_INVENTORY_LAYOUT_VERSION);
});

test('each currently available first-floor location starts directly on a randomly selected hex map', () => {
  for (const name of ['Гоблинские Норы', 'Грибные Пещеры', 'Лагерь Отступников']) {
    const run = prepareFreshDungeonRun({ equipment: {}, runInventory: [] }, name);
    expect(run.expeditionMap?.mainLayout?.topology).toBe('hex-board-v2');
    expect(run.expeditionMap?.mainLayout?.locationId).toBe(name);
    expect(run.currentDungeonChoices).toBeNull();
    expect(run.expeditionMapRoomActive).toBe(false);
  }
});

test('entering enabled second-floor Forest starts a fresh map, not legacy three routes', () => {
  const run = prepareLevelTwoDungeonRun({
    abyssLevel: 2,
    expeditionPhase: 'level-selection',
    expeditionMap: { mainLayout: { templateId: 'old-floor-one-map' } },
  }, 'Лес Увядания');
  expect(run.expeditionMap.mainLayout.topology).toBe('hex-board-v2');
  expect(run.expeditionMap.mainLayout.locationId).toBe('Лес Увядания');
  expect(run.expeditionMap.mainLayout.templateId).toMatch(/^withering-forest-0[1-4]$/);
  expect(run.currentDungeonChoices).toBeNull();
  expect(run.expeditionMapRoomActive).toBe(false);
});
