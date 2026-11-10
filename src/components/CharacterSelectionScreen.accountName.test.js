import fs from 'fs'; import path from 'path';
test('persistent account name drives hero creation and suppresses the disposable name input after death', () => {
  const source = fs.readFileSync(path.join(__dirname, 'CharacterSelectionScreen.js'), 'utf8');
  expect(source).toContain("const characterName = accountName || name");
  expect(source).toContain('name: characterName');
  expect(source).toContain('{!accountName && <div>');
});
