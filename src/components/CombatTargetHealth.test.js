import fs from 'fs'; import path from 'path';
test('target affordance keeps CSS highlighting without replacing HP with ЦЕЛЬ', () => {
  const css = fs.readFileSync(path.join(__dirname, 'CombatScreen.css'), 'utf8');
  expect(css).toContain('.combat-unit-card.is-valid-target');
  expect(css).not.toContain('content: "ЦЕЛЬ"');
});
