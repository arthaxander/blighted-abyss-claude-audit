import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import RelicResonanceTransfer, { RELIC_RESONANCE_TRANSFER_DURATION } from './RelicResonanceTransfer';

test('Resonance transfer drains to zero before Guild continuation', () => {
  let frame; const originalRaf=global.requestAnimationFrame; const originalCancel=global.cancelAnimationFrame; const originalPerformance=global.performance;
  global.requestAnimationFrame=cb=>{ frame=cb; return 1; }; global.cancelAnimationFrame=jest.fn(); Object.defineProperty(global,'performance',{configurable:true,value:{now:()=>0}});
  const onComplete=jest.fn();
  render(<RelicResonanceTransfer transfer={{relicId:'recruit_seal',amount:125,oldProgress:{level:0,xp:0},newProgress:{level:1,xp:25}}} onComplete={onComplete}/>);
  expect(screen.getByText('125')).toBeInTheDocument(); expect(screen.getByRole('button',{name:'Продолжить'})).toBeDisabled();
  act(()=>frame(RELIC_RESONANCE_TRANSFER_DURATION/2)); expect(screen.getByText('63')).toBeInTheDocument();
  act(()=>frame(RELIC_RESONANCE_TRANSFER_DURATION)); expect(screen.getByText('0')).toBeInTheDocument(); expect(screen.getByText('Уровень 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Продолжить'})); expect(onComplete).toHaveBeenCalledTimes(1);
  global.requestAnimationFrame=originalRaf; global.cancelAnimationFrame=originalCancel; Object.defineProperty(global,'performance',{configurable:true,value:originalPerformance});
});
