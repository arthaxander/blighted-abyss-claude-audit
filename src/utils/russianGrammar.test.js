import { formatTurns } from './russianGrammar';

test.each([[1, '1 ход'], [2, '2 хода'], [4, '4 хода'], [5, '5 ходов'], [11, '11 ходов'], [21, '21 ход'], [22, '22 хода']])(
  'formats %i with the correct Russian turn form',
  (value, expected) => expect(formatTurns(value)).toBe(expected)
);
