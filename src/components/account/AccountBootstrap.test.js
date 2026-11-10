import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { authenticateTelegram, createSerializedSaveQueue, loadAccount, resetAccountSave } from '../../services/accountApi';
import AccountBootstrap, { clearLegacyGameplaySaves, getTelegramInitData, LEGACY_GAMEPLAY_KEYS, loadAccountWithRetry } from './AccountBootstrap';

jest.mock('../../services/accountApi', () => ({
  authenticateTelegram: jest.fn(), authenticateDev: jest.fn(), loadAccount: jest.fn(),
  createSerializedSaveQueue: jest.fn(() => ({ enqueue: jest.fn() })), setAccountName: jest.fn(), resetAccountSave: jest.fn(),
}));

test('authentication reads only raw Telegram initData', () => {
  expect(getTelegramInitData({ Telegram: { WebApp: { initData: 'signed-raw', initDataUnsafe: { user: { id: 1 } } } } })).toBe('signed-raw');
  expect(getTelegramInitData({ Telegram: { WebApp: { initDataUnsafe: { user: { id: 1 } } } } })).toBe('');
});

test('successful bootstrap cleanup removes only legacy gameplay keys', () => {
  const storage = { removeItem: jest.fn() }; clearLegacyGameplaySaves(storage);
  expect(storage.removeItem.mock.calls.map(([key]) => key)).toEqual(LEGACY_GAMEPLAY_KEYS);
  expect(storage.removeItem).not.toHaveBeenCalledWith('ui-theme');
});

test('bootstrap verifies the session with account load before starting the game', async () => {
  window.Telegram = { WebApp: { initData: 'signed-raw' } };
  authenticateTelegram.mockResolvedValue({ account: { revision: 1 } });
  loadAccount.mockResolvedValue({ account: { revision: 1, gameName: 'Игрок', save: null } });
  render(<AccountBootstrap><div>Игра запущена</div></AccountBootstrap>);
  await screen.findByText('Игра запущена');
  expect(authenticateTelegram).toHaveBeenCalledWith('signed-raw');
  expect(loadAccount).toHaveBeenCalledTimes(1);
  expect(authenticateTelegram.mock.invocationCallOrder[0]).toBeLessThan(loadAccount.mock.invocationCallOrder[0]);
  delete window.Telegram;
});

test('bootstrap identifies a lost cookie after successful Telegram authentication', async () => {
  window.Telegram = { WebApp: { initData: 'signed-raw' } };
  authenticateTelegram.mockResolvedValue({ account: { revision: 1 } });
  loadAccount.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401, code: 'unauthorized' }));
  render(<AccountBootstrap><div>Игра запущена</div></AccountBootstrap>);
  await waitFor(() => expect(screen.getByText(/Сессия входа не сохранилась/)).toBeInTheDocument());
  expect(screen.queryByText('Игра запущена')).not.toBeInTheDocument();
  delete window.Telegram;
});

test('bootstrap shows Telegram-specific error for a readable auth 401', async () => {
  window.Telegram = { WebApp: { initData: 'signed-raw' } };
  authenticateTelegram.mockRejectedValue(Object.assign(new Error('invalid-hash'), { status: 401, code: 'invalid-hash' }));
  render(<AccountBootstrap><div>Игра запущена</div></AccountBootstrap>);
  await waitFor(() => expect(screen.getByText(/Telegram не подтвердил вход/)).toBeInTheDocument());
  expect(screen.queryByText('Игра запущена')).not.toBeInTheDocument();
  delete window.Telegram;
});


test('guest mode starts without Telegram or server save requests', async () => {
  authenticateTelegram.mockClear();
  loadAccount.mockClear();
  delete window.Telegram;
  render(<AccountBootstrap><div>Игра запущена</div></AccountBootstrap>);
  await screen.findByRole('button', { name: 'Войти без сохранения' });
  expect(authenticateTelegram).not.toHaveBeenCalled();
  expect(loadAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Войти без сохранения' }));
  expect(await screen.findByText('Игра запущена')).toBeInTheDocument();
});

test('transient loading failures are retried, but authentication errors are not',async()=>{
 const wait=jest.fn(()=>Promise.resolve());
 const recoverable=Object.assign(new Error('unreachable'),{code:'api-unreachable'});
 const load=jest.fn().mockRejectedValueOnce(recoverable).mockRejectedValueOnce(Object.assign(new Error('proxy'),{status:503})).mockResolvedValue({account:{revision:3}});
 await expect(loadAccountWithRetry(load,wait)).resolves.toEqual({account:{revision:3}});
 expect(load).toHaveBeenCalledTimes(3);
 expect(wait.mock.calls).toEqual([[500],[1500]]);
 const rejected=jest.fn().mockRejectedValue(Object.assign(new Error('unauthorized'),{status:401}));
 await expect(loadAccountWithRetry(rejected,wait)).rejects.toMatchObject({status:401});
 expect(rejected).toHaveBeenCalledTimes(1);
});

test('corrupt server JSON is never mistaken for a fresh account and requires confirmed reset',async()=>{
 // Restore the queue mock explicitly: React Scripts/Jest may reset mock factories.
 createSerializedSaveQueue.mockImplementation(() => ({ enqueue: jest.fn(), replace: jest.fn() }));
 window.Telegram={WebApp:{initData:'signed-recovery'}};
 authenticateTelegram.mockResolvedValue({account:{revision:7}});
 loadAccount.mockResolvedValue({account:{gameName:'Следопыт',save:null,saveCorrupt:true,revision:7}});
 resetAccountSave.mockResolvedValue({account:{gameName:'Следопыт',save:null,saveCorrupt:false,revision:8}});
 render(<AccountBootstrap><div>Игра запущена</div></AccountBootstrap>);
 await screen.findByText('Повреждено серверное сохранение');
 expect(screen.queryByText('Игра запущена')).not.toBeInTheDocument();
 expect(resetAccountSave).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Начать заново'}));
 expect(resetAccountSave).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Сбросить прогресс'}));
 await screen.findByText('Игра запущена');
 expect(resetAccountSave).toHaveBeenCalledWith(7);
 delete window.Telegram;
});

test('unreachable server is not treated as corrupted JSON or an invitation to reset',async()=>{
 window.Telegram={WebApp:{initData:'signed-network'}};
 authenticateTelegram.mockResolvedValue({account:{revision:1}});
 loadAccount.mockRejectedValue(Object.assign(new Error('offline'),{code:'api-unreachable'}));
 const wait=jest.fn(()=>Promise.resolve());
 // Test retry decision without waiting for real backoff timers.
 await expect(loadAccountWithRetry(loadAccount,wait)).rejects.toMatchObject({code:'api-unreachable'});
 expect(wait).toHaveBeenCalledTimes(2);
 delete window.Telegram;
});
