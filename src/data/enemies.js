// src/data/enemies.js
// Полные данные врагов из таблицы пользователя с лутом и способностями.

import { createAbilityByName } from './abilityPresets';
import { equipmentByName } from './equipment';
import { ITEM_DATA, normalizeItemName } from './items';
import { DESERTER_LOCATION } from '../utils/enemyPools';
import { MAGIC_SCHOOLS } from '../constants/magicSchools';
import { RESTLESS_RUINS_ENEMIES } from './restlessRuinsRoster';
import { MINES_LOCATION, MINES_BOSS } from './minesAbilities';
import { BOSS_MATERIAL_BY_LOCATION, COMMON_LEVEL_ONE_EQUIPMENT, COMMON_LEVEL_ONE_MATERIALS, CURSED_ONLY_MATERIALS, CRAFT_ONLY_SIGNATURE_EQUIPMENT, LOCATION_LEVEL_ONE_EQUIPMENT, LOCATION_LEVEL_ONE_MATERIALS } from './levelOneLootOwnership';

const KNOWN_LOOT = new Set([
  ...ITEM_DATA.map(item => item.name),
  ...Object.keys(equipmentByName),
  'Серебро',
]);

const parseLoot = (lootString = '') => {
  const loot = lootString
    .split(',')
    .map(item => normalizeItemName(item.replace(/\(.*?\)/g, '').trim()))
    .filter(Boolean);

  loot.forEach(name => {
    if (!KNOWN_LOOT.has(name)) {
      KNOWN_LOOT.add(name);
    }
  });

  return loot;
};

const FUNGAL_MATERIAL_LOOT = [...COMMON_LEVEL_ONE_MATERIALS, ...LOCATION_LEVEL_ONE_MATERIALS['Грибные Пещеры']];

const FUNGAL_POTION_LOOT = parseLoot(
  'Малое зелье здоровья, Малое зелье защиты, Малое зелье регенерации, Малое зелье магической силы, Малое зелье скорости, Малое зелье антимагии, Малое зелье очищения, Малое зелье щита, Малое зелье атаки'
);

const FUNGAL_GEAR_LOOT = [...LOCATION_LEVEL_ONE_EQUIPMENT['Грибные Пещеры']];

const FUNGAL_UNCOMMON_MATERIAL_LOOT = [...LOCATION_LEVEL_ONE_MATERIALS['Грибные Пещеры']];

const RETIRED_GOBLIN_CURSED_NAMES = new Set([
  'Крысомант из Нор (Осквернённый)',
  'Крысомант из Нор (Искажённый)',
  'Гоблин-палач (Осквернённый)',
  'Гоблин-палач (Искажённый)',
  'Гоблин-Потрошитель (Осквернённый)',
  'Гоблин-Потрошитель (Искажённый)',
  'Гоблин-арбалетчик (Осквернённый)',
  'Гоблин-арбалетчик (Искажённый)',
  'Гоблин-Ткач (Осквернённый)',
  'Гоблин-Ткач (Искажённый)',
  'Осквернённый Гоблин-кровотёк',
]);

const ACTIVE_GOBLIN_CURSED_NAMES = new Set([
  'Искажённый гоблин-кристаллолом',
  'Осквернённый гоблин-крысокожий',
]);

const isGoblinCursedName = (name = '') => {
  const normalized = String(name).toLowerCase();
  return normalized.includes('искаж') || normalized.includes('оскверн');
};

const isRetiredGoblinCursedEnemy = (enemy) => (
  enemy?.location === 'Гоблинские Норы' &&
  isGoblinCursedName(enemy?.name) &&
  !ACTIVE_GOBLIN_CURSED_NAMES.has(enemy.name)
);

const GOBLIN_MATERIAL_LOOT = ['Серебро', ...COMMON_LEVEL_ONE_MATERIALS, ...LOCATION_LEVEL_ONE_MATERIALS['Гоблинские Норы']];

const GOBLIN_POTION_LOOT = parseLoot(
  'Малое зелье здоровья, Малое зелье защиты, Малое зелье регенерации, Малое зелье щита, Малое зелье атаки, Малое зелье скорости, Малое зелье очищения'
);

const GOBLIN_SCROLL_LOOT = parseLoot(
  'Свиток Огненного шара, Свиток Лечения, Свиток Кровавого касания, Свиток Конус льда'
);

const craftOnlyEquipment = new Set(CRAFT_ONLY_SIGNATURE_EQUIPMENT);
const GOBLIN_GEAR_LOOT = LOCATION_LEVEL_ONE_EQUIPMENT['Гоблинские Норы'].filter(name => !craftOnlyEquipment.has(name));

const DESERTER_SUPPLY_LOOT = ['Серебро', ...COMMON_LEVEL_ONE_MATERIALS, ...LOCATION_LEVEL_ONE_MATERIALS[DESERTER_LOCATION]];

const DESERTER_POTION_LOOT = parseLoot(
  'Малое зелье здоровья, Малое зелье защиты, Малое зелье скорости, Малое зелье очищения, Малое зелье щита'
);

const DESERTER_GEAR_LOOT = [...LOCATION_LEVEL_ONE_EQUIPMENT[DESERTER_LOCATION]];

const ENEMY_BALANCE_MULTIPLIERS = {
  normal: { hp: 1, attack: 1, defense: 1, magicDefense: 1, speed: 1, silver: 1 },
  miniBoss: { hp: 1.4, attack: 1.2, defense: 1.15, magicDefense: 1.15, speed: 1.05, silver: 1.25 },
  boss: { hp: 1.75, attack: 1.35, defense: 1.25, magicDefense: 1.25, speed: 1.1, silver: 1.5 },
};

const scaleStat = (value, multiplier, { ensureIncrease = false } = {}) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return value;
  }

  if (multiplier === 1) {
    return value;
  }

  const scaled = Math.round(value * multiplier);

  if (multiplier > 1 && ensureIncrease) {
    return Math.max(scaled, value + 1);
  }

  return scaled;
};

const applyDifficultyTuning = (enemy) => {
  const tier = enemy.boss ? 'boss' : enemy.miniBoss ? 'miniBoss' : 'normal';
  const modifiers = ENEMY_BALANCE_MULTIPLIERS[tier] ?? ENEMY_BALANCE_MULTIPLIERS.normal;

  if (enemy.authoredStats) return { ...enemy, difficultyTier: tier };

  if (tier === 'normal') {
    return { ...enemy, difficultyTier: tier };
  }

  const tuned = { ...enemy, difficultyTier: tier };

  tuned.maxHp = scaleStat(enemy.maxHp, modifiers.hp, { ensureIncrease: true });
  tuned.hp = scaleStat(enemy.hp, modifiers.hp, { ensureIncrease: true });

  const scaledAttack = scaleStat(enemy.attack, modifiers.attack, { ensureIncrease: true });
  tuned.attack = scaledAttack;
  tuned.baseAtk = scaledAttack;
  tuned.magAtk = scaleStat(enemy.magAtk, modifiers.attack, { ensureIncrease: true });

  tuned.physDef = scaleStat(enemy.physDef, modifiers.defense, { ensureIncrease: true });
  tuned.magicDef = scaleStat(enemy.magicDef, modifiers.magicDefense, { ensureIncrease: true });
  tuned.speed = scaleStat(enemy.speed, modifiers.speed);

  if (typeof enemy.silverReward === 'number') {
    tuned.silverReward = Math.max(
      scaleStat(enemy.silverReward, modifiers.silver, { ensureIncrease: true }),
      enemy.silverReward
    );
  }

  return tuned;
};

const ENEMY_BLUEPRINTS = [
  {
    name: 'Крысомант из Нор',
    portraitKey: 'burrow_ratmancer',
    location: 'Гоблинские Норы',
    maxHp: 60,
    hp: 60,
    attack: 4,
    magAtk: 7,
    primaryMagicSchool: MAGIC_SCHOOLS.NATURE,
    physDef: 5,
    magicDef: 0,
    speed: 105,
    mana: 100,
    abilityNames: ['Крысиный зов', 'Крысиные бега'],
    loot: parseLoot(
      'Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Булава Старого Сотника (https://www.notion.so/2820dfbf690f80e3b2dbf635ba8e76e7?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21)'
    ),
    silverReward: 25,
  },
  {
    name: 'Крысомант из Нор (Осквернённый)',
    location: 'Гоблинские Норы',
    maxHp: 110,
    hp: 110,
    attack: 14,
    magAtk: 4,
    physDef: 5,
    magicDef: 0,
    speed: 115,
    mana: 100,
    abilityNames: ['Грязный укус', 'Крысиный зов', 'Оскверненная плоть', 'Дар Осквернения'],
    loot: parseLoot(
      'Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Булава Старого Сотника (https://www.notion.so/2820dfbf690f80e3b2dbf635ba8e76e7?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Эссенция Проклятий (https://www.notion.so/2820dfbf690f80439516d6e1982cf351?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21)'
    ),
    silverReward: 45,
  },
  {
    name: 'Крысомант из Нор (Искажённый)',
    location: 'Гоблинские Норы',
    maxHp: 110,
    hp: 110,
    attack: 14,
    magAtk: 4,
    physDef: 5,
    magicDef: 0,
    speed: 115,
    mana: 100,
    abilityNames: ['Грязный укус', 'Крысиный зов'],
    loot: parseLoot(
      'Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Булава Старого Сотника (https://www.notion.so/2820dfbf690f80e3b2dbf635ba8e76e7?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21)'
    ),
    silverReward: 35,
  },
  {
    name: 'Гоблин-палач',
    portraitKey: 'goblin_executioner',
    location: 'Гоблинские Норы',
    maxHp: 84,
    hp: 84,
    attack: 8,
    magAtk: 2,
    physDef: 10,
    magicDef: 0,
    speed: 90,
    mana: 30,
    abilityNames: ['Приговор палача', 'Казнящий удар'],
    loot: parseLoot(
      'Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Булава Старого Сотника (https://www.notion.so/2820dfbf690f80ceb51ee052f80e26e3?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21)'
    ),
    silverReward: 30,
  },
  {
    name: 'Гоблин-палач (Осквернённый)',
    location: 'Гоблинские Норы',
    maxHp: 120,
    hp: 120,
    attack: 20,
    magAtk: 6,
    physDef: 10,
    magicDef: 0,
    speed: 95,
    mana: 30,
    abilityNames: ['Устрашение', 'Казнящий удар', 'Дар Осквернения', 'Оскверненная плоть'],
    loot: parseLoot(
      'Булава Старого Сотника (https://www.notion.so/2820dfbf690f80ceb51ee052f80e26e3?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Эссенция Проклятий (https://www.notion.so/2820dfbf690f80439516d6e1982cf351?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21)'
    ),
    silverReward: 45,
  },
  {
    name: 'Гоблин-палач (Искажённый)',
    location: 'Гоблинские Норы',
    maxHp: 120,
    hp: 120,
    attack: 20,
    magAtk: 6,
    physDef: 10,
    magicDef: 0,
    speed: 95,
    mana: 30,
    abilityNames: ['Устрашение', 'Казнящий удар'],
    loot: parseLoot(
      'Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Булава Старого Сотника (https://www.notion.so/2820dfbf690f80ceb51ee052f80e26e3?pvs=21)'
    ),
    silverReward: 35,
  },
  {
    name: 'Гоблин-Потрошитель',
    portraitKey: 'goblin_ripper',
    location: 'Гоблинские Норы',
    maxHp: 72,
    hp: 72,
    attack: 6,
    magAtk: 2,
    physDef: 8,
    magicDef: 0,
    speed: 95,
    mana: 20,
    abilityNames: ['Мясной вихрь', 'Кровожадность'],
    loot: parseLoot(
      'Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Тесак Гоблинского Мясника (https://www.notion.so/2820dfbf690f8080bf40c99bb8ff0814?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21)'
    ),
    silverReward: 30,
  },
  {
    name: 'Гоблин-Потрошитель (Осквернённый)',
    location: 'Гоблинские Норы',
    maxHp: 115,
    hp: 115,
    attack: 16,
    magAtk: 5,
    physDef: 8,
    magicDef: 0,
    speed: 100,
    mana: 20,
    abilityNames: ['Мясной вихрь', 'Кровожадность', 'Оскверненная плоть', 'Дар Осквернения'],
    loot: parseLoot(
      'Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Тесак Гоблинского Мясника (https://www.notion.so/2820dfbf690f8080bf40c99bb8ff0814?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Эссенция Проклятий (https://www.notion.so/2820dfbf690f80439516d6e1982cf351?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21)'
    ),
    silverReward: 45,
  },
  {
    name: 'Гоблин-Потрошитель (Искажённый)',
    location: 'Гоблинские Норы',
    maxHp: 115,
    hp: 115,
    attack: 16,
    magAtk: 5,
    physDef: 8,
    magicDef: 0,
    speed: 100,
    mana: 20,
    abilityNames: ['Кровожадность', 'Мясной вихрь'],
    loot: parseLoot(
      'Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Тесак Гоблинского Мясника (https://www.notion.so/2820dfbf690f8080bf40c99bb8ff0814?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21)'
    ),
    silverReward: 35,
  },
  {
    name: 'Гоблин-арбалетчик',
    portraitKey: 'goblin_crossbowman',
    location: 'Гоблинские Норы',
    maxHp: 48,
    hp: 48,
    attack: 7,
    magAtk: 2,
    physDef: 6,
    magicDef: 0,
    speed: 100,
    mana: 20,
    abilityNames: ['Отравленный болт', 'Укрытие'],
    loot: parseLoot(
      'Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21)'
    ),
    silverReward: 28,
  },
  {
    name: 'Гоблин-арбалетчик (Осквернённый)',
    location: 'Гоблинские Норы',
    maxHp: 100,
    hp: 100,
    attack: 17,
    magAtk: 5,
    physDef: 6,
    magicDef: 0,
    speed: 105,
    mana: 20,
    abilityNames: ['Укрытие', 'Отравленный болт', 'Оскверненная плоть', 'Дар Осквернения'],
    loot: parseLoot(
      'Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Эссенция Проклятий (https://www.notion.so/2820dfbf690f80439516d6e1982cf351?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21)'
    ),
    silverReward: 45,
  },
  {
    name: 'Гоблин-арбалетчик (Искажённый)',
    location: 'Гоблинские Норы',
    maxHp: 100,
    hp: 100,
    attack: 17,
    magAtk: 5,
    physDef: 6,
    magicDef: 0,
    speed: 105,
    mana: 20,
    abilityNames: ['Отравленный болт', 'Укрытие'],
    loot: parseLoot(
      'Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21)'
    ),
    silverReward: 35,
  },
  {
    name: 'Гоблин-Ткач',
    portraitKey: 'goblin_weaver',
    location: 'Гоблинские Норы',
    maxHp: 54,
    hp: 54,
    attack: 4,
    magAtk: 1,
    physDef: 6,
    magicDef: 0,
    speed: 105,
    mana: 80,
    abilityNames: ['Запутывающая сеть', 'Укол иглой'],
    loot: parseLoot(
      'Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Амулет Ветерана Бездны (https://www.notion.so/2820dfbf690f8017b03fc761f9e5e6dd?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21)'
    ),
    silverReward: 28,
  },
  {
    name: 'Гоблин-Ткач (Осквернённый)',
    location: 'Гоблинские Норы',
    maxHp: 105,
    hp: 105,
    attack: 10,
    magAtk: 3,
    physDef: 6,
    magicDef: 0,
    speed: 110,
    mana: 80,
    abilityNames: ['Укол иглой', 'Запутывающая сеть', 'Дар Осквернения', 'Оскверненная плоть'],
    loot: parseLoot(
      'Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Эссенция Проклятий (https://www.notion.so/2820dfbf690f80439516d6e1982cf351?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21)'
    ),
    silverReward: 45,
  },
  {
    name: 'Гоблин-Ткач (Искажённый)',
    location: 'Гоблинские Норы',
    maxHp: 105,
    hp: 105,
    attack: 10,
    magAtk: 3,
    physDef: 6,
    magicDef: 0,
    speed: 110,
    mana: 80,
    abilityNames: ['Запутывающая сеть', 'Укол иглой'],
    loot: parseLoot(
      'Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Тесак Гоблинского Мясника (https://www.notion.so/2820dfbf690f8080bf40c99bb8ff0814?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21)'
    ),
    silverReward: 35,
  },
  {
    name: 'Крысиный матриарх',
    portraitKey: 'rat_matriarch',
    location: 'Гоблинские Норы',
    encounterPhase: 'late',
    maxHp: 225,
    hp: 225,
    attack: 14,
    magAtk: 5,
    physDef: 10,
    magicDef: 4,
    speed: 90,
    mana: 30,
    abilityNames: ['Зов помёта', 'Грызущая пасть', 'Кормление стаи'],
    loot: [...GOBLIN_MATERIAL_LOOT, ...GOBLIN_POTION_LOOT, 'Обрывки кожи'],
    silverReward: 42,
  },
  {
    name: 'Крысиный всадник',
    portraitKey: 'rat_rider',
    location: 'Гоблинские Норы',
    encounterPhase: 'late',
    maxHp: 139,
    hp: 139,
    attack: 21,
    magAtk: 6,
    physDef: 7,
    magicDef: 2,
    speed: 125,
    mana: 10,
    abilityNames: ['Зазубренная пика', 'Прорыв по норе'],
    loot: [...GOBLIN_MATERIAL_LOOT, ...GOBLIN_POTION_LOOT, 'Тесак Гоблинского Мясника'],
    silverReward: 38,
  },
  {
    name: 'Гоблин-огнепоклонник',
    portraitKey: 'goblin_fire_worshipper',
    location: 'Гоблинские Норы',
    encounterPhase: 'late',
    maxHp: 129,
    hp: 129,
    attack: 8,
    magAtk: 18,
    primaryMagicSchool: MAGIC_SCHOOLS.FIRE,
    physDef: 5,
    magicDef: 8,
    speed: 125,
    mana: 80,
    abilityNames: ['Тлеющий бросок', 'Смоляная тряпка', 'Кормление костра'],
    loot: [...GOBLIN_MATERIAL_LOOT, ...GOBLIN_POTION_LOOT, ...GOBLIN_SCROLL_LOOT, 'Жезл Закопчённого Стекла'],
    silverReward: 40,
  },
  {
    name: 'Искажённый гоблин-кристаллолом',
    portraitKey: 'warped_goblin_crystalbreaker',
    location: 'Гоблинские Норы',
    encounterPhase: 'elite',
    maxHp: 273,
    hp: 273,
    attack: 32,
    magAtk: 7,
    physDef: 18,
    magicDef: 12,
    speed: 82,
    mana: 50,
    miniBoss: true,
    skipWarpedAutoAbilities: true,
    abilityNames: ['Кристаллический надлом', 'Кристаллический срыв', 'Кристальный удар', 'Осколочный рывок', 'Хрустальный панцирь'],
    loot: [...GOBLIN_MATERIAL_LOOT, ...GOBLIN_POTION_LOOT, ...GOBLIN_GEAR_LOOT],
    silverReward: 58,
  },
  {
    name: 'Осквернённый гоблин-крысокожий',
    portraitKey: 'corrupted_goblin_ratskinner',
    location: 'Гоблинские Норы',
    encounterPhase: 'elite',
    maxHp: 211,
    hp: 211,
    attack: 26,
    magAtk: 7,
    physDef: 10,
    magicDef: 8,
    speed: 120,
    mana: 40,
    miniBoss: true,
    abilityNames: ['Запах раскрытой раны', 'Мясистая хватка', 'Янтарный припадок'],
    loot: [...GOBLIN_MATERIAL_LOOT, ...GOBLIN_POTION_LOOT, ...GOBLIN_GEAR_LOOT, 'Эссенция Проклятий'],
    silverReward: 60,
  },
  {
    name: 'Троглодит-копейщик',
    portraitKey: 'troglodyte_spearman',
    location: 'Грибные Пещеры',
    maxHp: 132,
    hp: 132,
    attack: 10,
    magAtk: 3,
    physDef: 12,
    magicDef: 0,
    speed: 80,
    mana: 10,
    roomRole: 'normalEnemy',
    encounterFamily: 'normal_troglodytes',
    roleDescription: 'Замедление и контратака.',
    abilityNames: ['Сдерживающий выпад', 'Стойка копья'],
    loot: [...FUNGAL_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT],
    silverReward: 30,
  },
  {
    name: 'Троглодит-заклинатель змей',
    portraitKey: 'troglodyte_snake_caller',
    location: 'Грибные Пещеры',
    maxHp: 86,
    hp: 86,
    attack: 5,
    magAtk: 9,
    primaryMagicSchool: MAGIC_SCHOOLS.NATURE,
    physDef: 6,
    magicDef: 0,
    speed: 95,
    mana: 80,
    roomRole: 'normalEnemy',
    encounterFamily: 'normal_troglodytes',
    roleDescription: 'Змеиные призывы и защитные баффы.',
    abilityNames: ['Змеиный зов', 'Хоровод ядовитых змей'],
    loot: [...FUNGAL_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT, 'Кольцо Туманного Мха'],
    silverReward: 34,
  },

  {
    name: 'Пещерная змея',
    portraitKey: 'cave_snake',
    location: 'Грибные Пещеры',
    maxHp: 32,
    hp: 32,
    attack: 7,
    magAtk: 2,
    physDef: 2,
    magicDef: 0,
    speed: 105,
    mana: 0,
    summonOnly: true,
    roomRole: 'summon',
    encounterFamily: 'normal_troglodytes',
    roleDescription: 'Призванная ядовитая змея.',
    abilityNames: ['Чумной укус'],
    loot: [],
    lootTable: [],
    silverReward: 0,
  },
  {
    name: 'Троглодит-шаман',
    portraitKey: 'troglodyte_shaman',
    location: 'Грибные Пещеры',
    maxHp: 101,
    hp: 101,
    attack: 5,
    magAtk: 10,
    primaryMagicSchool: MAGIC_SCHOOLS.NATURE,
    physDef: 7,
    magicDef: 4,
    speed: 88,
    mana: 70,
    roomRole: 'normalEnemy',
    encounterFamily: 'normal_troglodytes',
    roleDescription: 'Лечит и очищает союзников, ослабляя врагов.',
    abilityNames: ['Костяной обряд', 'Проклятие слепых глаз'],
    loot: [...FUNGAL_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT, 'Кольцо Туманного Мха'],
    silverReward: 33,
  },
  {
    name: 'Троглодит-заражённый',
    portraitKey: 'infected_troglodyte',
    location: 'Грибные Пещеры',
    maxHp: 90,
    hp: 90,
    attack: 8,
    magAtk: 2,
    physDef: 7,
    magicDef: 0,
    speed: 86,
    mana: 40,
    roomRole: 'normalEnemy',
    encounterFamily: 'fungal_troglodytes',
    roleDescription: 'Манипуляция шкалой хода и штрафы.',
    abilityNames: ['Заражённый выпад', 'Паразитический рефлекс'],
    loot: [...FUNGAL_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT, 'Хитиновый Панцирь Мясного Жука'],
    silverReward: 33,
  },
  {
    name: 'Троглодит-споровик',
    portraitKey: 'spore_troglodyte',
    location: 'Грибные Пещеры',
    maxHp: 82,
    hp: 82,
    attack: 5,
    magAtk: 10,
    primaryMagicSchool: MAGIC_SCHOOLS.NATURE,
    physDef: 7,
    magicDef: 0,
    speed: 90,
    mana: 60,
    roomRole: 'normalEnemy',
    encounterFamily: 'fungal_troglodytes',
    roleDescription: 'Ядовитые споры и читаемый посмертный выброс.',
    abilityNames: ['Споровой шторм', 'Посмертный выброс спор'],
    loot: [...FUNGAL_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT, 'Кольцо Туманного Мха'],
    silverReward: 32,
  },
  {
    name: 'Одичавший троглодит',
    portraitKey: 'feral_troglodyte',
    location: 'Грибные Пещеры',
    maxHp: 138,
    hp: 138,
    attack: 21,
    magAtk: 4,
    physDef: 7,
    magicDef: 0,
    speed: 98,
    mana: 0,
    encounterPhase: 'late',
    roomRole: 'normalEnemy',
    encounterFamily: 'fungal_troglodytes',
    roleDescription: 'Агрессивно ускоряет себя и грибную стаю.',
    abilityNames: ['Рваный наскок', 'Стайный визг'],
    loot: [...FUNGAL_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT],
    silverReward: 34,
  },
  {
    name: 'Костестраж',
    portraitKey: 'boneguard',
    location: 'Грибные Пещеры',
    maxHp: 185,
    hp: 185,
    attack: 18,
    magAtk: 3,
    physDef: 13,
    magicDef: 3,
    speed: 76,
    mana: 0,
    encounterPhase: 'late',
    roomRole: 'normalEnemy',
    encounterFamily: 'normal_troglodytes',
    roleDescription: 'Защищает стаю Щитом и карает разрушивших защиту.',
    abilityNames: ['Костяной покров', 'Кара стража', 'Последний хранитель'],
    loot: [...FUNGAL_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT, 'Хитиновый Панцирь Мясного Жука'],
    silverReward: 38,
  },
  {
    name: 'Змеиный двоеглав',
    portraitKey: 'two_headed_serpent',
    location: 'Грибные Пещеры',
    maxHp: 177,
    hp: 177,
    attack: 20,
    magAtk: 4,
    physDef: 9,
    magicDef: 4,
    speed: 105,
    mana: 80,
    encounterPhase: 'late',
    roomRole: 'normalEnemy',
    encounterFamily: 'normal_troglodytes',
    roleDescription: 'Поздний ядовитый хищник: опаснее против уже отравленных целей, с короткой уверткой.',
    abilityNames: ['Двойной укус', 'Змеиная увертка'],
    loot: [...FUNGAL_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT, 'Кольцо Туманного Мха'],
    silverReward: 42,
  },
  {
    name: 'Осквернённый троглодит-змееголов',
    portraitKey: 'corrupted_troglodyte_snakehead',
    location: 'Грибные Пещеры',
    maxHp: 189,
    hp: 189,
    attack: 22,
    magAtk: 5,
    physDef: 10,
    magicDef: 5,
    speed: 123,
    mana: 90,
    encounterPhase: 'elite',
    roomRole: 'cursedEnemy',
    miniBoss: true,
    roleDescription: 'Уклонение, яд, кровотечение и вампиризм.',
    abilityNames: ['Кровавый укус', 'Осквернённый вампиризм', 'Кровавая линька'],
    loot: [...FUNGAL_UNCOMMON_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT, 'Кольцо Туманного Мха', 'Грибная Маска Споровика', 'Эссенция Проклятий'],
    guaranteedLoot: ['Эссенция Проклятий'],
    lootRolls: 2,
    silverReward: 55,
  },
  {
    name: 'Искажённый троглодит-тотемщик',
    portraitKey: 'warped_troglodyte_totemist',
    location: 'Грибные Пещеры',
    maxHp: 181,
    hp: 181,
    attack: 9,
    magAtk: 30,
    primaryMagicSchool: MAGIC_SCHOOLS.LIGHTNING,
    skipWarpedAutoAbilities: true,
    physDef: 12,
    magicDef: 8,
    speed: 88,
    mana: 100,
    encounterPhase: 'elite',
    roomRole: 'cursedEnemy',
    miniBoss: true,
    roleDescription: 'Осколочные щиты и самоусиления.',
    abilityNames: ['Осколочный тотем', 'Наращивание тотема', 'Призматический удар'],
    loot: [...FUNGAL_UNCOMMON_MATERIAL_LOOT, ...FUNGAL_POTION_LOOT, 'Хитиновый Панцирь Мясного Жука', 'Кольцо Туманного Мха', 'Эссенция Проклятий'],
    guaranteedLoot: ['Эссенция Проклятий'],
    lootRolls: 2,
    silverReward: 52,
  },
  {
    name: 'Троглодит-мицелий (босс)',
    portraitKey: 'troglodyte_mycelium',
    location: 'Грибные Пещеры',
    maxHp: 400,
    hp: 400,
    attack: 14,
    magAtk: 37,
    primaryMagicSchool: MAGIC_SCHOOLS.NATURE,
    physDef: 16,
    magicDef: 14,
    speed: 100,
    mana: 140,
    abilityNames: ['Споровой выброс', 'Грибная сеть', 'Споровой паралич', 'Сжатие мицелия', 'Мицелиевое питание'],
    boss: true,
    loot: [
      ...FUNGAL_UNCOMMON_MATERIAL_LOOT,
      'Малое зелье магической силы',
      'Малое зелье регенерации',
      ...FUNGAL_GEAR_LOOT,
    ],
    guaranteedLoot: ['Мерцающий узел'],
    silverReward: 130,
    lootRolls: 2,
  },
  {
    name: 'Громила',
    portraitKey: 'deserter_brute',
    location: DESERTER_LOCATION,
    maxHp: 125,
    hp: 125,
    attack: 10,
    physDef: 8,
    magicDef: 2,
    speed: 76,
    mana: 15,
    roomRole: 'normalEnemy',
    roleDescription: 'Медленный громила с тяжёлой дубиной: прямое физическое давление без защитной стойки.',
    abilityNames: ['Тяжёлый замах', 'Размашистый удар'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Куртка Мародёра'],
    silverReward: 32,
  },
  {
    name: 'Чернокнижник',
    portraitKey: 'deserter_warlock',
    location: DESERTER_LOCATION,
    maxHp: 82,
    hp: 82,
    attack: 7,
    magAtk: 10,
    physDef: 4,
    magicDef: 8,
    speed: 92,
    mana: 90,
    roomRole: 'normalEnemy',
    roleDescription: 'Проклинает восстановление способностей и обращает истощение в кровавую магию.',
    abilityNames: ['Проклятие истощения', 'Кровавая расплата'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Пепельная Маска Отступника'],
    silverReward: 34,
  },
  {
    name: 'Трюкач',
    portraitKey: 'deserter_trickster',
    location: DESERTER_LOCATION,
    maxHp: 84,
    hp: 84,
    attack: 7,
    magAtk: 9,
    physDef: 5,
    magicDef: 7,
    speed: 104,
    mana: 80,
    roomRole: 'normalEnemy',
    roleDescription: 'Ослепляет противника, исчезает после промаха и атакует из марева.',
    abilityNames: ['Ослепляющая уловка', 'Удар из марева', 'Исчезающий трюк'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Плащ разведчика'],
    silverReward: 33,
  },
  {
    name: 'Дуэлянт',
    portraitKey: 'deserter_duelist',
    location: DESERTER_LOCATION,
    maxHp: 94,
    hp: 94,
    attack: 10,
    physDef: 7,
    magicDef: 3,
    speed: 108,
    mana: 30,
    roomRole: 'normalEnemy',
    roleDescription: 'Наращивает Боевой ритм успешными атаками и расходует его завершающим выпадом.',
    abilityNames: ['Завершающий выпад', 'Школа дуэлянта'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Куртка Мародёра'],
    silverReward: 36,
  },
  {
    name: 'Следопыт',
    portraitKey: 'deserter_ranger',
    location: DESERTER_LOCATION,
    maxHp: 89,
    hp: 89,
    attack: 9,
    physDef: 6,
    magicDef: 3,
    speed: 102,
    mana: 30,
    roomRole: 'normalEnemy',
    roleDescription: 'Готовит выстрел по отмеченной цели и выставляет боевые Силки.',
    abilityNames: ['Выжидающий выстрел', 'Силки'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Капюшон Следопыта', 'Кольцо Меткой Тетивы'],
    silverReward: 35,
  },
  {
    name: 'Аптекарь',
    portraitKey: 'deserter_apothecary',
    location: DESERTER_LOCATION,
    maxHp: 127,
    hp: 127,
    attack: 10,
    magAtk: 11,
    physDef: 7,
    magicDef: 8,
    speed: 98,
    mana: 100,
    encounterPhase: 'late',
    roomRole: 'normalEnemy',
    roleDescription: 'Полевая поддержка с ограниченным запасом препаратов для лечения и очищения.',
    abilityNames: ['Экстренный стимулятор', 'Очищающий состав', 'Полевой набор'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Куртка Мародёра'],
    silverReward: 42,
  },
  {
    name: 'Заклинатель бурь',
    portraitKey: 'deserter_stormcaller',
    location: DESERTER_LOCATION,
    maxHp: 125,
    hp: 125,
    attack: 10,
    magAtk: 16,
    physDef: 5,
    magicDef: 10,
    speed: 104,
    mana: 120,
    encounterPhase: 'late',
    roomRole: 'normalEnemy',
    roleDescription: 'Направляет молнию союзников, защищает их грозовым щитом и накапливает проводимость.',
    abilityNames: ['Наводка', 'Грозовой приказ', 'Грозовой щит', 'Проводник грозы'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Пепельная Маска Отступника'],
    silverReward: 45,
  },
  {
    name: 'Мастер алебарды',
    portraitKey: 'deserter_halberd_master',
    location: DESERTER_LOCATION,
    maxHp: 166,
    hp: 166,
    attack: 18,
    physDef: 14,
    magicDef: 5,
    speed: 100,
    mana: 45,
    encounterPhase: 'late',
    roomRole: 'normalEnemy',
    roleDescription: 'Управляет длительностью временных усилений и ослаблений точными ударами.',
    abilityNames: ['Подхват слабости', 'Сбить строй'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Алебарда Пограничного Дозора'],
    silverReward: 48,
  },
  {
    name: 'Осквернённый рубака',
    portraitKey: 'corrupted_deserter_berserker',
    location: DESERTER_LOCATION,
    maxHp: 163,
    hp: 163,
    attack: 19,
    physDef: 11,
    magicDef: 6,
    speed: 98,
    mana: 80,
    encounterPhase: 'elite',
    roomRole: 'cursedEnemy',
    miniBoss: true,
    roleDescription: 'Кровавый мини-босс: Кровотечение, Метка вампира и вскрытие ран.',
    abilityNames: ['Рваный разрез', 'Вскрыть рану'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, ...DESERTER_GEAR_LOOT, 'Эссенция Проклятий'],
    guaranteedLoot: ['Эссенция Проклятий'],
    lootRolls: 2,
    silverReward: 58,
  },
  {
    name: 'Искажённый страж',
    portraitKey: 'warped_deserter_guard',
    location: DESERTER_LOCATION,
    maxHp: 181,
    hp: 181,
    attack: 16,
    physDef: 15,
    magicDef: 8,
    magAtk: 13,
    speed: 84,
    mana: 90,
    encounterPhase: 'elite',
    roomRole: 'cursedEnemy',
    miniBoss: true,
    roleDescription: 'Искажённая оборона: Щит, проводимость и кража фактически разрушенного барьера.',
    abilityNames: ['Искажённая стойка', 'Разлом барьера', 'Искажённый удар', 'Проводимость искажения'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, 'Щит Дозорного Гильдии', 'Алебарда Пограничного Дозора', 'Эссенция Проклятий'],
    guaranteedLoot: ['Эссенция Проклятий'],
    lootRolls: 2,
    silverReward: 56,
  },
  {
    name: 'Мастер клинков',
    portraitKey: 'deserter_blade_master',
    location: DESERTER_LOCATION,
    maxHp: 285,
    hp: 285,
    attack: 24,
    physDef: 18,
    magicDef: 10,
    speed: 100,
    mana: 120,
    boss: true,
    roleDescription: 'Босс школы клинка: Боевой ритм превращается в срываемую подготовку Танца клинков.',
    abilityNames: ['Точный выпад', 'Серия клинков', 'Школа клинка', 'Нарушенная клятва'],
    loot: [...DESERTER_SUPPLY_LOOT, ...DESERTER_POTION_LOOT, ...DESERTER_GEAR_LOOT],
    // TODO: Add crafting/rune uses for this Deserter boss catalyst in a later progression PR.
    guaranteedLoot: ['Сломанная клятва'],
    silverReward: 120,
    lootRolls: 2,
  },
  {
    name: 'Пепельный Колпак Рагшнар',
    portraitKey: 'ashen_cap_ragshnar',
    location: 'Гоблинские Норы',
    maxHp: 375,
    hp: 375,
    attack: 27,
    magAtk: 10,
    physDef: 20,
    magicDef: 20,
    speed: 120,
    controlImmune: true,
    mana: 420,
    abilityNames: ['Инферно', 'Пылающий щит', 'Огненный взрыв'],
    loot: parseLoot(
      'Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Булава Старого Сотника (https://www.notion.so/2820dfbf690f80e3b2dbf635ba8e76e7?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Амулет Ветерана Бездны (https://www.notion.so/2820dfbf690f8017b03fc761f9e5e6dd?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21)'
    ),
    silverReward: 120,
    lootRolls: 3,
    guaranteedLoot: ['Сердце костра'],
  },
  {
    name: 'Чумная крыса',
    portraitKey: 'plague_rat',
    location: 'Гоблинские Норы',
    maxHp: 15,
    hp: 15,
    attack: 5,
    magAtk: 1,
    physDef: 0,
    magicDef: 0,
    speed: 110,
    mana: 0,
    abilityNames: ['Грязный укус'],
    loot: parseLoot('Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21)'),
    silverReward: 10,
    summonOnly: true,
  },
  {
    name: 'Осквернённый Гоблин-кровотёк',
    location: 'Гоблинские Норы',
    maxHp: 150,
    hp: 150,
    attack: 17,
    magAtk: 5,
    physDef: 14,
    magicDef: 10,
    speed: 100,
    mana: 30,
    abilityNames: ['Дар Осквернения', 'Оскверненная плоть', 'Кровавый ритуал', 'Кровавая жертва'],
    miniBoss: true,
    loot: parseLoot(
      'Серебро (https://www.notion.so/2820dfbf690f8039bcb1edd0644e41c4?pvs=21), Свиток Огненного шара (https://www.notion.so/2820dfbf690f804da885fdc59a437d44?pvs=21), Свиток Лечения (https://www.notion.so/2820dfbf690f80948c62f08ea3d21c24?pvs=21), Обрывки кожи (https://www.notion.so/2820dfbf690f805a9894da6de798a7bc?pvs=21), Простая ткань (https://www.notion.so/2820dfbf690f80e4ab59df98eb188eb5?pvs=21), Малое зелье здоровья (https://www.notion.so/2820dfbf690f8045a96ee4e001c39ef3?pvs=21), Малое зелье защиты (https://www.notion.so/2820dfbf690f808781eafcf18ba1a569?pvs=21), Малое зелье регенерации (https://www.notion.so/2820dfbf690f80ed9a55c482aacbebf7?pvs=21), Малое зелье щита (https://www.notion.so/2820dfbf690f80ceb1f8cbc8ea1b1bdd?pvs=21), Малое зелье магической силы (https://www.notion.so/2820dfbf690f80119ae3c2837fe82271?pvs=21), Эссенция Проклятий (https://www.notion.so/2820dfbf690f80439516d6e1982cf351?pvs=21), Малое зелье атаки (https://www.notion.so/2820dfbf690f80589a9feb4ee1ec1aa9?pvs=21), Металлические обломки (https://www.notion.so/2820dfbf690f8014b273efcf789bc371?pvs=21), Красный Колпак Старшего Крысолова (https://www.notion.so/2820dfbf690f800eb2a4f19625a21ecf?pvs=21), Свиток Кровавого касания (https://www.notion.so/2820dfbf690f800db974eb86bbc349fa?pvs=21), Свиток Конус льда (https://www.notion.so/2820dfbf690f8077ae1ef7b9c811b45b?pvs=21), Свиток Ядовитого облака (https://www.notion.so/2820dfbf690f809995dcfd227db9f641?pvs=21), Малое зелье антимагии (https://www.notion.so/2820dfbf690f80d98486df923710905e?pvs=21), Малое зелье очищения (https://www.notion.so/2820dfbf690f80f4aedffdd0103ca4b0?pvs=21), Малое зелье скорости (https://www.notion.so/2820dfbf690f807abc4bef6ccbca96f8?pvs=21)'
    ),
    silverReward: 55,
  },
  {
    name: 'Ведьма Лепестков',
    portraitKey: 'petal_witch',
    location: 'Лес Увядания',
    maxHp: 264, hp: 264, attack: 10, magAtk: 22,
    physDef: 5, magicDef: 10, speed: 126, mana: 100,
    primaryMagicSchool: MAGIC_SCHOOLS.NATURE,
    roomRole: 'normalEnemy',
    roleDescription: 'Сдерживает активные способности Зарастанием и отравляет лозами.',
    abilityNames: ['Ядовитые лозы', 'Зарастающий бутон'],
    loot: [], // Forest loot distribution has not been designed yet.
    silverReward: 0, // Do not invent the floor-two economy while the area is locked.
  },
  {
    name: 'Эльфийская лучница', portraitKey: 'elven_archer',
    location: 'Лес Увядания',
    maxHp: 272, hp: 272, attack: 19, magAtk: 1,
    physDef: 7, magicDef: 5, speed: 135, mana: 0,
    roomRole: 'normalEnemy',
    roleDescription: 'Помечает цель Уязвимостью, затем усиливает Прицельный выстрел.',
    abilityNames: ['Уязвимый выстрел', 'Лес: Прицельный выстрел'],
    loot: [], // Floor-two loot distribution is not authored yet.
    silverReward: 0, // Do not invent rewards while the Forest is locked.
  },
  {
    name: 'Терновый страж', portraitKey: 'thorn_guard',
    location: 'Лес Увядания',
    maxHp: 440, hp: 440, attack: 17, magAtk: 1,
    physDef: 20, magicDef: 12, speed: 110, mana: 0,
    roomRole: 'normalEnemy',
    roleDescription: 'Перехватывает направленные атаки и отражает фактический урон по здоровью.',
    abilityNames: ['Терновый заслон', 'Ответные шипы'],
    loot: [], // Floor-two loot economy has not been authored.
    silverReward: 0,
  },
  {
    name: 'Тень чащи', portraitKey: 'thicket_shadow',
    location: 'Лес Увядания',
    maxHp: 256, hp: 256, attack: 20, magAtk: 1,
    physDef: 5, magicDef: 7, speed: 140, mana: 0,
    roomRole: 'normalEnemy', startsInvisible: true,
    roleDescription: 'Начинает бой невидимой; первый удар усилен, раненых добивает Смертельным выпадом.',
    abilityNames: ['Смертельный выпад', 'Удар в спину'],
    loot: [], // Forest loot economy has not been authored.
    silverReward: 0,
  },
  {
    name: 'Сеятель Гнуса', portraitKey: 'gnat_sower',
    location: 'Лес Увядания',
    maxHp: 308, hp: 308, attack: 13, magAtk: 15,
    physDef: 8, magicDef: 9, speed: 123, mana: 100,
    roomRole: 'normalEnemy',
    roleDescription: 'Выводит Гнусов, ускоряет рой и получает половину их фактического лечения.',
    abilityNames: ['Выводок Гнуса', 'Зов роя', 'Кровавая связь'],
    loot: [], // Forest loot economy has not been authored.
    silverReward: 0,
  },
  {
    name: 'Янтарный Гнус', portraitKey: 'amber_gnat',
    location: 'Лес Увядания',
    maxHp: 34, hp: 34, attack: 11, magAtk: 1,
    physDef: 1, magicDef: 2, speed: 116, mana: 0,
    roomRole: 'summon', summonOnly: true, rewardBearing: false,
    roleDescription: 'Лечится Кровососом и передаёт половину реального восстановления своему живому Сеятелю.',
    abilityNames: ['Кровосос'], loot: [], silverReward: 0,
  },
  {
    name: 'Жнец лесов', portraitKey: 'forest_reaper', location: 'Лес Увядания',
    maxHp: 492, hp: 492, attack: 25, magAtk: 1, physDef: 14, magicDef: 9, speed: 129, mana: 0,
    roomRole: 'strongEnemy', encounterPhase: 'late',
    roleDescription: 'Косит весь вражеский строй и обращает Опутывание в сильный направленный удар.',
    abilityNames: ['Покос', 'Жатва корней', 'Безжалостная жатва'], loot: [], silverReward: 0,
  },
  {
    name: 'Совиный друид', portraitKey: 'owl_druid', location: 'Лес Увядания',
    maxHp: 436, hp: 436, attack: 19, magAtk: 18, physDef: 8, magicDef: 14, speed: 141, mana: 100,
    roomRole: 'strongEnemy', encounterPhase: 'late',
    roleDescription: 'Опутывает цели и управляет шкалой хода, ослабляя направленный против него контроль темпа.',
    abilityNames: ['Цепкие корни', 'Взмах крыла', 'Лёгкость крыла'], loot: [], silverReward: 0,
  },
  {
    name: 'Друид-медведь', portraitKey: 'bear_druid', location: 'Лес Увядания',
    maxHp: 620, hp: 620, attack: 22, magAtk: 8, physDef: 22, magicDef: 15, speed: 114, mana: 60,
    roomRole: 'strongEnemy', encounterPhase: 'late',
    roleDescription: 'Живучий боец: оглушает натиском, восстанавливается и один раз обретает Непоколебимость.',
    abilityNames: ['Медвежий натиск', 'Дубовое восстановление', 'Звериная ярость'], loot: [], silverReward: 0,
  },
  {
    name: 'Кристальный раскольник — Искажение', portraitKey: 'crystal_splitter', location: 'Лес Увядания',
    maxHp: 975, hp: 975, attack: 30, magAtk: 24, physDef: 29, magicDef: 24, speed: 132, mana: 100,
    roomRole: 'cursedEnemy', encounterPhase: 'elite', cursed: true, skipWarpedAutoAbilities: true, authoredStats: true,
    roleDescription: 'Проклятый одиночный противник, превращающий Щит в телеграфированный магический разряд.',
    abilityNames: ['Лес: Кристаллический панцирь', 'Раскалывающий удар', 'Резонансный разряд'], loot: [], silverReward: 0,
  },
  {
    name: 'Осквернённый хищник — Осквернение', portraitKey: 'defiled_predator', location: 'Лес Увядания',
    maxHp: 790, hp: 790, attack: 35, magAtk: 7, physDef: 14, magicDef: 12, speed: 163, mana: 60,
    roomRole: 'cursedEnemy', encounterPhase: 'elite', cursed: true, authoredStats: true,
    roleDescription: 'Проклятый одиночный хищник, усиливающий вампиризм Кровотечением и карающий избыточное лечение.',
    abilityNames: ['Рваные когти', 'Зов крови', 'Кровавый пир', 'Буйное разрастание'], loot: [], silverReward: 0,
  },
  {
    name: 'Архонт Цветения', portraitKey: 'bloom_archon', location: 'Лес Увядания',
    maxHp: 2250, hp: 2250, attack: 34, magAtk: 24, physDef: 20, magicDef: 22, speed: 170, mana: 100,
    boss: true, authoredStats: true, roomRole: 'boss', encounterPhase: 'boss', _bloomArchonPhase: 1,
    roleDescription: 'Наращивает Опутывание через Бутоны, распускает их в яд и периодически сбрасывает наиболее накопленный отрицательный эффект.',
    abilityNames: ['Корни Архонта', 'Цветение жизни', 'Терновое цветение', 'Сброс лепестков'],
    loot: [], guaranteedLoot: ['Ветвь Архонта'], silverReward: 0,
  },
  // Authored Mines roster: staged while the third Level 2 location is disabled.
  // All stats/abilities are inspectable in Dev / simulator; no placeholder portraits are mapped.
  {
    name: 'Обугленный громила', portraitKey: 'mines_hook_brute', location: MINES_LOCATION,
    maxHp: 350, hp: 350, attack: 21, magAtk: 18, physDef: 12, magicDef: 8, speed: 118, mana: 100,
    roomRole: 'normalEnemy', authoredStats: true,
    roleDescription: 'Помечает Испепеляющим клеймом и тормозит цель цепным крюком.',
    abilityNames: ['Шахты: Клеймящий удар', 'Шахты: Крюк на цепи'], loot: [], silverReward: 0,
  },
  {
    name: 'Рудный носильщик', portraitKey: 'mines_ore_porter', location: MINES_LOCATION,
    maxHp: 270, hp: 270, attack: 20, magAtk: 1, physDef: 7, magicDef: 11, speed: 124, mana: 0,
    roomRole: 'normalEnemy', authoredStats: true,
    roleDescription: 'Бросает валун с шансом оглушить и отнимает шкалу хода.',
    abilityNames: ['Шахты: Метание валуна', 'Шахты: Сброс ноши'], loot: [], silverReward: 0,
  },
  {
    name: 'Закованный охранник', portraitKey: 'mines_shackled_guard', location: MINES_LOCATION,
    maxHp: 430, hp: 430, attack: 17, magAtk: 1, physDef: 21, magicDef: 13, speed: 107, mana: 0,
    roomRole: 'normalEnemy', authoredStats: true,
    roleDescription: 'Получает магический Щит, укрепляет союзников и превращает положительные статусы в отрицательные.',
    abilityNames: ['Шахты: Глухая оборона', 'Шахты: Обратить силу'], loot: [], silverReward: 0,
  },
  {
    name: 'Шахтёр с киркой', portraitKey: 'mines_pickaxe_worker', location: MINES_LOCATION,
    maxHp: 270, hp: 270, attack: 20, magAtk: 1, physDef: 9, magicDef: 9, speed: 133, mana: 0,
    roomRole: 'normalEnemy', authoredStats: true,
    roleDescription: 'Ослабляет физическую защиту и сильнее бьёт по Щиту.',
    abilityNames: ['Шахты: Выбить клин', 'Шахты: Скол породы'], loot: [], silverReward: 0,
  },
  {
    name: 'Тлеющий бык', portraitKey: 'mines_scorched_bull', location: MINES_LOCATION,
    maxHp: 370, hp: 370, attack: 23, magAtk: 1, physDef: 14, magicDef: 9, speed: 122, mana: 0,
    roomRole: 'normalEnemy', authoredStats: true,
    roleDescription: 'Разгоняется Ускорением; под ним три удара Давки массово отнимают шкалу хода.',
    abilityNames: ['Шахты: Бычий разбег', 'Шахты: Давка', 'Шахты: Неудержимый натиск'], loot: [], silverReward: 0,
  },
  {
    name: 'Старший надзиратель', portraitKey: 'mines_overseer', location: MINES_LOCATION,
    maxHp: 500, hp: 500, attack: 22, magAtk: 1, physDef: 14, magicDef: 11, speed: 126, mana: 0,
    roomRole: 'strongEnemy', encounterPhase: 'late', authoredStats: true,
    roleDescription: 'Разгоняет шкалу хода работников и усиливает их прямые удары при ранениях.',
    abilityNames: ['Шахты: Продолжить работу!', 'Шахты: Виновный', 'Шахты: Работать до смерти!'], loot: [], silverReward: 0,
  },
  {
    name: 'Мастер крепей', portraitKey: 'mines_support_master', location: MINES_LOCATION,
    maxHp: 600, hp: 600, attack: 24, magAtk: 1, physDef: 22, magicDef: 14, speed: 112, mana: 0,
    roomRole: 'strongEnemy', encounterPhase: 'late', authoredStats: true,
    roleDescription: 'Ограждает союзников Щитами, очищает команду и бьёт сильнее за усиления героя.',
    abilityNames: ['Шахты: Укрепить проход', 'Шахты: Кувалда'], loot: [], silverReward: 0,
  },
  {
    name: 'Забывший маркшейдер', portraitKey: 'mines_forgotten_surveyor', location: MINES_LOCATION,
    maxHp: 450, hp: 450, attack: 12, magAtk: 27, physDef: 8, magicDef: 15, speed: 138, mana: 100,
    primaryMagicSchool: MAGIC_SCHOOLS.DARKNESS,
    roomRole: 'strongEnemy', encounterPhase: 'late', authoredStats: true,
    roleDescription: 'Чёрная жила усиливается за баффы других союзников; накладывает Мрак и Беспамятство.',
    abilityNames: ['Шахты: Чёрная жила', 'Шахты: Утрата памяти'], loot: [], silverReward: 0,
  },
  {
    name: 'Искажённый взрывник', portraitKey: 'mines_warped_bomber', location: MINES_LOCATION,
    maxHp: 920, hp: 920, attack: 29, magAtk: 24, physDef: 21, magicDef: 21, speed: 141, mana: 100,
    primaryMagicSchool: MAGIC_SCHOOLS.LIGHTNING,
    roomRole: 'cursedEnemy', encounterPhase: 'elite', miniBoss: true, cursed: true,
    skipWarpedAutoAbilities: true, authoredStats: true,
    roleDescription: 'Начинает с тремя Припасами, массово кидает бомбы с Зарядом и Горением.',
    abilityNames: ['Шахты: Начальные припасы', 'Шахты: Бросок бомбами', 'Шахты: Искажённое пополнение', 'Шахты: Плавящиеся щиты'],
    loot: [], silverReward: 0,
  },
  {
    name: 'Осквернённый лекарь', portraitKey: 'mines_defiled_healer', location: MINES_LOCATION,
    maxHp: 880, hp: 880, attack: 22, magAtk: 31, physDef: 14, magicDef: 19, speed: 128, mana: 100,
    primaryMagicSchool: MAGIC_SCHOOLS.DARKNESS,
    roomRole: 'cursedEnemy', encounterPhase: 'elite', miniBoss: true, cursed: true, authoredStats: true,
    roleDescription: 'Кровоточит вместе с героем, накладывает Метку вампира и ускоряется за все тики крови.',
    abilityNames: ['Шахты: Порочное лекарство', 'Шахты: Переливание крови', 'Шахты: Быстрое свёртывание'],
    loot: [], silverReward: 0,
  },
  {
    name: MINES_BOSS, portraitKey: 'mines_zolotoplavets', location: MINES_LOCATION,
    maxHp: 2350, hp: 2350, attack: 30, magAtk: 31, physDef: 21, magicDef: 23, speed: 154, mana: 100,
    primaryMagicSchool: MAGIC_SCHOOLS.LIGHT,
    boss: true, roomRole: 'boss', encounterPhase: 'boss', authoredStats: true, _minesPhase: 1,
    roleDescription: 'Испепеляющее клеймо, кража баффов и перенос дебаффов; после 50% HP — массовая Переплавка.',
    abilityNames: ['Шахты: Клеймо начальника', 'Шахты: Взыскание', 'Шахты: Переплавка', 'Шахты: Начальственный произвол'],
    loot: [], guaranteedLoot: ['Тлеющий рог'], silverReward: 0,
  },

  ...RESTLESS_RUINS_ENEMIES,
];

const ensureAttackAbility = (names = []) => {
  const withAttack = names.includes('Атака') ? names : [...names, 'Атака'];
  return Array.from(new Set(withAttack));
};

const locationOwnedEquipment = new Set(Object.values(LOCATION_LEVEL_ONE_EQUIPMENT).flat());
const locationOwnedMaterials = new Set(Object.values(LOCATION_LEVEL_ONE_MATERIALS).flat());
const commonEquipment = new Set(COMMON_LEVEL_ONE_EQUIPMENT);
const commonMaterials = new Set(COMMON_LEVEL_ONE_MATERIALS);
const cursedMaterials = new Set(CURSED_ONLY_MATERIALS);
const bossMaterials = new Set(Object.values(BOSS_MATERIAL_BY_LOCATION));

const filterLootForOwnership = (enemy, loot = []) => {
  const allowedEquipment = new Set([
    ...COMMON_LEVEL_ONE_EQUIPMENT,
    ...(LOCATION_LEVEL_ONE_EQUIPMENT[enemy.location] || []),
  ]);
  const allowedMaterials = new Set([
    ...COMMON_LEVEL_ONE_MATERIALS,
    ...(LOCATION_LEVEL_ONE_MATERIALS[enemy.location] || []),
  ]);
  const cursedSource = enemy.roomRole === 'cursedEnemy' || isGoblinCursedName(enemy.name);
  return loot.filter(name => {
    if (bossMaterials.has(name)) return false;
    if (cursedMaterials.has(name)) return cursedSource;
    if (craftOnlyEquipment.has(name)) return false;
    if (locationOwnedEquipment.has(name) || commonEquipment.has(name)) return allowedEquipment.has(name);
    if (locationOwnedMaterials.has(name) || commonMaterials.has(name)) return allowedMaterials.has(name);
    return true;
  });
};

const mapBlueprintToEnemy = (enemy, index, options = {}) => {
  const nameLower = (enemy.name || '').toLowerCase();
  const isWarped = nameLower.includes('искаж');
  const baseAbilityNames = Array.isArray(enemy.abilityNames)
    ? [...enemy.abilityNames]
    : [];

  if (isWarped && !enemy.skipWarpedAutoAbilities) {
    baseAbilityNames.push('Кристаллический панцирь', 'Призматический разлом');
  }

  const ensuredAbilities = ensureAttackAbility(baseAbilityNames);
  const attack = enemy.attack ?? enemy.baseAtk ?? 6;
  const magAtk = enemy.magAtk ?? 1;
  const explicitBoss = enemy?.boss === true;
  const isBoss = explicitBoss || enemy?.name === 'Пепельный Колпак Рагшнар';
  const explicitMiniBoss = enemy?.miniBoss === true;
  const inferredMiniBoss = !isBoss && (explicitMiniBoss || nameLower.includes('оскверн') || isWarped);
  const blueprintIndex =
    typeof index === 'number' && index >= 0 ? index : ENEMY_BLUEPRINTS.indexOf(enemy);
  const fallbackId = enemy.id ?? (blueprintIndex >= 0 ? `enemy-${blueprintIndex}` : `enemy-${index}`);
  const runtimeId = options.overrideId ?? fallbackId;
  const portraitKey = options.portraitKey ?? enemy.portraitKey ?? enemy.portraitId ?? fallbackId;

  const baseEnemy = {
    ...enemy,
    id: runtimeId,
    portraitId: portraitKey,
    portraitKey,
    hp: enemy.hp ?? enemy.maxHp ?? 50,
    maxHp: enemy.maxHp ?? enemy.hp ?? 50,
    baseAtk: attack,
    baseAttack: attack,
    baseMagAtk: magAtk,
    attack,
    magAtk,
    basicAttackProfile: enemy.basicAttackProfile || (attack >= magAtk ? 'physical' : 'magical'),
    boss: isBoss,
    miniBoss: inferredMiniBoss,
    controlImmune: isBoss || inferredMiniBoss || enemy.controlImmune === true,
    innateControlImmune: isBoss || inferredMiniBoss || enemy.innateControlImmune === true,
    summonOnly: enemy.summonOnly ?? enemy.summonedOnly ?? false,
    abilityNames: ensuredAbilities,
    lootTable: filterLootForOwnership(enemy, Array.isArray(enemy.loot) ? enemy.loot : parseLoot(enemy.loot)),
    lootRolls: enemy.lootRolls ?? 1,
  };

  const tunedEnemy = applyDifficultyTuning(baseEnemy);
  const abilityAttack = tunedEnemy.attack ?? baseEnemy.attack;

  return {
    ...tunedEnemy,
    baseAtk: tunedEnemy.baseAtk ?? abilityAttack,
    attack: abilityAttack,
    abilities: ensuredAbilities.map(name => createAbilityByName(name, abilityAttack)),
  };
};

const ACTIVE_ENEMY_BLUEPRINTS = ENEMY_BLUEPRINTS.filter(
  enemy => !enemy.retired && !RETIRED_GOBLIN_CURSED_NAMES.has(enemy.name) && !isRetiredGoblinCursedEnemy(enemy)
);

export const allEnemies = ACTIVE_ENEMY_BLUEPRINTS.map(mapBlueprintToEnemy);

// Полный пул противников всех локаций (кроме чисто призывных юнитов).
export const enemies = allEnemies.filter(enemy => !enemy.summonOnly);

export const getEnemyBlueprintByName = (name) =>
  ACTIVE_ENEMY_BLUEPRINTS.find(enemy => enemy.name === name);

// Simulator tooling may resolve an explicitly cloned authored blueprint through
// the same difficulty pipeline as production without modifying the canonical
// blueprint table.
export const createEnemyInstanceFromBlueprint = (blueprint, options = {}) => {
  if (!blueprint) return null;
  const blueprintIndex = ENEMY_BLUEPRINTS.indexOf(blueprint);
  return mapBlueprintToEnemy(blueprint, blueprintIndex, options);
};

export const createEnemyInstanceByName = (name, { rng = Math.random, idPrefix = Date.now() } = {}) => {
  const blueprint = getEnemyBlueprintByName(name);
  if (!blueprint) return null;
  const uniqueIndex = `${idPrefix}-${Math.floor(rng() * 1000)}`;
  const blueprintIndex = ENEMY_BLUEPRINTS.indexOf(blueprint);
  const fallbackPortrait =
    blueprint?.portraitKey ||
    blueprint?.portraitId ||
    blueprint?.id ||
    (blueprintIndex >= 0 ? `enemy-${blueprintIndex}` : null);
  const instance = createEnemyInstanceFromBlueprint(blueprint, {
    overrideId: `summon-${uniqueIndex}`,
    portraitKey: fallbackPortrait,
  });
  return {
    ...instance,
    id: `summon-${uniqueIndex}`,
  };
};
