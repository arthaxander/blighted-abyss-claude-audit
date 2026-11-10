import { FIELD_CRAFTING_RECIPES, getFieldCraftingRecipes } from '../data/recipes';
import { FIELD_CONSUMABLES } from '../data/fieldConsumables';
import { findItemData, getItemDefinition, combatItemConsumesTurn } from '../data/items';
import { craftRunInventoryRecipe, getRunInventoryLayout, getStackLimit, insertItems, RUN_INVENTORY_LAYOUT_VERSION, applyExpeditionDeath } from './expeditionInventory';
import { applyInventoryItemUse } from './inventoryItemUse';
import { initCombatSession, applyItemInCombat, processEnemyAI, performPlayerAction, applyDamage } from './combatUtils';
import { addEffect, getEffectDefinition } from './effects';
import { triggerPreparedFieldTrap } from './fieldTraps';
import { reconcileCombatConsumables } from './combatRunPersistence';
import { reviveCombatSession, snapshotCombatSession } from '../components/CombatScreen';
import { buildPlayerSnapshot, hydratePlayerSnapshot } from './playerState';
import { createEncounterRewardRoster, resolveEncounterRewardsOnce } from './encounterRewards';
import { rollResourceRoomLoot } from './roomGeneration';
import { createSeededSimulationRng } from './simulationRng';

const buildPlayer = (stacks = [], extra = {}) => {
  const layout = getRunInventoryLayout(extra.equipment);
  return { name: 'Герой', class: 'Defender', hp: 100, maxHp: 100, attack: 20, speed: 100, equipment: {}, abyssLevel: 1,
    runInventory: insertItems(Array(layout.totalCapacity).fill(null), stacks, { layout }).slots,
    runInventoryLayoutVersion: RUN_INVENTORY_LAYOUT_VERSION, ...extra };
};
const stack = (itemId, quantity = 1) => ({ itemId, quantity });
const foe = extra => ({ name: 'Испытуемый', hp: 200, maxHp: 200, attack: 20, speed: 100, abilities: [], ...extra });
const ready = (player, enemies = [foe()]) => { const s = initCombatSession(player, enemies, { rng: () => 0.99 }); s.state.initiative.playerReady = true; return s; };
const owned = (player, id) => player.runInventory.reduce((n, s) => n + (s?.itemId === id ? s.quantity : 0), 0);

describe('field catalogue and atomic inventory transactions', () => {
  test('all recipes are unique, usable, bounded and backed by real materials', () => {
    expect(new Set(FIELD_CRAFTING_RECIPES.map(r => r.id)).size).toBe(FIELD_CRAFTING_RECIPES.length);
    expect(new Set(FIELD_CRAFTING_RECIPES.map(r => r.result.name)).size).toBe(FIELD_CRAFTING_RECIPES.length);
    FIELD_CRAFTING_RECIPES.forEach(r => {
      expect(findItemData(r.result.name)?.type).toBe('consumable');
      expect(getItemDefinition(r.result.name) || findItemData(r.result.name).fieldUse).toBeTruthy();
      r.ingredients.forEach(i => { expect(findItemData(i.name)?.type).toBe('material'); expect(i.quantity).toBeGreaterThan(0); });
    });
    FIELD_CONSUMABLES.flatMap(i => i.combat?.effects || i.trap?.effects || []).forEach(e => expect(getEffectDefinition(e.id)).toBeTruthy());
    expect(getFieldCraftingRecipes({ abyssLevel: 2 })).toEqual(expect.arrayContaining(getFieldCraftingRecipes({ abyssLevel: 1 })));
  });
  test.each(FIELD_CRAFTING_RECIPES.map(r => [r.name, r]))('%s consumes its exact ingredients once', (_, recipe) => {
    const p = buildPlayer(recipe.ingredients.map(i => stack(i.name, i.quantity)), { abyssLevel: recipe.abyssLevel });
    const before = JSON.stringify(p);
    const result = craftRunInventoryRecipe(p, recipe);
    expect(result.success).toBe(true);
    expect(JSON.stringify(p)).toBe(before);
    recipe.ingredients.forEach(i => expect(owned(result.player, i.name)).toBe(0));
    expect(owned(result.player, recipe.result.name)).toBe(recipe.result.quantity);
    expect(craftRunInventoryRecipe(result.player, recipe).success).toBe(false);
  });
  test('no output capacity: ingredients in resource slots are not consumed', () => {
    const r = FIELD_CRAFTING_RECIPES.find(r => r.name === 'Свиток уязвимости');
    const p = buildPlayer(r.ingredients.map(i => stack(i.name, 2)));
    for (let i = 0; i < 14; i++) p.runInventory[i] = stack('Колючая западня', 3);
    const result = craftRunInventoryRecipe(p, r);
    expect(result).toMatchObject({ success: false, reason: 'insufficient-space' });
    expect(result.player).toBe(p);
  });
  test.each([0, -1, 0.5, NaN, Infinity])('invalid ingredient quantity %s never creates free items', quantity => {
    expect(craftRunInventoryRecipe(buildPlayer([stack('Простая ткань', 20)]), { name: 'Свиток уязвимости', ingredients: [{ name: 'Простая ткань', quantity }] }).success).toBe(false);
  });
  test('new consumables keep three-per-stack limits and typed bag capacity', () => {
    const p = buildPlayer([stack('Колючая западня', 4)]);
    expect(getStackLimit('Колючая западня')).toBe(3);
    expect(p.runInventory[12]).toEqual(stack('Колючая западня', 3));
    expect(p.runInventory[13]).toEqual(stack('Колючая западня'));
    expect(p.runInventory).toHaveLength(26);
  });
});

describe('upgraded tactical scrolls use the real combat engine', () => {
  test('shield theft transfers half of the selected shield and destroys half of other enemy shields', () => {
    const s = ready(buildPlayer([stack('Свиток кражи щита')]), [foe(), foe({ name: 'Другой' })]);
    const [one, two] = s.state.enemies;
    addEffect(one, { id: 'shield', value: 80, duration: 2 }, () => {}, one, { session: s });
    addEffect(two, { id: 'shield', value: 40, duration: 2 }, () => {}, two, { session: s });
    expect(applyItemInCombat(s, 'Свиток кражи щита').itemUsed).toBe(true);
    expect(one.shield).toBe(40);
    expect(two.shield).toBe(20);
    expect(s.state.players[0].shield).toBe(40);
    expect(one.hp).toBe(200);
    expect(two.hp).toBe(200);
  });
  test('shieldless fight does not spend shield theft', () => {
    const s = ready(buildPlayer([stack('Свиток кражи щита')]));
    expect(applyItemInCombat(s, 'Свиток кражи щита').itemUsed).toBe(false);
  });
  test('vulnerability buffs hero and weakens chosen defense before dealing 100% attack', () => {
    const s = ready(buildPlayer([stack('Свиток уязвимости')]), [foe({ physDef: 0, magicDef: 0 })]);
    expect(applyItemInCombat(s, 'Свиток уязвимости').itemUsed).toBe(true);
    expect(s.state.players[0].effects.some(e => e.id === 'attack_boost_minor')).toBe(true);
    expect(s.state.enemies[0].effects.some(e => e.id === 'phys_def_penalty_minor')).toBe(true);
    expect(s.state.enemies[0].hp).toBeLessThanOrEqual(175);
  });
  test('ice cone damages and delays all enemies, while boss immunity blocks only slowing', () => {
    const s = ready(buildPlayer([stack('Свиток Конус льда')]), [
      foe({ turnMeter: 700 }), foe({ name: 'Второй', turnMeter: 700, controlImmune: true }), foe({ name: 'Третий', turnMeter: 700 }),
    ]);
    s.state.enemies.forEach(enemy => { enemy.turnMeter = 700; });
    expect(applyItemInCombat(s, 'Свиток Конус льда').itemUsed).toBe(true);
    expect(s.state.enemies.map(enemy => enemy.turnMeter)).toEqual([400, 550, 550]);
    expect(s.state.enemies[0].effects.some(e => e.id === 'speed_penalty_major')).toBe(true);
    expect(s.state.enemies[1].effects.some(e => e.id === 'speed_penalty_minor')).toBe(false);
    expect(s.state.enemies[2].effects.some(e => e.id === 'speed_penalty_minor')).toBe(true);
    expect(s.state.enemies.every(enemy => enemy.hp < 200)).toBe(true);
  });
  test('dispel removes all removable buffs without touching innate, protected and debuffs', () => {
    const s = ready(buildPlayer([stack('Свиток рассеивания')]));
    const t = s.state.enemies[0];
    addEffect(t, { id: 'attack_boost_minor', duration: 2 }, () => {}, t, { session: s });
    addEffect(t, { id: 'magic_attack_boost_minor', duration: 2 }, () => {}, t, { session: s });
    addEffect(t, { id: 'regeneration', duration: 2, unremovable: true }, () => {}, t, { session: s });
    addEffect(t, { id: 'bleed', duration: 2 }, () => {}, t, { session: s });
    expect(applyItemInCombat(s, 'Свиток рассеивания', { rng: () => 0 }).itemUsed).toBe(true);
    expect(t.effects.map(e => e.id)).toEqual(expect.arrayContaining(['regeneration', 'bleed']));
    expect(t.effects.some(e => e.id === 'attack_boost_minor' || e.id === 'magic_attack_boost_minor')).toBe(false);
  });
  test('fireball and poison cloud affect whole group, but poison formula remains physical', () => {
    const s = ready(buildPlayer([stack('Свиток Огненного шара')]), [foe(), foe({ name: 'Второй' })]);
    expect(applyItemInCombat(s, 'Свиток Огненного шара').itemUsed).toBe(true);
    expect(s.state.enemies.every(unit => unit.hp < 200)).toBe(true);
    expect(s.state.enemies[0].effects.some(e => e.id === 'burn')).toBe(true);
    expect(s.state.enemies[1].effects.some(e => e.id === 'burn')).toBe(false);

    const p = ready(buildPlayer([stack('Свиток Ядовитого облака')]), [foe(), foe({ name: 'Второй' })]);
    expect(applyItemInCombat(p, 'Свиток Ядовитого облака').itemUsed).toBe(true);
    p.state.enemies.forEach(unit => {
      expect(unit.hp).toBeLessThan(200);
      expect(unit.effects.filter(e => e.id === 'poison')).toHaveLength(1);
      expect(unit.effects[0].remainingTurns).toBe(2);
    });
  });
  test('blood touch grants immediate vampire healing, 2-turn Mark and 1-turn Bleed', () => {
    const s = ready(buildPlayer([stack('Свиток Кровавого касания')], { hp: 50 }));
    expect(applyItemInCombat(s, 'Свиток Кровавого касания').itemUsed).toBe(true);
    expect(s.state.players[0].hp).toBeGreaterThan(50);
    expect(s.state.enemies[0].effects.find(e => e.id === 'vampire_mark')).toMatchObject({ remainingTurns: 2 });
    expect(s.state.enemies[0].effects.find(e => e.id === 'bleed')).toMatchObject({ remainingTurns: 1 });
  });
  test('Blood Touch affects only its selected enemy and does not spread Bleed', () => {
    const session = ready(buildPlayer([stack('Свиток Кровавого касания')], { hp: 50 }), [
      foe({ name: 'Цель' }), foe({ name: 'Другой враг' }),
    ]);
    expect(applyItemInCombat(session, 'Свиток Кровавого касания').itemUsed).toBe(true);
    expect(session.state.enemies[0].effects.find(e => e.id === 'bleed')).toMatchObject({ remainingTurns: 1 });
    expect(session.state.enemies[1].effects.some(e => ['bleed', 'vampire_mark'].includes(e.id))).toBe(false);
  });
});

describe('trap reservation, save/load and single consumption', () => {
  test.each(FIELD_CONSUMABLES.filter(e => e.trap).map(e => e.name))('%s stays in its slot until exactly one trigger', name => {
    const p = buildPlayer([stack(name, 2)]);
    const prepared = applyInventoryItemUse(p, 12, { inExpedition: true }).player;
    expect(owned(prepared, name)).toBe(2);
    expect(applyInventoryItemUse(prepared, 12, { inExpedition: true }).used).toBe(false);
    const loaded = hydratePlayerSnapshot(JSON.parse(JSON.stringify(buildPlayerSnapshot(prepared))));
    expect(loaded.preparedTrap).toBeUndefined();
    const initial = ready(loaded);
    expect(applyItemInCombat(initial, name).turnConsumed).toBe(true);
    expect(initial.state.initiative.playerReady).toBe(false);
    expect(applyItemInCombat(initial, name).itemUsed).toBe(false);
    const s = reviveCombatSession(JSON.parse(JSON.stringify(snapshotCombatSession(initial))));
    expect(triggerPreparedFieldTrap(s, s.state.enemies[0])).toBe(true);
    expect(triggerPreparedFieldTrap(s, s.state.enemies[0])).toBe(false);
    const revived = reviveCombatSession(JSON.parse(JSON.stringify(snapshotCombatSession(s))));
    expect(triggerPreparedFieldTrap(revived, revived.state.enemies[0])).toBe(false);
    const result = reconcileCombatConsumables(prepared, revived.state.players[0]);
    expect(owned(result, name)).toBe(1);
    expect(result.preparedTrap).toBeNull();
    expect(owned(reconcileCombatConsumables(result, revived.state.players[0]), name)).toBe(1);
  });
  test('untriggered trap survives battle save but is disarmed after battle without losing the item', () => {
    const p = applyInventoryItemUse(buildPlayer([stack('Колючая западня')]), 12, { inExpedition: true }).player;
    const s = ready(p);
    expect(applyItemInCombat(s, 'Колючая западня').turnConsumed).toBe(true);
    const revived = reviveCombatSession(JSON.parse(JSON.stringify(snapshotCombatSession(s))));
    const result = reconcileCombatConsumables(p, revived.state.players[0]);
    expect(revived.state.players[0].preparedTrap).toBe('Колючая западня');
    expect(result.preparedTrap).toBeNull();
    expect(owned(result, 'Колючая западня')).toBe(1);
    expect(applyExpeditionDeath(result).preparedTrap).toBeNull();
  });
  test('no owned item means no trigger, and no class-trap bonuses are invoked', () => {
    const s = ready(buildPlayer([], { preparedTrap: 'Колючая западня', class: 'Archer', _initiativeStacks: 2 }));
    expect(triggerPreparedFieldTrap(s, s.state.enemies[0])).toBe(false);
    expect(s.state.players[0]._initiativeStacks).toBe(2);
  });
  test('enemy AI triggers once, while control-immune boss retains normal speed', () => {
    const p = applyInventoryItemUse(buildPlayer([stack('Липкая западня', 3)]), 12, { inExpedition: true }).player;
    const s = ready(p, [foe({ boss: true, controlImmune: true })]);
    expect(applyItemInCombat(s, 'Липкая западня').turnConsumed).toBe(true);
    s.state.enemies[0].turnMeter = 1000;
    processEnemyAI(s);
    expect(s.state.fieldTrapUsage).toEqual({ 'Липкая западня': 1 });
    expect(s.state.enemies[0].effects.some(e => e.id === 'speed_penalty_minor')).toBe(false);
  });
});

describe('group and class edge cases for redesigned consumables', () => {
  test('magical base character gets magic buff and reduces magic defense', () => {
    const s = ready(buildPlayer([stack('Свиток уязвимости')], {
      class: 'Mage', attack: 5, magAtk: 30,
      baseStats: { attack: 5, magAtk: 30 },
    }), [foe({ magicDef: 0 })]);
    expect(applyItemInCombat(s, 'Свиток уязвимости').itemUsed).toBe(true);
    expect(s.state.players[0].effects.some(effect => effect.id === 'magic_attack_boost_minor')).toBe(true);
    expect(s.state.enemies[0].effects.some(effect => effect.id === 'magic_def_penalty_minor')).toBe(true);
  });

  test('poison cloud and fireball scale to six enemies with a single item use', () => {
    const six = () => Array.from({ length: 6 }, (_, n) => foe({ name: `Цель ${n + 1}` }));
    const poison = ready(buildPlayer([stack('Свиток Ядовитого облака')]), six());
    expect(applyItemInCombat(poison, 'Свиток Ядовитого облака').itemUsed).toBe(true);
    expect(poison.state.enemies).toHaveLength(6);
    poison.state.enemies.forEach(enemy => expect(enemy.effects.filter(e => e.id === 'poison')).toHaveLength(1));
    const fire = ready(buildPlayer([stack('Свиток Огненного шара')]), six());
    expect(applyItemInCombat(fire, 'Свиток Огненного шара').itemUsed).toBe(true);
    expect(fire.state.enemies.every(enemy => enemy.hp < 200)).toBe(true);
    expect(fire.state.enemies.filter(enemy => enemy.effects.some(e => e.id === 'burn'))).toHaveLength(1);
  });

  test('barbed trap bleeds every enemy and damages only its activator', () => {
    const s = ready(buildPlayer([stack('Колючая западня')]), [foe(), foe({ name: 'Другой' })]);
    expect(applyItemInCombat(s, 'Колючая западня').itemUsed).toBe(true);
    const callback = (victim, raw, type, source) => applyDamage(victim, raw, type, { source, session: s, directAttack: true });
    expect(triggerPreparedFieldTrap(s, s.state.enemies[0], () => {}, callback)).toBe(true);
    expect(s.state.enemies[0].hp).toBeLessThan(200);
    expect(s.state.enemies[1].hp).toBe(200);
    s.state.enemies.forEach(enemy => expect(enemy.effects.some(e => e.id === 'bleed')).toBe(true));
  });

  test('sticky trap delays all enemies but poisons only activator twice, preserving physical poison rules', () => {
    const s = ready(buildPlayer([stack('Липкая западня')]), [foe(), foe({ name: 'Босс', controlImmune: true })]);
    expect(applyItemInCombat(s, 'Липкая западня').itemUsed).toBe(true);
    s.state.enemies.forEach(enemy => { enemy.turnMeter = 600; });
    expect(triggerPreparedFieldTrap(s, s.state.enemies[0])).toBe(true);
    expect(s.state.enemies.map(enemy => enemy.turnMeter)).toEqual([450, 450]);
    expect(s.state.enemies[0].effects.filter(e => e.id === 'poison')).toHaveLength(2);
    expect(s.state.enemies[1].effects.filter(e => e.id === 'poison')).toHaveLength(0);
    expect(s.state.enemies[0].effects.some(e => e.id === 'speed_penalty_minor')).toBe(true);
    expect(s.state.enemies[1].effects.some(e => e.id === 'speed_penalty_minor')).toBe(false);
  });
});

describe('approved level two field consumables', () => {
  const damageCallback = session => (target, raw, type, source, magicSchool = null) =>
    applyDamage(target, raw, type, { session, source, magicSchool, directAttack: true });

  test('forest predatory shoots trap causes group Overgrowth and applies Healing Curse to activator', () => {
    const s = ready(buildPlayer([stack('Западня хищных побегов')], { abyssLevel: 2 }), [
      foe({ hp: 200 }), foe({ name: 'Второй', hp: 200 }),
    ]);
    expect(applyItemInCombat(s, 'Западня хищных побегов').itemUsed).toBe(true);
    const activator = s.state.enemies[0];
    expect(triggerPreparedFieldTrap(s, activator, () => {}, damageCallback(s))).toBe(true);
    s.state.enemies.forEach(target => expect(target.effects.find(effect => effect.id === 'overgrowth')).toMatchObject({ remainingTurns: 4 }));
    expect(activator.effects.find(effect => effect.id === 'healing_curse')).toMatchObject({ remainingTurns: 2 });
    expect(activator.hp).toBeLessThan(200);
    expect(s.state.enemies[1].hp).toBe(200);
  });

  test('fire trap hurts whole group, with greater damage and burning only on activator', () => {
    const s = ready(buildPlayer([stack('Огненная западня')], { abyssLevel: 2 }), [
      foe(), foe({ name: 'Другой' }), foe({ name: 'Третий' }),
    ]);
    expect(applyItemInCombat(s, 'Огненная западня').itemUsed).toBe(true);
    expect(triggerPreparedFieldTrap(s, s.state.enemies[0], () => {}, damageCallback(s))).toBe(true);
    expect(s.state.enemies.every(unit => unit.hp < 200)).toBe(true);
    expect(s.state.enemies[0].hp).toBeLessThan(s.state.enemies[1].hp);
    expect(s.state.enemies[0].effects.some(e => e.id === 'burn')).toBe(true);
    expect(s.state.enemies[1].effects.some(e => e.id === 'burn')).toBe(false);
  });

  test('burial seal uses the hero strongest attack, starts at 75% TM and survives save/load', () => {
    const s = ready(buildPlayer([stack('Погребальная печать')], { abyssLevel: 2, attack: 74, magAtk: 12 }), [
      foe({ attack: 28, magAtk: 62 }), foe({ name: 'Другой', attack: 5 }),
    ]);
    const first = s.state.enemies[0];
    expect(applyItemInCombat(s, 'Погребальная печать').itemUsed).toBe(true);
    first.turnMeter = 1000;
    processEnemyAI(s);
    const soul = s.state.players.find(unit => unit.summonKind === 'burial_seal_soul');
    expect(soul).toBeDefined();
    expect(soul).toMatchObject({
      maxHp: 150, magAtk: 74, speed: 100,
      physDef: 12, magicDef: 12, temporarySummon: true,
    });
    expect(soul._summonTemplate.startingTurnMeter).toBe(750);
    // The enemy turn continues after spawning and may already move the meter.
    expect(soul.turnMeter).toBeLessThanOrEqual(750);
    expect(soul.abilities).toHaveLength(1);
    expect(soul.abilities[0].basic).toBe(true);
    expect(soul._temporaryOwnTurnsRemaining).toBeGreaterThanOrEqual(1);
    expect(soul._temporaryOwnTurnsRemaining).toBeLessThanOrEqual(2);
    s.state.enemies.forEach(unit => expect(unit.effects.some(e => e.id === 'magic_def_penalty_minor')).toBe(true));
    expect(first.effects.some(e => e.id === 'vulnerability')).toBe(true);
    expect(s.state.fieldTrapUsage['Погребальная печать']).toBe(1);
    const saved = reviveCombatSession(JSON.parse(JSON.stringify(snapshotCombatSession(s))));
    expect(saved.state.players.find(unit => unit.summonKind === 'burial_seal_soul')?.magAtk).toBe(74);
  });

  test('burial seal tooltip matches its player-based 100% power and 75% starting meter', () => {
    const definition = FIELD_CONSUMABLES.find(item => item.name === 'Погребальная печать');
    expect(definition.description).toContain('МА равна 100% большей ФА/МА героя');
    expect(definition.description).toContain('75% шкалы хода');
    const touch = findItemData('Свиток Кровавого касания');
    expect(touch.description).toContain('[Метку вампира]');
    expect(touch.description).toContain('[Кровотечение] на 1 ход');
    expect(touch.description).toContain('[Метку вампира] на 2 хода');
  });

  test('burial seal uses magical attack if it is stronger than physical, ignoring enemy power', () => {
    const s = ready(buildPlayer([stack('Погребальная печать')], {
      abyssLevel: 2, attack: 15, magAtk: 93,
    }), [foe({ attack: 155, magAtk: 130 })]);
    expect(applyItemInCombat(s, 'Погребальная печать').itemUsed).toBe(true);
    s.state.enemies[0].turnMeter = 1000;
    processEnemyAI(s);
    const soul = s.state.players.find(unit => unit.summonKind === 'burial_seal_soul');
    expect(soul).toBeDefined();
    expect(soul.magAtk).toBe(93);
    expect(soul.basicAttackProfile).toBe('magical');
    expect(soul._summonTemplate.startingTurnMeter).toBe(750);
    // The enemy turn continues after spawning and may already move the meter.
    expect(soul.turnMeter).toBeLessThanOrEqual(750);
  });

  test('new L2 medicine and traps are one-action-appropriately and locked behind floor 2 recipes', () => {
    for (const name of ['Защитный настой', 'Очищающий состав', 'Погребальная печать', 'Западня хищных побегов', 'Огненная западня']) {
      const recipe = FIELD_CRAFTING_RECIPES.find(entry => entry.name === name);
      expect(recipe).toBeDefined();
      expect(recipe.abyssLevel).toBe(2);
      expect(recipe.ingredients.every(material => findItemData(material.name)?.type === 'material')).toBe(true);
      expect(combatItemConsumesTurn(name)).toBe(getItemDefinition(name).type === 'preparedTrap');
    }
    expect(FIELD_CRAFTING_RECIPES.find(entry => entry.name === 'Усиленное зелье щита')).toBeUndefined();
  });
});

describe('approved TM refund from Predatory Shoots', () => {
  const definition = FIELD_CONSUMABLES.find(entry => entry.name === 'Западня хищных побегов');
  test('prepared-trap combat payloads describe their distinct kind to simulator', () => {
    for (const entry of FIELD_CONSUMABLES.filter(item => item.trap)) {
      expect(getItemDefinition(entry.name)).toMatchObject({
        type: 'preparedTrap', kind: entry.trap.kind,
      });
    }
    expect(getItemDefinition('Западня хищных побегов').turnMeterGain).toBe(400);
  });

  test('shipped trap gives 40% TM and describes the same effect', () => {
    expect(definition.trap.turnMeterGain).toBe(400);
    expect(definition.description).toContain('+40% шкалы хода');
  });

  test.each([0, 300, 400, 500])('%i TM gain happens once at trap activation and respects 1000 TM cap', gain => {
    const before = definition.trap.turnMeterGain;
    try {
      definition.trap.turnMeterGain = gain;
      const session = ready(buildPlayer([stack('Западня хищных побегов')], { abyssLevel: 2 }), [foe()]);
      expect(applyItemInCombat(session, definition.name).itemUsed).toBe(true);
      const hero = session.state.players[0];
      hero.turnMeter = 720;
      const target = session.state.enemies[0];
      const callback = (victim, raw, type, source, school = null) =>
        applyDamage(victim, raw, type, { source, session, magicSchool: school, directAttack: true });
      expect(triggerPreparedFieldTrap(session, target, () => {}, callback)).toBe(true);
      expect(hero.turnMeter).toBe(Math.min(1000, 720 + gain));
      expect(triggerPreparedFieldTrap(session, target, () => {}, callback)).toBe(false);
      expect(hero.turnMeter).toBe(Math.min(1000, 720 + gain));
      expect(session.state.fieldTrapUsage[definition.name]).toBe(1);
      expect(target.effects.some(effect => effect.id === 'overgrowth')).toBe(true);
    } finally {
      if (before === undefined) delete definition.trap.turnMeterGain;
      else definition.trap.turnMeterGain = before;
    }
  });
});

describe('resource payouts are bounded and remain one-shot', () => {
  test.each(['Гоблинские Норы', 'Грибные Пещеры', 'Лагерь Отступников', 'Лес Увядания'])('%s provides a basic supply opportunity', location => {
    const loot = rollResourceRoomLoot(location, createSeededSimulationRng(15));
    expect(loot).toEqual(expect.arrayContaining([{ name: 'Простая склянка', quantity: 1 }, { name: 'Кровяной мох', quantity: 2 }, { name: 'Простая ткань', quantity: 1 }]));
    expect(loot.length).toBeLessThanOrEqual(8);
  });
  test('encounter reward persists across serialization, preventing a second supply roll', () => {
    const session = { state: { encounterReward: { roster: createEncounterRewardRoster([foe()]), location: 'Гоблинские Норы' } } };
    const loot = resolveEncounterRewardsOnce(session, () => 0);
    const restored = JSON.parse(JSON.stringify(session));
    expect(resolveEncounterRewardsOnce(restored, () => { throw new Error('reroll'); })).toEqual(loot);
  });
});


describe('consumable action costs', () => {
  test.each(['Свиток Лечения', 'Свиток уязвимости', 'Свиток Огненного шара', 'Колючая западня'])('%s costs a turn independently of its payload', name => {
    expect(combatItemConsumesTurn(name)).toBe(true);
  });
  test.each(['Малое зелье здоровья', 'Малое зелье атаки'])('%s leaves the ability action available', name => {
    const s = ready(buildPlayer([stack(name)], { hp: 50 }));
    expect(applyItemInCombat(s, name)).toMatchObject({ itemUsed: true, turnConsumed: false });
    expect(s.state.initiative.playerReady).toBe(true);
    expect(performPlayerAction(s, s.state.players[0].abilities.find(a => a.basic).name, 0).turnConsumed).toBe(true);
  });
  test.each(['Свиток Лечения', 'Свиток уязвимости', 'Свиток Огненного шара'])('%s prevents a second action and hands control to the enemy', name => {
    const s = ready(buildPlayer([stack(name)], { hp: 50 }));
    expect(applyItemInCombat(s, name)).toMatchObject({ itemUsed: true, turnConsumed: true });
    expect(s.state.initiative.playerReady).toBe(false);
    const hp = s.state.enemies[0].hp;
    expect(performPlayerAction(s, s.state.players[0].abilities.find(a => a.basic).name, 0).turnConsumed).toBe(false);
    expect(s.state.enemies[0].hp).toBe(hp);
    s.state.enemies[0].turnMeter = 1000;
    processEnemyAI(s);
    expect(s.state.players[0].hp).toBeLessThan(s.state.players[0].maxHp);
  });
  test('failed scroll does not consume the item or close the turn', () => {
    const s = ready(buildPlayer([stack('Свиток кражи щита')]));
    expect(applyItemInCombat(s, 'Свиток кражи щита')).toMatchObject({ itemUsed: false, turnConsumed: false });
    expect(s.state.initiative.playerReady).toBe(true);
    expect(s.state.players[0].items).toHaveLength(1);
  });
});


test('a turn-cost item advances cooldowns once; a failed attempt cannot tick them again', () => {
  const s = ready(buildPlayer([stack('Свиток кражи щита'), stack('Свиток уязвимости')]));
  const ability = s.state.players[0].abilities.find(a => a.basic);
  ability.currentCooldown = 3;
  expect(applyItemInCombat(s, 'Свиток кражи щита').itemUsed).toBe(false);
  const after = ability.currentCooldown;
  expect(after).toBe(2);
  expect(applyItemInCombat(s, 'Свиток кражи щита').itemUsed).toBe(false);
  expect(ability.currentCooldown).toBe(after);
  expect(applyItemInCombat(s, 'Свиток уязвимости').turnConsumed).toBe(true);
  expect(ability.currentCooldown).toBe(after);
});

test('stun consumes the turn without consuming the scroll or applying its payload', () => {
  const s = ready(buildPlayer([stack('Свиток уязвимости')]));
  s.state.turnState = { started: true, stunned: true, cooldownsProcessed: true, itemUsed: false };
  expect(applyItemInCombat(s, 'Свиток уязвимости')).toMatchObject({ itemUsed: false, turnConsumed: true });
  expect(s.state.initiative.playerReady).toBe(false);
  expect(s.state.players[0].items).toHaveLength(1);
  expect(s.state.enemies[0].effects.some(e => e.id === 'attack_penalty_minor')).toBe(false);
});

describe('cleansing removes a whole debuff type', () => {
  test('one potion removes every Entanglement charge while keeping another debuff and consumes one item', () => {
    const s = ready(buildPlayer([stack('Малое зелье очищения', 2)]));
    const hero = s.state.players[0];
    addEffect(hero, { id: 'entanglement', stacks: 5 }, () => {}, s.state.enemies[0], { session: s });
    addEffect(hero, { id: 'archon_bud', extra: { remainingSourceTurns: 2 } }, () => {}, s.state.enemies[0], { session: s });
    expect(hero.effects.filter(e => e.id === 'entanglement')).toHaveLength(5);
    const result = applyItemInCombat(s, 'Малое зелье очищения', { rng: () => 0 });
    expect(result.itemUsed).toBe(true);
    expect(result.turnConsumed).toBe(false);
    expect(hero.effects.some(e => e.id === 'entanglement')).toBe(false);
    expect(hero.effects.some(e => e.id === 'archon_bud')).toBe(true);
    expect(hero.items.filter(i => i.name === 'Малое зелье очищения')).toHaveLength(1);
  });
  test('random selection gives each type one entry regardless of stack count', () => {
    const s = ready(buildPlayer([stack('Малое зелье очищения')]));
    const hero = s.state.players[0];
    addEffect(hero, { id: 'entanglement', stacks: 5 }, () => {}, s.state.enemies[0], { session: s });
    addEffect(hero, { id: 'archon_bud', extra: { remainingSourceTurns: 2 } }, () => {}, s.state.enemies[0], { session: s });
    applyItemInCombat(s, 'Малое зелье очищения', { rng: () => 0.75 });
    expect(hero.effects.filter(e => e.id === 'entanglement')).toHaveLength(5);
    expect(hero.effects.some(e => e.id === 'archon_bud')).toBe(false);
  });
  test('removable applications from different sources are removed, protected applications survive', () => {
    const s = ready(buildPlayer([stack('Малое зелье очищения')]));
    const hero = s.state.players[0];
    addEffect(hero, { id: 'poison', duration: 2 }, () => {}, { id: 'a', attack: 10 }, { session: s });
    addEffect(hero, { id: 'poison', duration: 4 }, () => {}, { id: 'b', attack: 20 }, { session: s });
    const protectedEffect = { ...hero.effects.find(e => e.id === 'poison'), unremovable: true };
    hero.effects.push(protectedEffect);
    applyItemInCombat(s, 'Малое зелье очищения', { rng: () => 0 });
    expect(hero.effects.filter(e => e.id === 'poison')).toEqual([protectedEffect]);
  });
});
