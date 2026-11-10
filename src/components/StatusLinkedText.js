import React from 'react';
import { GameTermText, getGameTermDefinition, VIRTUAL_GAME_TERMS } from './GameTermHelp';

export const VIRTUAL_STATUS_TERMS = Object.freeze({
  эхо: VIRTUAL_GAME_TERMS.mechanic_echo,
});

export const resolveStatusTerm = term => getGameTermDefinition(term);

const StatusLinkedText = ({ children, className = '' }) => (
  <GameTermText text={String(children ?? '')} className={className} />
);

export default StatusLinkedText;
