import fs from 'fs';

const read = path => fs.readFileSync(path, 'utf8');

test('fullscreen foreground fallback adds the control row to Telegram system safe top', () => {
  const css = read('src/index.css');
  expect(css).toContain('calc(var(--tg-safe-area-inset-top, 0px) + var(--telegram-fullscreen-control-row))');
  expect(css).toContain('max(var(--tg-content-safe-area-inset-top, 0px), calc(');
});

test.each([
  'src/components/guild/GuildShell.css',
  'src/components/DungeonScreen.css',
  'src/components/LocationSelectionScreen.css',
])('%s uses the one foreground-safe-top contract', path => {
  expect(read(path)).toContain('var(--app-foreground-safe-top)');
});

test('Field Craft inherits Dungeon foreground spacing without adding a second safe inset', () => {
  const dungeon = read('src/components/DungeonScreen.js');
  expect(dungeon).toContain('field-craft');
  expect(dungeon).not.toMatch(/field-craft[^}]*app-foreground-safe-top/s);
});
