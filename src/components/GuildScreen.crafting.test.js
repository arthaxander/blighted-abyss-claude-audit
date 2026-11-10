import React, { act } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { UIProvider } from '../contexts/UIContext';
import GuildScreen from './GuildScreen';

const player={name:'Герой',class:'Defender',equipment:{},runInventory:[],questLog:{},relics:{},silver:0};
const openCraft=(storageItems,onUpdateStorage=jest.fn())=>{render(<UIProvider><GuildScreen player={player} storageItems={storageItems} onUpdatePlayer={jest.fn()} onUpdateStorage={onUpdateStorage}/></UIProvider>);fireEvent.click(screen.getByRole('button',{name:'Крафт'}));return onUpdateStorage;};
describe('Guild crafting presentation',()=>{
  afterEach(()=>jest.useRealTimers());
  test('stackable craft has clean accessible art, quantity controls, total cost and blocking feedback',()=>{
    jest.useFakeTimers(); const update=openCraft([
      ...Array(5).fill('Простая склянка'),...Array(10).fill('Кровяной мох'),
    ]);
    const row=screen.getAllByTestId('recipe-cell').find(node=>node.textContent.includes('Малое зелье здоровья'));
    const art=within(row).getByRole('button',{name:'Подробнее: Малое зелье здоровья'});
    expect(art).not.toHaveTextContent(/Можно|Малое зелье здоровья/);
    const craft=within(row).getByRole('button',{name:'Создать: Малое зелье здоровья'});
    fireEvent.click(craft);
    const dialog=screen.getByRole('dialog',{name:'Количество: Малое зелье здоровья'});
    const input=within(dialog).getByRole('spinbutton',{name:'Количество'});
    expect(input).toHaveValue(1); fireEvent.click(within(dialog).getByRole('button',{name:'Увеличить'})); expect(input).toHaveValue(2);
    fireEvent.click(within(dialog).getByRole('button',{name:'Макс'})); expect(input).toHaveValue(5);
    expect(dialog).toHaveTextContent('5 / 5'); expect(dialog).toHaveTextContent('10 / 10');
    fireEvent.click(within(dialog).getByRole('button',{name:'Создать ×5'}));
    expect(update).toHaveBeenCalledTimes(1); expect(screen.getByRole('status',{name:/Создано: Малое зелье здоровья, 5 шт/})).toHaveTextContent('×5');
    fireEvent.click(craft); expect(update).toHaveBeenCalledTimes(1);
    act(()=>jest.advanceTimersByTime(800)); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('non-stackable equipment crafts exactly once without quantity dialog',()=>{
    jest.useFakeTimers(); const update=openCraft([
      ...Array(4).fill('Обрывки кожи'),...Array(2).fill('Металлические обломки'),
    ]);
    const row=screen.getAllByTestId('recipe-cell').find(node=>node.textContent.includes('Укреплённые поножи'));
    const button=within(row).getByRole('button',{name:'Создать: Укреплённые поножи'});
    fireEvent.click(button); fireEvent.click(button);
    expect(screen.queryByRole('dialog',{name:/Количество/})).not.toBeInTheDocument(); expect(update).toHaveBeenCalledTimes(1);
  });

  test('disabled recipe does not transact and filters remain available',()=>{
    const update=openCraft([]); const row=screen.getAllByTestId('recipe-cell')[0];
    expect(within(row).getByRole('button',{name:/Создать:/})).toBeDisabled(); fireEvent.click(within(row).getByRole('button',{name:/Создать:/})); expect(update).not.toHaveBeenCalled();
    ['Все','Расходники','Снаряжение','Руны'].forEach(name=>expect(screen.getByRole('tab',{name})).toBeInTheDocument());
  });

  test('result and ingredient art inspect items while only the hammer opens crafting',()=>{
    const update=openCraft([]);
    const row=screen.getAllByTestId('recipe-cell').find(node=>node.textContent.includes('Малое зелье здоровья'));
    const resultArt=within(row).getByRole('button',{name:'Подробнее: Малое зелье здоровья'});
    fireEvent.click(resultArt);
    expect(screen.getByRole('dialog',{name:'Предмет: Малое зелье здоровья'})).toBeInTheDocument();
    expect(screen.queryByRole('dialog',{name:/Количество:/})).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Закрыть'}));
    fireEvent.click(within(row).getByRole('button',{name:'Подробнее: Простая склянка'}));
    expect(screen.getByRole('dialog',{name:'Предмет: Простая склянка'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Закрыть'}));
    expect(within(row).getByRole('button',{name:'Создать: Малое зелье здоровья'})).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
  });
});
