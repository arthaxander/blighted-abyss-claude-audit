import { fireEvent, render, screen } from '@testing-library/react';
import fs from 'fs';
import AltarRoomModal from './AltarRoomModal';
import { CURSE_DEFINITIONS, CURSE_IDS, getNextCurseTierPreview } from '../data/curses';

const curse = CURSE_DEFINITIONS[CURSE_IDS.CORRUPTION];

test('uses curse acceptance wording and requires a second confirmation for level III', () => {
  const onOffer = jest.fn();
  render(<AltarRoomModal curse={curse} currentTier={2} preview={getNextCurseTierPreview({ corruption: { tier: 2 } }, CURSE_IDS.CORRUPTION)} onOffer={onOffer} onClose={() => {}} />);
  expect(screen.getByRole('button', { name: 'Принять проклятие' })).toBeEnabled();
  expect(screen.queryByText(/Принести подношение/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Принять проклятие' }));
  expect(onOffer).not.toHaveBeenCalled();
  expect(screen.getByText(/станет главным до конца спуска/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить принятие' }));
  expect(onOffer).toHaveBeenCalledTimes(1);
});

test('uses curse-specific accent and compact sigil', () => {
  const { rerender } = render(<AltarRoomModal curse={curse} currentTier={0} preview={getNextCurseTierPreview({}, CURSE_IDS.CORRUPTION)} onOffer={() => {}} onClose={() => {}} />);
  const corruptionDialog = screen.getByRole('dialog');
  expect(corruptionDialog).toHaveAttribute('data-curse-sigil', curse.presentation.symbol);
  expect(screen.getAllByText(curse.presentation.symbol)[0]).toHaveStyle({ color: curse.presentation.accent });
  const distortion = CURSE_DEFINITIONS[CURSE_IDS.DISTORTION];
  rerender(<AltarRoomModal curse={distortion} currentTier={0} preview={getNextCurseTierPreview({}, CURSE_IDS.DISTORTION)} onOffer={() => {}} onClose={() => {}} />);
  expect(screen.getByRole('dialog')).toHaveAttribute('data-curse-sigil', distortion.presentation.symbol);
  expect(distortion.presentation).not.toEqual(curse.presentation);
});

test('shows the Abyss confirmation before level V and blocks an existing V', () => {
  const { rerender } = render(<AltarRoomModal curse={curse} currentTier={4} preview={getNextCurseTierPreview({ corruption: { tier: 4 } }, CURSE_IDS.CORRUPTION, CURSE_IDS.CORRUPTION)} onOffer={() => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Принять проклятие' }));
  expect(screen.getByText(/Обычная эвакуация станет невозможна/)).toBeInTheDocument();
  rerender(<AltarRoomModal curse={curse} currentTier={5} preview={getNextCurseTierPreview({ corruption: { tier: 5 } }, CURSE_IDS.CORRUPTION, CURSE_IDS.CORRUPTION)} onOffer={() => {}} onClose={() => {}} />);
  expect(screen.getByRole('button', { name: 'Принять проклятие' })).toBeDisabled();
  expect(screen.getByText(/уже достигло V уровня/)).toBeInTheDocument();
});


test('keeps tier copy in a fixed scrollable area and opens Echo through shared term help', () => {
  const undeath = CURSE_DEFINITIONS[CURSE_IDS.UNDEATH];
  render(<AltarRoomModal curse={undeath} currentTier={0} preview={getNextCurseTierPreview({}, CURSE_IDS.UNDEATH)} onOffer={() => {}} onClose={() => {}} />);
  const effect = screen.getByRole('region', { name: 'Эффект следующего уровня' });
  expect(effect.style.overflowY).toBe('auto');
  expect(fs.readFileSync('src/components/AltarRoomModal.js', 'utf8')).toContain("height: 'clamp(205px, 29vh, 255px)'");
  expect(screen.queryByText(/Несмертие III усиливает/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '[Эхо]' }));
  expect(screen.getByRole('dialog', { name: 'Статус: Эхо' })).toHaveTextContent('Момент повторения определяется источником Эха');
});


test('uses room artwork, compact level progression, and no large level cards', () => {
  render(<AltarRoomModal
    curse={curse}
    currentTier={0}
    preview={getNextCurseTierPreview({}, CURSE_IDS.CORRUPTION)}
    illustrationUrl="/assets/rooms/goblin_nests/altar.webp"
    onOffer={() => {}}
    onClose={() => {}}
  />);
  const art = screen.getByTestId('altar-illustration');
  expect(art.querySelector('img')).toHaveAttribute('src', '/assets/rooms/goblin_nests/altar.webp');
  expect(screen.getByLabelText('Уровень Проклятия: — → I')).toBeInTheDocument();
  expect(screen.queryByText('Текущий уровень')).not.toBeInTheDocument();
  expect(screen.queryByText('Следующий уровень')).not.toBeInTheDocument();
  expect(art).toHaveTextContent(curse.description);
});


test('uses the whole Mini App viewport instead of a nested modal card', () => {
  render(<AltarRoomModal curse={curse} currentTier={0} preview={getNextCurseTierPreview({}, CURSE_IDS.CORRUPTION)} onOffer={() => {}} onClose={() => {}} />);
  const dialog = screen.getByRole('dialog');
  const source = fs.readFileSync('src/components/AltarRoomModal.js', 'utf8');
  expect(dialog).toHaveAttribute('data-presentation', 'fullscreen');
  expect(dialog.style.width).toBe('100%');
  expect(source).toContain("height: '100dvh'");
  expect(dialog.style.borderRadius).toBe('0');
  expect(dialog.style.boxShadow).toBe('none');
});

test('keeps actions in a safe-area footer after the scrollable altar content', () => {
  render(<AltarRoomModal curse={curse} currentTier={0} preview={getNextCurseTierPreview({}, CURSE_IDS.CORRUPTION)} onOffer={() => {}} onClose={() => {}} />);
  const dialog = screen.getByRole('dialog');
  const content = screen.getByTestId('altar-main-content');
  const footer = screen.getByTestId('altar-action-footer');
  const source = fs.readFileSync('src/components/AltarRoomModal.js', 'utf8');

  expect(dialog.style.display).toBe('flex');
  expect(dialog.style.flexDirection).toBe('column');
  expect(content.style.overflowY).toBe('auto');
  expect(content.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(footer.style.marginTop).toBe('auto');
  expect(source).toContain('calc(16px + env(safe-area-inset-bottom))');
  expect(footer.style.position).toBe('');
  expect(screen.queryByText('Закрыть')).not.toBeInTheDocument();
});
