import React from 'react';
import { findItemData } from '../data/items';
import { hideMissingItemArt, resolveItemArt } from '../data/itemArt';
import './DeathSummary.css';

const DeathSummary = ({ preservedStacks = [], insurance, cause, onContinue }) => <div className="death-summary-overlay" role="dialog" aria-modal="true" aria-label={cause === 'abyss-link-severed' ? 'Связь с Бездной разорвана' : 'Поражение'}>
  <section className="death-summary-panel">
    <h1>{cause === 'abyss-link-severed' ? 'Связь с Бездной разорвана' : 'Поражение'}</h1>
    {cause === 'abyss-link-severed' && <p>Тело осталось в Бездне. Сохранены только предметы из безопасных ячеек.</p>}
    {preservedStacks.length ? <>
      <h2>Сохранено</h2> <ul className="death-summary-items" aria-label="Сохранённые предметы">{preservedStacks.map((stack, index) => { const definition = findItemData(stack.itemId); const art = resolveItemArt(definition || stack); return <li key={stack.instanceId || `${stack.itemId}-${index}`} aria-label={`${stack.itemId}, количество ${stack.quantity || 1}`}>{art ? <img src={art} alt="" aria-hidden="true" onError={hideMissingItemArt} /> : <span>{stack.itemId}</span>}{(stack.quantity || 1) > 1 && <b className="item-icon-quantity">{stack.quantity}</b>}</li>; })}</ul>
    </> : <p>Ничего не сохранено</p>}
    {insurance?.successful && <p>Гильдейская страховка сохранила «{insurance.insuredStack?.itemId}» сверх безопасных ячеек.</p>}
    <button className="ui-action--primary" type="button" onClick={onContinue}>Продолжить</button>
  </section>
</div>;
export default DeathSummary;
