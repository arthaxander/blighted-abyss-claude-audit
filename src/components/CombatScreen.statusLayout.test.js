import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, 'CombatScreen.css'), 'utf8');

describe('combat status layout contract', () => {
  test('uses one canonical 26px icon footprint for icons and overflow', () => {
    expect(css).toMatch(/\.battle-screen\s*\{[^}]*--status-icon-size:\s*26px/);
    expect(css.match(/--status-icon-size:\s*\d+px/g)).toEqual(['--status-icon-size: 26px']);
    expect(css).toMatch(/\.status-icon\s*\{[^}]*width:\s*var\(--status-icon-size\)[^}]*height:\s*var\(--status-icon-size\)/);
    expect(css).toMatch(/\.status-overflow\s*\{[^}]*width:\s*var\(--status-icon-size\)[^}]*height:\s*var\(--status-icon-size\)/);
  });

  test('centers wrapped real items rather than reserving fixed grid cells', () => {
    const overlayRule = css.match(/(?:^|\n)\.status-overlay\s*\{[^}]+\}/)?.[0];
    expect(overlayRule).toContain('display: flex');
    expect(overlayRule).toContain('flex-wrap: wrap');
    expect(overlayRule).toContain('justify-content: center');
    expect(overlayRule).not.toMatch(/grid-template-columns|min-height/);
  });

  test('keeps battlefield status chrome lightweight and unclipped', () => {
    const overlayRule = css.match(/(?:^|\n)\.status-overlay\s*\{[^}]+\}/)?.[0];
    expect(overlayRule).toContain('overflow: visible');
    expect(overlayRule).toContain('background: none');
    expect(overlayRule).not.toContain('linear-gradient');
    expect(css).toMatch(/\.status-icon img\s*\{[^}]*border-radius:\s*inherit/);
  });

  test('keeps combat turn meters visual-only without permanent speed or percent captions', () => {
    const screenSource = fs.readFileSync(path.join(__dirname, 'CombatScreen.js'), 'utf8');
    expect(screenSource).not.toContain('className="turn-caption"');
    expect(screenSource).not.toContain('Скорость {speed}');
    expect(css).not.toMatch(/\.turn-caption\s*\{/);
  });

  test('carries impact tier into contact VFX and distinct number/reaction weight', () => {
    const screenSource = fs.readFileSync(path.join(__dirname, 'CombatScreen.js'), 'utf8');
    expect(screenSource).toContain('combat-impact-vfx is-impact-${event.impactTier || "light"}');
    expect(css).toMatch(/\.combat-impact-vfx\.is-impact-heavy::after/);
    expect(css).toMatch(/@keyframes combat-impact-heavy-contact/);
    expect(css).toMatch(/@keyframes combat-float-medium/);
    expect(css).toMatch(/\.combat-float-number\.is-impact-heavy[^}]*font-weight:\s*900/);
  });

  test('keeps combat input locked through the readable feedback settle', () => {
    const screenSource = fs.readFileSync(path.join(__dirname, 'CombatScreen.js'), 'utf8');
    expect(screenSource).toContain('const PRESENTATION_INTERACTION_SETTLE_TAIL = 760;');
    expect(screenSource).toContain('PRESENTATION_INTERACTION_SETTLE_TYPES.has(event.type)');
    expect(screenSource).toContain('const interactionDuration = Math.max(duration, latestSettleAt);');
    expect(screenSource).toContain('}, interactionDuration);');
  });

  test('keeps impact numbers slightly behind the contact frame', () => {
    const screenSource = fs.readFileSync(path.join(__dirname, 'CombatScreen.js'), 'utf8');
    expect(screenSource).toContain('const IMPACT_NUMBER_DELAY = 70;');
    expect(screenSource).toContain('event.at + IMPACT_NUMBER_DELAY');
    expect(screenSource).toContain('IMPACT_NUMBER_DELAY + COMBAT_PRESENTATION_TIMING.floatingDuration');
  });

  test('keeps target-selection chrome below combat impact weight', () => {
    const validRule = css.match(/\.combat-unit-card\.is-valid-target\s*\{[^}]+\}/)?.[0];
    const hoveredRule = css.match(/\.combat-unit-card\.is-hovered-target\s*\{[^}]+\}/)?.[0];
    expect(validRule).toContain('outline: 1px dashed');
    expect(validRule).toContain('0 0 6px');
    expect(hoveredRule).toContain('outline: 2px solid');
    expect(hoveredRule).toContain('0 0 12px');
    expect(hoveredRule).toContain('translateY(-2px)');
  });

  test('keeps presented action icons subordinate to the portrait', () => {
    const defaultRule = css.match(/\.combat-enemy-action-icon\s*\{[^}]+\}/)?.[0];
    const compactRule = css.match(/\.enemy-party-quad \.combat-enemy-action-icon, \.enemy-party-swarm \.combat-enemy-action-icon\s*\{[^}]+\}/)?.[0];
    expect(defaultRule).toContain('top: 42%');
    expect(defaultRule).toContain('width: clamp(43px, 12.5vw, 50px)');
    expect(compactRule).toContain('width: clamp(35px, 9vw, 40px)');
  });

  test('keeps actor focus lightweight and biased toward battlefield center', () => {
    const focusRule = css.match(/\.combat-actor-focus\s*\{[^}]+\}/)?.[0];
    const friendlyRule = css.match(/\.combat-actor-focus\.is-player, \.combat-actor-focus\.is-ally\s*\{[^}]+\}/)?.[0];
    const enemyRule = css.match(/\.combat-actor-focus\.is-enemy\s*\{[^}]+\}/)?.[0];
    expect(focusRule).toContain('inset:-3px');
    expect(friendlyRule).toContain('--actor-focus-shift:-2px');
    expect(enemyRule).toContain('--actor-focus-shift:2px');
    expect(css).toContain('transform:translateY(var(--actor-focus-shift)) scale(1.014)');
  });

  test('keeps distinct angular badges and the unremovable contour', () => {
    expect(css).toMatch(/\.status-stack-count\s*\{/);
    expect(css).toMatch(/\.status-turn-count\s*\{/);
    expect(css).toMatch(/\.status-stack-count, \.status-turn-count\s*\{[^}]*border-radius:\s*2px/);
    expect(css).toMatch(/\.status-icon--unremovable\s*\{[^}]*outline:/);
  });

  test('uses the same square geometry for buffs and debuffs in all status lists', () => {
    expect(css).toMatch(/\.status-icon\s*\{[^}]*border-radius:\s*5px/);
    expect(css).not.toMatch(/\.status-icon--buff\s*\{[^}]*border-radius:\s*50%/);
    expect(css).not.toMatch(/\.status-icon--debuff\s*\{[^}]*clip-path:/);

    const detailCss = fs.readFileSync(path.join(__dirname, 'EnemyDetailCard.css'), 'utf8');
    expect(detailCss).toMatch(/\.player-combat-status__icon\s*\{[^}]*border-radius:5px/);
    expect(detailCss).not.toMatch(/\.player-combat-status__icon--buff\s*\{[^}]*border-radius:\s*50%/);
    expect(detailCss).not.toMatch(/\.player-combat-status__icon--debuff\s*\{[^}]*clip-path:/);
  });
});
