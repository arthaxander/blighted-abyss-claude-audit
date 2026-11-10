import React, { useEffect, useState } from 'react';
import { formatCurseTierText } from '../data/curses';
import StatusLinkedText from './StatusLinkedText';

const romanTier = level => ['—', 'I', 'II', 'III', 'IV', 'V'][level] || String(level ?? '—');
const styles = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, padding: 0, boxSizing: 'border-box', background: '#17151b' },
  modal: { width: '100%', height: '100dvh', minHeight: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', overscrollBehavior: 'contain', padding: 0, border: 0, borderRadius: 0, background: 'linear-gradient(160deg, #251d2d, #17151b)', color: '#fff', boxShadow: 'none', boxSizing: 'border-box' },
  content: { width: '100%', maxWidth: 560, minHeight: 0, margin: '0 auto', padding: 'calc(max(16px, env(safe-area-inset-top)) + 30px) max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left))', display: 'flex', flexDirection: 'column', flex: '1 1 auto', overflowY: 'auto', boxSizing: 'border-box' },
  heading: { display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 0 10px' },
  sigil: { display: 'grid', placeItems: 'center', width: 38, height: 38, border: '1px solid currentColor', borderRadius: '50%', fontSize: 20, flex: '0 0 auto' },
  title: { margin: '6px 0 0', fontSize: 24, textAlign: 'center' },
  art: { position: 'relative', height: 'clamp(142px, 22vh, 190px)', borderRadius: 9, overflow: 'hidden', background: '#100d13', border: '1px solid rgba(255,255,255,.08)' },
  artImage: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  artFallback: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 42, opacity: .45 },
  lore: { position: 'absolute', left: 0, right: 0, bottom: 0, margin: 0, padding: '28px 14px 11px', fontSize: 12, lineHeight: 1.4, color: 'rgba(255,255,255,.82)', background: 'linear-gradient(transparent, rgba(8,7,10,.9))' },
  levels: { display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 10, marginTop: 10, color: '#cfc6d2' },
  levelValue: { fontSize: 19, fontWeight: 700, color: '#fff' },
  levelArrow: { opacity: .55, fontSize: 18 },
  label: { display: 'block', color: '#b9aeba', fontSize: 12, marginBottom: 5 },
  effect: { marginTop: 10, padding: 14, borderRadius: 8, background: '#201b25', borderLeft: '3px solid #a852d3', height: 'clamp(205px, 29vh, 255px)', overflowY: 'auto', overscrollBehavior: 'contain', boxSizing: 'border-box', scrollbarGutter: 'stable', fontSize: 16 },
  warning: { marginTop: 10, padding: 10, borderRadius: 8, color: '#ffd2a8', background: 'rgba(142,69,34,.25)', border: '1px solid #844d31', lineHeight: 1.4, fontSize: 13 },
  blocked: { color: '#ffaaa0', marginTop: 10 },
  actionFooter: { width: '100%', flex: '0 0 auto', marginTop: 'auto', padding: '12px max(16px, env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))', boxSizing: 'border-box' },
  buttons: { width: '100%', maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 },
  button: { padding: '11px 14px', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 15 },
  primary: { background: '#a844d1', color: '#fff', fontWeight: 700 }, secondary: { background: '#49434d', color: '#fff' },
};

const AltarRoomModal = ({ curse, currentTier, preview, choices = [], onSelect, illustrationUrl = null, onOffer, offerDisabled = false, onClose }) => {
  const [confirmation, setConfirmation] = useState(null);
  useEffect(() => setConfirmation(null), [curse?.id, preview?.nextTier]);
  if (!curse) return null;
  const presentation = curse.presentation || { symbol: '◇', accent: '#76518b', glow: 'rgba(82, 54, 96, .28)' };
  const needsConfirmation = preview?.requiresDominantConfirmation ? 'dominant' : preview?.bindsToAbyss ? 'abyss' : null;
  const confirmationText = confirmation === 'dominant'
    ? 'Это Проклятие станет главным до конца спуска. Другие Проклятия нельзя будет развить выше II уровня.'
    : confirmation === 'abyss' ? 'Проклятие свяжет героя с Бездной. Обычная эвакуация станет невозможна.' : null;
  const accept = () => {
    if (!preview?.canAccept || offerDisabled) return;
    if (needsConfirmation && confirmation !== needsConfirmation) setConfirmation(needsConfirmation);
    else onOffer();
  };
  return <div style={styles.overlay} role="presentation">
    <div data-curse-id={curse.id} data-curse-sigil={presentation.symbol} data-presentation="fullscreen" style={styles.modal} role="dialog" aria-modal="true" aria-labelledby="altar-title">
      <main style={styles.content} data-testid="altar-main-content">
        {choices.length > 1 && <section aria-label="Выбор проклятия" style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 8px', textAlign: 'center' }}>Выберите одно проклятие</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {choices.map(choice => <button key={choice.curse.id} type="button"
              aria-pressed={choice.curse.id === curse.id}
              disabled={offerDisabled}
              onClick={() => { setConfirmation(null); onSelect?.(choice.curse.id); }}
              style={{ ...styles.button, flex: 1, color: '#fff', background: choice.curse.id === curse.id ? '#634272' : '#302936', border: '1px solid ' + (choice.curse.id === curse.id ? '#c991de' : '#62566a') }}>
              {choice.curse.shortName} · {romanTier(choice.preview?.nextTier)}
            </button>)}
          </div>
        </section>}
        <header style={styles.heading}>
          <span style={{ ...styles.sigil, color: presentation.accent }} aria-hidden="true">{presentation.symbol}</span>
          <h3 id="altar-title" style={styles.title}>{curse.name}</h3>
        </header>
        <div style={styles.art} data-testid="altar-illustration">
          {illustrationUrl ? <img src={illustrationUrl} alt="" aria-hidden="true" style={styles.artImage} /> : null}
          {!illustrationUrl ? <span style={{ ...styles.artFallback, color: presentation.accent }} aria-hidden="true">{presentation.symbol}</span> : null}
          <p style={styles.lore}>{curse.description}</p>
        </div>
        <div style={styles.levels} aria-label={`Уровень Проклятия: ${romanTier(currentTier)} → ${preview?.nextTier ? romanTier(preview.nextTier) : '—'}`}>
          <span>Уровень</span>
          <strong style={styles.levelValue}>{romanTier(currentTier)}</strong>
          <span style={styles.levelArrow} aria-hidden="true">→</span>
          <strong style={{ ...styles.levelValue, color: presentation.accent }}>{preview?.nextTier ? romanTier(preview.nextTier) : '—'}</strong>
        </div>
        {preview?.tierData && <section style={{ ...styles.effect, borderLeftColor: presentation.accent }} aria-label="Эффект следующего уровня">
          <span style={styles.label}>Уровень {romanTier(preview.nextTier)}</span>
          <strong>{preview.tierData.title}</strong>
          <div style={{ marginBottom: 0, lineHeight: 1.5 }}><StatusLinkedText>{formatCurseTierText(preview.tierData)}</StatusLinkedText></div>
        </section>}
        {confirmationText && <div style={styles.warning} role="alert"><strong>Подтвердите выбор</strong><br />{confirmationText}</div>}
        {!confirmationText && preview?.requiresDominantConfirmation && <div style={styles.warning}>Уровень III сделает это Проклятие главным до конца спуска.</div>}
        {!confirmationText && preview?.bindsToAbyss && <div style={styles.warning}>Уровень V свяжет героя с Бездной.</div>}
        {!preview?.canAccept && <p style={styles.blocked} role="alert">{preview?.blockedReason}</p>}
      </main>
      <footer style={styles.actionFooter} data-testid="altar-action-footer">
        <div style={styles.buttons}>
          <button type="button" style={{ ...styles.button, ...styles.primary, ...(!preview?.canAccept || offerDisabled ? { opacity: .5, cursor: 'not-allowed' } : {}) }} onClick={accept} disabled={!preview?.canAccept || offerDisabled}>
            {offerDisabled ? 'Проклятие принимается...' : confirmationText ? 'Подтвердить принятие' : 'Принять проклятие'}
          </button>
          {confirmationText && <button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={() => setConfirmation(null)}>Назад</button>}
          <button type="button" style={{ ...styles.button, ...styles.secondary }} onClick={onClose}>Уйти</button>
        </div>
      </footer>
    </div>
  </div>;
};

export default AltarRoomModal;

