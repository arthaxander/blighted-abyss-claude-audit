import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CompactStatusList from './CompactStatusList';

describe('CompactStatusList prepared weapon help', () => {
  test('Prepared Weapon opens the source item description stored on the effect instance', () => {
    render(<CompactStatusList effects={[{
      id: 'prepared_weapon',
      extra: {
        sourceItemName: 'Настой горькой живицы',
        preparedDescription: 'Настой горькой живицы: Следующая успешная прямая атака накладывает Отравление на 2 хода.',
      },
    }]} />);

    fireEvent.click(screen.getByRole('button', { name: '[Подготовленное оружие]' }));

    const help = screen.getByRole('dialog', { name: 'Статус: Подготовленное оружие' });
    expect(help).toHaveTextContent('Настой горькой живицы');
    expect(help).toHaveTextContent('Следующая успешная прямая атака накладывает Отравление на 2 хода.');
  });


  test('shared Preparation can show the concrete delayed action description', () => {
    render(<CompactStatusList effects={[{
      id: 'preparation',
      extra: {
        kind: 'defender_ram',
        preparedDescription: 'Таран: в начале следующего хода Защитник атакует всех живых врагов.',
      },
    }]} />);

    fireEvent.click(screen.getByRole('button', { name: '[Подготовка]' }));

    const help = screen.getByRole('dialog', { name: 'Статус: Подготовка' });
    expect(help).toHaveTextContent('Таран');
    expect(help).toHaveTextContent('в начале следующего хода Защитник атакует всех живых врагов');
  });
});
