import {
  applyCombatPresentationEvent,
  createCombatPresentationView,
  getCombatPresentationUnitId,
  snapshotCombatPresentationUnit,
} from './combatPresentationEvents';

test('allied summon presentation enters only the player-side roster with stable identity', () => {
  const hero = { id: 'hero', name: 'Герой', hp: 100, maxHp: 100 };
  const ally = {
    id: 'fire-elemental-1', name: 'Огненный элементаль', hp: 50, maxHp: 50,
    summoned: true, allyPortraitKey: 'summons/elementalist/fire_elemental',
  };
  const initial = createCombatPresentationView({ players: [hero], enemies: [{ id: 'enemy-1', name: 'Враг', hp: 10, maxHp: 10 }] });
  const next = applyCombatPresentationEvent(initial, {
    type: 'summon', side: 'ally', targetId: ally.id, rosterIndex: 1,
    targetAfter: snapshotCombatPresentationUnit(ally, 1),
  });
  expect(next.enemies.map(getCombatPresentationUnitId)).toEqual(['enemy-1']);
  expect(next.players.map(getCombatPresentationUnitId)).toEqual(['hero', 'fire-elemental-1']);
  expect(next.players[1]).toMatchObject({ allyPortraitKey: 'summons/elementalist/fire_elemental', summoned: true });
});
