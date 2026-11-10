import { findItemData, getItemDefinition } from './items';
import { resolveItemArt } from './itemArt';
import { ABILITY_LIBRARY } from './abilityPresets';
import { applyItemInCombat, initCombatSession, performPlayerAction } from '../utils/combatUtils';
import { addEffect } from '../utils/effects';

describe('Level 2 consumables', () => {
  test('Health Potion restores 65 HP through the canonical combat item contract', () => {
    expect(findItemData('Зелье здоровья')).toEqual(expect.objectContaining({
      name: 'Зелье здоровья',
      type: 'consumable',
      stackSize: 5,
      sourceTier: 'common',
    }));
    expect(getItemDefinition('Зелье здоровья')).toEqual(expect.objectContaining({
      artId: 'health_potion',
      type: 'heal',
      target: 'self',
      amount: 65,
    }));
    expect(resolveItemArt(getItemDefinition('Зелье здоровья')))
      .toContain('/assets/items/consumables/health_potion.webp');
  });

  test('Defensive Infusion replaces reinforced Shield Potion: 35 Shield and ward for two turns', () => {
    expect(findItemData('Защитный настой')).toEqual(expect.objectContaining({
      name: 'Защитный настой', type: 'consumable', stackSize: 5, sourceTier: 'common',
    }));
    expect(findItemData('Усиленное зелье щита')?.name).toBe('Защитный настой');
    expect(getItemDefinition('Защитный настой')).toEqual(expect.objectContaining({
      artId: 'reinforced_shield_potion',
      type: 'effects',
      target: 'self',
      effects: [
        expect.objectContaining({ id: 'shield', duration: 2, value: 35 }),
        expect.objectContaining({ id: 'magic_def_boost_minor', duration: 2 }),
      ],
    }));
    expect(resolveItemArt(getItemDefinition('Защитный настой')))
      .toContain('/assets/items/consumables/reinforced_shield_potion.webp');
  });

  test('Cleansing Compound always provides two-turn debuff immunity, removing one current negative effect if present', () => {
    expect(findItemData('Очищающий состав')).toEqual(expect.objectContaining({
      name: 'Очищающий состав', type: 'consumable', stackSize: 5, sourceTier: 'common',
    }));
    const player = {
      name: 'Герой', hp: 90, maxHp: 100, attack: 20, magAtk: 8, items: ['Очищающий состав'],
      abilities: [ABILITY_LIBRARY.Атака],
    };
    const session = initCombatSession(player, [{ name: 'Манекен', hp: 100, maxHp: 100, attack: 2 }]);
    session.state.initiative.playerReady = true;
    const hero = session.state.players[0];
    addEffect(hero, { id: 'poison', duration: 2 }, () => {}, session.state.enemies[0], { session });
    const used = applyItemInCombat(session, 'Очищающий состав');
    expect(used.itemUsed).toBe(true);
    expect(used.turnConsumed).toBe(false);
    expect(hero.effects.some(effect => effect.id === 'poison')).toBe(false);
    expect(hero.effects.find(effect => effect.id === 'block_curses')).toMatchObject({ remainingTurns: 2 });
  });

  test('Cleansing Compound blocks new debuffs without removing existing unrelated effects', () => {
    const player = {
      name: 'Герой', hp: 85, maxHp: 100, attack: 20, magAtk: 8,
      items: ['Очищающий состав'], abilities: [ABILITY_LIBRARY.Атака],
    };
    const session = initCombatSession(player, [
      { name: 'Манекен', hp: 250, maxHp: 250, attack: 8 },
    ]);
    session.state.initiative.playerReady = true;
    const hero = session.state.players[0];
    const enemy = session.state.enemies[0];
    addEffect(hero, { id: 'poison', duration: 2 }, () => {}, enemy, { session });
    addEffect(hero, { id: 'overgrowth', duration: 2 }, () => {}, enemy, { session });
    expect(hero.effects.filter(effect => ['poison', 'overgrowth'].includes(effect.id))).toHaveLength(2);
    const result = applyItemInCombat(session, 'Очищающий состав', { rng: () => 0 });
    expect(result.itemUsed).toBe(true);
    expect(result.turnConsumed).toBe(false);
    expect(hero.effects.filter(effect => ['poison', 'overgrowth'].includes(effect.id))).toHaveLength(1);
    expect(hero.effects.some(effect => effect.id === 'block_curses')).toBe(true);
    addEffect(hero, { id: 'bleed', duration: 2 }, () => {}, enemy, { session });
    expect(hero.effects.some(effect => effect.id === 'bleed')).toBe(false);
  });

  test('Bitter Resin Infusion uses the commissioned art and primed-hit contract', () => {
    expect(findItemData('Настой горькой живицы')).toEqual(expect.objectContaining({
      name: 'Настой горькой живицы',
      type: 'consumable',
      rarity: 'Необычная',
      sourceTier: 'location',
    }));
    expect(getItemDefinition('Настой горькой живицы')).toEqual(expect.objectContaining({
      artId: 'bitter_resin_infusion',
      type: 'primeNextDirectAttack',
      target: 'self',
      effect: expect.objectContaining({ id: 'poison', duration: 2 }),
    }));
    expect(resolveItemArt(getItemDefinition('Настой горькой живицы')))
      .toContain('/assets/items/consumables/bitter_resin_infusion.webp');
  });

  test('Bitter Resin Infusion primes exactly one successful direct hit', () => {
    const player = {
      name: 'Герой',
      hp: 100,
      maxHp: 100,
      attack: 20,
      magAtk: 10,
      critChance: 0,
      items: ['Настой горькой живицы'],
      abilities: [ABILITY_LIBRARY.Атака],
    };
    const target = { name: 'Манекен', hp: 500, maxHp: 500, attack: 1, physDef: 0, magicDef: 0 };
    const session = initCombatSession(player, [target]);
    session.state.initiative.playerReady = true;

    const used = applyItemInCombat(session, 'Настой горькой живицы');
    expect(used.itemUsed).toBe(true);
    expect(used.session.state.players[0].effects.find(effect => effect.id === 'prepared_weapon'))
      .toEqual(expect.objectContaining({
        extra: expect.objectContaining({
          sourceItemName: 'Настой горькой живицы',
          triggerEffect: expect.objectContaining({ id: 'poison', duration: 2 }),
          preparedDescription: expect.stringContaining('Следующая успешная прямая атака накладывает Отравление на 2 хода.'),
        }),
      }));

    performPlayerAction(used.session, 'Атака', 0);
    const poison = used.session.state.enemies[0].effects.find(effect => effect.id === 'poison');
    expect(poison).toMatchObject({ remainingTurns: 2 });
    expect(used.session.state.players[0].effects.some(effect => effect.id === 'prepared_weapon')).toBe(false);
  });

  test('Bitter Resin Infusion also triggers when Shield absorbs the direct hit', () => {
    const player = {
      name: 'Герой',
      hp: 100,
      maxHp: 100,
      attack: 10,
      magAtk: 10,
      critChance: 0,
      items: ['Настой горькой живицы'],
      abilities: [ABILITY_LIBRARY.Атака],
    };
    const target = {
      name: 'Манекен со щитом',
      hp: 500,
      maxHp: 500,
      shield: 100,
      attack: 1,
      physDef: 0,
      magicDef: 0,
    };
    const session = initCombatSession(player, [target]);
    session.state.initiative.playerReady = true;

    applyItemInCombat(session, 'Настой горькой живицы');
    performPlayerAction(session, 'Атака', 0);

    expect(session.state.enemies[0].effects.find(effect => effect.id === 'poison'))
      .toMatchObject({ remainingTurns: 2 });
    expect(session.state.players[0].effects.some(effect => effect.id === 'prepared_weapon')).toBe(false);
  });

  test('Last Spring Infusion heals, regenerates, and cleanses one Poison plus one Slow', () => {
    expect(findItemData('Настой последней весны')).toEqual(expect.objectContaining({
      name: 'Настой последней весны',
      type: 'consumable',
      rarity: 'Необычная',
      sourceTier: 'location',
      description: expect.stringContaining('Восстанавливает 30 здоровья'),
    }));
    expect(getItemDefinition('Настой последней весны')).toEqual(expect.objectContaining({
      artId: 'last_spring_infusion',
      type: 'heal',
      target: 'self',
      amount: 30,
      effects: [expect.objectContaining({ id: 'regeneration', duration: 2 })],
      removeEffects: [
        { ids: ['poison'], count: 1 },
        { ids: ['speed_penalty_minor', 'speed_penalty_major'], count: 1 },
      ],
    }));
    expect(resolveItemArt(getItemDefinition('Настой последней весны')))
      .toContain('/assets/items/consumables/last_spring_infusion.webp');

    const player = {
      name: 'Герой',
      hp: 40,
      maxHp: 100,
      attack: 20,
      magAtk: 10,
      items: ['Настой последней весны'],
      abilities: [ABILITY_LIBRARY.Атака],
    };
    const session = initCombatSession(
      player,
      [{ name: 'Манекен', hp: 500, maxHp: 500, attack: 1, physDef: 0, magicDef: 0 }]
    );
    const hero = session.state.players[0];
    const source = session.state.enemies[0];
    addEffect(hero, { id: 'poison', duration: 3 }, null, source, { session });
    addEffect(hero, { id: 'poison', duration: 2 }, null, source, { session });
    addEffect(hero, { id: 'speed_penalty_minor', duration: 2 }, null, source, { session });
    addEffect(hero, { id: 'speed_penalty_major', duration: 2 }, null, source, { session });
    addEffect(hero, { id: 'entanglement', stacks: 2 }, null, source, { session });
    session.state.initiative.playerReady = true;

    const used = applyItemInCombat(session, 'Настой последней весны');
    expect(used.itemUsed).toBe(true);
    expect(hero.hp).toBe(70);
    expect(hero.effects.filter(effect => effect.id === 'poison')).toHaveLength(1);
    expect(hero.effects.filter(effect => ['speed_penalty_minor', 'speed_penalty_major'].includes(effect.id))).toHaveLength(1);
    expect(hero.effects.filter(effect => effect.id === 'entanglement')).toHaveLength(2);
    expect(hero.effects.find(effect => effect.id === 'regeneration'))
      .toMatchObject({ remainingTurns: 2 });
  });

  test('Clinging Roots Scroll applies 3 Entanglement stacks to a normal target', () => {
    expect(findItemData('Свиток цепких корней')).toEqual(expect.objectContaining({
      name: 'Свиток цепких корней',
      type: 'consumable',
      rarity: 'Необычная',
      sourceTier: 'location',
    }));
    expect(getItemDefinition('Свиток цепких корней')).toEqual(expect.objectContaining({
      artId: 'clinging_roots_scroll',
      type: 'tacticalScroll', target: 'enemy', kind: 'clingingRoots',
    }));
    expect(resolveItemArt(getItemDefinition('Свиток цепких корней')))
      .toContain('/assets/items/consumables/clinging_roots_scroll.webp');

    const player = {
      name: 'Герой',
      hp: 100,
      maxHp: 100,
      attack: 20,
      magAtk: 10,
      items: ['Свиток цепких корней'],
      abilities: [ABILITY_LIBRARY.Атака],
    };
    const session = initCombatSession(
      player,
      [{ name: 'Манекен', hp: 500, maxHp: 500, attack: 1, physDef: 0, magicDef: 0, turnMeter: 500 }]
    );
    session.state.initiative.playerReady = true;

    const used = applyItemInCombat(session, 'Свиток цепких корней', { targetIndex: 0 });
    expect(used.itemUsed).toBe(true);
    expect(session.state.enemies[0].effects.filter(effect => effect.id === 'entanglement')).toHaveLength(3);
    expect(session.state.enemies[0].turnMeter).toBe(350);
  });

  test('Clinging Roots Scroll also reduces Turn Meter when it brings Entanglement to five stacks', () => {
    const player = {
      name: 'Герой',
      hp: 100,
      maxHp: 100,
      attack: 20,
      magAtk: 10,
      items: ['Свиток цепких корней'],
      abilities: [ABILITY_LIBRARY.Атака],
    };
    const session = initCombatSession(
      player,
      [{ name: 'Уже опутанная цель', hp: 500, maxHp: 500, attack: 1, physDef: 0, magicDef: 0, turnMeter: 600 }]
    );
    const target = session.state.enemies[0];
    addEffect(target, { id: 'entanglement', stacks: 2 }, null, player, { session });
    session.state.initiative.playerReady = true;

    const used = applyItemInCombat(session, 'Свиток цепких корней', { targetIndex: 0 });
    expect(used.itemUsed).toBe(true);
    expect(target.effects.filter(effect => effect.id === 'entanglement')).toHaveLength(5);
    expect(target.turnMeter).toBe(450);
  });

  test('Clinging Roots Scroll reduces Turn Meter by 15% against a control-immune target', () => {
    const player = {
      name: 'Герой',
      hp: 100,
      maxHp: 100,
      attack: 20,
      magAtk: 10,
      items: ['Свиток цепких корней'],
      abilities: [ABILITY_LIBRARY.Атака],
    };
    const session = initCombatSession(
      player,
      [{
        name: 'Иммунная цель',
        hp: 500,
        maxHp: 500,
        attack: 1,
        physDef: 0,
        magicDef: 0,
        controlImmune: true,
        turnMeter: 600,
      }]
    );
    session.state.initiative.playerReady = true;

    const used = applyItemInCombat(session, 'Свиток цепких корней', { targetIndex: 0 });
    expect(used.itemUsed).toBe(true);
    expect(session.state.enemies[0].turnMeter).toBe(450);
    expect(session.state.enemies[0].effects.some(effect => effect.id === 'entanglement')).toBe(false);
  });

  test('Blood Bandage remains field-only and is not a combat quick item definition', () => {
    expect(findItemData('Кровяная повязка')).toEqual(expect.objectContaining({
      name: 'Кровяная повязка',
      type: 'consumable',
      category: 'fieldMedicine',
      usableInCombat: false,
      fieldUse: expect.objectContaining({ healAmount: 30 }),
    }));
    expect(getItemDefinition('Кровяная повязка')).toBeNull();
  });
});
