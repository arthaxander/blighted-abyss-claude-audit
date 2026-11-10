import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DungeonScreen from './DungeonScreen';
import { UIProvider } from '../contexts/UIContext';
import { SECRET_TYPES } from '../utils/roomGeneration';
import { isStrongEnemy } from '../utils/levelOneProgression';
import { isCursedRoomEnemy } from '../utils/enemyPools';

jest.mock('./FishingRoomModal', () => () => null);
jest.mock('./TrapDisarmModal', () => ({ onResolve, onCancel }) => <div>
  <button onClick={() => { onResolve({ method: 'sectors', success: true }); onResolve({ method: 'sectors', success: true }); }}>Успех тест</button>
  <button onClick={() => { onResolve({ method: 'sectors', success: false }); onResolve({ method: 'sectors', success: false }); }}>Провал тест</button>
  <button onClick={onCancel}>Обойти тест</button>
</div>);
const setup = (location = 'Гоблинские Норы', level = 1) => {
  const props = {
    player: { name: 'Тест', currentLocation: location, abyssLevel: level, hp: 1, maxHp: 100, equipment: {}, runInventory: [], curses: {}, tarotSpread: [], roomGenerationState: {} },
    expeditionCell: { id: 'trap-cell', region: 'sublocation', sublocationId: 'rat-passages', content: { id: 'trap', type: 'Ловушка', roomType: SECRET_TYPES.TRAP, sublocationEffectId: 'rat-riders' } },
    onEnterDungeon: jest.fn(), onPendingLoot: jest.fn(), onUpdatePlayer: jest.fn(), onExpeditionCellResolved: jest.fn(), onDefeat: jest.fn(), onUpdateRelics: jest.fn(),
  };
  render(<UIProvider><DungeonScreen {...props} /></UIProvider>);
  return props;
};
test('failure starts one reduced ordinary ambush with additive bonus and retains sublocation; no direct damage or early cell resolution', () => {
  const props = setup();
  fireEvent.click(screen.getByText('Провал тест'));
  expect(props.onEnterDungeon).toHaveBeenCalledTimes(1);
  const [pack, boss, location, type, context] = props.onEnterDungeon.mock.calls[0];
  expect(pack).toHaveLength(2);
  expect(boss).toBe(false); expect(location).toBe('Гоблинские Норы'); expect(type).toBe('TRAP_ENEMY');
  expect(context).toMatchObject({ expeditionZone: 'sublocation', sublocationEffectId: 'rat-riders' });
  pack.forEach(enemy => {
    expect(enemy.startingTurnMeterBonus).toBe(400);
    expect(isStrongEnemy(enemy) || isCursedRoomEnemy(enemy) || enemy.boss).toBeFalsy();
  });
  expect(props.onDefeat).not.toHaveBeenCalled();
  expect(props.onExpeditionCellResolved).not.toHaveBeenCalled();
  expect(props.onPendingLoot).not.toHaveBeenCalled();
});
test.each([['Гоблинские Норы', 1, 'Металлические обломки'], ['Лес Увядания', 2, 'Сумрачный сплав']])('success in %s opens only metal loot once', (location, level, metal) => {
  const props = setup(location, level);
  fireEvent.click(screen.getByText('Успех тест'));
  expect(props.onPendingLoot).toHaveBeenCalledTimes(1);
  expect(props.onPendingLoot).toHaveBeenCalledWith({ source: 'trap', silver: 0, items: [{ name: metal, quantity: expect.any(Number) }] });
  const quantity = props.onPendingLoot.mock.calls[0][0].items[0].quantity;
  expect(quantity).toBeGreaterThanOrEqual(1); expect(quantity).toBeLessThanOrEqual(3);
  expect(props.onUpdateRelics).not.toHaveBeenCalled();
  expect(props.onEnterDungeon).not.toHaveBeenCalled();
  expect(props.onExpeditionCellResolved).toHaveBeenCalledTimes(1);
});
test('bypass has no rewards or battle', () => {
  const props = setup(); fireEvent.click(screen.getByText('Обойти тест'));
  expect(props.onEnterDungeon).not.toHaveBeenCalled(); expect(props.onPendingLoot).not.toHaveBeenCalled();
  expect(props.onExpeditionCellResolved).toHaveBeenCalledTimes(1);
});
