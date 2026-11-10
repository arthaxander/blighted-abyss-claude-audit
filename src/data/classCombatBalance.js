// Multiplies outgoing damage, not attack stats or utility effects.
export const getClassDamageMultiplier = (source, options = {}) => {
  if (options.bypassDamageModifiers || options.bypassOutgoingModifiers || options.bypassClassDamageMultiplier) return 1;
  if (source?.summoned) return 1;
  if (['Archer', 'Лучник'].includes(source?.class)) return 0.8;
  return ['Defender', 'Защитник'].includes(source?.class) ? 1.3 : 1;
};
