const validateGameName = input => {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value || /[\p{Cc}\p{Cf}\r\n]/u.test(value)) return { valid: false, reason: 'invalid-name' };
  const length = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
  if (length < 2 || length > 24) return { valid: false, reason: 'name-length' };
  return { valid: true, value };
};
module.exports = { validateGameName };
