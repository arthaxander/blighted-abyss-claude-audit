import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ClassRewardFeedback, { CLASS_REWARD_FEEDBACK_TIMING, createClassRewardEvent } from './ClassRewardFeedback';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('one Guild-accent reward card presents skill and points for exactly 2000ms', () => {
  const onClose = jest.fn();
  const event = createClassRewardEvent({ levelsGained: 2, newlyAvailableSkills: ['Ударная волна'], classPointsGained: 2 });
  render(<ClassRewardFeedback event={event} onClose={onClose} />);
  expect(screen.getByLabelText('Новые возможности')).toHaveClass('guild-accent-panel');
  expect(screen.getByText('Ударная волна')).toBeInTheDocument();
  expect(screen.getByText('Доступен для изучения в Гильдии')).toBeInTheDocument();
  expect(screen.getByText('+2 очка класса')).toBeInTheDocument();
  expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('draggable', 'false');
  act(() => jest.advanceTimersByTime(CLASS_REWARD_FEEDBACK_TIMING.holdEnd));
  expect(screen.getByRole('status')).toHaveAttribute('data-phase', 'exiting');
  act(() => jest.advanceTimersByTime(CLASS_REWARD_FEEDBACK_TIMING.lifetime - CLASS_REWARD_FEEDBACK_TIMING.holdEnd));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('point-only reward has no empty skill placeholder and discards input', () => {
  const action = jest.fn();
  const event = createClassRewardEvent({ levelsGained: 1, newlyAvailableSkills: [], classPointsGained: 1 });
  render(<><button onClick={action}>Под карточкой</button><ClassRewardFeedback event={event} onClose={jest.fn()} /></>);
  expect(screen.getByText('+1 очко класса')).toBeInTheDocument();
  expect(document.querySelector('.class-reward-feedback__skill')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Под карточкой' }));
  expect(action).not.toHaveBeenCalled();
});

test('ordinary or empty progression creates no class reward event', () => {
  expect(createClassRewardEvent({ levelsGained: 0, classPointsGained: 1, newlyAvailableSkills: ['Таран'] })).toBeNull();
  expect(createClassRewardEvent({ levelsGained: 1, classPointsGained: 0, newlyAvailableSkills: [] })).toBeNull();
});

test('Level 4, 6, 8 and multi-level passive rewards aggregate in one card', () => {
  const level4=createClassRewardEvent({classId:'Defender',levelsGained:1,newlyAvailableSkills:[],newlyAvailablePassives:['blood_pressure','last_stand'],newlyUnlockedPassiveSlots:[1],classPointsGained:1});
  const {rerender}=render(<ClassRewardFeedback event={level4} onClose={jest.fn()}/>);
  expect(screen.getByText('Открыт слот пассивного навыка')).toBeInTheDocument(); expect(screen.getByText('Кровавый нажим')).toBeInTheDocument(); expect(screen.getByText('Последний рубеж')).toBeInTheDocument(); expect(document.querySelectorAll('.class-reward-feedback__skill.is-passive img')).toHaveLength(2); expect(screen.getByText('+1 очко класса')).toBeInTheDocument();
  const level6=createClassRewardEvent({classId:'Defender',levelsGained:1,newlyAvailablePassives:['retaliatory_assault'],classPointsGained:1}); rerender(<ClassRewardFeedback event={level6} onClose={jest.fn()}/>); expect(screen.getByText('Ответный натиск')).toBeInTheDocument();
  const level8=createClassRewardEvent({classId:'Defender',levelsGained:1,newlyAvailablePassives:['headlong'],newlyUnlockedPassiveSlots:[2],classPointsGained:1}); rerender(<ClassRewardFeedback event={level8} onClose={jest.fn()}/>); expect(screen.getByText('Открыт второй слот пассивного навыка')).toBeInTheDocument(); expect(screen.getByText('Напролом')).toBeInTheDocument();
  const multi=createClassRewardEvent({classId:'Defender',levelsGained:5,newlyAvailableSkills:['Таран'],newlyAvailablePassives:['blood_pressure','last_stand','retaliatory_assault','headlong'],newlyUnlockedPassiveSlots:[1,2],classPointsGained:5}); expect(multi.passiveSkills).toHaveLength(4); expect(multi.passiveSlots).toEqual([1,2]);
});
