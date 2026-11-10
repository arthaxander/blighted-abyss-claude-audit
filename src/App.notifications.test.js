import fs from 'fs';
import path from 'path';

test('ordinary expedition death transitions to character creation without the redundant defeat toast', () => {
  const source = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');
  const deathHandler = source.slice(source.indexOf('const handleDeath = () =>'), source.indexOf('const updatePlayerState'));
  expect(deathHandler).not.toContain("pushToast('Поражение'");
  expect(deathHandler).not.toContain('Все предметы потеряны');
  expect(deathHandler).toContain("clearTransientCombatState('defeat')");
  expect(deathHandler).toContain('createExpeditionDeathResult');
  expect(deathHandler).toContain('setPlayer(null)');
  expect(deathHandler).toContain("setCurrentScreen('deathSummary')");
});

test('routine quest, carry-over, and developer confirmations are removed while storage failures remain', () => {
  const source = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');
  expect(source).not.toContain("pushToast('Задания выполнены'");
  expect(source).not.toContain("pushToast('Награда получена'");
  expect(source).not.toContain("pushToast('Предметы перенесены'");
  expect(source).not.toContain('pushToast(`Класс изменён:');
  expect(source).toContain("pushToast('В Хранилище недостаточно места'");
  expect(source).toContain("'Награда недоступна'");
});

test('redundant rendered brand heading is absent while technical metadata remains separate', () => {
  const source = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');
  expect(source).not.toContain('<h1>Ashen Abyss</h1>');
  const metadata = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  expect(metadata).toContain('<title>Ashen Abyss</title>');
});
