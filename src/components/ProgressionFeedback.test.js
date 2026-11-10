import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ProgressionFeedback, { PROGRESSION_FEEDBACK_TIMING } from './ProgressionFeedback';
import { getRelicById } from '../data/relics';

const ordinaryClassResult = {
  xpGained: 25, oldLevel: 2, newLevel: 2, levelsGained: 0,
  oldXpWithinLevel: 30, newXpWithinLevel: 55, oldXpRequired: 150, newXpRequired: 150,
  statGains: {},
  newlyAvailableSkills: [], newlyAvailablePassives: [], newlyUnlockedPassiveSlots: [], newlyAvailableTalents: [],
};
const levelUpClassResult = {
  xpGained: 275, oldLevel: 1, newLevel: 3, levelsGained: 2,
  oldXpWithinLevel: 0, newXpWithinLevel: 25, oldXpRequired: 100, newXpRequired: 200,
  statGains: { maxHp: 10, attack: 1, physDef: 1 },
  newlyAvailableSkills: ['Ударная волна'],
  newlyAvailablePassives: ['blood_pressure', 'retaliatory_assault'],
  newlyUnlockedPassiveSlots: [1],
  newlyAvailableTalents: [],
};
const relicEvent = { relicId: 'blood_amulet', relicXp: 6, relicLevel: 2, relicOldXp: 66, relicNewXp: 72, relicRequired: 100 };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('zero/no progression event renders no feedback', () => {
  const { container } = render(<ProgressionFeedback event={null} onClose={jest.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

test('class progression label follows the authoritative awarded class', () => {
  render(<ProgressionFeedback event={{ classResult: { ...ordinaryClassResult, classId: 'Mage' }, relicXp: 0 }} onClose={jest.fn()} />);
  expect(screen.getByLabelText('Элементалист: прогресс')).toBeInTheDocument();
  expect(screen.queryByLabelText('Защитник: прогресс')).not.toBeInTheDocument();
});

test('ordinary feedback follows the centralized 250/1000/1900/2150 timeline', () => {
  const onClose = jest.fn();
  render(<ProgressionFeedback event={{ classResult: ordinaryClassResult, ...relicEvent }} onClose={onClose} />);
  const layer = screen.getByRole('status');
  expect(screen.getByLabelText('Получен опыт')).toHaveAttribute('data-anchor-vh', '42.5');
  expect(layer).toHaveAttribute('data-phase', 'appearing');
  expect(screen.getByLabelText('Защитник: прогресс').firstChild).toHaveStyle('width: 20%');
  expect(screen.getByLabelText('Кровавый Амулет: прогресс').firstChild).toHaveStyle('width: 66%');
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.appear));
  expect(layer).toHaveAttribute('data-phase', 'animating');
  expect(screen.getByLabelText('Защитник: прогресс').firstChild).toHaveStyle(`width: ${(55 / 150) * 100}%`);
  expect(screen.getByLabelText('Кровавый Амулет: прогресс').firstChild).toHaveStyle('width: 72%');
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.progress));
  expect(layer).toHaveAttribute('data-phase', 'settled');
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.ordinaryHoldEnd - PROGRESSION_FEEDBACK_TIMING.progressEnd - 1));
  expect(layer).toHaveAttribute('data-phase', 'settled'); expect(onClose).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(layer).toHaveAttribute('data-phase', 'exiting');
  act(() => jest.advanceTimersByTime(249)); expect(onClose).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1)); expect(onClose).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(400)); expect(onClose).toHaveBeenCalledTimes(1);
});

test('canonical relic name is primary, raw ID is hidden, and unknown relic uses localized fallback', () => {
  const authored = getRelicById('blood_amulet');
  const { rerender } = render(<ProgressionFeedback event={{ classResult: null, ...relicEvent }} onClose={jest.fn()} />);
  expect(screen.getByText((_, element) => element.tagName === 'STRONG' && element.textContent === `${authored.name} · Ур. 2`)).toBeInTheDocument();
  expect(screen.queryByText((_, element) => element.tagName === 'STRONG' && element.textContent === 'Реликвия · Ур. 2')).not.toBeInTheDocument(); expect(screen.queryByText('blood_amulet')).not.toBeInTheDocument();
  rerender(<ProgressionFeedback event={{ ...relicEvent, relicId: 'internal_missing_relic' }} onClose={jest.fn()} />);
  expect(screen.getByText((_, element) => element.tagName === 'STRONG' && element.textContent === 'Реликвия · Ур. 2')).toBeInTheDocument(); expect(screen.queryByText('internal_missing_relic')).not.toBeInTheDocument();
});

test('level-up feedback shows real unlocks and compresses overflow into the 2800ms lifetime', () => {
  const onClose = jest.fn();
  render(<ProgressionFeedback event={{ classResult: levelUpClassResult, ...relicEvent }} onClose={onClose} />);
  const layer = screen.getByRole('status');
  const classRow = document.querySelector('[data-progression-kind="class"]');
  const relicRow = document.querySelector('[data-progression-kind="relic"]');
  expect(classRow).toHaveTextContent('Защитник · Ур. 1');
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.levelUpThreshold));
  expect(layer).toHaveAttribute('data-phase', 'level-up-emphasis');
  expect(classRow).toHaveClass('is-level-up-emphasis');
  expect(relicRow).not.toHaveClass('is-level-up-emphasis');
  expect(classRow).toHaveTextContent('Защитник · Ур. 3');
  expect(classRow.querySelector('.progression-feedback__level-number')).toHaveClass('is-prominent');
  expect(classRow).not.toHaveTextContent('Уровень класса повышен');
  expect(classRow.querySelector('.progression-feedback__level-up-beat')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Защитник: прогресс').firstChild).toHaveStyle('width: 100%');
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.levelUpEmphasis));
  expect(layer).toHaveAttribute('data-phase', 'overflow');
  expect(classRow).toHaveTextContent('Защитник · Ур. 3');
  expect(screen.getByLabelText('Защитник: прогресс').firstChild).toHaveStyle('width: 12.5%');
  expect(screen.queryByText(/Уровень класса повышен — 3/)).not.toBeInTheDocument();
  expect(screen.queryByText(/очк.*класса/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Новые возможности')).toHaveTextContent('Характеристики: Макс. HP +10, Атака +1, Физ. защита +1');
  expect(screen.getByLabelText('Новые возможности')).toHaveTextContent('Новый навык: Ударная волна');
  expect(screen.getByLabelText('Новые возможности')).toHaveTextContent('Новая пассивка: Кровавый нажим');
  expect(screen.getByLabelText('Новые возможности')).toHaveTextContent('Новая пассивка: Ответный натиск');
  expect(screen.getByLabelText('Новые возможности')).toHaveTextContent('Открыта пассивная ячейка 1');
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.ordinaryLifetime - PROGRESSION_FEEDBACK_TIMING.levelUpOverflow));
  expect(layer).toBeInTheDocument(); expect(onClose).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.levelUpHoldEnd - PROGRESSION_FEEDBACK_TIMING.ordinaryLifetime));
  expect(layer).toHaveAttribute('data-phase', 'exiting'); expect(onClose).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(250)); expect(onClose).toHaveBeenCalledTimes(1);
});

test('level-up feedback localizes passive names and includes newly unlocked talent choices without internal IDs', () => {
  const result = {
    ...levelUpClassResult,
    classId: 'Archer',
    oldLevel: 3,
    newLevel: 4,
    levelsGained: 1,
    newlyAvailableSkills: [],
    newlyAvailablePassives: [],
    newlyUnlockedPassiveSlots: [],
    newlyAvailableTalents: ['Зазубренная стрела'],
  };
  render(<ProgressionFeedback event={{ classResult: result, relicXp: 0 }} onClose={jest.fn()} />);
  const unlocks = screen.getByLabelText('Новые возможности');
  expect(unlocks).toHaveTextContent('Доступен талант: Зазубренная стрела');
  expect(unlocks.textContent).not.toContain('archer.');
});

test('stat-only Archer level-up still shows what improved', () => {
  const result = {
    ...levelUpClassResult,
    classId: 'Archer',
    oldLevel: 10,
    newLevel: 11,
    levelsGained: 1,
    statGains: { maxHp: 3, physDef: 1 },
    newlyAvailableSkills: [],
    newlyAvailablePassives: [],
    newlyUnlockedPassiveSlots: [],
    newlyAvailableTalents: [],
  };
  render(<ProgressionFeedback event={{ classResult: result, relicXp: 0 }} onClose={jest.fn()} />);
  const unlocks = screen.getByLabelText('Новые возможности');
  expect(unlocks).toHaveTextContent('Характеристики: Макс. HP +3, Физ. защита +1');
});

test('ordinary XP feedback renders no empty unlock block', () => {
  render(<ProgressionFeedback event={{ classResult: ordinaryClassResult, relicXp: 0 }} onClose={jest.fn()} />);
  expect(screen.queryByLabelText('Новые возможности')).not.toBeInTheDocument();
});

test('meaningless max/max event is suppressed while either meaningful progression row renders alone', () => {
  const onClose = jest.fn();
  const { rerender } = render(<ProgressionFeedback event={{ classResult: null, relicXp: 0 }} onClose={onClose} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.ordinaryLifetime));
  expect(onClose).not.toHaveBeenCalled();
  rerender(<ProgressionFeedback event={{ classResult: null, ...relicEvent }} onClose={onClose} />);
  expect(screen.queryByLabelText('Защитник: прогресс')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Кровавый Амулет: прогресс')).toBeInTheDocument();
  rerender(<ProgressionFeedback event={{ classResult: ordinaryClassResult, relicXp: 0 }} onClose={onClose} />);
  expect(screen.getByLabelText('Защитник: прогресс')).toBeInTheDocument();
  expect(screen.queryByLabelText('Кровавый Амулет: прогресс')).not.toBeInTheDocument();
});

test('active feedback blocks and discards navigation input until a new post-close click', () => {
  const navigate = jest.fn(); const onClose = jest.fn();
  const Harness = ({ event }) => <><button type="button" onClick={navigate}>Следующая комната</button><ProgressionFeedback event={event} onClose={onClose} /></>;
  const { rerender } = render(<Harness event={{ classResult: ordinaryClassResult, relicXp: 0 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Следующая комната' })); expect(navigate).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.ordinaryLifetime));
  expect(onClose).toHaveBeenCalledTimes(1); expect(navigate).not.toHaveBeenCalled();
  rerender(<Harness event={null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Следующая комната' })); expect(navigate).toHaveBeenCalledTimes(1);
});
