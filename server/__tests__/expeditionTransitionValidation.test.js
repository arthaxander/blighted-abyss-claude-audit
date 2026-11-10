const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExpeditionTransition, LEVEL_TWO_LOCATIONS } = require('../expeditionTransitionValidation');

const hero = overrides => ({ class: 'Defender', hp: 23, maxHp: 100, runSilver: 70, runResonance: 8, runInventory: [{ name: 'Зелье' }], equipment: { weapon: { name: 'Клинок' } }, relics: { active: 'seal' }, ...overrides });
const cleared = location => ({ currentScreen: 'dungeon', player: hero({ abyssLevel: 1, expeditionPhase: 'boss-defeated', bossClearId: `boss-${location}`, currentLocation: location, portalStone: { acquiredFrom: 'boss' } }), classProgression: { Defender: { cumulativeClassXp: 100 } } });
const selection = (previous, completedCombatRooms = 0) => ({ ...previous, currentScreen: 'levelTwoLocationSelect', player: hero({ ...previous.player, abyssLevel: 2, expeditionPhase: 'level-selection', currentLocation: null, portalStone: null, roomGenerationState: { 'Лес Увядания': { completedCombatRooms } } }) });
const availableForest = LEVEL_TWO_LOCATIONS;

test('the first legal transition from every level-one boss is accepted', () => {
  ['Гоблинские Норы', 'Грибные Пещеры', 'Лагерь Отступников'].forEach(location => {
    const previous = cleared(location);
    assert.doesNotThrow(() => validateExpeditionTransition(selection(previous), previous));
  });
});

test('a normal subsequent save on the open selection screen is accepted', () => {
  const first = selection(cleared('Гоблинские Норы'));
  assert.doesNotThrow(() => validateExpeditionTransition(structuredClone(first), first));
});

test('an enabled forest supports entry, dungeon saves, combat, and return to dungeon', () => {
  const chosen = selection(cleared('Гоблинские Норы'));
  const entered = { ...chosen, currentScreen: 'dungeon', player: { ...chosen.player, expeditionPhase: 'exploring', currentLocation: 'Лес Увядания' } };
  const dungeonSave = structuredClone(entered);
  const combat = { ...entered, currentScreen: 'combat', player: { ...entered.player, hp: 18 }, activeCombat: { state: { enemies: [{}] } } };
  const returned = { ...combat, currentScreen: 'dungeon', player: { ...combat.player, hp: 12 }, activeCombat: null };
  assert.doesNotThrow(() => validateExpeditionTransition(entered, chosen, { levelTwoLocations: availableForest }));
  assert.doesNotThrow(() => validateExpeditionTransition(dungeonSave, entered, { levelTwoLocations: availableForest }));
  assert.doesNotThrow(() => validateExpeditionTransition(combat, dungeonSave, { levelTwoLocations: availableForest }));
  assert.doesNotThrow(() => validateExpeditionTransition(returned, combat, { levelTwoLocations: availableForest }));
});

test('an enabled forest cannot bypass selection or switch location by save mutation', () => {
  const firstLevel = cleared('Гоблинские Норы');
  const bypass = { ...firstLevel, currentScreen: 'dungeon', player: { ...firstLevel.player, abyssLevel: 2, expeditionPhase: 'exploring', currentLocation: 'Лес Увядания' } };
  assert.throws(() => validateExpeditionTransition(bypass, firstLevel, { levelTwoLocations: availableForest }), /invalid-level-transition-source/);
  const chosen = selection(firstLevel);
  const entered = { ...chosen, currentScreen: 'dungeon', player: { ...chosen.player, expeditionPhase: 'exploring', currentLocation: 'Лес Увядания' } };
  const switched = { ...entered, player: { ...entered.player, currentLocation: 'restless_ruins' } };
  // Switching a location mid-run must be rejected as a source transition first;
  // availability is tested separately when entry is otherwise legitimate.
  assert.throws(() => validateExpeditionTransition(switched, entered, { levelTwoLocations: availableForest }), /invalid-level-transition-source/);
});

test('selection continuation cannot replace the boss clear identity', () => {
  const first = selection(cleared('Грибные Пещеры'));
  const changed = structuredClone(first); changed.player.bossClearId = 'forged-clear';
  assert.throws(() => validateExpeditionTransition(changed, first), /boss-clear-id-mismatch/);
});

test('reapplying descent cannot reset the level counter or grant another reward', () => {
  const existing = selection(cleared('Лагерь Отступников'), 4);
  const reset = selection(existing, 0);
  assert.throws(() => validateExpeditionTransition(reset, existing), /level-transition-already-applied/);
  const rewarded = structuredClone(existing); rewarded.classProgression.Defender.cumulativeClassXp += 100;
  assert.throws(() => validateExpeditionTransition(rewarded, existing), /boss-reward-already-applied/);
});

test('direct entry into each disabled level-two location is rejected', () => {
  const previous = selection(cleared('Гоблинские Норы'));
  LEVEL_TWO_LOCATIONS.filter(location => !location.enabled).forEach(location => {
    const direct = { ...previous, currentScreen: 'dungeon', player: { ...previous.player, expeditionPhase: 'exploring', currentLocation: location.name } };
    assert.throws(() => validateExpeditionTransition(direct, previous), /level-two-location-unavailable/);
  });
});

test('forest entry preserves run state and cannot reset its counter', () => {
  const previous = selection(cleared('Гоблинские Норы'));
  const entered = { ...previous, currentScreen: 'dungeon', player: { ...previous.player, expeditionPhase: 'exploring', currentLocation: 'Лес Увядания' } };
  assert.doesNotThrow(() => validateExpeditionTransition(entered, previous));
  assert.throws(() => validateExpeditionTransition({ ...entered, player: { ...entered.player, hp: 100 } }, previous), /invalid-level-transition-mutation/);
  assert.throws(() => validateExpeditionTransition({ ...entered, player: { ...entered.player, roomGenerationState: { 'Лес Увядания': { completedCombatRooms: 1 } } } }, previous), /invalid-level-two-counter/);
});

test('forest entry tolerates structured client hydration canonicalization after restoring selection', () => {
  const previous = selection(cleared('Гоблинские Норы'));
  const entered = {
    ...previous,
    currentScreen: 'dungeon',
    player: {
      ...previous.player,
      expeditionPhase: 'exploring',
      currentLocation: 'Лес Увядания',
      runInventory: [{ itemId: 'Зелье', quantity: 1 }, null],
      equipment: { mainHand: { itemId: 'Клинок' }, offHand: null, helmet: null },
      relics: { active: 'seal', progress: {} },
    },
  };
  assert.doesNotThrow(() => validateExpeditionTransition(entered, previous));
});

test('forest boss completion remains saveable without opening a third level', () => {
  const chosen = selection(cleared('Гоблинские Норы'));
  const exploring = { ...chosen, currentScreen: 'dungeon', player: { ...chosen.player, expeditionPhase: 'exploring', currentLocation: 'Лес Увядания' } };
  const completed = { ...exploring, player: { ...exploring.player, expeditionPhase: 'boss-defeated' } };
  assert.doesNotThrow(() => validateExpeditionTransition(completed, exploring));
  assert.doesNotThrow(() => validateExpeditionTransition(structuredClone(completed), completed));
});

test('returning from selection to the Guild remains valid', () => {
  const previous = selection(cleared('Гоблинские Норы'));
  const guild = { ...previous, currentScreen: 'guild', player: hero({ ...previous.player, abyssLevel: null, expeditionPhase: null, bossClearId: null, currentLocation: null, portalStone: null }) };
  assert.doesNotThrow(() => validateExpeditionTransition(guild, previous));
});

test('boss bypass and transition mutations remain rejected', () => {
  const previous = cleared('Гоблинские Норы');
  const next = selection(previous);
  assert.throws(() => validateExpeditionTransition(next, { currentScreen: 'dungeon', player: hero({ currentLocation: previous.player.currentLocation }) }), /level-one-boss-required/);
  assert.throws(() => validateExpeditionTransition({ ...next, player: { ...next.player, hp: 100 } }, previous), /invalid-level-transition-mutation/);
  const extraXp = structuredClone(next); extraXp.classProgression.Defender.cumulativeClassXp += 100;
  assert.throws(() => validateExpeditionTransition(extraXp, previous), /boss-reward-already-applied/);
});

