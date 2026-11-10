import { BAIT_BONUSES, createFishingChallenge, FISHING_ROD_BONUSES } from './fishing';

test('legacy hook/tap bonuses migrate to control while luck and rewards remain active', () => {
  expect(FISHING_ROD_BONUSES['Костяная удочка']).toEqual({ controlBonus: 0.06, luck: 0.02 });
  expect(BAIT_BONUSES['Светлячный мотыль'].luck).toBe(0.03);
  const challenge = createFishingChallenge('Гоблинские Норы', { rod: 'Костяная удочка', bait: 'Светлячный мотыль' });
  expect(challenge.controlBonus).toBeCloseTo(0.08);
  expect(challenge.calmDurationBonusMs).toBe(60);
  expect(challenge.rewards).toEqual({ fishItem: challenge.fish.name, silver: challenge.fish.value });
});
