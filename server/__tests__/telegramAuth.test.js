const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('node:crypto');
const { validateTelegramInitData } = require('../telegramAuth');
const { telegramSessionCookie } = require('../app');
const token = '123456:test-token'; const nowSeconds = 2_000_000_000;
const fixture = ({ user = { id: '9007199254740993', username: 'old', first_name: 'Игрок' }, authDate = nowSeconds, botToken = token, signature } = {}) => {
  const values = { auth_date: String(authDate), query_id: 'AAE-test', user: typeof user === 'string' ? user : JSON.stringify(user) };
  if (signature !== undefined) values.signature = signature;
  const params = new URLSearchParams(values);
  const check = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
};
const options = { botToken: token, maxAgeSeconds: 300, now: () => nowSeconds * 1000 };

test('accepts modern signed initData with signature in bot-token HMAC data-check-string', () => {
  const raw = fixture({ signature: 'telegram-ed25519-signature' });
  assert.equal(validateTelegramInitData(raw, options).telegramUserId, '9007199254740993');
});

test('accepts legacy signed initData without signature', () => {
  assert.equal(validateTelegramInitData(fixture(), options).telegramUserId, '9007199254740993');
});

test('Telegram session cookie is always browser-compatible with SameSite=None', () => {
  const cookie = telegramSessionCookie('signed', 3600);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=None/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\//);
});

test('rejects tampering, incorrect hash, wrong token, stale auth_date, missing data, and malformed user', () => {
  const modern = fixture({ signature: 'telegram-ed25519-signature' });
  const cases = [
    modern.replace('old','changed'),
    modern.replace(/hash=[^&]+/,'hash='+'0'.repeat(64)),
    modern,
    fixture({authDate:nowSeconds-301}),
    '',
    fixture({user:'not-json'})
  ];
  const opts = [options, options, {...options,botToken:'wrong'}, options, options, options];
  cases.forEach((value,index)=>assert.throws(()=>validateTelegramInitData(value,opts[index])));
});
