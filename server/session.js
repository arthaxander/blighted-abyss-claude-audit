const crypto = require('node:crypto');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
const createSessionToken = (identity, { secret, maxAgeSeconds = 86400, now = () => Date.now() }) => {
  const body = encode({ sub: String(identity.telegramUserId), exp: Math.floor(now() / 1000) + maxAgeSeconds });
  return `${body}.${sign(body, secret)}`;
};
const verifySessionToken = (token, { secret, now = () => Date.now() }) => {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const payload = JSON.parse(Buffer.from(body, 'base64url')); return payload.exp >= Math.floor(now() / 1000) && /^\d+$/.test(payload.sub) ? payload : null; } catch { return null; }
};
const parseCookie = (header, name) => String(header || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || null;
module.exports = { createSessionToken, verifySessionToken, parseCookie };
