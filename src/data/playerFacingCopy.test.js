import { abilities } from './abilities';
import { ABILITY_LIBRARY } from './abilityPresets';
import { CLASS_PASSIVES } from './classPassives';
import {
  ARCHER_PASSIVES,
  CLASS_PROGRESSION_DEFINITIONS,
  DEFENDER_PASSIVES,
  ELEMENTALIST_PASSIVES,
} from './classProgression';
import { CLASS_TALENT_SETS } from './classTalents.mjs';
import { equipment } from './equipment';
import { EQUIPMENT_DETAILS } from './itemDetailsPresentation';
import { ITEM_DATA } from './items';
import { LOCATION_EFFECTS } from './locationEffects';
import { EFFECT_LIBRARY } from '../utils/effects';

const LIVE_COPY_ROOTS = {
  abilities,
  abilityPresets: ABILITY_LIBRARY,
  classPassives: CLASS_PASSIVES,
  classProgression: CLASS_PROGRESSION_DEFINITIONS,
  progressionPassives: [DEFENDER_PASSIVES, ELEMENTALIST_PASSIVES, ARCHER_PASSIVES],
  talents: CLASS_TALENT_SETS,
  equipment,
  equipmentDetails: EQUIPMENT_DETAILS,
  items: ITEM_DATA,
  locationEffects: LOCATION_EFFECTS,
};

const walk = (value, path = 'root', seen = new Set(), result = []) => {
  if (value === null || value === undefined || typeof value === 'function') return result;
  if (typeof value !== 'object') return result;
  if (seen.has(value)) return result;
  seen.add(value);

  if (Array.isArray(value.descriptionParts)) result.push({ path: `${path}.descriptionParts`, parts: value.descriptionParts, fallback: value.description });
  if (Array.isArray(value.effectParts)) result.push({ path: `${path}.effectParts`, parts: value.effectParts, fallback: value.effect });
  Object.entries(value).forEach(([key, nested]) => walk(nested, `${path}.${key}`, seen, result));
  return result;
};

const collectDescriptions = (value, path = 'root', seen = new Set(), result = []) => {
  if (value === null || value === undefined || typeof value === 'function') return result;
  if (typeof value !== 'object') return result;
  if (seen.has(value)) return result;
  seen.add(value);

  ['description', 'flavor'].forEach(key => {
    if (typeof value[key] === 'string') result.push({ path: `${path}.${key}`, text: value[key] });
  });
  Object.entries(value).forEach(([key, nested]) => collectDescriptions(nested, `${path}.${key}`, seen, result));
  return result;
};

describe('player-facing copy consistency', () => {
  const structuredCopy = walk(LIVE_COPY_ROOTS);
  const descriptions = collectDescriptions(LIVE_COPY_ROOTS);

  test('every structured status reference resolves to the runtime registry', () => {
    const broken = structuredCopy.flatMap(({ path, parts }) => parts
      .filter(part => part && typeof part === 'object' && part.statusId)
      .filter(part => !EFFECT_LIBRARY[part.statusId])
      .map(part => `${path}: ${part.statusId}`));

    expect(broken).toEqual([]);
  });

  test('structured copy renders to plain text without broken values', () => {
    structuredCopy.forEach(({ path, parts }) => {
      const rendered = parts.map(part => typeof part === 'string' ? part : part?.text).join('');
      expect({ path, rendered }).toEqual({ path, rendered: expect.not.stringMatching(/undefined|null|\[object Object\]/) });
      expect({ path, rendered: rendered.trim() }).toEqual({ path, rendered: expect.stringMatching(/\S/) });
    });
  });

  test('structured copy stays in sync with its plain-text fallback', () => {
    const mismatches = structuredCopy.flatMap(({ path, parts, fallback }) => {
      const rendered = parts.map(part => typeof part === 'string' ? part : part?.text).join('');
      return typeof fallback === 'string' && fallback !== rendered ? [`${path}: ${fallback} !== ${rendered}`] : [];
    });
    expect(mismatches).toEqual([]);
  });

  test('live descriptions do not use implementation jargon or compact legacy terms', () => {
    const stale = descriptions.filter(({ text }) => /(?:\b(?:runtime|proc|hook)\b|\b(?:КД|ШХ|HP)\b|дебафф|бафф)/iu.test(text));
    expect(stale).toEqual([]);
  });
});
