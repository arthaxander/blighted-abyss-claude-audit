import React from 'react';

const PickerActionFooter = ({ selected, confirmDisabled, confirmLabel = 'Вставить', onConfirm, onClose, onCancel, error }) => <>
  {error && <p className="game-picker-error" role="alert">{error}</p>}
  <footer className="game-picker-actions">
    <button className="is-primary" type="button" disabled={confirmDisabled ?? !selected} onClick={onConfirm}>{confirmLabel}</button>
    <button type="button" onClick={onCancel || onClose}>Отмена</button>
  </footer>
</>;

export default PickerActionFooter;
