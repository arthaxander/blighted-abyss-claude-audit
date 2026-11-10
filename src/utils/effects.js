// src/utils/effects.js
// Централизованная библиотека эффектов Ashen Abyss: описания, формулы, обработчики

import { recordCombatPresentationEvent } from "./combatPresentationEvents";
import { MAGIC_SCHOOLS } from "../constants/magicSchools";

const DEFAULT_ICON = '✨';
const PUBLIC_URL =
  (typeof process !== 'undefined' && process.env && process.env.PUBLIC_URL) || '';
export const EFFECT_ICON_BASE_PATH = '/assets/combat/effects';

const GUARD_IRON_RING = 'Железное Кольцо Караульного';
const SURVIVING_STANDARD_BEARER_CUIRASS = 'Кираса уцелевшего знаменосца';
const DEMIGOD_SERPENT_CARAPACE = 'Панцирь Змеиного Полубога';
const BORROWED_GUILT_CUIRASS = 'Кираса чужой вины';
const FLARING_VEIN_BOOTS = 'Сапоги вспыхнувшей жилы';
const LAST_SUPPORT_HELMET = 'Каска последней крепи';
const DEEP_WATCH_HELMET = 'Шлем глубинного дозора';
const UNSUNG_MEDALLION = 'Медальон неотпетого';
const CLINGING_RESIN_AMULET = 'Амулет цепкой живицы';

function getLocalEquippedItemNames(equipment = {}) {
  if (Array.isArray(equipment)) return equipment.filter(Boolean);
  if (!equipment || typeof equipment !== 'object') return [];
  return Object.values(equipment)
    .map(item => typeof item === 'string' ? item : item?.itemId || item?.name)
    .filter(Boolean);
}

function hasEquipped(unit, itemName) {
  return getLocalEquippedItemNames(unit?.equipment).includes(itemName);
}

function areHostileUnits(left, right, session) {
  if (!left || !right || left === right || !session?.state) return false;
  const players = session.state.players || [];
  const enemies = session.state.enemies || [];
  return (players.includes(left) && enemies.includes(right)) ||
    (enemies.includes(left) && players.includes(right));
}

function applyDeepWatchHelmet(target, effect, metadata, source, context = {}, logger = () => {}) {
  if (!target || !effect || metadata?.type !== 'debuff') return effect;
  if (!hasEquipped(target, DEEP_WATCH_HELMET) || target._deepWatchHelmetUsed) return effect;
  if (!areHostileUnits(target, source, context?.session)) return effect;
  if (
    effect.persistent || metadata.persistent ||
    effect.durationPresentation === 'permanent' || metadata.durationPresentation === 'permanent' ||
    (metadata.stacking === 'stack' && Number.isFinite(metadata.maxStacks))
  ) return effect;
  const current = Number(effect.remainingTurns ?? effect.duration);
  if (!Number.isFinite(current) || current <= 0 || current >= 999) return effect;

  target._deepWatchHelmetUsed = true;
  const next = current - 2;
  if (next <= 0) {
    cleanseEffects(target, entry => entry === effect, logger);
    logger(`🪖 ${DEEP_WATCH_HELMET} полностью снимает первый подходящий вражеский дебафф.`);
    return null;
  }
  effect.remainingTurns = next;
  effect.duration = next;
  logger(`🪖 ${DEEP_WATCH_HELMET} сокращает «${effect.name || metadata.name || effect.id}» на 2 хода.`);
  return effect;
}

function triggerFlaringVeinBoots(target, removedEffects = [], context = {}, logger = () => {}) {
  if (!target || !hasEquipped(target, FLARING_VEIN_BOOTS)) return false;
  if ((target._flaringVeinBootsCooldown || 0) > 0) return false;
  const removedDebuff = removedEffects.find(effect => getEffectDefinition(effect?.id)?.type === 'debuff');
  if (!removedDebuff) return false;
  target._flaringVeinBootsCooldown = 4;
  const applied = addEffect(target, { id: 'speed_boost_minor', duration: 2 }, logger, target, {
    ...context,
    _flaringVeinBootsInternal: true,
  });
  if (applied) logger(`🥾 ${FLARING_VEIN_BOOTS} дают Ускорение после исчезновения дебаффа.`);
  return Boolean(applied);
}

function applyEquipmentShieldBonus(effectData = {}, metadata, source, context = {}, target = null) {
  if (metadata?.id !== 'shield' || typeof effectData.value !== 'number') {
    return effectData;
  }

  let multiplier = 1;
  if (!context?.skipEquipmentShieldBonus && hasEquipped(source, GUARD_IRON_RING)) {
    multiplier *= 1.2;
  }

  const standardBearerAction = context?.session?._survivingStandardBearerShieldAction;
  const sourceId = source?.id || source?.combatInstanceId || source?.runtimeId || source?.name || null;
  if (
    !context?.skipEquipmentShieldBonus && standardBearerAction?.sourceId === sourceId &&
    hasEquipped(source, SURVIVING_STANDARD_BEARER_CUIRASS)
  ) {
    multiplier *= 1.25;
  }

  const hero = context?.session?.state?.players?.[0];
  if (target && target === hero && Number(hero?.curses?.undeath?.tier) >= 2) {
    multiplier *= 0.9;
  }

  if (multiplier === 1) {
    return effectData;
  }
  return {
    ...effectData,
    echoBaseValue: effectData.echoBaseValue ?? effectData.value,
    value: Math.max(1, Math.round(effectData.value * multiplier)),
  };
}
const TURN_METER_THRESHOLD = 1000;
export const EFFECT_ICON_FILES = {
  retaliatory_assault: 'status_retaliatory_assault.webp',
  combat_rhythm: 'status_combat_rhythm.webp',
  supplies: 'status_supplies.webp',
  preparation: 'status_preparation.webp',
  prepared_weapon: 'status_prepared_weapon.webp',
  curse_of_exhaustion: 'status_curse_of_exhaustion.webp',
  ice_shards: 'status_ice_shards.webp',
  charge: 'status_charge.webp',
  charring: 'status_charring.webp',
  poison: 'status_poison.webp',
  burn: 'status_burn.webp',
  great_bonfire_flame: 'status_eternal_bonfire_flame.webp',
  betrayal: 'status_betrayal.webp',
  reverence: 'status_submission.webp',
  bleed: 'status_bleed.webp',
  vampire_mark: 'status_vampire_mark.webp',
  attack_boost_major: 'status_attack_up_strong.webp',
  attack_boost_minor: 'status_attack_up.webp',
  attack_penalty_major: 'status_attack_down_strong.webp',
  attack_penalty_minor: 'status_attack_down.webp',
  iron_counter: 'status_counterattack.webp',
  phys_def_boost_major: 'status_greater_defense_up.webp',
  phys_def_boost_minor: 'status_defense_up.webp',
  phys_def_penalty_major: 'status_defense_break.webp',
  phys_def_penalty_minor: 'status_defense_down.webp',
  shield: 'status_shield.webp',
  defender_combat_readiness: 'status_preparation.webp',
  provoked: 'status_provoked.webp',
  provocation_guard: 'status_counterattack_charges.webp',
  regeneration: 'status_regeneration.webp',
  speed_boost_major: 'status_speed_up_strong.webp',
  speed_boost_minor: 'status_speed_up.webp',
  speed_penalty_major: 'status_speed_down_strong.webp',
  speed_penalty_minor: 'status_speed_down.webp',
  entanglement: 'status_entangle.webp',
  withering_seed: 'status_withering_seed.webp',
  great_root_plague: 'status_plague.webp',
  archon_bud: 'status_withering_bud.webp',
  guard: 'status_ally_protection.webp',
  overgrowth: 'status_overgrowth.webp',
  elemental_magic_vulnerability: 'status_elemental_magic_vulnerability.webp',
  blind: 'status_blind.webp',
  evasion: 'status_dodge.webp',
  stun: 'status_stun.webp',
  freeze: 'status_freeze.webp',
  shock: 'status_shock.webp',
  vulnerability: 'status_vulnerability.webp',
  magic_def_boost_major: 'status_greater_magic_defense_up.webp',
  magic_def_boost_minor: 'status_magic_defense_up.webp',
  magic_def_penalty_major: 'status_magic_defense_down_strong.webp',
  magic_def_penalty_minor: 'status_magic_defense_down.webp',
  magic_attack_boost_major: 'status_magic_attack_up_strong.webp',
  magic_attack_boost_minor: 'status_magic_attack_up.webp',
  magic_attack_penalty_major: 'status_magic_attack_down_strong.webp',
  magic_attack_penalty_minor: 'status_magic_attack_down.webp',
  silence: 'status_silence.webp',
  passive_break: 'status_passive_break.webp',
  invisibility: 'status_invisibility.webp',
  block_blessings: 'status_block_blessings.webp',
  block_curses: 'status_debuff_immunity.webp',
  decay: 'status_decay.webp',
  gloom: 'status_gloom.webp',
  stiffness: 'status_stiffness.webp',
  echo: 'status_echo.webp',
  ruins_echo_charge: 'status_echo.webp',
  third_voice_ready: 'status_echo.webp',
  searing_mark: 'status_searing_mark.webp',
  healing_curse: 'status_healing_curse.webp',
  control_immunity: 'status_unstoppable.webp',
  conductivity: 'status_conductivity.webp',
  hunting_mark: 'status_hunting_mark.webp',
  protection_seals: 'status_protection_seals.webp',
  block: 'status_block.webp',
  overheat: 'status_overheat.webp',
  elemental_charge_fire: 'status_overheat.webp',
  elemental_charge_ice: 'status_ice_shards.webp',
  elemental_charge_lightning: 'status_charge.webp',
  immortality: 'status_immortality.webp',
  rebirth: 'status_rebirth.webp',
  magic_reflection: 'status_magic_reflection.webp',
  spectral_form: 'status_spectral_form.webp',
  antimagic_veil: 'status_antimagic_veil.webp',
  armor_sunder: 'status_armor_breaker.webp',
  spell_breaker: 'status_spell_breaker.webp',
};

const INNATE_CONTROL_EFFECT_IDS = new Set(['stun', 'freeze', 'shock', 'silence', 'stiffness', 'reverence']);
export const CONTROL_EFFECT_IDS = new Set([...INNATE_CONTROL_EFFECT_IDS, 'provoked', 'speed_penalty_minor', 'speed_penalty_major', 'sleep']);

export const EXCLUSIVE_EFFECT_FAMILIES = Object.freeze([
  Object.freeze({ minor: 'attack_boost_minor', major: 'attack_boost_major' }),
  Object.freeze({ minor: 'attack_penalty_minor', major: 'attack_penalty_major' }),
  Object.freeze({ minor: 'phys_def_boost_minor', major: 'phys_def_boost_major' }),
  Object.freeze({ minor: 'phys_def_penalty_minor', major: 'phys_def_penalty_major' }),
  Object.freeze({ minor: 'speed_boost_minor', major: 'speed_boost_major' }),
  Object.freeze({ minor: 'speed_penalty_minor', major: 'speed_penalty_major' }),
  Object.freeze({ minor: 'magic_def_boost_minor', major: 'magic_def_boost_major' }),
  Object.freeze({ minor: 'magic_def_penalty_minor', major: 'magic_def_penalty_major' }),
  Object.freeze({ minor: 'magic_attack_boost_minor', major: 'magic_attack_boost_major' }),
  Object.freeze({ minor: 'magic_attack_penalty_minor', major: 'magic_attack_penalty_major' }),
]);
const EXCLUSIVE_EFFECT_FAMILY_BY_ID = Object.freeze(Object.fromEntries(
  EXCLUSIVE_EFFECT_FAMILIES.flatMap(family => [
    [family.minor, family],
    [family.major, family],
  ])
));
export const isControlEffect = effect => CONTROL_EFFECT_IDS.has(typeof effect === 'string' ? effect : effect?.id);
export const getEffectDurationLabel = (effect, definition = getEffectDefinition(effect?.id || effect?.name)) => {
  if (!effect || definition?.durationPresentation === 'permanent' || effect.durationPresentation === 'permanent' || definition?.persistent || effect.persistent || definition?.permanent || effect.permanent) return null;
  const duration = effect.remainingTurns ?? effect.duration;
  return duration == null || !Number.isFinite(Number(duration)) || Number(duration) >= 999 ? null : `${duration} х.`;
};

const buildIconPath = (basePath, fileName) => {
  if (!fileName) return null;
  const normalizedBase = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return `${PUBLIC_URL}${normalizedBase}/${fileName}`;
};

export function calculateSearingMarkTickDamage(target, effect) {
  if (!target || !effect) return 0;
  const magAtk = effect.sourceSnapshot?.magAtk ?? effect.sourceRef?.magAtk ?? 0;
  const buffs = (target.effects || []).filter(entry => (
    getEffectDefinition(entry.id)?.type === 'buff'
    && (entry.id !== 'shield' || Math.max(0, Number(entry.appliedShield ?? entry.value) || 0) > 0)
  ));
  return Math.max(1, Math.round(magAtk * (0.3 + 0.1 * buffs.length)));
}

function resolveDefenderRamPreparationTick({ target, effect, context, log }) {
  const opponents = typeof context?.getOpponents === 'function' ? context.getOpponents(target) : [];
  const retaliation = context?.getRetaliatoryAssaultBonuses?.(target) || { stacks: 0, directDamagePercent: 0 };
  const acceleration = effect.extra?.talentId === 'defender.ram.acceleration'
    ? Math.min(3, Math.max(0, effect.extra?.attackActions || 0)) * 0.15
    : 0;
  const directDamageMultiplier = 1 + retaliation.directDamagePercent + acceleration;
  const deliberateAction = { actorId: target?.id, ability: 'Таран', successfulDirectHit: false };

  opponents.filter(unit => unit && unit.hp > 0).forEach(unit => {
    const shieldBefore = Math.max(0, unit.shield || 0);
    const dealt = context.applyDamage?.(
      unit,
      effect.extra?.damage || 0,
      'physical',
      {
        source: target,
        fromEffect: 'defender_ram',
        directAttack: true,
        deliberateAction,
        directDamageMultiplier,
      }
    ) || 0;
    if (dealt > 0 || Math.max(0, unit.shield || 0) < shieldBefore) deliberateAction.successfulDirectHit = true;
    if (dealt > 0 && typeof log === 'function') log(`🛡️ Таран наносит ${dealt} урона ${unit.name || 'врагу'}.`);
  });

  if (retaliation.stacks === 3) context?.consumeRetaliatoryAssault?.(target);
  if (deliberateAction.successfulDirectHit && effect.extra?.talentId === 'defender.ram.indestructible') {
    addEffect(
      target,
      { id: 'shield', duration: 3, value: Math.round((target.maxHp || 0) * 0.2) },
      log,
      target,
      { ...context, forceIndependentInstance: true }
    );
  }
  context?.grantHeadlongShield?.(target, { name: 'Таран' }, deliberateAction);
}

// --- Определения эффектов --------------------------------------------------
export const EFFECT_LIBRARY = {
  elemental_charge_fire: {
    id: 'elemental_charge_fire', name: 'Заряд Огня', type: 'resource', icon: '🔥',
    description: 'Каждое заклинание Огня, включая призыв соответствующего элементаля, даёт 1 заряд. Второе заклинание наносит всем врагам урон Огнём в размере 75% магической атаки и расходует эти заряды. Другие стихии сохраняют свой прогресс. Действует до конца боя; нельзя снять.',
    stacking: 'stack', maxStacks: 2, persistent: true, durationPresentation: 'permanent', unremovable: true,
  },
  elemental_charge_ice: {
    id: 'elemental_charge_ice', name: 'Заряд Льда', type: 'resource', icon: '❄',
    description: 'Каждое заклинание Льда, включая призыв соответствующего элементаля, даёт 1 заряд. Второе заклинание даёт Щит на 20% максимального здоровья на 2 хода и расходует эти заряды. Другие стихии сохраняют свой прогресс. Действует до конца боя; нельзя снять.',
    stacking: 'stack', maxStacks: 2, persistent: true, durationPresentation: 'permanent', unremovable: true,
  },
  elemental_charge_lightning: {
    id: 'elemental_charge_lightning', name: 'Заряд Молнии', type: 'resource', icon: 'ϟ',
    description: 'Каждое заклинание Молнии, включая призыв соответствующего элементаля, даёт 1 заряд. Второе заклинание заполняет шкалу хода на 30% и расходует эти заряды. Другие стихии сохраняют свой прогресс. Действует до конца боя; нельзя снять.',
    stacking: 'stack', maxStacks: 2, persistent: true, durationPresentation: 'permanent', unremovable: true,
  },
  retaliatory_assault: {
    id: 'retaliatory_assault', name: 'Ответный натиск', type: 'buff', icon: '◆', defaultDuration: 999,
    description: 'Каждый заряд повышает физическую и магическую защиту на 5%, а следующую выбранную атакующую способность — на 10% прямого урона.',
    stacking: 'refresh', durationPresentation: 'permanent',
  },
  combat_rhythm: {
    id: 'combat_rhythm', name: 'Боевой ритм', type: 'buff', icon: '♪', defaultDuration: 999,
    description: 'До 3 зарядов. Каждый заряд даёт +5 п.п. к шансу критического удара; смена цели снимает заряды.', stacking: 'stack', maxStacks: 3, durationPresentation: 'permanent',
  },
  supplies: {
    id: 'supplies', name: 'Припасы', type: 'resource', icon: '▪',
    description: 'Ограниченный боевой ресурс, который расходуется способностями владельца. Нельзя снять.',
    stacking: 'stack', persistent: true, durationPresentation: 'permanent', unremovable: true,
  },
  ruins_unrest: {
    id: 'ruins_unrest', name: 'Неупокоенность', type: 'resource', icon: '◈',
    description: 'Каждая поглощённая душа даёт +10% физической и магической атаки и Скорости, до 3 зарядов.',
    persistent: true, unremovable: true, durationPresentation: 'permanent', stacking: 'stack', maxStacks: 3,
  },
  ruins_refraction: {
    id: 'ruins_refraction', name: 'Преломление', type: 'resource', icon: '◇',
    description: 'Накопленная Кристальным мертвострелом энергия следующего успешного прямого удара по здоровью.',
    persistent: true, unremovable: true, durationPresentation: 'permanent', stacking: 'refresh',
  },
  ruins_frostbite: {
    id: 'ruins_frostbite', name: 'Обморожение', type: 'debuff', icon: '❄',
    description: '-10% Скорости и -40% внешнего заполнения шкалы хода.',
    defaultDuration: 2, stacking: 'refresh', statMultipliers: { speed: 0.9 },
  },
  ruins_echo_charge: {
    id: 'ruins_echo_charge',
    name: 'Эхо',
    type: 'resource',
    icon: '◈',
    description: 'Заряд Эха. Следующая подходящая классовая способность сохраняет отложенное отражение на следующий собственный ход.',
    stacking: 'stack',
    persistent: true,
    durationPresentation: 'permanent',
    unremovable: true,
  },
  third_voice_ready: {
    id: 'third_voice_ready',
    name: 'Эхо третьего голоса',
    type: 'resource',
    icon: '◈',
    description: 'Следующая атакующая классовая способность будет отражена Эхом. Подготовка не накапливается.',
    stacking: 'refresh',
    persistent: true,
    durationPresentation: 'permanent',
    unremovable: true,
  },
  preparation: {
    id: 'preparation',
    name: 'Подготовка',
    type: 'trait',
    icon: '⌛',
    durationPresentation: 'permanent',
    stacking: 'refresh',
    tickPriority: 2,
    description: 'Носитель готовит отложенное действие. Конкретный эффект зависит от источника Подготовки.',
    onTick: payload => {
      if (payload.effect?.extra?.kind === 'defender_ram') {
        resolveDefenderRamPreparationTick(payload);
      }
    },
  },
  prepared_weapon: {
    id: 'prepared_weapon',
    name: 'Подготовленное оружие',
    type: 'buff',
    icon: '🧪',
    persistent: true,
    durationPresentation: 'permanent',
    stacking: 'refresh',
    description: 'На оружие нанесён состав. Его конкретный эффект сработает при следующем успешном прямом попадании.',
    onApply: ({ target, context, log }) => {
      if (!hasEquipped(target, CLINGING_RESIN_AMULET)) return;
      const before = Math.max(0, Number(target.turnMeter) || 0);
      target.turnMeter = Math.min(TURN_METER_THRESHOLD, before + 150);
      const gained = Math.max(0, target.turnMeter - before);
      if (gained > 0) {
        context?.session?.notifyPositiveTempoChange?.(target, gained, {
          source: CLINGING_RESIN_AMULET,
          trigger: 'prepared_weapon',
          natural: false,
        });
        if (typeof log === 'function') log(`🌿 ${CLINGING_RESIN_AMULET} заполняет ШХ на 15%.`);
      }
    },
  },
  curse_of_exhaustion: {
    id: 'curse_of_exhaustion', name: 'Проклятие истощения', type: 'debuff', icon: '☾', defaultDuration: 3,
    description: 'Следующая активная классовая способность получает +1 к восстановлению, затем проклятие снимается.',
    stacking: 'refresh',
  },
  ice_shards: {
    id: 'ice_shards', name: 'Ледяные осколки', type: 'debuff', icon: '❄', persistent: true, durationPresentation: 'permanent',
    description: 'До 3 зарядов. Следующий прямой урон разбивает один заряд и наносит дополнительный урон Льдом от текущей Магической атаки владельца осколков.',
    stacking: 'stack', maxStacks: 3, elementalState: 'ice',
  },
  charge: {
    id: 'charge', name: 'Заряд', type: 'debuff', icon: 'ϟ', persistent: true, durationPresentation: 'permanent',
    description: 'До 3 зарядов. На третьем заряде происходит разряд Молнией и все заряды снимаются.',
    stacking: 'stack', maxStacks: 3, elementalState: 'lightning',
  },
  charring: {
    id: 'charring', name: 'Обугливание', type: 'debuff', icon: '♨', defaultDuration: 3,
    description: 'До 3 зарядов. Получаемый урон Огнём повышается на 5% / 12% / 25%.',
    stacking: 'stack', maxStacks: 3, elementalState: 'fire',
  },
  conductivity: {
    id: 'conductivity', name: 'Проводимость', type: 'debuff', icon: 'ϟ', defaultDuration: 2,
    description: 'Прямой урон HP вызывает у носителя урон Молнией в размере 25% потерянного HP, а у каждого живого союзника — 12,5%.',
    stacking: 'refresh', elementalState: 'lightning',
    onDamageTaken: ({ target, context }) => {
      const hpLost = context?.actualHpLost ?? 0;
      if (!context?.directAttack || context?.isPeriodic || context?.fromEffect || hpLost <= 0) return;
      const applyFn = context?.applyDamage;
      if (typeof applyFn !== 'function') return;
      const source = context.source;
      applyFn(target, hpLost * 0.25, 'magical', { source, magicSchool: MAGIC_SCHOOLS.LIGHTNING, fromEffect: 'conductivity', sourceEffectId: 'conductivity' });
      getAlliedUnits(target, context)
        .filter(unit => unit && unit !== target && unit.hp > 0)
        .forEach(unit => applyFn(unit, hpLost * 0.125, 'magical', { source, magicSchool: MAGIC_SCHOOLS.LIGHTNING, fromEffect: 'conductivity', sourceEffectId: 'conductivity' }));
    },
  },
  hunting_mark: {
    id: 'hunting_mark', name: 'Охотничья метка', type: 'debuff', icon: '🎯', defaultDuration: 2,
    description: 'Следующая успешная одиночная прямая атака Лучника гарантированно критует и расходует метку. Естественный крит дополнительно получает +50 п.п. критического урона.',
    stacking: 'refresh',
  },
  mines_guard_block: {
    id: 'mines_guard_block', name: 'Укреплённый заслон', type: 'buff', icon: '🛡️',
    defaultDuration: 2, stacking: 'refresh',
    description: 'До конца второго собственного хода блокирует один следующий снимаемый отрицательный эффект.',
  },
  protection_seals: {
    id: 'protection_seals', name: 'Печати защиты', type: 'buff', icon: '🛡️', persistent: true,
    description: 'Каждый заряд блокирует одну успешную попытку наложить новый отрицательный статус.',
    stacking: 'stack', durationPresentation: 'permanent',
  },
  block: {
    id: 'block', name: 'Блок', type: 'buff', icon: '🛡️', persistent: true,
    description: 'Поглощает одно прямое попадание целиком. В многоударной способности расходуется только на один удар.',
    stacking: 'stack', maxStacks: 1, durationPresentation: 'permanent',
  },
  defender_combat_readiness: {
    id: 'defender_combat_readiness', name: 'Боевая готовность', type: 'buff', icon: '🛡️',
    description: 'Следующая способность, расходующая Щит, тратит вдвое меньше Щита без потери силы.',
    defaultDuration: 3, stacking: 'refresh',
  },
  overheat: {
    id: 'overheat', name: 'Перегрев', type: 'buff', icon: '🔥', persistent: true,
    description: 'Благословение без длительности, максимум 2 заряда.',
    stacking: 'stack', maxStacks: 2, durationPresentation: 'permanent',
  },
  poison: {
    id: 'poison',
    name: 'Отравление',
    type: 'debuff',
    icon: '☠️',
    description:
      'Каждый экземпляр в начале хода наносит 50% снимка Атаки источника физическим уроном и 2% максимального здоровья цели магией Смерти.',
    defaultDuration: 3,
    stacking: 'stack',
    independentInstances: true,
    tickPriority: 5,
    onTick: ({ target, effect, context, log }) => {
      const attack = effect.sourceSnapshot?.attack ?? 0;
      const maxHp = target.maxHp ?? target.hp ?? 0;
      // Simulator experiments may supply one symmetric multiplier through the
      // combat session. The production/default path has no flag and remains 1.
      const simulationMultiplier = Number(context?.session?._simulationPoisonDamageMultiplier) || 1;
      const physicalDamage = Math.max(1, Math.round(attack * 0.5 * simulationMultiplier));
      const magicalDamage = Math.max(1, Math.round(maxHp * 0.02 * simulationMultiplier));
      if (hasEquipped(target, DEMIGOD_SERPENT_CARAPACE)) {
        const healed = applyEffectHealing({ target, amount: physicalDamage + magicalDamage, context });
        if (typeof log === 'function') {
          log(`🐍 ${target.name || 'Цель'} обращает яд в исцеление и восстанавливает ${healed} здоровья.`);
        }
        return;
      }
      const dealtPhysical = applyEffectDamage({
        target,
        amount: physicalDamage,
        type: 'physical',
        effect,
        context,
      });
      const dealtMagical = applyEffectDamage({
        target,
        amount: magicalDamage,
        type: 'magical',
        magicSchool: MAGIC_SCHOOLS.DEATH,
        effect,
        context,
      });
      if (typeof log === 'function') {
        log(
          `☠️ ${target.name || 'Цель'} страдает от яда: ${dealtPhysical} физ. + ${dealtMagical} маг. урона.`
        );
      }
      context?.session?.onPoisonTick?.({
        target,
        effect,
        source: resolveEffectDamageSource(effect, context),
        actualDamage: Math.max(0, dealtPhysical) + Math.max(0, dealtMagical),
        context,
        log,
      });
    },
    onExpire: ({ target, effect, context, log }) => {
      if (context?.reason !== 'natural') return;
      context?.session?.onPoisonEnded?.({ target, effect, reason: 'natural', context, log });
    },
    onOwnerDeath: ({ owner, effect, context, log }) => {
      context?.session?.onPoisonEnded?.({ target: owner, effect, reason: 'death', context, log });
    },
  },
  burn: {
    id: 'burn',
    name: 'Горение',
    type: 'debuff',
    icon: '🔥',
    description:
      'В начале хода наносит 50% атакующей характеристики источника + 3% максимального здоровья носителя уроном Огня. Живые союзники получают половину этого урона с учётом своей защиты.',
    defaultDuration: 2,
    stacking: 'refresh',
    tickPriority: 6,
    onTick: ({ target, effect, context, log }) => {
      const maxHp = target.maxHp ?? target.hp ?? 0;
      const scaling = effect.sourceSnapshot?.scaling ?? effect.sourceSnapshot?.magAtk ?? 0;
      const baseDamage = Math.max(1, Math.round(scaling * 0.5 + maxHp * 0.03));
      const dealt = applyEffectDamage({
        target,
        amount: baseDamage,
        type: 'magical',
        magicSchool: MAGIC_SCHOOLS.FIRE,
        effect,
        context,
      });
      const allies = typeof context?.getAllies === 'function' ? context.getAllies(target) : [];
      allies
        ?.filter(unit => unit && unit !== target && unit.hp > 0)
        .forEach(ally => {
          const splash = Math.max(1, Math.round(baseDamage * 0.5));
          const splashAmount = applyEffectDamage({
            target: ally,
            amount: splash,
            type: 'magical',
            magicSchool: MAGIC_SCHOOLS.FIRE,
            effect,
            context,
          });
          if (splashAmount > 0 && typeof log === 'function') {
            log(`🔥 Пламя перекидывается на ${ally.name || 'союзника'}, нанося ${splashAmount} урона.`);
          }
        });
      if (typeof log === 'function') {
        log(`🔥 ${target.name || 'Цель'} горит и получает ${dealt} урона.`);
      }
      (target.effects || []).filter(entry => entry?.id === 'great_bonfire_flame').forEach(flame => {
        flame.extra = flame.extra || {};
        flame.extra.burnTicks = (flame.extra.burnTicks || 0) + 1;
      });
    },
  },
  great_bonfire_flame: {
    id: 'great_bonfire_flame',
    name: 'Пламя Великого Костра',
    type: 'debuff',
    icon: '🔥',
    description: 'Не имеет срока действия и не может быть снято. В начале хода носителя наносит магический урон Огнём в размере 75% текущей Магической атаки владельца Кадила плюс ещё 50% за каждое срабатывание Горения на этом носителе. Собственный урон Пламени не усиливает его. После смерти носителя переходит на случайного живого врага, сохраняя накопленную силу.',
    persistent: true,
    unremovable: true,
    stacking: 'refresh',
    tickPriority: 6,
    onTick: ({ target, effect, context, log }) => {
      const source = effect.sourceRef;
      const currentMagAtk = Number.isFinite(source?.magAtk) ? source.magAtk : null;
      effect.extra = effect.extra || {};
      if (currentMagAtk !== null) effect.extra.lastKnownMagAtk = currentMagAtk;
      const magAtk = currentMagAtk ?? effect.extra.lastKnownMagAtk ?? effect.sourceSnapshot?.magAtk ?? 0;
      const rawDamage = Math.max(1, Math.round(magAtk * 0.5 * (1 + (effect.extra.burnTicks || 0))));
      const dealt = applyEffectDamage({ target, amount: rawDamage, type: 'magical', magicSchool: MAGIC_SCHOOLS.FIRE, effect, context });
      if (typeof log === 'function') log(`🔥 Пламя Великого Костра обжигает ${target.name || 'цель'} на ${dealt} урона.`);
    },
    onOwnerDeath: ({ owner, effect, allies, rng = Math.random, log }) => {
      const candidates = (allies || []).filter(unit => unit && unit.hp > 0);
      if (!candidates.length) return;
      const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
      const recipient = candidates[Math.floor(roll * candidates.length)];
      owner.effects = (owner.effects || []).filter(entry => entry !== effect);
      recipient.effects = recipient.effects || [];
      recipient.effects.push(effect);
      if (typeof log === 'function') log(`🔥 Пламя Великого Костра переходит на ${recipient.name || 'нового носителя'}.`);
    },
  },
  betrayal: {
    id: 'betrayal',
    name: 'Предательство',
    type: 'debuff',
    icon: '🗡️',
    description: 'Следующая атакующая способность носителя направляется в случайного живого союзника. Не срабатывает, если подходящего союзника нет, и после перенаправления снимается.',
    persistent: true,
    stacking: 'refresh',
  },
  bleed: {
    id: 'bleed',
    name: 'Кровотечение',
    type: 'debuff',
    icon: '🩸',
    description:
      'В начале хода наносит физический урон по формуле Атака источника × (0,75 + 0,25 × оставшиеся ходы). Повторное наложение добавляет ходы.',
    defaultDuration: 3,
    stacking: 'extend',
    tickPriority: 5,
    onTick: ({ target, effect, context, log }) => {
      const currentAttack = effect.sourceRef?.attack;
      if (Number.isFinite(currentAttack)) effect.sourceSnapshot.attack = currentAttack;
      const attack = Number.isFinite(currentAttack) ? currentAttack : effect.sourceSnapshot?.attack ?? 0;
      const remaining = Math.max(1, effect.remainingTurns ?? effect.duration ?? 1);
      const damage = Math.max(1, Math.round(attack * (0.75 + 0.25 * remaining)));
      const dealt = applyEffectDamage({
        target,
        amount: damage,
        type: 'physical',
        effect,
        context,
      });
      context?.onEffectTick?.({ target, effect, effectId: 'bleed', actualHpLost: dealt });
      if (typeof log === 'function') {
        log(`🩸 ${target.name || 'Цель'} истекает кровью (${dealt} урона).`);
      }
    },
  },
  thirst: {
    id: 'thirst',
    name: 'Жажда',
    type: 'buff',
    icon: '🩸',
    description: 'До 3 зарядов. Каждый заряд даёт +5% всего исходящего урона и +8% физической Атаки.',
    persistent: true,
    unremovable: true,
    durationPresentation: 'permanent',
    stacking: 'refresh',
  },
  crimson_ecstasy: {
    id: 'crimson_ecstasy',
    name: 'Багровый экстаз',
    type: 'buff',
    icon: '♦',
    description: 'До 3 зарядов. Каждый заряд даёт +10% всего исходящего урона и +10% Скорости. Исчезает вместе с последним [Кровотечением].',
    persistent: true,
    unremovable: true,
    durationPresentation: 'permanent',
    stacking: 'refresh',
  },
  refraction: {
    id: 'refraction',
    name: 'Преломление',
    type: 'resource',
    icon: '◇',
    description: 'Предотвращённый Искажением урон накапливается. Следующее успешное прямое попадание по здоровью расходует весь запас и добавляет накопленное значение к урону попадания.',
    persistent: true,
    unremovable: true,
    durationPresentation: 'permanent',
    stacking: 'refresh',
  },
  vampire_mark: {
    id: 'vampire_mark',
    name: 'Метка вампира',
    type: 'debuff',
    icon: '🦇',
    description:
      'Когда отмеченная цель получает урон, тот, кто нанёс этот урон, восстанавливает здоровье в размере 30% фактически нанесённого урона. Лечение усиливается бонусом вампиризма атакующего.',
    defaultDuration: 3,
    stacking: 'refresh',
    tickPriority: 5,
    onDamageTaken: ({ target, damage, context }) => {
      const actualDamage = context?.actualHpLost ?? damage ?? 0;
      const healer = context?.source;
      if (actualDamage <= 0 || !healer || healer === target || healer.hp <= 0) return;
      const bonus = 1 + (healer.vampirismBonus ?? 0);
      const healAmount = Math.max(0, Math.round(actualDamage * 0.3 * bonus));
      const restored = applyEffectHealing({
        target: healer,
        amount: healAmount,
        context,
      });
      if (restored > 0) {
        healer._vampireHealingTotal = (healer._vampireHealingTotal || 0) + restored;
        healer._vampireHealingAction = context?.deliberateAction || null;
      }
      if (restored > 0 && typeof context?.log === 'function') {
        context.log(`🦇 ${healer.name || 'Источник'} поглощает ${restored} здоровья по Метке вампира.`);
      }
    },
  },
  flame_rune: {
    id: 'flame_rune',
    name: 'Устаревшая руна',
    type: 'debuff',
    icon: '🔥',
    description: 'Совместимость старых сохранений: эффект исчезает без срабатывания.',
    defaultDuration: 1,
    stacking: 'refresh',
    legacyOnly: true,
    onDamageTaken: () => undefined,
  },
  attack_boost_major: {
    id: 'attack_boost_major',
    name: 'Мощный натиск',
    type: 'buff',
    icon: '⚔️',
    description: 'Повышает Атаку на 50%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { attack: 1.5 },
  },
  attack_boost_minor: {
    id: 'attack_boost_minor',
    name: 'Натиск',
    type: 'buff',
    icon: '🗡️',
    description: 'Повышает Атаку на 25%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { attack: 1.25 },
  },
  attack_penalty_major: {
    id: 'attack_penalty_major',
    name: 'Сильное ослабление',
    type: 'debuff',
    icon: '🛑',
    description: 'Снижает Атаку на 50%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { attack: 0.5 },
  },
  attack_penalty_minor: {
    id: 'attack_penalty_minor',
    name: 'Ослабление',
    type: 'debuff',
    icon: '🚫',
    description: 'Снижает Атаку на 25%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { attack: 0.75 },
  },
  iron_counter: {
    id: 'iron_counter',
    name: 'Контратака',
    type: 'buff',
    icon: '🛡️',
    description:
      'При получении урона наносит ответный удар по атакующему, используя 80% силы атаки.',
    defaultDuration: 2,
    stacking: 'refresh',
    onDamageTaken: ({ target, damage, effect, context }) => {
      if (!damage || damage <= 0) return;
      if (!context?.directAttack || context?.fromEffect || context?.sourceEffectId) return;
      if (context.fromEffect === 'iron_counter') return;
      if (!context?.source || context.source === target || context.source.hp <= 0) return;
      if (typeof context.applyDamage !== 'function') return;
      const counterSource = effect?.sourceRef || effect?.sourceSnapshot?.entity || target;
      const baseAttack =
        effect?.sourceSnapshot?.attack ?? counterSource?.attack ?? target.attack ?? 0;
      const counterDamage = Math.max(1, Math.round(baseAttack * 0.8));
      const dealt = context.applyDamage(context.source, counterDamage, 'physical', {
        source: counterSource,
        fromEffect: 'iron_counter',
      });
      if (dealt > 0 && typeof context?.log === 'function') {
        context.log(
          `🛡️ ${target.name || 'Защитник'} отвечает контратакой и наносит ${dealt} урона ${context.source.name || 'врагу'}.`
        );
      }
      if (dealt > 0 && effect?.extra?.counterEffect && context.source?.hp > 0) {
        addEffect(context.source, effect.extra.counterEffect, context?.log, counterSource, context);
      }
    },
  },
  phys_def_boost_major: {
    id: 'phys_def_boost_major',
    name: 'Мощное укрепление',
    type: 'buff',
    icon: '🛡️',
    description: 'Повышает физическую защиту на 50%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { physDef: 1.5 },
  },
  phys_def_boost_minor: {
    id: 'phys_def_boost_minor',
    name: 'Укрепление',
    type: 'buff',
    icon: '🛡️',
    description: 'Повышает физическую защиту на 25%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { physDef: 1.25 },
  },
  phys_def_penalty_major: {
    id: 'phys_def_penalty_major',
    name: 'Разрушение защиты',
    type: 'debuff',
    icon: '🩻',
    description: 'Снижает физическую защиту на 50%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { physDef: 0.5 },
  },
  phys_def_penalty_minor: {
    id: 'phys_def_penalty_minor',
    name: 'Ослабление защиты',
    type: 'debuff',
    icon: '🩻',
    description: 'Снижает физическую защиту на 25%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { physDef: 0.75 },
  },
  shield: {
    id: 'shield',
    name: 'Щит',
    type: 'buff',
    icon: '🛡️',
    description:
      'Прямой и обычный периодический урон сначала расходуют Щит без учёта защиты; урон, дошедший до здоровья, уменьшается соответствующей защитой. Мрак и Испепеляющее клеймо игнорируют Щит, но не защиту.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target, effect, context, log }) => {
      const shieldValue = Math.max(0, Math.round((effect.value ?? 0) * (target._shieldReceivedMultiplier || 1)));
      effect.value = shieldValue;
      if (shieldValue > 0) {
        target.shield = Math.max(0, target.shield ?? 0) + shieldValue;
        effect.appliedShield = Math.max(0, effect.appliedShield ?? 0) + shieldValue;
        if (effect.extra?.sourceKey) {
          effect.extra.shieldSources = Array.isArray(effect.extra.shieldSources) ? effect.extra.shieldSources : [];
          effect.extra.shieldSources.push({
            sourceKey: effect.extra.sourceKey,
            remaining: shieldValue,
            breakEntanglement: Number(effect.extra.breakEntanglement) || 0,
            breakTriggered: false,
          });
        }
        if (typeof log === 'function') {
          log(`🛡️ ${target.name || 'Цель'} получает щит (+${shieldValue}).`);
        }
      }
    },
    onExpire: ({ target, effect, context = {}, log }) => {
      const shieldValue = getActiveShieldValue(effect);
      if (
        context?.reason === 'natural' &&
        shieldValue > 0 &&
        hasEquipped(target, LAST_SUPPORT_HELMET)
      ) {
        target._equipmentTurnFlags ||= {};
        if (!target._equipmentTurnFlags.lastSupportHelmetHeal) {
          target._equipmentTurnFlags.lastSupportHelmetHeal = true;
          const requested = Math.min(
            Math.max(1, Math.round(shieldValue * 0.4)),
            Math.max(1, Math.round((target.maxHp || 0) * 0.12))
          );
          let healed = 0;
          if (typeof context?.applyHealing === 'function') {
            healed = context.applyHealing(target, requested);
          } else {
            const before = target.hp ?? 0;
            target.hp = Math.min(target.maxHp ?? before, before + requested);
            healed = target.hp - before;
          }
          if (healed > 0 && typeof log === 'function') {
            log(`⛑️ ${LAST_SUPPORT_HELMET} восстанавливает ${healed} HP от истёкшего Щита.`);
          }
        }
      }
      if (shieldValue > 0) {
        target.shield = Math.max(0, (target.shield ?? 0) - shieldValue);
      }
      if (effect) {
        effect.appliedShield = 0;
        if (typeof effect.value === 'number') effect.value = 0;
      }
    },
    onDamageTaken: ({ target, effect, context }) => {
      if (!effect?.extra?.frostRetaliation) return;
      const stockBeforeHit = context?.shieldEffectStocksBefore
        ?.find(entry => entry?.effect === effect)?.before
        ?? Math.max(0, Number(effect.appliedShield ?? effect.value) || 0);
      if (stockBeforeHit <= 0) return;
      if (!context?.directAttack || context?.fromEffect) return;
      if (!context?.source || context.source === target || context.source.hp <= 0) return;
      if ((context.shieldBefore ?? 0) <= 0) return;
      const chance = effect.extra.retaliationChance ?? 0.35;
      const logger = typeof context?.log === 'function' ? context.log : () => {};
      let frozen = null;
      const rng = context?.rng || context?.session?.rng || Math.random;
      if (rng() < chance) {
        frozen = addEffect(
          context.source,
          { id: 'freeze', duration: 1 },
          logger,
          effect.sourceRef || target,
          context
        );
      }
      if (frozen) {
        logger(`❄️ Морозный щит замораживает ${context.source.name || 'цель'}.`);
      } else {
        const slowed = addEffect(
          context.source,
          { id: 'speed_penalty_minor', duration: 2 },
          logger,
          effect.sourceRef || target,
          context
        );
        if (slowed) {
          logger(`❄️ Морозный щит замедляет ${context.source.name || 'цель'}.`);
        }
      }
      if (effect.extra.shardArmor && context.source.hp > 0) {
        const shards = Math.max(0, Number(effect.appliedShield ?? effect.value) || 0) <= 0 ? 2 : 1;
        addEffect(
          context.source,
          { id: 'ice_shards', stacks: shards },
          logger,
          effect.sourceRef || target,
          context
        );
        logger(`❄️ Осколочная броня оставляет на ${context.source.name || 'цели'} ${shards} ${shards === 1 ? 'Осколок' : 'Осколка'}.`);
      }
    },
  },
  defender_ram_prepared: {
    id: 'defender_ram_prepared',
    name: 'Подготовка: Таран',
    type: 'buff',
    icon: '🛡️',
    description: 'Устаревшее состояние Тарана из старого боевого сохранения.',
    defaultDuration: 1,
    stacking: 'refresh',
    tickPriority: 2,
    legacyOnly: true,
    onTick: resolveDefenderRamPreparationTick,
  },
  reverence: {
    id: 'reverence',
    name: 'Преклонение',
    type: 'debuff',
    icon: '👑',
    description: 'Цель не может действовать, пока не получит успешное прямое попадание. Периодический и производный урон не снимают Преклонение.',
    defaultDuration: 999,
    persistent: true,
    durationPresentation: 'permanent',
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (target) target.prostrated = true;
    },
    onExpire: ({ target }) => {
      if (target) {
        target.prostrated = false;
        target._reverencePeriodicDamage = 0;
      }
    },
  },
  provoked: {
    id: 'provoked', name: 'Провокация', type: 'debuff', icon: '⚔️',
    description: 'На следующем ходу использует базовую атаку вместо способности.', defaultDuration: 2, stacking: 'refresh',
  },
  provocation_guard: {
    id: 'provocation_guard', name: 'Ответ на провокацию', type: 'buff', icon: '🛡️',
    description: 'Прямые удары спровоцированных врагов частично превращаются в Щит.', defaultDuration: 2, stacking: 'refresh',
    tickPriority: 2,
    onTick: ({ target, effect, context, log }) => {
      if (effect.extra?.talentId !== 'defender.bloody_challenge.bloody_reckoning' || effect.extra?.reckoningResolved) return;
      effect.extra.reckoningResolved = true;
      const ids = Array.isArray(effect.extra.reckoningTargetIds) ? [...effect.extra.reckoningTargetIds] : [];
      effect.extra.reckoningTargetIds = [];
      if (target.hp <= 0) return;
      const opponents = typeof context?.getOpponents === 'function' ? context.getOpponents(target) : [];
      ids.forEach(id => {
        const enemy = opponents.find(unit => unit && unit.hp > 0 && (unit.instanceId || unit.combatId || unit.id || unit.name) === id);
        if (!enemy) return;
        context?.applyDamage?.(enemy, target.attack || 0, 'physical', {
          source: target, directAttack: true, fromEffect: 'bloody_reckoning',
        });
        if (typeof log === 'function') log(`⚔️ Кровавая расплата поражает ${enemy.name || 'врага'}.`);
      });
    },
    onDamageTaken: ({ target, damage, context, effect }) => {
      const source = context?.source;
      const provocation = source?.effects?.find(entry => entry.id === 'provoked' && entry.extra?.defenderId === (effect.extra?.defenderId || target?.id));
      const hpLost = Math.max(0, context?.actualHpLost ?? damage);
      if (!context?.directAttack || context?.fromEffect || hpLost <= 0 || !provocation) return;
      const bleedTurns = (source.effects || []).filter(entry => entry.id === 'bleed').reduce((sum, entry) => sum + Math.max(0, entry.remainingTurns ?? entry.duration ?? 0), 0);
      const ratio = Math.min(0.7, 0.4 + bleedTurns * 0.05);
      const shield = Math.max(1, Math.round(hpLost * ratio));
      addEffect(target, { id: 'shield', duration: 2, value: shield }, context.log, effect.sourceRef || target, context);
    },
  },
  regeneration: {
    id: 'regeneration',
    name: 'Регенерация',
    type: 'buff',
    icon: '💚',
    description:
      'В начале хода восстанавливает 15% максимального здоровья до срабатывания эффектов урона. Несколько независимых эффектов Регенерации могут действовать одновременно.',
    defaultDuration: 2,
    stacking: 'stack',
    independentInstances: true,
    tickPriority: 1,
    onTick: ({ target, effect, context, log }) => {
      const maxHp = target.maxHp ?? target.hp ?? 0;
      const heal = Math.max(1, Math.round(maxHp * 0.15));
      const restored = applyEffectHealing({ target, amount: heal, context });
      if (restored > 0 && typeof log === 'function') {
        log(`💚 ${target.name || 'Цель'} восстанавливает ${restored} здоровья.`);
      }
      if (restored > 0) {
        context?.session?.onRegenerationTick?.({ target, effect, restored, context, log });
      }
    },
  },
  speed_boost_major: {
    id: 'speed_boost_major',
    name: 'Сильное ускорение',
    type: 'buff',
    icon: '💨',
    description: 'Повышает Скорость на 30%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { speed: 1.3 },
  },
  speed_boost_minor: {
    id: 'speed_boost_minor',
    name: 'Ускорение',
    type: 'buff',
    icon: '🏃',
    description: 'Повышает Скорость на 15%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { speed: 1.15 },
  },
  speed_penalty_major: {
    id: 'speed_penalty_major',
    name: 'Сильное замедление',
    type: 'debuff',
    icon: '🐌',
    description: 'Снижает Скорость на 30%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { speed: 0.7 },
  },
  speed_penalty_minor: {
    id: 'speed_penalty_minor',
    name: 'Замедление',
    type: 'debuff',
    icon: '🐢',
    description: 'Снижает Скорость на 20%.',
    defaultDuration: 1,
    stacking: 'refresh',
    statMultipliers: { speed: 0.8 },
  },
  sap_slow: {
    id: 'sap_slow',
    name: 'Слабое замедление',
    type: 'debuff',
    icon: '🐢',
    description: 'Устаревший вариант Замедления из старого боевого сохранения.',
    defaultDuration: 2,
    stacking: 'refresh',
    statMultipliers: { speed: 0.95 },
    legacyOnly: true,
  },
  withering_seed: {
    id: 'withering_seed',
    name: 'Семя увядания',
    type: 'status',
    icon: '🌱',
    description: 'На третьем Семени срабатывает Лук последнего цветения.',
    stacking: 'stack',
    maxStacks: 3,
    persistent: true,
    durationPresentation: 'permanent',
    unremovable: true,
  },
  great_root_plague: {
    id: 'great_root_plague',
    name: 'Чума',
    type: 'debuff',
    icon: '☠️',
    description: 'Бессрочная зараза Великого Корня. При смерти носителя заражает оставшихся врагов Отравлением и наносит урон Смертью.',
    stacking: 'refresh',
    persistent: true,
    durationPresentation: 'permanent',
    onOwnerDeath: ({ owner, effect, allies = [], context, log }) => {
      if (!owner || effect?.extra?.triggered) return;
      effect.extra ||= {};
      effect.extra.triggered = true;
      const source = resolveEffectDamageSource(effect, context);
      const poisonCount = (owner.effects || []).filter(entry => entry?.id === 'poison').length;
      const scaling = Math.max(
        Number(effect.sourceSnapshot?.attack) || 0,
        Number(effect.sourceSnapshot?.magAtk) || 0
      );
      const rawDamage = Math.max(0, Math.round(scaling * 0.25 * poisonCount));
      const living = (allies || []).filter(unit => unit && unit.hp > 0);
      living.forEach(recipient => {
        addEffect(recipient, { id: 'poison', duration: 2 }, log, source, { session: context?.session });
        addEffect(recipient, { id: 'poison', duration: 2 }, log, source, { session: context?.session });
        if (rawDamage > 0) {
          context?.session?.applyIndirectDamage?.(recipient, rawDamage, 'magical', {
            source,
            magicSchool: MAGIC_SCHOOLS.DEATH,
            fromEffect: 'great_root_plague',
            sourceEffectId: 'great_root_plague',
            logFn: log,
          });
        }
      });
      if (living.length > 0 && typeof log === 'function') {
        log(`☠️ Чума Великого Корня разрывается после смерти ${owner.name || 'носителя'}.`);
      }
    },
  },
  entanglement: {
    id: 'entanglement', name: 'Опутывание', type: 'debuff', icon: '🌿',
    description: 'До 5 зарядов. Каждый заряд снижает итоговую Скорость на 6%. После каждого второго собственного хода снимается один заряд.',
    stacking: 'stack', maxStacks: 5, persistent: true, durationPresentation: 'permanent',
  },
  archon_bud: {
    id: 'archon_bud', name: 'Бутон', type: 'debuff', icon: '🌱',
    description: 'В начале следующих двух ходов Архонта даёт 1 Опутывание. После второго тика распускается и накладывает Отравление на 3 хода.',
    stacking: 'refresh', persistent: true, durationPresentation: 'permanent',
    sourceTurnStart: true,
    onSourceTurnStart: ({ target, effect, source, context, log }) => {
      addEffect(target, { id: 'entanglement', stacks: 1 }, log, source, context);
      effect.extra ||= {};
      effect.extra.remainingSourceTurns = Math.max(0, (effect.extra.remainingSourceTurns ?? 2) - 1);
      if (effect.extra.remainingSourceTurns === 0) {
        const poisonDuration = Math.max(1, Number(effect.extra.poisonDuration) || 3);
        addEffect(target, { id: 'poison', duration: poisonDuration }, log, source, context);
        if (typeof log === 'function') log(`🌸 Бутон на ${target.name || 'цели'} распускается ядовитым цветком.`);
        target.effects.splice(target.effects.indexOf(effect), 1);
      }
    },
  },
  guard: {
    id: 'guard', name: 'Защита союзников', type: 'buff', icon: '🛡️',
    description: 'На протяжении двух ходов перехватывает направленные атаки по союзникам, пока страж жив и видим. Массовые атаки не перехватываются.',
    defaultDuration: 2, stacking: 'refresh',
  },
  overgrowth: {
    id: 'overgrowth', name: 'Зарастание', type: 'debuff', icon: '🌿',
    description: 'Следующая выполненная небазовая активная способность получает +1 к окончательному восстановлению; затем Зарастание снимается.',
    defaultDuration: 4, stacking: 'refresh',
  },
  elemental_magic_vulnerability: {
    id: 'elemental_magic_vulnerability', name: 'Стихийная уязвимость', type: 'debuff', icon: '✧',
    description: 'Увеличивает получаемый магический урон на 20% на 1 ход.', defaultDuration: 1, stacking: 'refresh',
    onApply: ({ target, effect }) => {
      target.damageTypeMultipliers ||= {};
      target.damageTypeMultipliers.magical = (target.damageTypeMultipliers.magical ?? 1) * 1.2;
      effect.extra ||= {}; effect.extra.appliedMultiplier = 1.2;
    },
    onExpire: ({ target, effect }) => {
      const multiplier = effect?.extra?.appliedMultiplier || 1.2;
      if (target.damageTypeMultipliers?.magical) target.damageTypeMultipliers.magical /= multiplier;
    },
  },
  blind: {
    id: 'blind',
    name: 'Слепота',
    type: 'debuff',
    icon: '🙈',
    description: 'Снижает шанс попадания ослеплённого бойца на 30 процентных пунктов.',
    defaultDuration: 2,
    stacking: 'refresh',
    statAdditives: { accuracyPenalty: 0.3 },
  },
  evasion: {
    id: 'evasion',
    name: 'Уклонение',
    type: 'buff',
    icon: '🌀',
    description: 'Повышает шанс бойца уклониться от атаки на 30 процентных пунктов.',
    defaultDuration: 2,
    stacking: 'refresh',
    statAdditives: { dodgeBonus: 0.3 },
  },
  stun: {
    id: 'stun',
    name: 'Оглушение',
    type: 'debuff',
    icon: '💫',
    description: 'Цель пропускает следующий ход.',
    defaultDuration: 1,
    stacking: 'refresh',
    interruptsPreparation: true,
    onApply: ({ target }) => { if (target?._preparation) target._preparation = null; },
  },
  freeze: {
    id: 'freeze',
    name: 'Заморозка',
    type: 'debuff',
    icon: '❄️',
    description:
      'Цель пропускает ход, а входящий урон увеличивается на 15%. Эффект спадает, когда цель получает урон в размере 15% от максимального здоровья.',
    defaultDuration: 99,
    stacking: 'refresh',
    interruptsPreparation: true,
    statMultipliers: { damageTaken: 1.15 },
    onApply: ({ target, effect }) => {
      if (!target) return;
      if (target._preparation) target._preparation = null;
      target.frozen = true;
      target.stunned = true;
      effect.extra = effect.extra || {};
      const maxHp = target.maxHp ?? target.hp ?? 0;
      const percentSource =
        typeof effect.value === 'number'
          ? effect.value
          : effect.value && typeof effect.value === 'object'
          ? effect.value.thresholdPercent ?? effect.value.percent ?? null
          : null;
      const percent = Math.min(1, Math.max(0.05, percentSource ?? effect.extra.thresholdPercent ?? 0.15));
      effect.extra.thresholdPercent = percent;
      effect.extra.damageThreshold = Math.max(1, Math.round(maxHp * percent));
      effect.extra.accumulatedDamage = 0;
    },
    onExpire: ({ target }) => {
      if (!target) return;
      target.frozen = false;
    },
    onDamageTaken: ({ target, damage, effect, context }) => {
      if (!target || !effect || !damage || damage <= 0) return;
      effect.extra = effect.extra || {};
      effect.extra.accumulatedDamage = (effect.extra.accumulatedDamage ?? 0) + damage;
      const threshold = effect.extra.damageThreshold ?? 0;
      if (threshold > 0 && effect.extra.accumulatedDamage >= threshold) {
        if (typeof context?.log === 'function') {
          context.log(`❄️ ${target.name || 'Цель'} освобождается от заморозки.`);
        }
        cleanseEffects(target, eff => eff === effect, context?.log);
      }
    },
  },
  shock: {
    id: 'shock',
    name: 'Шок',
    type: 'debuff',
    icon: '⚡',
    description:
      'С вероятностью 35% цель пропускает ход и получает на 15% больше урона. Когда цель получает урон магией Молнии, Шок переходит на случайного живого союзника, если он есть.',
    defaultDuration: 2,
    stacking: 'refresh',
    statMultipliers: { damageTaken: 1.15 },
    onApply: ({ effect }) => {
      effect.extra = effect.extra || {};
      const value = effect.value;
      let chance = effect.extra.skipChance;
      if (typeof chance !== 'number') {
        if (typeof value === 'number') {
          chance = value;
        } else if (value && typeof value === 'object') {
          chance = value.chance ?? value.skipChance ?? null;
        }
      }
      effect.extra.skipChance = Math.min(0.95, Math.max(0, chance ?? 0.35));
    },
    onExpire: ({ target }) => {
      if (!target) return;
      target.pendingShockSkip = false;
    },
    onDamageTaken: ({ target, effect, context }) => {
      if (!target || !context || context.magicSchool !== 'lightning') return;
      const allies = getAlliedUnits(target, context);
      if (!Array.isArray(allies) || allies.length === 0) return;
      const livingAllies = allies.filter(unit => unit && unit !== target && unit.hp > 0);
      if (livingAllies.length === 0) return;
      const withoutShock = livingAllies.filter(unit => !(unit.effects || []).some(eff => eff.id === 'shock'));
      const pool = withoutShock.length > 0 ? withoutShock : livingAllies;
      if (pool.length === 0) return;
      const rng = context?.rng || context?.session?.rng || Math.random;
      const recipient = pool[Math.floor(rng() * pool.length)];
      const duration = Math.max(1, effect.remainingTurns ?? effect.duration ?? effect.durationTotal ?? 1);
      addEffect(
        recipient,
        { id: 'shock', duration },
        context?.log,
        effect.sourceRef || context.source || null,
        context
      );
      if (typeof context?.log === 'function') {
        context.log(`⚡ Шок перескакивает на ${recipient.name || 'другую цель'}!`);
      }
    },
  },
  vulnerability: {
    id: 'vulnerability',
    name: 'Уязвимость',
    type: 'debuff',
    icon: '🎯',
    description: 'Цель получает на 25% больше урона.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { damageTaken: 1.25 },
  },
  magic_def_boost_major: {
    id: 'magic_def_boost_major',
    name: 'Сильный оберег',
    type: 'buff',
    icon: '🔰',
    description: 'Повышает магическую защиту на 50%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { magicDef: 1.5 },
  },
  magic_def_boost_minor: {
    id: 'magic_def_boost_minor',
    name: 'Оберег',
    type: 'buff',
    icon: '🔆',
    description: 'Повышает магическую защиту на 25%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { magicDef: 1.25 },
  },
  magic_def_penalty_major: {
    id: 'magic_def_penalty_major',
    name: 'Магическая беззащитность',
    type: 'debuff',
    icon: '💥',
    description: 'Снижает магическую защиту на 50%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { magicDef: 0.5 },
  },
  magic_def_penalty_minor: {
    id: 'magic_def_penalty_minor',
    name: 'Магическая слабость',
    type: 'debuff',
    icon: '💢',
    description: 'Снижает магическую защиту на 25%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { magicDef: 0.75 },
  },
  magic_attack_boost_major: {
    id: 'magic_attack_boost_major',
    name: 'Великая магическая мощь',
    type: 'buff',
    icon: '✨',
    description: 'Повышает Магическую атаку на 50%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { magAtk: 1.5 },
  },
  magic_attack_boost_minor: {
    id: 'magic_attack_boost_minor',
    name: 'Магическая мощь',
    type: 'buff',
    icon: '🔮',
    description: 'Повышает Магическую атаку на 25%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { magAtk: 1.25 },
  },
  magic_attack_penalty_major: {
    id: 'magic_attack_penalty_major',
    name: 'Сильное подавление магии',
    type: 'debuff',
    icon: '☄️',
    description: 'Снижает Магическую атаку на 50%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { magAtk: 0.5 },
  },
  magic_attack_penalty_minor: {
    id: 'magic_attack_penalty_minor',
    name: 'Подавление магии',
    type: 'debuff',
    icon: '🌪️',
    description: 'Снижает Магическую атаку на 25%.',
    defaultDuration: 3,
    stacking: 'refresh',
    statMultipliers: { magAtk: 0.75 },
  },
  silence: {
    id: 'silence',
    name: 'Немота',
    type: 'debuff',
    icon: '🤐',
    description: 'Цель не может использовать способности, только автоатаку.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      target.silenced = true;
    },
    onExpire: ({ target }) => {
      target.silenced = false;
    },
  },
  passive_break: {
    id: 'passive_break',
    name: 'Сломленность',
    type: 'debuff',
    icon: '🔻',
    description: 'У цели не работают пассивные способности.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      target.passivesDisabled = true;
    },
    onExpire: ({ target }) => {
      target.passivesDisabled = false;
    },
  },
  invisibility: {
    id: 'invisibility',
    name: 'Невидимость',
    type: 'buff',
    icon: '🫥',
    description: 'Цель становится недоступной для прицельных атак. Массовые атаки всё ещё попадают.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (target) target.invisible = true;
    },
    onExpire: ({ target }) => {
      if (target) target.invisible = false;
    },
  },
  block_blessings: {
    id: 'block_blessings',
    name: 'Отрицание усилений',
    type: 'debuff',
    icon: '🚫',
    description: 'Не позволяет накладывать новые положительные эффекты. Уже действующие положительные эффекты не снимаются.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (target) target.blockBuffs = true;
    },
    onExpire: ({ target }) => {
      if (target) target.blockBuffs = false;
    },
  },
  block_curses: {
    id: 'block_curses',
    name: 'Невосприимчивость',
    type: 'buff',
    icon: '🛡️',
    description: 'Не позволяет накладывать новые негативные эффекты. Уже действующие негативные эффекты не снимаются.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (target) target.blockDebuffs = true;
    },
    onExpire: ({ target }) => {
      if (target) target.blockDebuffs = false;
    },
  },
  decay: {
    id: 'decay',
    name: 'Порча',
    type: 'debuff',
    icon: '🧿',
    description:
      'Накапливает 35% полученного непериодического урона и в конце действия наносит накопленный урон магией смерти, игнорируя 30% магической защиты (до 50% от макс. HP).',
    defaultDuration: 3,
    stacking: 'refresh',
    onDamageTaken: ({ effect, damage, context }) => {
      if (!effect || !damage || damage <= 0) return;
      if (context?.fromEffect === 'decay') return;
      if (context?.isPeriodic) return;
      effect.extra = effect.extra || {};
      effect.extra.accumulated = (effect.extra.accumulated ?? 0) + damage * 0.35;
    },
    onExpire: ({ target, effect, context }) => {
      if (!target || !effect) return;
      const stored = Math.max(0, Math.round(effect.extra?.accumulated ?? 0));
      if (stored <= 0) return;
      const maxHit = Math.max(1, Math.round((target.maxHp ?? target.hp ?? stored) * 0.5));
      const amount = Math.min(stored, maxHit);
      if (typeof context?.applyDamage === 'function') {
        context.applyDamage(target, amount, 'magical', {
          source: effect.sourceRef || context.source || null,
          ignoreDefenseFraction: 0.3,
          magicSchool: 'death',
          fromEffect: 'decay',
        });
      } else {
        const def = Math.max(0, (target.magicDef || 0) * 0.7);
        const mitigation = def / (def + 100);
        const dmg = Math.max(1, Math.round(amount * (1 - mitigation)));
        target.hp = Math.max(0, (target.hp ?? 0) - dmg);
      }
    },
  },
  gloom: {
    id: 'gloom',
    name: 'Мрак',
    type: 'debuff',
    icon: '🌑',
    description:
      'В начале хода наносит магический урон Тьмой в размере 40% Магической атаки источника и ещё 10% за каждый другой негативный эффект на цели. Урон игнорирует Щит, но учитывает магическую защиту.',
    defaultDuration: 3,
    stacking: 'refresh',
    onTick: ({ target, effect, context }) => {
      if (!target || !effect) return;
      const magAtk = effect.sourceSnapshot?.magAtk ?? 0;
      const otherDebuffs = (target.effects || []).filter(
        eff => eff && eff.id !== effect.id && getEffectDefinition(eff.id)?.type === 'debuff'
      );
      const damage = Math.max(1, Math.round(magAtk * (0.4 + 0.1 * otherDebuffs.length)));
      applyEffectDamage({
        target,
        amount: damage,
        type: 'magical',
        magicSchool: MAGIC_SCHOOLS.DARKNESS,
        effect,
        context,
        bypassShield: true,
      });
    },
  },
  stiffness: {
    id: 'stiffness',
    name: 'Оцепенение',
    type: 'debuff',
    icon: '🧊',
    description:
      'При получении урона цель теряет 5% шкалы хода, а в начале хода теряет ещё 15%.',
    defaultDuration: 2,
    stacking: 'refresh',
    onTick: ({ target }) => {
      if (!target) return;
      if (target._temporaryControlImmunity) return;
      target.turnMeter = Math.max(0, (target.turnMeter ?? 0) - TURN_METER_THRESHOLD * 0.15);
    },
    onDamageTaken: ({ target, damage }) => {
      if (!target || !damage || damage <= 0) return;
      if (target._temporaryControlImmunity) return;
      target.turnMeter = Math.max(0, (target.turnMeter ?? 0) - TURN_METER_THRESHOLD * 0.05);
    },
  },
  echo: {
    id: 'echo',
    name: 'Отзвук',
    type: 'debuff',
    icon: '🔊',
    description:
      'При получении положительного урона цель получает дополнительный магический урон Молнией в размере 25% этого урона, а каждый живой союзник — половину дополнительного урона. Сам Отзвук повторно не срабатывает от своего урона.',
    defaultDuration: 2,
    stacking: 'refresh',
    onDamageTaken: ({ target, damage, context }) => {
      if (!target || !damage || damage <= 0 || context?.fromEffect === 'echo') return;
      const extra = Math.max(1, Math.round(damage * 0.25));
      const applyFn = context?.applyDamage;
      if (typeof applyFn === 'function') {
        applyFn(target, extra, 'magical', { magicSchool: 'lightning', fromEffect: 'echo', source: context.source });
        const allies = getAlliedUnits(target, context) || [];
        allies
          .filter(unit => unit && unit !== target && unit.hp > 0)
          .forEach(unit => {
            applyFn(unit, Math.max(1, Math.round(extra * 0.5)), 'magical', {
              magicSchool: 'lightning',
              fromEffect: 'echo',
              source: context.source,
            });
          });
      }
    },
  },
  searing_mark: {
    id: 'searing_mark',
    name: 'Испепеляющее клеймо',
    type: 'debuff',
    icon: '🔥',
    description:
      'В начале хода наносит магический урон Светом в размере 30% Магической атаки источника и ещё 10% за каждый положительный эффект на цели. Урон игнорирует Щит, но учитывает магическую защиту.',
    defaultDuration: 3,
    stacking: 'refresh',
    onTick: ({ target, effect, context }) => {
      if (!target || !effect) return;
      const damage = calculateSearingMarkTickDamage(target, effect);
      applyEffectDamage({
        target,
        amount: damage,
        type: 'magical',
        magicSchool: MAGIC_SCHOOLS.LIGHT,
        effect,
        context,
        bypassShield: true,
      });
    },
  },
  forgetfulness: {
    id: 'forgetfulness',
    name: 'Беспамятство',
    type: 'debuff',
    icon: '◌',
    description: 'При выборе небазовой способности с вероятностью 50% применяется другая доступная способность. Без подмены перезарядка выбранной способности увеличивается на 1 ход.',
    defaultDuration: 2,
    stacking: 'refresh',
  },
  healing_curse: {
    id: 'healing_curse',
    name: 'Проклятие исцеления',
    type: 'debuff',
    icon: '🩸',
    description: 'Исцеление, которое получает цель, превращается в урон.',
    defaultDuration: 3,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (target) target.healingInverted = true;
    },
    onExpire: ({ target }) => {
      if (target) target.healingInverted = false;
    },
  },
  control_immunity: {
    id: 'control_immunity',
    name: 'Непоколебимость',
    type: 'buff',
    icon: '🛡️',
    description: 'Не позволяет накладывать Оглушение, Заморозку, Шок, Немоту, Оцепенение, Провокацию, Замедления и Сон, а также защищает шкалу хода от вражеского уменьшения, обнуления и кражи.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (target) { target._temporaryControlImmunity = (target._temporaryControlImmunity || 0) + 1; target.controlImmune = true; }
    },
    onExpire: ({ target }) => {
      if (target) { target._temporaryControlImmunity = Math.max(0, (target._temporaryControlImmunity || 1) - 1); target.controlImmune = Boolean(target.innateControlImmune || target._temporaryControlImmunity); }
    },
  },
  immortality: {
    id: 'immortality',
    name: 'Бессмертие',
    type: 'buff',
    icon: '♾️',
    description: 'Здоровье не может опуститься ниже 1 до конца действия эффекта, кроме урона чистого типа.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (target) target.immortal = true;
    },
    onExpire: ({ target }) => {
      if (target) target.immortal = false;
    },
  },
  rebirth: {
    id: 'rebirth',
    name: 'Перерождение',
    type: 'buff',
    icon: '🕊️',
    description: 'Если цель умирает, она воскрешается с 30% здоровья и пустой шкалой хода.',
    defaultDuration: 3,
    stacking: 'refresh',
    removable: true,
    onDamageTaken: ({ target, effect, context }) => {
      if (!target || !effect) return;
      if (target.hp > 0) return;
      if (effect.extra?.consumed) return;
      effect.extra = effect.extra || {};
      effect.extra.consumed = true;
      const restored = Math.max(1, Math.round((target.maxHp ?? 0) * 0.3));
      target.hp = restored;
      target.turnMeter = 0;
      cleanseEffects(target, eff => eff.id === 'rebirth', context?.log);
      if (typeof context?.log === 'function') {
        context.log(`✨ ${target.name || 'Боец'} возрождается с ${restored} HP!`);
      }
    },
  },
  magic_reflection: {
    id: 'magic_reflection',
    name: 'Отражение магии',
    type: 'buff',
    icon: '🪞',
    description: 'Возвращает атакующему 30% полученного магического урона.',
    defaultDuration: 2,
    stacking: 'refresh',
    onDamageTaken: ({ target, damage, context }) => {
      if (!damage || damage <= 0) return;
      if (context?.damageType !== 'magical' || !context?.source) return;
      if (context?.fromEffect === 'magic_reflection') return;
      const reflect = Math.max(1, Math.round(damage * 0.3));
      if (typeof context.applyDamage === 'function') {
        context.applyDamage(context.source, reflect, 'magical', {
          source: target,
          magicSchool: context.magicSchool ?? null,
          fromEffect: 'magic_reflection',
        });
      }
    },
  },
  spectral_form: {
    id: 'spectral_form',
    name: 'Спектральная форма',
    type: 'buff',
    icon: '👻',
    description: 'Неуязвимость к физическому урону, но +50% к получаемому магическому урону.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (!target) return;
      target.physImmune = true;
      target.damageTypeMultipliers = target.damageTypeMultipliers || {};
      target.damageTypeMultipliers.magical = (target.damageTypeMultipliers.magical ?? 1) * 1.5;
    },
    onExpire: ({ target }) => {
      if (!target) return;
      target.physImmune = false;
      if (target.damageTypeMultipliers?.magical) {
        target.damageTypeMultipliers.magical = target.damageTypeMultipliers.magical / 1.5;
      }
    },
  },
  diamond_skin: {
    id: 'diamond_skin',
    name: 'Алмазная кожа',
    type: 'buff',
    icon: '💎',
    description: 'Устаревшее название Спектральной формы из старого боевого сохранения.',
    defaultDuration: 2,
    stacking: 'refresh',
    legacyOnly: true,
    onApply: ({ target }) => {
      if (!target) return;
      target.physImmune = true;
      target.damageTypeMultipliers = target.damageTypeMultipliers || {};
      target.damageTypeMultipliers.magical = (target.damageTypeMultipliers.magical ?? 1) * 1.5;
    },
    onExpire: ({ target }) => {
      if (!target) return;
      target.physImmune = false;
      if (target.damageTypeMultipliers?.magical) {
        target.damageTypeMultipliers.magical = target.damageTypeMultipliers.magical / 1.5;
      }
    },
  },
  antimagic_veil: {
    id: 'antimagic_veil',
    name: 'Пелена Антимагии',
    type: 'buff',
    icon: '🌀',
    description: 'Неуязвимость к магическому урону, но +50% к получаемому физическому урону.',
    defaultDuration: 2,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (!target) return;
      target.magicImmune = true;
      target.damageTypeMultipliers = target.damageTypeMultipliers || {};
      target.damageTypeMultipliers.physical = (target.damageTypeMultipliers.physical ?? 1) * 1.5;
    },
    onExpire: ({ target }) => {
      if (!target) return;
      target.magicImmune = false;
      if (target.damageTypeMultipliers?.physical) {
        target.damageTypeMultipliers.physical = target.damageTypeMultipliers.physical / 1.5;
      }
    },
  },
  armor_sunder: {
    id: 'armor_sunder',
    name: 'Раскол брони',
    type: 'debuff',
    icon: '🪓',
    description: 'При нанесении урона по цели игнорируется 30% её физической брони.',
    defaultDuration: 3,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (!target) return;
      target.incomingPhysDefenseIgnore = Math.max(0.3, target.incomingPhysDefenseIgnore || 0);
    },
    onExpire: ({ target }) => {
      if (!target) return;
      target.incomingPhysDefenseIgnore = 0;
    },
  },
  spell_breaker: {
    id: 'spell_breaker',
    name: 'Разрушитель чар',
    type: 'debuff',
    icon: '🌌',
    description: 'При нанесении урона по цели игнорируется 30% её магической брони.',
    defaultDuration: 3,
    stacking: 'refresh',
    onApply: ({ target }) => {
      if (!target) return;
      target.incomingMagicDefenseIgnore = Math.max(0.3, target.incomingMagicDefenseIgnore || 0);
    },
    onExpire: ({ target }) => {
      if (!target) return;
      target.incomingMagicDefenseIgnore = 0;
    },
  },
  astral_wound: {
    id: 'astral_wound',
    name: 'Астральная рана',
    type: 'debuff',
    icon: '🌌',
    description: 'Устаревшее название Спеллбрейкера из старого боевого сохранения.',
    defaultDuration: 3,
    stacking: 'refresh',
    legacyOnly: true,
    onApply: ({ target }) => {
      if (!target) return;
      target.incomingMagicDefenseIgnore = Math.max(0.3, target.incomingMagicDefenseIgnore || 0);
    },
    onExpire: ({ target }) => {
      if (!target) return;
      target.incomingMagicDefenseIgnore = 0;
    },
  },
};

Object.entries(EFFECT_LIBRARY).forEach(([effectId, definition]) => {
  const fileName = EFFECT_ICON_FILES[effectId];
  if (definition && fileName) {
    definition.iconPath = buildIconPath(EFFECT_ICON_BASE_PATH, fileName);
  }
});

export const ALL_EFFECTS = Object.values(EFFECT_LIBRARY);
const LEGACY_EFFECT_NAME_ALIASES = {
  'Малое Благословение Атаки': 'attack_boost_minor',
  'Благословение Атаки': 'attack_boost_major',
  'Малый Штраф Атаки': 'attack_penalty_minor',
  'Штраф Атаки': 'attack_penalty_major',
  'Малое Благословение Защиты': 'phys_def_boost_minor',
  'Благословение Защиты': 'phys_def_boost_major',
  'Малый Штраф Защиты': 'phys_def_penalty_minor',
  'Штраф Защиты': 'phys_def_penalty_major',
  'Малое Благословение Скорости': 'speed_boost_minor',
  'Благословение Скорости': 'speed_boost_major',
  'Малый Штраф Скорости': 'speed_penalty_minor',
  'Штраф Скорости': 'speed_penalty_major',
  'Малое Благословение Антимагии': 'magic_def_boost_minor',
  'Благословение Антимагии': 'magic_def_boost_major',
  'Малая Уязвимость к Магии': 'magic_def_penalty_minor',
  'Уязвимость к Магии': 'magic_def_penalty_major',
  'Малое Благословение Магической Силы': 'magic_attack_boost_minor',
  'Благословение Магической Силы': 'magic_attack_boost_major',
  'Малый Знак Антимагии': 'magic_attack_penalty_minor',
  'Знак Антимагии': 'magic_attack_penalty_major',
  Слабость: 'vulnerability',
  Поджог: 'burn',
  Яд: 'poison',
  'Блок бонусов': 'block_blessings',
  'Блок штрафов': 'block_curses',
  'Проклятие Лечения': 'healing_curse',
  'Испепеляющее Клеймо': 'searing_mark',
};
export const EFFECT_IDS = ALL_EFFECTS.reduce((acc, effect) => {
  acc[effect.name] = effect.id;
  acc[effect.id] = effect.id;
  return acc;
}, {});
export const ALL_EFFECT_IDS = ALL_EFFECTS.map(effect => effect.id);

// --- Вспомогательные функции ----------------------------------------------
function ensureBaseStats(target) {
  if (!target) return;
  if (!target.baseStats) {
    target.baseStats = {
      attack: target.attack ?? target.baseAtk ?? 0,
      magAtk: target.magAtk ?? target.magicAttack ?? 0,
      physDef: target.physDef ?? target.basePhysDef ?? 0,
      magicDef: target.magicDef ?? target.baseMagicDef ?? 0,
      speed: target.speed ?? target.baseSpeed ?? 0,
    };
  }
  if (!target.statMultipliers) {
    target.statMultipliers = {
      attack: 1,
      magAtk: 1,
      physDef: 1,
      magicDef: 1,
      speed: 1,
      damageTaken: 1,
    };
  }
  if (!target.statAdditives) {
    target.statAdditives = {
      dodgeBonus: 0,
      accuracyBonus: 0,
      accuracyPenalty: 0,
    };
  }
}

function recalcDerivedStats(target) {
  if (!target?.baseStats) return;
  target.attack = Math.max(0, Math.round((target.baseStats.attack ?? 0) * (target.statMultipliers.attack ?? 1)));
  target.magAtk = Math.max(0, Math.round((target.baseStats.magAtk ?? 0) * (target.statMultipliers.magAtk ?? 1)));
  target.physDef = Math.max(0, Math.round((target.baseStats.physDef ?? 0) * (target.statMultipliers.physDef ?? 1)));
  target.magicDef = Math.max(0, Math.round((target.baseStats.magicDef ?? 0) * (target.statMultipliers.magicDef ?? 1)));
  target.speed = Math.max(0, Math.round((target.baseStats.speed ?? 0) * (target.statMultipliers.speed ?? 1)));
}

function applyStatModifiers(target, effect, direction = 1) {
  const metadata = getEffectDefinition(effect.id);
  if (!metadata) return;
  ensureBaseStats(target);

  if (metadata.statMultipliers) {
    effect.appliedMultipliers = effect.appliedMultipliers || {};
    Object.entries(metadata.statMultipliers).forEach(([stat, authoredMultiplier]) => {
      const slowMitigation = !target.passivesDisabled && metadata.type === 'debuff' && stat === 'speed' && authoredMultiplier < 1
        ? Math.max(0, Math.min(1, (target.abilities || []).reduce((best, ability) => Math.max(best, Number(ability?.hostileSpeedPenaltyMitigation) || 0), 0)))
        : 0;
      const multiplier = authoredMultiplier + (1 - authoredMultiplier) * slowMitigation;
      if (direction > 0) {
        effect.appliedMultipliers[stat] = (effect.appliedMultipliers[stat] ?? 1) * multiplier;
        target.statMultipliers[stat] = (target.statMultipliers[stat] ?? 1) * multiplier;
      } else {
        const applied = effect.appliedMultipliers[stat] ?? 1;
        if (applied !== 0) {
          target.statMultipliers[stat] = (target.statMultipliers[stat] ?? 1) / applied;
        }
        effect.appliedMultipliers[stat] = 1;
      }
    });
  }

  if (metadata.statAdditives) {
    effect.appliedAdditives = effect.appliedAdditives || {};
    Object.entries(metadata.statAdditives).forEach(([stat, value]) => {
      if (direction > 0) {
        effect.appliedAdditives[stat] = (effect.appliedAdditives[stat] ?? 0) + value;
        target.statAdditives[stat] = (target.statAdditives[stat] ?? 0) + value;
      } else {
        const applied = effect.appliedAdditives[stat] ?? 0;
        target.statAdditives[stat] = (target.statAdditives[stat] ?? 0) - applied;
        effect.appliedAdditives[stat] = 0;
      }
    });
  }

  if (metadata.statMultipliers) recalcDerivedStats(target);
}

export function resolveEffectDamageSource(effect, context = {}) {
  const state = context?.session?.state;
  const combatants = state
    ? [...(state.players || []), ...(state.enemies || [])]
    : [];
  const sourceRef = effect?.sourceRef || effect?.sourceSnapshot?.entity || null;
  // A live in-memory reference is authoritative (some systemic effects are
  // legitimately owned by transient combat objects outside the main rosters).
  if (sourceRef?.hp > 0) return sourceRef;

  const sourceId = effect?.sourceId ?? effect?.sourceSnapshot?.id ?? sourceRef?.id ?? null;
  if (sourceId == null || !state) return null;
  return combatants.find(unit => unit?.hp > 0 && unit.id === sourceId) || null;
}

function applyEffectDamage({ target, amount, type = 'physical', magicSchool, effect, context, isPeriodic = true, bypassShield = false }) {
  if (!target || amount <= 0) return 0;
  if (typeof context?.applyDamage === 'function') {
    return context.applyDamage(target, amount, type, {
      source: resolveEffectDamageSource(effect, context),
      magicSchool,
      isPeriodic,
      bypassShield,
      directAttack: false,
      fromEffect: effect?.id || null,
      sourceEffectId: effect?.id || null,
      sourceEffectInstance: effect,
      originActionId: effect?.metadata?.forestOriginId ?? null,
    });
  }
  // fallback расчёт
  ensureBaseStats(target);
  const defense = type === 'magical' ? target.magicDef || 0 : target.physDef || 0;
  const mitigation = defense / (defense + 100);
  // Follow the central combat path: mitigation protects HP, not Shield durability.
  const incoming = Math.max(1, Math.round(amount * (target.statMultipliers?.damageTaken ?? 1)));
  let overflow = incoming;
  if (!bypassShield && target.shield > 0) {
    const absorbed = Math.min(target.shield, incoming);
    target.shield -= absorbed;
    overflow -= absorbed;
  }
  const damage = Math.max(0, Math.round(overflow * (1 - mitigation)));
  target.hp = Math.max(0, (target.hp ?? 0) - damage);
  return damage;
}

function applyEffectHealing({ target, amount, context }) {
  if (!target || amount <= 0) return 0;
  if (typeof context?.applyHealing === 'function') {
    return context.applyHealing(target, amount, context);
  }
  const prev = target.hp ?? 0;
  const max = target.maxHp ?? prev;
  target.hp = Math.min(max, prev + amount);
  return target.hp - prev;
}

const EFFECT_NAME_LOOKUP = {};
Object.values(EFFECT_LIBRARY).forEach(effect => {
  if (effect?.name) {
    EFFECT_NAME_LOOKUP[effect.name.toLowerCase()] = effect;
  }
  EFFECT_NAME_LOOKUP[effect.id] = effect;
});
Object.entries(LEGACY_EFFECT_NAME_ALIASES).forEach(([legacyName, effectId]) => {
  EFFECT_NAME_LOOKUP[legacyName.toLowerCase()] = EFFECT_LIBRARY[effectId];
});

export function getEffectDefinition(nameOrId) {
  if (!nameOrId) return null;
  const key = String(nameOrId).trim().toLowerCase();
  if (EFFECT_LIBRARY[key]) return EFFECT_LIBRARY[key];
  if (EFFECT_NAME_LOOKUP[key]) return EFFECT_NAME_LOOKUP[key];
  return null;
}

export const isEffectUnremovable = effect => {
  const metadata = getEffectDefinition(effect?.id || effect?.name);
  return metadata?.unremovable === true || effect?.unremovable === true || effect?.removable === false;
};

// Single eligibility rule for status theft and transfer. These are moves,
// not dispels: a status which cannot be dispelled must never be moved either.
// Resource effects are deliberately excluded even if a future one is removable.
export const isEffectTransferable = effect => {
  const metadata = getEffectDefinition(effect?.id || effect?.name);
  if (metadata?.type !== 'buff' && metadata?.type !== 'debuff') return false;
  return !isEffectUnremovable(effect)
    && metadata?.removable !== false
    && effect?.extra?.removable !== false;
};

export const getEffectStackCount = (unit, effectId) => (unit?.effects || [])
  .filter(effect => effect?.id === effectId)
  .reduce((total, effect) => total + Math.max(1, Number(effect.stacks) || 1), 0);

export function setEffectStackCount(unit, effectId, amount) {
  if (!unit) return 0;
  if (!Array.isArray(unit.effects)) unit.effects = [];
  const count = Math.max(0, Math.floor(Number(amount) || 0));
  unit.effects = unit.effects.filter(effect => effect?.id !== effectId);
  if (count > 0) {
    const metadata = getEffectDefinition(effectId);
    if (!metadata) return 0;
    unit.effects.push({
      id: metadata.id, name: metadata.name, kind: metadata.type, type: metadata.type,
      icon: metadata.icon, iconPath: metadata.iconPath, description: metadata.description,
      stacks: count, persistent: true, durationPresentation: 'permanent', unremovable: metadata.unremovable === true,
    });
  }
  return count;
}

// A single visible resource can provide an additive per-stack stat multiplier
// without creating compounded independent effect instances.
export function setDynamicStatSteps(unit, key, amount, stat, perStep) {
  if (!unit) return 0;
  ensureBaseStats(unit);
  const previous = Math.max(0, Number(unit._dynamicStatSteps?.[key]) || 0);
  const next = Math.max(0, Math.floor(Number(amount) || 0));
  const previousMultiplier = 1 + previous * perStep;
  const nextMultiplier = 1 + next * perStep;
  unit.statMultipliers[stat] = (unit.statMultipliers[stat] ?? 1) / previousMultiplier * nextMultiplier;
  unit._dynamicStatSteps = { ...(unit._dynamicStatSteps || {}), [key]: next };
  recalcDerivedStats(unit);
  return next;
}

export function setDynamicStatMultiplier(unit, key, multiplier, stat) {
  if (!unit) return 1;
  ensureBaseStats(unit);
  const previous = Math.max(0.01, Number(unit._dynamicStatMultipliers?.[key]) || 1);
  const next = Math.max(0.01, Number(multiplier) || 1);
  unit.statMultipliers[stat] = (unit.statMultipliers[stat] ?? 1) / previous * next;
  unit._dynamicStatMultipliers = { ...(unit._dynamicStatMultipliers || {}), [key]: next };
  recalcDerivedStats(unit);
  return next;
}

export function countUniqueActiveEffectsByType(unit, type) {
  return new Set((unit?.effects || [])
    .filter(effect => {
      const metadata = getEffectDefinition(effect?.id);
      const remaining = effect?.remainingTurns ?? effect?.duration;
      return metadata?.type === type && (effect?.persistent || metadata?.persistent || remaining == null || remaining > 0);
    })
    .map(effect => effect.id)).size;
}

export const countUniqueActiveBuffs = unit => countUniqueActiveEffectsByType(unit, 'buff');
export const countUniqueActiveDebuffs = unit => countUniqueActiveEffectsByType(unit, 'debuff');

export function setDynamicResourceStacks(unit, effectId, amount, stat, perStack) {
  const next = setDynamicStatSteps(unit, effectId, amount, stat, perStack);
  setEffectStackCount(unit, effectId, next);
  return next;
}

export function syncCrimsonEcstasy(target, logFn = () => {}) {
  if (!target || (target.effects || []).some(effect => effect?.id === 'bleed')) return false;
  const stacks = getEffectStackCount(target, 'crimson_ecstasy');
  if (stacks <= 0) return false;
  setDynamicResourceStacks(target, 'crimson_ecstasy', 0, 'speed', 0.1);
  logFn(`♦ Багровый экстаз ${target.name || 'героя'} угасает.`);
  return true;
}

export function consumeEffectStacks(unit, effectId, amount = 1) {
  const available = getEffectStackCount(unit, effectId);
  const spent = Math.min(available, Math.max(0, Math.floor(Number(amount) || 0)));
  setEffectStackCount(unit, effectId, available - spent);
  return spent;
}

function markBlockingFlags(target, effectId) {
  if (!target) return;
  if (effectId === 'stun' || effectId === 'freeze') {
    target.stunned = true;
    if (effectId === 'freeze') {
      target.frozen = true;
    }
  }
  if (effectId === 'silence') {
    target.silenced = true;
  }
}

function createEffectInstance(effectData = {}, metadata, source) {
  const persistent = effectData.persistent ?? metadata.persistent ?? false;
  const duration = persistent ? null : effectData.duration ?? metadata.defaultDuration ?? 1;
  const instance = {
    id: metadata.id,
    name: metadata.name,
    kind: metadata.type,
    icon: effectData.icon ?? metadata.icon ?? DEFAULT_ICON,
    iconPath: effectData.iconPath ?? metadata.iconPath ?? null,
    description: metadata.description,
    type: metadata.type,
    durationTotal: duration,
    remainingTurns: duration,
    duration: duration,
    stacking: metadata.stacking ?? 'refresh',
    persistent,
    unremovable: effectData.unremovable ?? metadata.unremovable ?? false,
    value: effectData.value ?? metadata.value ?? null,
    echoBaseValue: effectData.echoBaseValue ?? null,
    sourceSnapshot: {
      id: source?.id ?? source?.combatInstanceId ?? source?.runtimeId ?? source?.name ?? effectData.sourceId ?? null,
      attack: effectData.sourceAttack ?? source?.attack ?? source?.baseAtk ?? 0,
      magAtk: effectData.sourceMagAtk ?? source?.magAtk ?? 0,
      scaling: effectData.sourceScaling ?? effectData.sourceMagAtk ?? source?.magAtk ?? 0,
      name: source?.name ?? effectData.sourceName ?? 'Источник',
      entity: source ?? null,
    },
    sourceRef: source ?? null,
  };
  if (effectData.onBreak) {
    instance.onBreak = effectData.onBreak;
  }
  if (effectData.metadata) {
    instance.metadata = { ...effectData.metadata };
  }
  instance.extra = effectData.extra ? { ...effectData.extra } : {};
  return instance;
}

function resolveRefreshedExtra(metadata, existing, instance) {
  if (metadata?.id !== 'shield') {
    return instance.extra ? { ...instance.extra } : null;
  }

  const mergedExtra = instance.extra ? { ...instance.extra } : {};
  if (Array.isArray(existing?.extra?.shieldSources)) {
    mergedExtra.shieldSources = existing.extra.shieldSources;
  }
  const explicitlyOverridesFrost = Object.prototype.hasOwnProperty.call(mergedExtra, 'frostRetaliation');
  if (existing?.extra?.frostRetaliation && !explicitlyOverridesFrost) {
    mergedExtra.frostRetaliation = existing.extra.frostRetaliation;
    if (
      existing.extra.retaliationChance !== undefined &&
      !Object.prototype.hasOwnProperty.call(mergedExtra, 'retaliationChance')
    ) {
      mergedExtra.retaliationChance = existing.extra.retaliationChance;
    }
  }

  return Object.keys(mergedExtra).length > 0 ? mergedExtra : null;
}

// --- Публичные API ---------------------------------------------------------
export function addEffect(target, effectData, logFn, source = null, context = {}) {
  if (!target || !effectData) return null;
  if (!Array.isArray(target.effects)) target.effects = [];
  ensureBaseStats(target);

  const durationExtensionOnly = effectData.extendOnly === true || context?.effectOperation === 'extendDuration';
  const explicitlySelectedEffect = effectData.effectInstance || context?.effectInstance || null;
  const metadata = getEffectDefinition(effectData.id || effectData.name || explicitlySelectedEffect?.id);
  if (target.noPositiveEffects && metadata && metadata.type !== 'debuff') return null;
  if (!metadata) {
    if (typeof logFn === 'function') {
      logFn(`⚠️ Эффект "${effectData.name || effectData.id}" не найден.`);
    }
    return null;
  }

  const recordStatusFeedback = (type, extra = {}) => {
    recordCombatPresentationEvent(context?.session, {
      type,
      actor: extra.actor ?? source,
      target,
      label: extra.label || metadata.name || effectData.name || effectData.id,
      effectId: extra.effectId || metadata.id,
      effectType: metadata.type,
      ...extra,
    });
  };

  if (
    metadata.type === 'debuff' &&
    !context?._borrowedGuiltMirror &&
    hasEquipped(target, BORROWED_GUILT_CUIRASS) &&
    !target._borrowedGuiltCuirassUsed &&
    areHostileUnits(target, source, context?.session)
  ) {
    target._borrowedGuiltCuirassUsed = true;
    addEffect(source, { ...effectData }, logFn, target, {
      ...context,
      _borrowedGuiltMirror: true,
    });
    if (typeof logFn === 'function') {
      logFn(`🪞 ${BORROWED_GUILT_CUIRASS} блокирует «${metadata.name}» и отражает его в источник.`);
    }
    recordStatusFeedback("statusBlocked", { statusOperation: "blocked", reason: "reflected" });
    return null;
  }

  if (!context?._durationTransformed && typeof context?.session?.transformEffectApplication === 'function') {
    effectData = context.session.transformEffectApplication({ target, source, effectData: { ...effectData }, metadata, context }) || effectData;
    context = { ...context, _durationTransformed: true };
  }

  if (durationExtensionOnly) {
    const selectedEffect = explicitlySelectedEffect
      || (metadata.independentInstances ? null : target.effects.find(effect => effect?.id === metadata.id));
    if (!selectedEffect || !target.effects.includes(selectedEffect) || selectedEffect.id !== metadata.id) return null;
    if (selectedEffect.persistent || metadata.persistent || selectedEffect.durationPresentation === 'permanent' || metadata.durationPresentation === 'permanent') {
      return selectedEffect;
    }
    const extension = Math.max(0, Math.floor(Number(effectData.duration ?? effectData.turns) || 0));
    const remaining = Number(selectedEffect.remainingTurns ?? selectedEffect.duration);
    if (extension <= 0 || !Number.isFinite(remaining) || remaining >= 999) return selectedEffect;
    selectedEffect.remainingTurns = remaining + extension;
    if (target._effectTurnActive) selectedEffect._appliedTurnEpoch = target._effectTurnEpoch;
    selectedEffect.duration = selectedEffect.remainingTurns;
    if (Number.isFinite(Number(selectedEffect.durationTotal))) {
      selectedEffect.durationTotal = Number(selectedEffect.durationTotal) + extension;
    }
    recordStatusFeedback("statusApplied", {
      statusOperation: "refresh",
      icon: selectedEffect.icon,
      effectId: selectedEffect.id,
      label: selectedEffect.name || metadata.name,
    });
    return selectedEffect;
  }

  if (metadata.type === 'buff' && target.blockBuffs) {
    if (typeof logFn === 'function') {
      logFn(`🚫 На ${target.name || 'цель'} нельзя наложить новый положительный эффект.`);
    }
    recordStatusFeedback("statusBlocked", { statusOperation: "blocked", reason: "buff_block" });
    return null;
  }
  if (metadata.type === 'debuff' && target.blockDebuffs) {
    if (typeof logFn === 'function') {
      logFn(`🛡️ На ${target.name || 'цель'} нельзя наложить новый негативный эффект.`);
    }
    recordStatusFeedback("statusBlocked", { statusOperation: "blocked", reason: "debuff_block" });
    return null;
  }
  const blockedByControlImmunity = target._temporaryControlImmunity
    ? CONTROL_EFFECT_IDS.has(metadata.id)
    : target.controlImmune && INNATE_CONTROL_EFFECT_IDS.has(metadata.id);
  if (blockedByControlImmunity) {
    if (typeof logFn === 'function') logFn(`🛡️ ${target.name || 'Цель'} невосприимчива к контролю.`);
    const fallbackId = metadata.id === 'freeze' ? 'ice_shards' : metadata.id === 'shock' ? 'charge' : null;
    recordStatusFeedback("statusBlocked", { statusOperation: "blocked", reason: "control_immunity" });
    if (fallbackId && context?.elementalistControlFallback) {
      return addEffect(target, { ...effectData, id: fallbackId, extra: { ...(effectData.extra || {}), controlFallback: metadata.id } }, logFn, source, { ...context, elementalistControlFallback: false });
    }
    return null;
  }
  if (metadata.id === 'entanglement' && target.entanglementImmune === true) {
    if (typeof logFn === 'function') logFn(`🌿 ${target.name || 'Цель'} невосприимчива к Опутыванию.`);
    recordStatusFeedback("statusBlocked", { statusOperation: "blocked", reason: "entanglement_immunity" });
    return null;
  }
  if (metadata.type === 'debuff' && !context?._approvedDebuffApplication) {
    const minesBlock = target.effects.find(effect => effect?.id === 'mines_guard_block');
    if (minesBlock) {
      cleanseEffects(target, effect => effect === minesBlock, logFn);
      if (typeof logFn === 'function') logFn('🛡️ Укреплённый заслон блокирует следующий дебафф.');
      recordStatusFeedback('statusBlocked', { statusOperation: 'blocked', reason: 'mines_guard_block' });
      return null;
    }
    const seal = target.effects.find(effect => effect?.id === 'protection_seals');
    if (seal) {
      cleanseEffects(target, effect => effect === seal, logFn);
      if (typeof logFn === 'function') logFn(`🛡️ Печать защиты блокирует эффект «${metadata.name}».`);
      recordStatusFeedback("statusBlocked", { statusOperation: "blocked", reason: "protection_seal" });
      return null;
    }
  }

  if (metadata.id === 'entanglement' && !(target.effects || []).some(effect => effect?.id === 'entanglement')) {
    target._entanglementDecayTurns = 0;
  }

  const exclusiveFamily = EXCLUSIVE_EFFECT_FAMILY_BY_ID[metadata.id];
  if (exclusiveFamily) {
    const strongerEffects = target.effects.filter(effect => effect?.id === exclusiveFamily.major);
    const weakerEffects = target.effects.filter(effect => effect?.id === exclusiveFamily.minor);
    if (metadata.id === exclusiveFamily.minor && strongerEffects.length > 0) {
      // A weaker variant never refreshes, extends, or coexists with an active stronger variant.
      // Silently collapse any legacy duplicate weak instances without treating that as a cleanse.
      weakerEffects.forEach(effect => applyStatModifiers(target, effect, -1));
      if (weakerEffects.length > 0) {
        target.effects = target.effects.filter(effect => effect?.id !== exclusiveFamily.minor);
      }
      return null;
    }
    if (metadata.id === exclusiveFamily.major && weakerEffects.length > 0) {
      // Upgrading within one status family is replacement, not cleansing:
      // no onExpire hooks, cleanse triggers, or duration transfer from the weaker effect.
      weakerEffects.forEach(effect => applyStatModifiers(target, effect, -1));
      target.effects = target.effects.filter(effect => effect?.id !== exclusiveFamily.minor);
    }
  }

  const requestedStacks = Math.max(1, Math.floor(Number(effectData.stacks ?? effectData.charges) || 1));
  if (metadata.stacking === 'stack' && requestedStacks > 1) {
    let applied = null;
    const applicationEventId = context?.applicationEventId || {};
    for (let stack = 0; stack < requestedStacks; stack += 1) {
      const next = addEffect(
        target,
        { ...effectData, stacks: 1, charges: 1 },
        logFn,
        source,
        { ...context, applicationEventId, _approvedDebuffApplication: true }
      );
      if (next) applied = next;
    }
    return applied;
  }

  if (metadata.id === 'charring') {
    const activeCharring = target.effects.filter(effect => effect?.id === 'charring');
    if (activeCharring.length >= metadata.maxStacks) {
      activeCharring.forEach(effect => {
        if (target._effectTurnActive) effect._appliedTurnEpoch = target._effectTurnEpoch;
        effect.remainingTurns = Math.max(3, effect.remainingTurns ?? 0);
        effect.duration = effect.remainingTurns;
        effect.durationTotal = Math.max(effect.durationTotal ?? 0, effect.remainingTurns);
      });
      recordStatusFeedback("statusApplied", {
        statusOperation: "refresh",
        icon: activeCharring[0]?.icon,
        effectId: metadata.id,
        label: activeCharring[0]?.name || metadata.name,
      });
      return activeCharring[0];
    }
  }

  if (metadata.stacking === 'stack' && Number.isFinite(metadata.maxStacks)) {
    const activeStacks = target.effects.filter(effect => effect?.id === metadata.id);
    if (activeStacks.length >= Math.max(0, metadata.maxStacks)) {
      return null;
    }
  }

  const logger = typeof logFn === 'function' ? logFn : () => {};
  const resolvedEffectData = applyEquipmentShieldBonus(effectData, metadata, source, context, target);
  const instance = createEffectInstance(resolvedEffectData, metadata, source);
  if (target._effectTurnActive) instance._appliedTurnEpoch = target._effectTurnEpoch;
  // Preserve the original Forest cast on DoTs, including after save/reload.
  const forestSession = context?.session;
  if (forestSession?.locationEffectId === 'roots-of-the-fallen'
    && forestSession.state?._forestRootsActiveOrigin
    && (forestSession.state.players || []).includes(source)
    && (forestSession.state.enemies || []).includes(target)) {
    instance.metadata = { ...(instance.metadata || {}), forestOriginId: forestSession.state._forestRootsActiveOrigin };
  }
  if (metadata.type === 'debuff') {
    target._negativeEffectSerial = (target._negativeEffectSerial || 0) + 1;
    instance.appliedSerial = target._negativeEffectSerial;
    instance.sourceId = source?.id || source?.combatInstanceId || source?.runtimeId || source?.name || null;
  }
  const shieldBefore = target.shield ?? 0;
  const recordApplication = (appliedEffect, statusOperation = "apply") => {
    const session = context?.session;
    if (metadata.id === 'poison' && session?.state) {
      const metrics = (session.state.metrics ||= {});
      const sourceIsPlayer = (session.state.players || []).includes(source);
      const targetIsPlayer = (session.state.players || []).includes(target);
      const key = sourceIsPlayer && !targetIsPlayer ? 'poisonAppliedPlayerToEnemies' : !sourceIsPlayer && targetIsPlayer ? 'poisonAppliedEnemiesToPlayer' : 'poisonAppliedOther';
      metrics[key] = (metrics[key] || 0) + 1;
    }
    recordCombatPresentationEvent(session, {
      type: "statusApplied",
      actor: source,
      target,
      label: appliedEffect?.name || metadata.name || appliedEffect?.id,
      effectId: appliedEffect?.id,
      effectType: metadata.type,
      icon: appliedEffect?.icon,
      statusOperation,
      afterEventType: context?.presentationCause?.type,
      afterTargetId: context?.presentationCause?.target
        ? (
          context.presentationCause.target.id ||
          context.presentationCause.target.runtimeId ||
          context.presentationCause.target.combatId ||
          context.presentationCause.target.name
        )
        : context?.presentationCause?.targetId,
      afterDelay: context?.presentationCause?.delay,
      afterEventDirection: context?.presentationCause?.direction,
      causeLabel: context?.presentationCause?.label,
    });
    if (
      metadata.type === 'debuff' &&
      appliedEffect &&
      hasEquipped(target, UNSUNG_MEDALLION) &&
      !target._unsungMedallionUsed &&
      areHostileUnits(target, source, session)
    ) {
      target._unsungMedallionUsed = true;
      setEffectStackCount(target, 'ruins_echo_charge', getEffectStackCount(target, 'ruins_echo_charge') + 1);
      logger(`🎖️ ${UNSUNG_MEDALLION} даёт заряд Эха за первый успешно полученный вражеский дебафф.`);
    }
    if (metadata.id === 'speed_boost_minor' || metadata.id === 'speed_boost_major') {
      session?.notifyPositiveTempoChange?.(target, 0, { source, reason: 'haste', natural: false });
    }
    if (metadata.id === 'entanglement') {
      session?.onEntanglementAdded?.({
        target, source, effect: appliedEffect, added: 1,
        applicationEventId: context?.applicationEventId || null,
      });
    }
    if (metadata.type === 'buff') {
      session?.onBuffApplied?.({
        target, source, effect: appliedEffect,
        applicationEventId: context?.applicationEventId || null,
      });
    }
    // A new status *type*, not a stack or refresh, drives Mines tempo.
    session?.onMinesStatusApplied?.({
      target, source, effect: appliedEffect, metadata, statusOperation,
      previouslyActive: sameEffectCountBefore > 0,
      cursedDurationBonus: effectData?._minesCursedDurationBonus === true,
    });
    const shieldGained = Math.max(0, (target.shield ?? 0) - shieldBefore);
    if (shieldGained > 0) {
      recordCombatPresentationEvent(session, {
        type: "shieldGain",
        actor: source,
        target,
        amount: shieldGained,
        afterEventType: context?.presentationCause?.type,
        afterTargetId: context?.presentationCause?.target
          ? (
            context.presentationCause.target.id ||
            context.presentationCause.target.runtimeId ||
            context.presentationCause.target.combatId ||
            context.presentationCause.target.name
          )
          : context?.presentationCause?.targetId,
        afterEventDirection: context?.presentationCause?.direction,
        afterDelay: context?.presentationCause?.delay,
      });
    }
  };

  const sameEffectCountBefore = target.effects.filter(effect => effect?.id === instance.id).length;
  const existingIndex = context?.forceIndependentInstance === true ? -1 : target.effects.findIndex(
    eff => eff && eff.id === instance.id && metadata.stacking !== 'stack'
  );

  if (existingIndex >= 0) {
    const existing = target.effects[existingIndex];
    if (metadata.stacking === 'extend') {
      existing.remainingTurns += instance.remainingTurns;
      if (target._effectTurnActive) existing._appliedTurnEpoch = target._effectTurnEpoch;
      existing.value = instance.value ?? existing.value;
      existing.durationTotal = existing.remainingTurns;
      existing.sourceSnapshot = instance.sourceSnapshot;
      if (metadata.id === 'shock') {
        existing.sourceRef = instance.sourceRef;
        existing.sourceId = instance.sourceSnapshot?.id ?? null;
      }
      if (instance.metadata) existing.metadata = { ...instance.metadata };
      else delete existing.metadata;
      const refreshedExtra = resolveRefreshedExtra(metadata, existing, instance);
      if (refreshedExtra) existing.extra = refreshedExtra;
      else delete existing.extra;
      if (instance.onBreak) existing.onBreak = instance.onBreak;
      else delete existing.onBreak;
      if (typeof metadata.onApply === 'function') {
        metadata.onApply({ target, effect: existing, source, context, log: logger });
      }
      logger(`♻️ Длительность эффекта "${metadata.name}" увеличена.`);
      markBlockingFlags(target, existing.id);
      const adjusted = applyDeepWatchHelmet(target, existing, metadata, source, context, logger);
      if (!adjusted) return null;
      recordApplication(adjusted, "refresh");
      return adjusted;
    }
    existing.remainingTurns = instance.remainingTurns;
    if (target._effectTurnActive) existing._appliedTurnEpoch = target._effectTurnEpoch;
    existing.durationTotal = instance.remainingTurns;
    existing.value = instance.value ?? existing.value;
    existing.sourceSnapshot = instance.sourceSnapshot;
    if (metadata.id === 'shock') {
      existing.sourceRef = instance.sourceRef;
      existing.sourceId = instance.sourceSnapshot?.id ?? null;
    }
    if (instance.metadata) existing.metadata = { ...instance.metadata };
    else delete existing.metadata;
    const refreshedExtra = resolveRefreshedExtra(metadata, existing, instance);
    if (refreshedExtra) existing.extra = refreshedExtra;
    else delete existing.extra;
    if (instance.onBreak) existing.onBreak = instance.onBreak;
    else delete existing.onBreak;
    if (typeof metadata.onApply === 'function') {
      metadata.onApply({ target, effect: existing, source, context, log: logger });
    }
    logger(`♻️ Эффект "${metadata.name}" обновлён.`);
    markBlockingFlags(target, existing.id);
    const adjusted = applyDeepWatchHelmet(target, existing, metadata, source, context, logger);
    if (!adjusted) return null;
    recordApplication(adjusted, "refresh");
    return adjusted;
  }

  applyStatModifiers(target, instance, 1);
  if (typeof metadata.onApply === 'function') {
    metadata.onApply({ target, effect: instance, source, context, log: logger });
  }

  target.effects.push(instance);
  if (instance.id === 'charring') {
    target.effects.filter(effect => effect?.id === 'charring').forEach(effect => {
      effect.remainingTurns = Math.max(3, effect.remainingTurns ?? 0);
      effect.duration = effect.remainingTurns;
      effect.durationTotal = Math.max(effect.durationTotal ?? 0, effect.remainingTurns);
    });
  }
  if (metadata.interruptsPreparation && target._preparation) {
    target._preparation = null;
    logger(`💥 Подготовка ${target.name || 'цели'} сорвана эффектом «${metadata.name}».`);
  }
  if (instance.id === 'charge') {
    const charges = target.effects.filter(effect => effect?.id === 'charge');
    if (charges.length >= 3) {
      const magAtk = instance.sourceSnapshot?.magAtk ?? source?.magAtk ?? 0;
      cleanseEffects(target, effect => effect?.id === 'charge', logger);
      const dischargeMultiplier = Math.max(0, Number(context?.chargeDischargeMultiplier) || 0.8);
      const dischargeDamage = magAtk * dischargeMultiplier;
      context?.session?.applyIndirectDamage?.(target, dischargeDamage, 'magical', {
        source, magicSchool: MAGIC_SCHOOLS.LIGHTNING, fromEffect: 'charge', sourceEffectId: 'charge',
      });
      context?.session?.onChargeDischarge?.({
        source,
        target,
        deliberateAction: context?.deliberateAction || null,
        damage: dischargeDamage,
      });
      logger(`⚡ Заряд на ${target.name || 'цели'} разряжается.`);
    }
  }
  logger(`✨ ${target.name || 'Цель'} получает эффект "${metadata.name}".`);
  markBlockingFlags(target, instance.id);
  const adjusted = applyDeepWatchHelmet(target, instance, metadata, source, context, logger);
  if (!adjusted) return null;
  recordApplication(
    adjusted,
    metadata.stacking === 'stack' && sameEffectCountBefore > 0 ? "stack" : "apply"
  );
  return adjusted;
}


const getActiveShieldValue = (effect) => Math.max(0, effect?.appliedShield ?? effect?.value ?? 0);

const syncTemporaryShieldTotal = (target, effects = target?.effects) => {
  if (!target) return;
  const activeShieldTotal = Array.isArray(effects)
    ? effects
        .filter(effect => effect?.id === 'shield')
        .reduce((total, effect) => total + getActiveShieldValue(effect), 0)
    : 0;
  target.shield = activeShieldTotal > 0
    ? Math.min(Math.max(0, target.shield ?? 0), activeShieldTotal)
    : 0;
};

// Explicitly classified start-of-turn expiration, NOT every onTick handler.
// Persistent Great Bonfire Flame ticks at turn start but never expires by duration.
export const START_TURN_EXPIRATION_IDS = new Set([
  'poison', 'burn', 'bleed', 'gloom', 'searing_mark',
  'regeneration', 'preparation', 'defender_ram_prepared',
]);

export function processEffects(target, logFn, context = {}) {
  if (!target) return;
  // Increment exactly once for each actual begin-turn pass. The regular
  // turn.started / actor scheduler guards this method from UI retries.
  target._effectTurnEpoch = (Number(target._effectTurnEpoch) || 0) + 1;
  target._effectTurnActive = true;
  const logger = typeof logFn === 'function' ? logFn : () => {};
  if (!Array.isArray(target.effects) || target.effects.length === 0) {
    syncTemporaryShieldTotal(target, []);
    target.stunned = false;
    target.silenced = false;
    target.pendingShockSkip = false;
    target._pendingShockSourceId = null;
    target.frozen = false;
    target.prostrated = false;
    processSourceTurnStartEffects(target, context.getOpponents?.() || [], logger, context);
    return;
  }

  ensureBaseStats(target);
  const sorted = [...target.effects].sort((a, b) => {
    const defA = getEffectDefinition(a.id);
    const defB = getEffectDefinition(b.id);
    return (defA?.tickPriority ?? 5) - (defB?.tickPriority ?? 5);
  });
  const remainingEffects = [];
  let stunnedNow = false;
  let silencedNow = false;
  let pendingShockSkip = false;
  let pendingShockSourceId = null;
  for (const effect of sorted) {
    const metadata = getEffectDefinition(effect.id);
    if (!metadata) continue;
    const beforeTick = effect.remainingTurns ?? metadata.defaultDuration ?? 1;
    if (beforeTick > 0) {
      if (effect.id === 'stun' || effect.id === 'freeze') stunnedNow = true;
      if (effect.id === 'silence') silencedNow = true;
    }
    if (effect.id === 'shock') {
      const chance = Math.min(0.95, Math.max(0,
        effect.extra?.skipChance ?? (typeof effect.value === 'number' ? effect.value : 0.35)));
      const rng = context?.rng || context?.session?.rng || Math.random;
      if (!pendingShockSkip && rng() < chance) {
        pendingShockSkip = true;
        pendingShockSourceId =
          effect.sourceId ||
          effect.sourceRef?.id ||
          effect.sourceRef?.combatInstanceId ||
          effect.sourceRef?.runtimeId ||
          effect.sourceRef?.name ||
          effect.sourceSnapshot?.id ||
          effect.sourceSnapshot?.name ||
          null;
        logger(`⚡ ${target.name || 'Цель'} содрогается от шока и рискует пропустить ход.`);
      }
    }
    if (metadata.onTick) metadata.onTick({ target, effect, context, log: logger });
    // An effect may have moved or been removed as part of an onTick reaction.
    if (!target.effects.includes(effect)) continue;
    if (effect.persistent || metadata.persistent || !START_TURN_EXPIRATION_IDS.has(effect.id)) {
      remainingEffects.push(effect);
      continue;
    }
    const afterTick = Number(effect.remainingTurns ?? effect.duration ?? beforeTick);
    const durationBase = Number.isFinite(afterTick) ? Math.min(beforeTick, afterTick) : beforeTick;
    effect.remainingTurns = durationBase - 1;
    effect.duration = effect.remainingTurns;
    if (effect.remainingTurns > 0) {
      remainingEffects.push(effect);
    } else {
      applyStatModifiers(target, effect, -1);
      if (typeof metadata.onExpire === 'function') metadata.onExpire({ target, effect, context: { ...context, reason: 'natural' }, log: logger });
      triggerFlaringVeinBoots(target, [effect], context, logger);
    }
  }
  const addedDuringProcessing = target.effects.filter(effect => !sorted.includes(effect));
  target.effects = [...remainingEffects, ...addedDuringProcessing];
  syncCrimsonEcstasy(target, logger);
  syncTemporaryShieldTotal(target, target.effects);
  target.stunned = stunnedNow;
  target.silenced = silencedNow;
  target.pendingShockSkip = pendingShockSkip;
  target._pendingShockSourceId = pendingShockSkip ? pendingShockSourceId : null;
  target.frozen = target.effects.some(effect => effect.id === 'freeze');
  target.prostrated = target.effects.some(effect => effect.id === 'reverence');
  if (target.hp <= 0) target._effectTurnActive = false;
  processSourceTurnStartEffects(target, context.getOpponents?.() || [], logger, context);
}

/** Decrement ordinary statuses ONCE after the owner's completed or CC-skipped turn. */
export function finishEffectTurn(target, logFn, context = {}) {
  if (!target?._effectTurnActive) return false;
  const epoch = target._effectTurnEpoch;
  target._effectTurnActive = false;
  const logger = typeof logFn === 'function' ? logFn : () => {};
  for (const effect of [...(target.effects || [])]) {
    if (!target.effects.includes(effect)) continue;
    const metadata = getEffectDefinition(effect.id);
    if (!metadata || effect.persistent || metadata.persistent
      || metadata.durationPresentation === 'permanent'
      || effect.durationPresentation === 'permanent'
      || START_TURN_EXPIRATION_IDS.has(effect.id)
      || effect._appliedTurnEpoch === epoch) continue;
    const before = effect.remainingTurns ?? effect.duration ?? metadata.defaultDuration;
    if (!Number.isFinite(Number(before)) || Number(before) >= 999) continue;
    effect.remainingTurns = Number(before) - 1;
    effect.duration = effect.remainingTurns;
    if (effect.remainingTurns > 0) continue;
    applyStatModifiers(target, effect, -1);
    target.effects.splice(target.effects.indexOf(effect), 1);
    if (typeof metadata.onExpire === 'function') metadata.onExpire({ target, effect, context: { ...context, reason: 'natural' }, log: logger });
    triggerFlaringVeinBoots(target, [effect], context, logger);
  }
  syncTemporaryShieldTotal(target, target.effects);
  target.stunned = target.effects.some(effect => effect.id === 'stun' || effect.id === 'freeze');
  target.silenced = target.effects.some(effect => effect.id === 'silence');
  target.frozen = target.effects.some(effect => effect.id === 'freeze');
  target.prostrated = target.effects.some(effect => effect.id === 'reverence');
  return true;
}

export function triggerEffectTick(target, effect, context = {}, logFn = () => {}) {
  const metadata = getEffectDefinition(effect?.id);
  if (!target || !effect || typeof metadata?.onTick !== 'function') return false;
  metadata.onTick({ target, effect, context, log: logFn });
  return true;
}

/** Run statuses owned by `source` during that source's ordinary start-of-turn phase. */
export function processSourceTurnStartEffects(source, targets = [], logFn, context = {}) {
  if (!source || source.hp <= 0) return 0;
  const logger = typeof logFn === 'function' ? logFn : () => {};
  let triggered = 0;
  for (const target of targets) {
    if (!target || target.hp <= 0 || !Array.isArray(target.effects)) continue;
    for (const effect of [...target.effects]) {
      const metadata = getEffectDefinition(effect?.id);
      if (!metadata?.sourceTurnStart || typeof metadata.onSourceTurnStart !== 'function') continue;
      if (resolveEffectDamageSource(effect, context) !== source) continue;
      metadata.onSourceTurnStart({ target, effect, source, context, log: logger });
      triggered += 1;
    }
  }
  return triggered;
}

export function notifyDamageTaken(target, damage, context = {}) {
  if (!target || !Array.isArray(target.effects) || target.effects.length === 0) return;
  for (const effect of target.effects) {
    const metadata = getEffectDefinition(effect.id);
    if (metadata?.onDamageTaken) {
      metadata.onDamageTaken({ target, damage, effect, context });
    }
  }
}

// Lethal damage normally stops the broader reaction queue. Vampire Mark still
// resolves from the current damage event because its healing belongs to the
// dealer and does not require the marked target to survive.
export function notifyVampireMarkOnLethalDamage(target, damage, context = {}) {
  if (!target || target.hp > 0 || !Array.isArray(target.effects)) return;
  target.effects
    .filter(effect => effect?.id === 'vampire_mark')
    .forEach(effect => EFFECT_LIBRARY.vampire_mark.onDamageTaken({ target, damage, effect, context }));
}

export function notifyConductivityOnLethalDamage(target, damage, context = {}) {
  if (!target || target.hp > 0 || !Array.isArray(target.effects)) return;
  target.effects
    .filter(effect => effect?.id === 'conductivity')
    .forEach(effect => EFFECT_LIBRARY.conductivity.onDamageTaken({ target, damage, effect, context }));
}

export function cleanseEffects(target, predicate, logFn, context = {}) {
  if (!target || !Array.isArray(target.effects) || target.effects.length === 0) return 0;
  const logger = typeof logFn === 'function' ? logFn : () => {};
  let removed = 0;
  const remaining = [];
  const removedEffects = [];

  target.effects.forEach(effect => {
    const metadata = getEffectDefinition(effect.id);
    const removable = metadata?.unremovable !== true && effect?.unremovable !== true;
    const shouldRemove = removable && (typeof predicate === 'function' ? predicate(effect, metadata) : true);
    if (shouldRemove) {
      applyStatModifiers(target, effect, -1);
      if (metadata?.onExpire) {
        metadata.onExpire({ target, effect, context: { log: logger, reason: 'cleanse' }, log: logger });
      }
      removedEffects.push(effect);
      removed += 1;
    } else {
      remaining.push(effect);
    }
  });

  target.effects = remaining;
  if (removedEffects.length > 0 && context?.session) {
    const grouped = new Map();
    removedEffects.forEach(effect => {
      const metadata = getEffectDefinition(effect?.id);
      const id = effect?.id || metadata?.id || effect?.name || "effect";
      const current = grouped.get(id) || {
        effectId: id,
        label: effect?.name || metadata?.name || id,
        effectType: metadata?.type || effect?.type,
        removedCount: 0,
      };
      current.removedCount += 1;
      grouped.set(id, current);
    });
    grouped.forEach(entry => {
      recordCombatPresentationEvent(context.session, {
        type: "statusCleanse",
        actor: context.actor || context.source || target,
        target,
        statusOperation: "cleanse",
        afterEventType: context?.presentationCause?.type,
        afterTargetId: context?.presentationCause?.target
          ? (
            context.presentationCause.target.id ||
            context.presentationCause.target.runtimeId ||
            context.presentationCause.target.combatId ||
            context.presentationCause.target.name
          )
          : context?.presentationCause?.targetId,
        afterEventDirection: context?.presentationCause?.direction,
        afterDelay: context?.presentationCause?.delay,
        ...entry,
      });
    });
  }
  syncCrimsonEcstasy(target, logger);
  triggerFlaringVeinBoots(target, removedEffects, {}, logger);
  target.stunned = target.effects.some(eff => eff.id === 'stun' || eff.id === 'freeze');
  target.silenced = target.effects.some(eff => eff.id === 'silence');
  target.frozen = target.effects.some(eff => eff.id === 'freeze');
  target.prostrated = target.effects.some(eff => eff.id === 'reverence');
  if (!target.effects.some(eff => eff.id === 'shock')) {
    target.pendingShockSkip = false;
    target._pendingShockSourceId = null;
  }
  ensureBaseStats(target);
  recalcDerivedStats(target);
  return removed;
}

export function removeRandomNegativeEffect(target, rng = Math.random, logFn) {
  if (!target || !Array.isArray(target.effects)) return null;
  const removable = target.effects.filter(effect => {
    const metadata = getEffectDefinition(effect?.id);
    return (metadata?.type === 'debuff' || effect?.kind === 'debuff') &&
      !isEffectUnremovable(effect);
  });
  if (!removable.length) return null;
  const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
  // Choose a debuff type, not an individual charge. Stack count must neither
  // weight the random choice nor leave other removable applications behind.
  const types = [...new Map(removable.map(effect => [effect.id, effect])).values()];
  const selected = types[Math.floor(roll * types.length)];
  return cleanseEffects(target, effect => effect.id === selected.id && !isEffectUnremovable(effect), logFn) > 0 ? selected : null;
}

export function notifyEffectOwnerDeath(owner, allies = [], context = {}) {
  if (!owner || !Array.isArray(owner.effects)) return;
  [...owner.effects].forEach(effect => {
    const metadata = getEffectDefinition(effect?.id);
    if (typeof metadata?.onOwnerDeath !== 'function') return;
    metadata.onOwnerDeath({
      owner,
      effect,
      allies,
      rng: context.rng || Math.random,
      log: context.log,
      context,
    });
  });
}

export function removeRandomPositiveEffect(target, rng = Math.random, logFn) {
  if (!target || !Array.isArray(target.effects) || target.effects.length === 0) return null;
  const removableBuffs = target.effects.filter(effect => {
    const metadata = getEffectDefinition(effect?.id);
    return metadata?.type === 'buff' &&
      !isEffectUnremovable(effect) &&
      metadata.removable !== false &&
      effect?.removable !== false &&
      effect?.extra?.removable !== false;
  });
  if (removableBuffs.length === 0) return null;
  const selected = removableBuffs[Math.floor(rng() * removableBuffs.length)] || null;
  if (!selected) return null;
  return cleanseEffects(target, effect => effect === selected, logFn) > 0 ? selected : null;
}

export function prepareEffectTracking(target) {
  if (!target) return;
  ensureBaseStats(target);
  recalcDerivedStats(target);
  if (!Array.isArray(target.effects)) target.effects = [];
  target.pendingShockSkip = target.pendingShockSkip ?? false;
  target.frozen = target.frozen ?? false;
}

function getAlliedUnits(target, context) {
  const session = context?.session;
  const state = session?.state;
  if (!state) return [];
  const { players = [], enemies = [] } = state;
  if (players.includes(target)) return players;
  if (enemies.includes(target)) return enemies;
  return [];
}

export function getEffectMetadata(nameOrId) {
  return getEffectDefinition(nameOrId);
}

export const predefinedEffects = ALL_EFFECTS.reduce((acc, effect) => {
  acc[effect.id] = { name: effect.name, duration: effect.defaultDuration };
  return acc;
}, {});

