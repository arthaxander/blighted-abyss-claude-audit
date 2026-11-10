import fs from 'fs';
import path from 'path';
import { ABILITY_LIBRARY } from './abilityPresets';
import { ABILITY_ICONS, resolveAbilityIcon } from './combatAssets';
import { createEnemyInstanceByName, getEnemyBlueprintByName } from './enemies';
import { addEffect } from '../utils/effects';
import { initCombatSession, processEnemyAI } from '../utils/combatUtils';
import {
  beginCombatPresentation,
  consumeCombatPresentationEvents,
  getEnemyActionPresentationArtId,
} from '../utils/combatPresentationEvents';

const goblinAbilityArt = {
  'Крысиный зов': 'rat_call',
  'Приговор палача': 'execution_sentence',
  'Казнящий удар': 'execution_strike',
  'Мясной вихрь': 'meat_whirlwind',
  'Кровожадность': 'bloodlust',
  'Отравленный болт': 'poisoned_bolt',
  'Укрытие': 'goblin_cover',
  'Запутывающая сеть': 'entangling_net',
  'Укол иглой': 'needle_sting',
  'Зов помёта': 'litter_call',
  'Грызущая пасть': 'gnawing_maw',
  'Кормление стаи': 'feed_the_pack',
  'Зазубренная пика': 'serrated_pike',
  'Прорыв по норе': 'burrow_charge',
  'Тлеющий бросок': 'smoldering_throw',
  'Смоляная тряпка': 'tar_cloth',
  'Кормление костра': 'feed_the_fire',
  'Кристаллический надлом': 'crystalline_fracture',
  'Кристаллический срыв': 'crystalline_breakaway',
  'Кристальный удар': 'crystal_strike',
  'Осколочный рывок': 'shard_dash',
  'Хрустальный панцирь': 'crystal_carapace',
  'Запах раскрытой раны': 'scent_of_open_wound',
  'Мясистая хватка': 'fleshy_grip',
  'Янтарный припадок': 'amber_frenzy',
  'Инферно': 'inferno',
  'Пылающий щит': 'blazing_shield',
  'Огненный взрыв': 'fire_blast',
  'Грязный укус': 'dirty_bite',
};

const goblinPassives = new Set([
  'Кровожадность', 'Укрытие', 'Зов помёта', 'Кристаллический надлом',
  'Кристаллический срыв', 'Запах раскрытой раны', 'Инферно',
]);

const signatures = name => createEnemyInstanceByName(name).abilities
  .filter(ability => !ability.basic)
  .map(ability => ability.name);

describe('Goblin Nests ability artwork', () => {
  const entries = Object.entries(goblinAbilityArt);

  test('all signatures have their unique snake-case art IDs and registry files', () => {
    expect(entries).toHaveLength(29);
    expect(new Set(Object.values(goblinAbilityArt)).size).toBe(29);

    entries.forEach(([name, artId]) => {
      const ability = ABILITY_LIBRARY[name];
      expect(artId).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
      expect(ability).toMatchObject({ name, artId });
      expect(ABILITY_ICONS[artId]).toBe(`/assets/combat/abilities/goblin_nests/${artId}.webp`);
      expect(resolveAbilityIcon(ability)).toBe(ABILITY_ICONS[artId]);
      expect(fs.existsSync(path.join(process.cwd(), 'public', ABILITY_ICONS[artId]))).toBe(true);
    });
  });

  test('cast actions use matching presentation art while passives do not', () => {
    const activeEntries = entries.filter(([name]) => !goblinPassives.has(name));
    const passiveEntries = entries.filter(([name]) => goblinPassives.has(name));
    expect(activeEntries).toHaveLength(22);
    expect(passiveEntries).toHaveLength(7);

    activeEntries.forEach(([name, artId]) => {
      const ability = ABILITY_LIBRARY[name];
      expect(ability.enemyArtId).toBe(artId);
      expect(getEnemyActionPresentationArtId(ability)).toBe(artId);
      expect(resolveAbilityIcon({ artId: getEnemyActionPresentationArtId(ability) }))
        .toBe(`/assets/combat/abilities/goblin_nests/${artId}.webp`);
    });
    passiveEntries.forEach(([name, artId]) => {
      expect(ABILITY_LIBRARY[name]).toMatchObject({ passive: true, artId });
      expect(ABILITY_LIBRARY[name].enemyArtId).toBeUndefined();
    });
  });

  test('the shared basic attack remains unchanged', () => {
    expect(ABILITY_LIBRARY['Атака']).toMatchObject({ basic: true, artId: 'attack' });
    expect(ABILITY_ICONS.attack).toBe('/assets/combat/abilities/shared/attack.webp');
    expect(fs.existsSync(path.join(process.cwd(), 'public', ABILITY_ICONS.attack))).toBe(true);
  });
});

describe('Goblin Nests player-facing ability descriptions', () => {
  const names = Object.keys(goblinAbilityArt);

  test('all 29 signatures have complete serializable descriptions', () => {
    expect(names).toHaveLength(29);
    names.forEach(name => {
      const ability = ABILITY_LIBRARY[name];
      expect(ability.description.length).toBeGreaterThan(20);
      if (ability.descriptionParts) {
        expect(ability.descriptionParts.map(part => typeof part === 'string' ? part : part.text).join(''))
          .toBe(ability.description);
        expect(() => JSON.stringify(ability.descriptionParts)).not.toThrow();
      }
    });
  });

  test('historically risky descriptions expose current runtime values', () => {
    expect(ABILITY_LIBRARY['Зов помёта'].description).toMatch(/30%.*Лечение.*2 Чумных крыс/);
    expect(ABILITY_LIBRARY['Казнящий удар'].description).toMatch(/130%.*Уязвимостью.*50%.*185%.*оба условия.*усиления нет/);
    expect(ABILITY_LIBRARY['Кормление стаи'].description).toMatch(/5%.*каждую живую/);
    expect(ABILITY_LIBRARY['Мясной вихрь'].description).toMatch(/150%.*50%.*Кровотечение.*2 хода/);
    expect(ABILITY_LIBRARY['Пылающий щит'].description).toMatch(/40.*2 хода.*75%.*Горение.*2 хода/);
    expect(ABILITY_LIBRARY['Огненный взрыв'].description).toMatch(/50%.*10%.*Горение.*3 хода.*Слепоту.*1 ход/);
    expect(ABILITY_LIBRARY['Кристаллический срыв'].description)
      .toMatch(/разрушает Щит.*немедленно применяет Осколочный рывок.*не перезаряжается.*одного раза за ход/);
  });
});

describe('active Goblin Nests ability kits', () => {
  test('roster assignments stay concise and preserve the Plague Rat bite', () => {
    expect(signatures('Крысомант из Нор')).toEqual(['Крысиный зов', 'Крысиные бега']);
    expect(signatures('Гоблин-палач')).toEqual(['Приговор палача', 'Казнящий удар']);
    expect(signatures('Крысиный матриарх')).toEqual(['Зов помёта', 'Грызущая пасть', 'Кормление стаи']);
    expect(signatures('Крысиный всадник')).toEqual(['Зазубренная пика', 'Прорыв по норе']);
    expect(signatures('Гоблин-огнепоклонник')).toEqual(['Тлеющий бросок', 'Смоляная тряпка', 'Кормление костра']);
    expect(signatures('Осквернённый гоблин-крысокожий')).toEqual(['Запах раскрытой раны', 'Мясистая хватка', 'Янтарный припадок']);
    expect(signatures('Чумная крыса')).toEqual(['Грязный укус']);
  });

  test('Executioner judgment applies Weakness and strike has one execution multiplier', () => {
    const judgment = ABILITY_LIBRARY['Приговор палача'];
    const strike = ABILITY_LIBRARY['Казнящий удар'];
    const attacker = { attack: 20 };
    const healthy = { hp: 100, maxHp: 100, effects: [] };
    const weak = { ...healthy, effects: [{ id: 'vulnerability' }] };
    const wounded = { ...healthy, hp: 49 };
    const both = { ...weak, hp: 49 };

    expect(judgment).toMatchObject({ cooldown: 3, damage: 0, type: 'support' });
    expect(judgment.effect).toMatchObject({ id: 'vulnerability', duration: 2 });
    expect(strike.damage({ attacker, target: healthy })).toBe(26);
    expect(strike.damage({ attacker, target: weak })).toBe(37);
    expect(strike.damage({ attacker, target: wounded })).toBe(37);
    expect(strike.damage({ attacker, target: both })).toBe(37);
    expect(strike.effect).toBeUndefined();
  });

  describe('Matriarch cumulative litter call', () => {
    const createHarness = ({ rats = 0, summonResult = { success: true } } = {}) => {
      const passive = ABILITY_LIBRARY['Зов помёта'];
      const owner = { name: 'Крысиный матриарх', hp: 100, maxHp: 100 };
      const enemies = [owner, ...Array.from({ length: rats }, () => ({ name: 'Чумная крыса', hp: 1 }))];
      const summonEnemy = jest.fn(() => {
        if (!summonResult.success) return summonResult;
        const enemy = { name: 'Чумная крыса', hp: 1 };
        enemies.push(enemy);
        return { success: true, enemy };
      });
      const session = { state: { enemies }, summonEnemy };
      passive.onBattleStart({ owner, session });
      const damage = actualHpLost => passive.onOwnerDamaged({
        owner,
        damage: actualHpLost,
        session,
        context: { actualHpLost },
      });
      return { passive, owner, enemies, session, summonEnemy, damage };
    };

    test('small hits accumulate, 29% stays below threshold, and 30% summons', () => {
      const harness = createHarness();
      harness.damage(10);
      harness.damage(10);
      harness.damage(9);
      expect(harness.summonEnemy).not.toHaveBeenCalled();
      expect(harness.owner._litterCallDamageProgress).toBe(29);
      harness.damage(1);
      expect(harness.summonEnemy).toHaveBeenCalledTimes(1);
      expect(harness.owner._litterCallDamageProgress).toBe(0);
    });

    test('preserves residual progress and healing cannot erase it', () => {
      const harness = createHarness();
      harness.damage(40);
      expect(harness.summonEnemy).toHaveBeenCalledTimes(1);
      expect(harness.owner._litterCallDamageProgress).toBe(10);
      harness.owner.hp = Math.min(harness.owner.maxHp, harness.owner.hp + 50);
      harness.damage(20);
      expect(harness.summonEnemy).toHaveBeenCalledTimes(2);
      expect(harness.owner._litterCallDamageProgress).toBe(0);
    });

    test('healing preserves 20% progress and permits thresholds beyond 100% lifetime damage', () => {
      const harness = createHarness({ summonResult: { success: false, reason: 'no_slot' } });
      harness.damage(20);
      harness.owner.hp = 100;
      harness.damage(10);
      expect(harness.summonEnemy).toHaveBeenCalledTimes(1);
      for (let index = 0; index < 4; index += 1) {
        harness.owner.hp = 100;
        harness.damage(30);
      }
      expect(harness.summonEnemy).toHaveBeenCalledTimes(5);
      expect(harness.owner._litterCallDamageProgress).toBe(0);
    });

    test('uses actual HP loss after shields and overkill rather than raw damage', () => {
      const harness = createHarness();
      harness.passive.onOwnerDamaged({
        owner: harness.owner,
        damage: 50,
        session: harness.session,
        context: { actualHpLost: 0, shieldBefore: 50 },
      });
      expect(harness.owner._litterCallDamageProgress).toBe(0);
      harness.passive.onOwnerDamaged({
        owner: harness.owner,
        damage: 50,
        session: harness.session,
        context: { actualHpLost: 20, shieldBefore: 30 },
      });
      harness.passive.onOwnerDamaged({
        owner: harness.owner,
        damage: 999,
        session: harness.session,
        context: { actualHpLost: 10 },
      });
      expect(harness.summonEnemy).toHaveBeenCalledTimes(1);
      expect(harness.owner._litterCallDamageProgress).toBe(0);
    });

    test('consumes blocked thresholds without queueing a delayed summon', () => {
      const harness = createHarness({ rats: 2 });
      harness.damage(30);
      expect(harness.summonEnemy).not.toHaveBeenCalled();
      expect(harness.owner._litterCallDamageProgress).toBe(0);
      harness.enemies.find(enemy => enemy.name === 'Чумная крыса').hp = 0;
      expect(harness.summonEnemy).not.toHaveBeenCalled();
      harness.damage(30);
      expect(harness.summonEnemy).toHaveBeenCalledTimes(1);
    });

    test('consumes every threshold in one event and rechecks the living-rat cap', () => {
      const harness = createHarness({ rats: 1 });
      harness.damage(60);
      expect(harness.summonEnemy).toHaveBeenCalledTimes(1);
      expect(harness.owner._litterCallDamageProgress).toBe(0);
      expect(harness.enemies.filter(enemy => enemy.name === 'Чумная крыса' && enemy.hp > 0)).toHaveLength(2);
    });

    test('two successful thresholds retain both authoritative summon presentation events', () => {
      const player = { name: 'Герой', hp: 100, maxHp: 100, abilities: [{ name: 'Атака', basic: true }] };
      const session = initCombatSession(player, [createEnemyInstanceByName('Крысиный матриарх')]);
      const owner = session.state.enemies[0];
      const passive = owner.abilities.find(ability => ability.name === 'Зов помёта');
      beginCombatPresentation(session);
      passive.onOwnerDamaged({
        owner,
        damage: owner.maxHp * 0.6,
        session,
        context: { actualHpLost: owner.maxHp * 0.6 },
      });
      expect(session.state.enemies.filter(enemy => enemy.hp > 0 && enemy.name === 'Чумная крыса')).toHaveLength(2);
      expect(consumeCombatPresentationEvents(session).filter(event => event.type === 'summon')).toHaveLength(2);
    });

    test('entity-owned primitive progress survives ability revival without being reset', () => {
      const harness = createHarness();
      harness.damage(20);
      const restored = JSON.parse(JSON.stringify(harness.owner));
      harness.passive.onBattleStart({ owner: restored, session: harness.session });
      expect(restored._litterCallDamageProgress).toBe(20);
    });
  });

  test('Feeding heals per living rat and has no no-rat shield fallback', () => {
    const feeding = ABILITY_LIBRARY['Кормление стаи'];
    const owner = { name: 'Крысиный матриарх', hp: 50, maxHp: 100, effects: [] };
    const emptySession = { state: { enemies: [owner] } };
    expect(feeding.canUse({ session: emptySession })).toBe(false);
    feeding.apply({ attacker: owner, session: emptySession });
    expect(owner).toMatchObject({ hp: 50, effects: [] });

    const ratSession = { state: { enemies: [owner, { name: 'Чумная крыса', hp: 1 }, { name: 'Чумная крыса', hp: 1 }] } };
    expect(feeding.canUse({ session: ratSession })).toBe(true);
    feeding.apply({ attacker: owner, session: ratSession });
    expect(owner.hp).toBe(60);
    expect(owner.shield || 0).toBe(0);
  });

  test('Ratskinner passive owns resolved direct physical lifesteal once per turn', () => {
    const player = { name: 'Герой', hp: 200, maxHp: 200, physDef: 0, magicDef: 0, speed: 1, abilities: [{ name: 'Атака', basic: true, damage: 1, cooldown: 0 }] };
    const enemy = createEnemyInstanceByName('Осквернённый гоблин-крысокожий');
    enemy.hp = 50;
    enemy.maxHp = 100;
    enemy.critChance = 0;
    const session = initCombatSession(player, [enemy]);
    const target = session.state.players[0];
    addEffect(target, { id: 'bleed', duration: 2 }, () => {}, enemy, { session });
    const runtimeEnemy = session.state.enemies[0];
    runtimeEnemy.hp = 50;
    runtimeEnemy.maxHp = 100;
    runtimeEnemy.turnMeter = 1000;
    target.turnMeter = 0;

    processEnemyAI(session);

    expect(runtimeEnemy.effects.some(effect => effect.id === 'speed_boost_minor')).toBe(true);
    expect(runtimeEnemy.hp).toBeGreaterThan(50);
    const healed = runtimeEnemy.hp;
    ABILITY_LIBRARY['Запах раскрытой раны'].onDamageDealt({
      owner: runtimeEnemy,
      damage: 100,
      damageType: 'physical',
      context: { directAttack: true, targetWasBleeding: true },
    });
    expect(runtimeEnemy.hp).toBe(healed);
    expect(ABILITY_LIBRARY['Мясистая хватка'].apply).toBeUndefined();
  });

  test('Crystalbreaker reaction shares Shard Rush conditional damage and consumes cooldown once', () => {
    const passive = ABILITY_LIBRARY['Кристаллический срыв'];
    const surge = { ...ABILITY_LIBRARY['Осколочный рывок'], currentCooldown: 0 };
    const owner = { name: 'Кристаллолом', attack: 20, hp: 100, shield: 0, abilities: [surge] };
    const attacker = { name: 'Герой', hp: 100, effects: [{ id: 'speed_penalty_minor' }] };
    const applyDamage = jest.fn((_target, damage) => damage);
    const args = { owner, attacker, context: { directAttack: true, shieldBefore: 10, applyDamage } };

    passive.onTurnStart({ owner });
    passive.onOwnerDamaged(args);
    passive.onOwnerDamaged(args);

    expect(applyDamage).toHaveBeenCalledTimes(1);
    expect(applyDamage).toHaveBeenCalledWith(attacker, 29, 'physical', expect.any(Object));
    expect(surge.currentCooldown).toBe(3);
  });

  test('Ragshnar Fire Blast keeps Burn 3 and shortens Blind to 1', () => {
    expect(ABILITY_LIBRARY['Огненный взрыв'].effect).toEqual([
      expect.objectContaining({ id: 'burn', duration: 3 }),
      expect.objectContaining({ id: 'blind', duration: 1 }),
    ]);
  });

  test('Ragshnar Fire Blast resolves its conservative hybrid damage profile', () => {
    const blueprint = getEnemyBlueprintByName('Пепельный Колпак Рагшнар');
    const ragshnar = { ...blueprint, effects: [] };
    const fireBlast = ABILITY_LIBRARY['Огненный взрыв'];
    const blazingShield = ABILITY_LIBRARY['Пылающий щит'];

    expect(ragshnar).toMatchObject({
      maxHp: 375,
      attack: 27,
      magAtk: 10,
      physDef: 20,
      magicDef: 20,
      speed: 120,
      controlImmune: true,
    });
    expect(fireBlast.damage({ attacker: ragshnar })).toBe(5);
    expect(fireBlast.secondary.damage({ attacker: ragshnar })).toBe(3);
    expect(blazingShield.description).toMatch(/40.*75% атаки.*Горение.*2 хода/);

    addEffect(ragshnar, { id: 'attack_boost_minor', duration: 3 }, () => {}, ragshnar);
    expect(ragshnar.attack).toBe(34);
    expect(ragshnar.magAtk).toBe(10);
    expect(fireBlast.damage({ attacker: ragshnar })).toBe(5);
    expect(fireBlast.secondary.damage({ attacker: ragshnar })).toBe(3);
  });

  test('Ragshnar Fire Blast deals both components through combat and preserves statuses', () => {
    const player = {
      name: 'Манекен', hp: 100, maxHp: 100, attack: 1,
      physDef: 0, magicDef: 0, speed: 1000, critChance: 0,
    };
    const session = initCombatSession(player, [{
      ...getEnemyBlueprintByName('Пепельный Колпак Рагшнар'),
      location: null,
    }]);
    const ragshnar = session.state.enemies[0];
    ragshnar.abilities.forEach(ability => {
      ability.currentCooldown = ability.name === 'Огненный взрыв' ? 0 : 99;
    });
    ragshnar.turnMeter = 1000;

    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      processEnemyAI(session);
    } finally {
      Math.random = originalRandom;
    }

    // 5 magical + 3 physical immediately, followed by the new snapshot/Max-HP Burn tick
    // when automation hands control to the player's next turn.
    expect(session.state.players[0].hp).toBe(84);
    expect(session.state.players[0].effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'burn', durationTotal: 3, remainingTurns: 2 }),
    ]));
    // Blind remains active through its owner's pending turn and expires at that turn's end.
    expect(session.state.players[0].effects.some(effect => effect.id === 'blind')).toBe(true);
  });
});
