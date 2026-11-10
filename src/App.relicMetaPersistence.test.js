import { createGuildPlayerFromSelection, resolveGuildRelicMetaUpdate } from './App';
import { DEFAULT_RELIC_ID, RELIC_DEFINITIONS, grantAllRelics } from './data/relics';
import { createProductionFreshCharacter } from './utils/characterFactory';
import { grantRelicExperience } from './data/relics';
import { claimGuildQuestReward } from './utils/guildTransactions';
import { transferRunResonance } from './utils/abyssResonance';

const player = () => ({ name: 'Герой', class: 'Defender', relics: {}, equipment: {}, runInventory: [] });
const nextHero = relicState => createGuildPlayerFromSelection({
  newPlayer: createProductionFreshCharacter({ classId: 'Defender' }),
  classProgression: {},
  relicState,
});

describe('Guild relic meta transactions', () => {
  test('DEV grant-all synchronizes all 19 discoveries to player and persistent meta', () => {
    const result = resolveGuildRelicMetaUpdate({ relicState: {}, player: player() }, grantAllRelics);
    expect(result.relicState.discoveredRelicIds).toHaveLength(RELIC_DEFINITIONS.length);
    expect(result.relicState.discoveredRelicIds).toHaveLength(19);
    expect(result.player.relics).toBe(result.relicState);
  });

  test('grant-all discoveries and existing progress survive creation of the next hero', () => {
    const progress = { [DEFAULT_RELIC_ID]: { level: 4, xp: 61 } };
    const result = resolveGuildRelicMetaUpdate({ relicState: { progress }, player: player() }, grantAllRelics);
    const created = nextHero(result.relicState);
    expect(created.relics.discoveredRelicIds).toHaveLength(19);
    expect(created.relics.progress[DEFAULT_RELIC_ID]).toEqual({ level: 4, xp: 61 });
  });

  test('selecting a relic synchronizes active selection and preserves progress', () => {
    const progress = { ritual_blade: { level: 2, xp: 17 } };
    const selectBloodAmulet = current => ({ ...current, activeRelicId: 'blood_amulet', discoveredRelicIds: [...current.discoveredRelicIds, 'blood_amulet'] });
    const result = resolveGuildRelicMetaUpdate({ relicState: { progress }, player: player() }, selectBloodAmulet);
    expect(result.player.relics.activeRelicId).toBe('blood_amulet');
    expect(result.relicState.activeRelicId).toBe('blood_amulet');
    expect(result.relicState.progress.ritual_blade).toEqual({ level: 2, xp: 17 });
  });

  test('selected active relic remains active for the next hero', () => {
    const selected = resolveGuildRelicMetaUpdate({ relicState: {}, player: player() }, current => ({ ...current, activeRelicId: 'blood_amulet', discoveredRelicIds: [...current.discoveredRelicIds, 'blood_amulet'] }));
    expect(nextHero(selected.relicState).relics.activeRelicId).toBe('blood_amulet');
  });

  test('quest XP updates canonical meta once and survives selecting another relic', () => {
    const initial = { activeRelicId: DEFAULT_RELIC_ID, progress: { [DEFAULT_RELIC_ID]: { level: 0, xp: 0 } } };
    const questPlayer = { ...player(), relics: initial, questLog: { 'quest-goblin-clearing': { progress: 3, completed: true, claimed: false } } };
    const claim = claimGuildQuestReward({ player: questPlayer, storageItems: [], questId: 'quest-goblin-clearing' });
    expect(claim.relicXp).toBe(50);
    expect(claim.player.relics.progress[DEFAULT_RELIC_ID].xp).toBe(0);

    const awarded = resolveGuildRelicMetaUpdate(
      { relicState: initial, player: claim.player },
      current => grantRelicExperience(current, current.activeRelicId, claim.relicXp).relicState
    );
    expect(awarded.relicState.progress[DEFAULT_RELIC_ID].xp).toBe(50);
    expect(awarded.player.relics.progress[DEFAULT_RELIC_ID].xp).toBe(50);

    const selected = resolveGuildRelicMetaUpdate(awarded, current => ({
      ...current,
      activeRelicId: 'blood_amulet',
      discoveredRelicIds: [...current.discoveredRelicIds, 'blood_amulet'],
    }));
    expect(selected.relicState.activeRelicId).toBe('blood_amulet');
    expect(selected.player.relics.activeRelicId).toBe('blood_amulet');
    expect(selected.relicState.progress[DEFAULT_RELIC_ID].xp).toBe(50);
    expect(selected.player.relics.progress[DEFAULT_RELIC_ID].xp).toBe(50);
  });

  test('quest XP survives the next hero and resonance transfer keeps runtime and meta equal', () => {
    const initial = { activeRelicId: DEFAULT_RELIC_ID, progress: { [DEFAULT_RELIC_ID]: { level: 0, xp: 0 } } };
    const awarded = resolveGuildRelicMetaUpdate(
      { relicState: initial, player: player() },
      current => grantRelicExperience(current, current.activeRelicId, 50).relicState
    );
    expect(nextHero(awarded.relicState).relics.progress[DEFAULT_RELIC_ID].xp).toBe(50);

    const transfer = transferRunResonance({ ...awarded.player, runResonance: 25 });
    expect(transfer.player.relics).toEqual(transfer.after);
    expect(transfer.after.progress[DEFAULT_RELIC_ID].xp).toBe(75);
  });
});
