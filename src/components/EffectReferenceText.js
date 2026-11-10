import React from 'react';
import { EFFECT_IDS } from '../utils/effects';
import { GameTermText, parseGameTermText } from './GameTermHelp';

const EffectReferenceText = ({ parts, className = '' }) => {
  // Keep explicit [status] syntax and structured status parts intact, while
  // linking known effects mentioned by name in older equipment descriptions.
  const expanded = (parts || []).flatMap(part =>
    typeof part === 'string'
      ? parseGameTermText(part).flatMap(token => typeof token === 'string' ? effectTextToParts(token) : [token])
      : [part]
  );
  return <GameTermText parts={expanded} className={className} />;
};

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EFFECT_TEXT_ALIASES = {
  'Печать защиты': 'protection_seals',
  'Печати защиты': 'protection_seals',
  Кровотечения: EFFECT_IDS.Кровотечение,
  Кровотечением: EFFECT_IDS.Кровотечение,
  Горения: EFFECT_IDS.Горение,
  Горением: EFFECT_IDS.Горение,
  Отравления: EFFECT_IDS.Отравление,
  Отравлением: EFFECT_IDS.Отравление,
  Регенерацией: EFFECT_IDS.Регенерация,
  Заморозки: EFFECT_IDS.Заморозка,
  Заморозкой: EFFECT_IDS.Заморозка,
  Оберегом: EFFECT_IDS.Оберег,
  Щиту: 'shield',
  Щит: 'shield',
  Шок: 'shock',
  'Стихийная уязвимость': 'elemental_magic_vulnerability',
  Невидимостью: 'invisibility',
  Невидимость: 'invisibility',
  Слепоту: 'blind',
  Слепота: 'blind',
  'Метка вампира': 'vampire_mark',
  'Метку вампира': 'vampire_mark',
  'Проклятие истощения': 'curse_of_exhaustion',
  'Боевой ритм': 'combat_rhythm',
  'Боевого ритма': 'combat_rhythm',
  Подготовку: 'preparation',
  Подготовка: 'preparation',
};
const referenceIds = { ...EFFECT_IDS, ...EFFECT_TEXT_ALIASES };
const effectNames = Object.keys(referenceIds).filter(name => name.length > 3).sort((a, b) => b.length - a.length);
const effectPattern = effectNames.length ? new RegExp(`(${effectNames.map(escapePattern).join('|')})`, 'g') : null;

export const effectTextToParts = text => {
  if (!text || !effectPattern) return [text || ''];
  return text.split(effectPattern).filter(Boolean).map(part => (
    referenceIds[part] ? { statusId: referenceIds[part], text: part } : part
  ));
};

export default EffectReferenceText;

