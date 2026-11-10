import { createGuildPlayerFromSelection } from './App';
import { CLASS_XP_THRESHOLDS, grantClassExperience } from './data/classProgression';
import { createProductionFreshCharacter } from './utils/characterFactory';
import { ensureRelicState } from './data/relics';
import { getFreshPersistentGameState, hydratePersistentGameState, serializePersistentGameState } from './hooks/usePersistentGameState';

const { validateSavePayload } = require('../server/saveValidation');

const selectCharacter = state => {
  const selected = createProductionFreshCharacter({ name: 'Страж', classId: 'Defender', classProgression: state.classProgression });
  return {
    ...state,
    player: createGuildPlayerFromSelection({
      newPlayer: selected,
      carryOverRunInventory: state.carryOverRunInventory,
      carryOverSilver: state.carryOverSilver,
      classProgression: state.classProgression,
      relicState: ensureRelicState(state.relicState),
    }),
    currentScreen: 'guild',
  };
};

test('new account character selection produces a server-valid save and reloads into the guild', () => {
  const selected = selectCharacter(getFreshPersistentGameState());
  const payload = serializePersistentGameState(selected);
  expect(() => validateSavePayload(payload)).not.toThrow();
  expect(hydratePersistentGameState(payload)).toMatchObject({ currentScreen: 'guild', player: { name: 'Страж', class: 'Defender' } });
});

test('leveled class progression survives hydration, character selection, validation, and reload', () => {
  const progression = grantClassExperience({}, 'Defender', CLASS_XP_THRESHOLDS[7] + 25).progression;
  const loaded = hydratePersistentGameState({ ...getFreshPersistentGameState(), classProgression: progression });
  const payload = serializePersistentGameState(selectCharacter(loaded));
  expect(() => validateSavePayload(payload, { previousSave: { classProgression: progression } })).not.toThrow();
  const reloaded = hydratePersistentGameState(payload);
  expect(reloaded.classProgression.Defender).toEqual(progression.Defender);
  expect(reloaded.player.classProgression.Defender).toEqual(progression.Defender);
});
