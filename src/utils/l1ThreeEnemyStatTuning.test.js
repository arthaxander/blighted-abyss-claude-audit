import { getEnemyBlueprintByName } from '../data/enemies';
import { DESERTER_LOCATION, FUNGAL_LOCATION, GOBLIN_LOCATION } from './enemyPools';

const expectedOrdinary = {
  [GOBLIN_LOCATION]: {
    'Крысомант из Нор': { maxHp: 60, attack: 4, magAtk: 7 },
    'Гоблин-палач': { maxHp: 84, attack: 8, magAtk: 2 },
    'Гоблин-Потрошитель': { maxHp: 72, attack: 6, magAtk: 2 },
    'Гоблин-арбалетчик': { maxHp: 48, attack: 7, magAtk: 2 },
    'Гоблин-Ткач': { maxHp: 54, attack: 4, magAtk: 1 },
  },
  [FUNGAL_LOCATION]: {
    'Троглодит-копейщик': { maxHp: 132, attack: 10, magAtk: 3 },
    'Троглодит-заклинатель змей': { maxHp: 86, attack: 5, magAtk: 9 },
    'Троглодит-шаман': { maxHp: 101, attack: 5, magAtk: 10 },
    'Троглодит-заражённый': { maxHp: 90, attack: 8, magAtk: 2 },
    'Троглодит-споровик': { maxHp: 82, attack: 5, magAtk: 10 },
  },
  [DESERTER_LOCATION]: {
    'Громила': { maxHp: 125, attack: 10 },
    'Чернокнижник': { maxHp: 82, attack: 7, magAtk: 10 },
    'Трюкач': { maxHp: 84, attack: 7, magAtk: 9 },
    'Дуэлянт': { maxHp: 94, attack: 10 },
    'Следопыт': { maxHp: 89, attack: 9 },
  },
};

const expectedStrong = {
  'Крысиный матриарх': { maxHp: 225, attack: 14, magAtk: 5 },
  'Крысиный всадник': { maxHp: 139, attack: 21, magAtk: 6 },
  'Гоблин-огнепоклонник': { maxHp: 129, attack: 8, magAtk: 18 },
  'Костестраж': { maxHp: 185, attack: 18, magAtk: 3 },
  'Змеиный двоеглав': { maxHp: 177, attack: 20, magAtk: 4 },
  'Одичавший троглодит': { maxHp: 138, attack: 21, magAtk: 4 },
  'Аптекарь': { maxHp: 127, attack: 10, magAtk: 11 },
  'Заклинатель бурь': { maxHp: 125, attack: 10, magAtk: 16 },
  'Мастер алебарды': { maxHp: 166, attack: 18 },
};

const expectedCursed = {
  'Искажённый гоблин-кристаллолом': { maxHp: 273, attack: 32, magAtk: 7 },
  'Осквернённый гоблин-крысокожий': { maxHp: 211, attack: 26, magAtk: 7 },
  'Искажённый троглодит-тотемщик': { maxHp: 181, attack: 9, magAtk: 30 },
  'Осквернённый троглодит-змееголов': { maxHp: 189, attack: 22, magAtk: 5 },
  'Осквернённый рубака': { maxHp: 163, attack: 19 },
  'Искажённый страж': { maxHp: 181, attack: 16, magAtk: 13 },
};

const protectedEnemies = {
  'Пепельный Колпак Рагшнар': { maxHp: 375, attack: 27, magAtk: 10 },
  'Троглодит-мицелий (босс)': { maxHp: 400, attack: 14, magAtk: 37 },
  'Мастер клинков': { maxHp: 285, attack: 24 },
};

const byName = name => getEnemyBlueprintByName(name);

describe('L1 three-enemy stat tuning', () => {
  test('the 15 ordinary L1 enemies use the first-pass +20% HP / -40% offense tuning', () => {
    Object.entries(expectedOrdinary).forEach(([location, roster]) => {
      Object.entries(roster).forEach(([name, stats]) => {
        const enemy = byName(name);
        expect(enemy).toBeTruthy();
        expect(enemy.location).toBe(location);
        expect(enemy.boss).not.toBe(true);
        expect(enemy.miniBoss).not.toBe(true);
        expect(enemy.encounterPhase).not.toBe('late');
        expect(enemy.encounterPhase).not.toBe('elite');
        expect(enemy.hp).toBe(stats.maxHp);
        expect(enemy.maxHp).toBe(stats.maxHp);
        expect(enemy.attack).toBe(stats.attack);
        if (stats.magAtk != null) expect(enemy.magAtk).toBe(stats.magAtk);
      });
    });
  });

  test('all nine L1 Strong enemies use +30% HP / -20% offense tuning', () => {
    Object.entries(expectedStrong).forEach(([name, stats]) => {
      const enemy = byName(name);
      expect(enemy).toBeTruthy();
      expect(enemy.encounterPhase).toBe('late');
      expect(enemy.hp).toBe(stats.maxHp);
      expect(enemy.maxHp).toBe(stats.maxHp);
      expect(enemy.attack).toBe(stats.attack);
      if (stats.magAtk != null) expect(enemy.magAtk).toBe(stats.magAtk);
    });
  });

  test('all six L1 Cursed enemies use +25% HP / -10% offense tuning', () => {
    Object.entries(expectedCursed).forEach(([name, stats]) => {
      const enemy = byName(name);
      expect(enemy).toBeTruthy();
      expect(enemy.encounterPhase).toBe('elite');
      expect(enemy.hp).toBe(stats.maxHp);
      expect(enemy.maxHp).toBe(stats.maxHp);
      expect(enemy.attack).toBe(stats.attack);
      if (stats.magAtk != null) expect(enemy.magAtk).toBe(stats.magAtk);
    });
  });

  test('boss stats remain explicitly protected from the pack-size rebalance', () => {
    Object.entries(protectedEnemies).forEach(([name, stats]) => {
      expect(byName(name)).toEqual(expect.objectContaining(stats));
    });
  });
});
