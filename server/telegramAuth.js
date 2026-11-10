const crypto = require('node:crypto');

const safeEqualHex = (left, right) => {
  if (!/^[a-f\d]{64}$/i.test(left || '') || !/^[a-f\d]{64}$/i.test(right || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

const parseUser = raw => {
  let user;
  try { user = JSON.parse(raw); } catch { throw Object.assign(new Error('malformed-user'), { statusCode: 401 }); }
  const id = user?.id;
  if ((typeof id !== 'number' && typeof id !== 'string') || !/^\d+$/.test(String(id))) throw Object.assign(new Error('malformed-user'), { statusCode: 401 });
  return { ...user, id: String(id) };
};

const validateTelegramInitData = (rawInitData, { botToken, maxAgeSeconds = 3600, now = () => Date.now() } = {}) => {
  if (!rawInitData || typeof rawInitData !== 'string') throw Object.assign(new Error('missing-init-data'), { statusCode: 401 });
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is required');
  const params = new URLSearchParams(rawInitData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw Object.assign(new Error('missing-hash'), { statusCode: 401 });
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeEqualHex(receivedHash, expectedHash)) throw Object.assign(new Error('invalid-hash'), { statusCode: 401 });
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) throw Object.assign(new Error('malformed-auth-date'), { statusCode: 401 });
  const age = Math.floor(now() / 1000) - authDate;
  if (age < -30 || age > maxAgeSeconds) throw Object.assign(new Error('expired-init-data'), { statusCode: 401 });
  const user = parseUser(params.get('user'));
  return { telegramUserId: user.id, telegramMetadata: { username: user.username || null, firstName: user.first_name || null, lastName: user.last_name || null } };
};

module.exports = { validateTelegramInitData };
