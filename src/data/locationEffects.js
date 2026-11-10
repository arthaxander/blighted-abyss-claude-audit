// src/data/locationEffects.js
// Центральный справочник эффектов локаций и предложения по будущим биомам.

import { EFFECT_IDS, addEffect } from '../utils/effects';

const DEFAULT_LOG_ICON = '🌍';

const ratSwarmEffect = {
  id: 'rat-swarm',
  name: 'Нашествие крыс',
  description:
    'В душных туннелях крысы бросаются на любого пришельца: в начале боя у героев 35% шанс получить кровотечение на 1 ход, у гоблинов — 20%.',
  applyAtBattleStart: ({ session, log, location, random = Math.random }) => {
    if (!session?.state) return;
    const { players = [], enemies = [] } = session.state;

    const applyBleed = (unit, chance) => {
      if (!unit || unit.hp <= 0) return;
      if (random() > chance) return;
      addEffect(
        unit,
        {
          id: EFFECT_IDS['Кровотечение'],
          duration: 1,
          sourceName: 'Нашествие крыс',
          sourceAttack: 5,
          metadata: { location },
        },
        message => log?.(`${DEFAULT_LOG_ICON} ${message}`),
        null,
        { origin: 'locationEffect', location }
      );
      log?.(`🐀 ${unit.name || 'Боец'} истекает кровью из-за нашествия крыс!`);
    };

    players.filter(Boolean).forEach(player => applyBleed(player, 0.35));
    enemies.filter(Boolean).forEach(enemy => applyBleed(enemy, 0.2));
  },
};

const sporeMistEffect = {
  id: 'spore-mist',
  name: 'Споровый туман',
  description: 'Пока персонаж находится под Отравлением, его Скорость снижена на 15%.',
  descriptionParts: ['Пока персонаж находится под ', { statusId: 'poison', text: 'Отравлением' }, ', его Скорость снижена на 15%.'],
};

// The combat hook is implemented in the Forest recovery branch. The location
// still remains locked until the recovered branch is reviewed as a whole.
const rootsOfTheFallenEffect = {
  id: 'roots-of-the-fallen',
  name: 'Корни павших',
  description: 'Первая смерть противника в рамках одного исходного действия накладывает герою 1 Опутывание (не более 5 зарядов).',
};

export const LOCATION_EFFECTS = {
  'Гоблинские Норы': ratSwarmEffect,
  'Грибные Пещеры': sporeMistEffect,
  'Лес Увядания': rootsOfTheFallenEffect,
  'Руины Неупокоенных': {
    id: 'legacy-of-the-fallen', name: 'Наследие павших',
    description: 'После окончательной гибели врага его душа переходит выжившему союзнику. [Неупокоенность] даёт +10% ФА, МА и Скорости за заряд (до 3).',
  },
  'Шахты Тления': {
    id: 'mines-oppression',
    name: 'Шахтный гнёт',
    description: 'Каждый новый тип усиления заполняет врагу 10% шкалы хода. Каждое новое ослабление, наложенное врагом на героя или призыва, отнимает у цели 10% шкалы. Заряды и продление статусов не срабатывают.',
  },
  'Лагерь Отступников': {
    id: 'camp-alert', name: 'Тревога лагеря',
    description: 'Тревога растёт после завершённых боёв: 0–2 — низкая, 3–5 — I, 6–8 — II, 9+ — III. Обычная пачка может получить только Готовность или Подкрепление.',
    alertScale: true,
  },
};

export const LOCATION_EFFECT_IDEAS = [
  {
    location: 'Грибные Катакомбы',
    name: 'Споровый туман',
    description:
      'Начало каждого боя окутано спорами: один случайный боец получает регенерацию на 2 хода, другой — замедление на 1 ход. Эффект подчёркивает непредсказуемость грибных пещер.',
  },
  {
    location: 'Руины беженцев',
    name: 'Партизанские засады',
    description:
      'Перед боем дезертиры устраивают засаду: герои начинают с неполной полоской хода, а враги получают щит. Уменьшает контроль игрока и создаёт ощущение бойни в руинах.',
  },
  {
    location: 'Лагерь непокаянных',
    name: 'Шёпот некрополя',
    description:
      'Спектральные стоны подтачивают разум: в начале боя у каждого героя 30% шанс получить отрицательный эффект Немоты на 1 ход, а враги призраки быстрее накапливают инициативу.',
  },
];

