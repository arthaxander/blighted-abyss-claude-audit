import { DESERTER_LOCATION, FUNGAL_LOCATION, GOBLIN_LOCATION } from '../utils/enemyPools';
import levelTwoLocations from './levelTwoLocations.json';

export const AVAILABLE_LOCATIONS = [
  {
    id: 'goblin',
    name: GOBLIN_LOCATION,
    description: 'Тоннели, кишащие гоблинами и крысами.',
    identityText: 'Нашествие крыс: в бою возможны короткие кровотечения у обеих сторон.',
    hasCombatLocationEffect: true,
  },
  {
    id: 'fungal',
    name: FUNGAL_LOCATION,
    description: 'Влажные пещеры со спорами и троглодитами.',
    identityText: 'Споровый туман: начало боя может принести регенерацию герою и замедление врагу.',
    hasCombatLocationEffect: true,
  },
  {
    id: 'deserter',
    name: DESERTER_LOCATION,
    description: 'Разорённый лагерь бывших гильдейцев и мародёров.',
    identityText: 'Засады отступников: тактические враги чаще используют метки, уловки и контратаки.',
    hasCombatLocationEffect: false,
  },
];

export const WITHERING_FOREST_ID = 'withering_forest';
export const WITHERING_FOREST_NAME = 'Лес Увядания';
export const LEVEL_TWO_PROGRESSION = Object.freeze({
  strongEnemyUnlock: 7,
  bossUnlock: 14,
  roomPhaseMid: 7,
  roomPhaseLate: 14,
});

// Level-two entries stay out of AVAILABLE_LOCATIONS until their combat rosters
// exist, so the current encounter generator can never select unfinished data.
export const LEVEL_TWO_LOCATIONS = levelTwoLocations;

export const isLocationAvailable = location => location?.enabled === true;

export const getLocationByName = (locationName) =>
  [...AVAILABLE_LOCATIONS, ...LEVEL_TWO_LOCATIONS].find(location => location.name === locationName) || null;
