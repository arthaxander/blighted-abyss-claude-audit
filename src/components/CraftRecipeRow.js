import React from 'react';
import { hideMissingItemArt, resolveItemArt } from '../data/itemArt';
// Both Guild crafting and expedition crafting use the same visual row and item inspectors.
import './guild/GuildShell.css';

const CraftRecipeRow = ({
  name,
  itemName = name,
  ingredients = [],
  ownedCounts = {},
  craftable = false,
  onInspectItem,
  onCraft,
  disabled = false,
  unavailableReason,
  testId = 'recipe-cell',
}) => {
  const resultArt = resolveItemArt(itemName);
  return <article role="listitem" data-testid={testId}
    className={`guild-recipe-row${craftable ? '' : ' is-disabled'}`}>
    <button type="button" className="guild-recipe-result"
      aria-label={`Подробнее: ${name}`}
      onClick={() => onInspectItem?.(itemName)}>
      {resultArt ? <img src={resultArt} alt="" onError={hideMissingItemArt} />
        : <span className="craft-recipe-art-placeholder" aria-hidden="true">◇</span>}
    </button>
    <strong className="guild-recipe-name">{name}</strong>
    <button type="button" className="guild-recipe-craft"
      aria-label={`Создать: ${name}`}
      title={craftable ? `Создать: ${name}` : unavailableReason || 'Недостаточно ингредиентов'}
      disabled={!craftable || disabled}
      onClick={onCraft}>⚒</button>
    <ul className="guild-recipe-ingredients" aria-label={`Материалы: ${name}`}>
      {ingredients.map(req => {
        const count = ownedCounts[req.name] || 0;
        const art = resolveItemArt(req.name);
        return <li key={req.name} className={count < req.quantity ? 'is-missing' : ''}>
          <button type="button" aria-label={`Подробнее: ${req.name}`} onClick={() => onInspectItem?.(req.name)}>
            {art ? <img src={art} alt="" onError={hideMissingItemArt} />
              : <span aria-hidden="true">◇</span>}
            <b>{count}/{req.quantity}</b>
          </button>
        </li>;
      })}
    </ul>
  </article>;
};

export default CraftRecipeRow;
