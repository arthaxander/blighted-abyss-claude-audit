const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

export const MUSIC_TRACKS = Object.freeze({
  guildHall: `${publicUrl}/assets/audio/music/guild/guild_hall_theme.mp3`,
  goblinNests: `${publicUrl}/assets/audio/music/locations/goblin_nests_01.mp3`,
  fungalCaves: `${publicUrl}/assets/audio/music/locations/fungal_caves_01.mp3`,
  deserterCamp: `${publicUrl}/assets/audio/music/locations/deserter_camp_01.mp3`,
  witheringForest: `${publicUrl}/assets/audio/music/locations/withering_forest_01.mp3`,
});

export const LOCATION_MUSIC_TRACKS = Object.freeze({
  'Гоблинские Норы': MUSIC_TRACKS.goblinNests,
  'Грибные Пещеры': MUSIC_TRACKS.fungalCaves,
  'Лагерь Отступников': MUSIC_TRACKS.deserterCamp,
  'Лес Увядания': MUSIC_TRACKS.witheringForest,
});

export const MUSIC_VOLUME = 0.22;
export const GUILD_FADE_IN_MS = 3000;
export const GUILD_DESCENT_FADE_OUT_MS = 2200;
export const GUILD_RESUME_FADE_IN_MS = 500;
export const GUILD_SILENCE_MIN_MS = 45000;
export const GUILD_SILENCE_MAX_MS = 90000;
export const LOCATION_FADE_IN_MS = 1200;
export const LOCATION_FADE_OUT_MS = 900;
export const GUILD_MUSIC_SCREENS = Object.freeze(['guild', 'locationSelect']);
export const LOCATION_MUSIC_SCREENS = Object.freeze(['dungeon', 'combat', 'combatLoot']);

export const isGuildMusicScreen = screen => GUILD_MUSIC_SCREENS.includes(screen);
export const isLocationMusicScreen = screen => LOCATION_MUSIC_SCREENS.includes(screen);
export const getLocationMusicTrack = (screen, locationName) => (
  isLocationMusicScreen(screen) ? LOCATION_MUSIC_TRACKS[locationName] || null : null
);
