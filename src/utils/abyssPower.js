export const ABYSS_POWER_TUNING = Object.freeze({
  hp: 1.25,
  attack: 1.15,
  magAtk: 1.15,
  physDef: 1.1,
  magicDef: 1.1,
  speed: 1,
});

export const ABYSS_POWER_DESCRIPTION =
  'Враги получают +25% Здоровья, +15% физической и магической Атаки и +10% физической и магической Защиты. Скорость не изменяется.';

const scaleStat = (value, multiplier) => {
  if (!Number.isFinite(Number(value))) return value;
  const numeric = Number(value);
  if (multiplier === 1) return numeric;
  if (numeric === 0) return 0;
  const scaled = Math.round(numeric * multiplier);
  return multiplier > 1 ? Math.max(numeric + 1, scaled) : scaled;
};

export const applyAbyssPowerToEnemy = (enemy, tuning = ABYSS_POWER_TUNING) => {
  if (!enemy) return enemy;
  const maxHpSource = Number.isFinite(Number(enemy.maxHp))
    ? Number(enemy.maxHp)
    : Number(enemy.hp);
  const scaledMaxHp = scaleStat(maxHpSource, tuning.hp);
  const attackSource = enemy.attack ?? enemy.baseAtk;

  return {
    ...enemy,
    ...(Number.isFinite(Number(scaledMaxHp))
      ? { maxHp: scaledMaxHp, hp: scaledMaxHp }
      : {}),
    ...(Number.isFinite(Number(attackSource))
      ? {
          attack: scaleStat(attackSource, tuning.attack),
          baseAtk: scaleStat(attackSource, tuning.attack),
        }
      : {}),
    ...(Number.isFinite(Number(enemy.magAtk))
      ? { magAtk: scaleStat(enemy.magAtk, tuning.magAtk) }
      : {}),
    ...(Number.isFinite(Number(enemy.physDef ?? enemy.basePhysDef))
      ? {
          physDef: scaleStat(enemy.physDef ?? enemy.basePhysDef, tuning.physDef),
          basePhysDef: scaleStat(enemy.physDef ?? enemy.basePhysDef, tuning.physDef),
        }
      : {}),
    ...(Number.isFinite(Number(enemy.magicDef ?? enemy.baseMagicDef))
      ? {
          magicDef: scaleStat(enemy.magicDef ?? enemy.baseMagicDef, tuning.magicDef),
          baseMagicDef: scaleStat(enemy.magicDef ?? enemy.baseMagicDef, tuning.magicDef),
        }
      : {}),
    ...(Number.isFinite(Number(enemy.speed))
      ? { speed: scaleStat(enemy.speed, tuning.speed) }
      : {}),
    abyssPowerApplied: true,
  };
};

export const createAbyssPowerDescriptor = () => ({
  id: 'abyss-power',
  label: '[Мощь Бездны]',
  tuning: ABYSS_POWER_TUNING,
  description: ABYSS_POWER_DESCRIPTION,
});
