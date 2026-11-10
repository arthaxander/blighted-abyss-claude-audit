export const GUILD_PRIMARY_SCREENS = Object.freeze([
  { id: 'hall', label: 'Холл', icon: '⌂' },
  { id: 'backpack', label: 'Рюкзак', icon: '▣' },
  { id: 'storage', label: 'Хранилище', icon: '▤' },
  { id: 'character', label: 'Персонаж', icon: '♙' },
  { id: 'craft', label: 'Крафт', icon: '⚒' },
]);

// This is the single registry for Hall services. Adding a service does not change
// GuildShell navigation; the panel renderer remains responsible for implemented UI.
export const GUILD_HALL_SERVICES = Object.freeze([
  { id: 'relics', label: 'Реликвии', icon: '◆', side: 'left' },
  { id: 'class', label: 'Класс', icon: '✦', side: 'right' },
  { id: 'quests', label: 'Задания', icon: '!', side: 'left' },
  { id: 'vendors', label: 'Торговцы', icon: '₴', side: 'right' },
]);

export const GUILD_SERVICE_IDS = new Set(GUILD_HALL_SERVICES.map(service => service.id));

export const GUILD_SCREEN_TITLES = Object.freeze({
  hall: 'Зал гильдии', fieldLoadout: 'Полевой набор', backpack: 'Рюкзак', storage: 'Хранилище', character: 'Персонаж', craft: 'Крафт',
  relics: 'Реликвии', class: 'Класс', quests: 'Задания', vendors: 'Торговый квартал', runes: 'Рунная мастерская',
});
