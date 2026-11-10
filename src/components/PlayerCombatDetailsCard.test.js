import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PlayerCombatDetailsCard from './PlayerCombatDetailsCard';

const player = {
  name: 'Испытатель', class: 'Defender', hp: 73, maxHp: 125,
  speed: 145, attack: 18, magAtk: 4, physDef: 22, magicDef: 9,
  dodge: 0.05, critChance: 0.12, critDamage: 0.5,
  effects: [
    { id: 'regeneration', duration: 2 },
    { id: 'bleed', remainingTurns: 3, stacks: 2 },
  ],
  equipment: { armor: 'Куртка Мародёра', mainHand: 'Ржавый меч новобранца' },
  activeRelicId: 'ritual_blade',
  abilities: [],
};

const sourcePlayer = {
  relics: { activeRelicId: 'ritual_blade', progress: { ritual_blade: { level: 2, xp: 0 } } },
};

test('shows current combat stats, statuses, and ordered active passive sources', () => {
  const { container } = render(<PlayerCombatDetailsCard player={player} sourcePlayer={sourcePlayer} onClose={jest.fn()} />);
  expect(screen.getByText('HP 73 / 125')).toBeInTheDocument();
  expect(container.querySelector('.enemy-detail-stat--hp')).not.toBeInTheDocument();
  expect(screen.getByText('Скорость').parentElement).toHaveTextContent('145');
  expect(screen.getByText('Уворот').parentElement).toHaveTextContent('5%');
  expect(screen.getByText('Крит. шанс').parentElement).toHaveTextContent('12%');
  expect(screen.getByText('Крит. урон').parentElement).toHaveTextContent('150%');
  expect(screen.queryByText('Шанс критического удара')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '[Регенерация]' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '[Кровотечение]' })[0].closest('.player-combat-status')).toHaveTextContent('×2 · 3 х.');

  const passiveLabels = Array.from(container.querySelectorAll('.player-combat-passive h4')).map(node => node.textContent);
  expect(passiveLabels).toEqual(['Шипастый щит', 'Реликвия — Ритуальный Клинок 2', 'Куртка Мародёра']);
  expect(screen.getByText(/увеличиваешь его длительность/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '[Кровотечения]' })).toBeInTheDocument();
  expect(screen.queryByText('+5 к атаке')).not.toBeInTheDocument();
  expect(screen.queryByText(/мгновенный физический урон/)).not.toBeInTheDocument();
  expect(screen.queryByText('Ржавый меч новобранца')).not.toBeInTheDocument();
});

test('summon details show full identity, stats, statuses, active and passive skills', () => {
  const summon = {
    id: 'fire-elemental-1', name: 'Огненный элементаль', summoned: true, summonKind: 'fire_elemental',
    hp: 45, maxHp: 50, attack: 8, magAtk: 36, physDef: 12, magicDef: 18, speed: 90,
    effects: [{ id: 'burn', remainingTurns: 2 }],
    abilities: [
      { name: 'Огненный сгусток', description: 'Огненная атака.' },
      { name: 'Пылающее ядро', passive: true, description: 'Взрывается при смерти.' },
    ],
  };
  render(<PlayerCombatDetailsCard player={summon} sourcePlayer={summon} summon onClose={jest.fn()} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('Огненный элементаль');
  expect(screen.getByText('HP 45 / 50')).toBeInTheDocument();
  expect(screen.getByText('Огненный сгусток')).toBeInTheDocument();
  expect(screen.getByText('Пылающее ядро')).toBeInTheDocument();
  expect(screen.getAllByText('Пылающее ядро')).toHaveLength(1);
  expect(screen.queryByText('ElementalistSummon')).not.toBeInTheDocument();
  expect(document.querySelector('[data-art-role="summon"]')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '[Горение]' })).toBeInTheDocument();
});

test('stable class feature is independent from and separated from all equipped passives', () => {
  const mage = { ...player, class: 'Mage', equippedClassPassiveIds: ['lightning_speed', 'elemental_shell'], abilities: [{ name: 'Скорость молнии', passive: true }] };
  render(<PlayerCombatDetailsCard player={mage} sourcePlayer={{}} onClose={jest.fn()} />);
  expect(screen.getByRole('region', { name: 'Особенность класса' })).toHaveTextContent('Заряд стихий');
  const selected = screen.getByRole('region', { name: 'Пассивные способности' });
  expect(selected).toHaveTextContent('Скорость молнии'); expect(selected).toHaveTextContent('Стихийная оболочка');
});

test.each([['Defender', 'Шипастый щит'], ['Archer', 'Сквозные раны'], ['Mage', 'Заряд стихий']])('%s resolves its built-in feature by stable class identity', (className, feature) => {
  render(<PlayerCombatDetailsCard player={{ ...player, class: className, abilities: [{ name: 'Чужая пассивка', passive: true }] }} sourcePlayer={{}} onClose={jest.fn()} />);
  expect(screen.getByRole('region', { name: 'Особенность класса' })).toHaveTextContent(feature);
  expect(screen.queryByText('Чужая пассивка')).not.toBeInTheDocument();
});

test('trap and temporary summon metadata select square art', () => {
  const trap = { name: 'Змеиная ловушка', entityRole: 'trap', summoned: true, hp: 1, maxHp: 1, abilities: [], effects: [] };
  const { rerender } = render(<PlayerCombatDetailsCard player={trap} sourcePlayer={trap} summon onClose={jest.fn()} />);
  expect(document.querySelector('[data-art-role="square"]')).toBeInTheDocument();
  rerender(<PlayerCombatDetailsCard player={{ ...trap, entityRole: undefined, temporarySummon: true }} sourcePlayer={trap} summon onClose={jest.fn()} />);
  expect(document.querySelector('[data-art-role="square"]')).toBeInTheDocument();
});

test('status and passive references use the shared glossary interaction', () => {
  render(<PlayerCombatDetailsCard player={player} sourcePlayer={sourcePlayer} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '[Регенерация]' }));
  expect(screen.getByLabelText('Статус: Регенерация')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '[Щитом]' }));
  expect(screen.getByLabelText('Статус: Щит')).toBeInTheDocument();
});

test('current physical and magical defense expose canonical mitigation help', () => {
  render(<PlayerCombatDetailsCard player={player} sourcePlayer={sourcePlayer} onClose={jest.fn()} />);
  expect(screen.getByText('Физ. защ.').closest('.enemy-detail-stat')).toHaveTextContent('22');
  expect(screen.getByText('Маг. защ.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Физическая защита' }));
  expect(screen.getByRole('dialog', { name: 'Физическая защита' })).toHaveTextContent('примерно 18%');
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(screen.getByRole('dialog', { name: 'Испытатель' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Магическая защита' }));
  expect(screen.getByRole('dialog', { name: 'Магическая защита' })).toHaveTextContent('примерно 8%');
});

test('shows only equipped rune effects and reads runtime progress without mutation', () => {
  const runePlayer = {
    ...player,
    activeRunes: { weapon: 'ember_heart', armor: 'stone_vigil', ring: 'astral_focus' },
    _flameRuneActions: 2,
    _astralEchoAvailable: true,
  };
  const before = JSON.parse(JSON.stringify(runePlayer));
  render(<PlayerCombatDetailsCard player={runePlayer} sourcePlayer={{ ...sourcePlayer, runes: { inventory: ['unused-rune'] } }} onClose={jest.fn()} />);

  expect(screen.getByText('Руна Пламенного сердца')).toBeInTheDocument();
  expect(screen.getByText(/Каждое третье атакующее действие/)).toBeInTheDocument();
  expect(screen.getByText('2 / 3 атак')).toBeInTheDocument();
  expect(screen.getByText('Руна Стального Отпора')).toBeInTheDocument();
  expect(screen.getByText(/20% шанс после прямого урона/)).toBeInTheDocument();
  expect(screen.getByText('Руна Астрального эха')).toBeInTheDocument();
  expect(screen.getByText('Готово')).toBeInTheDocument();
  expect(screen.queryByText('unused-rune')).not.toBeInTheDocument();
  expect(runePlayer).toEqual(before);
});

test('minimal hero remains a clean stats-only card', () => {
  render(<PlayerCombatDetailsCard player={{ name: 'Герой', hp: 10, maxHp: 10, effects: [], abilities: [] }} sourcePlayer={{}} onClose={jest.fn()} />);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Активные эффекты' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Пассивные эффекты' })).not.toBeInTheDocument();
});
