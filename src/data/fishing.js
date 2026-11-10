import { normalizeItemName } from './items';

const FISHING_LOCATIONS = {
  'Гоблинские Норы': {
    common: [
      { name: 'Сумрачный пескарь', difficulty: 1, value: 18 },
      { name: 'Пещерный зубочист', difficulty: 1, value: 22 },
      { name: 'Шипохвост нор', difficulty: 2, value: 28 },
    ],
    unique: [
      { name: 'Ржавожаберный шептун', difficulty: 2, value: 36 },
      { name: 'Крысожор-плесень', difficulty: 3, value: 48 },
    ],
  },
  'Грибные Пещеры': {
    common: [
      { name: 'Светокаповая минога', difficulty: 1, value: 20 },
      { name: 'Спороплав', difficulty: 2, value: 30 },
      { name: 'Мохожор-стеклянник', difficulty: 2, value: 34 },
    ],
    unique: [
      { name: 'Мицелийный скат', difficulty: 3, value: 52 },
      { name: 'Троглодонный призрак', difficulty: 3, value: 58 },
    ],
  },
};

export const FISHING_ROD_BONUSES = {
  // Legacy hook/tap power is intentionally collapsed into one small, readable
  // control bonus: it reduces tension gain and slightly improves pull efficiency.
  'Костяная удочка': { controlBonus: 0.06, luck: 0.02 },
  'Жезл глубинного лова': { controlBonus: 0.1, luck: 0.05 },
};

export const BAIT_BONUSES = {
  // Bait keeps its unique-fish luck role and adds only a modest calm window aid.
  'Светлячный мотыль': { controlBonus: 0.02, calmDurationBonusMs: 60, luck: 0.03 },
  'Споровая наживка': { controlBonus: 0.04, calmDurationBonusMs: 100, luck: 0.04 },
};

const pickRandom = (arr = []) => arr[Math.floor(Math.random() * arr.length)] ?? null;

export const getFishingPoolForLocation = (location) => FISHING_LOCATIONS[location] || FISHING_LOCATIONS['Гоблинские Норы'];

const resolveFishingBonuses = (setup = {}) => {
  const rodName = normalizeItemName(setup.rod);
  const baitName = normalizeItemName(setup.bait);
  const rod = FISHING_ROD_BONUSES[rodName] || { controlBonus: 0, luck: 0 };
  const bait = BAIT_BONUSES[baitName] || { controlBonus: 0, calmDurationBonusMs: 0, luck: 0 };
  return {
    rodName,
    baitName,
    controlBonus: rod.controlBonus + bait.controlBonus,
    calmDurationBonusMs: bait.calmDurationBonusMs || 0,
    luck: rod.luck + bait.luck,
  };
};

export const createFishingChallenge = (location, setup = {}) => {
  const pool = getFishingPoolForLocation(location);
  const bonuses = resolveFishingBonuses(setup);
  const uniqueChance = Math.min(0.4, 0.18 + bonuses.luck);
  const isUnique = pool.unique.length > 0 && Math.random() < uniqueChance;
  const fish = pickRandom(isUnique ? pool.unique : pool.common) || pickRandom(pool.common) || pickRandom(pool.unique);
  if (!fish) return null;

  return {
    location,
    fish,
    isUnique,
    controlBonus: bonuses.controlBonus,
    calmDurationBonusMs: bonuses.calmDurationBonusMs,
    rewards: {
      fishItem: fish.name,
      silver: fish.value,
    },
    setup: {
      rod: bonuses.rodName,
      bait: bonuses.baitName,
    },
  };
};

export const getFishingItems = () => {
  return Object.values(FISHING_LOCATIONS)
    .flatMap(location => [...location.common, ...location.unique])
    .map(fish => fish.name);
};
