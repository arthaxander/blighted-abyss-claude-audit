const http = require('node:http');
const { validateTelegramInitData } = require('./telegramAuth');
const { createSessionToken, verifySessionToken, parseCookie } = require('./session');
const { SqliteAccountRepository } = require('./accountRepository');
const { validateGameName } = require('./nameValidation');
const { validateSavePayload } = require('./saveValidation');
const COOKIE = 'ashen_session';
const buildRevision = env => env.BUILD_REVISION || env.AMVERA_COMMIT_SHA || 'unknown';
const serverTimeIso = now => new Date(typeof now === 'function' ? now() : Date.now()).toISOString();
const telegramSessionCookie = (token, maxAge) => `${COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); };
const readJson = req => new Promise((resolve, reject) => { let body=''; req.on('data', c => { body += c; if (body.length > 1_000_000) reject(Object.assign(new Error('payload-too-large'), { statusCode: 413 })); }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(Object.assign(new Error('invalid-json'), { statusCode: 400 })); } }); req.on('error', reject); });
const createApi = ({ repository = new SqliteAccountRepository(), env = process.env, now } = {}) => http.createServer(async (req, res) => {
  try {
    if (env.FRONTEND_ORIGIN) {
      res.setHeader('access-control-allow-origin', env.FRONTEND_ORIGIN);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('access-control-allow-headers', 'content-type,x-save-request-id');
      res.setHeader('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { status: 'ok', revision: buildRevision(env) });
    const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : {};
    if (req.method === 'POST' && req.url === '/api/auth/telegram') {
      const identity = validateTelegramInitData(body.initData, { botToken: env.TELEGRAM_BOT_TOKEN, maxAgeSeconds: Number(env.TELEGRAM_INIT_DATA_MAX_AGE || 3600), now });
      const account = repository.getOrCreate(identity); const token = createSessionToken(identity, { secret: env.SESSION_SECRET, now });
      // Telegram Mini Apps are HTTPS. SameSite=None cookies are rejected by modern
      // browsers unless Secure is present, regardless of how NODE_ENV was set by
      // the process manager.
      return json(res, 200, { account }, { 'set-cookie': telegramSessionCookie(token, Number(env.SESSION_MAX_AGE || 86400)) });
    }
    if (req.method === 'POST' && req.url === '/api/auth/dev') {
      if (env.NODE_ENV === 'production' || env.ALLOW_DEV_AUTH !== 'true') return json(res, 404, { error: 'not-found' });
      const identity = { telegramUserId: String(env.DEV_TELEGRAM_USER_ID || '9007199254740993'), telegramMetadata: { dev: true } };
      const account = repository.getOrCreate(identity); const token = createSessionToken(identity, { secret: env.SESSION_SECRET, now });
      return json(res, 200, { account }, { 'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/` });
    }
    const session = verifySessionToken(parseCookie(req.headers.cookie, COOKIE), { secret: env.SESSION_SECRET, now });
    if (!session) return json(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/api/account') return json(res, 200, { account: repository.get(session.sub), serverTime: serverTimeIso(now) });
    if (req.method === 'PUT' && req.url === '/api/account/name') { const validated = validateGameName(body.name); if (!validated.valid) return json(res, 400, { error: validated.reason }); return json(res, 200, { account: repository.setName(session.sub, validated.value) }); }
    if (req.method === 'POST' && req.url === '/api/save/reset') {
      // Explicit authenticated reset: confirmed in the client, archived in
      // the database, and guarded by the currently loaded revision.
      const account = repository.resetSave(session.sub, body.revision);
      return json(res, 200, { account, revision: buildRevision(env) });
    }
    if (req.method === 'PUT' && req.url === '/api/save') {
      const requestId = String(req.headers['x-save-request-id'] || 'missing').slice(0, 80);
      const previousSave = repository.get(session.sub)?.save;
      const save = validateSavePayload(body.save, { previousSave, onDivergence: difference => console.error('[save-divergence]', { requestId, ...difference }) });
      const account = repository.save(session.sub, save, body.revision, body.schemaVersion || 1);
      return json(res, 200, { account, requestId, revision: buildRevision(env) });
    }
    if (req.method === 'POST' && req.url === '/api/logout') return json(res, 204, {}, { 'set-cookie': `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax` });
    return json(res, 404, { error: 'not-found' });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('[account-api]', req.method, req.url, status, error.message, error.saveDiagnostic || undefined);
    return json(res, status, { error: status >= 500 ? 'server-error' : error.message, account: status >= 500 ? undefined : error.account, diagnostic: status === 400 && error.message === 'invalid-class-loadout' ? { classId: error.saveDiagnostic?.classId, reason: error.saveDiagnostic?.reason, index: error.saveDiagnostic?.index } : undefined });
  }
});
module.exports = { createApi, telegramSessionCookie };

