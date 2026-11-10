import { RESTLESS_RUINS_ABILITIES } from './restlessRuinsAbilities';
import { ELEMENTAL_CHARGE_DESCRIPTION, ELEMENTAL_CHARGE_DESCRIPTION_PARTS } from './elementalCharges';
import { MAGIC_SCHOOLS } from '../constants/magicSchools';
import { addEffect, cleanseEffects, removeRandomNegativeEffect, triggerEffectTick, EFFECT_IDS, isEffectTransferable, getEffectDefinition, getEffectStackCount, setEffectStackCount, consumeEffectStacks } from '../utils/effects';
import { equipmentByName } from './equipment';
import { getEquipmentInstanceItemId } from '../utils/runeSockets';
import { recordCombatPresentationEvent } from '../utils/combatPresentationEvents';
import { GNAT_BLOODSUCK_RATIO } from '../utils/witheringForestGnats';
import { MINES_ABILITY_LIBRARY } from './minesAbilities';

const combatRandom = session => (session?.rng || Math.random)();

const roundDamage = (value) => Math.max(0, Math.round(value));
const TURN_METER_CHUNK = 250;
const BROKEN_MARCH_LEGGINGS = 'Поножи сбитого марша';

const grantSummonerTurnMeter = (summon, session, amount, log) => {
  const owner = (session?.state?.players || []).find(unit => unit?.id === summon?.summonerId && unit?.hp > 0);
  if (!owner) return 0;
  const before = Math.max(0, Number(owner.turnMeter) || 0);
  owner.turnMeter = Math.min(1000, before + Math.max(0, Number(amount) || 0));
  const gained = Math.max(0, owner.turnMeter - before);
  if (gained > 0) {
    session?.notifyPositiveTempoChange?.(owner, gained, { source: summon, reason: 'lightning_elemental', natural: false });
    recordCombatPresentationEvent(session, {
      type: 'turnMeterChanged',
      actor: summon,
      target: owner,
      amount: gained,
      delta: gained,
      before,
      after: owner.turnMeter,
      changeKind: 'gain',
      reason: 'lightning_elemental',
    });
    log?.(`⚡ ${summon?.name || 'Молниевый элементаль'} передаёт ${Math.round(gained / 10)}% шкалы хода ${owner.name || 'призывателю'}.`);
  }
  return gained;
};

const grantSummonerShield = (summon, session, maxHpFraction, duration, log) => {
  const owner = (session?.state?.players || []).find(unit => unit?.id === summon?.summonerId && unit?.hp > 0);
  if (!owner) return 0;
  const value = Math.max(1, Math.round((owner.maxHp || 0) * maxHpFraction));
  const before = Math.max(0, Number(owner.shield) || 0);
  addEffect(owner, { id: 'shield', duration, value }, log, summon, { session, forceIndependentInstance: true });
  const gained = Math.max(0, (owner.shield || 0) - before);
  if (gained > 0) log?.(`❄️ ${summon?.name || 'Ледяной элементаль'} оставляет ${owner.name || 'призывателю'} ${gained} Щита.`);
  return gained;
};

const RAT_PACK_NAMES = new Set(['Чумная крыса', 'Крысиный матриарх', 'Крысиный всадник']);
const isRatPackUnit = unit => {
  const name = String(unit?.name || '');
  return name.startsWith('Крысомант') || RAT_PACK_NAMES.has(name);
};
const countLivingRatPackUnits = units => (units || []).filter(unit => unit?.hp > 0 && isRatPackUnit(unit)).length;

const hasEquipmentItem = (unit, itemName) =>
  Object.values(unit?.equipment || {}).some(item => getEquipmentInstanceItemId(item) === itemName);

export const reduceHostileTurnMeter = (target, amount, context = {}) => {
  if (!target || target._temporaryControlImmunity) return 0;
  const mitigation = target.passivesDisabled ? 0 : Math.max(0, Math.min(1,
    (target.abilities || []).reduce((best, ability) => Math.max(best, Number(ability?.hostileTurnMeterReductionMitigation) || 0), 0)
  ));
  let requested = Math.max(0, Number(amount) || 0) * (1 - mitigation);
  if (
    requested > 0 &&
    hasEquipmentItem(target, BROKEN_MARCH_LEGGINGS) &&
    !target._brokenMarchLeggingsUsed
  ) {
    target._brokenMarchLeggingsUsed = true;
    requested *= 0.5;
    const shieldValue = Math.max(1, Math.round((target.maxHp || 0) * 0.1));
    addEffect(target, { id: 'shield', duration: 2, value: shieldValue }, context.log, target, {
      session: context.session,
      forceIndependentInstance: true,
    });
    context.log?.(`🥾 ${BROKEN_MARCH_LEGGINGS} ослабляют первое уменьшение шкалы хода и дают ${shieldValue} Щита.`);
  }
  if (typeof target.turnMeter === 'number') {
    const before = target.turnMeter;
    target.turnMeter = Math.max(0, before - requested);
    const reduced = before - target.turnMeter;
    if (reduced > 0 && context.session && !context.suppressPresentation) {
      recordCombatPresentationEvent(context.session, {
        type: 'turnMeterChanged',
        actor: context.source,
        target,
        amount: reduced,
        delta: -reduced,
        before,
        after: target.turnMeter,
        changeKind: 'loss',
        reason: context.reason || 'hostile_reduction',
      });
    }
    return reduced;
  }
  target.turnDelay = (target.turnDelay ?? 0) + requested / 1000;
  return requested;
};
export const FUNGAL_ROSTER_TUNING = Object.freeze({
  feralLungeDamageMultiplier: 1.45,
  feralLungeTurnMeter: 150,
  feralHowlTurnMeter: 200,
  feralHowlCooldown: 4,
  boneguardCoverShieldMaxHp: 0.18,
  boneguardCoverCooldown: 4,
  boneguardLastGuardianShieldMaxHp: 0.12,
  boneguardRetaliationDamageMultiplier: 1,
});
export const WITHERING_FOREST_TUNING = Object.freeze({
  poisonVinesDamageMultiplier: 0.75,
  poisonVinesCooldown: 2,
  poisonVinesPoisonDuration: 3,
  overgrowingBudCooldown: 3,
  overgrowthDuration: 4,
  vulnerableShotMultiplier: 1.1,
  vulnerableShotCooldown: 2,
  vulnerableShotDuration: 2,
  focusedShotMultiplier: 1.55,
  focusedShotVulnerabilityBonus: 1.25,
  focusedShotCooldown: 3,
  thornGuardCooldown: 4,
  guardDuration: 2,
  thornReflectionRatio: 0.15,
  shadowLungeCooldown: 3,
  shadowLungeMultiplier: 1.55,
  shadowExecuteThreshold: 0.4,
  shadowExecuteBonus: 0.35,
  shadowBackstabBonus: 0.35,
  gnatSowerCooldown: 3,
  gnatRallyCooldown: 4,
  gnatRallyDuration: 2,
  gnatBloodsuckCooldown: 1,
  gnatBloodsuckDamageMultiplier: 0.8,
  gnatLifestealRatio: GNAT_BLOODSUCK_RATIO,
  reaperMowMultiplier: 1.05,
  reaperMowCooldown: 2,
  reaperHarvestBaseMultiplier: 1.65,
  reaperHarvestBonusPerEntanglement: 0.25,
  reaperHarvestMaxConsumedEntanglement: 3,
  reaperHarvestCooldown: 3,
  reaperExecuteThreshold: 0.35,
  reaperExecuteMultiplier: 1.3,
  owlGraspingRootsCooldown: 3,
  owlGraspingRootsStacks: 2,
  owlWingbeatMultiplier: 0.9,
  owlWingbeatCooldown: 2,
  owlWingbeatTurnMeter: 150,
  owlControlMitigation: 0.5,
  bearChargeMultiplier: 1.55,
  bearChargeCooldown: 3,
  bearRecoveryCooldown: 5,
  bearRecoveryImmediateHealMaxHp: 0.1,
  bearRecoveryThreshold: 0.7,
  bearRecoveryRegenerationDuration: 2,
  bearFuryThreshold: 0.4,
  bearFuryUnstoppableDuration: 2,
  splitterCarapaceShieldMaxHp: 0.24,
  splitterCarapaceCooldown: 4,
  splitterStrikeMultiplier: 1.5,
  splitterStrikeShieldMaxHp: 0.07,
  splitterStrikeCooldown: 2,
  splitterDischargeShieldMultiplier: 1.35,
  splitterDischargeShockThresholdMaxHp: 0.12,
  splitterDischargeCooldown: 4,
  predatorClawsMultiplier: 1.35,
  predatorClawsCooldown: 2,
  predatorBloodCallCooldown: 4,
  predatorHasteDuration: 2,
  predatorBloodFeastMultiplier: 1.6,
  predatorBloodFeastCooldown: 3,
  predatorBloodFeastBaseLifesteal: 0.35,
  predatorBloodFeastLifestealPerBleed: 0.08,
  bloomArchonRootsCooldown: 3,
  bloomArchonBudActions: 2,
  bloomArchonBudPoisonDuration: 3,
  bloomArchonCleanseEveryTurns: 3,
  bloomArchonLifeBloomCooldown: 4,
  bloomArchonLifeBloomMaxConsume: 2,
  bloomArchonLifeBloomHealPerStack: 0.04,
  bloomArchonLifeBloomTurnMeterPerStack: 100,
  bloomArchonThornBloomCooldown: 3,
  bloomArchonThornBloomBaseMultiplier: 1.3,
  bloomArchonThornBloomPerStack: 0.2,
  bloomArchonDeathBloomCooldown: 3,
  bloomArchonDeathBloomBaseMultiplier: 1.5,
  bloomArchonDeathBloomPerStack: 0.15,
  bloomArchonDeathBloomMaxConsume: 2,
  bloomArchonBurialCooldown: 5,
  predatorBloodFeastLifestealCap: 0.75,
});
export const DEFENDER_PROGRESSION_SKILL_TUNING = Object.freeze({
  shockwaveShieldSpend: 0.5, shockwaveAttackScale: 0.35, shockwaveShieldScale: 5, shockwaveAttackCapScale: 2,
  ramShieldFraction: 0.16, ramDamageScale: 0.95, ramTurnMeterGain: 0.5,
  shieldThrowAttackScale: 1.4, shieldThrowShieldScale: 0.8, shieldThrowBleedDivisor: 25,
  provocationConversion: 0.4, provocationBleedBonusPerTurn: 0.05, provocationConversionCap: 0.7,
});

const hasPhysicalShieldEquipped = attacker => {
  const offHandId = getEquipmentInstanceItemId(attacker?.equipment?.offHand);
  return equipmentByName[offHandId]?.type === 'Shield';
};

// Keep the numeric resource and its temporary-effect ownership in lockstep.  In
// particular, an expired effect must never be able to subtract shield which an
// ability has already spent.
const spendTemporaryShield = (target, requestedAmount) => {
  if (!target) return 0;
  const before = Math.max(0, target.shield ?? 0);
  const spent = Math.min(before, Math.max(0, Math.round(requestedAmount) || 0));
  target.shield = before - spent;
  let remaining = spent;
  if (Array.isArray(target.effects)) {
    target.effects.forEach(effect => {
      if (remaining <= 0 || effect?.id !== 'shield') return;
      const owned = Math.max(0, effect.appliedShield ?? effect.value ?? 0);
      const reduction = Math.min(owned, remaining);
      effect.appliedShield = owned - reduction;
      if (typeof effect.value === 'number') effect.value = Math.max(0, effect.value - reduction);
      remaining -= reduction;
    });
    target.effects = target.effects.filter(effect => effect?.id !== 'shield' || Math.max(0, effect.appliedShield ?? effect.value ?? 0) > 0);
  }
  return spent;
};

const effectId = (name) => {
  if (!name) return null;
  if (EFFECT_IDS[name]) return EFFECT_IDS[name];
  const normalized = name.toLowerCase();
  const match = Object.entries(EFFECT_IDS).find(
    ([label]) => label.toLowerCase() === normalized
  );
  return match ? match[1] : name;
};

const INTIMIDATION_CONTROL_EXCLUSIONS = new Set([
  'stun',
  'freeze',
  'blind',
  'silence',
  'shock',
  'stiffness',
  'passive_break',
]);

const isExtendableDebuff = (effect) => {
  if (!effect || INTIMIDATION_CONTROL_EXCLUSIONS.has(effect.id)) return false;
  if (effect.type !== 'debuff' && effect.kind !== 'debuff') return false;
  return Number.isFinite(effect.remainingTurns) || Number.isFinite(effect.duration);
};

const extendExistingDebuffs = (target, capturedDebuffs) => {
  if (!target || !Array.isArray(capturedDebuffs) || capturedDebuffs.length === 0) return 0;
  return capturedDebuffs.reduce((count, { effect, turns }) => {
    if (!effect || !target.effects?.includes(effect)) return count;
    const currentTurns = Number.isFinite(effect.remainingTurns)
      ? effect.remainingTurns
      : effect.duration;
    if (!Number.isFinite(currentTurns)) return count;
    const extendedTurns = Math.max(currentTurns, turns + 1);
    effect.remainingTurns = extendedTurns;
    effect.duration = extendedTurns;
    effect.durationTotal = Math.max(effect.durationTotal ?? 0, extendedTurns);
    return count + 1;
  }, 0);
};

const hasEffect = (unit, id) => (
  Array.isArray(unit?.effects) && unit.effects.some(effect => effect?.id === id)
);

const hasBleed = (unit) => hasEffect(unit, effectId('Кровотечение'));
const selectedTalent = (attacker, abilityId) => {
  const progression = attacker?.classProgression;
  const record = progression?.[attacker?.class || 'Defender'] || progression;
  return record?.talentSelections?.[abilityId] || null;
};
const isTemporaryRemovableBuff = effect => {
  if (!effect) return false;
  const definition = getEffectDefinition(effect.id);
  const remainingTurns = effect.remainingTurns ?? effect.duration;
  return (definition?.type === 'buff' || effect.type === 'buff' || effect.kind === 'buff') &&
    !['defender_combat_readiness', 'defender_ram_prepared'].includes(effect.id) &&
    definition?.persistent !== true && effect.persistent !== true &&
    definition?.durationPresentation !== 'permanent' && effect.durationPresentation !== 'permanent' &&
    definition?.unremovable !== true && effect.unremovable !== true &&
    definition?.removable !== false && effect.removable !== false && effect.extra?.removable !== false &&
    Number.isFinite(remainingTurns) && remainingTurns < 999;
};
const consumeCombatReadiness = (attacker, log) => {
  const ready = (attacker?.effects || []).find(effect => effect?.id === 'defender_combat_readiness');
  if (!ready) return false;
  cleanseEffects(attacker, effect => effect === ready, log);
  return true;
};
const hasBurn = (unit) => hasEffect(unit, effectId('Горение'));
const hasAnyDebuff = (unit) => Array.isArray(unit?.effects) && unit.effects.some(effect => (
  effect?.type === 'debuff' || effect?.kind === 'debuff'
));

const missingHp = (unit) => Math.max(0, (unit?.maxHp ?? unit?.hp ?? 0) - (unit?.hp ?? 0));
const hasRemovableDebuff = (unit) => Array.isArray(unit?.effects) && unit.effects.some(effect => (
  effect?.type === 'debuff' || effect?.kind === 'debuff'
));
const effectiveHeal = (unit, fraction) => Math.min(
  missingHp(unit),
  roundDamage((unit?.maxHp ?? unit?.hp ?? 0) * fraction)
);
const healingUrgencyScore = (unit) => {
  const maxHp = Math.max(1, unit?.maxHp ?? unit?.hp ?? 1);
  const hpRatio = Math.max(0, unit?.hp ?? 0) / maxHp;
  if (hpRatio <= 0.2) return 320;
  if (hpRatio <= 0.4) return 220;
  if (hpRatio <= 0.6) return 120;
  if (hpRatio <= 0.8) return 50;
  return 0;
};
const healingTargetScore = (unit, fraction, secondaryValue = 0) => {
  const maxHp = Math.max(1, unit?.maxHp ?? unit?.hp ?? 1);
  const effectiveHealPercent = (effectiveHeal(unit, fraction) / maxHp) * 100;
  return healingUrgencyScore(unit) + effectiveHealPercent + secondaryValue;
};

const extendEffectDuration = (unit, id, turns = 1) => {
  if (!unit || !Array.isArray(unit.effects)) return false;
  const effect = unit.effects.find(entry => entry?.id === id);
  if (!effect) return false;
  const currentTurns = Number.isFinite(effect.remainingTurns) ? effect.remainingTurns : effect.duration ?? 0;
  const nextTurns = Math.max(currentTurns + turns, currentTurns);
  effect.remainingTurns = nextTurns;
  effect.duration = nextTurns;
  effect.durationTotal = Math.max(effect.durationTotal ?? 0, nextTurns);
  return true;
};

const livingUnits = (units = []) => units.filter(unit => unit && unit.hp > 0);

const livingPlagueRats = (session) => livingUnits(session?.state?.enemies || [])
  .filter(unit => unit.name === 'Чумная крыса');

const livingMushroomMeatBugs = (session) => livingUnits(session?.state?.enemies || [])
  .filter(unit => unit.name === 'Мясистый жук' || unit.encounterGroup === 'mushroom_bug_pack');

const isCleanDirectDamage = (context) => (
  Boolean(context?.directAttack) &&
  !context?.fromEffect &&
  !context?.sourceEffectId &&
  !context?.skipFlameRuneTrigger
);

export const ABILITY_LIBRARY = {
  'Приказ Королей': {
    name: 'Приказ Королей',
    artId: 'attack',
    cooldown: 0,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * 1.6),
    type: 'magical',
    school: MAGIC_SCHOOLS.DEATH,
    scalingStat: 'attack',
    targeting: 'enemy',
    shieldDamageMultiplier: 1.5,
    hpDamageMultiplier: ({ target }) =>
      target && target.hp < (target.maxHp || 0) * 0.5 ? 1.3 : 1,
    description: 'Наносит 160% физической атаки магическим уроном Смертью. По Щиту наносит на 50% больше урона; по здоровью цели ниже 50% максимального здоровья — на 30% больше прямого урона.',
  },
  'Выводок Гнуса': {
    name: 'Выводок Гнуса', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.gnatSowerCooldown, damage: 0,
    type: 'support', targeting: 'self',
    // Six live enemies is the existing global combat-board limit, not a per-Sower cap.
    canUse: ({ session }) => (session?.state?.enemies || []).filter(unit => unit?.hp > 0).length < 6,
    aiScore: () => 120,
    apply: ({ attacker, session, log }) => {
      if (!session?.summonEnemy || !attacker?.id || attacker.hp <= 0) return;
      const result = session.summonEnemy('Янтарный Гнус', { source: attacker });
      if (result?.success && typeof log === 'function') log(`🐛 ${attacker.name} выводит ${result.enemy.name}.`);
    },
    description: 'Призывает одного Янтарного Гнуса, связанного с конкретным Сеятелем. Дополнительного лимита призывов нет.',
  },
  'Зов роя': {
    name: 'Зов роя', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.gnatRallyCooldown, damage: 0,
    type: 'support', targeting: 'allAllies',
    effect: { id: 'speed_boost_minor', duration: WITHERING_FOREST_TUNING.gnatRallyDuration, target: 'allAllies' },
    canUse: ({ allies = [] }) => allies.some(ally => ally?.hp > 0 && !(ally.effects || []).some(effect => effect?.id === 'speed_boost_minor')),
    aiScore: () => 100,
    description: 'Ускоряет всех живых союзников, включая призванных Гнусов, на 2 хода.',
  },
  'Кровавая связь': {
    name: 'Кровавая связь', artId: 'attack', passive: true,
    description: 'Когда принадлежащий Сеятелю Янтарный Гнус действительно восстанавливает здоровье, живой Сеятель восстанавливает 50% этого лечения.',
  },
  'Кровосос': {
    name: 'Кровосос', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.gnatBloodsuckCooldown,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * WITHERING_FOREST_TUNING.gnatBloodsuckDamageMultiplier),
    type: 'physical', scalingStat: 'attack', targeting: 'enemy',
    lifestealFromActualHp: WITHERING_FOREST_TUNING.gnatLifestealRatio,
    aiScore: () => 130,
    description: 'Наносит 80% атаки физическим уроном; восстанавливает 75% фактически отнятого здоровья, не накладывает Кровотечение.',
  },
  'Покос': {
    name: 'Покос', artId: 'attack', enemyArtId: 'attack', cooldown: WITHERING_FOREST_TUNING.reaperMowCooldown,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * WITHERING_FOREST_TUNING.reaperMowMultiplier),
    type: 'physical', scalingStat: 'attack', targeting: 'allEnemies',
    effect: { id: 'entanglement', stacks: 2 },
    secondary: {
      target: 'otherEnemies', type: 'physical', allowCritical: false,
      damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * WITHERING_FOREST_TUNING.reaperMowMultiplier),
      effects: { id: 'entanglement', stacks: 2 },
    },
    aiScore: ({ opponents = [] }) => 55 + Math.max(0, opponents.length - 1) * 25,
    description: 'Наносит 105% атаки физическим уроном герою и всем его живым призывам; каждое успешное попадание накладывает 2 заряда Опутывания.',
  },
  'Жатва корней': {
    name: 'Жатва корней', artId: 'attack', enemyArtId: 'attack', cooldown: WITHERING_FOREST_TUNING.reaperHarvestCooldown,
    damage: ({ attacker, target }) => {
      const consumedStacks = Math.min(
        WITHERING_FOREST_TUNING.reaperHarvestMaxConsumedEntanglement,
        getEffectStackCount(target, 'entanglement')
      );
      return roundDamage((attacker?.attack ?? 0) * (
        WITHERING_FOREST_TUNING.reaperHarvestBaseMultiplier
        + consumedStacks * WITHERING_FOREST_TUNING.reaperHarvestBonusPerEntanglement
      ));
    },
    type: 'physical', scalingStat: 'attack', targeting: 'enemy',
    effect: { id: 'healing_curse', duration: 1 },
    canUse: ({ target }) => (
      getEffectStackCount(target, 'entanglement') > 0
      || (target?.maxHp > 0 && target.hp / target.maxHp <= WITHERING_FOREST_TUNING.reaperExecuteThreshold)
    ),
    targetScore: ({ target }) => getEffectStackCount(target, 'entanglement') * 35 + (target?.maxHp > 0 ? (1 - target.hp / target.maxHp) * 60 : 0),
    aiScore: ({ target }) => 75 + getEffectStackCount(target, 'entanglement') * 18,
    apply: ({ target, log }) => {
      const available = getEffectStackCount(target, 'entanglement');
      const consumed = Math.min(WITHERING_FOREST_TUNING.reaperHarvestMaxConsumedEntanglement, available);
      if (consumed > 0) {
        consumeEffectStacks(target, 'entanglement', consumed);
        log?.(`🌾 Жатва корней поглощает ${consumed} зар. Опутывания.`);
      }
    },
    description: 'Наносит 165% атаки +25 п.п. за каждый из максимум 3 зарядов Опутывания, поглощает использованные заряды и накладывает Проклятие исцеления на 1 ход.',
  },
  'Безжалостная жатва': {
    name: 'Безжалостная жатва', artId: 'attack', passive: true,
    modifySecondaryDamage: true,
    modifyDamage: ({ damage, target, ability }) => {
      if (ability?.passive || !(target?.maxHp > 0)
        || target.hp / target.maxHp > WITHERING_FOREST_TUNING.reaperExecuteThreshold) return damage;
      return damage * WITHERING_FOREST_TUNING.reaperExecuteMultiplier;
    },
    description: 'Каждый пакет прямого урона по целям с 35% здоровья или ниже повышен на 30%.',
  },
  'Цепкие корни': {
    name: 'Цепкие корни', cooldown: WITHERING_FOREST_TUNING.owlGraspingRootsCooldown,
    damage: 0, type: 'support', targeting: 'enemy',
    effect: { id: 'entanglement', stacks: WITHERING_FOREST_TUNING.owlGraspingRootsStacks },
    canUse: ({ target }) => getEffectStackCount(target, 'entanglement') <= 3,
    targetScore: ({ target }) => 100 - getEffectStackCount(target, 'entanglement') * 10,
    aiScore: ({ target }) => getEffectStackCount(target, 'entanglement') === 0 ? 105 : 70,
    description: 'Накладывает 2 заряда Опутывания.',
  },
  'Сброс лепестков': {
    name: 'Сброс лепестков', passive: true,
    bloomArchonCleanseEveryTurns: WITHERING_FOREST_TUNING.bloomArchonCleanseEveryTurns,
    description: 'В начале каждого третьего собственного хода Архонт очищает с себя один тип снимаемых отрицательных эффектов целиком, выбирая наиболее накопленный.',
  },
  'Корни Архонта': {
    name: 'Корни Архонта', cooldown: WITHERING_FOREST_TUNING.bloomArchonRootsCooldown,
    damage: 0, type: 'support', targeting: 'enemy',
    effect: [
      { id: 'entanglement', stacks: 2 },
      { id: 'archon_bud', persistent: true, extra: {
        remainingSourceTurns: WITHERING_FOREST_TUNING.bloomArchonBudActions,
        poisonDuration: WITHERING_FOREST_TUNING.bloomArchonBudPoisonDuration,
      } },
    ],
    targetScore: ({ target }) => (target?.effects || []).some(effect => effect?.id === 'archon_bud')
      ? -100 - getEffectStackCount(target, 'entanglement') * 10
      : 100 - getEffectStackCount(target, 'entanglement') * 10,
    aiScore: ({ target, opponents = [] }) => {
      const hasBud = (target?.effects || []).some(effect => effect?.id === 'archon_bud');
      const unbudded = opponents.some(unit => !(unit.effects || []).some(effect => effect?.id === 'archon_bud'));
      return hasBud && !unbudded ? 35 : 108 - getEffectStackCount(target, 'entanglement') * 8;
    },
    description: 'Накладывает 2 заряда Опутывания и Бутон на начало следующих 2 ходов Архонта. После второго тика Бутон распускается и накладывает Отравление на 3 хода.',
  },
  'Цветение жизни': {
    name: 'Цветение жизни', cooldown: WITHERING_FOREST_TUNING.bloomArchonLifeBloomCooldown,
    damage: 0, type: 'support', targeting: 'enemy',
    canUse: ({ opponents = [] }) => opponents.some(target => getEffectStackCount(target, 'entanglement') > 0),
    targetScore: ({ target }) => getEffectStackCount(target, 'entanglement') * 40,
    aiScore: ({ attacker, target }) => {
      const stacks = Math.min(WITHERING_FOREST_TUNING.bloomArchonLifeBloomMaxConsume, getEffectStackCount(target, 'entanglement'));
      const missing = attacker?.maxHp > 0 ? 1 - attacker.hp / attacker.maxHp : 0;
      return 38 + stacks * 13 + missing * 190;
    },
    apply: ({ attacker, target, heal, log }) => {
      const consumed = consumeEffectStacks(target, 'entanglement', WITHERING_FOREST_TUNING.bloomArchonLifeBloomMaxConsume);
      if (consumed <= 0) return;
      heal?.(attacker, attacker.maxHp * WITHERING_FOREST_TUNING.bloomArchonLifeBloomHealPerStack * consumed);
      attacker.turnMeter = Math.min(1000, (attacker.turnMeter || 0)
        + WITHERING_FOREST_TUNING.bloomArchonLifeBloomTurnMeterPerStack * consumed);
      log?.(`🌺 Цветение жизни поглощает ${consumed} зар. Опутывания.`);
    },
    description: 'Поглощает до 2 зарядов Опутывания; каждый лечит 4% максимального здоровья и даёт 100 шкалы хода.',
  },
  'Терновое цветение': {
    name: 'Терновое цветение', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.bloomArchonThornBloomCooldown,
    type: 'magical', school: MAGIC_SCHOOLS.NATURE, scalingStat: 'magAtk', targeting: 'enemy',
    damage: ({ attacker, target }) => roundDamage((attacker?.magAtk || 0) * (
      WITHERING_FOREST_TUNING.bloomArchonThornBloomBaseMultiplier
      + Math.min(3, getEffectStackCount(target, 'entanglement')) * WITHERING_FOREST_TUNING.bloomArchonThornBloomPerStack
    )),
    targetScore: ({ target }) => getEffectStackCount(target, 'entanglement') * 35,
    aiScore: ({ attacker, target }) => {
      const stacks = Math.min(3, getEffectStackCount(target, 'entanglement'));
      const missing = attacker?.maxHp > 0 ? 1 - attacker.hp / attacker.maxHp : 0;
      return 68 + stacks * 24 - missing * 35;
    },
    apply: ({ target, deliberateAction, log, attacker, session }) => {
      if (!deliberateAction?.successfulDirectHit || deliberateAction.bloomArchonThornConsumed) return;
      deliberateAction.bloomArchonThornConsumed = true;
      const stacks = Math.min(3, getEffectStackCount(target, 'entanglement'));
      if (stacks > 0) {
        addEffect(target, { id: 'attack_penalty_minor', duration: 2 }, log, attacker, { session });
      }
    },
    description: 'Наносит 130% магической атаки +20 п.п. за каждый из максимум 3 текущих зарядов Опутывания; заряды не расходуются. При наличии Опутывания накладывает Ослабление на 2 хода.',
  },
  'Смертельное цветение': {
    name: 'Смертельное цветение', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.bloomArchonDeathBloomCooldown,
    type: 'magical', school: MAGIC_SCHOOLS.NATURE, scalingStat: 'magAtk', targeting: 'enemy',
    damage: ({ attacker, target }) => roundDamage((attacker?.magAtk || 0) * (
      WITHERING_FOREST_TUNING.bloomArchonDeathBloomBaseMultiplier
      + Math.min(3, getEffectStackCount(target, 'entanglement')) * WITHERING_FOREST_TUNING.bloomArchonDeathBloomPerStack
    )),
    targetScore: ({ target }) => getEffectStackCount(target, 'entanglement') * 35,
    aiScore: ({ target }) => 62 + Math.min(3, getEffectStackCount(target, 'entanglement')) * 27,
    apply: ({ attacker, target, deliberateAction, log }) => {
      if (!deliberateAction?.successfulDirectHit || deliberateAction.bloomArchonDeathConsumed) return;
      deliberateAction.bloomArchonDeathConsumed = true;
      const consumed = consumeEffectStacks(target, 'entanglement', WITHERING_FOREST_TUNING.bloomArchonDeathBloomMaxConsume);
      attacker.turnMeter = Math.min(1000, (attacker.turnMeter || 0) + consumed * 100);
      if (consumed > 0) log?.(`🥀 Смертельное цветение поглощает ${consumed} зар. Опутывания.`);
    },
    description: 'Наносит 150% магической атаки +15 п.п. за каждый из максимум 3 текущих зарядов Опутывания; поглощает до 2 зарядов, каждый даёт 100 шкалы хода.',
  },
  'Погребение в корнях': {
    name: 'Погребение в корнях', cooldown: WITHERING_FOREST_TUNING.bloomArchonBurialCooldown,
    damage: 0, type: 'support', targeting: 'enemy',
    canUse: ({ attacker }) => !attacker?._preparation,
    targetScore: ({ target }) => getEffectStackCount(target, 'entanglement') * 45,
    aiScore: ({ target }) => {
      const stacks = getEffectStackCount(target, 'entanglement');
      return stacks >= 4 ? 185 + stacks * 5 : 30 + stacks * 12;
    },
    apply: ({ attacker, target, log }) => {
      attacker._preparation = {
        kind: 'bloom_archon_burial', resolveName: 'Погребение в корнях', targetId: target?.id,
      };
      attacker._bloomArchonPreparationAwaitingResponse = true;
      attacker.turnMeter = 0;
      log?.(`⚠️ ${attacker.name} готовит Погребение в корнях для ${target?.name || 'цели'}.`);
    },
    description: 'Готовит тяжёлый физический удар по выбранной цели на следующий ход; сила зависит от Опутывания при исполнении.',
  },
  'Взмах крыла': {
    name: 'Взмах крыла', artId: 'attack', enemyArtId: 'attack', cooldown: WITHERING_FOREST_TUNING.owlWingbeatCooldown,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * WITHERING_FOREST_TUNING.owlWingbeatMultiplier),
    type: 'physical', scalingStat: 'attack', targeting: 'enemy',
    aiScore: () => 90,
    apply: ({ attacker, target }) => {
      reduceHostileTurnMeter(target, WITHERING_FOREST_TUNING.owlWingbeatTurnMeter);
      attacker.turnMeter = Math.min(1000, (attacker.turnMeter ?? 0) + WITHERING_FOREST_TUNING.owlWingbeatTurnMeter);
    },
    description: 'Наносит 90% атаки, отнимает у цели 15% шкалы хода и продвигает свою на 15%.',
  },
  'Лёгкость крыла': {
    name: 'Лёгкость крыла', artId: 'attack', passive: true,
    hostileTurnMeterReductionMitigation: WITHERING_FOREST_TUNING.owlControlMitigation,
    hostileSpeedPenaltyMitigation: WITHERING_FOREST_TUNING.owlControlMitigation,
    description: 'Замедления и вражеское снижение шкалы хода действуют на 50% слабее; положительный прирост не изменяется.',
  },
  'Медвежий натиск': {
    name: 'Медвежий натиск', artId: 'attack', enemyArtId: 'attack', cooldown: WITHERING_FOREST_TUNING.bearChargeCooldown,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * WITHERING_FOREST_TUNING.bearChargeMultiplier),
    type: 'physical', scalingStat: 'attack', targeting: 'enemy', effect: { id: 'stun', duration: 1 },
    aiScore: ({ target }) => (target?.effects || []).some(effect => effect?.id === 'stun') ? 35 : 105,
    description: 'Наносит 155% атаки и при попадании накладывает Оглушение на 1 ход.',
  },
  'Дубовое восстановление': {
    name: 'Дубовое восстановление', cooldown: WITHERING_FOREST_TUNING.bearRecoveryCooldown,
    damage: 0, type: 'support', targeting: 'self',
    effect: { id: 'regeneration', duration: WITHERING_FOREST_TUNING.bearRecoveryRegenerationDuration, target: 'self' },
    canUse: ({ attacker }) => attacker?.maxHp > 0 && attacker.hp / attacker.maxHp <= WITHERING_FOREST_TUNING.bearRecoveryThreshold,
    aiScore: ({ attacker }) => attacker?.maxHp > 0 && attacker.hp / attacker.maxHp <= 0.4 ? 160 : 115,
    apply: ({ attacker, heal: restoreHealth, log }) => {
      const healAmount = roundDamage(attacker.maxHp * WITHERING_FOREST_TUNING.bearRecoveryImmediateHealMaxHp);
      const restored = typeof restoreHealth === 'function' ? restoreHealth(attacker, healAmount) : 0;
      if (restored > 0) log?.(`🌳 ${attacker.name} немедленно восстанавливает ${restored} HP.`);
    },
    description: 'Немедленно лечит 10% максимального здоровья и даёт Регенерацию на 2 хода. Используется при 70% здоровья или ниже.',
  },
  'Звериная ярость': {
    name: 'Звериная ярость', artId: 'attack', passive: true,
    onOwnerDamaged: ({ owner, session, log }) => {
      if (!owner || owner._bestialFuryTriggered || owner.hp <= 0 || owner.hp > owner.maxHp * WITHERING_FOREST_TUNING.bearFuryThreshold) return;
      owner._bestialFuryTriggered = true;
      addEffect(owner, { id: 'control_immunity', duration: WITHERING_FOREST_TUNING.bearFuryUnstoppableDuration }, log, owner, { session });
      log?.(`🐻 Звериная ярость делает ${owner.name} Непоколебимым.`);
    },
    description: 'Один раз за бой при первом падении до 40% здоровья или ниже получает Непоколебимость на 2 хода.',
  },
  'Лес: Кристаллический панцирь': {
    name: 'Опутывающий панцирь', cooldown: WITHERING_FOREST_TUNING.splitterCarapaceCooldown,
    damage: 0, type: 'support', targeting: 'self',
    canUse: ({ attacker }) => (attacker?.shield || 0) <= attacker.maxHp * 0.08,
    aiScore: ({ attacker }) => (attacker?.shield || 0) === 0 ? 135 : 35,
    apply: ({ attacker, session, log }) => addEffect(attacker, {
      id: 'shield', duration: 3,
      value: roundDamage(attacker.maxHp * WITHERING_FOREST_TUNING.splitterCarapaceShieldMaxHp),
      extra: { sourceKey: 'crystal_splitter_carapace', breakEntanglement: 2 },
    }, log, attacker, { session }),
    description: 'Даёт Щит в размере 24% максимального здоровья. Разрушивший его уроном получает 2 Опутывания.',
  },
  'Раскалывающий удар': {
    name: 'Раскалывающий удар', artId: 'attack', enemyArtId: 'attack', cooldown: WITHERING_FOREST_TUNING.splitterStrikeCooldown,
    damage: ({ attacker }) => roundDamage(attacker.attack * WITHERING_FOREST_TUNING.splitterStrikeMultiplier),
    type: 'physical', targeting: 'enemy', aiScore: () => 90,
    apply: ({ attacker, session, log }) => addEffect(attacker, {
      id: 'shield', duration: 2,
      value: roundDamage(attacker.maxHp * WITHERING_FOREST_TUNING.splitterStrikeShieldMaxHp),
      extra: { sourceKey: 'crystal_splitter_strike' },
    }, log, attacker, { session }),
    description: 'Наносит 150% атаки и после попадания даёт отдельный Щит в размере 7% максимального здоровья.',
  },
  'Резонансный разряд': {
    name: 'Резонансный разряд', cooldown: WITHERING_FOREST_TUNING.splitterDischargeCooldown,
    damage: 0, type: 'support', targeting: 'enemy',
    canUse: ({ attacker }) => (attacker?.shield || 0) > 0 && !attacker?._preparation,
    aiScore: ({ attacker }) => (attacker?.shield || 0) >= attacker.maxHp * 0.12 ? 150 : 75,
    apply: ({ attacker, target, log }) => {
      attacker._preparation = { kind: 'resonant_discharge', resolveName: 'Резонансный разряд', targetId: target?.id };
      log?.(`💎 ${attacker.name} подготавливает Резонансный разряд.`);
    },
    description: 'Подготавливает разряд: на следующем ходу поглощает фактический Щит и наносит 135% этого значения магическим уроном; от 12% максимального здоровья накладывает Шок.',
  },
  'Рваные когти': {
    name: 'Рваные когти', artId: 'attack', enemyArtId: 'attack', cooldown: WITHERING_FOREST_TUNING.predatorClawsCooldown,
    damage: ({ attacker }) => roundDamage(attacker.attack * WITHERING_FOREST_TUNING.predatorClawsMultiplier),
    type: 'physical', targeting: 'enemy', effect: { id: 'bleed', duration: 1 },
    aiScore: ({ target }) => getEffectStackCount(target, 'bleed') === 0 ? 125 : 75,
    apply: ({ attacker, target, session, log }) => addEffect(target, { id: 'bleed', duration: 1 }, log, attacker, { session }),
    description: 'Наносит 135% атаки и после попадания дважды накладывает системное Кровотечение.',
  },
  'Зов крови': {
    name: 'Зов крови', cooldown: WITHERING_FOREST_TUNING.predatorBloodCallCooldown,
    damage: 0, type: 'support', targeting: 'enemy',
    effect: { id: 'vampire_mark', duration: 3 },
    selfEffects: { id: 'speed_boost_minor', duration: WITHERING_FOREST_TUNING.predatorHasteDuration },
    canUse: ({ target }) => !(target?.effects || []).some(effect => effect?.id === 'vampire_mark'),
    aiScore: () => 115,
    description: 'Накладывает системную Метку вампира на 3 хода и даёт себе системное Ускорение на 2 собственных хода.',
  },
  'Кровавый пир': {
    name: 'Кровавый пир', artId: 'attack', enemyArtId: 'attack', cooldown: WITHERING_FOREST_TUNING.predatorBloodFeastCooldown,
    damage: ({ attacker }) => roundDamage(attacker.attack * WITHERING_FOREST_TUNING.predatorBloodFeastMultiplier),
    type: 'physical', targeting: 'enemy', aiScore: ({ attacker, target }) => 70 + getEffectStackCount(target, 'bleed') * 18 + (attacker.hp < attacker.maxHp ? 30 : 0),
    forestBloodFeast: true,
    description: 'Наносит 160% атаки. Лечит от фактического урона здоровью: 35% +8 п.п. за заряд Кровотечения, максимум 75%; Кровотечение не расходуется.',
  },
  'Буйное разрастание': {
    name: 'Буйное разрастание', passive: true, wildOvergrowth: true,
    description: 'При избыточном лечении накладывает 1 Опутывание герою, не более одного раза за исходное действие.',
  },
  'Смертельный выпад': {
    name: 'Смертельный выпад', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.shadowLungeCooldown,
    damage: ({ attacker, target }) => roundDamage((attacker?.attack ?? 0) * WITHERING_FOREST_TUNING.shadowLungeMultiplier * (
      target?.maxHp > 0 && target.hp / target.maxHp <= WITHERING_FOREST_TUNING.shadowExecuteThreshold
        ? 1 + WITHERING_FOREST_TUNING.shadowExecuteBonus : 1
    )),
    type: 'physical', scalingStat: 'attack', targeting: 'enemy',
    targetScore: ({ target }) => target?.maxHp > 0 ? 100 * (1 - Math.max(0, target.hp / target.maxHp)) : 0,
    aiScore: ({ target }) => target?.maxHp > 0 && target.hp / target.maxHp <= WITHERING_FOREST_TUNING.shadowExecuteThreshold ? 150 : 90,
    description: 'Наносит 155% атаки. Против цели с 40% здоровья или ниже наносит дополнительно 35% урона.',
  },
  'Удар в спину': {
    name: 'Удар в спину', artId: 'attack', passive: true,
    description: 'Первое атакующее действие из Невидимости наносит на 35% больше прямого урона и раскрывает Тень даже при промахе.',
  },
  'Терновый заслон': {
    name: 'Терновый заслон', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.thornGuardCooldown, damage: 0,
    type: 'support', targeting: 'self',
    effect: { id: 'guard', duration: WITHERING_FOREST_TUNING.guardDuration },
    canUse: ({ attacker }) => Boolean(attacker && !(attacker.effects || []).some(effect => effect?.id === 'guard')),
    aiScore: () => 100,
    description: 'Получает Защиту союзников на 2 хода; направленные атаки перехватываются.',
    descriptionParts: ['Получает ', { statusId: 'guard', text: 'Защиту союзников' }, ' на 2 хода; направленные атаки перехватываются.'],
  },
  'Ответные шипы': {
    name: 'Ответные шипы', artId: 'attack', passive: true,
    description: 'Отражает 15% фактической потери здоровья от прямой атаки чистым косвенным уроном.',
    descriptionParts: ['Отражает 15% фактической потери здоровья от прямой атаки чистым косвенным уроном.'],
  },
  'Ядовитые лозы': {
    name: 'Ядовитые лозы',
    cooldown: WITHERING_FOREST_TUNING.poisonVinesCooldown,
    type: 'magical', school: MAGIC_SCHOOLS.NATURE, scalingStat: 'magAtk',
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * WITHERING_FOREST_TUNING.poisonVinesDamageMultiplier),
    effect: [{ id: 'entanglement' }, { id: 'poison', duration: WITHERING_FOREST_TUNING.poisonVinesPoisonDuration }],
    canUse: ({ target }) => Boolean(target && (!(target.effects || []).some(effect => effect?.id === 'entanglement') || !(target.effects || []).some(effect => effect?.id === 'poison'))),
    aiScore: () => 90,
    description: 'Наносит 75% магической атаки Природой, накладывает Опутывание и Отравление на 3 хода.',
    descriptionParts: ['Наносит 75% магической атаки Природой, накладывает ', { statusId: 'entanglement', text: 'Опутывание' }, ' и ', { statusId: 'poison', text: 'Отравление' }, ' на 3 хода.'],
  },
  'Зарастающий бутон': {
    name: 'Зарастающий бутон',
    cooldown: WITHERING_FOREST_TUNING.overgrowingBudCooldown,
    damage: 0, type: 'support', targeting: 'enemy',
    effect: { id: 'overgrowth', duration: WITHERING_FOREST_TUNING.overgrowthDuration },
    canUse: ({ target }) => Boolean(target && !(target.effects || []).some(effect => effect?.id === 'overgrowth')),
    aiScore: () => 100,
    description: 'Накладывает Зарастание на 4 хода: следующая активная небазовая способность восстанавливается на 1 ход дольше.',
    descriptionParts: ['Накладывает ', { statusId: 'overgrowth', text: 'Зарастание' }, ' на 4 хода: следующая активная небазовая способность восстанавливается на 1 ход дольше.'],
  },
  'Уязвимый выстрел': {
    name: 'Уязвимый выстрел', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.vulnerableShotCooldown,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * WITHERING_FOREST_TUNING.vulnerableShotMultiplier),
    type: 'physical', scalingStat: 'attack',
    effect: { id: 'vulnerability', duration: WITHERING_FOREST_TUNING.vulnerableShotDuration },
    canUse: ({ candidateTargets = [] }) => candidateTargets.some(target => !(target.effects || []).some(effect => effect?.id === 'vulnerability')),
    targetScore: ({ target }) => (target?.effects || []).some(effect => effect?.id === 'vulnerability') ? 0 : 100,
    aiScore: () => 100,
    description: 'Наносит 110% атаки физическим уроном и накладывает Уязвимость на 2 хода.',
    descriptionParts: ['Наносит 110% атаки физическим уроном и накладывает ', { statusId: 'vulnerability', text: 'Уязвимость' }, ' на 2 хода.'],
  },
  'Лес: Прицельный выстрел': {
    name: 'Прицельный выстрел', artId: 'attack', enemyArtId: 'attack',
    cooldown: WITHERING_FOREST_TUNING.focusedShotCooldown,
    damage: ({ attacker, target }) => roundDamage((attacker?.attack ?? 0) * WITHERING_FOREST_TUNING.focusedShotMultiplier * ((target?.effects || []).some(effect => effect?.id === 'vulnerability') ? WITHERING_FOREST_TUNING.focusedShotVulnerabilityBonus : 1)),
    type: 'physical', scalingStat: 'attack',
    targetScore: ({ target }) => (target?.effects || []).some(effect => effect?.id === 'vulnerability') ? 100 : 0,
    aiScore: ({ target }) => (target?.effects || []).some(effect => effect?.id === 'vulnerability') ? 120 : 20,
    description: 'Наносит 155% атаки физическим уроном; по Уязвимости дополнительно +25% урона сверх стандартного эффекта.',
    descriptionParts: ['Наносит 155% атаки физическим уроном; по ', { statusId: 'vulnerability', text: 'Уязвимости' }, ' дополнительно +25% урона сверх стандартного эффекта.'],
  },
  'Рванная рана': {
    name: 'Рванная рана',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 10) * 1.7),
    type: 'physical',
    effect: { id: effectId('Кровотечение'), duration: 2 },
    description: 'Мощный рубящий удар, оставляющий кровоточащую рану.',
  },
  'Стойкость': {
    artId: 'endurance',
    name: 'Стойкость',
    cooldown: 3,
    damage: 0,
    type: 'support',
    targeting: 'self',
    classTags: ['defender'],
    unlockTier: 1,
    abilityRole: 'defense',
    description: 'Получает Щит в размере 30% максимального здоровья на 3 хода и Мощное укрепление на 3 хода.',
    descriptionParts: ['Получает ', { statusId: 'shield', text: 'Щит' }, ' в размере 30% максимального здоровья на 3 хода и ', { statusId: 'phys_def_boost_major', text: 'Мощное укрепление' }, ' на 3 хода.'],
    apply: ({ attacker, log, session }) => {
      const maxHp = attacker?.maxHp ?? 0;
      const gainedShield = roundDamage(maxHp * 0.30);
      if (gainedShield <= 0) return;
      addEffect(
        attacker,
        { id: 'shield', duration: 3, value: gainedShield },
        log,
        attacker,
        { session }
      );
      addEffect(
        attacker,
        { id: effectId('Мощное укрепление'), duration: 3 },
        log,
        attacker,
        { session }
      );
      const talent = selectedTalent(attacker, 'defender.fortitude');
      if (talent === 'defender.fortitude.unbroken_will') {
        const removed = removeRandomNegativeEffect(attacker, session?.rng || Math.random, log);
        if (!removed && !hasEffect(attacker, 'protection_seals')) {
          addEffect(attacker, { id: 'protection_seals' }, log, attacker, { session });
        }
      } else if (talent === 'defender.fortitude.combat_readiness') {
        // Three lifecycle ticks keep this available for the next two own actions:
        // effects age at the beginning of a unit's turn, before its action.
        addEffect(attacker, { id: 'defender_combat_readiness', duration: 3 }, log, attacker, { session });
      }
    },
  },
  'Железный контрудар': {
    artId: 'iron_counter',
    name: 'Контратака',
    cooldown: 3,
    damage: 0,
    type: 'support',
    classTags: ['defender'],
    unlockTier: 1,
    abilityRole: 'counter',
    description:
      'Защитник встаёт в оборону, усиливает защиту и готовит мощную контратаку.',
    apply: ({ attacker, log, session }) => {
      if (!attacker) return;
      addEffect(
        attacker,
        { id: effectId('Мощное укрепление'), duration: 2 },
        log,
        attacker,
        { session }
      );
      addEffect(
        attacker,
        { id: 'iron_counter', duration: 2 },
        log,
        attacker,
        { session }
      );
    },
  },
  'Кровавый таран': {
    artId: 'blood_ram',
    name: 'Ранящий удар',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * 1.4),
    type: 'physical',
    effect: ({ attacker }) => ({
      id: effectId('Кровотечение'),
      duration: (Math.max(0, attacker?.shield ?? 0) > 0 ? 2 : 1)
        + (selectedTalent(attacker, 'defender.wounding_strike') === 'defender.wounding_strike.deep_wound' ? 2 : 0),
    }),
    apply: ({ attacker, target, hitTargets = [], session, log, applyDamage }) => {
      if (!target || !hitTargets.includes(target)
        || selectedTalent(attacker, 'defender.wounding_strike') !== 'defender.wounding_strike.open_wounds') return;
      const bleed = target.effects?.find(effect => effect?.id === effectId('Кровотечение'));
      if (!bleed) return;
      triggerEffectTick(target, bleed, {
        session,
        applyDamage: (unit, amount, type, extra = {}) => applyDamage?.(unit, amount, type, extra) ?? 0,
      }, log);
    },
    classTags: ['defender'],
    unlockTier: 1,
    abilityRole: 'damage',
    description:
      'Наносит 140% атаки физическим уроном. После попадания накладывает 1 заряд Кровотечения или 2 заряда, если перед атакой был Щит.',
    descriptionParts: ['Наносит 140% атаки физическим уроном. После попадания накладывает 1 заряд ', { statusId: 'bleed', text: 'Кровотечения' }, ' или 2 заряда, если перед атакой был ', { statusId: 'shield', text: 'Щит' }, '.'],
  },
  'Кристаллический панцирь': {
    name: 'Кристаллический панцирь',
    passive: true,
    description:
      'Пассивно: кристаллическая оболочка формирует щит и усиливает антимагию. Если щит разобьётся, панцирь восстанавливается в начале следующего хода.',
    onBattleStart: ({ owner, session, log }) => {
      if (!owner) return;
      const applyShield = () => {
        const maxHp = owner.maxHp ?? owner.hp ?? 0;
        const shieldValue = Math.max(8, Math.round(maxHp * 0.2));
        addEffect(
          owner,
          { id: 'shield', duration: 2, value: shieldValue },
          log,
          owner,
          { session }
        );
        addEffect(
          owner,
          { id: effectId('Оберег'), duration: 2 },
          log,
          owner,
          { session }
        );
      };

      applyShield();
    },
    onTurnStart: ({ owner, session, log }) => {
      if (!owner || owner.hp <= 0) return;
      const hasShieldEffect = Array.isArray(owner.effects)
        && owner.effects.some(effect => effect?.id === 'shield');
      const shieldActive = (owner.shield ?? 0) > 0 && hasShieldEffect;
      if (shieldActive) return;

      const maxHp = owner.maxHp ?? owner.hp ?? 0;
      const shieldValue = Math.max(8, Math.round(maxHp * 0.2));
      addEffect(
        owner,
        { id: 'shield', duration: 2, value: shieldValue },
        log,
        owner,
        { session }
      );
      addEffect(
        owner,
        { id: effectId('Оберег'), duration: 2 },
        log,
        owner,
        { session }
      );
    },
  },
  'Боевой клич': {
    name: 'Боевой клич',
    cooldown: 4,
    damage: 0,
    type: 'support',
    description:
      'Поднимает боевой дух союзников, усиливая их атаку и скорость, а врагов ослабляет.',
    apply: ({ attacker, session, log }) => {
      const allies = session?.state?.players?.filter(unit => unit && unit.hp > 0) || [];
      const enemies = session?.state?.enemies?.filter(unit => unit && unit.hp > 0) || [];

      allies.forEach(ally => {
        addEffect(
          ally,
          { id: effectId('Натиск'), duration: 2 },
          log,
          attacker,
          { session }
        );
        addEffect(
          ally,
          { id: effectId('Ускорение'), duration: 2 },
          log,
          attacker,
          { session }
        );
      });

      enemies.forEach(enemy => {
        addEffect(
          enemy,
          { id: effectId('Ослабление'), duration: 1 },
          log,
          attacker,
          { session }
        );
      });
    },
  },
  'Огненный шар': {
    artId: 'fireball',
    name: 'Огненный шар',
    cooldown: 1,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 1.4),
    type: 'magical',
    school: MAGIC_SCHOOLS.FIRE,
    effect: { id: effectId('Горение'), duration: 2, metadata: { sourceAbility: 'Огненный шар' } },
    secondary: {
      target: 'otherEnemies',
      type: 'magical',
      school: MAGIC_SCHOOLS.FIRE,
      isSecondaryDamage: true,
      condition: ({ primaryPrepared, primaryHit }) => Boolean(primaryPrepared && primaryHit),
      damage: ({ attacker }) =>
        roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 0.35),
      description: 'Огненный шар обжигает ближайших врагов, если основная цель уже подготовлена стихией.',
    },
    apply: ({ attacker, target, hitTargets = [], preHitTargetStates = [], session, log, applyDamage }) => {
      if (!target || !hitTargets.includes(target)) return;
      const talent = selectedTalent(attacker, 'mage.fireball');
      const before = preHitTargetStates.find(entry => entry.target === target);
      if (talent === 'mage.fireball.charring_fire') {
        const priorCharring = Math.max(0, before?.charringStacks || 0);
        if (priorCharring >= 3) {
          (target.effects || []).filter(effect => effect?.id === 'charring').forEach(effect => {
            effect.remainingTurns = Math.max(3, effect.remainingTurns ?? 0);
            effect.duration = effect.remainingTurns;
            effect.durationTotal = Math.max(effect.durationTotal ?? 0, effect.remainingTurns);
          });
          const burn = (target.effects || []).find(effect => effect?.id === 'burn');
          if (burn) {
            const current = Math.max(0, Number(burn.remainingTurns ?? burn.duration) || 0);
            burn.remainingTurns = current + 1;
            burn.duration = burn.remainingTurns;
            burn.durationTotal = Math.max(burn.durationTotal ?? 0, burn.remainingTurns);
          }
        } else {
          addEffect(target, { id: 'charring', duration: 3 }, log, attacker, { session });
        }
      }
      if (talent === 'mage.fireball.flash' && before?.hadBurn) {
        const burn = (target.effects || []).find(effect => effect?.id === 'burn');
        if (burn) {
          triggerEffectTick(target, burn, {
            session,
            applyDamage: (unit, amount, type, extra = {}) => applyDamage?.(unit, amount, type, extra) ?? 0,
            getAllies: unit => (session?.state?.enemies || []).includes(unit) ? session.state.enemies : session?.state?.players || [],
          }, log);
        }
      }
    },
    description:
      'Наносит выбранной цели магический урон Огнём в размере 140% магической атаки и накладывает Горение на 2 хода. Если цель уже под Горением, Шоком или Заморозкой, наносит остальным врагам магический урон Огнём в размере 35% магической атаки.',
    descriptionParts: ['Наносит выбранной цели магический урон Огнём в размере 140% магической атаки и накладывает ', { statusId: 'burn', text: 'Горение' }, ' на 2 хода. Если цель уже под ', { statusId: 'burn', text: 'Горением' }, ', ', { statusId: 'shock', text: 'Шоком' }, ' или ', { statusId: 'freeze', text: 'Заморозкой' }, ', наносит остальным врагам магический урон Огнём в размере 35% магической атаки.'],
  },
  'Ледяное копьё': {
    artId: 'ice_lance',
    name: 'Ледяное копьё',
    cooldown: 1,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 1.2),
    type: 'magical',
    school: MAGIC_SCHOOLS.ICE,
    effect: { id: 'freeze', duration: 1 },
    iceShardDamageMultiplier: ({ attacker }) => selectedTalent(attacker, 'mage.ice_spear') === 'mage.ice_spear.shatter' ? 2 : 1,
    apply: ({ attacker, target, hitTargets = [], session, log }) => {
      if (!target || !hitTargets.includes(target)
        || selectedTalent(attacker, 'mage.ice_spear') !== 'mage.ice_spear.deep_freeze') return;
      addEffect(target, { id: 'speed_penalty_major', duration: 2 }, log, attacker, { session });
    },
    description: 'Наносит 120% магической атаки уроном Льда и накладывает Заморозку на 1 ход. Если цель невосприимчива к Заморозке, вместо неё получает 1 Ледяной осколок.',
    descriptionParts: ['Наносит 120% магической атаки уроном Льда и накладывает ', { statusId: 'freeze', text: 'Заморозку' }, ' на 1 ход. Если цель невосприимчива к ', { statusId: 'freeze', text: 'Заморозке' }, ', вместо неё получает 1 ', { statusId: 'ice_shards', text: 'Ледяной осколок' }, '.'],
  },
  'Цепная молния': {
    artId: 'chain_lightning',
    name: 'Цепная молния',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 0.95),
    type: 'magical',
    school: MAGIC_SCHOOLS.LIGHTNING,
    effect: { id: effectId('Шок'), duration: 2 },
    secondary: {
      target: 'otherEnemies',
      type: 'magical',
      school: MAGIC_SCHOOLS.LIGHTNING,
      isSecondaryDamage: true,
      damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 0.95),
      effects: ({ attacker }) => ({
        id: effectId('Шок'),
        duration: 2,
        chance: selectedTalent(attacker, 'mage.chain_lightning') === 'mage.chain_lightning.inevitable_chain' ? 1 : 0.55,
      }),
    },
    apply: ({ attacker, target, hitTargets = [], actionSnapshot, applyDirectDamage, flushDamageReactions }) => {
      if (!target || !hitTargets.includes(target)
        || selectedTalent(attacker, 'mage.chain_lightning') !== 'mage.chain_lightning.closed_chain') return;
      const enemiesAtStart = Math.max(1, Number(actionSnapshot?.livingEnemyCountBeforeAction) || 1);
      const missingSecondaryTargets = Math.max(0, Math.min(2, 3 - enemiesAtStart));
      for (let index = 0; index < missingSecondaryTargets; index += 1) {
        applyDirectDamage?.(
          target,
          roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 0.45),
          {
            name: 'Замкнутая цепь',
            type: 'magical',
            school: MAGIC_SCHOOLS.LIGHTNING,
            noElementalResonance: true,
          }
        );
        flushDamageReactions?.(target);
        if (attacker?.hp <= 0 || target.hp <= 0) break;
      }
    },
    description: 'Наносит всем врагам 95% магической атаки уроном Молнии. Накладывает Шок на основную цель на 2 хода; на остальных — с вероятностью 55% на 2 хода. Невосприимчивая к Шоку цель вместо него получает 1 Заряд.',
    descriptionParts: ['Наносит всем врагам 95% магической атаки уроном Молнии. Накладывает ', { statusId: 'shock', text: 'Шок' }, ' на основную цель на 2 хода; на остальных — с вероятностью 55% на 2 хода. Невосприимчивая к ', { statusId: 'shock', text: 'Шоку' }, ' цель вместо него получает 1 ', { statusId: 'charge', text: 'Заряд' }, '.'],
  },
  'Морозный щит': {
    artId: 'frost_shield',
    name: 'Морозный щит',
    cooldown: 3,
    damage: 0,
    type: 'support',
    targeting: 'self',
    school: MAGIC_SCHOOLS.ICE,
    description:
      'Получает Щит прочностью 25 + 100% магической атаки на 2 хода. При попадании по владельцу прямой атакой атакующий с вероятностью 35% получает Заморозку на 1 ход, иначе — Замедление на 2 хода.',
    descriptionParts: ['Получает ', { statusId: 'shield', text: 'Щит' }, ' прочностью 25 + 100% магической атаки на 2 хода. При попадании по владельцу прямой атакой атакующий с вероятностью 35% получает ', { statusId: 'freeze', text: 'Заморозку' }, ' на 1 ход, иначе — ', { statusId: 'speed_penalty_minor', text: 'Замедление' }, ' на 2 хода.'],
    apply: ({ attacker, log, session }) => {
      if (!attacker) return;
      const shieldValue = roundDamage(25 + (attacker.magAtk ?? attacker.attack ?? 0));
      addEffect(
        attacker,
        {
          id: 'shield',
          duration: 2,
          value: shieldValue,
          extra: {
            frostRetaliation: true,
            retaliationChance: 0.35,
            shardArmor: selectedTalent(attacker, 'mage.frost_shield') === 'mage.frost_shield.shard_armor',
            directShieldDamageMultiplier: selectedTalent(attacker, 'mage.frost_shield') === 'mage.frost_shield.dense_ice' ? 0.75 : 1,
          },
        },
        log,
        attacker,
        { session, forceIndependentInstance: true }
      );
    },
  },
  'Ледяной осколок': {
    name: 'Ледяной осколок',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 1.1),
    type: 'magical',
    school: MAGIC_SCHOOLS.ICE,
    description:
      'Острый ледяной удар по одной цели. Пытается наложить Заморозку; если цель устойчива к контролю, снижает её скорость.',
    apply: ({ attacker, target, hitTargets = [], log, session }) => {
      if (!attacker || !target || !hitTargets.includes(target)) return;
      const freezeId = effectId('Заморозка');
      const slowId = effectId('Замедление');
      const frozen = addEffect(target, { id: freezeId, duration: 1 }, log, attacker, { session });
      if (!frozen && slowId) {
        const slowed = addEffect(target, { id: slowId, duration: 2 }, log, attacker, { session });
        if (slowed && typeof log === 'function') {
          log(`${target.name || 'Цель'} устойчива к Заморозке, но её скорость снижена.`);
        }
      }
    },
  },
  'Пульс арканы': {
    name: 'Пульс арканы',
    cooldown: 4,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 1.3),
    type: 'magical',
    school: MAGIC_SCHOOLS.LIGHT,
    targeting: 'allEnemies',
    effect: {
      id: effectId('Слепота'),
      duration: 1,
      chance: 0.2,
      target: 'allEnemies',
    },
    description: 'Волна энергии поражает всех врагов и частично ослепляет их.',
  },
  'Призматический разлом': {
    name: 'Призматический разлом',
    scalingStat: 'magAtk',
    cooldown: 3,
    damage: ({ attacker }) =>
      roundDamage((attacker?.magAtk ?? 8) * 1.4),
    type: 'magical',
    school: MAGIC_SCHOOLS.DARKNESS,
    targeting: 'allEnemies',
    effect: {
      id: effectId('Замедление'),
      duration: 2,
      target: 'allEnemies',
    },
    description:
      'Кристаллический импульс поражает всех врагов и замедляет их, насыщая владельца силой искажений.',
    apply: ({ attacker, log, session }) => {
      if (!attacker) return;
      addEffect(
        attacker,
        { id: effectId('Оберег'), duration: 2 },
        log,
        attacker,
        { session }
      );
    },
  },
  'Сквозные раны': {
    name: 'Сквозные раны',
    passive: true,
    description: 'Когда прямая атака Лучника добивает врага, весь избыточный урон переносится на одного случайного живого врага.',
    descriptionParts: ['Когда прямая атака Лучника добивает врага, весь избыточный урон переносится на одного случайного живого врага.'],
  },
  'Заряд стихий': { name: 'Заряд стихий', passive: true, description: ELEMENTAL_CHARGE_DESCRIPTION, descriptionParts: ELEMENTAL_CHARGE_DESCRIPTION_PARTS },
  'Стихийный хаос': { name: 'Заряд стихий', passive: true, description: ELEMENTAL_CHARGE_DESCRIPTION, descriptionParts: ELEMENTAL_CHARGE_DESCRIPTION_PARTS },
  'Зазубренная стрела': {
    artId: 'serrated_arrow',
    name: 'Зазубренная стрела',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 1.3),
    type: 'physical',
    effect: { id: effectId('Кровотечение'), duration: 2 },
    apply: ({ attacker, target, hitTargets = [], session, log }) => {
      if (!target || !hitTargets.includes(target)) return;
      const talent = selectedTalent(attacker, 'archer.barbed_arrow');
      if (talent === 'archer.barbed_arrow.designate_prey') {
        addEffect(target, { id: 'hunting_mark', duration: 2 }, log, attacker, { session });
      } else if (talent === 'archer.barbed_arrow.binding_tip') {
        addEffect(target, { id: effectId('Замедление'), duration: 2 }, log, attacker, { session });
        reduceHostileTurnMeter(target, 150, { session, log });
      }
    },
    description: 'Наносит физический урон в размере 130% атаки и накладывает Кровотечение на 2 хода.',
    descriptionParts: ['Наносит физический урон в размере 130% атаки и накладывает ', { statusId: 'bleed', text: 'Кровотечение' }, ' на 2 хода.'],
  },
  'Огненная стрела': {
    artId: 'fire_arrow',
    name: 'Огненная стрела',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage(attacker?.attack ?? 8),
    type: 'physical',
    effect: ({ attacker }) => ({ id: 'burn', duration: 2, sourceScaling: attacker?.attack ?? 0 }),
    afterDirectDamage: ({ attacker, target, session, log, deliberateAction, hitResult, applyDamage }) => {
      if (!attacker || !target || !hitResult || target._lastBlockedHitAction === deliberateAction) return;
      const primaryRaw = Math.max(0, Number(hitResult.rawDamage) || 0);
      if (primaryRaw <= 0) return;
      const fireRaw = primaryRaw * 0.4;
      const hpBefore = Math.max(0, Number(target.hp) || 0);
      const shieldBefore = Math.max(0, Number(target.shield) || 0);
      if (typeof applyDamage !== 'function') return;
      const fireDamage = applyDamage(target, fireRaw, 'magical', {
        source: attacker,
        session,
        logFn: log,
        magicSchool: MAGIC_SCHOOLS.FIRE,
        directAttack: true,
        fromEffect: 'fire_arrow_component',
        sourceEffectId: 'fire_arrow_component',
        shieldBeforeDefense: true,
        isSecondaryDamage: true,
        suppressDamageReactions: true,
        skipFlameRuneTrigger: true,
        deliberateAction,
      });
      const fireAbsorbed = Math.max(0, Number(target.lastAbsorbed) || 0);
      hitResult.damage = Math.max(0, Number(hitResult.damage) || 0) + fireDamage;
      hitResult.actualHpLost = Math.max(0, Number(hitResult.actualHpLost) || 0) + Math.max(0, hpBefore - (target.hp || 0));
      hitResult.absorbed = Math.max(0, Number(hitResult.absorbed) || 0) + fireAbsorbed;
      hitResult.rawDamage = primaryRaw + fireRaw;
      hitResult.shieldDestroyed = Math.max(0, Number(hitResult.shieldDestroyed) || 0) + Math.max(0, shieldBefore - (target.shield || 0));
      target.lastAbsorbed = hitResult.absorbed;
    },
    secondary: {
      target: 'otherEnemies',
      type: 'magical',
      school: MAGIC_SCHOOLS.FIRE,
      condition: ({ attacker, primaryHit }) => (
        primaryHit
        && selectedTalent(attacker, 'archer.fire_arrow') === 'archer.fire_arrow.explosive_arrow'
      ),
      damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 0.6),
    },
    apply: ({ attacker, target, hitTargets = [], session, log }) => {
      if (!target || !hitTargets.includes(target)) return;
      if (selectedTalent(attacker, 'archer.fire_arrow') !== 'archer.fire_arrow.tar_arrow') return;
      addEffect(target, { id: effectId('Замедление'), duration: 2 }, log, attacker, { session });
      addEffect(target, { id: 'charring', duration: 3 }, log, attacker, { session });
    },
    description: 'Один выстрел наносит 100% атаки физическим уроном и ещё 40% атаки магическим уроном Огнём. Обе части используют один результат попадания и крита, но отдельно учитывают физическую и магическую защиту. Накладывает Горение на 2 хода; его снимок силы берётся от Атаки Лучника.',
    descriptionParts: ['Один выстрел наносит 100% атаки физическим уроном и ещё 40% атаки магическим уроном Огнём. Обе части используют один результат попадания и крита, но отдельно учитывают физическую и магическую защиту. Накладывает ', { statusId: 'burn', text: 'Горение' }, ' на 2 хода; его снимок силы берётся от Атаки Лучника.'],
  },
  'Добивающий выстрел': {
    artId: 'finishing_shot',
    name: 'Добивающий выстрел',
    cooldown: 3,
    damage: ({ attacker, target }) => {
      const baseDamage = roundDamage((attacker?.attack ?? 8) * 1.5);
      const maxHp = target?.maxHp ?? target?.hp ?? 0;
      const hpRatio = maxHp > 0 ? (target?.hp ?? 0) / maxHp : 1;
      return hpRatio <= 0.5 ? roundDamage(baseDamage * 2) : baseDamage;
    },
    piercingWoundsMultiplier: ({ attacker }) => (
      selectedTalent(attacker, 'archer.finishing_shot') === 'archer.finishing_shot.through_shot' ? 1.5 : 1
    ),
    apply: ({ attacker, target, hitTargets = [], session, log }) => {
      if (
        !attacker
        || !target
        || !hitTargets.includes(target)
        || target.hp > 0
        || selectedTalent(attacker, 'archer.finishing_shot') !== 'archer.finishing_shot.continue_hunt'
      ) return;
      const before = Math.max(0, Number(attacker.turnMeter) || 0);
      attacker.turnMeter = Math.min(1000, before + 300);
      const gained = Math.max(0, attacker.turnMeter - before);
      if (gained > 0) {
        session?.notifyPositiveTempoChange?.(attacker, gained, {
          source: attacker,
          reason: 'finishing_shot_continue_hunt',
          natural: false,
        });
        log?.(`🏹 Продолжение охоты заполняет шкалу хода на ${Math.round(gained / 10)}%.`);
      }
    },
    type: 'physical',
    description: 'Наносит физический урон в размере 150% атаки. Если у цели 50% здоровья или меньше, урон удваивается.',
    descriptionParts: ['Наносит физический урон в размере 150% атаки. Если у цели 50% здоровья или меньше, урон удваивается.'],
  },
  'Быстрый перехват': {
    artId: 'quick_intercept',
    name: 'Быстрый перехват',
    cooldown: 3,
    damage: ({ attacker, target }) => {
      const targetTurnMeter = Math.max(0, Number(target?.turnMeter) || 0);
      const multiplier = targetTurnMeter < 500 ? 1.5 : 1.2;
      return roundDamage((attacker?.attack ?? 8) * multiplier);
    },
    type: 'physical',
    description:
      'Наносит 120% атаки физическим уроном и всегда заполняет 25% шкалы следующего хода. Если до выстрела у цели меньше 50% шкалы хода, урон повышается до 150% атаки. Если у цели 50% шкалы или больше, вместо усиления урона Лучник крадёт 15% её шкалы.',
    descriptionParts: [
      'Наносит 120% атаки физическим уроном и всегда заполняет 25% шкалы следующего хода. Если до выстрела у цели меньше 50% шкалы хода, урон повышается до 150% атаки. Если у цели 50% шкалы или больше, вместо усиления урона Лучник крадёт 15% её шкалы.',
    ],
    turnMeterGain: ({ target }) => 250 + (Math.max(0, Number(target?.turnMeter) || 0) >= 500 ? 150 : 0),
    apply: ({ attacker, target, preHitTargetStates, session, log }) => {
      if (!attacker) return;
      const preHitState = (preHitTargetStates || []).find(entry => entry?.target === target);
      const targetTurnMeterBefore = Math.max(0, Number(preHitState?.turnMeter ?? target?.turnMeter) || 0);
      const actualTargetMeterBefore = Math.max(0, Number(target?.turnMeter) || 0);
      const talent = selectedTalent(attacker, 'archer.quick_intercept');
      let stolen = 0;
      if (target && targetTurnMeterBefore >= 500) {
        stolen = reduceHostileTurnMeter(target, 150, { session, log, source: attacker, reason: 'quick_intercept', suppressPresentation: true });
      }
      if (talent === 'archer.quick_intercept.seize_initiative' && target) {
        const extraReduction = preHitState?.hadHuntingMark ? 250 : 150;
        reduceHostileTurnMeter(target, extraReduction, { session, log, source: attacker, reason: 'quick_intercept_talent', suppressPresentation: true });
      }
      if (talent === 'archer.quick_intercept.light_step') {
        addEffect(attacker, { id: effectId('Уклонение'), duration: 2 }, log, attacker, { session });
      }
      const requestedGain = 250 + stolen;
      const before = Math.max(0, Number(attacker.turnMeter) || 0);
      attacker.turnMeter = Math.min(1000, before + requestedGain);
      const gained = Math.max(0, attacker.turnMeter - before);
      const reduced = target ? Math.max(0, actualTargetMeterBefore - Math.max(0, Number(target.turnMeter) || 0)) : 0;
      if (target && reduced > 0) {
        recordCombatPresentationEvent(session, {
          type: 'turnMeterChanged',
          actor: attacker,
          target,
          amount: reduced,
          delta: -reduced,
          before: actualTargetMeterBefore,
          after: target.turnMeter,
          changeKind: 'loss',
          reason: 'quick_intercept',
        });
      }
      if (gained > 0) {
        recordCombatPresentationEvent(session, {
          type: 'turnMeterChanged',
          actor: attacker,
          target: attacker,
          amount: gained,
          delta: gained,
          before,
          after: attacker.turnMeter,
          changeKind: 'gain',
          reason: 'quick_intercept',
        });
      }
      recordCombatPresentationEvent(session, {
        type: 'turnIntercept',
        actor: attacker,
        target: target || attacker,
        amount: reduced,
        stolen,
        gained,
        label: 'Перехват',
      });
      if (typeof log === 'function' && gained > 0) {
        const stolenText = stolen > 0 ? `, из них ${Math.round(stolen / 10)}% украдено у цели` : '';
        log(`🏹 ${attacker.name || 'Лучник'} перехватывает темп боя (+${Math.round(gained / 10)}% шкалы хода${stolenText}).`);
      }
    },
  },
  'Шквал стрел': {
    name: 'Шквал стрел',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 1.2),
    type: 'physical',
    targeting: 'allEnemies',
    description: 'Быстрый залп стрел по врагу.',
    apply: ({ attacker, log }) => {
      if (!attacker) return;
      addEffect(
        attacker,
        { id: effectId('Ускорение'), duration: 2 },
        log,
        attacker
      );
    },
  },
  'Ядовитая стрела': {
    name: 'Ядовитая стрела',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 2),
    type: 'physical',
    effect: { id: effectId('Отравление'), duration: 2 },
    description: 'Точный выстрел, отравляющий врага.',
  },
  'Разрывная тетива': {
    name: 'Разрывная тетива',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 1.8),
    type: 'physical',
    effect: { id: effectId('Разрушение защиты'), duration: 2 },
    description:
      'Мощный выстрел, пробивающий защиту цели. Если цель уже истекает кровью или отравлена, её ход откатывается.',
    apply: ({ target, log }) => {
      if (!target) return;
      const hasDot = Array.isArray(target.effects)
        && target.effects.some(eff => eff && ['poison', 'bleed', 'burn'].includes(eff.id));
      if (!hasDot) return;
      reduceHostileTurnMeter(target, TURN_METER_CHUNK);
      if (typeof log === 'function') {
        log(`🏹 ${target.name || 'Враг'} теряет часть инициативы из-за разрывной тетивы.`);
      }
    },
  },
  'Ловчая сеть': {
    name: 'Ловчая сеть',
    cooldown: 4,
    damage: 0,
    type: 'support',
    description:
      'Бросок сети ослепляет и замедляет цель, а лучник получает кратковременное уклонение.',
    apply: ({ attacker, target, log, session }) => {
      if (!target) return;
      const hasPoison = Array.isArray(target.effects)
        && target.effects.some(eff => eff && eff.id === 'poison');
      const duration = hasPoison ? 3 : 2;
      addEffect(
        target,
        { id: effectId('Слепота'), duration },
        log,
        attacker,
        { session }
      );
      addEffect(
        target,
        { id: effectId('Замедление'), duration },
        log,
        attacker,
        { session }
      );
      if (attacker) {
        addEffect(
          attacker,
          { id: effectId('Уклонение'), duration: 1 },
          log,
          attacker,
          { session }
        );
      }
    },
  },
  'Пронзающая шеренга': {
    name: 'Пронзающая шеренга',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 1.55),
    type: 'physical',
    effect: { id: effectId('Замедление'), duration: 2 },
    description: 'Резкий выпад по строю, замедляющий цель.',
    apply: ({ target }) => {
      if (!target) return;
      reduceHostileTurnMeter(target, TURN_METER_CHUNK);
    },
  },
  'Ядовитый инстинкт': {
    name: 'Ядовитый инстинкт',
    passive: true,
    description: 'Пассивно усиливает укусы по уже отравленным целям без создания нового вида Отравления.',
    modifyDamage: ({ damage, target, ability }) => {
      if (ability?.name !== 'Двойной укус') return damage;
      if (!hasEffect(target, effectId('Отравление'))) return damage;
      return roundDamage(damage * 1.1);
    },
  },
  'Змеиная увертка': { artId: 'serpent_evasion', enemyArtId: 'serpent_evasion',
    name: 'Змеиная увертка',
    cooldown: 3,
    damage: 0,
    type: 'support',
    targeting: 'self',
    description: 'Получает Уклонение на 1 ход.',
    descriptionParts: ['Получает ', { statusId: 'evasion', text: 'Уклонение' }, ' на 1 ход.'],
    apply: ({ attacker, session, log }) => {
      if (!attacker) return;
      addEffect(attacker, { id: effectId('Уклонение'), duration: 1 }, log, attacker, { session });
    },
  },
  'Шиповидная чешуя': {
    name: 'Шиповидная чешуя',
    passive: true,
    description: 'Пассивно отвечает на магический урон уязвимостью для врага.',
    onOwnerDamaged: ({ owner, attacker, damageType, context, log }) => {
      if (!owner || !attacker) return;
      if ((damageType || context?.damageType) !== 'magical') return;
      addEffect(
        attacker,
        { id: effectId('Магическая слабость'), duration: 2 },
        log,
        owner
      );
      const heal = Math.round((owner.maxHp ?? owner.hp ?? 0) * 0.1);
      if (heal > 0) {
        owner.hp = Math.min(owner.maxHp ?? owner.hp ?? heal, (owner.hp ?? 0) + heal);
        if (typeof log === 'function') {
          log(`🐍 ${owner.name || 'Шаман'} восстанавливает ${heal} здоровья от магических шипов.`);
        }
      }
    },
  },
  'Споровой щит': {
    name: 'Споровой щит',
    cooldown: 4,
    damage: 0,
    type: 'support',
    description: 'Создаёт небольшой Щит и короткую Регенерацию. Когда Щит разрушен ударами, выпускает ядовитые споры.',
    apply: ({ attacker, session, log }) => {
      if (!attacker) return;
      const shieldValue = roundDamage((attacker.maxHp ?? attacker.hp ?? 80) * 0.14);
      addEffect(
        attacker,
        {
          id: 'shield',
          duration: 2,
          value: shieldValue,
          metadata: { flavor: 'sporeShield' },
          onBreak: {
            effects: [{ id: effectId('Отравление'), duration: 1 }],
            target: 'enemies',
          },
        },
        log,
        attacker,
        { session }
      );
      addEffect(attacker, { id: effectId('Регенерация'), duration: 1 }, log, attacker, { session });
    },
  },
  'Грибной симбиоз': {
    name: 'Грибной симбиоз',
    passive: true,
    description: 'Пассивно дарует короткий случайный положительный эффект в начале хода.',
    onTurnStart: ({ owner, session, log }) => {
      if (!owner) return;
      const pool = [
        { id: effectId('Регенерация'), duration: 1 },
        { id: effectId('Ускорение'), duration: 1 },
        { id: effectId('Натиск'), duration: 1 },
      ];
      const chosen = pool[Math.floor(combatRandom(session) * pool.length)];
      if (!chosen) return;
      addEffect(owner, chosen, log, owner, { session });
    },
  },
  'Кровавый обряд': {
    name: 'Кровавый обряд',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 10) * 1.35),
    type: 'physical',
    effect: [
      { id: effectId('Кровотечение'), duration: 2 },
      { id: effectId('Уязвимость'), duration: 2, chance: 0.25 },
    ],
    description: 'Окропляет кинжалы кровью, ослабляя жертву и отбрасывая её ход.',
    apply: ({ target }) => {
      if (!target || target.turnMeter === undefined) return;
      reduceHostileTurnMeter(target, TURN_METER_CHUNK);
    },
  },
  'Ритуальная защита': {
    name: 'Ритуальная защита',
    passive: true,
    description: 'При низком здоровье возводит Щит и повышает Уклонение (срабатывает раз за бой).',
    onOwnerDamaged: ({ owner, log }) => {
      if (!owner || owner._ritualShieldUsed) return;
      const maxHp = owner.maxHp ?? owner.hp ?? 0;
      if (owner.hp <= maxHp * 0.5) {
        owner._ritualShieldUsed = true;
        addEffect(owner, { id: effectId('shield'), duration: 2, value: Math.round(maxHp * 0.3) }, log, owner);
        addEffect(owner, { id: effectId('Уклонение'), duration: 2 }, log, owner);
      }
    },
  },
  'Панцирный таран': {
    name: 'Панцирный таран',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 12) * 1.35),
    type: 'physical',
    effect: { id: effectId('Оглушение'), duration: 1, chance: 0.35 },
    description: 'Жук разгоняется, тараня цель и оглушая её.',
  },
  'Рваный наскок': { artId: 'rending_charge', enemyArtId: 'rending_charge',
    name: 'Рваный наскок',
    scalingStat: 'attack',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 10) * FUNGAL_ROSTER_TUNING.feralLungeDamageMultiplier),
    type: 'physical',
    description: 'Сильный физический наскок, после которого одичавший троглодит продвигает свою шкалу хода на 15%.',
    apply: ({ attacker }) => {
      if (!attacker) return;
      attacker.turnMeter = Math.min(1000, (attacker.turnMeter ?? 0) + FUNGAL_ROSTER_TUNING.feralLungeTurnMeter);
    },
  },
  'Стайный визг': { artId: 'pack_screech', enemyArtId: 'pack_screech',
    name: 'Стайный визг',
    cooldown: FUNGAL_ROSTER_TUNING.feralHowlCooldown,
    damage: 0,
    type: 'support',
    targeting: 'self',
    description: 'Продвигает шкалу хода всех других живых союзников на 20%.',
    apply: ({ attacker, session }) => {
      livingUnits(session?.state?.enemies || []).forEach(ally => {
        if (ally === attacker) return;
        ally.turnMeter = Math.min(1000, (ally.turnMeter ?? 0) + FUNGAL_ROSTER_TUNING.feralHowlTurnMeter);
      });
    },
  },
  'Костяной покров': { artId: 'bone_shroud', enemyArtId: 'bone_shroud',
    name: 'Костяной покров',
    cooldown: FUNGAL_ROSTER_TUNING.boneguardCoverCooldown,
    damage: 0,
    type: 'support',
    targeting: 'self',
    description: 'Накладывает Щит в размере 18% максимального здоровья на всех живых союзников, включая Костестража.',
    descriptionParts: ['Накладывает ', { statusId: 'shield', text: 'Щит' }, ' в размере 18% максимального здоровья на всех живых союзников, включая Костестража.'],
    apply: ({ attacker, session, log }) => {
      livingUnits(session?.state?.enemies || []).forEach(ally => {
        const shield = roundDamage((ally.maxHp ?? ally.hp ?? 0) * FUNGAL_ROSTER_TUNING.boneguardCoverShieldMaxHp);
        addEffect(ally, { id: 'shield', duration: 3, value: shield }, log, attacker, { session });
      });
    },
  },
  'Кара стража': { artId: 'guardian_retribution',
    name: 'Кара стража',
    passive: true,
    description: 'Один раз за действие игрока немедленно отвечает обычной атакой, когда игрок полностью разбивает Щит другого живого союзника.',
    descriptionParts: ['Один раз за действие игрока немедленно отвечает обычной атакой, когда игрок полностью разбивает ', { statusId: 'shield', text: 'Щит' }, ' другого живого союзника.'],
    onAllyShieldBreak: ({ owner, target, eligiblePlayerAction, actionToken, retaliate }) => {
      if (!owner || owner === target || owner.hp <= 0 || target?.hp <= 0 || !eligiblePlayerAction) return;
      if (owner._boneguardRetaliatedAction === actionToken) return;
      owner._boneguardRetaliatedAction = actionToken;
      retaliate?.(owner, FUNGAL_ROSTER_TUNING.boneguardRetaliationDamageMultiplier);
    },
  },
  'Последний хранитель': { artId: 'last_guardian',
    name: 'Последний хранитель',
    passive: true,
    description: 'Когда другой союзник погибает, получает Щит в размере 12% максимального здоровья и сокращает восстановление Костяного покрова на 1.',
    descriptionParts: ['Когда другой союзник погибает, получает ', { statusId: 'shield', text: 'Щит' }, ' в размере 12% максимального здоровья и сокращает восстановление Костяного покрова на 1.'],
    onAllyDeath: ({ owner, ally, session, log }) => {
      if (!owner || owner === ally || owner.hp <= 0) return;
      const shield = roundDamage((owner.maxHp ?? owner.hp ?? 0) * FUNGAL_ROSTER_TUNING.boneguardLastGuardianShieldMaxHp);
      addEffect(owner, { id: 'shield', duration: 3, value: shield }, log, owner, { session });
      const cover = owner.abilities?.find(ability => ability?.name === 'Костяной покров');
      if (cover) cover.currentCooldown = Math.max(0, (cover.currentCooldown ?? 0) - 1);
    },
  },
  'Команда жуков': {
    name: 'Команда жуков',
    cooldown: 2,
    damage: ({ attacker, session }) => {
      const bugCount = livingMushroomMeatBugs(session).length;
      return roundDamage((attacker?.attack ?? 12) * (1 + bugCount * 0.25));
    },
    type: 'physical',
    description: 'Удар жукопаса. Урон выше за каждого живого Мясистого жука; живые жуки также слегка лечат стаю.',
    apply: ({ attacker, session, log }) => {
      if (!attacker) return;
      const bugs = livingMushroomMeatBugs(session);
      if (bugs.length === 0) return;
      const heal = roundDamage((attacker.maxHp ?? attacker.hp ?? 0) * 0.03 * bugs.length);
      livingUnits(session?.state?.enemies || []).forEach(ally => {
        ally.hp = Math.min(ally.maxHp ?? ally.hp ?? heal, (ally.hp ?? 0) + heal);
      });
      if (typeof log === 'function') log(`🪲 ${attacker.name} направляет жуков и лечит стаю на ${heal} HP.`);
    },
  },
  'Хитиновая настойчивость': {
    name: 'Хитиновая настойчивость',
    passive: true,
    description: 'Каждый удар усиливает хитиновую броню жука.',
    onOwnerDamaged: ({ owner, log }) => {
      if (!owner) return;
      addEffect(owner, { id: effectId('Укрепление'), duration: 2 }, log, owner);
    },
  },
  'Змеиная ловкость': {
    name: 'Змеиная ловкость',
    passive: true,
    description: 'В начале боя получает Уклонение.',
    onBattleStart: ({ owner, session, log }) => {
      if (!owner) return;
      addEffect(owner, { id: effectId('Уклонение'), duration: 2 }, log, owner, { session });
    },
  },
  'Сжатие мицелия': { artId: 'mycelium_constriction',
    name: 'Сжатие мицелия',
    passive: true,
    description: 'На половине здоровья Мицелий прекращает восстановление, получает Ускорение и Магическую мощь и переходит к агрессии.',
    descriptionParts: ['На половине здоровья Мицелий прекращает восстановление, получает ', { statusId: 'speed_boost_minor', text: 'Ускорение' }, ' и ', { statusId: 'magic_attack_boost_minor', text: 'Магическую мощь' }, ' и переходит к агрессии.'],
    onTurnStart: ({ owner, session, log }) => {
      if (!owner || owner._myceliumPhaseTwoTriggered) return;
      const maxHp = owner.maxHp ?? owner.hp ?? 0;
      if (maxHp <= 0 || (owner.hp ?? 0) > maxHp * 0.5) return;
      owner._myceliumPhaseTwoTriggered = true;
      owner._myceliumPhase = 2;
      if (Array.isArray(owner.effects)) {
        owner.effects = owner.effects.filter(effect => effect?.id !== effectId('Регенерация'));
      }
      addEffect(owner, { id: effectId('Ускорение'), duration: 3 }, log, owner, { session });
      addEffect(owner, { id: effectId('Магическая мощь'), duration: 3 }, log, owner, { session });
      if (typeof log === 'function') {
        log('🍄 Мицелий перестаёт восстанавливаться — сеть сжимается вокруг вас.');
      }
    },
  },
  'Мицелиевое восстановление': {
    name: 'Мицелиевое восстановление',
    passive: true,
    description: 'Когда здоровье проседает, поддерживает босса короткой Регенерацией без накопления стаков и редкими усилениями.',
    onTurnStart: ({ owner, session, log }) => {
      if (!owner || owner._myceliumPhaseTwoTriggered || owner._myceliumPhase >= 2) return;
      const maxHp = owner.maxHp ?? owner.hp ?? 0;
      const shouldRecover = maxHp > 0 && owner.hp <= maxHp * 0.65;
      const existingRegen = (owner.effects || []).find(effect => effect?.id === effectId('Регенерация'));
      if (shouldRecover && existingRegen) {
        existingRegen.remainingTurns = Math.max(existingRegen.remainingTurns ?? 0, 1);
        existingRegen.durationTotal = Math.max(existingRegen.durationTotal ?? 0, existingRegen.remainingTurns);
        existingRegen.duration = Math.max(existingRegen.duration ?? 0, existingRegen.remainingTurns);
      } else if (shouldRecover) {
        addEffect(owner, { id: effectId('Регенерация'), duration: 1 }, log, owner, { session });
      }
      if (combatRandom(session) < 0.35) {
        addEffect(owner, { id: effectId('Укрепление'), duration: 1 }, log, owner, { session });
      }
    },
  },
  'Господство спор': {
    name: 'Господство спор',
    passive: true,
    description: 'Пассивно снимает положительные эффекты с врагов и превращает их в случайные штрафы.',
    onTurnStart: ({ owner, session, log }) => {
      if (!owner || !session?.state) return;
      const enemies = session.state.players || [];
      enemies.forEach(unit => {
        if (!unit?.effects || unit.effects.length === 0) return;
        const buff = unit.effects.find(eff =>
          getEffectDefinition(eff?.id)?.type === 'buff' && isEffectTransferable(eff)
        );
        if (buff && cleanseEffects(unit, eff => eff === buff, log, { session, actor: owner }) > 0) {
          if (typeof log === 'function') {
            log(`🍄 ${unit.name || 'Цель'} теряет положительный эффект под действием спор.`);
          }
          const debuffPool = [
            { id: effectId('Слепота'), duration: 1 },
            { id: effectId('Замедление'), duration: 1 },
            { id: effectId('Отравление'), duration: 2 },
          ];
          const debuff = debuffPool[Math.floor(combatRandom(session) * debuffPool.length)];
          if (debuff) {
            addEffect(unit, debuff, log, owner, { session });
          }
        }
      });
    },
  },
  'Точный выстрел': {
    name: 'Точный выстрел',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 1.8),
    type: 'physical',
    description: 'Прицельный выстрел, пробивающий броню противника.',
  },
  'Проклятая метка': {
    name: 'Проклятая метка',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 1.15),
    type: 'magical',
    school: MAGIC_SCHOOLS.BLOOD,
    effect: { id: effectId('Уязвимость'), duration: 2 },
    description: 'Слабая проклятая метка: наносит магический урон и делает цель уязвимой.',
  },
  'Короткая уловка': {
    name: 'Короткая уловка',
    passive: true,
    description: 'Пассивно: в начале боя получает Уклонение на 1 ход вместо долгой защитной стойки.',
    onBattleStart: ({ owner, session, log }) => {
      if (!owner) return;
      addEffect(owner, { id: effectId('Уклонение'), duration: 1 }, log, owner, { session });
    },
  },
  'Дуэльный финт': {
    name: 'Дуэльный финт',
    cooldown: 3,
    damage: 0,
    type: 'support',
    description: 'Короткий финт: получает Уклонение на 1 ход без долгой оборонительной стойки.',
    apply: ({ attacker, log, session }) => {
      if (!attacker) return;
      addEffect(attacker, { id: effectId('Уклонение'), duration: 1 }, log, attacker, { session });
    },
  },
  'Короткий контрудар': {
    name: 'Короткая контратака',
    cooldown: 3,
    damage: 0,
    type: 'support',
    description: 'Готовит одну короткую Контратаку без длительного защитного положительного эффекта.',
    apply: ({ attacker, log, session }) => {
      if (!attacker) return;
      addEffect(attacker, { id: 'iron_counter', duration: 1 }, log, attacker, { session });
    },
  },
  'Метка следопыта': {
    name: 'Метка следопыта',
    cooldown: 2,
    damage: ({ attacker, target }) => roundDamage((attacker?.attack ?? 8) * (hasBleed(target) ? 1.35 : 1.15)),
    type: 'physical',
    effect: [
      { id: effectId('Кровотечение'), duration: 1, chance: 0.75 },
      { id: effectId('Замедление'), duration: 1 },
    ],
    description: 'Следопыт отмечает цель, с шансом вызывает короткое Кровотечение и слегка замедляет её. По кровоточащим целям удар сильнее.',
  },
  'Силки следопыта': {
    name: 'Силки следопыта',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 0.75),
    type: 'physical',
    effect: { id: effectId('Замедление'), duration: 1 },
    description: 'Грязная ловушка следопыта: слегка ранит, замедляет и снижает прогресс хода.',
    apply: ({ target, log }) => {
      if (!target) return;
      const loss = Math.round(TURN_METER_CHUNK * 0.7);
      reduceHostileTurnMeter(target, loss);
      if (typeof log === 'function') log(`🪤 ${target.name || 'Цель'} запутывается в силках и теряет темп.`);
    },
  },
  'Выстрел по открытой цели': {
    name: 'Выстрел по открытой цели',
    cooldown: 2,
    damage: ({ attacker, target }) => roundDamage((attacker?.attack ?? 8) * (hasAnyDebuff(target) ? 1.45 : 1.05)),
    type: 'physical',
    effect: { id: effectId('Уязвимость'), duration: 1, chance: 0.5 },
    description: 'Грязный выстрел по подготовленной цели. Сильнее по целям со штрафами и может оставить короткую Уязвимость.',
  },
  'Полевая перевязка': {
    name: 'Полевая перевязка',
    cooldown: 3,
    damage: 0,
    type: 'support',
    description: 'Лечит нуждающегося союзника, даёт короткую Регенерацию и снимает один негативный эффект.',
    targeting: 'ally',
    canUse: ({ candidateTargets = [] }) => candidateTargets.some(unit => (
      missingHp(unit) >= Math.max(1, roundDamage((unit.maxHp ?? 0) * 0.05)) || hasRemovableDebuff(unit)
    )),
    targetScore: ({ target }) => healingTargetScore(target, 0.14, hasRemovableDebuff(target) ? 25 : 0),
    aiScore: ({ target }) => hasRemovableDebuff(target) ? 3 : 1,
    apply: ({ attacker, target, session, log }) => {
      if (!attacker || !target) return;
      const recipient = target;
      const maxHp = recipient.maxHp ?? recipient.hp ?? 0;
      const amount = roundDamage(maxHp * 0.14);
      const beforeHp = recipient.hp ?? 0;
      recipient.hp = Math.min(maxHp, beforeHp + amount);
      const restored = Math.max(0, (recipient.hp ?? 0) - beforeHp);
      addEffect(recipient, { id: effectId('Регенерация'), duration: 1 }, log, attacker, { session });
      let cleansed = 0;
      cleanseEffects(recipient, effect => {
        const shouldCleanse = cleansed < 1 && (effect?.type === 'debuff' || effect?.kind === 'debuff');
        if (shouldCleanse) cleansed += 1;
        return shouldCleanse;
      }, log);
      if (typeof log === 'function') log(`🧪 ${attacker.name || 'Аптекарь'} перевязывает ${recipient.name || 'союзника'} на ${restored} HP.`);
    },
  },
  'Сбивающий порыв': {
    name: 'Сбивающий порыв',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 10) * 0.85),
    type: 'magical',
    school: MAGIC_SCHOOLS.LIGHTNING,
    targeting: 'allEnemies',
    effect: { id: effectId('Замедление'), duration: 1 },
    description: 'Порыв ветра ранит группу и снижает скорость.',
  },
  'Алебардный нажим': {
    name: 'Алебардный нажим',
    cooldown: 2,
    damage: ({ attacker, target }) => {
      const vulnerable = hasEffect(target, effectId('Уязвимость')) || hasEffect(target, effectId('Ослабление защиты'));
      return roundDamage((attacker?.attack ?? 10) * (vulnerable ? 1.55 : 1.25));
    },
    type: 'physical',
    effect: { id: effectId('Ослабление защиты'), duration: 2 },
    description: 'Дисциплинированный нажим алебардой. Наносит больше урона уязвимым целям и снижает защиту.',
  },
  'Напор алебардой': {
    name: 'Напор алебардой',
    cooldown: 2,
    damage: ({ attacker, target }) => roundDamage((attacker?.attack ?? 10) * (hasAnyDebuff(target) ? 1.65 : 1.25)),
    type: 'physical',
    description: 'Мастер алебарды давит строй. Сильнее бьёт по целям со штрафами, продлевает простые штрафы и снижает защиту.',
    apply: ({ target, attacker, log, session }) => {
      if (!target) return;
      const captured = (target.effects || [])
        .filter(isExtendableDebuff)
        .map(effect => ({
          effect,
          turns: Number.isFinite(effect.remainingTurns) ? effect.remainingTurns : effect.duration,
        }));
      const extended = extendExistingDebuffs(target, captured);
      if (extended > 0 && typeof log === 'function') {
        log(`🔱 ${target.name || 'Цель'} дольше остаётся под давлением алебарды.`);
      }
      addEffect(target, { id: effectId('Ослабление защиты'), duration: 1 }, log, attacker, { session });
    },
  },
  'Контратака': {
    name: 'Контратака',
    cooldown: 3,
    damage: 0,
    type: 'support',
    description: 'Готовит Контратаку. Если ответный удар попадёт, атакующий получает Ослабление.',
    apply: ({ attacker, log, session }) => {
      if (!attacker) return;
      addEffect(
        attacker,
        {
          id: 'iron_counter',
          duration: 1,
          extra: { counterEffect: { id: effectId('Ослабление'), duration: 1 } },
        },
        log,
        attacker,
        { session }
      );
    },
  },
  'Рассечение защиты': {
    name: 'Рассечение защиты',
    cooldown: 2,
    damage: ({ attacker, target }) => {
      const shielded = (target?.shield ?? 0) > 0 || (target?.effects || []).some(effect => effect?.id === 'shield');
      const defended = (target?.effects || []).some(effect => effect?.id === effectId('Мощное укрепление') || effect?.id === effectId('Укрепление'));
      return roundDamage((attacker?.attack ?? 14) * (shielded || defended ? 1.55 : 1.25));
    },
    type: 'physical',
    effect: { id: 'armor_sunder', duration: 2 },
    description: 'Пробивающий выпад: ранит цель и оставляет Раскол брони без нового статуса.',
  },
  'Дуэльная стойка': {
    name: 'Дуэльная стойка',
    cooldown: 4,
    damage: 0,
    type: 'support',
    description: 'Босс принимает стойку: получает Уклонение, малое усиление атаки и готовит Железный контрудар.',
    apply: ({ attacker, log, session }) => {
      if (!attacker) return;
      addEffect(attacker, { id: effectId('Уклонение'), duration: 1 }, log, attacker, { session });
      addEffect(attacker, { id: effectId('Натиск'), duration: 2 }, log, attacker, { session });
      addEffect(attacker, { id: 'iron_counter', duration: 1 }, log, attacker, { session });
    },
  },
  'Чумной укус': { artId: 'plague_bite', enemyArtId: 'plague_bite',
    name: 'Чумной укус',
    scalingStat: 'attack',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 6) * 1),
    type: 'physical',
    effect: { id: effectId('Отравление'), duration: 1 },
    description: 'Наносит 100% атаки физическим уроном и накладывает Отравление.',
    descriptionParts: ['Наносит 100% атаки физическим уроном и накладывает ', { statusId: 'poison', text: 'Отравление' }, '.'],
  },
  'Поджог': {
    name: 'Поджог',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 6) * 1.1),
    type: 'magical',
    school: MAGIC_SCHOOLS.FIRE,
    effect: { id: effectId('Горение') },
    description: 'Накладывает на врага горение, наносящее урон со временем.',
  },
  'Кровоточащий удар': {
    name: 'Кровоточащий удар',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 7) * 1.4),
    type: 'physical',
    effect: { id: effectId('Кровотечение'), duration: 1 },
    description: 'Резкий удар, вызывающий короткое кровотечение.',
  },
  'Кровавое касание': {
    name: 'Кровавое касание',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 8) * 1.2),
    type: 'magical',
    school: MAGIC_SCHOOLS.BLOOD,
    effect: { id: effectId('Метка вампира') },
    description: 'Наносит магический урон Кровью в размере 120% магической атаки и накладывает Метку вампира на 3 хода.',
    descriptionParts: ['Наносит магический урон Кровью в размере 120% магической атаки и накладывает ', { statusId: 'vampire_mark', text: 'Метку вампира' }, ' на 3 хода.'],
  },
  'Казнящий удар': {
    name: 'Казнящий удар',
    scalingStat: 'attack',
    artId: 'execution_strike',
    enemyArtId: 'execution_strike',
    cooldown: 3,
    damage: ({ attacker, target }) => {
      const maxHp = target?.maxHp ?? target?.hp ?? 0;
      const condemned = hasEffect(target, effectId('Уязвимость')) || (target?.hp ?? 0) < maxHp * 0.5;
      return roundDamage((attacker?.attack ?? 10) * (condemned ? 1.85 : 1.3));
    },
    type: 'physical',
    targetScore: ({ target }) => (
      hasEffect(target, effectId('Уязвимость')) || (target?.hp ?? 0) < (target?.maxHp ?? target?.hp ?? 0) * 0.5 ? 1 : 0
    ),
    aiScore: ({ target }) => (
      hasEffect(target, effectId('Уязвимость')) || (target?.hp ?? 0) < (target?.maxHp ?? target?.hp ?? 0) * 0.5 ? 3 : 1
    ),
    description: 'Наносит физический урон в размере 130% атаки. Если цель находится под Уязвимостью или имеет менее 50% здоровья, урон увеличивается до 185% атаки. Если выполнены оба условия, дополнительного усиления нет.',
    descriptionParts: ['Наносит физический урон в размере 130% атаки. Если цель находится под ', { statusId: 'vulnerability', text: 'Уязвимостью' }, ' или имеет менее 50% здоровья, урон увеличивается до 185% атаки. Если выполнены оба условия, дополнительного усиления нет.'],
  },
  'Приговор палача': {
    name: 'Приговор палача',
    artId: 'execution_sentence',
    enemyArtId: 'execution_sentence',
    cooldown: 3,
    damage: 0,
    type: 'support',
    effect: { id: effectId('Уязвимость'), duration: 2 },
    targetScore: ({ target }) => hasEffect(target, effectId('Уязвимость')) ? 0 : 1,
    aiScore: ({ target }) => (
      !hasEffect(target, effectId('Уязвимость')) && (target?.hp ?? 0) >= (target?.maxHp ?? target?.hp ?? 0) * 0.5 ? 2 : 0
    ),
    description: 'Накладывает Уязвимость на 2 хода.',
    descriptionParts: ['Накладывает ', { statusId: 'vulnerability', text: 'Уязвимость' }, ' на 2 хода.'],
  },
  'Мясной вихрь': {
    name: 'Мясной вихрь',
    scalingStat: 'attack',
    artId: 'meat_whirlwind',
    enemyArtId: 'meat_whirlwind',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 10) * 1.5),
    type: 'physical',
    targeting: 'allEnemies',
    effect: { id: effectId('Кровотечение'), duration: 2, chance: 0.5 },
    description: 'Наносит всем противникам физический урон в размере 150% атаки. С вероятностью 50% накладывает Кровотечение на 2 хода.',
    descriptionParts: ['Наносит всем противникам физический урон в размере 150% атаки. С вероятностью 50% накладывает ', { statusId: 'bleed', text: 'Кровотечение' }, ' на 2 хода.'],
  },
  'Запутывающая сеть': {
    name: 'Запутывающая сеть',
    artId: 'entangling_net',
    enemyArtId: 'entangling_net',
    cooldown: 3,
    damage: 0,
    type: 'physical',
    effect: { id: effectId('Замедление'), duration: 2 },
    description: 'Не наносит урон. Накладывает Замедление на 2 хода.',
    descriptionParts: ['Не наносит урон. Накладывает ', { statusId: 'speed_penalty_minor', text: 'Замедление' }, ' на 2 хода.'],
  },
  'Конус льда': {
    name: 'Конус льда',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 6) * 1.4),
    type: 'magical',
    school: MAGIC_SCHOOLS.ICE,
    effect: { id: effectId('Сильное замедление') },
    description: 'Наносит магический урон Льдом в размере 140% магической атаки и накладывает Сильное замедление на 3 хода.',
    descriptionParts: ['Наносит магический урон Льдом в размере 140% магической атаки и накладывает ', { statusId: 'speed_penalty_major', text: 'Сильное замедление' }, ' на 3 хода.'],
  },
  'Крысиный зов': {
    name: 'Крысиный зов',
    artId: 'rat_call',
    enemyArtId: 'rat_call',
    cooldown: 3,
    damage: 0,
    type: 'support',
    description: 'Призывает одну Чумную крысу, если в строю есть свободное место.',
    apply: ({ attacker, log, session }) => {
      if (session?.summonEnemy) {
        const result = session.summonEnemy('Чумная крыса', { source: attacker });
        if (result?.success && result.enemy) {
          if (typeof log === 'function') {
            log(`🐀 ${attacker?.name || 'Заклинатель'} призывает ${result.enemy.name}.`);
          }
        } else if (result?.reason === 'no_slot') {
          if (typeof log === 'function') {
            log(`⚠️ ${attacker?.name || 'Заклинатель'} не может призвать крыс — нет свободного места.`);
          }
        }
      }
    },
  },
  'Крысиные бега': {
    name: 'Крысиные бега',
    artId: 'rat_race',
    enemyArtId: 'rat_race',
    cooldown: 4,
    damage: 0,
    type: 'support',
    targeting: 'self',
    aiScore: ({ attacker, allies = [] }) => {
      const ratCount = countLivingRatPackUnits(allies);
      const ratCallReady = (attacker?.abilities || []).some(ability =>
        ability?.name === 'Крысиный зов' && (ability.currentCooldown ?? 0) <= 0
      );
      const hasFreeSlot = allies.filter(unit => unit?.hp > 0).length < 6;
      if (ratCount <= 1 && ratCallReady && hasFreeSlot) return -1;
      return Math.max(1, ratCount);
    },
    description: 'Продвигает шкалу хода всех живых союзников на 10% за каждого живого Крысоманта, Чумную крысу, Крысиного матриарха и Крысиного всадника.',
    apply: ({ attacker, log, session }) => {
      const allies = (session?.state?.enemies || []).filter(unit => unit?.hp > 0);
      const ratCount = countLivingRatPackUnits(allies);
      if (ratCount <= 0) return;
      const turnMeterGain = ratCount * 100;
      allies.forEach(ally => {
        ally.turnMeter = Math.min(1000, (ally.turnMeter ?? 0) + turnMeterGain);
      });
      log?.(`🐀 ${attacker?.name || 'Крысомант'} устраивает крысиные бега: +${ratCount * 10}% шкалу хода всей команде.`);
    },
  },
  'Грязный укус': {
    name: 'Грязный укус',
    scalingStat: 'attack',
    artId: 'dirty_bite',
    enemyArtId: 'dirty_bite',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 7) * 1),
    type: 'physical',
    effect: { id: effectId('Кровотечение'), duration: 1, chance: 0.4 },
    description: 'Наносит физический урон в размере 100% атаки. С вероятностью 40% накладывает Кровотечение на 1 ход.',
    descriptionParts: ['Наносит физический урон в размере 100% атаки. С вероятностью 40% накладывает ', { statusId: 'bleed', text: 'Кровотечение' }, ' на 1 ход.'],
  },
  'Грызущая пасть': {
    name: 'Грызущая пасть',
    scalingStat: 'attack',
    artId: 'gnawing_maw',
    enemyArtId: 'gnawing_maw',
    cooldown: 2,
    damage: ({ attacker, target }) => {
      const multiplier = hasBleed(target) ? 1.25 : 1;
      return roundDamage((attacker?.attack ?? 10) * 1.15 * multiplier);
    },
    type: 'physical',
    description: 'Наносит физический урон в размере 115% атаки. По цели под Кровотечением — 144% атаки.',
    descriptionParts: ['Наносит физический урон в размере 115% атаки. По цели под ', { statusId: 'bleed', text: 'Кровотечением' }, ' — 144% атаки.'],
  },
  'Зов помёта': {
    name: 'Зов помёта',
    artId: 'litter_call',
    passive: true,
    description: 'За каждые 30% максимального здоровья, потерянные от урона за бой, призывает Чумную крысу, если для неё есть место. Лечение не уменьшает накопленный урон. Одновременно может существовать не более 2 Чумных крыс.',
    onBattleStart: ({ owner }) => {
      if (owner && !Number.isFinite(owner._litterCallDamageProgress)) {
        owner._litterCallDamageProgress = 0;
      }
    },
    onOwnerDamaged: ({ owner, damage, session, log, context }) => {
      if (!owner) return;
      const maxHp = owner.maxHp ?? owner.hp ?? 0;
      const threshold = maxHp * 0.3;
      const actualHpLost = Math.max(0, context?.actualHpLost ?? damage ?? 0);
      if (threshold <= 0 || actualHpLost <= 0) return;
      owner._litterCallDamageProgress = Math.max(0, owner._litterCallDamageProgress ?? 0) + actualHpLost;
      while (owner._litterCallDamageProgress >= threshold) {
        owner._litterCallDamageProgress -= threshold;
        if (livingPlagueRats(session).length >= 2) continue;
        const result = session?.summonEnemy?.('Чумная крыса', { source: owner });
        if (result?.success && typeof log === 'function') {
          log(`🐀 ${owner.name} зовёт новый помёт.`);
        }
      }
    },
  },
  'Кормление стаи': {
    name: 'Кормление стаи',
    artId: 'feed_the_pack',
    enemyArtId: 'feed_the_pack',
    cooldown: 5,
    damage: 0,
    type: 'support',
    description: 'Восстанавливает 5% максимального здоровья за каждую живую Чумную крысу. Нельзя использовать, если живых Чумных крыс нет.',
    canUse: ({ session }) => livingPlagueRats(session).length > 0,
    apply: ({ attacker, session, log }) => {
      if (!attacker) return;
      const rats = livingPlagueRats(session);
      const maxHp = attacker.maxHp ?? attacker.hp ?? 0;
      if (rats.length === 0) return;
      const heal = roundDamage(maxHp * 0.05 * rats.length);
      attacker.hp = Math.min(maxHp, (attacker.hp ?? maxHp) + heal);
      if (typeof log === 'function') log(`💚 ${attacker.name} кормит стаю и восстанавливает ${heal} HP.`);
    },
  },
  'Зазубренная пика': {
    name: 'Зазубренная пика',
    scalingStat: 'attack',
    artId: 'serrated_pike',
    enemyArtId: 'serrated_pike',
    cooldown: 3,
    damage: ({ attacker, target }) => roundDamage((attacker?.attack ?? 10) * 1.25 * (hasBleed(target) ? 1.25 : 1)),
    type: 'physical',
    description: 'Наносит физический урон в размере 125% атаки. По цели под Кровотечением — 156% атаки. Накладывает Кровотечение на 1 ход или продлевает уже действующее на 1 ход.',
    descriptionParts: ['Наносит физический урон в размере 125% атаки. По цели под ', { statusId: 'bleed', text: 'Кровотечением' }, ' — 156% атаки. Накладывает ', { statusId: 'bleed', text: 'Кровотечение' }, ' на 1 ход или продлевает уже действующее на 1 ход.'],
    apply: ({ attacker, target, session, log }) => {
      if (!target) return;
      if (!extendEffectDuration(target, effectId('Кровотечение'), 1)) {
        addEffect(target, { id: effectId('Кровотечение'), duration: 1 }, log, attacker, { session });
      }
    },
  },
  'Прорыв по норе': {
    name: 'Прорыв по норе',
    scalingStat: 'attack',
    artId: 'burrow_charge',
    enemyArtId: 'burrow_charge',
    cooldown: 4,
    damage: ({ attacker, target }) => roundDamage((attacker?.attack ?? 10) * 1.4 * (hasBleed(target) ? 1.25 : 1)),
    type: 'physical',
    description: 'Наносит физический урон в размере 140% атаки. По цели под Кровотечением — 175% атаки. Если у цели менее 50% здоровья, заполняет 50% шкалы следующего хода.',
    descriptionParts: ['Наносит физический урон в размере 140% атаки. По цели под ', { statusId: 'bleed', text: 'Кровотечением' }, ' — 175% атаки. Если у цели менее 50% здоровья, заполняет 50% шкалы следующего хода.'],
    apply: ({ attacker, target, log }) => {
      if (!attacker || !target) return;
      const maxHp = target.maxHp ?? target.hp ?? 0;
      if ((target.hp ?? 0) < maxHp * 0.5) {
        attacker.turnMeter = Math.min(1000, (attacker.turnMeter ?? 0) + 500);
        if (typeof log === 'function') log(`⏩ ${attacker.name} прорывается по норе и ускоряет следующий ход.`);
      }
    },
  },
  'Тлеющий бросок': {
    name: 'Тлеющий бросок',
    scalingStat: 'magAtk',
    artId: 'smoldering_throw',
    enemyArtId: 'smoldering_throw',
    cooldown: 2,
    damage: ({ attacker, target }) => roundDamage((attacker?.magAtk ?? 9) * (hasBurn(target) ? 1.15 : 1)),
    type: 'magical',
    school: MAGIC_SCHOOLS.FIRE,
    effect: { id: effectId('Горение'), duration: 1, chance: 0.35 },
    description: 'Наносит магический урон Огнём в размере 100% магической атаки. По цели под Горением — 115% магической атаки. С вероятностью 35% накладывает Горение на 1 ход.',
    descriptionParts: ['Наносит магический урон Огнём в размере 100% магической атаки. По цели под ', { statusId: 'burn', text: 'Горением' }, ' — 115% магической атаки. С вероятностью 35% накладывает ', { statusId: 'burn', text: 'Горение' }, ' на 1 ход.'],
  },
  'Смоляная тряпка': {
    name: 'Смоляная тряпка',
    scalingStat: 'magAtk',
    artId: 'tar_cloth',
    enemyArtId: 'tar_cloth',
    cooldown: 3,
    damage: ({ attacker, target }) => roundDamage((attacker?.magAtk ?? 9) * (hasBurn(target) ? 0.75 : 0.45)),
    type: 'magical',
    school: MAGIC_SCHOOLS.FIRE,
    description: 'Наносит магический урон Огнём в размере 45% магической атаки и накладывает Горение на 2 хода. Если цель уже под Горением, урон увеличивается до 75% магической атаки, а эффект продлевается на 1 ход.',
    descriptionParts: ['Наносит магический урон Огнём в размере 45% магической атаки и накладывает ', { statusId: 'burn', text: 'Горение' }, ' на 2 хода. Если цель уже под ', { statusId: 'burn', text: 'Горением' }, ', урон увеличивается до 75% магической атаки, а эффект продлевается на 1 ход.'],
    apply: ({ attacker, target, session, log }) => {
      if (!target) return;
      if (!extendEffectDuration(target, effectId('Горение'), 1)) {
        addEffect(target, { id: effectId('Горение'), duration: 2 }, log, attacker, { session });
      }
    },
  },
  'Кормление костра': {
    name: 'Кормление костра',
    artId: 'feed_the_fire',
    enemyArtId: 'feed_the_fire',
    cooldown: 4,
    damage: 0,
    type: 'support',
    description: 'Если хотя бы один противник под Горением, накладывает на всех живых гоблинов Натиск на 2 хода. Иначе накладывает Горение на случайного противника на 1 ход.',
    descriptionParts: ['Если хотя бы один противник под ', { statusId: 'burn', text: 'Горением' }, ', накладывает на всех живых гоблинов ', { statusId: 'attack_boost_minor', text: 'Натиск' }, ' на 2 хода. Иначе накладывает ', { statusId: 'burn', text: 'Горение' }, ' на случайного противника на 1 ход.'],
    apply: ({ attacker, session, log }) => {
      const targets = livingUnits(session?.state?.players || []);
      const burningTarget = targets.find(hasBurn);
      if (burningTarget) {
        livingUnits(session?.state?.enemies || [])
          .filter(ally => (ally.name || '').toLowerCase().includes('гоблин'))
          .forEach(ally => addEffect(ally, { id: effectId('Натиск'), duration: 2 }, log, attacker, { session }));
        return;
      }
      const target = targets[Math.floor(combatRandom(session) * targets.length)];
      if (target) addEffect(target, { id: effectId('Горение'), duration: 1 }, log, attacker, { session });
    },
  },
  'Кристаллический надлом': {
    name: 'Кристаллический надлом',
    artId: 'crystalline_fracture',
    passive: true,
    description: 'Если прямой удар снимает более 20% максимального здоровья, получает Щит в размере 12% максимального здоровья на 2 хода. Срабатывает не чаще одного раза за ход.',
    descriptionParts: ['Если прямой удар снимает более 20% максимального здоровья, получает ', { statusId: 'shield', text: 'Щит' }, ' в размере 12% максимального здоровья на 2 хода. Срабатывает не чаще одного раза за ход.'],
    onTurnStart: ({ owner }) => {
      if (owner) owner._crystalBreakShieldTriggered = false;
    },
    onOwnerDamaged: ({ owner, damage, context, log, session }) => {
      if (!owner || owner._crystalBreakShieldTriggered || !isCleanDirectDamage(context)) return;
      const maxHp = owner.maxHp ?? owner.hp ?? 0;
      if (damage <= maxHp * 0.2) return;
      owner._crystalBreakShieldTriggered = true;
      addEffect(owner, { id: 'shield', duration: 2, value: roundDamage(maxHp * 0.12) }, log, owner, { session });
    },
  },
  'Кристаллический срыв': {
    name: 'Кристаллический срыв',
    artId: 'crystalline_breakaway',
    passive: true,
    description: 'Когда прямой удар разрушает Щит, немедленно применяет Осколочный рывок, если тот не перезаряжается. Срабатывает не чаще одного раза за ход.',
    descriptionParts: ['Когда прямой удар разрушает ', { statusId: 'shield', text: 'Щит' }, ', немедленно применяет Осколочный рывок, если тот не перезаряжается. Срабатывает не чаще одного раза за ход.'],
    onTurnStart: ({ owner }) => {
      if (owner) owner._crystalSurgeTriggered = false;
    },
    onOwnerDamaged: ({ owner, attacker, context, log, session }) => {
      if (!owner || !attacker || owner._crystalSurgeTriggered || !isCleanDirectDamage(context)) return;
      if ((context?.shieldBefore ?? 0) <= 0 || (owner.shield ?? 0) > 0) return;
      const surge = owner.abilities?.find(ability => ability?.name === 'Осколочный рывок');
      if (!surge || (surge.currentCooldown ?? 0) > 0) return;
      owner._crystalSurgeTriggered = true;
      surge.currentCooldown = surge.cooldown ?? 3;
      const damage = roundDamage((owner.attack ?? 10) * 1.45);
      const dealt = context.applyDamage?.(attacker, damage, 'physical', {
        source: owner,
        fromEffect: 'crystal_surge',
        shieldDamageMultiplier: 1.75,
      }) ?? 0;
      addEffect(attacker, { id: effectId('Замедление'), duration: 2 }, log, owner, { session });
      if (typeof log === 'function') log(`💎 ${owner.name} срывается в ответный рывок и наносит ${dealt} урона.`);
    },
  },
  'Кристальный удар': {
    name: 'Кристальный удар',
    scalingStat: 'attack',
    artId: 'crystal_strike',
    enemyArtId: 'crystal_strike',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 10) * 1.65),
    type: 'physical',
    shieldDamageMultiplier: 1.75,
    description: 'Наносит 165% атаки физическим уроном и наносит на 75% больше урона Щиту.',
    descriptionParts: ['Наносит 165% атаки физическим уроном и наносит на 75% больше урона ', { statusId: 'shield', text: 'Щиту' }, '.'],
  },
  'Осколочный рывок': {
    name: 'Осколочный рывок',
    scalingStat: 'attack',
    artId: 'shard_dash',
    enemyArtId: 'shard_dash',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 10) * 1.45),
    type: 'physical',
    shieldDamageMultiplier: 1.75,
    effect: { id: effectId('Замедление'), duration: 2 },
    description: 'Наносит 145% атаки физическим уроном, на 75% больше урона Щиту и накладывает Замедление на 2 хода.',
    descriptionParts: ['Наносит 145% атаки физическим уроном, на 75% больше урона ', { statusId: 'shield', text: 'Щиту' }, ' и накладывает ', { statusId: 'speed_penalty_minor', text: 'Замедление' }, ' на 2 хода.'],
  },
  'Хрустальный панцирь': {
    name: 'Хрустальный панцирь',
    artId: 'crystal_carapace',
    enemyArtId: 'crystal_carapace',
    cooldown: 4,
    damage: 0,
    type: 'support',
    description: 'Получает Щит в размере 18% максимального здоровья на 2 хода и Укрепление на 2 хода.',
    descriptionParts: ['Получает ', { statusId: 'shield', text: 'Щит' }, ' в размере 18% максимального здоровья на 2 хода и ', { statusId: 'phys_def_boost_minor', text: 'Укрепление' }, ' на 2 хода.'],
    apply: ({ attacker, session, log }) => {
      if (!attacker) return;
      addEffect(attacker, { id: 'shield', duration: 2, value: roundDamage((attacker.maxHp ?? 80) * 0.18) }, log, attacker, { session });
      addEffect(attacker, { id: effectId('Укрепление'), duration: 2 }, log, attacker, { session });
    },
  },
  'Запах раскрытой раны': {
    name: 'Запах раскрытой раны',
    artId: 'scent_of_open_wound',
    passive: true,
    description: 'В начале хода, если хотя бы один противник под Кровотечением, получает Ускорение на 1 ход. Один раз за ход восстанавливает здоровье в размере 25% прямого физического урона, нанесённого цели под Кровотечением.',
    descriptionParts: ['В начале хода, если хотя бы один противник под ', { statusId: 'bleed', text: 'Кровотечением' }, ', получает ', { statusId: 'speed_boost_minor', text: 'Ускорение' }, ' на 1 ход. Один раз за ход восстанавливает здоровье в размере 25% прямого физического урона, нанесённого цели под ', { statusId: 'bleed', text: 'Кровотечением' }, '.'],
    onTurnStart: ({ owner, session, log }) => {
      if (!owner) return;
      owner._woundScentLifestealUsed = false;
      const hasBleedingTarget = livingUnits(session?.state?.players || []).some(hasBleed);
      if (hasBleedingTarget) {
        addEffect(owner, { id: effectId('Ускорение'), duration: 1 }, log, owner, { session });
      }
    },
    onDamageDealt: ({ owner, damage, damageType, context, log }) => {
      if (!owner || owner._woundScentLifestealUsed || damage <= 0) return;
      if (damageType !== 'physical' || !context?.directAttack || context?.fromEffect || !context?.targetWasBleeding) return;
      const heal = roundDamage(damage * 0.25);
      if (heal <= 0) return;
      owner._woundScentLifestealUsed = true;
      owner.hp = Math.min(owner.maxHp ?? owner.hp ?? 0, (owner.hp ?? 0) + heal);
      if (typeof log === 'function') log(`🩸 ${owner.name} питается раскрытой раной и восстанавливает ${heal} HP.`);
    },
  },
  'Мясистая хватка': {
    name: 'Мясистая хватка',
    scalingStat: 'attack',
    artId: 'fleshy_grip',
    enemyArtId: 'fleshy_grip',
    cooldown: 3,
    damage: ({ attacker, target }) => {
      const bleeding = hasBleed(target);
      return roundDamage((attacker?.attack ?? 10) * (bleeding ? 1.55 : 1.25));
    },
    type: 'physical',
    effect: { id: effectId('Кровотечение'), duration: 2 },
    description: 'Наносит физический урон в размере 125% атаки. По цели под Кровотечением — 155% атаки. Накладывает Кровотечение на 2 хода.',
    descriptionParts: ['Наносит физический урон в размере 125% атаки. По цели под ', { statusId: 'bleed', text: 'Кровотечением' }, ' — 155% атаки. Накладывает ', { statusId: 'bleed', text: 'Кровотечение' }, ' на 2 хода.'],
  },
  'Янтарный припадок': {
    name: 'Янтарный припадок',
    artId: 'amber_frenzy',
    enemyArtId: 'amber_frenzy',
    cooldown: 4,
    damage: 0,
    type: 'support',
    description: 'Получает Натиск и Ускорение на 2 хода, теряя 5% максимального здоровья. Не может снизить здоровье ниже 1. Если цель под Кровотечением, здоровье не теряется.',
    descriptionParts: ['Получает ', { statusId: 'attack_boost_minor', text: 'Натиск' }, ' и ', { statusId: 'speed_boost_minor', text: 'Ускорение' }, ' на 2 хода, теряя 5% максимального здоровья. Не может снизить здоровье ниже 1. Если цель под ', { statusId: 'bleed', text: 'Кровотечением' }, ', здоровье не теряется.'],
    apply: ({ attacker, target, session, log }) => {
      if (!attacker) return;
      if (!hasBleed(target)) {
        const cost = roundDamage((attacker.maxHp ?? 0) * 0.05);
        attacker.hp = Math.max(1, (attacker.hp ?? 1) - cost);
        if (typeof log === 'function') log(`🟠 ${attacker.name} теряет ${cost} HP в янтарном припадке.`);
      }
      addEffect(attacker, { id: effectId('Натиск'), duration: 2 }, log, attacker, { session });
      addEffect(attacker, { id: effectId('Ускорение'), duration: 2 }, log, attacker, { session });
    },
  },
  'Ядовитое облако': {
    name: 'Ядовитое облако',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? attacker?.attack ?? 6) * 1.1),
    type: 'magical',
    school: MAGIC_SCHOOLS.NATURE,
    effect: { id: effectId('Отравление') },
    targeting: 'allEnemies',
    description: 'Наносит всем врагам магический урон Природой в размере 110% магической атаки и накладывает Отравление на 3 хода.',
    descriptionParts: ['Наносит всем врагам магический урон Природой в размере 110% магической атаки и накладывает ', { statusId: 'poison', text: 'Отравление' }, ' на 3 хода.'],
  },
  'Оскверненная плоть': {
    name: 'Оскверненная плоть',
    passive: true,
    description:
      'Пассивно: при получении урона накладывает на атакующего Кровотечение на 2 хода и усиливает эффекты вампиризма на 50%.',
    onBattleStart: ({ owner }) => {
      if (!owner) return;
      owner.vampirismBonus = (owner.vampirismBonus ?? 0) + 0.5;
    },
    onOwnerDamaged: ({ owner, attacker, log }) => {
      if (!owner || !attacker || attacker.hp <= 0) return;
      addEffect(
        attacker,
        { id: effectId('Кровотечение'), duration: 2 },
        text => {
          if (typeof log === 'function') log(text);
        },
        owner
      );
    },
  },
  'Дар Осквернения': {
    name: 'Дар Осквернения',
    cooldown: 3,
    damage: ({ target }) => {
      if (!target) return 0;
      const missingHp = (target.maxHp ?? target.hp ?? 0) - (target.hp ?? 0);
      return roundDamage(Math.max(0, missingHp));
    },
    type: 'true',
    description: 'Жертвует здоровьем, нанося урон, равный недостающему здоровью цели.',
    apply: ({ attacker, log }) => {
      if (!attacker) return;
      const selfDamage = roundDamage((attacker.maxHp ?? 0) * 0.15);
      attacker.hp = Math.max(1, (attacker.hp ?? attacker.maxHp ?? 0) - selfDamage);
      if (typeof log === 'function') {
        log(`🩸 ${attacker.name} жертвует ${selfDamage} HP ради темной силы.`);
      }
    },
  },
  'Устрашение': {
    artId: 'intimidation',
    name: 'Устрашение',
    cooldown: 2,
    damage: 0,
    type: 'support',
    targeting: 'allEnemies',
    classTags: ['defender'],
    unlockTier: 1,
    abilityRole: 'control',
    description: 'Накладывает Ослабление на всех живых врагов на 2 хода и продлевает уже действующие негативные эффекты, кроме эффектов контроля и Сломленности, на 1 ход.',
    descriptionParts: ['Накладывает ', { statusId: 'attack_penalty_minor', text: 'Ослабление' }, ' на всех живых врагов на 2 хода и продлевает уже действующие негативные эффекты, кроме эффектов контроля и ', { statusId: 'passive_break', text: 'Сломленности' }, ', на 1 ход.'],
    apply: ({ attacker, session, log }) => {
      if (!session?.state) return;
      const state = session.state;
      const isEnemy = Array.isArray(state.enemies) && state.enemies.includes(attacker);
      const group = isEnemy ? state.players : state.enemies;
      if (!Array.isArray(group)) return;
      const effectKey = effectId('Ослабление');
      const affected = group.filter(unit => unit && unit.hp > 0);
      const talent = selectedTalent(attacker, 'defender.intimidation');
      const ownBuffs = talent === 'defender.intimidation.steadfastness'
        ? (attacker.effects || []).filter(isTemporaryRemovableBuff)
        : [];
      const enemyBuffs = talent === 'defender.intimidation.suppression'
        ? new Map(affected.map(target => [target, (target.effects || []).filter(isTemporaryRemovableBuff)]))
        : null;
      let extendedCount = 0;
      affected.forEach(target => {
        const existingDebuffs = (target.effects || [])
          .filter(isExtendableDebuff)
          .map(effect => ({
            effect,
            turns: Number.isFinite(effect.remainingTurns) ? effect.remainingTurns : effect.duration,
          }));
        addEffect(
          target,
          { id: effectKey, duration: 2 },
          text => {
            if (typeof log === 'function') log(text);
          },
          attacker
        );
        extendedCount += extendExistingDebuffs(target, existingDebuffs);
        if (enemyBuffs) {
          const expiring = [];
          enemyBuffs.get(target).forEach(effect => {
            if (!target.effects?.includes(effect)) return;
            effect.remainingTurns = (effect.remainingTurns ?? effect.duration) - 1;
            effect.duration = effect.remainingTurns;
            if (effect.remainingTurns <= 0) expiring.push(effect);
          });
          if (expiring.length) cleanseEffects(target, effect => expiring.includes(effect), log);
          addEffect(target, { id: 'magic_attack_penalty_minor', duration: 2 }, log, attacker, { session });
        }
      });
      if (talent === 'defender.intimidation.steadfastness') {
        ownBuffs.forEach(effect => addEffect(attacker, {
          id: effect.id, duration: 1, extendOnly: true, effectInstance: effect,
        }, log, attacker, { session, effectOperation: 'extendDuration', effectInstance: effect }));
        if (!ownBuffs.some(effect => effect.id === 'control_immunity')) {
          addEffect(attacker, { id: 'control_immunity', duration: 1 }, log, attacker, { session });
        }
      }
      if (affected.length > 0 && typeof log === 'function') {
        const names = affected.map(t => t.name).join(', ');
        const extensionText = extendedCount > 0 ? ` Продлено отрицательных эффектов: ${extendedCount}.` : '';
        log(`😨 ${(attacker?.name || 'Источник')} устрашает ${names}.${extensionText}`);
      }
    },
  },
  'Кровожадность': {
    name: 'Кровожадность',
    artId: 'bloodlust',
    passive: true,
    description: 'Наносит на 15% больше урона целям под Кровотечением.',
    descriptionParts: ['Наносит на 15% больше урона целям под ', { statusId: 'bleed', text: 'Кровотечением' }, '.'],
    modifyDamage: ({ damage, target }) => {
      if (!target || damage <= 0) return damage;
      const hasBleed = (target.effects || []).some(eff => eff?.id === 'bleed');
      return hasBleed ? Math.round(damage * 1.15) : damage;
    },
  },
  'Отравленный болт': {
    name: 'Отравленный болт',
    scalingStat: 'attack',
    artId: 'poisoned_bolt',
    enemyArtId: 'poisoned_bolt',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 8) * 1),
    type: 'physical',
    effect: [
      { id: effectId('Отравление'), duration: 1 },
      { id: effectId('Кровотечение'), duration: 1 },
    ],
    description: 'Наносит физический урон в размере 100% атаки. Накладывает Отравление и Кровотечение на 1 ход.',
    descriptionParts: ['Наносит физический урон в размере 100% атаки. Накладывает ', { statusId: 'poison', text: 'Отравление' }, ' и ', { statusId: 'bleed', text: 'Кровотечение' }, ' на 1 ход.'],
  },
  'Укрытие': {
    name: 'Укрытие',
    artId: 'goblin_cover',
    passive: true,
    description: 'В начале боя получает Уклонение на 3 хода.',
    descriptionParts: ['В начале боя получает ', { statusId: 'evasion', text: 'Уклонение' }, ' на 3 хода.'],
    onBattleStart: ({ owner, log }) => {
      if (!owner) return;
      addEffect(
        owner,
        { id: effectId('Уклонение'), duration: 3 },
        text => {
          if (typeof log === 'function') log(text);
        },
        owner
      );
    },
  },
  'Укол иглой': {
    name: 'Укол иглой',
    scalingStat: 'attack',
    artId: 'needle_sting',
    enemyArtId: 'needle_sting',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 7) * 1.4),
    type: 'physical',
    effect: { id: effectId('Ослабление'), duration: 2 },
    description: 'Наносит физический урон в размере 140% атаки и накладывает Ослабление на 2 хода.',
    descriptionParts: ['Наносит физический урон в размере 140% атаки и накладывает ', { statusId: 'attack_penalty_minor', text: 'Ослабление' }, ' на 2 хода.'],
  },
  'Лечение': {
    name: 'Лечение',
    cooldown: 2,
    damage: 0,
    type: 'support',
    description: 'Светлое заклинание, восстанавливающее здоровье.',
    targeting: 'ally',
    canUse: ({ candidateTargets = [] }) => candidateTargets.some(unit => (
      effectiveHeal(unit, 0.35) >= Math.max(1, roundDamage((unit.maxHp ?? 0) * 0.15))
    )),
    targetScore: ({ target }) => healingTargetScore(target, 0.35),
    aiScore: ({ target }) => {
      const amount = roundDamage((target?.maxHp ?? 0) * 0.35);
      return effectiveHeal(target, 0.35) >= amount * 0.75 ? 2 : 0.5;
    },
    apply: ({ target, log }) => {
      const recipient = target;
      if (!recipient) return;
      const amount = roundDamage((recipient.maxHp ?? 0) * 0.35);
      const beforeHp = recipient.hp ?? 0;
      recipient.hp = Math.min(recipient.maxHp ?? recipient.hp ?? amount, beforeHp + amount);
      const restored = Math.max(0, (recipient.hp ?? 0) - beforeHp);
      if (typeof log === 'function') {
        log(`✨ ${recipient.name || 'Цель'} исцеляется на ${restored} HP.`);
      }
    },
  },
  'Инферно': {
    name: 'Инферно',
    artId: 'inferno',
    passive: true,
    description: 'Пока хотя бы один противник под Горением, поддерживает Сильное ускорение, повышающее Скорость на 30%. При первом снижении здоровья до 30% или ниже получает Натиск, повышающий Атаку на 25% на 3 хода, и сокращает текущую перезарядку остальных способностей на 1 ход.',
    descriptionParts: ['Пока хотя бы один противник под ', { statusId: 'burn', text: 'Горением' }, ', поддерживает ', { statusId: 'speed_boost_major', text: 'Сильное ускорение' }, ', повышающее Скорость на 30%. При первом снижении здоровья до 30% или ниже получает ', { statusId: 'attack_boost_minor', text: 'Натиск' }, ', повышающий Атаку на 25% на 3 хода, и сокращает текущую перезарядку остальных способностей на 1 ход.'],
    onTurnStart: ({ owner, ability, log, session }) => {
      if (!owner || owner.maxHp <= 0 || owner.passivesDisabled) return;

      if (!ability._triggered) {
        const ratio = (owner.hp ?? 0) / owner.maxHp;
        if (ratio <= 0.3) {
          ability._triggered = true;
          addEffect(
            owner,
            { id: 'attack_boost_minor', duration: 3 },
            text => {
              if (typeof log === 'function') log(text);
            },
            owner,
            { session }
          );
          owner.abilities?.forEach(ab => {
            if (ab === ability) return;
            if (ab.currentCooldown > 0) {
              ab.currentCooldown = Math.max(0, ab.currentCooldown - 1);
            }
          });
          if (session?.state) {
            session.state.metrics ||= {};
            session.state.metrics.infernoAttackActivations = (session.state.metrics.infernoAttackActivations || 0) + 1;
          }
          if (typeof log === 'function') {
            log(`🔥 ${owner.name || 'Боец'} впадает в инферно, усиливая атаки и ускоряя перезарядку!`);
          }
        }
      }

      const state = session?.state;
      const enemies = state
        ? (state.enemies || []).includes(owner)
          ? (state.players || [])
          : (state.enemies || [])
        : [];
      const hasBurningOpponent = enemies.some(
        unit =>
          unit
          && unit.hp > 0
          && Array.isArray(unit.effects)
          && unit.effects.some(effect => effect?.id === 'burn')
      );
      const speedEffect = Array.isArray(owner.effects)
        ? owner.effects.find(effect => effect?.id === 'speed_boost_major')
        : null;

      if (hasBurningOpponent && (!speedEffect || (speedEffect.remainingTurns ?? 0) <= 1)) {
        addEffect(
          owner,
          { id: 'speed_boost_major', duration: 2 },
          log,
          owner,
          { session }
        );
        if (session?.state) {
          session.state.metrics ||= {};
          session.state.metrics.infernoSpeedActivations = (session.state.metrics.infernoSpeedActivations || 0) + 1;
        }
      } else if (!hasBurningOpponent && speedEffect) {
        cleanseEffects(owner, effect => effect?.id === 'speed_boost_major');
      }
    },
  },
  'Пылающий щит': {
    name: 'Пылающий щит',
    artId: 'blazing_shield',
    enemyArtId: 'blazing_shield',
    cooldown: 4,
    damage: 0,
    type: 'support',
    description: 'Получает Щит прочностью 40 на 2 хода. При разрушении Щита наносит всем противникам магический урон Огнём в размере 75% атаки и накладывает Горение на 2 хода.',
    descriptionParts: ['Получает ', { statusId: 'shield', text: 'Щит' }, ' прочностью 40 на 2 хода. При разрушении ', { statusId: 'shield', text: 'Щита' }, ' наносит всем противникам магический урон Огнём в размере 75% атаки и накладывает ', { statusId: 'burn', text: 'Горение' }, ' на 2 хода.'],
    apply: ({ attacker, log }) => {
      if (!attacker) return;
      addEffect(
        attacker,
        {
          id: 'shield',
          duration: 2,
          value: 40,
          onBreak: {
            damageMultiplier: 0.75,
            type: 'magical',
            school: MAGIC_SCHOOLS.FIRE,
            effects: [{ id: effectId('Горение'), duration: 2 }],
            target: 'allEnemies',
          },
        },
        log,
        attacker
      );
    },
  },
  'Огненный взрыв': {
    name: 'Огненный взрыв',
    scalingStat: 'magAtk',
    artId: 'fire_blast',
    enemyArtId: 'fire_blast',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 12) * 0.5),
    type: 'magical',
    school: MAGIC_SCHOOLS.FIRE,
    targeting: 'allEnemies',
    secondary: {
      name: 'Ударная волна Огненного взрыва',
      target: 'target',
      type: 'physical',
      damage: ({ attacker }) => roundDamage((attacker?.attack ?? 10) * 0.1),
      allowCritical: false,
    },
    effect: [
      { id: effectId('Горение'), duration: 3 },
      { id: effectId('Слепота'), duration: 1 },
    ],
    description: 'Наносит всем противникам магический урон Огнём в размере 50% магической атаки, затем физический урон в размере 10% атаки. Накладывает Горение на 3 хода и Слепоту на 1 ход.',
    descriptionParts: ['Наносит всем противникам магический урон Огнём в размере 50% магической атаки, затем физический урон в размере 10% атаки. Накладывает ', { statusId: 'burn', text: 'Горение' }, ' на 3 хода и ', { statusId: 'blind', text: 'Слепоту' }, ' на 1 ход.'],
  },
  'Кровавый ритуал': {
    name: 'Кровавый ритуал',
    cooldown: 3,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? attacker?.magAtk ?? 10) * 1.5),
    type: 'physical',
    effect: [
      { id: effectId('Кровотечение'), duration: 3 },
      { id: effectId('Уязвимость'), duration: 3 },
    ],
    selfEffects: [{ id: effectId('Регенерация'), duration: 1, target: 'self' }],
    description: 'Наносит урон цели, накладывает Кровотечение и Уязвимость, а на себя — Регенерацию на 1 ход.',
  },
  'Кровавая жертва': {
    name: 'Кровавая жертва',
    cooldown: 4,
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 10) * 2),
    type: 'physical',
    effect: [{ id: effectId('Кровотечение'), duration: 3 }],
    selfEffects: [{ id: effectId('Кровотечение'), duration: 3, target: 'self' }],
    description:
      'Наносит мощный удар, накладывает Кровотечение на цель и на себя, крадёт у цели 25% полоски хода.',
    apply: ({ attacker, target, log }) => {
      if (!target) return;
      const loss = TURN_METER_CHUNK;
      reduceHostileTurnMeter(target, loss);
      if (typeof log === 'function') {
        log(`⏳ ${target.name} теряет 25% прогресса хода из-за кровавой жертвы.`);
      }
    },
  },
  'Удар щитом': {
    artId: 'shield_bash',
    name: 'Защитный удар',
    cooldown: 2,
    damage: ({ attacker }) => roundDamage(
      (attacker?.attack ?? 0) * 1.05 + Math.max(0, attacker?.shield ?? 0) * 0.2
    ),
    type: 'physical',
    effect: { id: effectId('Оглушение'), duration: 1, chance: 0.35 },
    selfEffects: ({ attacker }) => {
      const maxHp = attacker?.maxHp ?? attacker?.hp ?? 0;
      const recentAttackers = new Set([
        ...(attacker?._defensiveStrikeWindowAttackers || []),
        ...(attacker?._defensiveStrikeAttackers || []),
      ]).size;
      const circularBonus = selectedTalent(attacker, 'defender.defensive_strike') === 'defender.defensive_strike.circular_defense'
        ? Math.min(3, recentAttackers) * 0.04 : 0;
      const shieldValue = roundDamage(maxHp * (0.10 + circularBonus));
      return shieldValue > 0
        ? { id: 'shield', duration: 3, value: shieldValue, target: 'self' }
        : null;
    },
    apply: ({ attacker, target, hitTargets = [], preHitTargetStates = [], session, log }) => {
      if (!target || !hitTargets.includes(target)
        || selectedTalent(attacker, 'defender.defensive_strike') !== 'defender.defensive_strike.breach') return;
      const before = preHitTargetStates.find(entry => entry.target === target);
      if (before?.hadBleed) addEffect(target, { id: effectId('Ослабление защиты'), duration: 2 }, log, attacker, { session });
    },
    classTags: ['defender'],
    unlockTier: 1,
    abilityRole: 'control',
    description: 'Наносит 105% атаки + 20% Щита перед атакой физическим уроном. При попадании с шансом 35% накладывает Оглушение на 1 ход. После способности получает Щит 10% максимального здоровья на 3 хода; Щит не расходуется.',
    descriptionParts: ['Наносит 105% атаки + 20% ', { statusId: 'shield', text: 'Щита' }, ' перед атакой физическим уроном. При попадании с шансом 35% накладывает ', { statusId: 'stun', text: 'Оглушение' }, ' на 1 ход. После способности получает ', { statusId: 'shield', text: 'Щит' }, ' 10% максимального здоровья на 3 хода; ', { statusId: 'shield', text: 'Щит' }, ' не расходуется.'],
  },
  'Разлом стойки': {
    name: 'Разлом стойки',
    cooldown: 2,
    damage: ({ attacker }) => {
      const shielded = (attacker?.shield ?? 0) > 0 || hasEffect(attacker, 'shield');
      return roundDamage((attacker?.attack ?? 12) * (shielded ? 1.35 : 1.1));
    },
    type: 'physical',
    effect: { id: effectId('Ослабление'), duration: 1 },
    description:
      'Искажённый страж ломает стойку цели физическим ударом и накладывает Ослабление на 1 ход. Если страж защищён Щитом, удар сильнее.',
  },
  'Щитовая волна': {
    artId: 'shield_wave',
    name: 'Щитовая волна',
    cooldown: 4,
    damage: ({ attacker }) => roundDamage(
      (attacker?.attack ?? 0) * 0.45 + Math.max(0, attacker?.shield ?? 0) * 0.4
    ),
    type: 'physical',
    targeting: 'allEnemies',
    classTags: ['defender'],
    unlockTier: 2,
    abilityRole: 'damage',
    description: 'Выпускает физическую ударную волну от Щита по всем врагам. Урон зависит от текущего Щита и атаки, после чего Защитник теряет половину Щита.',
    apply: ({ attacker, log }) => {
      const currentShield = Math.max(0, attacker?.shield ?? 0);
      if (!attacker || currentShield <= 0) return;
      const spentShield = Math.max(1, roundDamage(currentShield * 0.5));
      attacker.shield = Math.max(0, currentShield - spentShield);
      let remainingSpend = spentShield;
      if (Array.isArray(attacker.effects)) {
        attacker.effects.forEach(effect => {
          if (remainingSpend <= 0 || effect?.id !== 'shield') return;
          const appliedShield = Math.max(0, effect.appliedShield ?? effect.value ?? 0);
          const reduction = Math.min(appliedShield, remainingSpend);
          effect.appliedShield = Math.max(0, appliedShield - reduction);
          if (typeof effect.value === 'number') {
            effect.value = Math.max(0, effect.value - reduction);
          }
          remainingSpend -= reduction;
        });
      }
      if (typeof log === 'function') {
        log(`🛡️ ${attacker.name || 'Защитник'} тратит ${spentShield} Щита на Щитовую волну.`);
      }
    },
  },
  'Ударная волна': {
    artId: 'shockwave', name: 'Ударная волна', cooldown: 4, type: 'physical', targeting: 'allEnemies',
    classTags: ['defender'], abilityRole: 'damage', canUse: ({ attacker }) => (attacker?.shield ?? 0) > 0,
    disabledReason: 'Требуется Щит',
    damage: ({ attacker, target, actionSnapshot }) => {
      const attack = Math.max(0, attacker?.attack ?? 0);
      const shieldBefore = Math.max(0, actionSnapshot?.shieldBefore ?? attacker?.shield ?? 0);
      const baseDamage = DEFENDER_PROGRESSION_SKILL_TUNING.shockwaveAttackScale * attack + Math.min(
        DEFENDER_PROGRESSION_SKILL_TUNING.shockwaveAttackCapScale * attack,
        DEFENDER_PROGRESSION_SKILL_TUNING.shockwaveShieldScale * Math.sqrt(shieldBefore)
      );
      const heavyWave = selectedTalent(attacker, 'defender.shockwave') === 'defender.shockwave.heavy_wave';
      return roundDamage(baseDamage * (heavyWave && target?.innateControlImmune === true ? 1.25 : 1));
    },
    effect: ({ attacker }) => ({
      id: selectedTalent(attacker, 'defender.shockwave') === 'defender.shockwave.heavy_wave'
        ? 'speed_penalty_major'
        : 'speed_penalty_minor',
      duration: 1,
    }),
    description: 'Требует Щит. Наносит всем врагам физический урон: 35% атаки + минимум из 200% атаки и 5 × √Щита до расхода. Затем тратит половину исходного Щита и накладывает Замедление.',
    descriptionParts: ['Требует ', { statusId: 'shield', text: 'Щит' }, '. Наносит всем врагам физический урон: 35% атаки + минимум из 200% атаки и 5 × √', { statusId: 'shield', text: 'Щита' }, ' до расхода. Затем тратит половину исходного ', { statusId: 'shield', text: 'Щита' }, ' и накладывает ', { statusId: 'speed_penalty_minor', text: 'Замедление' }, '.'],
    apply: ({ attacker, actionSnapshot, hitTargets = [], preHitTargetStates = [], session, log }) => {
      const before = Math.max(0, actionSnapshot?.shieldBefore ?? attacker?.shield ?? 0);
      if (!attacker || before <= 0) return;
      const reduction = hasEffect(attacker, 'defender_combat_readiness') ? 0.5 : 1;
      const spent = spendTemporaryShield(attacker, Math.max(1, Math.round(before * DEFENDER_PROGRESSION_SKILL_TUNING.shockwaveShieldSpend * reduction)));
      if (spent > 0 && reduction < 1) consumeCombatReadiness(attacker, log);
      if (typeof log === 'function') log(`🛡️ ${attacker.name || 'Защитник'} обращает ${spent} Щита в ударную волну.`);
      if (spent > 0 && selectedTalent(attacker, 'defender.shockwave') === 'defender.shockwave.bloody_echo') {
        const bleedingBefore = new Set(preHitTargetStates.filter(entry => entry.hadBleed).map(entry => entry.target));
        const qualifyingTargets = new Set(hitTargets.filter(target => bleedingBefore.has(target)));
        const refund = roundDamage(spent * Math.min(0.6, qualifyingTargets.size * 0.2));
        if (refund > 0) addEffect(attacker, { id: 'shield', duration: 2, value: refund }, log, attacker, { session, forceIndependentInstance: true });
      }
    },
  },
  'Таран': {
    artId: 'ram', name: 'Таран', cooldown: 4, damage: 0, type: 'support', targeting: 'self', classTags: ['defender'], abilityRole: 'damage',
    description: 'Получает Щит в размере 16% максимального здоровья и Ускорение, заполняет 50% шкалы хода, затем в начале следующего своего хода наносит всем живым врагам 95% атаки физическим уроном.',
    descriptionParts: ['Получает ', { statusId: 'shield', text: 'Щит' }, ' в размере 16% максимального здоровья и ', { statusId: 'speed_boost_minor', text: 'Ускорение' }, ', заполняет 50% шкалы хода, затем в начале следующего своего хода наносит всем живым врагам 95% атаки физическим уроном.'],
    apply: ({ attacker, session, log }) => {
      const shield = Math.max(1, roundDamage((attacker?.maxHp ?? 1) * DEFENDER_PROGRESSION_SKILL_TUNING.ramShieldFraction));
      addEffect(attacker, { id: 'shield', duration: 2, value: shield }, log, attacker, { session });
      addEffect(attacker, { id: 'speed_boost_minor', duration: 2 }, log, attacker, { session });
      attacker.turnMeter = Math.min(1000, Math.max(0, attacker.turnMeter ?? 0) + 1000 * DEFENDER_PROGRESSION_SKILL_TUNING.ramTurnMeterGain);
      const ramTalent = selectedTalent(attacker, 'defender.ram');
      addEffect(attacker, { id: 'preparation', duration: 1, extra: {
        kind: 'defender_ram',
        sourceAbilityName: 'Таран',
        preparedDescription: 'Таран: в начале следующего хода Защитник атакует всех живых врагов.',
        damage: roundDamage((attacker?.attack ?? 0) * DEFENDER_PROGRESSION_SKILL_TUNING.ramDamageScale),
        talentId: ramTalent,
        attackActions: 0,
      } }, log, attacker, { session });
    },
  },
  'Бросок щита': {
    artId: 'shield_throw', name: 'Бросок щита', cooldown: 4, type: 'physical', classTags: ['defender'], abilityRole: 'damage', disabledReason: 'Требуется щит',
    canUse: ({ attacker }) => hasPhysicalShieldEquipped(attacker) && (attacker?.shield ?? 0) > 0,
    damage: ({ attacker, actionSnapshot }) => roundDamage(
      (attacker?.attack ?? 0) * DEFENDER_PROGRESSION_SKILL_TUNING.shieldThrowAttackScale +
      Math.max(0, actionSnapshot?.shieldBefore ?? attacker?.shield ?? 0) * DEFENDER_PROGRESSION_SKILL_TUNING.shieldThrowShieldScale
    ),
    effect: ({ attacker, actionSnapshot }) => ({ id: 'bleed', duration: Math.max(1, Math.min(6, Math.ceil(Math.max(0, actionSnapshot?.shieldBefore ?? attacker?.shield ?? 0) / DEFENDER_PROGRESSION_SKILL_TUNING.shieldThrowBleedDivisor))) }),
    description: 'Требует экипированный физический щит и магический Щит. Наносит физический урон в размере 140% атаки + 80% исходного Щита, накладывает от 1 до 6 ходов Кровотечения и тратит весь магический Щит, не снимая предмет.',
    descriptionParts: ['Требует экипированный физический щит и магический ', { statusId: 'shield', text: 'Щит' }, '. Наносит физический урон в размере 140% атаки + 80% исходного ', { statusId: 'shield', text: 'Щита' }, ', накладывает от 1 до 6 ходов ', { statusId: 'bleed', text: 'Кровотечения' }, ' и тратит весь магический ', { statusId: 'shield', text: 'Щит' }, ', не снимая предмет.'],
    apply: ({ attacker, target, hitTargets = [], actionSnapshot, session, log, applyDirectDamage, flushDamageReactions }) => {
      const before = Math.max(0, actionSnapshot?.shieldBefore ?? attacker?.shield ?? 0);
      const reduction = hasEffect(attacker, 'defender_combat_readiness') ? 0.5 : 1;
      const spent = spendTemporaryShield(attacker, before * reduction);
      if (spent > 0 && reduction < 1) consumeCombatReadiness(attacker, log);
      if (typeof log === 'function') log(`🛡️ ${attacker.name || 'Защитник'} тратит ${spent} Щита, не теряя экипированный щит.`);
      if (selectedTalent(attacker, 'defender.shield_throw') !== 'defender.shield_throw.ricochet' || !hitTargets.includes(target)) return;
      const candidates = (session?.state?.enemies || []).filter(enemy => enemy && enemy !== target && enemy.hp > 0);
      if (candidates.length === 0) return;
      const rng = typeof session?.rng === 'function' ? session.rng : Math.random;
      const ricochetTarget = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
      const originalBaseDamage = roundDamage(
        (attacker?.attack ?? 0) * DEFENDER_PROGRESSION_SKILL_TUNING.shieldThrowAttackScale +
        before * DEFENDER_PROGRESSION_SKILL_TUNING.shieldThrowShieldScale
      );
      const ricochetDamage = roundDamage(originalBaseDamage * 0.5);
      applyDirectDamage?.(ricochetTarget, ricochetDamage, {
        name: 'Рикошет щита', type: 'physical', isSecondaryDamage: true,
      });
      const primaryBleedDuration = Math.max(1, Math.min(6, Math.ceil(before / DEFENDER_PROGRESSION_SKILL_TUNING.shieldThrowBleedDivisor)));
      addEffect(ricochetTarget, { id: 'bleed', duration: Math.ceil(primaryBleedDuration / 2) }, log, attacker, { session });
      flushDamageReactions?.(ricochetTarget);
    },
  },
  'Кровавый вызов': {
    artId: 'blood_challenge', name: 'Кровавый вызов', cooldown: 5, damage: 0, type: 'support', targeting: 'allEnemies', classTags: ['defender'], abilityRole: 'control',
    description: 'Накладывает Провокацию на всех врагов на 1 ход. Когда Защитник получает прямой урон здоровью от врага под Провокацией, он получает Щит в размере 40% полученного урона. За каждый оставшийся ход Кровотечения на атакующем эта доля увеличивается на 5 п.п., максимум до 70%.',
    descriptionParts: ['Накладывает ', { statusId: 'provoked', text: 'Провокацию' }, ' на всех врагов на 1 ход. Когда Защитник получает прямой урон здоровью от врага под ', { statusId: 'provoked', text: 'Провокацией' }, ', он получает ', { statusId: 'shield', text: 'Щит' }, ' в размере 40% полученного урона. За каждый оставшийся ход ', { statusId: 'bleed', text: 'Кровотечения' }, ' на атакующем эта доля увеличивается на 5 п.п., максимум до 70%.'],
    apply: ({ attacker, targets, session, log }) => {
      (targets || []).forEach(target => addEffect(target, { id: 'provoked', duration: 1, extra: { defenderId: attacker?.id } }, log, attacker, { session }));
      const challengeTalent = selectedTalent(attacker, 'defender.bloody_challenge');
      addEffect(attacker, { id: 'provocation_guard', duration: 2, extra: {
        defenderId: attacker?.id,
        talentId: challengeTalent,
        reckoningTargetIds: [],
        reckoningResolved: false,
      } }, log, attacker, { session });
    },
  },
  'Сдерживающий выпад': { artId: 'restraining_thrust', enemyArtId: 'restraining_thrust',
    name: 'Сдерживающий выпад', cooldown: 2, type: 'physical', scalingStat: 'attack',
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * 1.45),
    effect: { id: effectId('Замедление'), duration: 1 },
    description: 'Наносит 145% атаки физическим уроном и накладывает малое Замедление на 1 ход.',
    descriptionParts: ['Наносит 145% атаки физическим уроном и накладывает малое ', { statusId: 'speed_penalty_minor', text: 'Замедление' }, ' на 1 ход.'],
  },
  'Стойка копья': { artId: 'spear_stance', enemyArtId: 'spear_stance',
    name: 'Стойка копья', cooldown: 3, damage: 0, type: 'support', targeting: 'self',
    description: 'Накладывает на себя Контратаку.',
    descriptionParts: ['Накладывает на себя ', { statusId: 'iron_counter', text: 'Контратаку' }, '.'],
    apply: ({ attacker, session, log }) => addEffect(attacker, { id: 'iron_counter', duration: 1 }, log, attacker, { session }),
  },
  'Змеиный зов': { artId: 'serpent_call', enemyArtId: 'serpent_call',
    name: 'Змеиный зов', cooldown: 5, damage: 0, type: 'support', targeting: 'self',
    canUse: ({ session }) => (session?.state?.enemies || []).filter(unit => unit?.hp > 0).length < 6,
    aiScore: 3,
    description: 'Призывает одну Пещерную змею, если на поле есть свободное место.',
    apply: ({ attacker, session, log }) => {
      const result = session?.summonEnemy?.('Пещерная змея', { source: attacker });
      if (result?.success) log?.(`🐍 ${attacker.name} призывает ${result.enemy.name}.`);
    },
  },
  'Хоровод ядовитых змей': { artId: 'venomous_serpent_dance', enemyArtId: 'venomous_serpent_dance',
    name: 'Хоровод ядовитых змей', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.NATURE,
    scalingStat: 'magAtk', targeting: 'allEnemies',
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 0.8),
    effect: { id: effectId('Отравление'), duration: 2 },
    description: 'Наносит всем противникам 80% магической атаки магическим уроном Природой и накладывает Отравление.',
    descriptionParts: ['Наносит всем противникам 80% магической атаки магическим уроном Природой и накладывает ', { statusId: 'poison', text: 'Отравление' }, '.'],
  },
  'Костяной обряд': { artId: 'bone_ritual', enemyArtId: 'bone_ritual',
    name: 'Костяной обряд', cooldown: 3, damage: 0, type: 'support', targeting: 'ally',
    canUse: ({ allies = [], session }) => livingUnits(allies.length ? allies : session?.state?.enemies || []).some(unit => missingHp(unit) > 0 || hasRemovableDebuff(unit)),
    targetScore: ({ target }) => healingTargetScore(target, 0.3, hasRemovableDebuff(target) ? 35 : 0),
    aiScore: ({ target }) => missingHp(target) > 0 || hasRemovableDebuff(target) ? 4 : -10,
    description: 'Лечит наиболее нуждающегося союзника на 30% его максимального здоровья и снимает один обычный снимаемый отрицательный эффект.',
    apply: ({ target, log }) => {
      if (!target) return;
      const amount = roundDamage((target.maxHp ?? target.hp ?? 0) * 0.3);
      const healed = Math.min(missingHp(target), amount);
      target.hp = Math.min(target.maxHp ?? target.hp, (target.hp ?? 0) + amount);
      removeRandomNegativeEffect(target, () => 0, log);
      log?.(`🦴 Костяной обряд восстанавливает ${healed} здоровья ${target.name}.`);
    },
  },
  'Проклятие слепых глаз': { artId: 'curse_of_blind_eyes', enemyArtId: 'curse_of_blind_eyes',
    name: 'Проклятие слепых глаз', cooldown: 2, type: 'magical', school: MAGIC_SCHOOLS.NATURE,
    scalingStat: 'magAtk', damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 0.9),
    effect: { id: effectId('Ослабление'), duration: 2 },
    description: 'Наносит 90% магической атаки магическим уроном Природой и накладывает Ослабление на 2 хода.',
    descriptionParts: ['Наносит 90% магической атаки магическим уроном Природой и накладывает ', { statusId: 'attack_penalty_minor', text: 'Ослабление' }, ' на 2 хода.'],
  },
  'Заражённый выпад': { artId: 'infected_thrust', enemyArtId: 'infected_thrust',
    name: 'Заражённый выпад', cooldown: 2, type: 'physical', scalingStat: 'attack',
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * 1.3),
    effect: { id: effectId('Отравление'), duration: 2 },
    description: 'Наносит 130% атаки физическим уроном и накладывает Отравление.',
    descriptionParts: ['Наносит 130% атаки физическим уроном и накладывает ', { statusId: 'poison', text: 'Отравление' }, '.'],
  },
  'Паразитический рефлекс': { artId: 'parasitic_reflex',
    name: 'Паразитический рефлекс', passive: true,
    description: 'Прямой удар по цели, у которой уже было Отравление до начала действия, крадёт 15% её шкалы хода. Не чаще одного раза за действие.',
    descriptionParts: ['Прямой удар по цели, у которой уже было ', { statusId: 'poison', text: 'Отравление' }, ' до начала действия, крадёт 15% её шкалы хода. Не чаще одного раза за действие.'],
    onDamageDealt: ({ owner, target, context }) => {
      if (!owner || !target || !context?.directAttack || !context.targetWasPoisoned || !context.deliberateAction) return;
      if (owner._parasiteAction === context.deliberateAction) return;
      owner._parasiteAction = context.deliberateAction;
      const stolen = reduceHostileTurnMeter(target, 150);
      owner.turnMeter = Math.min(1000, (owner.turnMeter ?? 0) + stolen);
    },
  },
  'Споровой шторм': { artId: 'spore_storm', enemyArtId: 'spore_storm',
    name: 'Споровой шторм', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.NATURE,
    scalingStat: 'magAtk', targeting: 'allEnemies', damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 0.9),
    effect: { id: effectId('Отравление'), duration: 2 },
    description: 'Наносит всем противникам 90% магической атаки магическим уроном Природой и накладывает Отравление.',
    descriptionParts: ['Наносит всем противникам 90% магической атаки магическим уроном Природой и накладывает ', { statusId: 'poison', text: 'Отравление' }, '.'],
  },
  'Посмертный выброс спор': { artId: 'death_spore_burst',
    name: 'Посмертный выброс спор', passive: true,
    description: 'После смерти накладывает Отравление на всех живых противников.',
    descriptionParts: ['После смерти накладывает ', { statusId: 'poison', text: 'Отравление' }, ' на всех живых противников.'],
    onDeath: ({ owner, opponents = [], log }) => { livingUnits(opponents).forEach(unit => addEffect(unit, { id: 'poison', duration: 2 }, log, owner)); log?.(`🍄 ${owner?.name || 'Споровик'} при смерти отравляет живых противников.`); },
  },
  'Двойной укус': { artId: 'double_bite', enemyArtId: 'double_bite',
    name: 'Двойной укус', cooldown: 2, type: 'physical', scalingStat: 'attack',
    damage: ({ attacker, target }) => roundDamage((attacker?.attack ?? 0) * (hasEffect(target, 'poison') ? 1.3 : 1.05)),
    effect: [{ id: 'poison', duration: 2 }, { id: 'poison', duration: 2 }],
    description: 'Наносит 105% атаки физическим уроном, или 130%, если цель уже имеет Отравление. Затем накладывает два Отравления.',
    descriptionParts: ['Наносит 105% атаки физическим уроном, или 130%, если цель уже имеет ', { statusId: 'poison', text: 'Отравление' }, '. Затем накладывает два ', { statusId: 'poison', text: 'Отравления' }, '.'],
  },
  'Кровавый укус': { artId: 'bloody_bite', enemyArtId: 'bloody_bite',
    name: 'Кровавый укус', cooldown: 2, type: 'physical', scalingStat: 'attack',
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * 1.5),
    effect: [{ id: 'bleed', duration: 2 }, { id: 'vampire_mark', duration: 3 }],
    description: 'Наносит 150% атаки физическим уроном, накладывает Кровотечение и Метку вампира.',
    descriptionParts: ['Наносит 150% атаки физическим уроном, накладывает ', { statusId: 'bleed', text: 'Кровотечение' }, ' и ', { statusId: 'vampire_mark', text: 'Метку вампира' }, '.'],
  },
  'Осквернённый вампиризм': { artId: 'corrupted_vampirism',
    name: 'Осквернённый вампиризм', passive: true, vampirismBonus: 0.5,
    description: 'Усиливает восстановление через существующие Метки вампира на 50%, не создавая новых меток реактивно.',
    descriptionParts: ['Усиливает восстановление через существующие ', { statusId: 'vampire_mark', text: 'Метки вампира' }, ' на 50%, не создавая новых меток реактивно.'],
  },
  'Кровавая линька': { artId: 'bloody_molt',
    name: 'Кровавая линька', passive: true,
    description: 'Один раз при падении до половины здоровья очищает один отрицательный эффект, получает Уклонение на 1 ход и 20% шкалы хода.',
    descriptionParts: ['Один раз при падении до половины здоровья очищает один отрицательный эффект, получает ', { statusId: 'evasion', text: 'Уклонение' }, ' на 1 ход и 20% шкалы хода.'],
    onOwnerDamaged: ({ owner, session, log }) => {
      if (!owner || owner._bloodMoltUsed || owner.hp > owner.maxHp * 0.5) return;
      owner._bloodMoltUsed = true; removeRandomNegativeEffect(owner, () => 0, log);
      addEffect(owner, { id: effectId('Уклонение'), duration: 1 }, log, owner, { session });
      owner.turnMeter = Math.min(1000, (owner.turnMeter ?? 0) + 200);
    },
  },
  'Осколочный тотем': { artId: 'shard_totem',
    name: 'Осколочный тотем', passive: true,
    description: 'В начале боя получает Щит 20% максимального здоровья; разрушение выпускает осколки Молнии и накладывает Замедление.',
    descriptionParts: ['В начале боя получает ', { statusId: 'shield', text: 'Щит' }, ' 20% максимального здоровья; разрушение выпускает осколки Молнии и накладывает ', { statusId: 'speed_penalty_minor', text: 'Замедление' }, '.'],
    onBattleStart: ({ owner, session, log }) => addEffect(owner, { id: 'shield', duration: 3, value: roundDamage(owner.maxHp * 0.2), onBreak: { damageMultiplier: 0.35, type: 'magical', school: MAGIC_SCHOOLS.LIGHTNING, effects: [{ id: effectId('Замедление'), duration: 1 }], target: 'enemies' } }, log, owner, { session }),
  },
  'Наращивание тотема': { artId: 'totem_growth', enemyArtId: 'totem_growth',
    name: 'Наращивание тотема', cooldown: 3, damage: 0, type: 'support', targeting: 'self',
    canUse: ({ attacker }) => (attacker?.shield ?? 0) < (attacker?.maxHp ?? 0) * 0.08,
    aiScore: 3,
    description: 'Восстанавливает Щит в размере 18% максимального здоровья, только когда защита истощена.',
    descriptionParts: ['Восстанавливает ', { statusId: 'shield', text: 'Щит' }, ' в размере 18% максимального здоровья, только когда защита истощена.'],
    apply: ({ attacker, session, log }) => addEffect(attacker, { id: 'shield', duration: 3, value: roundDamage(attacker.maxHp * 0.18) }, log, attacker, { session }),
  },
  'Призматический удар': { artId: 'prismatic_strike', enemyArtId: 'prismatic_strike',
    name: 'Призматический удар', cooldown: 2, type: 'magical', school: MAGIC_SCHOOLS.LIGHTNING,
    scalingStat: 'magAtk', damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 1.65),
    shieldDamageMultiplier: 1.75,
    effect: { id: effectId('Шок'), duration: 1 },
    description: 'Наносит 165% магической атаки уроном Молнии, на 75% больше урона Щиту и накладывает Шок на 1 ход.',
    descriptionParts: ['Наносит 165% магической атаки уроном Молнии, на 75% больше урона ', { statusId: 'shield', text: 'Щиту' }, ' и накладывает ', { statusId: 'shock', text: 'Шок' }, ' на 1 ход.'],
  },
  'Споровой выброс': { artId: 'spore_burst', enemyArtId: 'spore_burst',
    name: 'Споровой выброс', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.NATURE, targeting: 'allEnemies', scalingStat: 'magAtk',
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 1.2), effect: { id: 'poison', duration: 2 },
    description: 'Наносит всем противникам 120% магической атаки магическим уроном Природой и накладывает Отравление.',
    descriptionParts: ['Наносит всем противникам 120% магической атаки магическим уроном Природой и накладывает ', { statusId: 'poison', text: 'Отравление' }, '.'],
  },
  'Грибная сеть': { artId: 'fungal_network', enemyArtId: 'fungal_network',
    name: 'Грибная сеть', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.NATURE, targeting: 'allEnemies', scalingStat: 'magAtk',
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 1.2),
    description: 'Наносит всем противникам 120% магической атаки магическим уроном Природой и отнимает 20% шкалы хода.',
    apply: ({ targets = [] }) => targets.forEach(target => { reduceHostileTurnMeter(target, 200); }),
  },
  'Мицелиевое питание': { artId: 'mycelium_feeding',
    name: 'Мицелиевое питание', passive: true,
    description: 'В первой фазе в начале хода восстанавливает 8% максимального здоровья, если у героя есть Отравление. Число Отравлений и призывов не влияет.',
    descriptionParts: ['В первой фазе в начале хода восстанавливает 8% максимального здоровья, если у героя есть ', { statusId: 'poison', text: 'Отравление' }, '. Число Отравлений и призывов не влияет.'],
    onTurnStart: ({ owner, session, log }) => {
      if (!owner || owner._myceliumPhaseTwoTriggered) return;
      const hero = session?.state?.players?.[0];
      if (!hasEffect(hero, 'poison')) return;
      const heal = roundDamage(owner.maxHp * 0.08); owner.hp = Math.min(owner.maxHp, owner.hp + heal);
      log?.(`🍄 Мицелиевое питание восстанавливает ${heal} здоровья.`);
    },
  },
  'Споровой паралич': { artId: 'spore_paralysis', enemyArtId: 'spore_paralysis',
    name: 'Споровой паралич', cooldown: 2, type: 'magical', school: MAGIC_SCHOOLS.NATURE, scalingStat: 'magAtk',
    canUse: ({ attacker }) => Boolean(attacker?._myceliumPhaseTwoTriggered),
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 1.65),
    description: 'Во второй фазе наносит 165% магической атаки магическим уроном Природой. Если цель уже имеет Отравление, она теряет 20% шкалы хода.',
    descriptionParts: ['Во второй фазе наносит 165% магической атаки магическим уроном Природой. Если цель уже имеет ', { statusId: 'poison', text: 'Отравление' }, ', она теряет 20% шкалы хода.'],
    apply: ({ target }) => { if (hasEffect(target, 'poison')) reduceHostileTurnMeter(target, 200); },
  },
  'Буран': {
    artId: 'blizzard', name: 'Буран', cooldown: 4, targeting: 'allEnemies', type: 'magical', school: MAGIC_SCHOOLS.ICE, scalingStat: 'magAtk',
    damage: ({ attacker, target }) => { target._blizzardWasSlowed = (target.effects || []).some(effect => effect?.id === 'speed_penalty_minor' || effect?.id === 'speed_penalty_major'); return roundDamage((attacker?.magAtk ?? 0) * 0.85); },
    effect: { id: 'speed_penalty_major', duration: 2 },
    apply: ({ targets = [], hitTargets = [], attacker, session, log }) => {
      const hitSet = new Set(hitTargets);
      targets.forEach(target => {
        if (hitSet.has(target) && target._blizzardWasSlowed) {
          addEffect(target, { id: 'freeze', duration: 1 }, log, attacker, { session, elementalistControlFallback: true });
        }
        delete target._blizzardWasSlowed;
      });
      const talent = selectedTalent(attacker, 'mage.blizzard');
      hitTargets.forEach(target => {
        if (!target || target.hp <= 0) return;
        if (talent === 'mage.blizzard.ice_front') reduceHostileTurnMeter(target, 150);
        if (talent === 'mage.blizzard.shard_storm') {
          addEffect(target, { id: 'ice_shards', stacks: 2 }, log, attacker, { session });
        }
      });
    },
    description: 'Наносит всем врагам 85% магической атаки уроном Льда и накладывает Сильное замедление на 2 хода. Уже замедленные цели также получают Заморозку на 1 ход; при иммунитете к Заморозке — 1 Ледяной осколок.',
    descriptionParts: ['Наносит всем врагам 85% магической атаки уроном Льда и накладывает ', { statusId: 'speed_penalty_major', text: 'Сильное замедление' }, ' на 2 хода. Уже замедленные цели также получают ', { statusId: 'freeze', text: 'Заморозку' }, ' на 1 ход; при иммунитете к ', { statusId: 'freeze', text: 'Заморозке' }, ' — 1 ', { statusId: 'ice_shards', text: 'Ледяной осколок' }, '.'],
  },
  'Грозовой разряд': {
    artId: 'storm_discharge', name: 'Грозовой разряд', cooldown: 1, type: 'magical', school: MAGIC_SCHOOLS.LIGHTNING, scalingStat: 'magAtk',
    damage: ({ attacker, target }) => { target._stormWasPrepared = hasEffect(target, 'shock') || hasEffect(target, 'charge') || hasEffect(target, 'conductivity'); return roundDamage((attacker?.magAtk ?? 0) * (target._stormWasPrepared ? 1.8 : 1.4)); },
    effect: { id: 'shock', duration: 1 },
    beforeDirectDamage: ({ attacker, target, session, log, deliberateAction }) => {
      if (!target || selectedTalent(attacker, 'mage.thunder_discharge') !== 'mage.thunder_discharge.conductor') return;
      addEffect(target, { id: 'conductivity', duration: 2 }, log, attacker, { session, deliberateAction });
    },
    afterDirectDamage: ({ attacker, target, session, log, deliberateAction }) => {
      if (!target || target.hp <= 0
        || selectedTalent(attacker, 'mage.thunder_discharge') !== 'mage.thunder_discharge.overload') return;
      addEffect(target, { id: 'charge' }, log, attacker, {
        session,
        deliberateAction,
        chargeDischargeMultiplier: 1.2,
      });
    },
    apply: ({ target }) => { if (target?._stormWasPrepared) reduceHostileTurnMeter(target, 200); if (target) delete target._stormWasPrepared; },
    description: 'Наносит 140% магической атаки уроном Молнии, или 180%, если цель уже под Шоком, имеет Заряд или Проводимость; в усиленном случае также уменьшает её шкалу хода на 20%. После удара накладывает Шок на 1 ход, а при иммунитете к Шоку — 1 Заряд.',
    descriptionParts: ['Наносит 140% магической атаки уроном Молнии, или 180%, если цель уже под ', { statusId: 'shock', text: 'Шоком' }, ', имеет ', { statusId: 'charge', text: 'Заряд' }, ' или ', { statusId: 'conductivity', text: 'Проводимость' }, '; в усиленном случае также уменьшает её шкалу хода на 20%. После удара накладывает ', { statusId: 'shock', text: 'Шок' }, ' на 1 ход, а при иммунитете к ', { statusId: 'shock', text: 'Шоку' }, ' — 1 ', { statusId: 'charge', text: 'Заряд' }, '.'],
  },
  'Стихийное эхо': {
    artId: 'elemental_echo', name: 'Стихийное эхо', cooldown: 2, type: 'magical', scalingStat: 'magAtk',
    canUse: ({ attacker }) => [MAGIC_SCHOOLS.FIRE, MAGIC_SCHOOLS.ICE, MAGIC_SCHOOLS.LIGHTNING].includes(attacker?._lastElementalSchool),
    disabledReason: 'Сначала примените способность Огня, Льда или Молнии',
    schoolResolver: ({ attacker }) => attacker?._lastElementalSchool,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 1.3),
    effect: ({ attacker }) => { const school = attacker?._lastElementalSchool; return { id: ({ fire: 'burn', ice: 'freeze', lightning: 'shock' })[school], duration: school === MAGIC_SCHOOLS.FIRE ? 2 : 1 }; },
    secondary: {
      target: 'otherEnemies',
      type: 'magical',
      schoolResolver: ({ attacker }) => attacker?._lastElementalSchool,
      noElementalResonance: true,
      condition: ({ attacker, primaryHit }) => Boolean(
        primaryHit && selectedTalent(attacker, 'mage.elemental_echo') === 'mage.elemental_echo.echo_roll'
      ),
      damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 0.5),
    },
    apply: ({ attacker, target, hitTargets = [], session, log }) => {
      if (!target || !hitTargets.includes(target)
        || selectedTalent(attacker, 'mage.elemental_echo') !== 'mage.elemental_echo.saturated_echo') return;
      const school = attacker?._lastElementalSchool;
      const effectBySchool = {
        [MAGIC_SCHOOLS.FIRE]: { id: 'charring', duration: 3, stacks: 2 },
        [MAGIC_SCHOOLS.ICE]: { id: 'ice_shards', stacks: 2 },
        [MAGIC_SCHOOLS.LIGHTNING]: { id: 'charge', stacks: 2 },
      };
      const extraEffect = effectBySchool[school];
      if (extraEffect) addEffect(target, extraEffect, log, attacker, { session });
    },
    description: 'Повторяет последнюю использованную стихию: наносит основной цели 130% магической атаки той же стихией и накладывает Горение на 2 хода, Заморозку на 1 ход или Шок на 1 ход. Иммунитет к контролю заменяет Заморозку на 1 Ледяной осколок, а Шок — на 1 Заряд.',
    descriptionParts: ['Повторяет последнюю использованную стихию: наносит основной цели 130% магической атаки той же стихией и накладывает ', { statusId: 'burn', text: 'Горение' }, ' на 2 хода, ', { statusId: 'freeze', text: 'Заморозку' }, ' на 1 ход или ', { statusId: 'shock', text: 'Шок' }, ' на 1 ход. Иммунитет к контролю заменяет ', { statusId: 'freeze', text: 'Заморозку' }, ' на 1 ', { statusId: 'ice_shards', text: 'Ледяной осколок' }, ', а ', { statusId: 'shock', text: 'Шок' }, ' — на 1 ', { statusId: 'charge', text: 'Заряд' }, '.'],
  },
  'Призыв элементаля': {
    artId: 'elemental', name: 'Призыв элементаля', cooldown: 5, damage: 0, type: 'support', targeting: 'self',
    canUse: ({ session }) => typeof session?.summonPlayer === 'function' && !(session.state.players || []).some(unit => unit?.elementalistElemental && unit.hp > 0) && (session.state.players || []).filter(unit => unit?.hp > 0).length < 3,
    disabledReason: 'Нет свободного места или элементаль уже призван',
    apply: ({ attacker, session, log, deliberateAction }) => {
      const talent = selectedTalent(attacker, 'mage.summon_elemental');
      const variant = talent === 'mage.summon_elemental.greater_fire'
        ? 'greater_fire'
        : talent === 'mage.summon_elemental.lightning'
          ? 'lightning'
          : talent === 'mage.summon_elemental.ice'
            ? 'ice'
            : null;
      const result = session?.summonPlayer?.('fire_elemental', { source: attacker, variant });
      if (deliberateAction) deliberateAction.elementalSummonSucceeded = result?.success === true;
      if (!result?.success) log?.('Призыв элементаля невозможен.');
    },
    description: 'Призывает элементаля выбранной формы. Пока он жив, второго элементаля призвать нельзя.',
  },
  'Волчья яма': {
    artId: 'wolf_pit', name: 'Волчья яма', cooldown: 3, damage: 0, type: 'support', targeting: 'self',
    canUse: ({ attacker }) => !attacker?._armedTrap,
    disabledReason: 'Ловушка уже установлена',
    apply: ({ attacker }) => {
      attacker._armedTrap = {
        type: 'wolf_pit',
        talentId: selectedTalent(attacker, 'archer.wolf_pit'),
      };
    },
    description: 'Следующий враг после своего действия получает два Кровотечения и Оглушение на 1 ход. Невосприимчивая к контролю цель вместо этого получает три Кровотечения.',
    descriptionParts: ['Следующий враг после своего действия получает два ', { statusId: 'bleed', text: 'Кровотечения' }, ' и ', { statusId: 'stun', text: 'Оглушение' }, ' на 1 ход. Невосприимчивая к контролю цель вместо этого получает три ', { statusId: 'bleed', text: 'Кровотечения' }, '.'],
  },
  'Перенаправление': {
    artId: 'redirect', name: 'Перенаправление', cooldown: 4, damage: 0, type: 'support', targeting: 'self',
    apply: ({ attacker }) => {
      attacker._redirectPrepared = {
        talentId: selectedTalent(attacker, 'archer.redirect'),
      };
    },
    description: 'До следующего хода перенаправляет следующую одиночную атаку по Лучнику в другого врага. Если враг один, Лучник гарантированно уклоняется.',
  },
  'Залп стрел': {
    artId: 'arrow_volley', name: 'Залп стрел', cooldown: 3, targeting: 'allEnemies', type: 'physical', scalingStat: 'attack',
    damage: ({ attacker }) => roundDamage((attacker?.attack ?? 0) * 1.1),
    effect: ({ session }) => ((typeof session?.rng === 'function' ? session.rng() : Math.random()) < 0.35 ? { id: 'bleed', duration: 2 } : null),
    apply: ({ attacker, target, hitTargets = [], session, log }) => {
      const talent = selectedTalent(attacker, 'archer.volley');
      const survivingHits = hitTargets.filter(unit => unit?.hp > 0);

      if (talent === 'archer.volley.wide_barrage' && survivingHits.length > 0) {
        let markTarget = target && target.hp > 0 && survivingHits.includes(target) ? target : null;
        if (!markTarget) {
          const rng = typeof session?.rng === 'function' ? session.rng : Math.random;
          const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
          markTarget = survivingHits[Math.floor(roll * survivingHits.length)] || survivingHits[0];
        }
        addEffect(markTarget, { id: 'hunting_mark', duration: 2 }, log, attacker, { session });
      }

      if (talent === 'archer.volley.suppressive_fire') {
        survivingHits.forEach(unit => {
          addEffect(unit, { id: effectId('Ослабление'), duration: 2 }, log, attacker, { session });
        });
      }
    },
    description: 'Наносит всем врагам 110% атаки физическим уроном. Каждый враг с вероятностью 35% получает Кровотечение на 2 хода.',
    descriptionParts: ['Наносит всем врагам 110% атаки физическим уроном. Каждый враг с вероятностью 35% получает ', { statusId: 'bleed', text: 'Кровотечение' }, ' на 2 хода.'],
  },
  'Змеиная ловушка': {
    artId: 'snake_trap', name: 'Змеиная ловушка', cooldown: 4, damage: 0, type: 'support', targeting: 'self',
    canUse: ({ attacker }) => !attacker?._armedTrap,
    disabledReason: 'Ловушка уже установлена',
    apply: ({ attacker }) => {
      const talentId = selectedTalent(attacker, 'archer.snake_trap');
      const activationsRemaining = talentId === 'archer.snake_trap.snake_tangle' ? 2 : 1;
      const payload = { type: 'snake_trap', talentId, activationsRemaining };
      attacker._armedTrap = {
        ...payload,
        _summonTemplate: {
          form: 'owner_slot',
          slot: '_armedTrap',
          payload,
        },
      };
    },
    description: 'После следующего действия врага ловушка дважды кусает его: каждый укус наносит 60% атаки и накладывает Отравление.',
    descriptionParts: ['После следующего действия врага ловушка дважды кусает его: каждый укус наносит 60% атаки и накладывает ', { statusId: 'poison', text: 'Отравление' }, '.'],
  },
  'Огненный сгусток': { artId: 'fire_elemental_firebolt', name: 'Огненный сгусток', basic: true, cooldown: 0, type: 'magical', school: MAGIC_SCHOOLS.FIRE, damage: ({ attacker }) => roundDamage(attacker?.magAtk ?? 0), description: 'Наносит 100% магической атаки уроном Огня.' },
  'Разжечь': { artId: 'fire_elemental_ignite', name: 'Разжечь', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.FIRE, damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 1.1), effect: { id: 'burn', duration: 2 }, description: 'Наносит 110% магической атаки уроном Огня и накладывает Горение.', descriptionParts: ['Наносит 110% магической атаки уроном Огня и накладывает ', { statusId: 'burn', text: 'Горение' }, '.'] },
  'Разжечь великого элементаля': {
    artId: 'fire_elemental_ignite',
    name: 'Разжечь',
    cooldown: 3,
    type: 'magical',
    school: MAGIC_SCHOOLS.FIRE,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 1.1),
    effect: [{ id: 'burn', duration: 2 }, { id: 'charring', duration: 3 }],
    description: 'Наносит 110% магической атаки уроном Огня, накладывает Горение на 2 хода и 1 Обугливание на 3 хода.',
  },
  'Пылающее ядро': { artId: 'fire_elemental_blazing_core', name: 'Пылающее ядро', passive: true, description: 'При гибели наносит всем врагам 70% магической атаки уроном Огня.', onDeath: ({ owner, opponents = [], session, log }) => opponents.filter(unit => unit.hp > 0).forEach(unit => session?.applyIndirectDamage?.(unit, roundDamage((owner?.magAtk ?? 0) * 0.7), 'magical', { source: owner, magicSchool: MAGIC_SCHOOLS.FIRE, log })) },
  'Великое пылающее ядро': { artId: 'fire_elemental_blazing_core', name: 'Пылающее ядро', passive: true, description: 'При гибели наносит всем врагам 100% магической атаки уроном Огня.', onDeath: ({ owner, opponents = [], session, log }) => opponents.filter(unit => unit.hp > 0).forEach(unit => session?.applyIndirectDamage?.(unit, roundDamage(owner?.magAtk ?? 0), 'magical', { source: owner, magicSchool: MAGIC_SCHOOLS.FIRE, log })) },
  'Разряд молниевого элементаля': {
    artId: 'lightning_elemental_attack',
    name: 'Разряд',
    basic: true,
    cooldown: 0,
    type: 'magical',
    school: MAGIC_SCHOOLS.LIGHTNING,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 0.8),
    allyAfterDirectDamage: ({ attacker, target, session, log, deliberateAction }) => {
      if (!target || target.hp <= 0 || !deliberateAction?.successfulDirectHit) return;
      addEffect(target, { id: 'charge' }, log, attacker, { session, deliberateAction });
    },
    description: 'Наносит 80% магической атаки уроном Молнии. После попадания накладывает 1 Заряд.',
  },
  'Грозовой импульс': {
    artId: 'lightning_elemental_discharge',
    name: 'Грозовой импульс',
    cooldown: 3,
    type: 'magical',
    school: MAGIC_SCHOOLS.LIGHTNING,
    damage: ({ attacker }) => roundDamage(attacker?.magAtk ?? 0),
    allyAfterDirectDamage: ({ attacker, target, session, log, deliberateAction }) => {
      if (!target || !deliberateAction?.successfulDirectHit) return;
      if (target.hp > 0) addEffect(target, { id: 'conductivity', duration: 2 }, log, attacker, { session, deliberateAction });
      grantSummonerTurnMeter(attacker, session, 200, log);
    },
    description: 'Наносит 100% магической атаки уроном Молнии, накладывает Проводимость на 2 хода и заполняет шкалу хода призывателя на 20%.',
  },
  'Последний импульс': {
    artId: 'lightning_elemental_last_impulse',
    name: 'Последний импульс',
    passive: true,
    description: 'При гибели заполняет шкалу хода призывателя на 30%.',
    onDeath: ({ owner, session, log }) => grantSummonerTurnMeter(owner, session, 300, log),
  },
  'Ледяной снаряд': {
    artId: 'ice_elemental_icebolt',
    name: 'Ледяной снаряд',
    basic: true,
    cooldown: 0,
    type: 'magical',
    school: MAGIC_SCHOOLS.ICE,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 0.7),
    allyAfterDirectDamage: ({ attacker, target, session, log, deliberateAction }) => {
      if (!target || target.hp <= 0 || !deliberateAction?.successfulDirectHit) return;
      addEffect(target, { id: 'ice_shards' }, log, attacker, { session, deliberateAction });
    },
    description: 'Наносит 70% магической атаки уроном Льда. После попадания добавляет 1 Ледяной осколок.',
  },
  'Морозная хватка': {
    artId: 'ice_elemental_frost_grasp',
    name: 'Морозная хватка',
    cooldown: 3,
    type: 'magical',
    school: MAGIC_SCHOOLS.ICE,
    damage: ({ attacker }) => roundDamage((attacker?.magAtk ?? 0) * 0.9),
    allyAfterDirectDamage: ({ attacker, target, session, log, deliberateAction }) => {
      if (!target || target.hp <= 0 || !deliberateAction?.successfulDirectHit) return;
      const wasSlowed = hasEffect(target, 'speed_penalty_minor') || hasEffect(target, 'speed_penalty_major');
      addEffect(target, { id: 'speed_penalty_major', duration: 2 }, log, attacker, { session, deliberateAction });
      if (wasSlowed) {
        addEffect(target, { id: 'freeze', duration: 1 }, log, attacker, {
          session,
          deliberateAction,
          elementalistControlFallback: true,
        });
      }
    },
    description: 'Наносит 90% магической атаки уроном Льда и накладывает Сильное замедление на 2 хода. Если цель уже была замедлена, также накладывает Заморозку на 1 ход; иммунитет к Заморозке заменяет её 1 Ледяным осколком.',
  },
  'Ледяное наследие': {
    artId: 'ice_elemental_frozen_legacy',
    name: 'Ледяное наследие',
    passive: true,
    description: 'При гибели даёт призывателю Щит в размере 20% его максимального здоровья на 2 хода.',
    onDeath: ({ owner, session, log }) => grantSummonerShield(owner, session, 0.2, 2, log),
  },
  lightning_speed: { id: 'lightning_speed', name: 'Скорость молнии', passive: true, description: 'Когда враг пропускает ход из-за Шока Элементалиста или его элементаля либо на враге разряжаются 3 их Заряда, Элементалист получает 15% шкалы хода и Ускорение на 2 хода. Разряд даёт бонус не чаще одного раза за применение способности.', descriptionParts: ['Когда враг пропускает ход из-за ', { statusId: 'shock', text: 'Шока' }, ' Элементалиста или его элементаля либо на враге разряжаются 3 их ', { statusId: 'charge', text: 'Заряда' }, ', Элементалист получает 15% шкалы хода и ', { statusId: 'speed_boost_minor', text: 'Ускорение' }, ' на 2 хода. Разряд даёт бонус не чаще одного раза за применение способности.'] },
  elemental_shell: { id: 'elemental_shell', name: 'Стихийная оболочка', passive: true, description: 'После завершения атакующей способности первая цель, на которой сработала стихийная реакция, даёт Щит 10% максимального здоровья; каждая дополнительная цель — ещё 5%, максимум 20% за применение. Щит действует 2 хода; каждая цель учитывается один раз.', descriptionParts: ['После завершения атакующей способности первая цель, на которой сработала стихийная реакция, даёт ', { statusId: 'shield', text: 'Щит' }, ' 10% максимального здоровья; каждая дополнительная цель — ещё 5%, максимум 20% за применение. Щит действует 2 хода; каждая цель учитывается один раз.'] },
  overheat: {
    id: 'overheat', name: 'Перегрев', passive: true,
    description: 'Способность Льда или Молнии даёт 1 заряд Перегрева, максимум 2. Следующая атакующая способность Огня расходует все заряды и получает +20% прямого урона за каждый; при 2 зарядах поражённые цели также получают 1 Обугливание на 3 хода. Морозный щит набирает заряд, Стихийное эхо учитывает повторяемую стихию; Огонь без прямого урона заряды не расходует.',
    descriptionParts: ['Способность Льда или Молнии даёт 1 заряд ', { statusId: 'overheat', text: 'Перегрева' }, ', максимум 2. Следующая атакующая способность Огня расходует все заряды и получает +20% прямого урона за каждый; при 2 зарядах поражённые цели также получают 1 ', { statusId: 'charring', text: 'Обугливание' }, ' на 3 хода. Морозный щит набирает заряд, Стихийное эхо учитывает повторяемую стихию; Огонь без прямого урона заряды не расходует.'],
  },
  elemental_resonance: { id: 'elemental_resonance', name: 'Стихийный резонанс', passive: true, description: 'После применения атакующей способности Огня, Льда или Молнии поражённые цели получают один дополнительный эффект её стихии: Огонь — 1 Обугливание на 3 хода, Лёд — 1 Ледяной осколок, Молния — 75% 1 Заряд и 25% Проводимость на 2 хода. Для Молнии результат выбирается один раз на применение и одинаков для всех целей; эффект накладывается после урона и стихийных реакций.' },
  finish_the_prey: { id: 'finish_the_prey', name: 'Добить добычу', passive: true, description: 'Когда враг впервые опускается до 30% здоровья от урона Лучника, шкала хода заполняется на 15%.' },
  initiative: { id: 'initiative', name: 'Опережение', passive: true, description: 'Каждый дополнительный ход Лучника до полного хода врага увеличивает прямой урон на 10%, максимум на 30%.', modifyDamage: ({ damage, attacker, ability }) => ability?.passive || ability?.isSecondaryDamage ? damage : damage * (1 + Math.min(3, attacker?._initiativeStacks || 0) * 0.1) },
  false_trail: { id: 'false_trail', name: 'Ложный след', passive: true, onBattleStart: ({ owner }) => { owner.dodge = (owner.dodge ?? 0) + 0.05; }, modifyDamage: ({ damage, attacker, ability }) => attacker?._falseTrailReady && !ability?.passive ? damage * 1.2 : damage },
  hunting_rhythm: { id: 'hunting_rhythm', name: 'Охотничий ритм', passive: true, description: 'Срабатывание ловушки заполняет шкалу хода на 50%.' },
  'Тяжёлый замах': {
    name: 'Тяжёлый замах', cooldown: 3, damage: 0, type: 'support',
    description: 'Выбирает цель и готовит удар. В начале следующего собственного хода наносит 200% атаки; контроль срывает подготовку.',
    canUse: ({ attacker }) => !attacker?._preparation,
    apply: ({ attacker, target, log }) => {
      attacker._preparation = { kind: 'heavy_swing', resolveName: 'Тяжёлый замах', target, damageMultiplier: 2, type: 'physical' };
      log?.(`⚔️ ${attacker.name} начинает подготовку: Тяжёлый замах.`);
    },
  },
  'Размашистый удар': { name: 'Размашистый удар', cooldown: 3, targeting: 'allEnemies', damage: ({attacker}) => roundDamage((attacker?.attack||0)*1.15), type: 'physical', description: 'Наносит всем противникам 115% физического урона от Атаки.' },
  'Выжидающий выстрел': {
    name: 'Выжидающий выстрел', cooldown: 3, damage: 0, type: 'support',
    description: 'Готовит выстрел: 125% атаки, либо 165%, если после подготовки другой Отступник наложил снимаемый штраф.',
    canUse: ({ attacker }) => !attacker?._preparation,
    apply: ({ attacker, target, log }) => {
      attacker._preparation = { kind: 'waiting_shot', resolveName: 'Выжидающий выстрел', target, damageMultiplier: 1.25, bonusDamageMultiplier: 1.65, negativeEffectSerial: target?._negativeEffectSerial || 0, type: 'physical' };
      log?.(`🏹 ${attacker.name} начинает подготовку выстрела.`);
    },
  },
  'Силки': {
    name: 'Силки', cooldown: 3, damage: 0, type: 'support',
    description: 'Выставляет объект с 1 ед. здоровья без шкалы хода. Способность или непрямой урон активируют ловушку: 70% атаки и Сильное замедление на 2 хода.',
    canUse: ({ attacker, session }) => !(session?.state?.enemies || []).some(unit => unit?.nonActingCombatObject && unit.hp > 0 && unit.ownerId === attacker?.id),
    apply: ({ attacker, session, log }) => {
      const object = session?.spawnEnemyCombatObject?.({ owner: attacker, name: 'Силки', triggerDamageMultiplier: 0.7, triggerEffect: { id: 'speed_penalty_major', duration: 2 } });
      if (object) log?.('🪤 Следопыт выставляет Силки.');
    },
  },
  'Полевой набор': { name:'Полевой набор', passive:true, description:'Аптекарь начинает бой с 2 Припасами (3 при Тревоге II–III).', onBattleStart:({owner,session})=>setEffectStackCount(owner,'supplies',(session?.alertLevel||0)>=2?3:2) },
  'Экстренный стимулятор': { name:'Экстренный стимулятор', cooldown:0, damage:0, type:'support', targeting:'ally', description:'Расходует 1 Припас: лечит 15% максимального здоровья и даёт +200 шкалы хода.', canUse:({attacker,candidateTargets=[]})=>getEffectStackCount(attacker,'supplies')>0&&candidateTargets.some(x=>missingHp(x)>0), targetScore:({target})=>healingTargetScore(target,.15), apply:({attacker,target,session,log})=>{if(getEffectStackCount(attacker,'supplies')<=0||missingHp(target)<=0)return;consumeEffectStacks(attacker,'supplies',1);session.state.metrics||={};session.state.metrics.apothecaryChargesSpent=(session.state.metrics.apothecaryChargesSpent||0)+1;target.hp=Math.min(target.maxHp,target.hp+roundDamage(target.maxHp*.15));target.turnMeter=Math.min(1000,(target.turnMeter||0)+200);log?.(`🧪 Припасы: осталось ${getEffectStackCount(attacker,'supplies')}.`)} },
  'Очищающий состав': { name:'Очищающий состав', cooldown:0, damage:0, type:'support', targeting:'ally', description:'Расходует 1 Припас и снимает до 2 снимаемых негативных эффектов.', canUse:({attacker,candidateTargets=[]})=>getEffectStackCount(attacker,'supplies')>0&&candidateTargets.some(hasRemovableDebuff), targetScore:({target})=>(target.effects||[]).filter(e=>e.type==='debuff'||e.kind==='debuff').length, apply:({attacker,target,session,log})=>{if(getEffectStackCount(attacker,'supplies')<=0||!hasRemovableDebuff(target))return;consumeEffectStacks(attacker,'supplies',1);session.state.metrics||={};session.state.metrics.apothecaryChargesSpent=(session.state.metrics.apothecaryChargesSpent||0)+1;let n=0;cleanseEffects(target,e=>(e.type==='debuff'||e.kind==='debuff')&&n++<2,log);log?.(`🧪 Припасы: осталось ${getEffectStackCount(attacker,'supplies')}.`)} },
  'Ослепляющая уловка': { name:'Ослепляющая уловка',cooldown:3,damage:0,type:'support',effect:{id:'blind',duration:1},description:'Накладывает Слепоту на 1 ход.' },
  'Удар из марева': { name:'Удар из марева',cooldown:2,type:'physical',damage:({attacker})=>roundDamage((attacker?.attack||0)*(hasEffect(attacker,'invisibility')?1.8:1.35)),description:'135% атаки; под Невидимостью — 180% и снимает её.',apply:({attacker,log})=>{if(hasEffect(attacker,'invisibility'))cleanseEffects(attacker,e=>e.id==='invisibility',log)} },
  'Исчезающий трюк': { name:'Исчезающий трюк',passive:true,onTargetedDirectMiss:{effect:{id:'invisibility',duration:1}},description:'Когда прямая прицельная атака промахивается, получает Невидимость.' },
  'Школа дуэлянта': { name:'Школа дуэлянта',passive:true,attackRhythm:{maxStacks:3},description:'Каждое успешное прямое атакующее действие даёт 1 Боевой ритм, максимум 3.' },
  'Завершающий выпад': { name:'Завершающий выпад',cooldown:2,type:'physical',consumesRhythm:true,damage:({attacker})=>roundDamage((attacker?.attack||0)*(1.2+.25*Math.min(3,(attacker?.effects||[]).filter(e=>e.id==='combat_rhythm').length))),description:'120% атаки +25 п.п. за заряд Боевого ритма; расходует все заряды.',apply:({attacker,log})=>cleanseEffects(attacker,e=>e.id==='combat_rhythm',log) },
  'Проклятие истощения': { name:'Проклятие истощения',cooldown:3,damage:0,type:'support',effect:{id:'curse_of_exhaustion',duration:3},description:'Следующая активная классовая способность цели получает +1 к восстановлению.' },
  'Кровавая расплата': { name:'Кровавая расплата',cooldown:2,type:'magical',school:MAGIC_SCHOOLS.BLOOD,damage:({attacker})=>roundDamage((attacker?.magAtk||0)*(attacker?._exhaustionEmpowered?1.6:1.1)),description:'110% магической атаки, или 160% после срабатывания проклятия.',apply:({attacker})=>{attacker._exhaustionEmpowered=false} },
  'Наводка': { name:'Наводка',cooldown:2,type:'magical',school:MAGIC_SCHOOLS.LIGHTNING,damage:({attacker})=>roundDamage((attacker?.magAtk||0)*.8),effect:{id:'elemental_magic_vulnerability',duration:1},description:'80% магической атаки Молнией и Стихийная уязвимость на 1 ход.' },
  'Грозовой приказ': { name:'Грозовой приказ',cooldown:3,damage:0,type:'support',targeting:'ally',description:'Следующая прямая атака союзника получает дополнительный удар Молнией: 55% магической атаки Заклинателя.',apply:({attacker,target})=>{target._stormOrder={caster:attacker,damage:roundDamage((attacker.magAtk||0)*.55)}} },
  'Грозовой щит': { name:'Грозовой щит',cooldown:3,damage:0,type:'support',targeting:'ally',description:'Обычный Щит 20% максимального здоровья; прямое попадание вызывает один ответный разряд за действие.',apply:({attacker,target,session,log})=>addEffect(target,{id:'shield',duration:3,value:roundDamage(target.maxHp*.2),extra:{stormRetaliation:{caster:attacker,casterId:attacker.id,multiplier:.4,chance:.2}}},log,attacker,{session}) },
  'Проводник грозы': { name:'Проводник грозы',passive:true,stormConductor:true,description:'Три последовательных вражеских хода с положительным уроном Молнией накладывают Шок на 1 ход.' },
  'Подхват слабости': { name:'Подхват слабости',cooldown:2,type:'physical',damage:({attacker})=>roundDamage((attacker?.attack||0)*1.3),description:'130% атаки; продлевает на 1 ход один снимаемый штраф с наименьшей длительностью.',apply:({target})=>{const e=(target.effects||[]).filter(x=>(x.type==='debuff'||x.kind==='debuff')&&!x.unremovable&&Number.isFinite(x.remainingTurns)).sort((a,b)=>a.remainingTurns-b.remainingTurns||String(a.id).localeCompare(String(b.id)))[0];if(e){e.remainingTurns++;e.duration=e.remainingTurns}} },
  'Сбить строй': { name:'Сбить строй',cooldown:3,type:'physical',damage:({attacker})=>roundDamage((attacker?.attack||0)*1.15),description:'115% атаки; сокращает все временные снимаемые положительные эффекты на 1.',apply:({target,log})=>{const expiring=[];(target.effects||[]).forEach(e=>{if((e.type==='buff'||e.kind==='buff')&&!e.unremovable&&Number.isFinite(e.remainingTurns)){e.remainingTurns--;e.duration=e.remainingTurns;if(e.remainingTurns<=0)expiring.push(e)}});if(expiring.length)cleanseEffects(target,e=>expiring.includes(e),log)} },
  'Рваный разрез': { name:'Рваный разрез',cooldown:2,type:'physical',damage:({attacker})=>roundDamage((attacker?.attack||0)*1.35),effect:[{id:'bleed',duration:3},{id:'vampire_mark',duration:1}],description:'135% атаки, Кровотечение на 3 хода и Метка вампира на 1 ход.' },
  'Вскрыть рану': {
    name: 'Вскрыть рану', cooldown: 2, type: 'physical', damage: ({ attacker }) => roundDamage((attacker?.attack || 0) * 1.15),
    description: '115% атаки и немедленное дополнительное срабатывание Кровотечения.',
    apply: ({ attacker, target, session, deliberateAction, log }) => {
      const bleed = (target?.effects || []).find(effect => effect?.id === 'bleed');
      if (!bleed) return;
      triggerEffectTick(target, bleed, {
        session, source: attacker, deliberateAction,
        applyDamage: (unit, amount, type, extra = {}) => session?.applyIndirectDamage?.(unit, amount, type, { ...extra, source: extra.source || attacker, deliberateAction }),
      }, log);
      const healed = (attacker._vampireHealingTotal || 0) - (deliberateAction?.vampireHealingBefore || 0);
      if (healed < 1) {
        bleed.remainingTurns = Math.max(0, (bleed.remainingTurns || 0) - 1);
        bleed.duration = bleed.remainingTurns;
        if (bleed.remainingTurns <= 0) cleanseEffects(target, effect => effect === bleed, log);
      }
    },
  },
  'Искажённая стойка': { name:'Искажённая стойка',cooldown:3,damage:0,type:'support',description:'Получает обычный Щит 25% максимального здоровья.',apply:({attacker,session,log})=>addEffect(attacker,{id:'shield',duration:3,value:roundDamage(attacker.maxHp*.25)},log,attacker,{session}) },
  'Разлом барьера': { name:'Разлом барьера',cooldown:3,type:'physical',shieldDamageMultiplier:2,damage:({attacker})=>roundDamage((attacker?.attack||0)*1.35),description:'135% атаки, двойной урон Щиту; получает 50% фактически разрушенного Щита.',apply:({attacker,session,deliberateAction,log})=>{const value=roundDamage((deliberateAction?.shieldDestroyed||0)*.5);if(value>0)addEffect(attacker,{id:'shield',duration:3,value},log,attacker,{session})} },
  'Искажённый удар': { name:'Искажённый удар',cooldown:2,type:'physical',shockIfTargetShielded:{chance:.2,duration:1},damage:({attacker})=>roundDamage((attacker?.attack||0)*1.15),secondary:{target:'target',type:'magical',school:MAGIC_SCHOOLS.LIGHTNING,damage:({attacker})=>roundDamage((attacker?.magAtk||0)*.4)},description:'115% атаки и дополнительный удар Молнией 40% магической атаки.' },
  'Проводимость искажения': { name:'Проводимость искажения',passive:true,shieldedAttackSecondary:{multiplier:.4,school:MAGIC_SCHOOLS.LIGHTNING},description:'Пока есть Щит, прямые атаки дополнительно наносят 40% магической атаки Молнией.' },
  'Точный выпад': { name:'Точный выпад',cooldown:2,type:'physical',shieldDamageMultiplier:2,damage:({attacker})=>roundDamage((attacker?.attack||0)*1.45),description:'Наносит 145% физического урона. Наносит двойной урон Щиту.' },
  'Серия клинков': { name:'Серия клинков',cooldown:3,type:'physical',hits:3,damage:({attacker})=>roundDamage((attacker?.attack||0)*.55),description:'Три последовательных физических удара по 55% атаки.' },
  'Школа клинка': { name:'Школа клинка',passive:true,attackRhythm:{maxStacks:3,startPreparation:{kind:'blade_dance',resolveName:'Танец клинков',damageMultiplier:.55,hits:3,durability:80,maxDurability:80}},description:'Успешные атакующие действия дают Боевой ритм. На 3 зарядах начинает Подготовку: Танец клинков (прочность 80).' },
  'Нарушенная клятва': {
    name: 'Нарушенная клятва', passive: true,
    hpThresholdPreparation: { ratio: 0.5, preparation: { kind: 'blade_dance', resolveName: 'Танец клинков', damageMultiplier: 0.55, hits: 3, durability: 80, maxDurability: 80 } },
    description: 'Один раз при 50% здоровья или меньше гарантирует текущую или новую Подготовку: Танец клинков.',
  },
  ...MINES_ABILITY_LIBRARY,
  ...RESTLESS_RUINS_ABILITIES,
  'Атака': {
    artId: 'attack',
    name: 'Атака',
    cooldown: 0,
    damage: ({ attacker }) => {
      const profile = attacker?.basicAttackProfile || ((attacker?.baseAttack ?? attacker?.baseAtk ?? 0) >= (attacker?.baseMagAtk ?? 0) ? 'physical' : 'magical');
      return roundDamage(profile === 'magical' ? (attacker?.magAtk ?? 0) : (attacker?.attack ?? 0));
    },
    typeResolver: ({ attacker }) => {
      return attacker?.basicAttackProfile || ((attacker?.baseAttack ?? attacker?.baseAtk ?? 0) >= (attacker?.baseMagAtk ?? 0) ? 'physical' : 'magical');
    },
    schoolResolver: ({ attacker }) => {
      const profile = attacker?.basicAttackProfile || ((attacker?.baseAttack ?? attacker?.baseAtk ?? 0) >= (attacker?.baseMagAtk ?? 0) ? 'physical' : 'magical');
      return profile === 'magical' ? attacker?.primaryMagicSchool : null;
    },
    description: 'Базовая атака с неизменным физическим или магическим профилем, определённым базовыми характеристиками.',
    basic: true,
  },
};

export function createAbilityByName(name, fallbackDamage = 10) {
  if (!name) {
    return {
      name: 'Обычная атака',
      damage: fallbackDamage,
      cooldown: 0,
      type: 'physical',
    };
  }

  const compatibleName = name === 'Провокация'
    ? 'Кровавый вызов'
    : name === 'Горящая руна'
      ? 'Ледяное копьё'
      : name === 'Прицельный выстрел'
        ? 'Огненная стрела'
        : name;
  const template = ABILITY_LIBRARY[compatibleName];
  if (!template) {
    return {
      presetKey: name,
      name,
      damage: fallbackDamage,
      cooldown: 0,
      type: 'physical',
    };
  }

  return {
    ...template,
    presetKey: compatibleName,
  };
}
