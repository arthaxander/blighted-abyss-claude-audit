import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ProgressionFeedback, { PROGRESSION_FEEDBACK_TIMING } from './ProgressionFeedback';
import ClassRewardFeedback, { CLASS_REWARD_FEEDBACK_TIMING, createClassRewardEvent } from './ClassRewardFeedback';

const ordinary = {
  classResult: { xpGained: 100, oldLevel: 2, newLevel: 2, levelsGained: 0, oldXpWithinLevel: 10, newXpWithinLevel: 110, oldXpRequired: 150, newXpRequired: 150, classPointsGained: 0, newlyAvailableSkills: [] },
  relicXp: 0,
};
const levelUp = {
  classResult: { xpGained: 100, oldLevel: 2, newLevel: 3, levelsGained: 1, oldXpWithinLevel: 100, newXpWithinLevel: 50, oldXpRequired: 150, newXpRequired: 200, classPointsGained: 1, newlyAvailableSkills: ['Ударная волна'] },
  relicXp: 0,
};

const BossSequenceHarness = ({ event }) => {
  const meaningful = Boolean(event?.classResult || event?.relicXp > 0);
  const [feedback, setFeedback] = useState(meaningful ? event : null);
  const [pendingReward, setPendingReward] = useState(createClassRewardEvent(event?.classResult));
  const [reward, setReward] = useState(null);
  const [bossOpen, setBossOpen] = useState(!meaningful);
  const [choices, setChoices] = useState(0);
  return <>
    <ProgressionFeedback event={feedback} onClose={() => { setFeedback(null); if (pendingReward) { setReward(pendingReward); setPendingReward(null); } else setBossOpen(true); }} />
    <ClassRewardFeedback event={reward} onClose={() => { setReward(null); setBossOpen(true); }} />
    {bossOpen && <div role="dialog" aria-label="Босс повержен"><button type="button" onClick={() => setChoices(value => value + 1)}>Спуститься глубже</button><output aria-label="Выбор босса">{choices}</output></div>}
  </>;
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('ordinary boss progression completes before the decision mounts and discarded input is not replayed', () => {
  render(<BossSequenceHarness event={ordinary} />);
  expect(screen.getByLabelText('Получен опыт').parentElement).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Босс повержен' })).not.toBeInTheDocument();
  fireEvent.click(document.body);
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.ordinaryLifetime - 1));
  expect(screen.queryByRole('dialog', { name: 'Босс повержен' })).not.toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1));
  expect(document.querySelector('.progression-feedback-layer')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Босс повержен' })).toBeInTheDocument();
  expect(screen.getByLabelText('Выбор босса')).toHaveTextContent('0');
  fireEvent.click(screen.getByRole('button', { name: 'Спуститься глубже' }));
  expect(screen.getByLabelText('Выбор босса')).toHaveTextContent('1');
});

test('Class Level Up holds the boss decision through XP and follow-up reward completion', () => {
  render(<BossSequenceHarness event={levelUp} />);
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.ordinaryLifetime));
  expect(screen.getByLabelText('Получен опыт').parentElement).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Босс повержен' })).not.toBeInTheDocument();
  act(() => jest.advanceTimersByTime(PROGRESSION_FEEDBACK_TIMING.levelUpLifetime - PROGRESSION_FEEDBACK_TIMING.ordinaryLifetime));
  expect(document.querySelector('.progression-feedback-layer')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Новые возможности')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Босс повержен' })).not.toBeInTheDocument();
  fireEvent.click(document.body);
  act(() => jest.advanceTimersByTime(CLASS_REWARD_FEEDBACK_TIMING.lifetime));
  expect(document.querySelector('.class-reward-feedback-layer')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Босс повержен' })).toBeInTheDocument();
  expect(screen.getByLabelText('Выбор босса')).toHaveTextContent('0');
});

test('max/max suppression presents the boss decision immediately without an artificial timer', () => {
  render(<BossSequenceHarness event={{ classResult: null, relicXp: 0 }} />);
  expect(document.querySelector('.progression-feedback-layer')).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Босс повержен' })).toBeInTheDocument();
  expect(jest.getTimerCount()).toBe(0);
});
