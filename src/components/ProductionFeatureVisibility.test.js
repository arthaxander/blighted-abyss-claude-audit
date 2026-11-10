import fs from 'fs'; import path from 'path';
test('Arena and Fortune Teller have no production render entry points while dormant code may remain', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  const guild = fs.readFileSync(path.join(__dirname, 'GuildScreen.js'), 'utf8');
  expect(app).not.toContain("currentScreen === 'arena' && player");
  expect(app).not.toContain('>\n            Арена\n');
  expect(guild).not.toContain("setActiveTab('tarot')");
  expect(guild).not.toContain("activeTab === 'tarot'");
});
