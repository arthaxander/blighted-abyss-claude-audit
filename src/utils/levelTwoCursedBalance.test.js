import { getEnemyBlueprintByName } from '../data/enemies';

// Floor-II cursed encounters are solo battles, not ordinary three-enemy parties.
const cursed = [
  ['Кристальный раскольник — Искажение', 975, 30, 24, 29, 24, 132],
  ['Осквернённый хищник — Осквернение', 790, 35, 7, 14, 12, 163],
  ['Осадный урод — Осквернение', 1110, 37, 1, 20, 8, 120],
  ['Кристальный мертвострел — Искажение', 1030, 32, 1, 20, 25, 146],
  ['Искажённый взрывник', 920, 29, 24, 21, 21, 141],
  ['Осквернённый лекарь', 880, 22, 31, 14, 19, 128],
];
test.each(cursed)('%s has tuned floor-II solo-elite stats', (name, maxHp, attack, magAtk, physDef, magicDef, speed) => {
  expect(getEnemyBlueprintByName(name)).toMatchObject({ maxHp, hp: maxHp, attack, magAtk, physDef, magicDef, speed, roomRole: 'cursedEnemy' });
});

test('Ruins regular units have low magic defenses and low HP and defense', () => {
  const normalNames = ['Глашатай мёртвого марша','Сдвоенный бастион','Заклинатель двух душ','Всадник последнего похода','Раздробленный копейщик'];
  const strongNames = ['Двутелый дуэлянт','Знаменосец павшей когорты','Сшиватель душ'];
  for (const name of [...normalNames, ...strongNames]) {
    const enemy = getEnemyBlueprintByName(name);
    expect(enemy.magicDef).toBeLessThanOrEqual(3);
    expect(enemy.physDef).toBeLessThanOrEqual(9);
    expect(enemy.maxHp).toBeLessThanOrEqual(390);
  }
  expect(getEnemyBlueprintByName('Легион Погребённых')).toMatchObject({ maxHp: 1950, physDef: 16, magicDef: 5 });
});
