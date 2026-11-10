import { createProductionFreshCharacter } from './characterFactory';
import { normalizeInventorySlots } from './expeditionInventory';
import { applyPoulticeCraftPolicy, applySimulationGearPolicy, decideVoluntaryExtraction, scoreSimulationGear, scoreVisibleEncounterThreat } from './simulationExpeditionPolicies';
import { RUN_CHOICE_POLICIES } from './runSimulator';

describe('simulation expedition policies', () => {
  test('extraction handles function-authored ability effects without crashing', () => {
    expect(() => decideVoluntaryExtraction({ player: { hp: 50, maxHp: 100, items: [], abilities: [{ passive: false, currentCooldown: 0, effect: () => ({ id: 'shield' }) }] }, choices: [], policy: 'balanced', completedCombats: 1 })).not.toThrow();
  });
  test('smart gear values Bleed synergy while simple sees only raw stats', () => {
    const player = createProductionFreshCharacter({ classId: 'Archer' });
    player.abilities = [{ id: 'bleeding_shot', effects: [{ id: 'bleed' }] }];
    const bow = require('../data/equipment').equipmentByName['Натянутый охотничий лук'];
    expect(scoreSimulationGear(bow, player, 'smart').synergy).toBeGreaterThan(0);
    expect(scoreSimulationGear(bow, player, 'simple').synergy).toBe(0);
  });

  test('gear policy never equips an illegal weapon', () => {
    const player = createProductionFreshCharacter({ classId: 'Defender' });
    player.runInventory = normalizeInventorySlots([{ itemId: 'Натянутый охотничий лук', quantity: 1 }], 10);
    const result = applySimulationGearPolicy(player, [{ name: 'Натянутый охотничий лук', quantity: 1 }], 'smart');
    expect(result.decisions).toEqual([]);
    expect(result.player.equipment.mainHand).toBe('Ржавый меч новобранца');
  });

  test('balanced field crafting uses the canonical recipe and field item', () => {
    const player = createProductionFreshCharacter({ classId: 'Defender' });
    player.hp = 10;
    player.runInventory = normalizeInventorySlots([
      { itemId: 'Кровяной мох', quantity: 2 },
      { itemId: 'Простая ткань', quantity: 2 },
    ], 10);
    const result = applyPoulticeCraftPolicy(player, 'balanced');
    expect(result.metrics.crafted).toBeGreaterThan(0);
    expect(result.metrics.used).toBe(result.metrics.crafted);
    expect(result.player.hp).toBeGreaterThan(10);
    expect(result.player.runInventory.some(stack => stack?.itemId === 'Кровяная припарка')).toBe(false);
  });

  test('field recovery consumes an existing poultice before crafting and uses seeded Seal preservation', () => {
    const player = createProductionFreshCharacter({ classId: 'Defender' });
    player.hp = 10;
    player.relics.progress.recruit_seal = { level: 15, xp: 0 };
    player.runInventory = normalizeInventorySlots([{ itemId: 'Кровяная припарка', quantity: 1 }], 10);
    const result = applyPoulticeCraftPolicy(player, 'balanced', () => 0);
    expect(result.metrics).toMatchObject({ crafted: 0, used: 8, preserved: 8, usedByItemId: { 'Кровяная припарка': 8 } });
    expect(result.player.runInventory[0]).toMatchObject({ itemId: 'Кровяная припарка', quantity: 1 });
    expect(result.player.hp).toBe(125);
  });

  test('balanced extraction uses visible threat and recovery only', () => {
    const healthy = { hp: 90, maxHp: 100, items: [] };
    expect(decideVoluntaryExtraction({ player: healthy, choices: [{ roomType: 'combat' }], completedCombats: 1 }).extract).toBe(false);
    const depleted = { hp: 35, maxHp: 100, items: [] };
    expect(decideVoluntaryExtraction({ player: depleted, choices: [{ roomType: 'boss', hiddenComposition: 'ignored' }], completedCombats: 1 }).extract).toBe(true);
    expect(decideVoluntaryExtraction({ player: depleted, choices: [{ roomType: 'boss', hiddenComposition: 'different' }], completedCombats: 1 }))
      .toEqual(decideVoluntaryExtraction({ player: depleted, choices: [{ roomType: 'boss' }], completedCombats: 1 }));
  });

  test('balanced chooses the safer exact visible composition without inspecting future data', () => {
    const weak = { id: 'weak', attack: 4, magAtk: 0, abilities: [] };
    const strong = { id: 'strong', attack: 28, magAtk: 20, abilities: [{ targeting: 'all' }] };
    const safe = { id: 'safe-room', roomType: 'combat', enemies: [weak], hiddenFutureComposition: [strong] };
    const dangerous = { id: 'danger-room', roomType: 'combat', enemies: [strong, strong] };
    const context = { hp: 80, maxHp: 100, completedCombatRooms: 1, player: { physDef: 5, magicDef: 5 } };
    expect(scoreVisibleEncounterThreat(safe, context.player)).toBeLessThan(scoreVisibleEncounterThreat(dangerous, context.player));
    expect(RUN_CHOICE_POLICIES.balanced([dangerous, safe], () => 0.9, context)).toBe(safe);
    expect(scoreVisibleEncounterThreat({ ...safe, hiddenFutureComposition: [] }, context.player))
      .toBe(scoreVisibleEncounterThreat(safe, context.player));
  });
});
