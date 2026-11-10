import { hydratePlayerSnapshot, ensureArenaProfile } from './playerState';

export const ARENA_CONSUMABLE_COPIES = 2;

export const ensureArenaBattleRoster = (playerProfile, extraOpponents = []) => {
  const roster = Array.isArray(extraOpponents) ? [...extraOpponents] : [];
  if (playerProfile?.defenseSnapshot) {
    roster.push({
      id: 'player-defense',
      name: playerProfile.defenseSnapshot.name || 'Фантом защитника',
      rating: playerProfile.rating ?? 1000,
      snapshot: playerProfile.defenseSnapshot,
    });
  }
  return roster;
};

export const snapshotToArenaEnemy = (snapshot, overrides = {}) => {
  if (!snapshot) return null;
  const baseAttack = snapshot.baseAtk ?? snapshot.attack ?? 0;
  return {
    id: overrides.id || snapshot.id || `arena-enemy-${Math.random().toString(36).slice(2, 9)}`,
    name: overrides.name || snapshot.name || 'Фантом соперника',
    hp: snapshot.maxHp ?? snapshot.hp ?? 100,
    maxHp: snapshot.maxHp ?? snapshot.hp ?? 100,
    attack: baseAttack,
    baseAtk: baseAttack,
    physDef: snapshot.physDef ?? snapshot.baseStats?.physDef ?? 0,
    magicDef: snapshot.magicDef ?? snapshot.baseStats?.magicDef ?? 0,
    magAtk: snapshot.magAtk ?? snapshot.baseStats?.magAtk ?? 0,
    speed: snapshot.speed ?? snapshot.baseStats?.speed ?? 100,
    critChance: snapshot.critChance ?? snapshot.baseStats?.critChance ?? 0.05,
    critDamage: snapshot.critDamage ?? snapshot.baseStats?.critDamage ?? 0.5,
    abilityNames: snapshot.abilityNames || [],
    abilities: snapshot.abilities,
    portraitKey: snapshot.portraitKey,
    arenaPhantom: true,
  };
};

export const selectArenaOpponent = (rating, roster) => {
  if (!Array.isArray(roster) || roster.length === 0) {
    return null;
  }
  const sorted = roster
    .filter(entry => entry && entry.snapshot)
    .sort((a, b) => Math.abs((a.rating ?? 1000) - rating) - Math.abs((b.rating ?? 1000) - rating));
  if (sorted.length === 0) return null;
  const pool = sorted.slice(0, 3);
  return pool[Math.floor(Math.random() * pool.length)] || sorted[0];
};

export const buildArenaPlayerLoadout = (snapshot, consumables = []) => {
  // Curated NPC snapshots predate player proficiencies and keep their authored loadouts/stats.
  // Player saves and player-authored defense snapshots are normalized before reaching this path.
  const hydrated = hydratePlayerSnapshot(snapshot, { normalizeEquipmentProficiency: false });
  const combatItems = [];
  consumables.slice(0, 2).forEach(name => {
    for (let i = 0; i < ARENA_CONSUMABLE_COPIES; i += 1) {
      combatItems.push({ name, arenaOnly: true });
    }
  });
  hydrated.items = combatItems;
  hydrated.inventory = combatItems.map(item => item.name);
  hydrated.hp = hydrated.maxHp;
  hydrated.preCombatEffects = [];
  hydrated.currentEnemies = undefined;
  hydrated.ignoreTarot = true;
  hydrated.tarotSpread = [];
  return hydrated;
};

export const calculateArenaRating = (currentRating, opponentRating, didWin) => {
  const playerRating = currentRating ?? 1000;
  const oppRating = opponentRating ?? 1000;
  const expected = 1 / (1 + 10 ** ((oppRating - playerRating) / 400));
  const score = didWin ? 1 : 0;
  const kFactor = 24;
  const updated = Math.max(0, Math.round(playerRating + kFactor * (score - expected)));
  return updated;
};

export const updateArenaRecord = (profile, didWin, opponentInfo) => {
  const ensured = ensureArenaProfile(profile);
  return {
    ...ensured,
    rating: calculateArenaRating(ensured.rating, opponentInfo?.rating, didWin),
    record: {
      wins: (ensured.record.wins || 0) + (didWin ? 1 : 0),
      losses: (ensured.record.losses || 0) + (didWin ? 0 : 1),
    },
    lastArenaOpponent: opponentInfo
      ? { id: opponentInfo.id, name: opponentInfo.name, rating: opponentInfo.rating }
      : ensured.lastArenaOpponent,
  };
};
