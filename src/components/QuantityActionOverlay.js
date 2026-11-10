import React, { useEffect, useState } from 'react';
import NestedActionOverlay from './NestedActionOverlay';

const QuantityActionOverlay = ({ mode, itemName, storedQuantity, maxQuantity, quickQuantity, unitPrice, onConfirm, onClose }) => {
  const [quantity, setQuantity] = useState(1);
  useEffect(() => setQuantity(value => Math.min(Math.max(1, value), Math.max(1, maxQuantity))), [maxQuantity]);
  const withdrawal = mode === 'withdraw';
  return <NestedActionOverlay label={withdrawal ? 'Забрать предметы' : 'Продать предметы'} onClose={onClose} showDefaultCancel={false}>
    <div className="quantity-action"><h3>{withdrawal ? 'Забрать предметы' : 'Продать предметы'}</h3><strong>{itemName}</strong><p className="quantity-action__meta">В хранилище: {storedQuantity}</p>
    <div className="quantity-action-controls"><button type="button" aria-label="Уменьшить количество" onClick={() => setQuantity(value => Math.max(1, value - 1))}>−</button><output aria-label="Выбрано">{quantity}</output><button type="button" aria-label="Увеличить количество" onClick={() => setQuantity(value => Math.min(maxQuantity, value + 1))}>+</button></div>
    {!withdrawal && <p>Получите: {quantity * unitPrice} серебра</p>}
    {withdrawal && maxQuantity <= 0 && <p role="alert">В походном инвентаре нет места.</p>}
    <button className="quantity-action__primary" type="button" disabled={maxQuantity <= 0} onClick={() => onConfirm(quantity)}>{withdrawal ? 'Забрать' : 'Продать'}</button>
    <div className="quantity-action__secondary"><button type="button" disabled={withdrawal && quickQuantity <= 0} onClick={() => setQuantity(withdrawal ? quickQuantity : storedQuantity)}>{withdrawal ? 'Стак' : 'Макс.'}</button><button type="button" onClick={onClose}>Отмена</button></div></div>
  </NestedActionOverlay>;
};
export default QuantityActionOverlay;
