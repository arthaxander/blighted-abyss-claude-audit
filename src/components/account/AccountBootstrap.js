import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountContext } from '../../contexts/AccountContext';
import { authenticateDev, authenticateTelegram, createSerializedSaveQueue, loadAccount, resetAccountSave, setAccountName } from '../../services/accountApi';

export const LEGACY_GAMEPLAY_KEYS = ['ashenAbyssSave', 'ashenAbyssArenaRegistry'];
export const clearLegacyGameplaySaves = storage => LEGACY_GAMEPLAY_KEYS.forEach(key => storage?.removeItem(key));
export const getTelegramInitData = target => target?.Telegram?.WebApp?.initData || '';
const monotonicNow = () => window.performance?.now?.() ?? Date.now();
const retryableLoadError = error => ['api-unreachable', 'api-timeout'].includes(error?.code) || [502, 503, 504].includes(error?.status);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const loadAccountWithRetry = async (load = loadAccount, wait = pause) => {
  for (let attempt = 0; ; attempt += 1) {
    try { return await load(); }
    catch (error) {
      if (attempt >= 2 || !retryableLoadError(error)) throw error;
      await wait(attempt === 0 ? 500 : 1500);
    }
  }
};

const BlockingState = ({ title, description, retry, guest }) => <main className="account-bootstrap"><h1>{title}</h1><p>{description}</p>{retry && <button type="button" onClick={retry}>Повторить</button>}{guest && <><button type="button" onClick={guest}>Войти без сохранения</button><p><small>Тестовый режим: вход, загрузка и сохранение прогресса не используют Telegram/сервер; после перезагрузки прогресс исчезнет.</small></p></>}</main>;
const bootstrapFailure = (stage, error) => {
  console.error('[account-bootstrap]', stage, { code: error.code || error.message, status: error.status || null });
  if (error.code === 'api-unreachable' || error.code === 'api-timeout') return 'Сервер сохранений не отвечает. Прогресс не удалён. Проверьте подключение и повторите позже.';
  if (stage === 'telegram-auth' && (error.status === 400 || error.status === 401)) return 'Telegram не подтвердил вход. Закройте игру, откройте её заново и повторите.';
  if (stage === 'account-load' && error.status === 401) return 'Сессия входа не сохранилась. Закройте игру, откройте её заново и повторите.';
  if (error.status >= 500) return 'Сервер временно не смог загрузить сохранение. Повторите позже.';
  return 'Не удалось загрузить сохранение. Повторите попытку.';
};
const NameSetup = ({ onSubmit, error }) => { const [name, setName] = useState(''); return <main className="account-bootstrap"><h1>Имя игрока</h1><p>Выберите имя профиля. Оно сохранится для всех ваших устройств.</p><form onSubmit={event => { event.preventDefault(); onSubmit(name); }}><input aria-label="Имя игрока" value={name} maxLength={48} onChange={event => setName(event.target.value)} /><button type="submit">Продолжить</button></form>{error && <p role="alert">{error}</p>}</main>; };

const AccountBootstrap = ({ children }) => {
  const [state, setState] = useState({ status: 'initializing', account: null, error: null });
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const queueRef = useRef(null);
  const serverClockRef = useRef({ epochMs: Date.now(), monotonicMs: monotonicNow() });
  const enterGuestMode = useCallback(() => {
    queueRef.current = null;
    serverClockRef.current = { epochMs: Date.now(), monotonicMs: monotonicNow() };
    setState({
      status: 'guest',
      account: { gameName: 'DEV', save: null, revision: 0 },
      error: null,
    });
  }, []);
  const bootstrap = useCallback(async () => {
    setResetConfirmation(false);
    setState({ status: 'authenticating', account: null, error: null });
    let stage = 'telegram-auth';
    try {
      const initData = getTelegramInitData(window);
      const devAllowed = process.env.NODE_ENV !== 'production' && process.env.REACT_APP_DEV_AUTH === 'true';
      if (!initData && !devAllowed) { setState({ status: 'telegram-required', account: null, error: null }); return; }
      await (initData ? authenticateTelegram(initData) : authenticateDev());
      stage = 'account-load';
      const result = await loadAccountWithRetry();
      const serverEpochMs = Date.parse(result.serverTime);
      serverClockRef.current = { epochMs: Number.isFinite(serverEpochMs) ? serverEpochMs : Date.now(), monotonicMs: monotonicNow() };
      // Preserve any legacy browser data when the server payload is unreadable.
      if (!result.account.saveCorrupt) clearLegacyGameplaySaves(window.localStorage);
      queueRef.current = createSerializedSaveQueue({ initialRevision: result.account.revision, onConflict: account => setState({ status: 'error', account, error: 'Сохранение изменилось на другом устройстве. Перезапустите игру.' }) });
      setState({ status: result.account.saveCorrupt ? 'corrupt-save' : (result.account.gameName ? 'ready' : 'name'), account: result.account, error: null });
    } catch (error) { setState({ status: 'error', account: null, error: bootstrapFailure(stage, error) }); }
  }, []);
  useEffect(() => { bootstrap(); }, [bootstrap]);
  const resetGameState = useCallback(async () => {
    if (!state.account || !queueRef.current) throw new Error('account-not-ready');
    const response = await resetAccountSave(state.account.revision);
    const recovered = response.account;
    queueRef.current = createSerializedSaveQueue({
      initialRevision: recovered.revision,
      onConflict: account => setState({ status: 'error', account, error: 'Сохранение изменилось на другом устройстве. Перезапустите игру.' }),
    });
    setState(previous => ({ ...previous, account: recovered }));
    return recovered;
  }, [state.account]);

  const confirmCorruptSaveReset = useCallback(async () => {
    if (!state.account?.saveCorrupt || resetBusy) return;
    setResetBusy(true);
    try {
      const recovered = await resetGameState();
      setResetConfirmation(false);
      setState({ status: recovered.gameName ? 'ready' : 'name', account: recovered, error: null });
    } catch (error) {
      console.warn('[account-reset-failed]', { code: error?.code || error?.message || 'unknown', status: error?.status || null });
      setResetConfirmation(false);
      setState(previous => ({ ...previous, error: retryableLoadError(error)
        ? 'Сервер сейчас недоступен. Сохранение не было сброшено.'
        : error.status === 409
          ? 'Версия сохранения изменилась. Повторите загрузку аккаунта перед сбросом.'
          : 'Не удалось сбросить повреждённое сохранение. Повторите позже.' }));
    } finally { setResetBusy(false); }
  }, [state.account, resetBusy, resetGameState]);
  const getServerNow = useCallback(() => {
    const clock = serverClockRef.current;
    return clock.epochMs + Math.max(0, monotonicNow() - clock.monotonicMs);
  }, []);
  const saveGameState = useCallback(save => queueRef.current?.enqueue(save, 1), []);
  const replaceGameState = useCallback(async save => {
    const account = await queueRef.current?.replace(save, 1);
    if (account) setState(previous => ({ ...previous, account }));
    return account;
  }, []);
  const value = useMemo(() => ({
    account: state.account,
    authoritative: state.status !== 'guest',
    saveGameState: state.status === 'guest' ? null : saveGameState,
    replaceGameState: state.status === 'guest' ? null : replaceGameState,
    resetGameState: state.status === 'guest' ? null : resetGameState,
    getServerNow,
  }), [state.account, state.status, saveGameState, replaceGameState, resetGameState, getServerNow]);
  if (state.status === 'initializing' || state.status === 'authenticating') return <BlockingState title="Загрузка" description="Проверяем Telegram и загружаем сохранение…" />;
  if (state.status === 'telegram-required') return <BlockingState title="Откройте игру в Telegram" description="Для обычного входа требуется Telegram Mini App." guest={enterGuestMode} />;
  if (state.status === 'error') return <BlockingState title="Не удалось загрузить сохранение" description={`${state.error} Локальное сохранение не будет использовано.`} retry={bootstrap} guest={enterGuestMode} />;
  if (state.status === 'corrupt-save') return <main className="account-bootstrap">
    <h1>Повреждено серверное сохранение</h1>
    <p>Вход в аккаунт работает, но данные прогресса не читаются. Исходное сохранение пока не изменено.</p>
    {state.error && <p role="alert">{state.error}</p>}
    <button type="button" disabled={resetBusy} onClick={bootstrap}>Повторить загрузку</button>
    {!resetConfirmation
      ? <button type="button" disabled={resetBusy} onClick={() => setResetConfirmation(true)}>Начать заново</button>
      : <section role="group" aria-label="Подтверждение сброса сохранения">
          <p>Сервер сохранит копию повреждённых данных в архиве, затем удалит игровой прогресс. Имя аккаунта останется прежним. Продолжить?</p>
          <button type="button" disabled={resetBusy} onClick={() => setResetConfirmation(false)}>Отмена</button>
          <button type="button" disabled={resetBusy} onClick={confirmCorruptSaveReset}>{resetBusy ? 'Сбрасываем…' : 'Сбросить прогресс'}</button>
        </section>}
  </main>;
  if (state.status === 'name') return <NameSetup error={state.error} onSubmit={async name => { try { const result = await setAccountName(name); setState({ status: 'ready', account: result.account, error: null }); } catch (error) { setState(previous => ({ ...previous, error: error.message === 'name-length' ? 'Имя должно содержать от 2 до 24 символов.' : 'Введите корректное имя без управляющих символов.' })); } }} />;
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
};
export default AccountBootstrap;
