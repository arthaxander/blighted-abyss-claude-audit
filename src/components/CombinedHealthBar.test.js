import React, { act } from 'react';
import { render, screen } from '@testing-library/react';
import { COMBAT_PRESENTATION_TIMING } from '../utils/combatPresentationEvents';
import { CombinedHealthBar } from './CombatScreen';

describe('CombinedHealthBar preparation presentation', () => {
  test('normalizes durability inside the existing health geometry and removes it without a row', () => {
    const { container, rerender } = render(<CombinedHealthBar unit={{ hp: 100, maxHp: 100, shield: 0, _preparation: { durability: 40, maxDurability: 80 } }} />);
    expect(screen.getByTestId('preparation-health-layer')).toHaveStyle({ width: '50%' });
    expect(container.querySelector('.preparation-durability')).not.toBeInTheDocument();
    rerender(<CombinedHealthBar unit={{ hp: 100, maxHp: 100, shield: 0, _preparation: null }} />);
    expect(screen.queryByTestId('preparation-health-layer')).not.toBeInTheDocument();
    expect(container.querySelector('.combined-health')).toBeInTheDocument();
  });

  test('holds a short trailing HP slice after damage and then lets it catch up', () => {
    jest.useFakeTimers();
    const { rerender } = render(<CombinedHealthBar unit={{ hp: 100, maxHp: 100, shield: 0 }} />);
    rerender(<CombinedHealthBar unit={{ hp: 60, maxHp: 100, shield: 0 }} />);
    expect(screen.getByTestId('health-damage-trail')).toHaveStyle({ left: '60%', width: '40%' });
    act(() => jest.advanceTimersByTime(COMBAT_PRESENTATION_TIMING.healthTrailDelay));
    expect(screen.queryByTestId('health-damage-trail')).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  test('renders shield contact and shield break as separate bar reactions', () => {
    const impactEvents = [
      { id: 'shield-hit', type: 'shieldAbsorbed', at: 120, amount: 12 },
      { id: 'shield-break', type: 'shieldAbsorbed', at: 480, amount: 20, shieldBroken: true },
    ];
    const { container } = render(<CombinedHealthBar unit={{ hp: 100, maxHp: 100, shield: 0 }} impactEvents={impactEvents} />);
    const impacts = container.querySelectorAll('.health-shield-impact');
    expect(impacts).toHaveLength(2);
    expect(impacts[0]).toHaveStyle('animation-delay: 120ms');
    expect(impacts[1]).toHaveClass('is-break');
    expect(impacts[1]).toHaveStyle('animation-delay: 480ms');
  });
});
