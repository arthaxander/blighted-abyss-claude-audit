import { createAbilityByName, WITHERING_FOREST_TUNING } from '../data/abilityPresets';
import { allEnemies, enemies, createEnemyInstanceByName, getEnemyBlueprintByName } from '../data/enemies';
import { createEncounterRewardRoster } from './encounterRewards';
import { initCombatSession, processEnemyAI, selectEnemyAction, getEffectiveSpeed } from './combatUtils';
import { findLivingBloodBondOwner, BLOOD_BOND_RATIO } from './witheringForestGnats';

const sower = () => createEnemyInstanceByName('Сеятель Гнуса');
const create = (enemyList = [sower()], hp = 200) => initCombatSession({
  name: 'Герой', hp, maxHp: 200, attack: 20, speed: 100,
  physDef: 0, magicDef: 0, abilities: ['Атака'], currentLocation: 'Лес Увядания',
}, enemyList, { rng: () => 0.99 });
const oneEnemyTurn = (session, actor) => {
  actor.turnMeter = 1000;
  session.state.players[0].turnMeter = 999;
  processEnemyAI(session);
};
const summon = (session, owner = session.state.enemies[0]) => {
  const result = session.summonEnemy('Янтарный Гнус', { source: owner });
  expect(result.success).toBe(true);
  return result.enemy;
};

it('authors Sower and Gnat stats, portrait keys, summon-only nonrewarding roster and all ability definitions', () => {
  expect(getEnemyBlueprintByName('Сеятель Гнуса')).toMatchObject({
    location: 'Лес Увядания', maxHp: 308, hp: 308, attack: 13, magAtk: 15,
    physDef: 8, magicDef: 9, speed: 123, portraitKey: 'gnat_sower',
    abilityNames: ['Выводок Гнуса', 'Зов роя', 'Кровавая связь'],
  });
  expect(getEnemyBlueprintByName('Янтарный Гнус')).toMatchObject({
    location: 'Лес Увядания', maxHp: 34, hp: 34, attack: 11, magAtk: 1,
    physDef: 1, magicDef: 2, speed: 116, portraitKey: 'amber_gnat',
    summonOnly: true, rewardBearing: false, abilityNames: ['Кровосос'],
  });
  expect(createEnemyInstanceByName('Сеятель Гнуса').maxHp).toBe(308);
  expect(createEnemyInstanceByName('Янтарный Гнус').maxHp).toBe(34);
  expect(allEnemies.some(enemy => enemy.name === 'Янтарный Гнус')).toBe(true);
  expect(enemies.some(enemy => enemy.name === 'Янтарный Гнус')).toBe(false);
  expect(createEncounterRewardRoster([sower(), createEnemyInstanceByName('Янтарный Гнус')])).toHaveLength(1);
  expect(createAbilityByName('Выводок Гнуса').cooldown).toBe(3);
  expect(createAbilityByName('Зов роя').cooldown).toBe(4);
  expect(createAbilityByName('Кровавая связь').passive).toBe(true);
  expect(createAbilityByName('Кровосос')).toMatchObject({ cooldown: 1, type: 'physical', lifestealFromActualHp: 0.75 });
  expect(WITHERING_FOREST_TUNING.gnatSowerCooldown).toBe(3);
  expect(BLOOD_BOND_RATIO).toBe(0.5);
});

it('each spawn owns a unique persistent ID and only the global board limit caps repeated summons', () => {
  const session = create([sower(), sower()]);
  const [first, second] = session.state.enemies;
  const firstGnat = summon(session, first);
  const secondGnat = summon(session, second);
  const thirdGnat = summon(session, first);
  const fourthGnat = summon(session, second);
  expect(new Set([firstGnat, secondGnat, thirdGnat, fourthGnat].map(unit => unit.id)).size).toBe(4);
  expect([firstGnat, secondGnat, thirdGnat, fourthGnat].map(unit => unit.ownerId))
    .toEqual([first.id, second.id, first.id, second.id]);
  expect(JSON.parse(JSON.stringify(firstGnat)).ownerId).toBe(first.id);
  expect(session.summonEnemy('Янтарный Гнус', { source: first }).reason).toBe('no_slot');
});

it('real Sower AI summons one own Gnat, assigns cooldown, then buffs self and living summons on Rally', () => {
  const session = create();
  const owner = session.state.enemies[0];
  expect(selectEnemyAction(owner, session)?.ability.name).toBe('Выводок Гнуса');
  oneEnemyTurn(session, owner);
  const gnat = session.state.enemies.find(enemy => enemy.name === 'Янтарный Гнус');
  expect(gnat).toBeTruthy();
  expect(gnat.ownerId).toBe(owner.id);
  expect(owner.abilities.find(ability => ability.name === 'Выводок Гнуса').currentCooldown).toBe(3);
  expect(selectEnemyAction(owner, session)?.ability.name).toBe('Зов роя');
  const originalOwnerSpeed = getEffectiveSpeed(owner, session);
  const originalGnatSpeed = getEffectiveSpeed(gnat, session);
  oneEnemyTurn(session, owner);
  expect(owner.abilities.find(ability => ability.name === 'Зов роя').currentCooldown).toBe(4);
  expect(owner.effects.some(effect => effect.id === 'speed_boost_minor' && effect.remainingTurns > 0)).toBe(true);
  expect(gnat.effects.some(effect => effect.id === 'speed_boost_minor' && effect.remainingTurns === 2)).toBe(true);
  expect(getEffectiveSpeed(owner, session)).toBeGreaterThan(originalOwnerSpeed);
  expect(getEffectiveSpeed(gnat, session)).toBeGreaterThan(originalGnatSpeed);
});

it('real Bloodsuck deals 80% Attack, heals 75% actual HP loss and transfers half of actual healing', () => {
  const session = create();
  const owner = session.state.enemies[0];
  const gnat = summon(session);
  const hero = session.state.players[0];
  gnat.hp = 10;
  owner.hp = 100;
  expect(selectEnemyAction(gnat, session)?.ability.name).toBe('Кровосос');
  oneEnemyTurn(session, gnat);
  expect(hero.hp).toBe(191);
  expect(gnat.hp).toBe(17); // 9 actual HP damage -> round(9 * 0.75) = 7.
  expect(owner.hp).toBe(104); // 7 actually recovered -> round(7 * 0.5) = 4.
  expect(gnat.abilities.find(ability => ability.name === 'Кровосос').currentCooldown).toBe(1);
  expect(hero.effects.some(effect => effect.id === 'bleed')).toBe(false);
});

it('shield-only hit cannot heal a Gnat or its owner', () => {
  const session = create();
  const owner = session.state.enemies[0];
  const gnat = summon(session);
  const hero = session.state.players[0];
  gnat.hp = 10;
  owner.hp = 100;
  hero.shield = 40;
  oneEnemyTurn(session, gnat);
  expect(hero.hp).toBe(200);
  expect(gnat.hp).toBe(10);
  expect(owner.hp).toBe(100);
});

it('no overheal transfer: only health actually recovered by the Gnat can flow to its owner', () => {
  const session = create();
  const owner = session.state.enemies[0];
  const gnat = summon(session);
  gnat.hp = gnat.maxHp - 1;
  owner.hp = 100;
  oneEnemyTurn(session, gnat);
  expect(gnat.hp).toBe(34);
  expect(owner.hp).toBe(101);
});

it('lethal overkill heals from lost HP, not nominal hit damage', () => {
  const active = create([sower()], 2);
  const owner = active.state.enemies[0];
  const gnat = summon(active);
  gnat.hp = 10;
  owner.hp = 100;
  oneEnemyTurn(active, gnat);
  expect(active.state.players[0].hp).toBe(0);
  expect(gnat.hp).toBe(12); // round(2 * 0.75).
  expect(owner.hp).toBe(101);
});

it('dead owner grants no Blood Bond, but its Gnat survives and still heals itself', () => {
  const session = create();
  const owner = session.state.enemies[0];
  const gnat = summon(session);
  gnat.hp = 10;
  owner.hp = 0;
  expect(findLivingBloodBondOwner(session, gnat)).toBe(null);
  oneEnemyTurn(session, gnat);
  expect(gnat.hp).toBe(17);
  expect(owner.hp).toBe(0);
});

it('owner identity is strict across multiple Sowers and survives JSON state round trip', () => {
  const session = create([sower(), sower()]);
  const [first, second] = session.state.enemies;
  const gnat = summon(session, second);
  first.hp = 80;
  second.hp = 90;
  gnat.hp = 10;
  session.state = JSON.parse(JSON.stringify(session.state));
  const [restoredFirst, restoredSecond, restoredGnat] = session.state.enemies;
  // Restored serialized game data retains IDs; ability definitions are rehydrated by normal load.
  restoredGnat.abilities = restoredGnat.abilities.map(ability => createAbilityByName(ability.name, restoredGnat.attack));
  expect(restoredGnat.ownerId).toBe(restoredSecond.id);
  expect(findLivingBloodBondOwner(session, restoredGnat)).toBe(restoredSecond);
  oneEnemyTurn(session, restoredGnat);
  expect(restoredFirst.hp).toBe(80);
  expect(restoredSecond.hp).toBe(94);
});

it('unowned and spoofed summons and disabled owner passives cannot transfer Blood Bond', () => {
  const session = create([sower(), sower()]);
  const [owner, other] = session.state.enemies;
  const gnat = summon(session, owner);
  expect(findLivingBloodBondOwner(session, gnat)).toBe(owner);
  gnat.ownerId = other.id;
  expect(findLivingBloodBondOwner(session, gnat)).toBe(other);
  other.passivesDisabled = true;
  expect(findLivingBloodBondOwner(session, gnat)).toBe(null);
  gnat.ownerId = 'unknown-id';
  expect(findLivingBloodBondOwner(session, gnat)).toBe(null);
  gnat.ownerId = null;
  expect(findLivingBloodBondOwner(session, gnat)).toBe(null);
});
