import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TrapDisarmModal from './TrapDisarmModal';
let callback;
let time;
beforeEach(() => {
  time = 0;
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { callback = fn; return 1; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const frame = delta => { time += delta; act(() => callback(time)); };
const start = () => { fireEvent.click(screen.getByRole('button', { name: 'Начать обезвреживание' })); frame(0); };
const hit = () => fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать сектор' }));
test('duplicate fails immediately and resolves once', () => {
  const onResolve = jest.fn();
  render(<TrapDisarmModal onResolve={onResolve} onCancel={jest.fn()} />);
  start(); hit(); hit();
  expect(screen.getByRole('status')).toHaveTextContent('Ловушка сработала');
  const button = screen.getByRole('button', { name: 'К бою' });
  fireEvent.click(button); fireEvent.click(button);
  expect(onResolve).toHaveBeenCalledTimes(1);
  expect(onResolve).toHaveBeenCalledWith({ method: 'sectors', success: false });
});
test('pointerdown plus compatibility click counts once; pointercancel is harmless', () => {
  render(<TrapDisarmModal onResolve={jest.fn()} />); start();
  const button = screen.getByRole('button', { name: 'Зафиксировать сектор' });
  fireEvent.pointerDown(button, { pointerId: 1, button: 0, isPrimary: true });
  fireEvent.click(button, { detail: 1 });
  fireEvent.pointerCancel(button);
  expect(screen.getByRole('status')).toHaveTextContent('Обезврежено: 1/8');
});
test('waiting has no deadline, all eight hits succeed and produce one result', () => {
  const onResolve = jest.fn();
  render(<TrapDisarmModal onResolve={onResolve} challenge={{ metalReward: 'Сумрачный сплав', metalQuantity: 2 }} />);
  start(); frame(30000); hit();
  for (const delta of [750, 600, 500, 400, 350, 200, 160]) { frame(delta); hit(); }
  expect(screen.getByRole('status')).toHaveTextContent('Ловушка обезврежена');
  fireEvent.click(screen.getByRole('button', { name: 'Забрать материалы' }));
  expect(onResolve).toHaveBeenCalledWith({ method: 'sectors', success: true });
});
test('blur pauses without consuming a sector, resume does not jump and unmount cancels animation', () => {
  const view = render(<TrapDisarmModal onResolve={jest.fn()} />); start(); frame(400);
  const angle = screen.getByTestId('trap-needle').getAttribute('transform');
  fireEvent(window, new Event('blur')); frame(9000);
  expect(screen.getByTestId('trap-needle')).toHaveAttribute('transform', angle);
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' })); frame(10000);
  expect(screen.getByTestId('trap-needle')).toHaveAttribute('transform', angle);
  expect(screen.getByRole('status')).toHaveTextContent('Обезврежено: 0/8');
  view.unmount(); expect(window.cancelAnimationFrame).toHaveBeenCalled();
});
