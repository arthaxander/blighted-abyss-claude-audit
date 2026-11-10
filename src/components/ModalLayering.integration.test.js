import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import EnemyDetailCard from './EnemyDetailCard';
import { DefenseInfoButton } from './DefenseInfoDialog';
import NestedActionOverlay from './NestedActionOverlay';
import ConfirmDialog from './ui/ConfirmDialog';

// CSS files are mocked by Jest; inspect their real layer contracts separately.
const readComponentCss = filename => readFileSync(join(__dirname, filename), 'utf8');
const layer = (css, pattern) => {
  const result = css.match(pattern);
  if (!result) throw new Error('Expected overlay CSS layer contract is missing');
  return Number(result[1]);
};

describe('nested overlay stacking and portal contracts', () => {
  test('status help escapes the enemy detail overlay and closes without closing the enemy', () => {
    const onClose = jest.fn();
    render(
      <div className="enemy-detail-overlay">
        <EnemyDetailCard enemy={{
          name: 'Сторож', hp: 100, maxHp: 100, abilities: [],
          effects: [{ id: 'poison', remainingTurns: 2 }],
        }} onClose={onClose} />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: '[Отравление]' }));
    const termDialog = screen.getByRole('dialog', { name: 'Статус: Отравление' });
    const helpLayer = termDialog.closest('.game-term-help-layer');
    expect(helpLayer.parentElement).toBe(document.body);
    expect(helpLayer).not.toBe(screen.getByRole('dialog', { name: 'Сторож' }).parentElement);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть описание статуса Отравление' }));
    expect(screen.queryByRole('dialog', { name: 'Статус: Отравление' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Сторож' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('defense help escapes the scrolling enemy card', () => {
    render(
      <div className="enemy-detail-overlay">
        <section className="enemy-detail-card">
          <DefenseInfoButton statKey="physDef" value={100} />
        </section>
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Физическая защита' }));
    const info = screen.getByRole('dialog', { name: 'Физическая защита' });
    expect(info.closest('.defense-info-overlay').parentElement).toBe(document.body);
    expect(info).toHaveTextContent('50%');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog', { name: 'Физическая защита' })).not.toBeInTheDocument();
  });

  test('quantity/rune child overlays and confirmations escape high-z crafting', () => {
    const closeChild = jest.fn();
    const closeConfirm = jest.fn();
    render(
      <div className="field-crafting-overlay">
        <NestedActionOverlay label="Выбор руны" onClose={closeChild}>
          <button type="button">Выбрать</button>
        </NestedActionOverlay>
        <ConfirmDialog title="Подтвердить" onConfirm={jest.fn()} onCancel={closeConfirm} />
      </div>
    );
    expect(screen.getByRole('dialog', { name: 'Выбор руны' }).parentElement).toBe(document.body);
    const confirmation = screen.getByText('Подтвердить').closest('div[style*="z-index"]');
    expect(confirmation.parentElement).toBe(document.body);
    expect(confirmation.style.zIndex).toBe('var(--overlay-layer-confirmation, 4600)');
    fireEvent.click(screen.getAllByRole('button', { name: 'Отмена' })[1]);
    // Both dialogs have their own cancel action; ensure the confirmation is independent.
    expect(closeConfirm).toHaveBeenCalledTimes(1);
    expect(closeChild).not.toHaveBeenCalled();
  });

  test('popovers are above every existing nested inventory and crafting surface', () => {
    const termCss = readComponentCss('GameTermHelp.css');
    const craftingCss = readComponentCss('FieldCraftingModal.css');
    const defenseCss = readComponentCss('EnemyDetailCard.css');
    const indexCss = readFileSync(join(__dirname, '../index.css'), 'utf8');

    const termZ = layer(indexCss, /--overlay-layer-game-term-help:\s*(\d+)/);
    const confirmZ = layer(indexCss, /--overlay-layer-confirmation:\s*(\d+)/);
    const defenseZ = layer(indexCss, /--overlay-layer-defense-info:\s*(\d+)/);
    const childZ = layer(indexCss, /--overlay-layer-nested-action:\s*(\d+)/);
    const craftingZ = layer(craftingCss, /\.field-crafting-overlay\s*\{[^}]*z-index:\s*(\d+)/);
    const itemZ = layer(craftingCss, /\.field-crafting-overlay\s*>\s*\.item-details-overlay\s*\{[^}]*z-index:\s*(\d+)/);

    expect(childZ).toBeGreaterThan(itemZ);
    expect(confirmZ).toBeGreaterThan(childZ);
    expect(defenseZ).toBeGreaterThan(confirmZ);
    expect(termZ).toBeGreaterThan(defenseZ);
    expect(termZ).toBeGreaterThan(craftingZ);
    expect(termCss).toContain('z-index:var(--overlay-layer-game-term-help,5000)');
    expect(defenseCss).toContain('z-index:var(--overlay-layer-defense-info,4800)');
  });
});
