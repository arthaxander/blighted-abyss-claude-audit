import { finishEffectTurn, addEffect, EXCLUSIVE_EFFECT_FAMILIES, getEffectDefinition, processEffects } from './effects';
import { applyDamage, initCombatSession, performPlayerAction } from './combatUtils';
import { presentCombatStatuses } from './combatPresentation';
import { ABILITY_LIBRARY } from '../data/abilityPresets';

const unit = (overrides = {}) => ({
  name: 'Цель', hp: 1000, maxHp: 1000, attack: 0, magAtk: 0,
  physDef: 0, magicDef: 0, shield: 0, turnMeter: 0, effects: [], ...overrides,
});
const tickContext = (allies = []) => ({
  getAllies: () => allies,
  applyDamage: (target, amount, type, options) => applyDamage(target, amount, type, options),
});

describe('взаимоисключающие обычные и сильные статусы', () => {
  test('реестр содержит согласованные 10 пар', () => {
    expect(EXCLUSIVE_EFFECT_FAMILIES).toEqual([
      { minor: 'attack_boost_minor', major: 'attack_boost_major' },
      { minor: 'attack_penalty_minor', major: 'attack_penalty_major' },
      { minor: 'phys_def_boost_minor', major: 'phys_def_boost_major' },
      { minor: 'phys_def_penalty_minor', major: 'phys_def_penalty_major' },
      { minor: 'speed_boost_minor', major: 'speed_boost_major' },
      { minor: 'speed_penalty_minor', major: 'speed_penalty_major' },
      { minor: 'magic_def_boost_minor', major: 'magic_def_boost_major' },
      { minor: 'magic_def_penalty_minor', major: 'magic_def_penalty_major' },
      { minor: 'magic_attack_boost_minor', major: 'magic_attack_boost_major' },
      { minor: 'magic_attack_penalty_minor', major: 'magic_attack_penalty_major' },
    ]);
  });

  test.each(EXCLUSIVE_EFFECT_FAMILIES)('$minor заменяется на $major без переноса длительности', ({ minor, major }) => {
    const target = unit({ attack: 100, magAtk: 100, physDef: 100, magicDef: 100, speed: 100 });
    addEffect(target, { id: minor, duration: 5 }, jest.fn(), target);
    const upgraded = addEffect(target, { id: major, duration: 1 }, jest.fn(), target);
    expect(upgraded).toBeTruthy();
    expect(target.effects.filter(effect => effect.id === minor)).toHaveLength(0);
    expect(target.effects.filter(effect => effect.id === major)).toHaveLength(1);
    expect(target.effects.find(effect => effect.id === major)?.remainingTurns).toBe(1);
  });

  test.each(EXCLUSIVE_EFFECT_FAMILIES)('$minor не накладывается поверх $major и не продлевает его', ({ minor, major }) => {
    const target = unit({ attack: 100, magAtk: 100, physDef: 100, magicDef: 100, speed: 100 });
    const strong = addEffect(target, { id: major, duration: 2 }, jest.fn(), target);
    expect(addEffect(target, { id: minor, duration: 5 }, jest.fn(), target)).toBeNull();
    expect(target.effects.filter(effect => effect.id === minor)).toHaveLength(0);
    expect(target.effects.filter(effect => effect.id === major)).toEqual([strong]);
    expect(strong.remainingTurns).toBe(2);
  });

  test('апгрейд дебаффа не считается очищением и не запускает Сапоги вспыхнувшей жилы', () => {
    const target = unit({
      speed: 100,
      equipment: { feet: 'Сапоги вспыхнувшей жилы' },
    });
    addEffect(target, { id: 'speed_penalty_minor', duration: 3 }, jest.fn(), unit());
    addEffect(target, { id: 'speed_penalty_major', duration: 1 }, jest.fn(), unit());
    expect(target.effects.map(effect => effect.id)).toEqual(['speed_penalty_major']);
    expect(target._flaringVeinBootsCooldown).toBeUndefined();
  });

  test('противоположные по знаку статусы остаются независимыми', () => {
    const target = unit({ attack: 100 });
    addEffect(target, { id: 'attack_boost_major', duration: 3 }, jest.fn(), target);
    addEffect(target, { id: 'attack_penalty_major', duration: 3 }, jest.fn(), target);
    expect(target.effects.map(effect => effect.id)).toEqual(['attack_boost_major', 'attack_penalty_major']);
  });
});

describe('первый этап общего ребаланса статусов', () => {
  test('Кровотечение складывает ходы и использует текущую Атаку источника', () => {
    const source = unit({ name: 'Источник', attack: 100 });
    const target = unit();
    addEffect(target, { id: 'bleed', duration: 2 }, jest.fn(), source);
    addEffect(target, { id: 'bleed', duration: 3 }, jest.fn(), source);
    source.attack = 120;
    processEffects(target, jest.fn(), tickContext());
    expect(target.hp).toBe(760); // 120 × (0.75 + 0.25 × 5)
    expect(target.effects[0]).toMatchObject({ id: 'bleed', remainingTurns: 4 });
    expect(target.effects[0].sourceSnapshot.attack).toBe(120);
  });

  test('каждый Яд хранит snapshot и наносит 50% A + 2% H одним ходом', () => {
    const target = unit();
    const sourceA = unit({ attack: 100 });
    const sourceB = unit({ attack: 40 });
    addEffect(target, { id: 'poison', duration: 1 }, jest.fn(), sourceA);
    addEffect(target, { id: 'poison', duration: 1 }, jest.fn(), sourceB);
    sourceA.attack = 999;
    processEffects(target, jest.fn(), tickContext());
    expect(target.hp).toBe(890); // (50 + 20) + (20 + 20)
  });

  test('Панцирь Змеиного Полубога обращает новую формулу Яда в лечение', () => {
    const target = unit({ hp: 800, equipment: { body: 'Панцирь Змеиного Полубога' } });
    addEffect(target, { id: 'poison', duration: 1 }, jest.fn(), unit({ attack: 100 }));
    processEffects(target, jest.fn(), tickContext());
    expect(target.hp).toBe(870);
  });

  test('Горение использует snapshot, общую базу распространения и защиты получателей', () => {
    const target = unit({ maxHp: 1000, hp: 1000 });
    const ally = unit({ name: 'Союзник', hp: 1000, magicDef: 100 });
    const source = unit({ magAtk: 200 });
    addEffect(target, { id: 'burn', duration: 1 }, jest.fn(), source);
    source.magAtk = 999;
    processEffects(target, jest.fn(), tickContext([target, ally]));
    expect(target.hp).toBe(870); // 0.5 × 200 + 3% × 1000
    expect(ally.hp).toBe(967); // round(65 × 0.5 defense)
  });

  test('Горение учитывается Пламенем Великого Костра, не заменяя его', () => {
    const target = unit();
    const source = unit({ magAtk: 100 });
    addEffect(target, { id: 'burn', duration: 1 }, jest.fn(), source);
    addEffect(target, { id: 'great_bonfire_flame' }, jest.fn(), source);
    processEffects(target, jest.fn(), tickContext());
    expect(target.effects.find(effect => effect.id === 'great_bonfire_flame')?.extra.burnTicks).toBe(1);
    expect(target.hp).toBe(820); // Burn 80, then Flame 100 after one recorded Burn tick
  });

  test('зарядные статусы соблюдают срок и бессрочность, а разряд сохраняет остаток', () => {
    const target = unit();
    const source = unit({ magAtk: 100 });
    const session = { applyIndirectDamage: (victim, amount, type, options) => applyDamage(victim, amount, type, options) };
    for (let i = 0; i < 3; i += 1) addEffect(target, { id: 'charring' }, jest.fn(), source);
    addEffect(target, { id: 'ice_shards' }, jest.fn(), source);
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session });
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session });
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session });
    addEffect(target, { id: 'charge' }, jest.fn(), source, { session });
    expect(target.hp).toBe(920);
    expect(target.effects.filter(effect => effect.id === 'charge')).toHaveLength(1);
    processEffects(target, jest.fn(), tickContext());
    expect(target.effects.find(effect => effect.id === 'ice_shards')).toBeTruthy();
    expect(target.effects.filter(effect => effect.id === 'charring')).toHaveLength(3);
    // Non-periodic Charring does not age at turn start.
    expect(target.effects.find(effect => effect.id === 'charring').remainingTurns).toBe(3);
    finishEffectTurn(target, jest.fn(), tickContext());
    expect(target.effects.find(effect => effect.id === 'charring').remainingTurns).toBe(2);
  });

  test('Проводимость использует actualHpLost, защиты каждого получателя и не рекурсирует', () => {
    const carrier = unit({ hp: 1000, magicDef: 100 });
    const ally = unit({ hp: 1000, magicDef: 300 });
    const attacker = unit({ name: 'Атакующий' });
    const session = { state: { players: [attacker], enemies: [carrier, ally] } };
    addEffect(carrier, { id: 'conductivity' }, jest.fn(), attacker, { session });
    addEffect(ally, { id: 'conductivity' }, jest.fn(), attacker, { session });
    applyDamage(carrier, 200, 'physical', { source: attacker, directAttack: true, session });
    expect(carrier.hp).toBe(775); // direct 200 + round(50 / 2)
    expect(ally.hp).toBe(994); // round(25 / 4), no recursive chain
  });

  test.each([
    ['новый независимый экземпляр Яда', 'poison', { id: 'poison', duration: 2 }],
    ['повторное Горение', 'burn', { id: 'burn', duration: 3 }],
    ['добавление ходов Кровотечения', 'bleed', { id: 'bleed', duration: 2 }],
    ['добавление зарядов штрафа', 'charring', { id: 'charring', stacks: 2 }],
  ])('Печать блокирует %s уже существующего штрафа', (_label, id, attempted) => {
    const target = unit();
    const existing = addEffect(target, { id, duration: 1 }, jest.fn(), target);
    addEffect(target, { id: 'protection_seals' }, jest.fn(), target);
    expect(addEffect(target, attempted, jest.fn(), target)).toBeNull();
    expect(target.effects.filter(effect => effect.id === id)).toHaveLength(1);
    expect(target.effects).toContain(existing);
    expect(target.effects.some(effect => effect.id === 'protection_seals')).toBe(false);
  });

  test('одно пакетное наложение нескольких зарядов расходует ровно одну печать', () => {
    const target = unit();
    addEffect(target, { id: 'protection_seals' }, jest.fn(), target);
    addEffect(target, { id: 'protection_seals' }, jest.fn(), target);
    expect(addEffect(target, { id: 'charring', stacks: 3 }, jest.fn(), target)).toBeNull();
    expect(target.effects.filter(effect => effect.id === 'protection_seals')).toHaveLength(1);
    expect(target.effects.some(effect => effect.id === 'charring')).toBe(false);
  });

  test('extendOnly не создаёт отсутствующий дебафф и не расходует печать', () => {
    const target = unit();
    addEffect(target, { id: 'protection_seals' }, jest.fn(), target);
    expect(addEffect(target, { id: 'burn', duration: 1, extendOnly: true }, jest.fn(), unit())).toBeNull();
    expect(target.effects.map(effect => effect.id)).toEqual(['protection_seals']);
  });

  test('extendOnly прибавляет ходы существующему Горению вместо refresh', () => {
    const target = unit();
    const burn = addEffect(target, { id: 'burn', duration: 2 }, jest.fn(), unit({ magAtk: 50 }));
    expect(addEffect(target, { id: 'burn', duration: 1, extendOnly: true }, jest.fn(), unit({ magAtk: 999 }))).toBe(burn);
    expect(burn.remainingTurns).toBe(3);
    expect(burn.durationTotal).toBe(3);
  });

  test('extendOnly не повторяет onApply и не прерывает подготовку', () => {
    const target = unit();
    const stun = addEffect(target, { id: 'stun', duration: 1 }, jest.fn(), unit());
    target._preparation = { name: 'Подготовленный удар' };
    expect(addEffect(target, { id: 'stun', duration: 1, extendOnly: true, effectInstance: stun }, jest.fn(), unit())).toBe(stun);
    expect(stun.remainingTurns).toBe(2);
    expect(target._preparation).toEqual({ name: 'Подготовленный удар' });
  });

  test('extendOnly продлевает только явно выбранный независимый экземпляр Яда', () => {
    const target = unit();
    const firstSource = unit({ name: 'Первый', attack: 10 });
    const secondSource = unit({ name: 'Второй', attack: 20 });
    const first = addEffect(target, { id: 'poison', duration: 2 }, jest.fn(), firstSource);
    const second = addEffect(target, { id: 'poison', duration: 4 }, jest.fn(), secondSource);
    expect(addEffect(target, { id: 'poison', duration: 1, extendOnly: true, effectInstance: first }, jest.fn(), unit())).toBe(first);
    expect(target.effects.filter(effect => effect.id === 'poison')).toEqual([first, second]);
    expect(first.remainingTurns).toBe(3);
    expect(second.remainingTurns).toBe(4);
    expect(addEffect(target, { id: 'poison', duration: 1, extendOnly: true }, jest.fn(), unit())).toBeNull();
  });

  test('extendOnly сохраняет заряды, источник и данные, а бессрочный эффект не меняет', () => {
    const target = unit();
    const source = unit({ name: 'Источник', magAtk: 50 });
    const charring = addEffect(target, { id: 'charring', duration: 3 }, jest.fn(), source);
    charring.stacks = 2;
    charring.extra.accumulated = 17;
    const snapshot = charring.sourceSnapshot;
    addEffect(target, { id: 'charring', duration: 2, extendOnly: true, effectInstance: charring }, jest.fn(), unit({ magAtk: 999 }));
    expect(charring).toMatchObject({ remainingTurns: 5, stacks: 2, extra: { accumulated: 17 }, sourceRef: source });
    expect(charring.sourceSnapshot).toBe(snapshot);

    const charge = addEffect(target, { id: 'charge' }, jest.fn(), source);
    const before = { ...charge };
    expect(addEffect(target, { id: 'charge', duration: 5, extendOnly: true, effectInstance: charge }, jest.fn(), unit())).toBe(charge);
    expect(charge).toEqual(before);
  });

  test('Печати и Невосприимчивость не мешают отдельному продлению', () => {
    const extended = unit();
    const burn = addEffect(extended, { id: 'burn', duration: 2 }, jest.fn(), extended);
    addEffect(extended, { id: 'protection_seals' }, jest.fn(), extended);
    addEffect(extended, { id: 'block_curses' }, jest.fn(), extended);
    expect(addEffect(extended, { id: 'burn', duration: 1 }, jest.fn(), unit(), { effectOperation: 'extendDuration', effectInstance: burn })).toBe(burn);
    expect(burn.remainingTurns).toBe(3);
    expect(extended.effects.some(effect => effect.id === 'protection_seals')).toBe(true);

    const immune = unit({ controlImmune: true, innateControlImmune: true });
    addEffect(immune, { id: 'protection_seals' }, jest.fn(), immune);
    expect(addEffect(immune, { id: 'stun' }, jest.fn(), unit())).toBeNull();
    expect(immune.effects.some(effect => effect.id === 'protection_seals')).toBe(true);

    const blocked = unit();
    addEffect(blocked, { id: 'protection_seals' }, jest.fn(), blocked);
    addEffect(blocked, { id: 'block_curses' }, jest.fn(), blocked);
    expect(addEffect(blocked, { id: 'bleed' }, jest.fn(), unit())).toBeNull();
    expect(blocked.effects.some(effect => effect.id === 'protection_seals')).toBe(true);
  });

  test('временная Непоколебимость расширена, не расширяя врождённый иммунитет босса', () => {
    const temporary = unit({ _preparation: { name: 'Удар' } });
    addEffect(temporary, { id: 'control_immunity', duration: 1 }, jest.fn(), temporary);
    expect(addEffect(temporary, { id: 'provoked' }, jest.fn(), unit())).toBeNull();
    expect(addEffect(temporary, { id: 'speed_penalty_minor' }, jest.fn(), unit())).toBeNull();
    const boss = unit({ controlImmune: true, innateControlImmune: true });
    expect(addEffect(boss, { id: 'provoked' }, jest.fn(), unit())).toBeTruthy();
    expect(addEffect(boss, { id: 'stun' }, jest.fn(), unit())).toBeNull();
  });

  test('Непоколебимость блокирует массовое снижение и кражу TM, включая выгоду похитителя', () => {
    const protectedTarget = unit({ turnMeter: 600 });
    addEffect(protectedTarget, { id: 'control_immunity', duration: 1 }, jest.fn(), protectedTarget);
    ABILITY_LIBRARY['Грибная сеть'].apply({ targets: [protectedTarget] });
    expect(protectedTarget.turnMeter).toBe(600);

    const thief = unit({ turnMeter: 100 });
    const action = {};
    ABILITY_LIBRARY['Паразитический рефлекс'].onDamageDealt({
      owner: thief,
      target: protectedTarget,
      context: { directAttack: true, targetWasPoisoned: true, deliberateAction: action },
    });
    expect(protectedTarget.turnMeter).toBe(600);
    expect(thief.turnMeter).toBe(100);

    const ordinary = unit({ turnMeter: 600 });
    ABILITY_LIBRARY['Грибная сеть'].apply({ targets: [ordinary] });
    expect(ordinary.turnMeter).toBe(400);
  });

  test('только Оглушение и Заморозка отменяют подготовку', () => {
    const shocked = unit({ _preparation: { name: 'Удар' } });
    addEffect(shocked, { id: 'shock' }, jest.fn(), unit());
    expect(shocked._preparation).toBeTruthy();
    addEffect(shocked, { id: 'stun' }, jest.fn(), unit());
    expect(shocked._preparation).toBeNull();
    const frozen = unit({ _preparation: { name: 'Удар' } });
    addEffect(frozen, { id: 'freeze' }, jest.fn(), unit());
    expect(frozen._preparation).toBeNull();
  });

  test.each([
    ['принудительный крит', 0, 140],
    ['естественный крит с +50 п.п.', 1, 120],
  ])('Охотничья метка: %s одиночной атаки Лучника', (_label, critChance, expectedHp) => {
    const session = initCombatSession({
      name: 'Лучник', class: 'Archer', hp: 100, maxHp: 100, attack: 40,
      critChance, critDamage: 0.5, speed: 100,
      abilities: [{ name: 'Выстрел', damage: 40, type: 'physical', basic: true, alwaysHits: true }],
    }, [unit({ hp: 200, maxHp: 200, speed: 1 })], { rng: () => 0.5 });
    const target = session.state.enemies[0];
    addEffect(target, { id: 'hunting_mark' }, jest.fn(), session.state.players[0], { session });
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Выстрел', 0);
    expect(target.hp).toBe(expectedHp);
    expect(target.effects.some(effect => effect.id === 'hunting_mark')).toBe(false);
  });

  test('Перегрев зарегистрирован как бессрочное благословение максимум с 2 зарядами', () => {
    const target = unit();
    addEffect(target, { id: 'overheat' }, jest.fn(), target);
    addEffect(target, { id: 'overheat' }, jest.fn(), target);
    expect(addEffect(target, { id: 'overheat' }, jest.fn(), target)).toBeNull();
    const presented = presentCombatStatuses(target.effects);
    expect(presented[0]).toMatchObject({ id: 'overheat', stacks: 2, remainingTurns: null });
    expect(getEffectDefinition('overheat')).toMatchObject({ type: 'buff', iconPath: '/assets/combat/effects/status_overheat.webp' });
  });
});
