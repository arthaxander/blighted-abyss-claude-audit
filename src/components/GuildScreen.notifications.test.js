import fs from 'fs';
import path from 'path';

test('routine craft and relic success popups stay removed while warning feedback remains', () => {
  const source = fs.readFileSync(path.join(__dirname, 'GuildScreen.js'), 'utf8');
  expect(source).not.toContain("pushToast('Предмет создан'");
  expect(source).not.toContain("pushToast('Активна реликвия'");
  expect(source).not.toContain('Активная реликвия:');
  expect(source).toContain("pushToast('Недостаточно материалов', { tone: 'warning' })");
  expect(source).toContain("pushToast('Не удалось вставить руну', { tone: 'warning' })");
});
