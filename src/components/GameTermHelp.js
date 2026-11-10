import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { EFFECT_LIBRARY, getEffectDefinition } from '../utils/effects';
import './GameTermHelp.css';

const GameTermHelpContext = createContext(null);

const normalizeLabel = value => String(value || '').trim().toLocaleLowerCase('ru-RU');

export const VIRTUAL_GAME_TERMS = Object.freeze({
  mechanic_echo: {
    id: 'mechanic_echo',
    name: 'Эхо',
    icon: '◈',
    description: 'Повторяет результат способности с указанной эффективностью. Момент повторения определяется источником Эха. Эхо не может породить новое Эхо.',
    virtual: true,
  },
});

const VIRTUAL_TERM_IDS_BY_LABEL = Object.freeze({
  'эхо': 'mechanic_echo',
  'эха': 'mechanic_echo',
});

const termDefinitions = Object.values(EFFECT_LIBRARY).filter(term => term?.id && term?.name && term?.description);
const legacyTermIdsByLabel = termDefinitions.reduce((lookup, term) => {
  lookup[normalizeLabel(term.name)] = term.id;
  return lookup;
}, {
  'кровотечения': 'bleed', 'кровотечением': 'bleed',
  'горения': 'burn', 'горением': 'burn',
  'отравления': 'poison', 'отравлением': 'poison',
  'заморозки': 'freeze', 'заморозкой': 'freeze',
  'уязвимостью': 'vulnerability', 'щитом': 'shield',
  'мощным укреплением': 'phys_def_boost_major',
  'жажду': 'thirst', 'жажде': 'thirst', 'жажды': 'thirst',
  'преломлении': 'refraction', 'преломления': 'refraction',
  'опутыванию': 'entanglement', 'опутыванием': 'entanglement', 'опутывания': 'entanglement',
  'испепеляющее клеймо': 'searing_mark',
});

export const getGameTermDefinition = value => {
  const normalized = normalizeLabel(value);
  const virtualId = VIRTUAL_GAME_TERMS[value]?.id || VIRTUAL_TERM_IDS_BY_LABEL[normalized];
  if (virtualId) return VIRTUAL_GAME_TERMS[virtualId] || null;
  const effect = getEffectDefinition(value);
  if (effect) return effect;
  const aliasId = legacyTermIdsByLabel[normalized];
  return aliasId ? getEffectDefinition(aliasId) || VIRTUAL_GAME_TERMS[aliasId] || null : null;
};

export const resolveGameTermId = value => getGameTermDefinition(value)?.id || null;

export const parseGameTermText = text => {
  if (!text) return [text || ''];
  const parts = [];
  let cursor = 0;
  const pattern = /\[([^\]]+)\]/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const termId = resolveGameTermId(match[1]);
    parts.push(termId ? { statusId: termId, text: match[1] } : match[0]);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length ? parts : [text];
};

const GameTermHelpSurface = ({ term, onClose }) => {
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const surface = (
    <div className="game-term-help-layer" data-overlay-layer="game-term-help" data-presentation="centered" onClick={event => { event.stopPropagation(); onClose(); }}>
      <section className="game-term-help-card" data-presentation="compact-centered" role="dialog" aria-modal="true" aria-label={`Статус: ${term.name}`} onClick={event => event.stopPropagation()}>
        <header>
          <h3 id="game-term-help-title">{term.iconPath ? <img className="game-term-help-icon" src={term.iconPath} alt="" aria-hidden="true" /> : (term.icon ? <span aria-hidden="true">{term.icon}</span> : null)}{term.name}</h3>
          <button type="button" className="game-term-help-close" onClick={onClose} aria-label={`Закрыть описание статуса ${term.name}`}>×</button>
        </header>
        <p>{term.description}</p>
      </section>
    </div>
  );
  return typeof document === 'undefined' ? surface : createPortal(surface, document.body);
};

export const GameTermHelpProvider = ({ children }) => {
  const [termState, setTermState] = useState(null);
  const openTerm = useCallback((id, overrides = {}) => {
    const resolvedId = resolveGameTermId(id);
    setTermState(resolvedId ? { id: resolvedId, ...overrides } : null);
  }, []);
  const closeTerm = useCallback(() => setTermState(null), []);
  const value = useMemo(() => ({ openTerm, closeTerm }), [openTerm, closeTerm]);
  const definition = getGameTermDefinition(termState?.id);
  const term = definition
    ? {
        ...definition,
        name: termState?.nameOverride || definition.name,
        description: termState?.descriptionOverride || definition.description,
      }
    : null;
  return <GameTermHelpContext.Provider value={value}>
    {children}
    {term ? <GameTermHelpSurface term={term} onClose={closeTerm} /> : null}
  </GameTermHelpContext.Provider>;
};

export const GameTerm = ({ termId, children, descriptionOverride = null, nameOverride = null }) => {
  const help = useContext(GameTermHelpContext);
  const term = getGameTermDefinition(termId);
  if (!term || !help) return <>{children || term?.name || ''}</>;
  const label = String(children || term.name).replace(/^\[+|\]+$/g, '');
  return <button
    type="button"
    className="game-term-inline"
    data-presentation="inline-text"
    onPointerDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      help.openTerm(term.id, { descriptionOverride, nameOverride });
    }}
    title={`Открыть описание: ${nameOverride || term.name}`}
  >[{label}]</button>;
};

const GameTermTextContent = ({ parts, text, className = '' }) => {
  const resolvedParts = parts || parseGameTermText(text || '');
  return <div className={className}><p>{resolvedParts.map((part, index) => {
    if (typeof part === 'string') return <React.Fragment key={index}>{part}</React.Fragment>;
    const termId = resolveGameTermId(part?.statusId);
    if (!termId) return <React.Fragment key={index}>{part?.text || ''}</React.Fragment>;
    return <GameTerm
      termId={termId}
      descriptionOverride={part?.descriptionOverride || null}
      nameOverride={part?.nameOverride || null}
      key={`${termId}-${index}`}
    >{part?.text || getGameTermDefinition(termId)?.name}</GameTerm>;
  })}</p></div>;
};

export const GameTermText = props => {
  const help = useContext(GameTermHelpContext);
  return help ? <GameTermTextContent {...props} /> : <GameTermHelpProvider><GameTermTextContent {...props} /></GameTermHelpProvider>;
};

