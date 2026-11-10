import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import GuildScreen from './GuildScreen';
import { UIProvider } from '../contexts/UIContext';
import {
  CLASS_XP_THRESHOLDS,
  applyClassLoadoutToPlayer,
  grantClassExperience,
} from '../data/classProgression';
import { createAbilityByName } from '../data/abilityPresets';

const player = { class: 'Defender', silver: 0, inventory: [], equipment: {}, runes: {}, questLog: {}, relics: {} };
const renderClass = (progression, classId = 'Defender') => {
  const onUpdateClassProgression = jest.fn();
  const classPlayer = { ...player, class: classId, classProgression: progression };
  const view = render(<UIProvider><GuildScreen player={classPlayer} storageItems={[]} classProgression={progression} onUpdatePlayer={jest.fn()} onUpdateClassProgression={onUpdateClassProgression} /></UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Класс' }));
  return { ...view, onUpdateClassProgression };
};
const pointer = (target, type, x, y, pointerType = 'mouse') => {
  const event = new Event(type.toLowerCase(), { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType }, clientX: { value: x }, clientY: { value: y }, button: { value: 0 } });
  fireEvent(target, event);
};
const dragTile = (source, target) => {
  pointer(source, 'pointerDown', 10, 10);
  pointer(target, 'pointerMove', 16, 10);
};

test('Class screen is a compact visual header, four-slot loadout, and complete eight-skill grid', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
  const { container } = renderClass(progression);
  expect(screen.queryByText('← В зал')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Холл' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('heading', { name: 'Защитник' })).toBeInTheDocument();
  expect(screen.getByText('Ур. 3')).toBeInTheDocument();
  expect(screen.getByLabelText('Опыт класса')).toBeInTheDocument();
  expect(screen.queryByText(/Очки класса:/)).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('Активные навыки')).getAllByRole('button')).toHaveLength(4);
  expect(within(screen.getByLabelText('Навыки класса')).getAllByRole('button')).toHaveLength(8);
  expect(container.querySelectorAll('[data-skill-state="active"]')).toHaveLength(8); // four loadout tiles plus their four library states
  expect(container.querySelector('[data-skill-id="Таран"]')).toHaveAttribute('data-skill-state', 'locked');
  expect(container.querySelector('[data-skill-id="Ударная волна"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(screen.getByText('🔒 Ур. 5')).toBeInTheDocument();
  expect(screen.getAllByText('Ранящий удар').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Защитный удар').length).toBeGreaterThan(0);
  expect(screen.queryByText('Кровавый таран')).not.toBeInTheDocument();
  expect(screen.queryByText('Удар щитом')).not.toBeInTheDocument();
  expect(screen.queryByText(createAbilityByName('Стойкость').description)).not.toBeInTheDocument();
  expect(container.querySelector('.class-skill-tile__slot')).not.toBeInTheDocument();
});

test('Guild owns the only class navigation row and controls active, passive, and switch domains', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
  const { container } = renderClass(progression);
  expect(screen.getAllByRole('tablist')).toHaveLength(1);
  expect(screen.queryByRole('group', { name: 'Тип навыков' })).not.toBeInTheDocument();
  expect(container.querySelector('[data-loadout-domain="active"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Пассивные навыки' }));
  expect(container.querySelector('[data-loadout-domain="active"]')).not.toBeInTheDocument();
  expect(container.querySelector('[data-loadout-domain="passive"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Активные навыки' }));
  expect(container.querySelector('[data-loadout-domain="active"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Смена класса' }));
  expect(screen.queryByLabelText('Прогресс класса')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Элементалист' })).toBeInTheDocument();
});

test('active pointer drag uses the shared threshold to swap canonical slots while invalid drops do nothing', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
  const { onUpdateClassProgression } = renderClass(progression);
  const slots = within(screen.getByLabelText('Активные навыки')).getAllByRole('button');
  pointer(slots[0], 'pointerDown', 10, 10);
  pointer(slots[0], 'pointerMove', 14, 10);
  expect(document.querySelector('.class-skill-drag-preview')).not.toBeInTheDocument();
  pointer(slots[0], 'pointerUp', 14, 10);
  fireEvent.click(within(screen.getByLabelText('Активные навыки')).getAllByRole('button')[0]);
  expect(screen.getByRole('dialog', { name: 'Навык: Стойкость' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  dragTile(slots[0], slots[2]);
  expect(slots[0]).toHaveClass('is-drag-source');
  expect(slots[2]).toHaveClass('is-hovered-drop-target');
  pointer(slots[2], 'pointerUp', 16, 10);
  expect(onUpdateClassProgression).toHaveBeenCalledTimes(1);
  const swapped = onUpdateClassProgression.mock.calls[0][0];
  expect(swapped.Defender.activeSkillIds).toEqual(['Кровавый таран', 'Устрашение', 'Стойкость', 'Удар щитом']);
  expect(new Set(swapped.Defender.activeSkillIds)).toHaveProperty('size', 4);
  expect(applyClassLoadoutToPlayer(player, swapped).abilityNames.slice(0, 4)).toEqual(swapped.Defender.activeSkillIds);

  const currentSlots = within(screen.getByLabelText('Активные навыки')).getAllByRole('button');
  dragTile(currentSlots[0], document.body);
  pointer(document.body, 'pointerUp', 30, 30);
  expect(onUpdateClassProgression).toHaveBeenCalledTimes(1);
});

test('active loadout touch drag avoids capture cancellation and resolves an occupied destination geometrically', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
  const { onUpdateClassProgression } = renderClass(progression);
  const slots = within(screen.getByLabelText('Активные навыки')).getAllByRole('button');
  slots[0].setPointerCapture = jest.fn();
  const previousElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = jest.fn(() => slots[2]);
  pointer(slots[0], 'pointerDown', 10, 10, 'touch');
  pointer(window, 'pointerMove', 24, 10, 'touch');
  expect(slots[0].setPointerCapture).not.toHaveBeenCalled();
  expect(slots[2]).toHaveClass('is-hovered-drop-target');
  pointer(window, 'pointerUp', 24, 10, 'touch');
  document.elementFromPoint = previousElementFromPoint;
  expect(onUpdateClassProgression.mock.calls[0][0].Defender.activeSkillIds)
    .toEqual(['Кровавый таран', 'Устрашение', 'Стойкость', 'Удар щитом']);
});

test('active touch drag commits an empty destination even when the WebView ends it with pointercancel', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
  progression.Defender.activeSkillIds = progression.Defender.activeSkillIds.slice(0, 3);
  const { container, onUpdateClassProgression } = renderClass(progression);
  const source = container.querySelector('[data-active-slot-index="0"]');
  const empty = container.querySelector('.class-skill-tile.is-empty[data-active-slot-index="3"]');
  const previousElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = jest.fn(() => empty);
  pointer(source, 'pointerDown', 10, 10, 'touch');
  pointer(window, 'pointerMove', 26, 10, 'touch');
  expect(empty).toHaveClass('is-hovered-drop-target');
  pointer(window, 'pointerCancel', 26, 10, 'touch');
  document.elementFromPoint = previousElementFromPoint;
  expect(onUpdateClassProgression.mock.calls[0][0].Defender.activeSkillIds)
    .toEqual([null, 'Устрашение', 'Кровавый таран', 'Стойкость']);
});

test('unlocked inactive pointer drag highlights all active targets and replaces only the hovered slot', () => {
  const levelThree = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
  const { container, onUpdateClassProgression } = renderClass(levelThree);
  const source = container.querySelector('[data-skill-id="Ударная волна"][data-skill-state="unlocked"]');
  const slots = within(screen.getByLabelText('Активные навыки')).getAllByRole('button');
  expect(source).toBeInTheDocument();
  expect(source).toHaveAttribute('data-loadout-draggable', 'true');
  expect(container.querySelector('[data-skill-id="Таран"]')).toHaveAttribute('data-loadout-draggable', 'false');
  expect(container.querySelector('[data-skill-id="Бросок щита"]')).toHaveAttribute('data-loadout-draggable', 'false');
  dragTile(source, slots[1]);
  expect(screen.getByLabelText('Активные навыки').parentElement).toHaveClass('is-dragging');
  slots.forEach(slot => expect(slot).toHaveClass(slot === slots[1] ? 'is-hovered-drop-target' : 'is-valid-drop-target'));
  expect(container.querySelector('.class-skill-drag-preview img')).toHaveAttribute('draggable', 'false');
  pointer(slots[1], 'pointerUp', 16, 10);
  const replaced = onUpdateClassProgression.mock.calls[0][0];
  expect(replaced.Defender.activeSkillIds[1]).toBe('Ударная волна');
  expect(replaced.Defender.activeSkillIds).toHaveLength(4);
  expect(replaced.Defender.unlockedSkillIds).toContain('Устрашение');
  expect(applyClassLoadoutToPlayer(player, replaced).abilityNames.slice(0, 4)).toEqual(replaced.Defender.activeSkillIds);
});

test('skill details show level gates without purchase controls and opened skills can enter the loadout', () => {
  const levelTwo = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[1]).progression;
  const lockedView = renderClass(levelTwo);
  fireEvent.click(lockedView.container.querySelector('[data-skill-id="Ударная волна"]'));
  const lockedDetails = screen.getByRole('dialog', { name: 'Навык: Ударная волна' });
  expect(lockedDetails).toHaveTextContent('35% атаки + минимум из 200% атаки и 5 × √[Щита]');
  expect(within(lockedDetails).getByText('Требуется уровень класса 3')).toBeInTheDocument();
  expect(within(lockedDetails).queryByRole('button', { name: /Разблокировать/ })).not.toBeInTheDocument();
  expect(lockedDetails.querySelector('.class-skill-art.is-large')).toHaveAttribute('src', expect.stringContaining('shockwave.webp'));
  lockedView.unmount();

  const levelThree = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[2]).progression;
  const { container, onUpdateClassProgression } = renderClass(levelThree);
  fireEvent.click(container.querySelector('[data-skill-id="Ударная волна"]'));
  expect(screen.getByText('Открыт')).toBeInTheDocument();
  expect(screen.queryByText(/Очки класса/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Добавить в активные' }));
  const picker = screen.getByRole('dialog', { name: 'Выберите слот' });
  expect(within(picker).getAllByRole('button', { name: /Слот \d:/ })).toHaveLength(4);
  fireEvent.click(within(picker).getByRole('button', { name: /Слот 2:/ }));
  fireEvent.click(within(picker).getByRole('button', { name: 'Заменить' }));

  expect(onUpdateClassProgression).toHaveBeenCalledTimes(1);
  const updated = onUpdateClassProgression.mock.calls[0][0];
  expect(updated.Defender.activeSkillIds[1]).toBe('Ударная волна');
  expect(updated.Defender.unlockedSkillIds).toContain('Ударная волна');
  expect(screen.queryByRole('dialog', { name: 'Выберите слот' })).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('Активные навыки')).getByRole('button', { name: /Ударная волна/ })).toBeInTheDocument();

  const combatPlayer = applyClassLoadoutToPlayer(player, updated);
  expect(combatPlayer.abilityNames.slice(0, 4)).toEqual(updated.Defender.activeSkillIds);
});

test('Class screen separates Active and Passive modes and level-earned passives can equip/remove directly', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[3]).progression;
  const { container, onUpdateClassProgression } = renderClass(progression);
  expect(screen.getByRole('tab', { name: 'Активные навыки' })).toHaveAttribute('aria-selected','true');
  expect(screen.queryByLabelText('Пассивные ячейки')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Пассивные навыки' }));
  expect(screen.queryByLabelText('Активные навыки')).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('Пассивные ячейки')).getAllByText(/◇|Ур. 6/)).toHaveLength(2);
  expect(within(screen.getByLabelText('Пассивные навыки')).getAllByRole('button')).toHaveLength(4);
  expect(container.querySelector('[data-passive-id="blood_pressure"]')).toHaveAttribute('data-passive-state', 'unlocked');
  expect(container.querySelector('[data-passive-id="last_stand"]')).toHaveAttribute('data-passive-state', 'locked');
  fireEvent.click(screen.getByRole('button', { name: /Кровавый нажим/ }));
  const details = screen.getByRole('dialog', { name: 'Пассивный навык: Кровавый нажим' });
  expect(details).toHaveTextContent('Каждые 2 заряда');
  expect(details).toHaveTextContent('Открыт');
  expect(within(details).queryByRole('button', { name: /Изучить/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Экипировать в ячейку 1' }));
  expect(onUpdateClassProgression).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-passive-id="blood_pressure"][data-passive-state="active"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Снять' }));
  expect(container.querySelector('[data-passive-state="active"]')).not.toBeInTheDocument();
});

test('Defender Guild screen exposes level-driven skills, passives, and talent choices without purchase-era controls', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[7]).progression;
  const { container, onUpdateClassProgression } = renderClass(progression, 'Defender');

  expect(screen.getByRole('heading', { name: 'Защитник' })).toBeInTheDocument();
  expect(screen.getByText('Ур. 8')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Навыки класса')).getAllByRole('button')).toHaveLength(8);
  expect(container.querySelector('[data-skill-id="Ударная волна"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Таран"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Бросок щита"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Кровавый вызов"]')).toHaveAttribute('data-skill-state', 'locked');
  expect(container.querySelector('[data-skill-id="Кровавый вызов"]')).toHaveTextContent('🔒 Ур. 9');
  expect(screen.queryByText(/Очки класса|Разблокировать|Изучить —|бесплатно/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Пассивные навыки' }));
  ['blood_pressure','last_stand','retaliatory_assault','headlong'].forEach(id => {
    expect(container.querySelector(`[data-passive-id="${id}"]`)).toHaveAttribute('data-passive-state', 'unlocked');
  });
  expect(within(screen.getByLabelText('Пассивные ячейки')).getAllByText('◇')).toHaveLength(2);

  fireEvent.click(screen.getByRole('tab', { name: 'Активные навыки' }));
  fireEvent.click(within(screen.getByLabelText('Навыки класса')).getByRole('button', { name: /Стойкость/ }));
  const details = screen.getByRole('dialog', { name: 'Навык: Стойкость' });
  expect(within(details).getByText('Талант · открытие на Ур. 8')).toBeInTheDocument();
  expect(within(details).getByText('Несломленная воля')).toBeInTheDocument();
  expect(within(details).getByText('Боевая готовность')).toBeInTheDocument();
  expect(within(details).getAllByRole('button', { name: '[Печати защиты]' }).length).toBeGreaterThanOrEqual(1);
  expect(within(details).getAllByRole('button', { name: '[Щит]' }).length).toBeGreaterThanOrEqual(1);
  expect(within(details).getAllByRole('button', { name: 'Выбрать' })).toHaveLength(2);

  fireEvent.click(within(details).getAllByRole('button', { name: 'Выбрать' })[0]);
  expect(onUpdateClassProgression).toHaveBeenCalledTimes(1);
  expect(onUpdateClassProgression.mock.calls[0][0].Defender.talentSelections['defender.fortitude'])
    .toBe('defender.fortitude.unbroken_will');
});

test('Elementalist Guild screen exposes level-driven skills, passives, and talent choices without purchase-era controls', () => {
  const progression = grantClassExperience({}, 'Mage', CLASS_XP_THRESHOLDS[7]).progression;
  const { container, onUpdateClassProgression } = renderClass(progression, 'Mage');

  expect(screen.getByRole('heading', { name: 'Элементалист' })).toBeInTheDocument();
  expect(screen.getByText('Ур. 8')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Навыки класса')).getAllByRole('button')).toHaveLength(8);
  expect(container.querySelector('[data-skill-id="Буран"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Призыв элементаля"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Грозовой разряд"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Стихийное эхо"]')).toHaveAttribute('data-skill-state', 'locked');
  expect(container.querySelector('[data-skill-id="Стихийное эхо"]')).toHaveTextContent('🔒 Ур. 9');
  expect(screen.queryByText(/Очки класса|Разблокировать|Изучить —|бесплатно/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Пассивные навыки' }));
  ['lightning_speed','overheat','elemental_shell','elemental_resonance'].forEach(id => {
    expect(container.querySelector(`[data-passive-id="${id}"]`)).toHaveAttribute('data-passive-state', 'unlocked');
  });
  expect(within(screen.getByLabelText('Пассивные ячейки')).getAllByText('◇')).toHaveLength(2);
  fireEvent.click(container.querySelector('[data-passive-id="elemental_resonance"]'));
  const passiveDetails = screen.getByRole('dialog', { name: 'Пассивный навык: Стихийный резонанс' });
  expect(within(passiveDetails).getByRole('button', { name: '[Обугливание]' })).toBeInTheDocument();
  expect(within(passiveDetails).getByRole('button', { name: '[Ледяные осколки]' })).toBeInTheDocument();
  expect(within(passiveDetails).getByRole('button', { name: '[Заряд]' })).toBeInTheDocument();
  expect(within(passiveDetails).getByRole('button', { name: '[Проводимость]' })).toBeInTheDocument();
  fireEvent.click(within(passiveDetails).getByRole('button', { name: 'Закрыть' }));

  fireEvent.click(screen.getByRole('tab', { name: 'Активные навыки' }));
  fireEvent.click(within(screen.getByLabelText('Навыки класса')).getByRole('button', { name: /Призыв элементаля/ }));
  const details = screen.getByRole('dialog', { name: 'Навык: Призыв элементаля' });
  expect(within(details).getByText('Талант · открытие на Ур. 8')).toBeInTheDocument();
  expect(within(details).getByText('Великий огненный элементаль')).toBeInTheDocument();
  expect(within(details).getByText('Молниевый элементаль')).toBeInTheDocument();
  expect(within(details).getByText('Ледяной элементаль')).toBeInTheDocument();
  expect(within(details).getAllByRole('button', { name: 'Выбрать' })).toHaveLength(3);

  fireEvent.click(within(details).getAllByRole('button', { name: 'Выбрать' })[1]);
  expect(onUpdateClassProgression).toHaveBeenCalledTimes(1);
  expect(onUpdateClassProgression.mock.calls[0][0].Mage.talentSelections['mage.summon_elemental'])
    .toBe('mage.summon_elemental.lightning');
});

test('Archer Guild screen exposes level-driven skills, passives, and talent choices without purchase-era controls', () => {
  const progression = grantClassExperience({}, 'Archer', CLASS_XP_THRESHOLDS[7]).progression;
  const { container, onUpdateClassProgression } = renderClass(progression, 'Archer');

  expect(screen.getByRole('heading', { name: 'Лучник' })).toBeInTheDocument();
  expect(screen.getByText('Ур. 8')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Навыки класса')).getAllByRole('button')).toHaveLength(8);
  expect(container.querySelector('[data-skill-id="Волчья яма"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Перенаправление"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Залп стрел"]')).toHaveAttribute('data-skill-state', 'unlocked');
  expect(container.querySelector('[data-skill-id="Змеиная ловушка"]')).toHaveAttribute('data-skill-state', 'locked');
  expect(container.querySelector('[data-skill-id="Змеиная ловушка"]')).toHaveTextContent('🔒 Ур. 9');
  expect(screen.queryByText(/Очки класса|Разблокировать|Изучить —|бесплатно/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Пассивные навыки' }));
  expect(within(screen.getByLabelText('Пассивные навыки')).getAllByRole('button')).toHaveLength(4);
  ['finish_the_prey','initiative','false_trail','hunting_rhythm'].forEach(id => {
    expect(container.querySelector(`[data-passive-id="${id}"]`)).toHaveAttribute('data-passive-state', 'unlocked');
  });
  expect(within(screen.getByLabelText('Пассивные ячейки')).getAllByText('◇')).toHaveLength(2);

  fireEvent.click(screen.getByRole('tab', { name: 'Активные навыки' }));
  const fireArrow = within(screen.getByLabelText('Навыки класса')).getByRole('button', { name: /Огненная стрела/ });
  fireEvent.click(fireArrow);

  const details = screen.getByRole('dialog', { name: 'Навык: Огненная стрела' });
  expect(within(details).getByText('Талант · открытие на Ур. 8')).toBeInTheDocument();
  expect(within(details).getByText('Смоляная стрела')).toBeInTheDocument();
  expect(within(details).getByText('Взрывная стрела')).toBeInTheDocument();
  expect(within(details).getByRole('button', { name: '[Замедление]' })).toBeInTheDocument();
  expect(within(details).getByRole('button', { name: '[Обугливание]' })).toBeInTheDocument();
  expect(within(details).getByRole('button', { name: '[Горение]' })).toBeInTheDocument();
  expect(within(details).getAllByRole('button', { name: 'Выбрать' })).toHaveLength(2);
  expect(within(details).queryByText(/бесплатно|очк/i)).not.toBeInTheDocument();

  fireEvent.click(within(details).getAllByRole('button', { name: 'Выбрать' })[0]);
  expect(onUpdateClassProgression).toHaveBeenCalledTimes(1);
  const updated = onUpdateClassProgression.mock.calls[0][0];
  expect(updated.Archer.talentSelections['archer.fire_arrow']).toBe('archer.fire_arrow.tar_arrow');
});

test('switching loadout mode during a drag cancels the preview without mutation', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[3]).progression;
  const { container, onUpdateClassProgression } = renderClass(progression);
  const source = container.querySelector('[data-active-slot-index="0"]');
  pointer(source,'pointerDown',10,10); pointer(window,'pointerMove',20,10);
  expect(container.querySelector('.class-skill-drag-preview')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:'Пассивные навыки'}));
  expect(container.querySelector('.class-skill-drag-preview')).not.toBeInTheDocument();
  expect(onUpdateClassProgression).not.toHaveBeenCalled();
});

test('passive pointer drag uses geometric hit testing, square fallback tiles, and exact passive slots', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[7]).progression;
  progression.Defender.equippedPassiveIds = ['blood_pressure', 'last_stand'];
  const { container, onUpdateClassProgression } = renderClass(progression);
  fireEvent.click(screen.getByRole('tab', { name: 'Пассивные навыки' }));
  const slots = within(screen.getByLabelText('Пассивные ячейки')).getAllByRole('button');
  expect(slots).toHaveLength(2);
  slots.forEach(slot => expect(slot).toHaveClass('is-loadout-slot'));
  expect(container.querySelectorAll('.guild-class-progression__passives .class-skill-art')).toHaveLength(4);
  expect(container.querySelector('.guild-class-progression__passives').textContent).not.toContain('blood_pressure');

  const elementFromPoint = document.elementFromPoint;
  document.elementFromPoint = jest.fn(() => slots[1]);
  pointer(slots[0], 'pointerDown', 10, 10);
  pointer(slots[0], 'pointerMove', 20, 10);
  expect(slots[0]).toHaveClass('is-drag-source');
  expect(slots[1]).toHaveClass('is-hovered-drop-target');
  expect(container.querySelector('.class-skill-drag-preview .class-skill-art')).toBeInTheDocument();
  pointer(slots[0], 'pointerUp', 20, 10);
  document.elementFromPoint = elementFromPoint;
  const swapped = onUpdateClassProgression.mock.calls[0][0];
  expect(swapped.Defender.equippedPassiveIds).toEqual(['last_stand', 'blood_pressure']);
});
