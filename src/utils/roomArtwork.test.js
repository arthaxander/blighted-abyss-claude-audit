import { ROOM_TYPES } from './roomGeneration';
import {
  DESERTER_CURSED_ENEMY_ARTWORK,
  DESERTER_ROOM_ARTWORK,
  FUNGAL_CURSED_ENEMY_ARTWORK,
  FUNGAL_ROOM_ARTWORK,
  GOBLIN_CURSED_ENEMY_ARTWORK,
  GOBLIN_ROOM_ARTWORK,
  buildRoomArtworkWindowKey,
  resolveRoomChoiceArtworks,
} from './roomArtwork';

const rooms = (...types) => types.map((roomType, index) => ({ id: `visible-${index}`, roomType }));
const resolve = (choices, stableWindowKey = 'window-7') => resolveRoomChoiceArtworks({
  locationId: 'goblin', rooms: choices, stableWindowKey,
});

describe('Goblin Nests room artwork', () => {
  test('declares the complete authored file map', () => {
    expect(GOBLIN_ROOM_ARTWORK).toEqual({
      COMBAT: ['/assets/rooms/goblin_nests/combat_01.webp', '/assets/rooms/goblin_nests/combat_02.webp', '/assets/rooms/goblin_nests/combat_03.webp'],
      SECRET: ['/assets/rooms/goblin_nests/secret_01.webp', '/assets/rooms/goblin_nests/secret_02.webp'],
      RESOURCE: ['/assets/rooms/goblin_nests/resource_01.webp', '/assets/rooms/goblin_nests/resource_02.webp', '/assets/rooms/goblin_nests/resource_03.webp'],
      FISHING: ['/assets/rooms/goblin_nests/fishing.webp'],
      TREASURE: ['/assets/rooms/goblin_nests/treasure_01.webp', '/assets/rooms/goblin_nests/treasure_02.webp'],
      CURSE_ALTAR: ['/assets/rooms/goblin_nests/altar.webp'],
      BOSS: ['/assets/rooms/goblin_nests/boss.webp'],
    });
    expect(GOBLIN_CURSED_ENEMY_ARTWORK).toEqual({
      corrupted_goblin_ratskinner: '/assets/rooms/goblin_nests/corruption_enemy.webp',
      warped_goblin_crystalbreaker: '/assets/rooms/goblin_nests/distortion_enemy.webp',
    });
  });

  test.each([
    [ROOM_TYPES.COMBAT, 3, 3], [ROOM_TYPES.RESOURCE, 3, 3],
    [ROOM_TYPES.SECRET, 2, 2], [ROOM_TYPES.SECRET, 3, 2],
    [ROOM_TYPES.TREASURE, 3, 2],
  ])('%s assigns every card and exhausts its pool only after unique variants', (type, count, uniqueCount) => {
    const result = resolve(rooms(...Array(count).fill(type)));
    expect(result).toHaveLength(count);
    expect(result.every(url => GOBLIN_ROOM_ARTWORK[type].includes(url))).toBe(true);
    expect(new Set(result).size).toBe(uniqueCount);
  });

  test('single-art rooms use their authored artwork', () => {
    expect(resolve(rooms(ROOM_TYPES.FISHING, ROOM_TYPES.CURSE_ALTAR, ROOM_TYPES.BOSS))).toEqual([
      '/assets/rooms/goblin_nests/fishing.webp',
      '/assets/rooms/goblin_nests/altar.webp',
      '/assets/rooms/goblin_nests/boss.webp',
    ]);
  });

  test('uses canonical cursed-enemy portrait identities and no-art fallback', () => {
    const cursed = portraitKey => ({ roomType: ROOM_TYPES.CURSED_ENEMY, enemies: [{ portraitKey }] });
    expect(resolve([cursed('corrupted_goblin_ratskinner'), cursed('warped_goblin_crystalbreaker'), cursed('unknown')])).toEqual([
      '/assets/rooms/goblin_nests/corruption_enemy.webp',
      '/assets/rooms/goblin_nests/distortion_enemy.webp',
      null,
    ]);
  });

  test('is stable, can vary by window, and never uses hidden Secret contents', () => {
    const visible = rooms(ROOM_TYPES.SECRET, ROOM_TYPES.SECRET);
    const hiddenA = visible.map((room, index) => ({ ...room, hiddenRoomType: index ? 'SECRET_TREASURE' : 'SECRET_COMBAT', hiddenPayload: { enemies: [{ name: `hidden-${index}` }] } }));
    const hiddenB = visible.map((room, index) => ({ ...room, hiddenRoomType: index ? 'SECRET_RESOURCE' : 'SECRET_CURSE_ALTAR', hiddenPayload: { loot: [`other-${index}`] } }));
    const first = resolve(hiddenA, 'same-visible-window');
    expect(resolve(hiddenA, 'same-visible-window')).toEqual(first);
    expect(resolve(hiddenB, 'same-visible-window')).toEqual(first);
    const orderings = new Set(Array.from({ length: 20 }, (_, index) => resolve(visible, `window-${index}`).join('|')));
    expect(orderings.size).toBeGreaterThan(1);
  });

  test('window key uses only location, window index, and visible choice identity', () => {
    const base = rooms(ROOM_TYPES.SECRET, ROOM_TYPES.COMBAT);
    const key = buildRoomArtworkWindowKey({ locationId: 'goblin', rooms: base, choiceWindowIndex: 4 });
    expect(buildRoomArtworkWindowKey({ locationId: 'goblin', rooms: base.map(room => ({ ...room, hiddenPayload: { enemies: ['secret'] } })), choiceWindowIndex: 4 })).toBe(key);
  });

  test('does not leak Goblin artwork to another location', () => {
    expect(resolveRoomChoiceArtworks({ locationId: 'unknown', rooms: rooms(ROOM_TYPES.COMBAT, ROOM_TYPES.SECRET) })).toEqual([null, null]);
  });
});

describe('Mushroom Caves room artwork', () => {
  const resolveFungal = (choices, stableWindowKey = 'fungal-window-7') => resolveRoomChoiceArtworks({
    locationId: 'fungal', rooms: choices, stableWindowKey,
  });

  test('declares the complete fungal authored file map', () => {
    expect(FUNGAL_ROOM_ARTWORK).toEqual({
      COMBAT: ['/assets/rooms/fungal/combat_01.webp', '/assets/rooms/fungal/combat_02.webp', '/assets/rooms/fungal/combat_03.webp'],
      SECRET: ['/assets/rooms/fungal/secret_01.webp', '/assets/rooms/fungal/secret_02.webp'],
      RESOURCE: ['/assets/rooms/fungal/resource_01.webp', '/assets/rooms/fungal/resource_02.webp', '/assets/rooms/fungal/resource_03.webp'],
      FISHING: ['/assets/rooms/fungal/fishing.webp'],
      TREASURE: ['/assets/rooms/fungal/treasure_01.webp', '/assets/rooms/fungal/treasure_02.webp'],
      CURSE_ALTAR: ['/assets/rooms/fungal/altar.webp'],
      BOSS: ['/assets/rooms/fungal/boss.webp'],
    });
    expect(FUNGAL_CURSED_ENEMY_ARTWORK).toEqual({
      corrupted_troglodyte_snakehead: '/assets/rooms/fungal/corruption_enemy.webp',
      warped_troglodyte_totemist: '/assets/rooms/fungal/distortion_enemy.webp',
    });
  });

  test.each([
    [ROOM_TYPES.COMBAT, 3, 3], [ROOM_TYPES.RESOURCE, 3, 3],
    [ROOM_TYPES.SECRET, 2, 2], [ROOM_TYPES.TREASURE, 2, 2],
  ])('%s rotates through every fungal variant', (type, count, uniqueCount) => {
    const result = resolveFungal(rooms(...Array(count).fill(type)));
    expect(result.every(url => FUNGAL_ROOM_ARTWORK[type].includes(url))).toBe(true);
    expect(new Set(result).size).toBe(uniqueCount);
  });

  test('resolves fungal fishing, altar, and boss artwork', () => {
    expect(resolveFungal(rooms(ROOM_TYPES.FISHING, ROOM_TYPES.CURSE_ALTAR, ROOM_TYPES.BOSS))).toEqual([
      '/assets/rooms/fungal/fishing.webp',
      '/assets/rooms/fungal/altar.webp',
      '/assets/rooms/fungal/boss.webp',
    ]);
  });

  test('resolves fungal corruption and distortion enemies with the existing fallback', () => {
    const cursed = portraitKey => ({ roomType: ROOM_TYPES.CURSED_ENEMY, enemies: [{ portraitKey }] });
    expect(resolveFungal([
      cursed('corrupted_troglodyte_snakehead'),
      cursed('warped_troglodyte_totemist'),
      cursed('unknown'),
    ])).toEqual([
      '/assets/rooms/fungal/corruption_enemy.webp',
      '/assets/rooms/fungal/distortion_enemy.webp',
      null,
    ]);
  });
});


describe('Deserter Camp room artwork', () => {
  const resolveDeserter = (choices, stableWindowKey = 'deserter-window') => resolveRoomChoiceArtworks({ locationId: 'deserter', rooms: choices, stableWindowKey });

  test('declares all 15 authored artworks and cursed enemy identities', () => {
    expect(Object.values(DESERTER_ROOM_ARTWORK).flat()).toHaveLength(13);
    expect(Object.values(DESERTER_CURSED_ENEMY_ARTWORK)).toEqual([
      '/assets/rooms/deserter_camp/corruption_enemy.webp',
      '/assets/rooms/deserter_camp/distortion_enemy.webp',
    ]);
  });

  test.each([[ROOM_TYPES.COMBAT, 3], [ROOM_TYPES.RESOURCE, 3], [ROOM_TYPES.SECRET, 2], [ROOM_TYPES.TREASURE, 2]])('%s exhausts unique variants before repeating', (type, count) => {
    expect(new Set(resolveDeserter(rooms(...Array(count).fill(type)))).size).toBe(count);
  });

  test('is stable per window, ignores hidden Secret contents, and resolves cursed portraits', () => {
    const visible = rooms(ROOM_TYPES.SECRET, ROOM_TYPES.SECRET);
    const hidden = visible.map(room => ({ ...room, hiddenPayload: { enemies: ['secret'] } }));
    expect(resolveDeserter(hidden, 'same')).toEqual(resolveDeserter(visible, 'same'));
    const cursed = portraitKey => ({ roomType: ROOM_TYPES.CURSED_ENEMY, enemies: [{ portraitKey }] });
    expect(resolveDeserter([cursed('corrupted_deserter_berserker'), cursed('warped_deserter_guard')])).toEqual(Object.values(DESERTER_CURSED_ENEMY_ARTWORK));
  });

  test('never leaks artwork into other locations', () => {
    expect(resolveRoomChoiceArtworks({ locationId: 'unknown', rooms: rooms(ROOM_TYPES.COMBAT) })).toEqual([null]);
  });
});
