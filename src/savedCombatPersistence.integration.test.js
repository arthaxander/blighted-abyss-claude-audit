import { getFreshPersistentGameState, hydratePersistentGameState, serializePersistentGameState } from './hooks/usePersistentGameState';
import { createProductionFreshCharacter } from './utils/characterFactory';
import { initCombatSession, performPlayerAction } from './utils/combatUtils';
import { CLASS_XP_THRESHOLDS, applyClassLoadoutToPlayer, grantClassExperience, selectClassTalent } from './data/classProgression';
import { CLASS_TALENT_SETS, TALENT_BY_ID } from './data/classTalents.mjs';

const { validateSavePayload } = require('../server/saveValidation');

const enemy = () => ({ id: 'saved-combat-enemy', name: 'Training enemy', hp: 10000, maxHp: 10000, attack: 0, speed: 1, effects: [], abilities: [] });
const action = activeCombat => {
  activeCombat.state.initiative.playerReady = true;
  performPlayerAction(activeCombat, 'Атака', 0);
};
const validatedPayload = (state, previousSave = null) => {
  const beforeCombat = JSON.stringify(state.activeCombat);
  const beforePlayer = JSON.stringify(state.player);
  const payload = serializePersistentGameState(state);
  expect(payload.player.classProgression).toBe(payload.classProgression);
  expect(JSON.stringify(payload.player.classProgression)).toBe(JSON.stringify(payload.classProgression));
  expect(JSON.stringify(state.activeCombat)).toBe(beforeCombat);
  expect(JSON.stringify(state.player)).toBe(beforePlayer);
  expect(() => validateSavePayload(payload, { previousSave })).not.toThrow();
  return JSON.parse(JSON.stringify(payload));
};

test('a real saved combat survives actions, progression changes, sequential saves and an action-free reload', () => {
  const player = createProductionFreshCharacter({ classId: 'Defender' });
  player.hp -= 7;
  player.runInventory[0] = { itemId: 'Простая ткань', quantity: 2 };
  const activeCombat = initCombatSession(player, [enemy()]);
  action(activeCombat);

  let state = { ...getFreshPersistentGameState(), currentScreen: 'combat', player, classProgression: player.classProgression, activeCombat };
  const hp = state.player.hp;
  const item = JSON.stringify(state.player.runInventory[0]);
  let saved = validatedPayload(state);

  state = hydratePersistentGameState(saved);
  for (let index = 0; index < 3; index += 1) {
    action(state.activeCombat);
    const next = validatedPayload(state, saved);
    saved = next;
    state = hydratePersistentGameState(next);
  }

  let progression = grantClassExperience(state.classProgression, 'Defender', CLASS_XP_THRESHOLDS[19]).progression;
  const talentSet = CLASS_TALENT_SETS.find(set => set.abilityId === 'defender.wounding_strike');
  const talent = talentSet.talents.find(entry => TALENT_BY_ID[entry.id]?.combatReady);
  progression = selectClassTalent(progression, 'Defender', talentSet.abilityId, talent.id, { location: 'guild' }).progression;
  state = { ...state, classProgression: progression, player: applyClassLoadoutToPlayer(state.player, progression) };
  saved = validatedPayload(state, saved);

  const actionFreeReload = hydratePersistentGameState(saved);
  validatedPayload(actionFreeReload, saved);
  expect(actionFreeReload.player.hp).toBe(hp);
  expect(JSON.stringify(actionFreeReload.player.runInventory[0])).toBe(item);
  expect(actionFreeReload.classProgression.Defender).toMatchObject({ classLevel: 20, cumulativeClassXp: CLASS_XP_THRESHOLDS[19] });
  expect(actionFreeReload.classProgression.Defender.unlockedSkillIds).toContain('Ударная волна');
  expect(actionFreeReload.classProgression.Defender.talentSelections[talentSet.abilityId]).toBe(talent.id);
});
