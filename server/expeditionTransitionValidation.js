const LEVEL_TWO_LOCATIONS = require('../src/data/levelTwoLocations.json');
const { isDeepStrictEqual } = require('node:util');

const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const LEVEL_ONE_LOCATIONS = new Set(['Гоблинские Норы', 'Грибные Пещеры', 'Лагерь Отступников']);
const protectedTransitionFields = ['hp', 'maxHp', 'runSilver', 'runResonance', 'runInventory', 'equipment', 'relics'];
const protectedEntryScalarFields = ['hp', 'maxHp', 'runSilver', 'runResonance'];
const forestCombatCount = player => player?.roomGenerationState?.['Лес Увядания']?.completedCombatRooms ?? 0;
const canonicalProgression = save => save?.classProgression || save?.player?.classProgression || null;

const assertSameFields = (player, previous, fields = protectedTransitionFields) => fields.forEach(field => {
  if (!isDeepStrictEqual(player?.[field] ?? null, previous?.[field] ?? null)) invalid('invalid-level-transition-mutation');
});

const assertSameProgression = (save, previousSave) => {
  if (!isDeepStrictEqual(canonicalProgression(save), canonicalProgression(previousSave))) invalid('boss-reward-already-applied');
};

const validateLevelTwoSelection = (save, previousSave) => {
  const player = save.player;
  const previous = previousSave?.player;
  if (!player || player.abyssLevel !== 2 || player.expeditionPhase !== 'level-selection' || player.currentLocation != null) invalid('invalid-level-two-selection');
  if (!previous) invalid('level-one-boss-required');

  const continuingSelection = previousSave.currentScreen === 'levelTwoLocationSelect'
    && previous.abyssLevel === 2
    && previous.expeditionPhase === 'level-selection'
    && previous.currentLocation == null;

  if (continuingSelection) {
    if (!previous.bossClearId || player.bossClearId !== previous.bossClearId) invalid('boss-clear-id-mismatch');
    assertSameFields(player, previous);
    if (forestCombatCount(player) !== forestCombatCount(previous)) invalid('level-transition-already-applied');
    assertSameProgression(save, previousSave);
    return;
  }

  if (previous.abyssLevel === 2) invalid('invalid-level-transition-source');
  const canonicalClear = previous.abyssLevel === 1 && previous.expeditionPhase === 'boss-defeated' && previous.bossClearId;
  const legacyClear = previous.portalStone?.acquiredFrom === 'boss';
  if (!LEVEL_ONE_LOCATIONS.has(previous.currentLocation) || (!canonicalClear && !legacyClear)) invalid('level-one-boss-required');
  if (!player.bossClearId) invalid('boss-clear-id-mismatch');
  if (canonicalClear && player.bossClearId !== previous.bossClearId) invalid('boss-clear-id-mismatch');
  assertSameFields(player, previous);
  assertSameProgression(save, previousSave);
  if (forestCombatCount(player) !== 0) invalid('invalid-level-two-counter');
};

const validateExpeditionTransition = (save, previousSave, { levelTwoLocations = LEVEL_TWO_LOCATIONS } = {}) => {
  const player = save?.player;
  const previous = previousSave?.player;
  const levelTwoByLocation = new Map(levelTwoLocations.flatMap(location => [[location.id, location], [location.name, location]]));
  const levelTwoLocation = levelTwoByLocation.get(player?.currentLocation);
  if (levelTwoLocation && !levelTwoLocation.enabled) invalid('level-two-location-unavailable');
  if (Number(player?.abyssLevel) >= 2 && player?.currentLocation != null) {
    if (!levelTwoLocation?.enabled) invalid('level-two-location-unavailable');
    const initialEntry = previousSave?.currentScreen === 'levelTwoLocationSelect'
      && save.currentScreen === 'dungeon'
      && previous?.abyssLevel === 2
      && previous?.expeditionPhase === 'level-selection'
      && previous?.currentLocation == null;
    const continuingExpedition = previous?.abyssLevel === 2
      && previous?.currentLocation === player.currentLocation
      && ((previous.expeditionPhase === 'exploring' && ['exploring', 'boss-defeated'].includes(player.expeditionPhase))
        || (previous.expeditionPhase === 'boss-defeated' && player.expeditionPhase === 'boss-defeated'));
    if ((!initialEntry && !continuingExpedition) || !previous?.bossClearId || previous.bossClearId !== player.bossClearId) invalid('invalid-level-transition-source');
    if (!['exploring', 'boss-defeated'].includes(player.expeditionPhase)) invalid('invalid-level-transition-source');
    if (initialEntry) {
      // A restored selection save is hydrated through the current client schema before
      // the player enters L2. Structured ownership fields can therefore be canonically
      // migrated (slot padding, equipment refs, relic defaults) without changing the run.
      // Keep exact guards for scalar run resources here; the earlier L1 -> selection
      // transition still deep-checks inventory/equipment/relics before the checkpoint.
      assertSameFields(player, previous, protectedEntryScalarFields);
      assertSameProgression(save, previousSave);
      if (forestCombatCount(player) !== forestCombatCount(previous)) invalid('invalid-level-two-counter');
    }
  }

  if (save?.currentScreen === 'levelTwoLocationSelect') validateLevelTwoSelection(save, previousSave);

  if (previous?.bossClearId && previous.bossClearId === player?.bossClearId && previous.expeditionPhase === 'boss-defeated' && player.expeditionPhase === 'boss-defeated') {
    const oldXp = previousSave.classProgression?.[player.class]?.cumulativeClassXp || 0;
    const newXp = save.classProgression?.[player.class]?.cumulativeClassXp || 0;
    if (newXp > oldXp) invalid('boss-reward-already-applied');
  }
  return save;
};

module.exports = { validateExpeditionTransition, LEVEL_TWO_LOCATIONS, LEVEL_ONE_LOCATIONS };
