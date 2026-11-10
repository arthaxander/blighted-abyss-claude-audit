import { ROOM_TYPES } from './roomGeneration';

export const GOBLIN_ROOM_ARTWORK = Object.freeze({
  [ROOM_TYPES.COMBAT]: Object.freeze([
    '/assets/rooms/goblin_nests/combat_01.webp',
    '/assets/rooms/goblin_nests/combat_02.webp',
    '/assets/rooms/goblin_nests/combat_03.webp',
  ]),
  [ROOM_TYPES.SECRET]: Object.freeze([
    '/assets/rooms/goblin_nests/secret_01.webp',
    '/assets/rooms/goblin_nests/secret_02.webp',
  ]),
  [ROOM_TYPES.RESOURCE]: Object.freeze([
    '/assets/rooms/goblin_nests/resource_01.webp',
    '/assets/rooms/goblin_nests/resource_02.webp',
    '/assets/rooms/goblin_nests/resource_03.webp',
  ]),
  [ROOM_TYPES.FISHING]: Object.freeze(['/assets/rooms/goblin_nests/fishing.webp']),
  [ROOM_TYPES.TREASURE]: Object.freeze([
    '/assets/rooms/goblin_nests/treasure_01.webp',
    '/assets/rooms/goblin_nests/treasure_02.webp',
  ]),
  [ROOM_TYPES.CURSE_ALTAR]: Object.freeze(['/assets/rooms/goblin_nests/altar.webp']),
  [ROOM_TYPES.BOSS]: Object.freeze(['/assets/rooms/goblin_nests/boss.webp']),
});

export const GOBLIN_CURSED_ENEMY_ARTWORK = Object.freeze({
  corrupted_goblin_ratskinner: '/assets/rooms/goblin_nests/corruption_enemy.webp',
  warped_goblin_crystalbreaker: '/assets/rooms/goblin_nests/distortion_enemy.webp',
});

export const FUNGAL_ROOM_ARTWORK = Object.freeze({
  [ROOM_TYPES.COMBAT]: Object.freeze([
    '/assets/rooms/fungal/combat_01.webp',
    '/assets/rooms/fungal/combat_02.webp',
    '/assets/rooms/fungal/combat_03.webp',
  ]),
  [ROOM_TYPES.SECRET]: Object.freeze([
    '/assets/rooms/fungal/secret_01.webp',
    '/assets/rooms/fungal/secret_02.webp',
  ]),
  [ROOM_TYPES.RESOURCE]: Object.freeze([
    '/assets/rooms/fungal/resource_01.webp',
    '/assets/rooms/fungal/resource_02.webp',
    '/assets/rooms/fungal/resource_03.webp',
  ]),
  [ROOM_TYPES.FISHING]: Object.freeze(['/assets/rooms/fungal/fishing.webp']),
  [ROOM_TYPES.TREASURE]: Object.freeze([
    '/assets/rooms/fungal/treasure_01.webp',
    '/assets/rooms/fungal/treasure_02.webp',
  ]),
  [ROOM_TYPES.CURSE_ALTAR]: Object.freeze(['/assets/rooms/fungal/altar.webp']),
  [ROOM_TYPES.BOSS]: Object.freeze(['/assets/rooms/fungal/boss.webp']),
});

export const FUNGAL_CURSED_ENEMY_ARTWORK = Object.freeze({
  corrupted_troglodyte_snakehead: '/assets/rooms/fungal/corruption_enemy.webp',
  warped_troglodyte_totemist: '/assets/rooms/fungal/distortion_enemy.webp',
});


export const DESERTER_ROOM_ARTWORK = Object.freeze({
  [ROOM_TYPES.COMBAT]: Object.freeze(['/assets/rooms/deserter_camp/combat_01.webp', '/assets/rooms/deserter_camp/combat_02.webp', '/assets/rooms/deserter_camp/combat_03.webp']),
  [ROOM_TYPES.SECRET]: Object.freeze(['/assets/rooms/deserter_camp/secret_01.webp', '/assets/rooms/deserter_camp/secret_02.webp']),
  [ROOM_TYPES.RESOURCE]: Object.freeze(['/assets/rooms/deserter_camp/resource_01.webp', '/assets/rooms/deserter_camp/resource_02.webp', '/assets/rooms/deserter_camp/resource_03.webp']),
  [ROOM_TYPES.FISHING]: Object.freeze(['/assets/rooms/deserter_camp/fishing.webp']),
  [ROOM_TYPES.TREASURE]: Object.freeze(['/assets/rooms/deserter_camp/treasure_01.webp', '/assets/rooms/deserter_camp/treasure_02.webp']),
  [ROOM_TYPES.CURSE_ALTAR]: Object.freeze(['/assets/rooms/deserter_camp/altar.webp']),
  [ROOM_TYPES.BOSS]: Object.freeze(['/assets/rooms/deserter_camp/boss.webp']),
});

export const DESERTER_CURSED_ENEMY_ARTWORK = Object.freeze({
  corrupted_deserter_berserker: '/assets/rooms/deserter_camp/corruption_enemy.webp',
  warped_deserter_guard: '/assets/rooms/deserter_camp/distortion_enemy.webp',
});

export const ROOM_ARTWORK_BY_LOCATION = Object.freeze({
  goblin: GOBLIN_ROOM_ARTWORK,
  fungal: FUNGAL_ROOM_ARTWORK,
  deserter: DESERTER_ROOM_ARTWORK,
});

const CURSED_ENEMY_ARTWORK_BY_LOCATION = Object.freeze({
  goblin: GOBLIN_CURSED_ENEMY_ARTWORK,
  fungal: FUNGAL_CURSED_ENEMY_ARTWORK,
  deserter: DESERTER_CURSED_ENEMY_ARTWORK,
});

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const orderedPool = (pool, seed) => [...pool].sort((left, right) => {
  const difference = hashString(`${seed}:${left}`) - hashString(`${seed}:${right}`);
  return difference || left.localeCompare(right);
});

export const resolveRoomTypeArtwork = (locationId, roomType) => ROOM_ARTWORK_BY_LOCATION[locationId]?.[roomType]?.[0] || null;

export const buildRoomArtworkWindowKey = ({ locationId, rooms, choiceWindowIndex }) => [
  locationId,
  choiceWindowIndex,
  ...(rooms || []).map((room, index) => `${index}:${room?.id || room?.roomType || 'unknown'}`),
].join('|');

export const resolveRoomChoiceArtworks = ({ locationId, rooms = [], stableWindowKey = '' }) => {
  const roomArtwork = ROOM_ARTWORK_BY_LOCATION[locationId];
  const cursedEnemyArtwork = CURSED_ENEMY_ARTWORK_BY_LOCATION[locationId];
  if (!roomArtwork) return rooms.map(() => null);

  const assignments = rooms.map(() => null);
  const poolSlots = new Map();

  rooms.forEach((room, index) => {
    if (room?.roomType === ROOM_TYPES.CURSED_ENEMY) {
      const portraitKey = room.enemies?.[0]?.portraitKey;
      assignments[index] = cursedEnemyArtwork?.[portraitKey] || null;
      return;
    }
    const pool = roomArtwork[room?.roomType];
    if (!pool) return;
    const slots = poolSlots.get(room.roomType) || [];
    slots.push(index);
    poolSlots.set(room.roomType, slots);
  });

  poolSlots.forEach((slots, roomType) => {
    const pool = orderedPool(roomArtwork[roomType], `${stableWindowKey}:${roomType}`);
    slots.forEach((roomIndex, poolIndex) => {
      assignments[roomIndex] = pool[poolIndex % pool.length];
    });
  });

  return assignments;
};
