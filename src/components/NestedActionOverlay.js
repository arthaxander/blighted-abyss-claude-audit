import React from 'react';
import { createPortal } from 'react-dom';

const NestedActionOverlay = ({ label, children, onClose, showDefaultCancel = true }) => {
  const content = <div className="nested-action-overlay" data-overlay-layer="child" role="dialog" aria-modal="true" aria-label={label} onClick={event => event.stopPropagation()}>
    <section className="nested-action-panel" data-overlay-layer="child-panel">{children}{showDefaultCancel && <button type="button" onClick={onClose}>Отмена</button>}</section>
  </div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
};
export default NestedActionOverlay;
