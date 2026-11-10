export const pluralizeRussianCount = (value, forms) => {
  const count = Math.abs(Number(value) || 0);
  const mod100 = count % 100;
  const mod10 = count % 10;
  const form = mod100 >= 11 && mod100 <= 14
    ? forms[2]
    : mod10 === 1
      ? forms[0]
      : mod10 >= 2 && mod10 <= 4
        ? forms[1]
        : forms[2];
  return `${value} ${form}`;
};

export const formatTurns = value => pluralizeRussianCount(value, ['ход', 'хода', 'ходов']);
