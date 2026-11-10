import { allEnemies } from './enemies';
import { MAGIC_SCHOOLS } from '../constants/magicSchools';
import { getEffectDefinition } from '../utils/effects';

const locations = new Set(['Гоблинские Норы', 'Грибные Пещеры']);
const schools = new Set(Object.values(MAGIC_SCHOOLS));

test('active Goblin and Mushroom enemies have explicit complete offensive identities', () => {
  const roster = allEnemies.filter(enemy => locations.has(enemy.location));
  const missing = roster.filter(enemy => !(enemy.attack > 0) || !(enemy.magAtk > 0)).map(enemy => enemy.name);
  expect(missing).toEqual([]);
  const magicalBasics = roster.filter(enemy => enemy.baseMagAtk > enemy.baseAttack);
  expect(magicalBasics.filter(enemy => !schools.has(enemy.primaryMagicSchool)).map(enemy => enemy.name)).toEqual([]);
});

test('active L1 magical named damage abilities have explicit schools and stable scaling metadata', () => {
  const roster = allEnemies.filter(enemy => locations.has(enemy.location));
  const damaging = roster.flatMap(enemy => enemy.abilities.filter(ability => !ability.basic && !ability.passive && (typeof ability.damage === 'function' || ability.damage > 0)).map(ability => ({ enemy: enemy.name, ability })));
  expect(damaging.filter(({ ability }) => !ability.scalingStat && typeof ability.damage === 'function').map(({ enemy, ability }) => `${enemy}: ${ability.name}`)).toEqual([]);
  expect(damaging.filter(({ ability }) => ability.type === 'magical' && !schools.has(ability.school)).map(({ enemy, ability }) => `${enemy}: ${ability.name}`)).toEqual([]);
});

test('active Goblin and Mushroom status-bearing descriptions use structured GameTerm references', () => {
  const statusWords = /(Отрав|Кровотеч|Горен|Щит|Регенерац|Замедлен|Ускорен|Уклонен|Шок|Оглушен|Уязвим|Ослаблен|Укреплен|Магическ.*(?:слаб|мощ)|Метк.*вампир|Контратак|Слеп)/i;
  const abilities = allEnemies
    .filter(enemy => locations.has(enemy.location))
    .flatMap(enemy => enemy.abilities || [])
    .filter(ability => !ability.basic && statusWords.test(ability.description || ''));
  expect(abilities.filter(ability => !Array.isArray(ability.descriptionParts)).map(ability => ability.name)).toEqual([]);
  abilities.forEach(ability => {
    const references = ability.descriptionParts.filter(part => part && typeof part === 'object');
    expect(references.length).toBeGreaterThan(0);
    expect(references.every(reference => Boolean(getEffectDefinition(reference.statusId)))).toBe(true);
  });
});
