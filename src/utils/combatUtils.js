import { ELEMENTAL_CHARGE_IDS, ELEMENTAL_CHARGE_THRESHOLD, getElementalChargeSchool } from '../data/elementalCharges';
import { getClassDamageMultiplier } from '../data/classCombatBalance';
import { triggerPreparedFieldTrap, isFieldControlImmune } from './fieldTraps';
// src/utils/combatUtils.js
// Логика боя Ashen Abyss с системой эффектов

import { createAbilityByName, WITHERING_FOREST_TUNING } from "../data/abilityPresets";
import { registerMinesBleedTick, transitionMinesBossPhase } from '../data/minesAbilities';
import {
  installMinesCombatHooks, applyMinesBlackMarkings,
  triggerMinesLastShift, minesGalleryDamageMultiplier,
  MINES_SUBLOCATION_EFFECTS,
} from './minesLocationMechanics';
import { createEnemyInstanceByName } from "../data/enemies";
import {
  queueRuinsDeath, flushRuinsSouls, initRuinsBattle, transitionRuinsLegion,
  cleanupRuinsOwnerDeath, getRuinsBannerDamageBonus, getRuinsLegionGuardReduction,
  reduceRuinsDeadshotDamage, consumeRuinsDeadshotRefraction, resolveRuinsPreparedAction,
  applyRuinsFrostbiteTempoReduction,
} from './restlessRuinsRuntime';
import { findItemData, getItemDefinition, combatItemConsumesTurn } from "../data/items";
import { equipmentByName } from "../data/equipment";
import { LOCATION_EFFECTS } from "../data/locationEffects";
import { RAT_RIDERS_START_METER, isRatRelatedEnemy } from '../data/expeditionSublocations';
import { beginForestRootsAction, endForestRootsAction, registerForestEnemyDeath } from "./witheringForestRoots";
import { advanceEntanglementDecayAtTurnEnd, applyEntanglementSpeed, getEntanglementStacks } from "./witheringForestEntanglement";
import { captureOvergrowth, consumeOvergrowthAfterAction } from './witheringForestOvergrowth';
import { getEligibleHostileUnits } from './combatTargeting';
import { getThornReflectionDamage, THORN_REFLECTION_ID } from './witheringForestThornGuard';
import { beginInvisibleAttack } from './witheringForestShadow';
import { findLivingBloodBondOwner, BLOOD_BOND_RATIO } from './witheringForestGnats';
import { DEFAULT_RELIC_ID, getRelicBonuses, ensureRelicState } from "../data/relics";
import { getEquippedItemNames, getEquipmentSetRuntimeBonuses } from "./equipmentManager";
import { getActiveSocketedRunes } from './runeSockets';
import { DEFAULT_MAGIC_SCHOOL, MAGIC_SCHOOLS } from "../constants/magicSchools";
import { aggregateCurseModifiers } from "../data/curses";
import { getTarotPreCombatEffects, applyTarotBattleStartEffects } from "../data/tarotCards";
import {
  processEffects,
  finishEffectTurn,
  addEffect,
  getEffectDefinition,
  getEffectStackCount,
  setEffectStackCount,
  setDynamicResourceStacks,
  setDynamicStatSteps,
  setDynamicStatMultiplier,
  countUniqueActiveBuffs,
  countUniqueActiveDebuffs,
  syncCrimsonEcstasy,
  consumeEffectStacks,
  cleanseEffects,
  removeRandomNegativeEffect,
  removeRandomPositiveEffect,
  notifyDamageTaken,
  notifyVampireMarkOnLethalDamage,
  notifyConductivityOnLethalDamage,
  notifyEffectOwnerDeath,
  prepareEffectTracking,
  triggerEffectTick,
  isControlEffect,
  calculateSearingMarkTickDamage,
  EFFECT_IDS,
} from "./effects.js";
import {
  COMBAT_PRESENTATION_TIMING,
  beginCombatPresentation,
  recordCombatPresentationEvent,
} from "./combatPresentationEvents";
import { createEncounterRewardRoster, resolveEncounterRewards, resolveEncounterRewardsOnce } from './encounterRewards';
import { slotsToLegacyInventory } from './expeditionInventory';

export const TURN_METER_THRESHOLD = 1000;
const TURN_METER_MAX_ITERATIONS = 500;
const MAX_ENEMY_AUTOMATION_STEPS = 50;
export const DEFAULT_CRIT_CHANCE = 0.1;
export const DEFAULT_CRIT_DAMAGE = 0.5;
const combatRng = session => typeof session?.rng === 'function' ? session.rng : Math.random;

const getCorruptionTier = unit => Math.max(0, Number(unit?.curses?.corruption?.tier) || 0);
const getCorruptionOutgoingMultiplier = unit => 1
  + getEffectStackCount(unit, 'thirst') * 0.05
  + getEffectStackCount(unit, 'crimson_ecstasy') * 0.1;

function grantCorruptionThirst(player, session, logFn = () => {}) {
  if (getCorruptionTier(player) < 1) return 0;
  const before = getEffectStackCount(player, 'thirst');
  const after = setDynamicResourceStacks(player, 'thirst', Math.min(3, before + 1), 'attack', 0.08);
  const thirst = (player.effects || []).find(effect => effect?.id === 'thirst');
  if (thirst) thirst.description = `Зарядов: ${after}/3. Каждый заряд даёт +5% всего исходящего урона и +8% физической Атаки.`;
  if (after > before) logFn(`🩸 ${player.name || 'Герой'} получает [Жажду] (${after}/3).`);
  if (after === 3 && before < 3 && getCorruptionTier(player) >= 4 && !player._corruptionThirstPeakTriggered) {
    player._corruptionThirstPeakTriggered = true;
    addEffect(player, { id: 'bleed', duration: 1 }, logFn, player, { session });
    addEffect(player, { id: 'bleed', duration: 1 }, logFn, player, { session });
    logFn(`🩸 [Жажда] достигает предела: ${player.name || 'герой'} получает 2 [Кровотечения].`);
  }
  return after;
}

function grantCrimsonEcstasy(player, logFn = () => {}) {
  if (getCorruptionTier(player) < 4) return 0;
  const before = getEffectStackCount(player, 'crimson_ecstasy');
  const after = setDynamicResourceStacks(player, 'crimson_ecstasy', Math.min(3, before + 1), 'speed', 0.1);
  const ecstasy = (player.effects || []).find(effect => effect?.id === 'crimson_ecstasy');
  if (ecstasy) ecstasy.description = `Зарядов: ${after}/3. Каждый заряд даёт +10% всего исходящего урона и +10% Скорости. Исчезает вместе с последним [Кровотечением].`;
  if (after > before) logFn(`♦ ${player.name || 'Герой'} получает [Багровый экстаз] (${after}/3).`);
  return after;
}

const getDistortionTier = unit => Math.max(0, Number(unit?.curses?.distortion?.tier) || 0);
const getRefractionCap = unit => Math.max(1, Math.round((unit?.maxHp || 0) * 0.3));

function syncRefractionState(player, logFn = () => {}) {
  if (!player) return 0;
  const tier = getDistortionTier(player);
  const cap = getRefractionCap(player);
  const value = Math.max(0, Math.min(cap, Math.round(Number(player._refraction) || 0)));
  player._refraction = value;
  const stepSize = Math.max(1, (player.maxHp || 0) * 0.1);
  const steps = tier >= 3 ? Math.min(3, Math.floor(value / stepSize)) : 0;
  setDynamicStatSteps(player, 'refraction_speed', steps, 'speed', tier >= 4 ? -0.05 : -0.04);
  player.effects = (player.effects || []).filter(effect => effect?.id !== 'refraction');
  if (value > 0) {
    const multiplierText = tier >= 3 ? ' При расходовании дополнительный урон умножается ×1,5.' : '';
    const speedText = steps > 0 ? ` Текущий штраф Скорости: −${steps * (tier >= 4 ? 5 : 4)}%.` : '';
    const overloadText = tier >= 4 && value >= cap ? ' Полный запас увеличивает входящий HP-урон на 10%.' : '';
    player.effects.push({
      id: 'refraction', name: 'Преломление', kind: 'resource', type: 'resource', icon: '◇',
      value, persistent: true, unremovable: true, durationPresentation: 'permanent',
      description: `${value} / ${cap}. Предотвращённый Искажением урон накапливается. Следующий успешный прямой HP-удар расходует ресурс.${multiplierText}${speedText}${overloadText}`,
    });
  }
  return value;
}

function addRefraction(player, prevented, session, logFn = () => {}) {
  if (getDistortionTier(player) < 1 || prevented <= 0) return 0;
  const cap = getRefractionCap(player);
  const before = Math.max(0, Number(player._refraction) || 0);
  const after = Math.min(cap, before + Math.max(0, Math.round(prevented)));
  player._refraction = after;
  syncRefractionState(player, logFn);
  if (before < cap && after >= cap) {
    logFn(`◇ [Преломление] ${player.name || 'героя'} заполнено (${after}/${cap}).`);
    if (getDistortionTier(player) >= 5) {
      addEffect(player, { id: 'charge' }, logFn, player, { session });
      logFn(`ϟ Полное [Преломление] даёт ${player.name || 'герою'} 1 [Заряд].`);
    }
  }
  return after - before;
}

function calculateDistortionIncoming(player, damage, { directAttack = false, fromEffect = null, isPeriodic = false } = {}) {
  const tier = getDistortionTier(player);
  if (tier < 1 || damage <= 0) return { damage, prevented: 0, enhancedConsumed: false };
  const enhanced = tier >= 2 && directAttack && !fromEffect && !isPeriodic && player._distortionEnhancedHitReady === true;
  const reduction = enhanced ? 0.25 : tier >= 4 ? 0.15 : 0.1;
  const reduced = Math.max(0, Math.round(damage * (1 - reduction)));
  const overloaded = tier >= 4 && (player._refraction || 0) >= getRefractionCap(player);
  return {
    damage: overloaded ? Math.max(0, Math.round(reduced * 1.1)) : reduced,
    prevented: Math.max(0, damage - reduced),
    enhancedConsumed: enhanced,
  };
}

function consumeRefraction(attacker, target, damageType, deliberateAction, session, logFn = () => {}) {
  const stored = Math.max(0, Number(attacker?._refraction) || 0);
  if (stored <= 0 || deliberateAction?.refractionConsumed) return 0;
  deliberateAction.refractionConsumed = true;
  const full = stored >= getRefractionCap(attacker);
  attacker._refraction = 0;
  syncRefractionState(attacker, logFn);
  const bonus = Math.max(0, Math.round(stored * (getDistortionTier(attacker) >= 3 ? 1.5 : 1)));
  const dealt = applyDamage(target, bonus, damageType, {
    source: attacker, session, logFn, fromEffect: 'refraction', sourceEffectId: 'refraction',
    bypassOutgoingModifiers: true,
  });
  logFn(`◇ ${attacker.name || 'Герой'} расходует [Преломление]: ${dealt} дополнительного урона.`);
  if (full && getDistortionTier(attacker) >= 4 && target.hp > 0) {
    addEffect(target, { id: 'charge' }, logFn, attacker, { session, deliberateAction });
    logFn(`ϟ Расход полного [Преломления] накладывает 1 [Заряд].`);
  }
  return dealt;
}

export const WITHERING_GLOBAL_TURN_MIN = 4;
export const WITHERING_GLOBAL_TURN_MAX = 8;
const getWitheringTier = unit => Math.max(0, Number(unit?.curses?.withering?.tier) || 0);

function getWitheringOutgoingBonus(unit, session) {
  if (getWitheringTier(unit) < 4 || session?.state?.players?.[0] !== unit) return 0;
  const entangledEnemies = (session.state.enemies || []).filter(enemy =>
    enemy?.hp > 0 && !enemy.nonActingCombatObject && getEntanglementStacks(enemy) > 0
  ).length;
  return entangledEnemies * 0.08;
}

function rewardWitheringEntanglementEvent(session, logFn = () => {}) {
  const hero = session?.state?.players?.[0];
  const tier = getWitheringTier(hero);
  if (tier < 3 || !hero || hero.hp <= 0) return false;
  const turnMeter = tier >= 5 ? 200 : 100;
  grantEquipmentTurnMeter(hero, turnMeter, session, { source: hero, reason: 'withering_entanglement' });
  if (tier >= 5) {
    const healed = applyHealing(hero, Math.round((hero.maxHp || 0) * 0.08), { source: hero, session, logFn });
    logFn(`🌿 [Единый организм]: +20% шкалы хода${healed > 0 ? ` и ${healed} HP` : ''}.`);
  }
  return true;
}

function handleEntanglementApplication(payload = {}, session = null) {
  const { applicationEventId } = payload;
  if (applicationEventId != null) {
    if (!(session._successfulEntanglementEvents instanceof Set)) {
      session._successfulEntanglementEvents = new Set();
    }
    if (session._successfulEntanglementEvents.has(applicationEventId)) return false;
    session._successfulEntanglementEvents.add(applicationEventId);
  }
  handleForestEntanglementAdded(payload, session);
  return rewardWitheringEntanglementEvent(session, text => log(session.state, text));
}

function applyEntanglementBatch(session, applications, logFn = () => {}) {
  const applicationEventId = {};
  let added = 0;
  applications.forEach(({ target, stacks = 1, source }) => {
    if (!target || target.hp <= 0 || target.nonActingCombatObject) return;
    const before = getEntanglementStacks(target);
    addEffect(target, { id: 'entanglement', stacks }, logFn, source, { session, applicationEventId });
    added += Math.max(0, getEntanglementStacks(target) - before);
  });
  return added;
}

function initializeWitheringCombat(session, logFn = () => {}) {
  const hero = session?.state?.players?.[0];
  const tier = getWitheringTier(hero);
  if (tier < 1) return;
  setDynamicStatSteps(hero, 'withering_speed', 1, 'speed', tier >= 3 ? 0.15 : 0.05);
  applyHealing(hero, Math.round((hero.maxHp || 0) * 0.05), { source: hero, session, logFn });
  session.state._witheringOpeningApplied = false;
  session.state._witheringCompletedTurns = 0;
  session.state._witheringGlobalTriggered = false;
  if (tier >= 3) {
    const span = WITHERING_GLOBAL_TURN_MAX - WITHERING_GLOBAL_TURN_MIN + 1;
    session.state._witheringGlobalTriggerTurn = WITHERING_GLOBAL_TURN_MIN + Math.floor(combatRng(session)() * span);
  }
}

function transformDecayEffectDuration({ target, effectData, metadata }, session) {
  const hero = session?.state?.players?.[0];
  if (getDecayTier(hero) < 2 || metadata?.persistent || metadata?.durationPresentation === 'permanent') return effectData;
  const duration = Number(effectData.duration ?? metadata?.defaultDuration);
  if (!Number.isFinite(duration) || duration < 2 || duration >= 999) return effectData;
  const heroBuff = target === hero && metadata.type === 'buff';
  const enemyDebuff = metadata.type === 'debuff' && (session.state.enemies || []).includes(target) && !target?.nonActingCombatObject;
  return heroBuff || enemyDebuff ? { ...effectData, duration: duration + 1 } : effectData;
}

function handleDecayBuffApplication(payload, session, logFn = () => {}) {
  const hero = session?.state?.players?.[0];
  if (!hero || payload?.target !== hero) return false;
  const eventId = payload.applicationEventId;
  if (eventId) {
    session._decayBuffEvents ||= new Set();
    if (session._decayBuffEvents.has(eventId)) return false;
    session._decayBuffEvents.add(eventId);
  }
  const tier = getDecayTier(hero);
  const buffs = countUniqueActiveBuffs(hero);
  if (tier >= 3 && buffs >= 2 && (hero._decayForgetfulnessCooldown || 0) <= 0) {
    hero._decayForgetfulnessCooldown = 3;
    hero._decayForgetfulnessSetThisTurn = hero._activeCombatTurnToken != null &&
      hero._registeredCompletedTurnToken !== hero._activeCombatTurnToken;
    addEffect(hero, { id: 'forgetfulness', duration: 2 }, logFn, hero, { session });
    logFn('◌ [Перегруженное сознание] вызывает [Беспамятство].');
  }
  if (tier >= 4 && buffs >= 4 && (hero._decaySearingMarkCooldown || 0) <= 0) {
    hero._decaySearingMarkCooldown = 3;
    hero._decaySearingMarkSetThisTurn = hero._activeCombatTurnToken != null &&
      hero._registeredCompletedTurnToken !== hero._activeCombatTurnToken;
    const enemies = (session.state.enemies || []).filter(unit => unit?.hp > 0 && !unit.nonActingCombatObject);
    const enemy = enemies.length ? enemies[Math.floor(combatRng(session)() * enemies.length)] : null;
    addEffect(hero, { id: 'searing_mark' }, logFn, hero, { session });
    if (enemy) addEffect(enemy, { id: 'searing_mark' }, logFn, hero, { session });
    logFn(`🔥 [Испепелённая память] накладывает [Испепеляющее клеймо]${enemy ? ` на ${hero.name} и ${enemy.name}` : ` на ${hero.name}`}.`);
  }
  return true;
}

function initializeDecayCombat(session) {
  const hero = session?.state?.players?.[0];
  if (!hero) return;
  hero._decayFirstCooldownUsed = false;
  hero._decayForgetfulnessCooldown = 0;
  hero._decaySearingMarkCooldown = 0;
  session.transformEffectApplication = payload => transformDecayEffectDuration(payload, session);
  session.onBuffApplied = payload => handleDecayBuffApplication(payload, session, text => log(session.state, text));
}

function startWitheringCombatIfNeeded(session, logFn = () => {}) {
  const hero = session?.state?.players?.[0];
  if (getWitheringTier(hero) < 2 || session.state._witheringOpeningApplied) return;
  session.state._witheringOpeningApplied = true;
  const candidates = (session.state.enemies || []).filter(unit => unit?.hp > 0 && !unit.nonActingCombatObject);
  const selected = candidates.length
    ? candidates[Math.floor(combatRng(session)() * candidates.length)]
    : null;
  const applications = [{ target: hero, stacks: 1, source: hero }];
  if (selected) applications.push({ target: selected, stacks: 1, source: hero });
  if (applyEntanglementBatch(session, applications, logFn) > 0) logFn('🌿 [Первые корни] распространяются по полю боя.');
}

function markCombatTurnStarted(session, actor, logFn = () => {}, forceNew = false) {
  if (!session?.state || !actor || actor.nonActingCombatObject) return null;
  if (forceNew || actor._activeCombatTurnToken == null || actor._registeredCompletedTurnToken === actor._activeCombatTurnToken) {
    session.state._combatTurnToken = (session.state._combatTurnToken || 0) + 1;
    actor._activeCombatTurnToken = session.state._combatTurnToken;
  }
  startWitheringCombatIfNeeded(session, logFn);
  return actor._activeCombatTurnToken;
}

export function registerCompletedCombatTurn(session, actor, logFn = () => {}) {
  if (!session?.state || !actor || actor.nonActingCombatObject) return false;
  const token = actor._activeCombatTurnToken;
  if (token == null || actor._registeredCompletedTurnToken === token) return false;
  actor._registeredCompletedTurnToken = token;
  session.state._completedCombatTurns = (session.state._completedCombatTurns || 0) + 1;
  processSublocationTurnEvent(session, actor, logFn);
  const hero = session.state.players?.[0];
  const tier = getWitheringTier(hero);
  if (tier < 2) return true;
  const total = ++session.state._witheringCompletedTurns;
  if (total > 1 && (total - 1) % 3 === 0) {
    const candidates = (session.state.enemies || []).filter(unit => unit?.hp > 0 && !unit.nonActingCombatObject);
    const selected = candidates.length ? candidates[Math.floor(combatRng(session)() * candidates.length)] : null;
    if (selected && applyEntanglementBatch(session, [{ target: selected, stacks: 1, source: hero }], logFn) > 0) {
      logFn('🌿 [Первые корни] опутывают случайного врага.');
    }
  }
  if (
    tier >= 3 && !session.state._witheringGlobalTriggered &&
    total >= session.state._witheringGlobalTriggerTurn
  ) {
    session.state._witheringGlobalTriggered = true;
    const stacks = tier >= 4 ? 2 : 1;
    const units = [...(session.state.players || []), ...(session.state.enemies || [])]
      .filter(unit => unit?.hp > 0 && !unit.nonActingCombatObject);
    applyEntanglementBatch(session, units.map(target => ({ target, stacks, source: hero })), logFn);
    logFn(`🌿 [Общая сеть] охватывает всех живых бойцов (${stacks} [Опутывания]).`);
  }
  return true;
}
const RUNE_IDS = {
  FLAME_HEART: "ember_heart",
  STONE_VIGIL: "stone_vigil",
  ASTRAL_FOCUS: "astral_focus",
};

const EQUIPMENT_EFFECTS = {
  RED_RATCATCHER_CAP: 'Красный Колпак Старшего Крысолова',
  SPOREWORKER_MASK: 'Грибная Маска Споровика',
  MARAUDER_JACKET: 'Куртка Мародёра',
  CHITIN_BEETLE_CARAPACE: 'Хитиновый Панцирь Мясного Жука',
  GUILD_WATCH_SHIELD: 'Щит Дозорного Гильдии',
  BURROW_SPIKED_SHIELD: 'Шипастый Щит Нор',
  GOBLIN_BUTCHER_CLEAVER: 'Тесак Гоблинского Мясника',
  OLD_CENTURION_MACE: 'Булава Старого Сотника',
  BORDER_WATCH_HALBERD: 'Алебарда Пограничного Дозора',
  MISTY_MOSS_RING: 'Кольцо Туманного Мха',
  ABYSS_VETERAN_AMULET: 'Амулет Ветерана Бездны',
  FIRST_SPARK_STAFF: 'Посох Украденной Искры',
  WARM_GLASS_WAND: 'Жезл Закопчённого Стекла',
  FROST_FOCUS: 'Фокус Ледяного Спора',
  SIGN_SEEKER_HOOD: 'Капюшон Искателя Знаков',
  ASHEN_APPRENTICE_MASK: 'Пепельная Маска Отступника',
  QUIET_CHANNEL_MANTLE: 'Мантия Погасшего Костра',
  WEAK_BARRIER_CLOAK: 'Плащ Тусклого Оберега',
  SHIFTING_SPARK_RING: 'Кольцо Переменчивой Искры',
  SMOLDERING_ECHO_RING: 'Кольцо Тлеющего Отзвука',
  THREE_SPARKS_AMULET: 'Амулет Трёх Искр',
  SPORE_GUARD_HAMMER: 'Молот Спорового Стража',
  SPOREBEARER_BOW: 'Лук Спороносца',
  WANDERING_SPORE_CROWN: 'Венец блуждающих спор',
  RED_BONFIRE_CLOAK: 'Накидка Красного Костра',
  SHIMMERING_SHELL: 'Мерцающая оболочка',
  OATHBREAKER: 'Клятвопреступник',
  RAT_VEIN_AMULET: 'Амулет Крысиной Жилы',
  RAT_WRAPS: 'Крысиные обмотки',
  DESERTER_BOOTS: 'Сапоги перебежчика',
  FATHER_OF_BONFIRES_CENSER: 'Кадило Отца Костров',
  DEMIGOD_SERPENT_CARAPACE: 'Панцирь Змеиного Полубога',
  FIRST_TRAITOR_CLOAK: 'Плащ Первого Предателя',
  DESERTER_FIELD_GRIMOIRE: 'Полевой гримуар Отступника',
  STRETCHED_HUNTING_BOW: 'Натянутый охотничий лук',
  PATHFINDER_HOOD: 'Капюшон Следопыта',
  SCOUT_CLOAK: 'Плащ разведчика',
  MARKED_BOWSTRING_RING: 'Кольцо Меткой Тетивы',
  DEBTORS_BLADE: 'Клинок должника',
  COUNTERFORMULA_WAND: 'Жезл встречных формул',
  SIGHTING_BOW: 'Лук пристрелки',
  THIRD_PATCH_SHIELD: 'Щит третьей заплаты',
  FOREIGN_SIGNAL_HELMET: 'Шлем чужого сигнала',
  LAST_IN_LINE_CUIRASS: 'Кираса последнего в строю',
  TORN_RITUAL_JACKET: 'Куртка сорванного ритуала',
  UNFINISHED_ORDER_CIRCLET: 'Обруч незаконченного приказа',
  PURSUER_BOOTS: 'Сапоги загонщика',
  QUARTERMASTER_TOKEN: 'Жетон интенданта',
  VISCOUS_VEIN_BOW: 'Лук вязких жил',
  STILLED_SAP_FOCUS: 'Фокус остановленного сока',
  LATE_SPRING_SHROUD: 'Покров поздней весны',
  BITTER_DEW_AMULET: 'Амулет горькой росы',
  CLINGING_IVY_RING: 'Перстень цепкого плюща',
  LIVING_SCARS_RING: 'Перстень живых шрамов',
  STOLEN_TIDE_VESSEL: 'Сосуд украденного прилива',
  FOREST_SENTINEL_MASK: 'Маска лесного часового',
  CLINGING_ROOTS_SHIELD: 'Щит цепких корней',
  SPROUTED_PATH_BOOTS: 'Сапоги проросшей тропы',
  FALLEN_HOUR_RING: 'Кольцо опавшего часа',
  CLINGING_RESIN_AMULET: 'Амулет цепкой живицы',
  LAST_BLOOM_BOW: 'Лук последнего цветения',
  GREAT_ROOT_WOUND_CROWN: 'Венец Раны Великого Корня',
  UNHEALED_WOUNDS_GLADIUS: 'Гладиус незаживших ран',
  BROKEN_FORMATION_BOW: 'Лук сорванного построения',
  UNRELENTING_MARCH_SHIELD: 'Щит неумолкшего марша',
  SURVIVING_STANDARD_BEARER_CUIRASS: 'Кираса уцелевшего знаменосца',
  BURIAL_FORMATION_RING: 'Перстень погребального строя',
  ETERNAL_SENTINEL_HELMET: 'Шлем вечного часового',
  BURIAL_WATCH_UNIFORM: 'Мундир погребального дозора',
  ALLKING_SIGNET: 'Печатка Всецаря',
  LAST_SHIFT_HAMMER: 'Молот последней смены',
  BLACK_VEIN_LANTERN: 'Фонарь чёрной жилы',
  SMOLDERING_VEIN_SHIELD: 'Щит тлеющей жилы',
  SCORCHED_VEIN_SCEPTER: 'Скипетр выжженной жилы',
  BLINDING_GOLD_AMULET: 'Амулет слепящего золота',
  SURVIVING_MINER_JACKET: 'Куртка уцелевшего забойщика',
  DEAF_FACE_HELMET: 'Каска глухого забоя',
  INSATIABLE_VEIN_RING: 'Перстень ненасытной жилы',
  ERASED_NAME_AMULET: 'Амулет стёртого имени',
  BLACK_STRATUM_BOOTS: 'Сапоги чёрного пласта',
  DEEP_WATCH_CUIRASS: 'Кираса глубинного дозора',
  DEEP_WATCH_BOOTS: 'Сапоги глубинного дозора',
  BURNED_MEMORY_STAFF: 'Посох выжженной памяти',
  PRIDE_SWORD: 'Меч Гордыни',
  TWO_VOICES_STAFF: 'Посох двух голосов',
  THIRD_VOICE_MIRROR: 'Зеркало третьего голоса',
  FOREIGN_SHIFT_RING: 'Кольцо чужой смены',
  LAST_RANK_RING: 'Перстень последней шеренги',
  LAST_ECHO_AMULET: 'Амулет последнего отзвука',
};

const effectId = (name) => EFFECT_IDS[name] || name;
const BLEED_EFFECT_ID = effectId('Кровотечение');
const POISON_EFFECT_ID = effectId('Отравление');
const STUN_EFFECT_ID = effectId('Оглушение');
const MINOR_DEFENSE_PENALTY_ID = effectId('Ослабление защиты');
const MINOR_MAGIC_DEFENSE_PENALTY_ID = effectId('Магическая слабость');
const MINOR_DEFENSE_BLESSING_ID = effectId('Укрепление');
const ELEMENTAL_STATUS_EFFECT_IDS = new Set([effectId('Горение'), effectId('Шок'), effectId('Заморозка')]);
const CONTROL_DEBUFF_EFFECT_IDS = new Set([
  effectId('Оглушение'),
  effectId('Заморозка'),
  effectId('Шок'),
  effectId('Слепота'),
  effectId('Немота'),
  'silence',
  'stiffness',
  'sap_slow',
]);

export const hasEquippedClassPassive = (unit, passiveId) => {
  const normalize = id => ({ catalyst: 'lightning_speed', polarization: 'overheat' }[id] || id);
  return (unit?.equippedClassPassiveIds || []).some(id => normalize(id) === normalize(passiveId));
};
export const getBleedStacks = target => {
  const bleed = (target?.effects || []).find(effect => effect?.id === BLEED_EFFECT_ID || effect?.id === 'bleed');
  return bleed ? Math.max(1, bleed.stacks || bleed.remainingTurns || bleed.duration || 1) : 0;
};
export const getBloodPressureSpeedBonus = (unit, enemies = []) => {
  if (!hasEquippedClassPassive(unit, 'blood_pressure') || unit?.passivesDisabled) return 0;
  const maxBleedCharges = Math.max(0, ...enemies
    .filter(enemy => enemy?.hp > 0)
    .map(getBleedStacks));
  return Math.min(0.5, Math.floor(maxBleedCharges / 2) * 0.1);
};

export const canTriggerHeadlong = unit => Boolean(
  unit?.hp > 0 &&
  !unit.passivesDisabled &&
  !unit._hasPhysicalShield &&
  hasEquippedClassPassive(unit, 'headlong')
);

export function grantHeadlongShield(unit, ability, deliberateAction, session, logFn = () => {}) {
  if (!canTriggerHeadlong(unit) || ability?.basic || ability?.passive || !deliberateAction?.successfulDirectHit) return 0;
  const value = Math.max(0, Math.round((unit.maxHp || 0) * 0.12));
  if (!value) return 0;
  addEffect(unit, { id: 'shield', duration: 3, value }, logFn, unit, { session });
  return value;
}
export const registerRetaliatoryAssaultAttack = (target, enemy) => {
  if (!hasEquippedClassPassive(target, 'retaliatory_assault') || target?.passivesDisabled || !enemy) return target?.retaliatoryAssaultStacks || 0;
  target.retaliatoryAssaultStacks = Math.min(3, (target.retaliatoryAssaultStacks || 0) + 1);
  const visible = (target.effects || []).find(effect => effect.id === 'retaliatory_assault');
  const description = target.retaliatoryAssaultStacks === 3
    ? 'Готово: следующая небазовая атакующая способность наносит на 50% больше прямого урона.'
    : `Заряды: ${target.retaliatoryAssaultStacks}/3. Бонус активируется при 3 зарядах.`;
  if (visible) { visible.stacks = target.retaliatoryAssaultStacks; visible.description = description; }
  else (target.effects ||= []).push({ id: 'retaliatory_assault', name: 'Ответный натиск', type: 'buff', icon: '◆', duration: 999, remainingTurns: 999, stacks: target.retaliatoryAssaultStacks, description });
  return target.retaliatoryAssaultStacks;
};
export const getRetaliatoryAssaultBonuses = unit => {
  const stacks = unit?.passivesDisabled || !hasEquippedClassPassive(unit, 'retaliatory_assault') ? 0 : Math.min(3, unit?.retaliatoryAssaultStacks || 0);
  return { stacks, defensePercent: 0, directDamagePercent: stacks === 3 ? 0.5 : 0 };
};
export const consumeRetaliatoryAssault = unit => {
  const stacks = getRetaliatoryAssaultBonuses(unit).stacks;
  if (!stacks) return 0;
  unit.retaliatoryAssaultStacks = 0;
  unit._retaliatoryActionMultiplier = null;
  unit.effects = (unit.effects || []).filter(effect => effect.id !== 'retaliatory_assault');
  return stacks;
};
export function registerDefenderEnemyAttackAction(target, enemy) {
  if (!target || !enemy) return 0;
  const preparation = (target.effects || []).find(effect => (
    (effect?.id === 'preparation' && effect.extra?.kind === 'defender_ram')
    || effect?.id === 'defender_ram_prepared'
  ));
  if (!preparation || preparation.extra?.talentId !== 'defender.ram.acceleration') return 0;
  preparation.extra ||= {};
  preparation.extra.attackActions = Math.min(3, Math.max(0, preparation.extra.attackActions || 0) + 1);
  return preparation.extra.attackActions;
}
const ELEMENTALIST_CLASS_NAMES = new Set(['Mage', 'Elementalist', 'Элементалист']);
const ARCHER_CLASS_NAMES = new Set(['Archer', 'Лучник']);
const FIREBALL_PREPARED_EFFECT_IDS = new Set(['shock', 'freeze', 'burn']);

const LEGACY_EQUIPMENT_NAME_MAP = {
  'Посох Первой Искры': EQUIPMENT_EFFECTS.FIRST_SPARK_STAFF,
  'Жезл Тёплого Стекла': EQUIPMENT_EFFECTS.WARM_GLASS_WAND,
  'Инеевый Фокус': EQUIPMENT_EFFECTS.FROST_FOCUS,
  'Маска Пепельного Ученика': EQUIPMENT_EFFECTS.ASHEN_APPRENTICE_MASK,
  'Мантия Тихого Канала': EQUIPMENT_EFFECTS.QUIET_CHANNEL_MANTLE,
  'Плащ Слабого Барьера': EQUIPMENT_EFFECTS.WEAK_BARRIER_CLOAK,
};

function hasEquipped(unit, itemName) {
  return getEquippedItemNames(unit?.equipment).some(name => (LEGACY_EQUIPMENT_NAME_MAP[name] || name) === itemName);
}

export function resolveMarkedBowstringCritBonus(owner, primaryTarget, qualifies = true) {
  if (!owner || !primaryTarget || !qualifies || !hasEquipped(owner, EQUIPMENT_EFFECTS.MARKED_BOWSTRING_RING)) return 0;
  const targetId = primaryTarget.instanceId || primaryTarget.id || primaryTarget.name;
  if (owner._markedBowstringTargetId !== targetId) {
    owner._markedBowstringTargetId = targetId;
    owner._markedBowstringSequence = 1;
  } else {
    owner._markedBowstringSequence = (owner._markedBowstringSequence || 1) + 1;
  }
  return owner._markedBowstringSequence <= 1 ? 0 : owner._markedBowstringSequence === 2 ? 0.1 : 0.2;
}

export function getPathfinderHoodCritBonus(owner) {
  return owner && hasEquipped(owner, EQUIPMENT_EFFECTS.PATHFINDER_HOOD) && !owner._enemyCompletedFullTurn ? 0.17 : 0;
}

function applyLastShiftHammerCooldown(owner, ability) {
  if (!owner || !ability || ability.basic || ability.passive) return false;
  if (!hasEquipped(owner, EQUIPMENT_EFFECTS.LAST_SHIFT_HAMMER)) return false;
  if ((owner._lastShiftHammerCooldown || 0) > 0 || (Number(ability.currentCooldown) || 0) <= 0) return false;
  ability.currentCooldown = Math.max(0, (Number(ability.currentCooldown) || 0) - 1);
  owner._lastShiftHammerCooldown = 3;
  return true;
}

export function applyDeserterGrimoireCooldown(owner, ability) {
  if (!owner || !ability || ability.basic || ability.passive || !hasEquipped(owner, EQUIPMENT_EFFECTS.DESERTER_FIELD_GRIMOIRE)) return false;
  const baseCooldown = Number(ability.cooldown) || 0;
  if (baseCooldown < 2 || owner._deserterGrimoireUsed) return false;
  owner._deserterGrimoireUsed = true;
  ability.currentCooldown = Math.max(0, (Number(ability.currentCooldown) || 0) - 1);
  return true;
}

export function registerStretchedBowDirectTarget(owner, target, deliberateAction, targetWasBleeding) {
  if (!owner || !target || !targetWasBleeding || !deliberateAction || !hasEquipped(owner, EQUIPMENT_EFFECTS.STRETCHED_HUNTING_BOW)) return 0;
  const targetId = target.instanceId || target.id || target.name;
  deliberateAction.stretchedBowTargets ||= new Set();
  if (!targetId || deliberateAction.stretchedBowTargets.has(targetId)) return 0;
  deliberateAction.stretchedBowTargets.add(targetId);
  owner.turnMeter = Math.min(TURN_METER_THRESHOLD, Math.max(0, owner.turnMeter || 0) + 150);
  return 150;
}

export function getScoutCloakDirectMultiplier(owner, deliberateAction) {
  if (!owner || !deliberateAction || !hasEquipped(owner, EQUIPMENT_EFFECTS.SCOUT_CLOAK)) return 1;
  if (owner._scoutCloakConsumed && owner._scoutCloakAction !== deliberateAction) return 1;
  if (!owner._scoutCloakConsumed) {
    owner._scoutCloakConsumed = true;
    owner._scoutCloakAction = deliberateAction;
  }
  return owner._scoutCloakAction === deliberateAction ? 0.6 : 1;
}

function isElementalist(unit) {
  return ELEMENTALIST_CLASS_NAMES.has(unit?.class) || ELEMENTALIST_CLASS_NAMES.has(unit?.displayClass);
}

function findElementalistOwnerForSourceId(sourceId, session, passiveId = null) {
  if (!sourceId || !session?.state) return null;
  const players = session.state.players || [];
  return players.find(unit => {
    if (!unit || unit.hp <= 0 || !isElementalist(unit) || unit.summoned) return false;
    if (passiveId && !hasEquippedClassPassive(unit, passiveId)) return false;
    const ownerId = combatUnitId(unit);
    if (ownerId === sourceId) return true;
    return players.some(ally =>
      ally?.summoned &&
      ally.hp > 0 &&
      combatUnitId(ally) === sourceId &&
      (ally.summonerId === unit.id || ally.summonerId === ownerId)
    );
  }) || null;
}

function findElementalistOwnerForSource(source, session, passiveId = null) {
  if (!source || !session?.state) return null;
  const directOwner = (session.state.players || []).find(unit =>
    unit === source &&
    unit.hp > 0 &&
    !unit.summoned &&
    isElementalist(unit) &&
    (!passiveId || hasEquippedClassPassive(unit, passiveId))
  );
  return directOwner || findElementalistOwnerForSourceId(combatUnitId(source), session, passiveId);
}

function finalizeElementalResonance(source, deliberateAction, session, logFn = () => {}) {
  if (!source || !deliberateAction || !hasEquippedClassPassive(source, 'elemental_resonance')) return null;
  const school = deliberateAction.elementalResonanceSchool;
  const targets = [...new Set(deliberateAction.elementalResonanceHitTargets || [])].filter(target => target?.hp > 0);
  if (!targets.length) return null;

  let effect;
  if (school === MAGIC_SCHOOLS.FIRE) {
    effect = { id: 'charring', duration: 3 };
  } else if (school === MAGIC_SCHOOLS.ICE) {
    effect = { id: 'ice_shards' };
  } else if (school === MAGIC_SCHOOLS.LIGHTNING) {
    effect = combatRng(session)() < 0.75
      ? { id: 'charge' }
      : { id: 'conductivity', duration: 2 };
  } else {
    return null;
  }

  targets.forEach(target => addEffect(
    target,
    { ...effect },
    logFn,
    source,
    { session, deliberateAction }
  ));
  const label = effect.id === 'charring' ? 'Обугливание' : effect.id === 'ice_shards' ? 'Ледяной осколок' : effect.id === 'charge' ? 'Заряд' : 'Проводимость';
  logFn(`✨ Стихийный резонанс: ${label} на поражённых целях.`);
  return effect.id;
}

function triggerLightningSpeedReward(elementalist, session, logFn = () => {}) {
  if (!elementalist || elementalist.hp <= 0 || !isElementalist(elementalist) || !hasEquippedClassPassive(elementalist, 'lightning_speed')) return false;
  elementalist.turnMeter = Math.min(TURN_METER_THRESHOLD, (elementalist.turnMeter || 0) + 150);
  addEffect(elementalist, { id: 'speed_boost_minor', duration: 2 }, logFn, elementalist, { session });
  logFn(`⚡ Скорость молнии: ${elementalist.name} получает 15% шкалы хода и Ускорение на 2 хода.`);
  return true;
}

export function triggerLightningSpeedFromShockSkip(elementalist, session, logFn = () => {}) {
  return triggerLightningSpeedReward(elementalist, session, logFn);
}

function triggerLightningSpeedFromChargeDischarge(source, session, deliberateAction = null, logFn = () => {}) {
  const elementalist = findElementalistOwnerForSource(source, session, 'lightning_speed');
  if (!elementalist) return false;
  if (deliberateAction && elementalist._lightningSpeedChargeAction === deliberateAction) return false;
  if (deliberateAction) elementalist._lightningSpeedChargeAction = deliberateAction;
  return triggerLightningSpeedReward(elementalist, session, logFn);
}

export function resetOverheatStreakAfterCompletedEnemyTurn() {
  // Kept as a compatibility no-op for older callers/tests. The final Overheat
  // design is a persistent 0-2 charge resource and no longer tracks turn streaks.
  return false;
}

function isPreparedForFireballSplash(target) {
  return (target?.effects || []).some(effect => FIREBALL_PREPARED_EFFECT_IDS.has(effect?.id));
}

function countDebuffs(unit) {
  return (unit?.effects || []).filter(effect => effect?.type === 'debuff' || effect?.kind === 'debuff').length;
}

function hasAnyDebuff(unit) {
  return countDebuffs(unit) > 0;
}

const FOREST_SLOW_EFFECT_IDS = new Set(['speed_penalty_minor', 'speed_penalty_major']);
const hasForestSlow = unit => (unit?.effects || []).some(effect => FOREST_SLOW_EFFECT_IDS.has(effect?.id));

function getOwnedPoisonEffects(target, owner) {
  const ownerId = combatUnitId(owner);
  return (target?.effects || []).filter(effect =>
    effect?.id === POISON_EFFECT_ID &&
    (effect.sourceRef === owner || effect.sourceId === ownerId || effect.sourceSnapshot?.entity === owner)
  );
}

function reduceHostileTurnMeterForEquipment(target, amount) {
  if (!target || target._temporaryControlImmunity) return 0;
  const mitigation = target.passivesDisabled ? 0 : Math.max(0, Math.min(1,
    (target.abilities || []).reduce((best, ability) =>
      Math.max(best, Number(ability?.hostileTurnMeterReductionMitigation) || 0), 0)
  ));
  const requested = Math.max(0, Number(amount) || 0) * (1 - mitigation);
  const before = Math.max(0, Number(target.turnMeter) || 0);
  target.turnMeter = Math.max(0, before - requested);
  return before - target.turnMeter;
}

function grantEquipmentTurnMeter(unit, amount, session, meta = {}) {
  if (!unit || amount <= 0) return 0;
  const before = Math.max(0, Number(unit.turnMeter) || 0);
  unit.turnMeter = Math.min(TURN_METER_THRESHOLD, before + amount);
  const gained = Math.max(0, unit.turnMeter - before);
  if (gained > 0) {
    session?.notifyPositiveTempoChange?.(unit, gained, { ...meta, natural: false });
    if (!meta.suppressPresentation) {
      recordCombatPresentationEvent(session, {
        type: 'turnMeterChanged',
        actor: typeof meta.source === 'object' ? meta.source : unit,
        target: unit,
        amount: gained,
        delta: gained,
        before,
        after: unit.turnMeter,
        changeKind: 'gain',
        reason: meta.reason || 'tempo_gain',
      });
    }
  }
  return gained;
}

const combatUnitId = unit => unit?.id || unit?.combatInstanceId || unit?.runtimeId || unit?.name || null;

function isFiniteTimedEffect(effect) {
  const turns = Number(effect?.remainingTurns ?? effect?.duration);
  return Number.isFinite(turns) && turns > 0 && turns < 999;
}

function isOwnerTimedDebuff(effect, owner, { excludeControl = true, excludeStacks = false } = {}) {
  if (!effect || !owner) return false;
  const def = getEffectDefinition(effect.id);
  if ((effect.type || def?.type) !== 'debuff') return false;
  if (effect.sourceId !== combatUnitId(owner)) return false;
  if (!isFiniteTimedEffect(effect)) return false;
  if (excludeControl && isControlEffect(effect.id)) return false;
  if (excludeStacks && (def?.stacking === 'stack' || Number(effect.stacks ?? effect.charges) > 1)) return false;
  return true;
}

const RUINS_ECHO_CHARGE_ID = 'ruins_echo_charge';
const THIRD_VOICE_READY_ID = 'third_voice_ready';
const ECHO_BASE_EFFICIENCY = 0.4;
const UNDEATH_ECHO_EFFICIENCY = 0.6;

const getUndeathTier = unit => Math.max(0, Number(unit?.curses?.undeath?.tier) || 0);
const getDecayTier = unit => Math.max(0, Number(unit?.curses?.decay?.tier) || 0);

export function getAbilityCooldownSum(unit) {
  return (unit?.abilities || []).reduce((sum, ability) => ability?.passive
    ? sum
    : sum + Math.max(0, Number(ability?.currentCooldown) || 0), 0);
}

function getDecayStatusBonus(unit) {
  const tier = getDecayTier(unit);
  return (tier >= 3 ? countUniqueActiveBuffs(unit) * 0.04 : 0) +
    (tier >= 4 ? countUniqueActiveDebuffs(unit) * 0.03 : 0);
}

function getDecayHeroOutgoingBonus(hero) {
  const tier = getDecayTier(hero);
  return (tier >= 1 ? 0.05 : 0) + getDecayStatusBonus(hero) +
    (tier >= 5 ? getAbilityCooldownSum(hero) * 0.04 : 0);
}

function getDecayEnemyCooldownBonus(unit, session) {
  return getDecayTier(session?.state?.players?.[0]) >= 5 ? getAbilityCooldownSum(unit) * 0.02 : 0;
}

function getUndeathLowHpPenalty(unit) {
  if (getUndeathTier(unit) < 5) return 0;
  const ratio = (Number(unit.hp) || 0) / Math.max(1, Number(unit.maxHp) || 1);
  return Math.min(0.3, Math.max(0, (0.5 - ratio) / 0.5 * 0.3));
}

function syncUndeathLowHpPenalty(unit) {
  const penalty = getUndeathLowHpPenalty(unit);
  setDynamicStatMultiplier(unit, 'undeath_low_hp', 1 - penalty, 'speed');
  unit._undeathHealingPenalty = penalty;
  return penalty;
}

function cloneEchoSnapshot(snapshot) {
  return {
    damage: (snapshot?.damage || []).map(entry => ({ ...entry })),
    healing: (snapshot?.healing || []).map(entry => ({ ...entry })),
    shields: (snapshot?.shields || []).map(entry => ({ ...entry })),
    effects: (snapshot?.effects || []).map(entry => ({ ...entry })),
  };
}

function ensureRuinsEchoSnapshot(deliberateAction) {
  if (!deliberateAction) return null;
  deliberateAction.ruinsEchoSnapshot ||= {
    damage: [],
    healing: [],
    shields: [],
    effects: [],
  };
  return deliberateAction.ruinsEchoSnapshot;
}

function addRuinsEchoAmount(list, target, amount, extra = {}) {
  const targetId = combatUnitId(target);
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (!targetId || value <= 0) return;
  const existing = list.find(entry => entry.targetId === targetId);
  if (existing) {
    existing.amount += value;
    return;
  }
  list.push({ targetId, amount: value, ...extra });
}

function captureRuinsEchoDamage(deliberateAction, target, rawDamage) {
  if (!deliberateAction?.ruinsEchoEligible) return;
  const snapshot = ensureRuinsEchoSnapshot(deliberateAction);
  addRuinsEchoAmount(snapshot.damage, target, rawDamage);
}

function captureRuinsEchoAppliedEffect(deliberateAction, target, effect, shieldGained = 0) {
  if (!deliberateAction?.ruinsEchoEligible || !target || !effect) return;
  const snapshot = ensureRuinsEchoSnapshot(deliberateAction);
  if (effect.id === 'shield') {
    const echoShieldValue = Math.max(
      0,
      Math.round(Number(effect.echoBaseValue ?? shieldGained) || 0)
    );
    addRuinsEchoAmount(snapshot.shields, target, echoShieldValue, {
      duration: Math.max(1, Math.round(Number(effect.remainingTurns ?? effect.duration) || 1)),
    });
    return;
  }
  const metadata = getEffectDefinition(effect.id);
  const turns = Number(effect.remainingTurns ?? effect.duration);
  if (
    !metadata ||
    !['buff', 'debuff'].includes(metadata.type) ||
    effect.persistent || metadata.persistent ||
    effect.durationPresentation === 'permanent' || metadata.durationPresentation === 'permanent' ||
    !Number.isFinite(turns) || turns <= 0 || turns >= 999
  ) return;
  snapshot.effects.push({
    targetId: combatUnitId(target),
    id: effect.id,
    duration: turns,
    stacks: Math.max(1, Number(effect.stacks ?? effect.charges) || 1),
  });
}

function snapshotRuinsEchoApplyState(session) {
  const units = [...(session?.state?.players || []), ...(session?.state?.enemies || [])].filter(Boolean);
  return new Map(units.map(unit => {
    const effects = new Map();
    (unit.effects || []).forEach(effect => {
      const id = effect?.id;
      if (!id) return;
      const turns = Number(effect.remainingTurns ?? effect.duration);
      const current = effects.get(id) || { count: 0, maxTurns: 0, stacks: 0 };
      current.count += 1;
      current.stacks += Math.max(1, Number(effect.stacks ?? effect.charges) || 1);
      if (Number.isFinite(turns)) current.maxTurns = Math.max(current.maxTurns, turns);
      effects.set(id, current);
    });
    const echoShieldBase = (unit.effects || [])
      .filter(effect => effect?.id === 'shield')
      .reduce((sum, effect) => sum + Math.max(0, Number(effect.echoBaseValue ?? effect.appliedShield ?? effect.value) || 0), 0);
    return [combatUnitId(unit), {
      hp: Number(unit.hp) || 0,
      shield: Number(unit.shield) || 0,
      echoShieldBase,
      effects,
    }];
  }));
}

function captureRuinsEchoApplyDiff(deliberateAction, before, session) {
  if (!deliberateAction?.ruinsEchoEligible || !before) return;
  const snapshot = ensureRuinsEchoSnapshot(deliberateAction);
  const units = [...(session?.state?.players || []), ...(session?.state?.enemies || [])].filter(Boolean);
  units.forEach(unit => {
    const id = combatUnitId(unit);
    const previous = before.get(id);
    if (!previous) return;

    const healed = Math.max(0, (Number(unit.hp) || 0) - previous.hp);
    if (healed > 0) addRuinsEchoAmount(snapshot.healing, unit, healed);

    const shieldGained = Math.max(0, (Number(unit.shield) || 0) - previous.shield);
    if (shieldGained > 0) {
      const currentEchoShieldBase = (unit.effects || [])
        .filter(effect => effect?.id === 'shield')
        .reduce((sum, effect) => sum + Math.max(0, Number(effect.echoBaseValue ?? effect.appliedShield ?? effect.value) || 0), 0);
      const echoShieldGained = Math.max(0, currentEchoShieldBase - (previous.echoShieldBase || 0));
      const shieldDuration = Math.max(
        1,
        ...(unit.effects || [])
          .filter(effect => effect?.id === 'shield')
          .map(effect => Math.max(1, Number(effect.remainingTurns ?? effect.duration) || 1))
      );
      addRuinsEchoAmount(snapshot.shields, unit, echoShieldGained || shieldGained, { duration: shieldDuration });
    }

    const afterById = new Map();
    (unit.effects || []).forEach(effect => {
      if (!effect?.id || effect.id === 'shield') return;
      const metadata = getEffectDefinition(effect.id);
      const turns = Number(effect.remainingTurns ?? effect.duration);
      if (
        !metadata || !['buff', 'debuff'].includes(metadata.type) ||
        effect.persistent || metadata.persistent ||
        effect.durationPresentation === 'permanent' || metadata.durationPresentation === 'permanent' ||
        !Number.isFinite(turns) || turns <= 0 || turns >= 999
      ) return;
      const current = afterById.get(effect.id) || { effect, count: 0, maxTurns: 0, stacks: 0 };
      current.count += 1;
      current.stacks += Math.max(1, Number(effect.stacks ?? effect.charges) || 1);
      if (turns >= current.maxTurns) {
        current.maxTurns = turns;
        current.effect = effect;
      }
      afterById.set(effect.id, current);
    });

    afterById.forEach((after, effectId) => {
      const prev = previous.effects.get(effectId) || { count: 0, maxTurns: 0, stacks: 0 };
      if (after.count <= prev.count && after.maxTurns <= prev.maxTurns && after.stacks <= prev.stacks) return;
      snapshot.effects.push({
        targetId: id,
        id: effectId,
        duration: after.maxTurns,
        stacks: Math.max(1, after.stacks - prev.stacks || 1),
      });
    });
  });
}

function ruinsEchoHasPayload(snapshot) {
  return Boolean(snapshot && (
    snapshot.damage?.some(entry => entry.amount > 0) ||
    snapshot.healing?.some(entry => entry.amount > 0) ||
    snapshot.shields?.some(entry => entry.amount > 0) ||
    snapshot.effects?.length
  ));
}

function registerThirdVoiceMirrorSupport(owner, ability, deliberateAction, logFn = () => {}) {
  if (
    !owner || !ability || ability.basic || ability.passive ||
    deliberateAction?.attackingAction ||
    !hasEquipped(owner, EQUIPMENT_EFFECTS.THIRD_VOICE_MIRROR) ||
    getEffectStackCount(owner, THIRD_VOICE_READY_ID) > 0
  ) return false;
  owner._thirdVoiceMirrorCount = Math.max(0, Number(owner._thirdVoiceMirrorCount) || 0) + 1;
  if (owner._thirdVoiceMirrorCount < 3) return false;
  owner._thirdVoiceMirrorCount = 0;
  setEffectStackCount(owner, THIRD_VOICE_READY_ID, 1);
  logFn(`🪞 ${EQUIPMENT_EFFECTS.THIRD_VOICE_MIRROR} подготавливает Эхо для следующей атакующей классовой способности.`);
  return true;
}

function scheduleRuinsEcho(owner, ability, deliberateAction, logFn = () => {}) {
  if (!owner || !ability || ability.basic || ability.passive) return false;
  const snapshot = deliberateAction?.ruinsEchoSnapshot;
  if (!ruinsEchoHasPayload(snapshot)) return false;
  if (getUndeathTier(owner) >= 5) {
    owner._undeathLastEcho = { abilityName: ability.name, ...cloneEchoSnapshot(snapshot), heroOwned: true };
  }
  if (owner._pendingRuinsEcho) return false;
  const candidates = deliberateAction?.echoCandidates || [];
  if (!candidates.length) return false;
  const selected = [...candidates].sort((a, b) => b.efficiency - a.efficiency || Number(a.consumable) - Number(b.consumable))[0];
  if (selected.effectId && consumeEffectStacks(owner, selected.effectId, 1) <= 0) return false;
  if (selected.reason === 'undeath_first') owner._undeathFirstEchoUsed = true;
  if (selected.reason === 'undeath_death') owner._undeathEnemyEchoPrepared = false;
  owner._pendingRuinsEcho = {
    abilityName: ability.name,
    ...cloneEchoSnapshot(snapshot),
    efficiency: selected.efficiency,
    source: selected.reason,
    heroOwned: true,
    suppressRecursion: true,
  };
  logFn(`◈ Эхо запоминает «${ability.name}» до следующего собственного хода.`);
  return true;
}

function resolvePendingRuinsEcho(owner, session, logFn = () => {}, immediate = null) {
  const pending = immediate || owner?._pendingRuinsEcho;
  if (!owner || !pending) return false;
  if (!immediate) delete owner._pendingRuinsEcho;

  const units = [...(session?.state?.players || []), ...(session?.state?.enemies || [])];
  const findLiving = targetId => units.find(unit => combatUnitId(unit) === targetId && unit.hp > 0) || null;
  let produced = false;
  let killedEnemy = false;
  const efficiency = Math.min(1, Math.max(0, Number(pending.efficiency) || ECHO_BASE_EFFICIENCY));

  const deathSaveEcho = pending.source === 'undeath_death_save';
  recordCombatPresentationEvent(session, {
    type: 'procTriggered',
    actor: owner,
    target: owner,
    procKind: 'curse',
    procId: 'undeath_echo',
    label: 'Эхо',
    efficiency,
    abilityName: pending.abilityName,
    afterEventType: deathSaveEcho ? 'deathSaveResolved' : undefined,
    afterTargetId: deathSaveEcho ? (combatUnitId(owner) || owner.name) : undefined,
    afterEventDirection: deathSaveEcho ? 'following' : undefined,
  });
  const echoPresentationCause = {
    type: 'procTriggered',
    target: owner,
    direction: 'preceding',
  };

  (pending.damage || []).forEach(entry => {
    const target = findLiving(entry.targetId);
    const amount = Math.max(0, Math.floor((Number(entry.amount) || 0) * efficiency));
    if (!target || amount <= 0) return;
    const dealt = applyDamage(target, amount, 'magical', {
      source: owner,
      session,
      logFn,
      magicSchool: MAGIC_SCHOOLS.DEATH,
      directAttack: false,
      fromEffect: 'ruins_echo',
      sourceEffectId: 'ruins_echo',
      presentationCause: echoPresentationCause,
    });
    if (pending.heroOwned && target.hp <= 0 && session?.state?.enemies?.includes(target)) killedEnemy = true;
    produced = produced || dealt > 0 || (target.lastAbsorbed || 0) > 0;
  });

  (pending.healing || []).forEach(entry => {
    const target = findLiving(entry.targetId);
    const amount = Math.max(0, Math.floor((Number(entry.amount) || 0) * efficiency));
    if (!target || amount <= 0) return;
    produced = applyHealing(target, amount, { source: owner, session, logFn, presentationCause: echoPresentationCause }) > 0 || produced;
  });

  (pending.shields || []).forEach(entry => {
    const target = findLiving(entry.targetId);
    const amount = Math.max(0, Math.floor((Number(entry.amount) || 0) * efficiency));
    if (!target || amount <= 0) return;
    const before = target.shield || 0;
    addEffect(target, {
      id: 'shield',
      duration: Math.max(1, Math.round(Number(entry.duration) || 2)),
      value: amount,
    }, logFn, owner, {
      session,
      forceIndependentInstance: true,
      skipEquipmentShieldBonus: true,
      presentationCause: echoPresentationCause,
    });
    produced = (target.shield || 0) > before || produced;
  });

  (pending.effects || []).forEach(entry => {
    const target = findLiving(entry.targetId);
    if (!target) return;
    const duration = Math.floor((Number(entry.duration) || 0) * efficiency);
    const stacks = Math.floor((Number(entry.stacks) || 1) * efficiency);
    const metadata = getEffectDefinition(entry.id);
    if (!metadata || duration <= 0) return;
    const payload = { id: entry.id, duration };
    if (metadata.stacking === 'stack') {
      if (stacks <= 0) return;
      payload.stacks = stacks;
    }
    const applied = addEffect(target, payload, logFn, owner, { session, presentationCause: echoPresentationCause });
    produced = Boolean(applied) || produced;
  });

  if (pending.heroOwned && getUndeathTier(owner) >= 3) {
    addEffect(owner, { id: 'speed_penalty_minor', duration: 1 }, logFn, owner, { session, presentationCause: echoPresentationCause });
  }
  if (pending.heroOwned && killedEnemy && getUndeathTier(owner) >= 4) {
    applyHealing(owner, (owner.maxHp || 0) * 0.08, { source: owner, session, logFn, presentationCause: echoPresentationCause });
    grantEquipmentTurnMeter(owner, 200, session, { source: 'undeath_echo_kill' });
  }
  logFn(`◈ Эхо повторяет «${pending.abilityName}» с эффективностью ${Math.round(efficiency * 100)}%.`);
  return produced;
}

function deterministicTimedEffects(effects = [], direction = 'asc') {
  return [...effects].sort((left, right) => {
    const leftTurns = Number(left?.remainingTurns ?? left?.duration) || 0;
    const rightTurns = Number(right?.remainingTurns ?? right?.duration) || 0;
    if (leftTurns !== rightTurns) return direction === 'desc' ? rightTurns - leftTurns : leftTurns - rightTurns;
    const leftSerial = Number(left?.appliedSerial) || 0;
    const rightSerial = Number(right?.appliedSerial) || 0;
    if (leftSerial !== rightSerial) return leftSerial - rightSerial;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

function extendTimedEffect(effect, amount = 1) {
  if (!effect || !isFiniteTimedEffect(effect)) return false;
  effect.remainingTurns = Math.max(1, Number(effect.remainingTurns ?? effect.duration) + amount);
  effect.duration = effect.remainingTurns;
  effect.durationTotal = Math.max(Number(effect.durationTotal) || 0, effect.remainingTurns);
  return true;
}

function shortenTimedEffect(owner, effect, amount = 1, logFn = () => {}) {
  if (!owner || !effect || !isFiniteTimedEffect(effect)) return false;
  const next = Math.max(0, Number(effect.remainingTurns ?? effect.duration) - amount);
  if (next <= 0) {
    cleanseEffects(owner, entry => entry === effect, logFn);
    return true;
  }
  effect.remainingTurns = next;
  effect.duration = next;
  return true;
}

function healFromEquipment(unit, amount, logFn = () => {}, label = 'Экипировка') {
  const healed = applyHealing(unit, amount);
  if (healed > 0) {
    logFn(`💚 ${label}: ${unit?.name || 'Герой'} восстанавливает ${healed} HP.`);
  }
  return healed;
}

function resetEquipmentTurnFlags(unit) {
  if (unit) {
    unit._equipmentTurnFlags = {};
    unit._lastInLineAttackCount = 0;
    unit._sporeCrownCooldown = Math.max(0, (unit._sporeCrownCooldown || 0) - 1);
    unit._stilledSapSlowCooldown = Math.max(0, (unit._stilledSapSlowCooldown || 0) - 1);
    unit._stilledSapPoisonCooldown = Math.max(0, (unit._stilledSapPoisonCooldown || 0) - 1);
    unit._clingingIvyCooldown = Math.max(0, (unit._clingingIvyCooldown || 0) - 1);
    unit._eternalSentinelCooldown = Math.max(0, (unit._eternalSentinelCooldown || 0) - 1);
    unit._allkingSignetCooldown = Math.max(0, (unit._allkingSignetCooldown || 0) - 1);
    unit._lastShiftHammerCooldown = Math.max(0, (unit._lastShiftHammerCooldown || 0) - 1);
    unit._blindingGoldCooldown = Math.max(0, (unit._blindingGoldCooldown || 0) - 1);
    unit._erasedNameCooldown = Math.max(0, (unit._erasedNameCooldown || 0) - 1);
    unit._flaringVeinBootsCooldown = Math.max(0, (unit._flaringVeinBootsCooldown || 0) - 1);
    unit._burnedMemoryStaffCooldown = Math.max(0, (unit._burnedMemoryStaffCooldown || 0) - 1);
    unit._foreignShiftCooldown = Math.max(0, (unit._foreignShiftCooldown || 0) - 1);
    unit._greatRootCrownTempoSinceTurn = 0;
  }
}

function canUseEquipmentTurnFlag(unit, flag) {
  if (!unit) return false;
  unit._equipmentTurnFlags = unit._equipmentTurnFlags || {};
  if (unit._equipmentTurnFlags[flag]) return false;
  unit._equipmentTurnFlags[flag] = true;
  return true;
}

function ensureEquipmentBattleFlags(unit) {
  if (!unit) return {};
  unit._equipmentBattleFlags = unit._equipmentBattleFlags || {};
  return unit._equipmentBattleFlags;
}

function getBattleSchoolState(unit) {
  const flags = ensureEquipmentBattleFlags(unit);
  flags.magicSchoolsUsed = Array.isArray(flags.magicSchoolsUsed) ? flags.magicSchoolsUsed : [];
  return flags;
}

function noteMagicSchoolUse(unit, magicSchool, logFn = () => {}) {
  if (!unit || !magicSchool) return { previousSchool: null, changed: false, uniqueCount: 0 };
  const flags = getBattleSchoolState(unit);
  const previousSchool = flags.lastMagicSchool || null;
  const changed = Boolean(previousSchool && previousSchool !== magicSchool);

  if (!flags.magicSchoolsUsed.includes(magicSchool)) {
    flags.magicSchoolsUsed.push(magicSchool);
  }
  flags.lastMagicSchool = magicSchool;

  if (
    flags.magicSchoolsUsed.length >= 2 &&
    !flags.signSeekerHoodCritGranted &&
    hasEquipped(unit, EQUIPMENT_EFFECTS.SIGN_SEEKER_HOOD)
  ) {
    flags.signSeekerHoodCritGranted = true;
    unit.critChance = (unit.critChance ?? DEFAULT_CRIT_CHANCE) + 0.05;
    logFn(`🔮 ${EQUIPMENT_EFFECTS.SIGN_SEEKER_HOOD} усиливает шанс крита до конца боя.`);
  }

  if (flags.magicSchoolsUsed.length >= 3 && hasEquipped(unit, EQUIPMENT_EFFECTS.THREE_SPARKS_AMULET)) {
    flags.threeSparksReady = true;
  }

  return { previousSchool, changed, uniqueCount: flags.magicSchoolsUsed.length };
}

function consumeThreeSparksBonus(attacker, baseDamage, ability) {
  if (!attacker || ability?.isSecondaryDamage || !hasEquipped(attacker, EQUIPMENT_EFFECTS.THREE_SPARKS_AMULET)) {
    return { damage: baseDamage, consumed: false };
  }
  const flags = ensureEquipmentBattleFlags(attacker);
  if (!flags.threeSparksReady || baseDamage <= 0) {
    return { damage: baseDamage, consumed: false };
  }
  flags.threeSparksReady = false;
  flags.magicSchoolsUsed = [];
  flags.lastMagicSchool = null;
  return {
    damage: Math.max(1, Math.round(baseDamage * 1.2)),
    consumed: true,
  };
}

function isSafelyExtendableEquipmentDebuff(effect) {
  if (!effect || CONTROL_DEBUFF_EFFECT_IDS.has(effect.id)) return false;
  if (effect.type !== 'debuff' && effect.kind !== 'debuff') return false;
  return Number.isFinite(effect.remainingTurns) || Number.isFinite(effect.duration);
}

function triggerMistyMossRingHeal(attacker, logFn) {
  if (hasEquipped(attacker, EQUIPMENT_EFFECTS.MISTY_MOSS_RING)) {
    healFromEquipment(attacker, 5, logFn, EQUIPMENT_EFFECTS.MISTY_MOSS_RING);
  }
}

export function applyOathbreakerAction(owner, primaryTarget, deliberateAction, logFn = () => {}) {
  if (!owner || !primaryTarget || !deliberateAction || deliberateAction.oathbreakerProcessed) return false;
  deliberateAction.oathbreakerProcessed = true;
  const targetId = primaryTarget.instanceId || primaryTarget.id || primaryTarget.name;
  if (owner._oathbreakerTargetId !== targetId) {
    owner._oathbreakerTargetId = targetId;
    owner._oathbreakerStacks = 0;
  }
  owner._oathbreakerStacks = Math.min(3, (owner._oathbreakerStacks || 0) + 1);
  owner.turnMeter = Math.min(TURN_METER_THRESHOLD, Math.max(0, owner.turnMeter || 0) + 50);
  owner.effects ||= [];
  const visible = owner.effects.find(effect => effect.id === 'combat_rhythm');
  if (visible) visible.stacks = owner._oathbreakerStacks;
  else owner.effects.push({ id: 'combat_rhythm', name: 'Боевой ритм', type: 'buff', icon: '♪', duration: 999, remainingTurns: 999, stacks: owner._oathbreakerStacks, description: 'Каждый заряд даёт +5 п.п. к шансу критического удара.' });
  logFn(`♪ ${EQUIPMENT_EFFECTS.OATHBREAKER}: Боевой ритм ${owner._oathbreakerStacks}/3, шкала хода +5%.`);
  return true;
}

export const getOathbreakerCritBonus = owner => Math.min(3, owner?._oathbreakerStacks || 0) * 0.05;

export function prepareOathbreakerPrimaryTarget(owner, primaryTarget) {
  if (!owner || !primaryTarget || !hasEquipped(owner, EQUIPMENT_EFFECTS.OATHBREAKER)) return;
  const targetId = primaryTarget.instanceId || primaryTarget.id || primaryTarget.name;
  if (owner._oathbreakerTargetId && owner._oathbreakerTargetId !== targetId) {
    owner._oathbreakerStacks = 0;
    owner.effects = (owner.effects || []).filter(effect => effect.id !== 'combat_rhythm');
  }
}


function recalcPhysicalDefenseAfterBaseChange(unit) {
  if (!unit) return;
  const base = Number(unit.baseStats?.physDef);
  if (!Number.isFinite(base)) return;
  const multiplier = Number(unit.statMultipliers?.physDef) || 1;
  unit.physDef = Math.max(0, Math.round(base * multiplier));
}

function triggerDebtorsBlade(attacker, target, deliberateAction, logFn = () => {}) {
  if (!attacker || !target || !deliberateAction || deliberateAction.debtorsBladeProcessed) return 0;
  if (!hasEquipped(attacker, EQUIPMENT_EFFECTS.DEBTORS_BLADE)) return 0;
  deliberateAction.debtorsBladeProcessed = true;

  attacker.baseStats ||= {
    attack: attacker.attack ?? attacker.baseAtk ?? 0,
    magAtk: attacker.magAtk ?? 0,
    physDef: attacker.physDef ?? 0,
    magicDef: attacker.magicDef ?? 0,
    speed: attacker.speed ?? 0,
  };
  target.baseStats ||= {
    attack: target.attack ?? target.baseAtk ?? 0,
    magAtk: target.magAtk ?? 0,
    physDef: target.physDef ?? 0,
    magicDef: target.magicDef ?? 0,
    speed: target.speed ?? 0,
  };
  if (!Number.isFinite(attacker.baseStats.physDef)) attacker.baseStats.physDef = attacker.physDef ?? 0;
  if (!Number.isFinite(target.baseStats.physDef)) target.baseStats.physDef = target.physDef ?? 0;

  attacker._debtorsBladeStartingPhysDef ??= Math.max(0, Number(attacker.baseStats.physDef) || 0);
  target._debtorsBladeStartingPhysDef ??= Math.max(0, Number(target.baseStats.physDef) || 0);
  attacker._debtorsBladeGainedPhysDef = Math.max(0, Number(attacker._debtorsBladeGainedPhysDef) || 0);
  target._debtorsBladeLostPhysDef = Math.max(0, Number(target._debtorsBladeLostPhysDef) || 0);

  const ownerCap = Math.floor(attacker._debtorsBladeStartingPhysDef * 0.4);
  const targetCap = Math.floor(target._debtorsBladeStartingPhysDef * 0.4);
  const amount = Math.max(0, Math.min(
    4,
    ownerCap - attacker._debtorsBladeGainedPhysDef,
    targetCap - target._debtorsBladeLostPhysDef,
    Number(target.baseStats.physDef) || 0
  ));
  if (amount <= 0) return 0;

  attacker._debtorsBladeGainedPhysDef += amount;
  target._debtorsBladeLostPhysDef += amount;
  attacker.baseStats.physDef += amount;
  target.baseStats.physDef = Math.max(0, target.baseStats.physDef - amount);
  recalcPhysicalDefenseAfterBaseChange(attacker);
  recalcPhysicalDefenseAfterBaseChange(target);
  logFn('🗡️ ' + EQUIPMENT_EFFECTS.DEBTORS_BLADE + ' похищает ' + amount + ' ФЗ у ' + (target.name || 'цели') + '.');
  return amount;
}

function triggerCounterformulaWand({ attacker, recipient, appliedEffect, deliberateAction, logFn = () => {} } = {}) {
  if (!attacker || !recipient || !appliedEffect || !deliberateAction?.attackingAction) return false;
  if (deliberateAction.counterformulaUsed || !hasEquipped(attacker, EQUIPMENT_EFFECTS.COUNTERFORMULA_WAND)) return false;
  if (!isOwnerTimedDebuff(appliedEffect, attacker, { excludeControl: true })) return false;

  const suitable = (recipient.effects || []).filter(effect =>
    isOwnerTimedDebuff(effect, attacker, { excludeControl: true })
  );
  const targetId = combatUnitId(recipient);
  const preexisting = deliberateAction.counterformulaPreexistingByTarget?.[targetId] || [];
  const hasDifferentExisting = preexisting.some(effectId => effectId !== appliedEffect.id);
  if (!hasDifferentExisting) return false;

  const selected = deterministicTimedEffects(suitable, 'asc')[0];
  if (!selected || !extendTimedEffect(selected, 1)) return false;
  deliberateAction.counterformulaUsed = true;
  logFn('🪄 ' + EQUIPMENT_EFFECTS.COUNTERFORMULA_WAND + ' продлевает «' + (selected.name || getEffectDefinition(selected.id)?.name || selected.id) + '» на 1 ход.');
  return true;
}

function registerLastInLineIncomingAction(target, attacker, deliberateAction, session, logFn = () => {}) {
  if (!target || !attacker || !deliberateAction || target.hp <= 0) return false;
  if (!hasEquipped(target, EQUIPMENT_EFFECTS.LAST_IN_LINE_CUIRASS)) return false;
  if (!(session?.state?.enemies || []).includes(attacker)) return false;

  deliberateAction.lastInLineTargets ||= [];
  const targetId = combatUnitId(target);
  if (deliberateAction.lastInLineTargets.includes(targetId)) return false;
  deliberateAction.lastInLineTargets.push(targetId);

  target._lastInLineAttackCount = Math.max(0, Number(target._lastInLineAttackCount) || 0) + 1;
  if (target._lastInLineAttackCount < 2 || !canUseEquipmentTurnFlag(target, 'lastInLineSeal')) return false;
  target._lastInLineAttackCount = 0;
  addEffect(target, { id: 'protection_seals', stacks: 1 }, logFn, target, { session });
  logFn('🛡️ ' + EQUIPMENT_EFFECTS.LAST_IN_LINE_CUIRASS + ' создаёт Печать защиты.');
  return true;
}

function prepareEternalSentinelAgainstAction(target, attacker, deliberateAction, session, logFn = () => {}) {
  if (!target || !attacker || !deliberateAction) return false;
  if (!hasEquipped(target, EQUIPMENT_EFFECTS.ETERNAL_SENTINEL_HELMET)) return false;
  if (!(session?.state?.enemies || []).includes(attacker)) return false;

  const attackerId = combatUnitId(attacker);
  if (!attackerId || target._eternalSentinelMarkedAttackerId !== attackerId) return false;
  if (target._eternalSentinelMarkedAction === deliberateAction) return false;

  deliberateAction.eternalSentinelReducedTargetIds ||= [];
  const targetId = combatUnitId(target);
  if (!targetId || deliberateAction.eternalSentinelReducedTargetIds.includes(targetId)) return true;

  deliberateAction.eternalSentinelReducedTargetIds.push(targetId);
  target._eternalSentinelMarkedAttackerId = null;
  target._eternalSentinelMarkedAction = null;
  target._eternalSentinelCooldown = 2;
  logFn('🪖 ' + EQUIPMENT_EFFECTS.ETERNAL_SENTINEL_HELMET + ' ослабляет следующее атакующее действие ' + (attacker.name || 'врага') + ' на 30%.');
  return true;
}

function getEternalSentinelDamageMultiplier(target, deliberateAction) {
  const targetId = combatUnitId(target);
  return targetId && deliberateAction?.eternalSentinelReducedTargetIds?.includes(targetId) ? 0.7 : 1;
}

function registerEternalSentinelIncomingAction(target, attacker, deliberateAction, session) {
  if (!target || !attacker || !deliberateAction || target.hp <= 0) return false;
  if (!hasEquipped(target, EQUIPMENT_EFFECTS.ETERNAL_SENTINEL_HELMET)) return false;
  if (!(session?.state?.enemies || []).includes(attacker)) return false;
  if ((target._eternalSentinelCooldown || 0) > 0) return false;
  if (deliberateAction.eternalSentinelReducedTargetIds?.includes(combatUnitId(target))) return false;
  if (target._eternalSentinelMarkedAttackerId) return false;

  target._eternalSentinelMarkedAttackerId = combatUnitId(attacker);
  target._eternalSentinelMarkedAction = deliberateAction;
  return true;
}

function triggerBlindingGoldAmulet(target, attacker, deliberateAction, session, logFn = () => {}) {
  if (!target || !attacker || !deliberateAction) return false;
  if (!hasEquipped(target, EQUIPMENT_EFFECTS.BLINDING_GOLD_AMULET)) return false;
  if (!(session?.state?.enemies || []).includes(attacker)) return false;
  if ((target._blindingGoldCooldown || 0) > 0) return false;
  target._blindingGoldCooldown = 3;
  addEffect(attacker, { id: 'blind', duration: 2 }, logFn, target, { session });
  logFn?.(`✨ ${EQUIPMENT_EFFECTS.BLINDING_GOLD_AMULET} ослепляет ${attacker.name || 'атакующего'}.`);
  return true;
}

function getPrideSwordDirectMultiplier(attacker, target, deliberateAction) {
  if (!attacker || !target || !deliberateAction) return 1;
  if (!hasEquipped(attacker, EQUIPMENT_EFFECTS.PRIDE_SWORD)) return 1;

  if ((target.effects || []).some(effect => effect?.id === 'reverence')) {
    deliberateAction.prideSwordReverenceBonusTargetId ||= combatUnitId(target);
    return deliberateAction.prideSwordReverenceBonusTargetId === combatUnitId(target) ? 2.75 : 1;
  }

  if (deliberateAction.prideSwordProcessed || deliberateAction.prideSwordFinisher) return 1;
  if ((attacker._prideArroganceCharges || 0) < 3) return 1;

  const controlImmune = Boolean(target.controlImmune || target._temporaryControlImmunity);
  deliberateAction.prideSwordFinisher = controlImmune ? 'immune' : 'reverence';
  deliberateAction.prideSwordFinisherTargetId = combatUnitId(target);
  return controlImmune ? 2.5 : 1;
}

function wakeReverenceFromDirectHit(target, logFn = () => {}) {
  if (!target || !(target.effects || []).some(effect => effect?.id === 'reverence')) return false;
  cleanseEffects(target, effect => effect?.id === 'reverence', logFn);
  logFn?.(`👑 ${target.name || 'Цель'} пробуждается от Преклонения.`);
  return true;
}

function resolvePrideSwordConnectedHit(attacker, target, deliberateAction, session, logFn = () => {}) {
  if (!attacker || !deliberateAction || !hasEquipped(attacker, EQUIPMENT_EFFECTS.PRIDE_SWORD)) return;
  if (deliberateAction.prideSwordProcessed) return;
  deliberateAction.prideSwordProcessed = true;

  if (deliberateAction.prideSwordFinisher === 'immune') {
    attacker._prideArroganceCharges = 0;
    logFn?.(`⚔️ ${EQUIPMENT_EFFECTS.PRIDE_SWORD} разбивает волю невосприимчивой цели усиленным четвёртым ударом.`);
    return;
  }

  if (deliberateAction.prideSwordFinisher === 'reverence') {
    attacker._prideArroganceCharges = 0;
    if (target.hp > 0) {
      const ownerId = combatUnitId(attacker);
      (session?.state?.enemies || []).filter(unit => unit && unit !== target && unit.hp > 0).forEach(unit => {
        const existing = (unit.effects || []).find(effect =>
          effect?.id === 'reverence' && (!effect.sourceId || effect.sourceId === ownerId)
        );
        if (existing) {
          cleanseEffects(unit, effect => effect === existing, logFn);
          logFn?.(`👑 ${unit.name || 'Прежняя цель'} освобождается от Преклонения: Меч выбирает новую цель.`);
        }
      });
      const applied = addEffect(target, { id: 'reverence' }, logFn, attacker, { session });
      if (applied) {
        target._reverencePeriodicDamage = 0;
        logFn?.(`👑 ${EQUIPMENT_EFFECTS.PRIDE_SWORD} заставляет ${target.name || 'цель'} преклониться.`);
      }
    }
    return;
  }

  attacker._prideArroganceCharges = Math.min(3, Math.max(0, attacker._prideArroganceCharges || 0) + 1);
  logFn?.(`⚔️ ${EQUIPMENT_EFFECTS.PRIDE_SWORD}: Высокомерие ${attacker._prideArroganceCharges}/3.`);
}

function getTornRitualDamageMultiplier(target, attacker, deliberateAction, session, logFn = () => {}) {
  if (!target || !attacker || !deliberateAction) return 1;
  if (!hasEquipped(target, EQUIPMENT_EFFECTS.TORN_RITUAL_JACKET)) return 1;
  if (!(session?.state?.enemies || []).includes(attacker)) return 1;

  deliberateAction.tornRitualTargets ||= [];
  const targetId = combatUnitId(target);
  if (deliberateAction.tornRitualTargets.includes(targetId)) return 0.8;
  if (target._equipmentTurnFlags?.tornRitualUsed) return 1;

  const eligible = (attacker.effects || []).filter(effect =>
    isOwnerTimedDebuff(effect, target, { excludeControl: true, excludeStacks: true })
  );
  const selected = deterministicTimedEffects(eligible, 'desc')[0];
  if (!selected) return 1;

  if (!shortenTimedEffect(attacker, selected, 1, logFn)) return 1;
  canUseEquipmentTurnFlag(target, 'tornRitualUsed');
  deliberateAction.tornRitualTargets.push(targetId);
  logFn('🧥 ' + EQUIPMENT_EFFECTS.TORN_RITUAL_JACKET + ' жертвует длительностью «' + (selected.name || getEffectDefinition(selected.id)?.name || selected.id) + '» и снижает прямой урон действия на 20%.');
  return 0.8;
}

function triggerUnfinishedOrderCirclet(attacker, target, deliberateAction, session, logFn = () => {}) {
  if (!attacker || !target || !deliberateAction || !attacker._unfinishedOrderReady) return false;
  if (!hasEquipped(attacker, EQUIPMENT_EFFECTS.UNFINISHED_ORDER_CIRCLET) || deliberateAction.unfinishedOrderProcessed) return false;
  deliberateAction.unfinishedOrderProcessed = true;
  attacker._unfinishedOrderReady = false;

  const eligible = (target.effects || []).filter(effect =>
    isOwnerTimedDebuff(effect, attacker, { excludeControl: true })
  );
  if (!eligible.length) return false;
  const rng = combatRng(session);
  const index = Math.min(eligible.length - 1, Math.floor(rng() * eligible.length));
  const selected = eligible[index];
  if (!extendTimedEffect(selected, 1)) return false;
  logFn('👑 ' + EQUIPMENT_EFFECTS.UNFINISHED_ORDER_CIRCLET + ' продлевает «' + (selected.name || getEffectDefinition(selected.id)?.name || selected.id) + '» на 1 ход.');
  return true;
}

function registerSightingBowDamage(attacker, target, ability, deliberateAction, damageType, dealt, absorbed = 0) {
  if (!attacker || !target || !deliberateAction || ability?.isSecondaryDamage || ability?.passive) return;
  if (!hasEquipped(attacker, EQUIPMENT_EFFECTS.SIGHTING_BOW) || damageType !== 'physical') return;
  const targetId = combatUnitId(target);
  if (!targetId || deliberateAction.primaryTargetId !== targetId) return;
  deliberateAction.sightingBowPhysicalDamage = Math.max(0, Number(deliberateAction.sightingBowPhysicalDamage) || 0)
    + Math.max(0, Number(dealt) || 0)
    + Math.max(0, Number(absorbed) || 0);
}

function finalizeSightingBowAction(attacker, primaryTarget, deliberateAction, session, logFn = () => {}) {
  if (!attacker || !deliberateAction || !hasEquipped(attacker, EQUIPMENT_EFFECTS.SIGHTING_BOW)) return 0;
  const total = Math.max(0, Number(deliberateAction.sightingBowPhysicalDamage) || 0);
  if (total <= 0 || deliberateAction.sightingBowFinalized) return 0;
  deliberateAction.sightingBowFinalized = true;
  attacker._sightingBowAttackCount = Math.max(0, Number(attacker._sightingBowAttackCount) || 0) + 1;
  if (attacker._sightingBowAttackCount % 2 !== 0 || !primaryTarget || primaryTarget.hp <= 0) return 0;

  const raw = Math.max(1, Math.round(total * 0.5));
  const dealt = applyDamage(primaryTarget, raw, 'physical', {
    source: attacker,
    session,
    logFn,
    ignoreDefenseFraction: 1,
    bypassDamageModifiers: true,
    directAttack: false,
    fromEffect: 'equipment-sighting-bow',
    sourceEffectId: 'equipment-sighting-bow',
  });
  const absorbed = primaryTarget.lastAbsorbed || 0;
  logFn('🏹 ' + EQUIPMENT_EFFECTS.SIGHTING_BOW + ' выпускает дополнительную стрелу (' + (dealt + absorbed) + ' урона).');
  return dealt + absorbed;
}

function resolveClingingResinAmulet(attacker, deliberateAction, session, logFn = () => {}) {
  if (
    !attacker ||
    !deliberateAction?.preparedWeaponConsumed ||
    !hasEquipped(attacker, EQUIPMENT_EFFECTS.CLINGING_RESIN_AMULET)
  ) return 0;
  const targets = [...new Set(deliberateAction.successfulDirectTargets || [])]
    .filter(target => target && target.hp > 0);
  if (!targets.length) return 0;
  const stacks = deliberateAction.multiTargetAction ? 1 : 2;
  let affected = 0;
  targets.forEach(target => {
    const before = getEffectStackCount(target, 'entanglement');
    addEffect(target, { id: 'entanglement', stacks }, logFn, attacker, { session, deliberateAction });
    if (getEffectStackCount(target, 'entanglement') > before) affected += 1;
  });
  if (affected > 0) {
    logFn(`🌿 ${EQUIPMENT_EFFECTS.CLINGING_RESIN_AMULET} добавляет ${stacks} зар. Опутывания ${deliberateAction.multiTargetAction ? 'каждой поражённой цели' : 'цели'}.`);
  }
  return affected;
}

function triggerPursuerBootsKill(attacker, target, deliberateAction, session, logFn = () => {}) {
  if (!attacker || !target || !deliberateAction || deliberateAction.pursuerBootsTriggered) return false;
  if (!hasEquipped(attacker, EQUIPMENT_EFFECTS.PURSUER_BOOTS) || target.hp > 0) return false;
  const enemies = session?.state?.enemies || [];
  if (!enemies.some(enemy => enemy && enemy !== target && enemy.hp > 0 && !enemy.nonBlocking)) return false;
  deliberateAction.pursuerBootsTriggered = true;
  attacker.turnMeter = Math.min(TURN_METER_THRESHOLD, Math.max(0, attacker.turnMeter || 0) + 200);
  logFn('🥾 ' + EQUIPMENT_EFFECTS.PURSUER_BOOTS + ' заполняют шкалу хода на 20%.');
  return true;
}

function processForeignSignalHelmet(enemy, session, logFn = () => {}) {
  if (!enemy || enemy.hp <= 0) return false;
  const owner = (session?.state?.players || []).find(unit =>
    unit?.hp > 0 && hasEquipped(unit, EQUIPMENT_EFFECTS.FOREIGN_SIGNAL_HELMET)
  );
  if (!owner) return false;
  owner._foreignSignalProcessedEnemyIds ||= [];
  const enemyId = combatUnitId(enemy);
  if (owner._foreignSignalProcessedEnemyIds.includes(enemyId)) return false;

  const eligible = (enemy.effects || []).filter(effect => {
    const def = getEffectDefinition(effect.id);
    const type = effect.type || def?.type;
    return type === 'buff' && isFiniteTimedEffect(effect)
      && Number(effect.remainingTurns ?? effect.duration) >= 2;
  });
  const selected = eligible[0];
  if (!selected) return false;

  owner._foreignSignalProcessedEnemyIds.push(enemyId);
  shortenTimedEffect(enemy, selected, 1, logFn);
  logFn('📡 ' + EQUIPMENT_EFFECTS.FOREIGN_SIGNAL_HELMET + ' сокращает «' + (selected.name || getEffectDefinition(selected.id)?.name || selected.id) + '» у ' + enemy.name + ' на 1 ход.');
  return true;
}

function isPrimaryDeliberateTarget(target, deliberateAction) {
  const id = combatUnitId(target);
  return Boolean(id && deliberateAction?.primaryTargetId === id);
}

function triggerViscousVeinBow({
  attacker,
  target,
  deliberateAction,
  targetWasPoisoned,
  session,
  logFn = () => {},
} = {}) {
  if (!attacker || !target || !deliberateAction || !hasEquipped(attacker, EQUIPMENT_EFFECTS.VISCOUS_VEIN_BOW)) return false;
  if (deliberateAction.viscousVeinProcessedTargets?.includes(combatUnitId(target))) return false;
  deliberateAction.viscousVeinProcessedTargets ||= [];
  deliberateAction.viscousVeinProcessedTargets.push(combatUnitId(target));

  const flags = ensureEquipmentBattleFlags(attacker);
  if (!flags.viscousVeinFirstHitUsed) {
    flags.viscousVeinFirstHitUsed = true;
    deliberateAction.viscousVeinFirstHitAction = true;
    addEffect(target, { id: POISON_EFFECT_ID, duration: 2 }, logFn, attacker, { session });
    logFn('🏹 ' + EQUIPMENT_EFFECTS.VISCOUS_VEIN_BOW + ' отравляет первую поражённую цель.');
    return true;
  }
  if (deliberateAction.viscousVeinFirstHitAction || !targetWasPoisoned) return false;
  if (attacker._equipmentTurnFlags?.viscousVeinTempo) return false;
  const targetMeterBefore = Math.max(0, Number(target.turnMeter) || 0);
  const stolen = reduceHostileTurnMeterForEquipment(target, 100);
  if (stolen <= 0) return false;
  canUseEquipmentTurnFlag(attacker, 'viscousVeinTempo');
  recordCombatPresentationEvent(session, {
    type: 'turnMeterChanged',
    actor: attacker,
    target,
    amount: stolen,
    delta: -stolen,
    before: targetMeterBefore,
    after: target.turnMeter,
    changeKind: 'loss',
    reason: 'turn_meter_steal',
  });
  grantEquipmentTurnMeter(attacker, stolen, session, { source: target, reason: 'turn_meter_steal' });
  recordCombatPresentationEvent(session, {
    type: 'turnMeterSteal',
    actor: attacker,
    target,
    amount: stolen,
    label: EQUIPMENT_EFFECTS.VISCOUS_VEIN_BOW,
  });
  logFn('🏹 ' + EQUIPMENT_EFFECTS.VISCOUS_VEIN_BOW + ' похищает ' + Math.round(stolen / 10) + '% ШХ у ' + (target.name || 'цели') + '.');
  return true;
}

function triggerStilledSapFocus({
  attacker,
  target,
  deliberateAction,
  targetWasSlowed,
  session,
  logFn = () => {},
} = {}) {
  if (!attacker || !target || !deliberateAction || !hasEquipped(attacker, EQUIPMENT_EFFECTS.STILLED_SAP_FOCUS)) return false;
  let changed = false;
  if (deliberateAction.stilledSapSlowWindow == null) {
    deliberateAction.stilledSapSlowWindow = (attacker._stilledSapSlowCooldown || 0) <= 0;
  }
  deliberateAction.stilledSapSlowedTargets ||= [];
  const targetId = combatUnitId(target);
  if (deliberateAction.stilledSapSlowWindow && !deliberateAction.stilledSapSlowedTargets.includes(targetId)) {
    deliberateAction.stilledSapSlowedTargets.push(targetId);
    const applied = addEffect(
      target,
      { id: 'speed_penalty_minor', duration: 2 },
      logFn,
      attacker,
      { session }
    );
    if (applied) {
      attacker._stilledSapSlowCooldown = 2;
      changed = true;
    }
  }

  if (
    targetWasSlowed &&
    isPrimaryDeliberateTarget(target, deliberateAction) &&
    !deliberateAction.stilledSapPoisonProcessed &&
    (attacker._stilledSapPoisonCooldown || 0) <= 0
  ) {
    deliberateAction.stilledSapPoisonProcessed = true;
    const applied = addEffect(target, { id: POISON_EFFECT_ID, duration: 2 }, logFn, attacker, { session });
    if (applied) {
      attacker._stilledSapPoisonCooldown = 2;
      changed = true;
    }
  }
  return changed;
}

function triggerClingingIvyRing({
  attacker,
  target,
  deliberateAction,
  targetWasPoisoned,
  session,
  logFn = () => {},
} = {}) {
  if (!attacker || !target || !deliberateAction || !targetWasPoisoned) return false;
  if (!hasEquipped(attacker, EQUIPMENT_EFFECTS.CLINGING_IVY_RING)) return false;
  if ((attacker._clingingIvyCooldown || 0) > 0 || deliberateAction.clingingIvyProcessed) return false;
  deliberateAction.clingingIvyProcessed = true;
  const before = getEntanglementStacks(target);
  addEffect(target, { id: 'entanglement', stacks: 2 }, logFn, attacker, { session });
  const added = Math.max(0, getEntanglementStacks(target) - before);
  if (added <= 0) return false;
  attacker._clingingIvyCooldown = 2;
  logFn('🌿 ' + EQUIPMENT_EFFECTS.CLINGING_IVY_RING + ' добавляет ' + added + ' зар. Опутывания.');
  return true;
}

function triggerLivingScarsRing({
  attacker,
  target,
  deliberateAction,
  targetWasPoisoned,
  session,
  logFn = () => {},
} = {}) {
  if (!attacker || !target || !deliberateAction || !attacker._livingScarsReady || !targetWasPoisoned) return false;
  if (!hasEquipped(attacker, EQUIPMENT_EFFECTS.LIVING_SCARS_RING)) return false;
  const poison = getOwnedPoisonEffects(target, attacker)[0];
  if (!poison || !canUseEquipmentTurnFlag(attacker, 'livingScarsExtraTick')) return false;

  attacker._livingScarsReady = false;
  triggerEffectTick(target, poison, {
    session,
    applyDamage: (unit, amount, type, extra = {}) =>
      applyDamage(unit, amount, type, { ...extra, session, logFn }),
    applyHealing: (unit, amount, options = {}) =>
      applyHealing(unit, amount, { ...options, session, logFn }),
    getAllies: () => (session?.state?.enemies || []).includes(target) ? session.state.enemies : session.state.players,
    getOpponents: () => (session?.state?.enemies || []).includes(target) ? session.state.players : session.state.enemies,
  }, logFn);
  logFn('💍 ' + EQUIPMENT_EFFECTS.LIVING_SCARS_RING + ' вызывает дополнительный тик собственного Отравления.');
  return true;
}

function triggerStolenTideVessel({
  attacker,
  target,
  deliberateAction,
  targetWasSlowed,
  damageType,
  session,
  logFn = () => {},
} = {}) {
  if (!attacker || !target || !deliberateAction || !targetWasSlowed || damageType !== 'magical') return false;
  if (!hasEquipped(attacker, EQUIPMENT_EFFECTS.STOLEN_TIDE_VESSEL)) return false;
  if (!isPrimaryDeliberateTarget(target, deliberateAction) || deliberateAction.stolenTideProcessed) return false;

  const slow = deterministicTimedEffects(
    (target.effects || []).filter(effect => FOREST_SLOW_EFFECT_IDS.has(effect?.id) && isFiniteTimedEffect(effect)),
    'desc'
  )[0];
  if (!slow || attacker._equipmentTurnFlags?.stolenTide) return false;
  canUseEquipmentTurnFlag(attacker, 'stolenTide');
  deliberateAction.stolenTideProcessed = true;
  shortenTimedEffect(target, slow, 1, logFn);
  addEffect(attacker, { id: 'regeneration', duration: 1 }, logFn, attacker, { session });
  logFn('🌊 ' + EQUIPMENT_EFFECTS.STOLEN_TIDE_VESSEL + ' крадёт один ход Замедления и даёт Регенерацию.');
  return true;
}

function triggerForestSentinelMaskHit(attacker, target, deliberateAction, session, logFn = () => {}) {
  if (!attacker || !target || !deliberateAction || !hasEquipped(attacker, EQUIPMENT_EFFECTS.FOREST_SENTINEL_MASK)) return false;
  const flags = ensureEquipmentBattleFlags(attacker);
  flags.forestSentinelPreparedTargetIds ||= [];
  flags.forestSentinelCooldownByTarget ||= {};
  const targetId = combatUnitId(target);
  if (!targetId || !flags.forestSentinelPreparedTargetIds.includes(targetId)) return false;
  flags.forestSentinelPreparedTargetIds = flags.forestSentinelPreparedTargetIds.filter(id => id !== targetId);
  flags.forestSentinelCooldownByTarget[targetId] = 2;
  addEffect(target, { id: POISON_EFFECT_ID, duration: 2 }, logFn, attacker, { session });
  logFn('🎭 ' + EQUIPMENT_EFFECTS.FOREST_SENTINEL_MASK + ' отравляет ' + (target.name || 'цель') + '.');
  return true;
}

function triggerLastBloomBow(attacker, target, deliberateAction, session, logFn = () => {}) {
  if (!attacker || !target || !deliberateAction || !hasEquipped(attacker, EQUIPMENT_EFFECTS.LAST_BLOOM_BOW)) return false;
  if (!isPrimaryDeliberateTarget(target, deliberateAction) || deliberateAction.lastBloomSeedProcessed) return false;
  deliberateAction.lastBloomSeedProcessed = true;
  addEffect(target, { id: 'withering_seed', stacks: 1 }, logFn, attacker, { session });
  const seeds = getEffectStackCount(target, 'withering_seed');
  if (seeds < 3) {
    logFn('🌱 ' + EQUIPMENT_EFFECTS.LAST_BLOOM_BOW + ': Семя увядания ' + seeds + '/3.');
    return true;
  }

  consumeEffectStacks(target, 'withering_seed', 3);
  addEffect(target, { id: POISON_EFFECT_ID, duration: 2 }, logFn, attacker, { session });
  if (target.entanglementImmune === true) {
    const bonus = applyDamage(target, Math.max(1, Math.round((attacker.attack || 0) * 0.5)), 'physical', {
      source: attacker,
      session,
      logFn,
      directAttack: false,
      fromEffect: 'equipment-last-bloom',
      sourceEffectId: 'equipment-last-bloom',
    });
    logFn('🏹 ' + EQUIPMENT_EFFECTS.LAST_BLOOM_BOW + ' не может опутать цель и наносит ' + bonus + ' дополнительного урона.');
  } else {
    addEffect(target, { id: 'entanglement', stacks: 3 }, logFn, attacker, { session });
  }
  addEffect(attacker, { id: 'regeneration', duration: 1 }, logFn, attacker, { session });
  logFn('🌸 Третье Семя увядания раскрывается.');
  return true;
}

function triggerLateSpringShroud(target, hpBeforeDamage, session, logFn = () => {}) {
  if (!target || !hasEquipped(target, EQUIPMENT_EFFECTS.LATE_SPRING_SHROUD)) return false;
  const flags = ensureEquipmentBattleFlags(target);
  if (flags.lateSpringTriggered || target.maxHp <= 0) return false;
  const threshold = target.maxHp * 0.5;
  if (!(hpBeforeDamage >= threshold && target.hp < threshold && target.hp > 0)) return false;
  flags.lateSpringTriggered = true;
  addEffect(target, {
    id: 'regeneration',
    duration: 2,
    extra: { equipmentSource: 'late_spring_shroud' },
  }, logFn, target, { session });
  logFn('🌱 ' + EQUIPMENT_EFFECTS.LATE_SPRING_SHROUD + ' пробуждает Регенерацию.');
  return true;
}

function advanceForestSentinelMaskCooldownsForTarget(target, session) {
  if (!target || !(session?.state?.enemies || []).includes(target)) return;
  const targetId = combatUnitId(target);
  (session.state.players || []).forEach(owner => {
    if (!owner || !hasEquipped(owner, EQUIPMENT_EFFECTS.FOREST_SENTINEL_MASK)) return;
    const flags = ensureEquipmentBattleFlags(owner);
    flags.forestSentinelCooldownByTarget ||= {};
    const current = Math.max(0, Number(flags.forestSentinelCooldownByTarget[targetId]) || 0);
    if (current > 0) flags.forestSentinelCooldownByTarget[targetId] = current - 1;
  });
}

function handleForestTempoSignal(target, gained, meta = {}, session = null) {
  if (!target || meta?.natural || !(session?.state?.enemies || []).includes(target)) return false;
  if (!(gained > 0 || meta?.reason === 'haste')) return false;
  const owner = (session.state.players || []).find(unit =>
    unit?.hp > 0 && hasEquipped(unit, EQUIPMENT_EFFECTS.FOREST_SENTINEL_MASK)
  );
  if (!owner) return false;
  const flags = ensureEquipmentBattleFlags(owner);
  flags.forestSentinelPreparedTargetIds ||= [];
  flags.forestSentinelCooldownByTarget ||= {};
  const targetId = combatUnitId(target);
  if (!targetId || (flags.forestSentinelCooldownByTarget[targetId] || 0) > 0) return false;
  if (!flags.forestSentinelPreparedTargetIds.includes(targetId)) {
    flags.forestSentinelPreparedTargetIds.push(targetId);
  }
  return true;
}

function handleForestPoisonTick({ target, effect, source, actualDamage = 0, log = () => {} } = {}, session = null) {
  if (!target || !effect || !session?.state) return;

  if (
    source?.hp > 0 &&
    hasEquipped(source, EQUIPMENT_EFFECTS.BITTER_DEW_AMULET) &&
    actualDamage > 0 &&
    !source._equipmentTurnFlags?.bitterDewPoisonHeal
  ) {
    const healed = applyHealing(source, Math.max(1, Math.round(actualDamage * 0.2)), {
      source,
      session,
      logFn: log,
    });
    if (healed > 0) {
      canUseEquipmentTurnFlag(source, 'bitterDewPoisonHeal');
      log('💧 ' + EQUIPMENT_EFFECTS.BITTER_DEW_AMULET + ' восстанавливает ' + healed + ' HP.');
    }
  }

  const crownOwner = (session.state.players || []).find(unit =>
    unit?.hp > 0 && hasEquipped(unit, EQUIPMENT_EFFECTS.GREAT_ROOT_WOUND_CROWN)
  );
  if (crownOwner && (session.state.enemies || []).includes(target)) {
    const used = Math.max(0, Number(crownOwner._greatRootCrownTempoSinceTurn) || 0);
    const grant = Math.min(150, Math.max(0, 500 - used));
    if (grant > 0) {
      crownOwner._greatRootCrownTempoSinceTurn = used + grant;
      grantEquipmentTurnMeter(crownOwner, grant, session, { source: target, reason: 'great_root_poison_tick' });
    }
  }
}

function handleForestPoisonEnded({ target, effect, reason, log = () => {} } = {}, session = null) {
  if (!target || !effect || !session?.state || !['natural', 'death'].includes(reason)) return false;
  if (effect.extra?.fallenHourTransferred || effect.extra?.fallenHourResolved) return false;
  effect.extra ||= {};
  effect.extra.fallenHourResolved = true;
  const sourceRef = effect.sourceRef || effect.sourceSnapshot?.entity || null;
  const sourceId = effect.sourceId ?? effect.sourceSnapshot?.id ?? sourceRef?.id ?? null;
  const source = sourceRef || [...(session.state.players || []), ...(session.state.enemies || [])]
    .find(unit => unit?.id === sourceId) || null;
  if (!source || !hasEquipped(source, EQUIPMENT_EFFECTS.FALLEN_HOUR_RING)) return false;
  const side = (session.state.enemies || []).includes(target) ? session.state.enemies : session.state.players;
  const candidates = (side || []).filter(unit => unit && unit !== target && unit.hp > 0);
  if (!candidates.length) return false;
  const rng = combatRng(session);
  const recipient = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
  addEffect(recipient, {
    id: POISON_EFFECT_ID,
    duration: 1,
    extra: { fallenHourTransferred: true },
  }, log, source, { session });
  log('🕰️ ' + EQUIPMENT_EFFECTS.FALLEN_HOUR_RING + ' переносит Отравление на ' + (recipient.name || 'новую цель') + '.');
  return true;
}

function handleForestRegenerationTick({ target, effect, restored = 0, log = () => {} } = {}, session = null) {
  if (!target || restored <= 0) return;
  if (hasEquipped(target, EQUIPMENT_EFFECTS.LIVING_SCARS_RING)) {
    target._livingScarsReady = true;
  }
  if (hasEquipped(target, EQUIPMENT_EFFECTS.LATE_SPRING_SHROUD) && effect?.extra?.equipmentSource === 'late_spring_shroud') {
    const gained = grantEquipmentTurnMeter(target, 80, session, { source: target, reason: 'late_spring_regeneration' });
    if (gained > 0) log('🌱 ' + EQUIPMENT_EFFECTS.LATE_SPRING_SHROUD + ' заполняет ШХ на ' + Math.round(gained / 10) + '%.');
  }
}

function handleForestEntanglementAdded({ source, added = 0 } = {}, session = null) {
  if (!source || added <= 0 || !hasEquipped(source, EQUIPMENT_EFFECTS.SPROUTED_PATH_BOOTS)) return false;
  if (!canUseEquipmentTurnFlag(source, 'sproutedPathTempo')) return false;
  grantEquipmentTurnMeter(source, 100, session, { source, reason: 'entanglement_applied' });
  return true;
}

function applyForestEquipmentBattleStartEffects(session, logFn = () => {}) {
  const owner = (session?.state?.players || []).find(unit =>
    unit?.hp > 0 && hasEquipped(unit, EQUIPMENT_EFFECTS.GREAT_ROOT_WOUND_CROWN)
  );
  if (!owner) return;
  (session.state.enemies || []).filter(enemy => enemy?.hp > 0).forEach(enemy => {
    addEffect(enemy, { id: 'great_root_plague' }, logFn, owner, { session });
  });
}

function triggerEquipmentOnEffectApplied({
  attacker,
  recipient,
  effect,
  beforeTurns = null,
  session = null,
  logFn = () => {},
  magicalSource = false,
  deliberateAction = null,
} = {}) {
  if (!effect) return;
  triggerCounterformulaWand({
    attacker,
    recipient,
    appliedEffect: effect,
    deliberateAction,
    logFn,
  });
  const extended = Number.isFinite(beforeTurns) && (effect.remainingTurns ?? 0) > beforeTurns;
  if (extended) {
    triggerMistyMossRingHeal(attacker, logFn);
  }

  const isDebuff = effect.type === 'debuff' || effect.kind === 'debuff';
  if (
    isDebuff &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.ASHEN_APPRENTICE_MASK) &&
    !attacker._equipmentBattleFlags?.ashenApprenticeMaskUsed &&
    isSafelyExtendableEquipmentDebuff(effect)
  ) {
    const flags = ensureEquipmentBattleFlags(attacker);
    flags.ashenApprenticeMaskUsed = true;
    effect.remainingTurns = (effect.remainingTurns ?? effect.duration ?? 1) + 1;
    effect.duration = effect.remainingTurns;
    effect.durationTotal = Math.max(effect.durationTotal ?? 0, effect.remainingTurns);
    logFn(`🎭 ${EQUIPMENT_EFFECTS.ASHEN_APPRENTICE_MASK} продлевает первый штраф на 1 ход.`);
  }

  if (
    isDebuff &&
    magicalSource &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.FROST_FOCUS) &&
    canUseEquipmentTurnFlag(attacker, 'frostFocusShield')
  ) {
    addEffect(attacker, { id: 'shield', duration: 2, value: 4 }, logFn, attacker, { session });
  }

  if (
    ELEMENTAL_STATUS_EFFECT_IDS.has(effect.id) &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.SMOLDERING_ECHO_RING) &&
    canUseEquipmentTurnFlag(attacker, 'smolderingEchoDamage')
  ) {
    const extra = applyDamage(recipient, Math.max(1, Math.round((attacker.magAtk || 0) * 0.15)), 'magical', {
      source: attacker,
      logFn,
      session,
      fromEffect: 'equipment-smoldering-echo',
      sourceEffectId: 'equipment-smoldering-echo',
      skipFlameRuneTrigger: true,
    });
    if (extra > 0) {
      logFn(`💍 ${EQUIPMENT_EFFECTS.SMOLDERING_ECHO_RING} наносит ${extra} дополнительного магического урона.`);
    }
  }

  if (effect.id === BLEED_EFFECT_ID) {
    if (hasEquipped(attacker, EQUIPMENT_EFFECTS.RED_RATCATCHER_CAP) && combatRng(session)() < 0.2) {
      effect.remainingTurns = (effect.remainingTurns ?? effect.duration ?? 1) + 1;
      effect.duration = effect.remainingTurns;
      effect.durationTotal = Math.max(effect.durationTotal ?? 0, effect.remainingTurns);
      logFn(`🩸 ${EQUIPMENT_EFFECTS.RED_RATCATCHER_CAP} продлевает Кровотечение на 1 ход.`);
      triggerMistyMossRingHeal(attacker, logFn);
    }

    if (hasEquipped(attacker, EQUIPMENT_EFFECTS.GOBLIN_BUTCHER_CLEAVER)) {
      const dealt = applyDamage(recipient, Math.max(1, Math.round((attacker.attack || 0) * 0.2)), 'physical', {
        source: attacker,
        logFn,
        session,
        fromEffect: 'equipment-cleaver',
      });
      if (dealt > 0) {
        logFn(`🗡️ ${EQUIPMENT_EFFECTS.GOBLIN_BUTCHER_CLEAVER} наносит ${dealt} дополнительного физического урона.`);
      }
    }

    if (
      hasEquipped(recipient, EQUIPMENT_EFFECTS.CHITIN_BEETLE_CARAPACE) &&
      !recipient._equipmentBattleFlags?.chitinBleedShield
    ) {
      recipient._equipmentBattleFlags = recipient._equipmentBattleFlags || {};
      recipient._equipmentBattleFlags.chitinBleedShield = true;
      addEffect(recipient, { id: 'shield', duration: 2, value: Math.max(1, Math.round((recipient.maxHp || 1) * 0.08)) }, logFn, recipient, { session });
    }
  }

  if (effect.id === STUN_EFFECT_ID && hasEquipped(attacker, EQUIPMENT_EFFECTS.GUILD_WATCH_SHIELD)) {
    addEffect(recipient, { id: MINOR_DEFENSE_PENALTY_ID, duration: 2 }, logFn, attacker, { session });
  }
}

function resetLastRankRingOnMiss(owner, target, deliberateAction) {
  if (!owner || !target || !deliberateAction || !hasEquipped(owner, EQUIPMENT_EFFECTS.LAST_RANK_RING)) return false;
  if (deliberateAction.lastRankRingProcessed) return false;
  deliberateAction.lastRankRingProcessed = true;

  const targetId = combatUnitId(target);
  if (!targetId) return false;
  owner._lastRankRingTargetId = targetId;
  owner._lastRankRingCount = 0;
  return true;
}

export function registerLastRankRingHit(owner, target, deliberateAction, session, logFn = () => {}) {
  if (!owner || !target || !deliberateAction || !hasEquipped(owner, EQUIPMENT_EFFECTS.LAST_RANK_RING)) return false;
  if (deliberateAction.lastRankRingProcessed) return false;
  deliberateAction.lastRankRingProcessed = true;

  const targetId = combatUnitId(target);
  if (!targetId) return false;
  if (owner._lastRankRingTargetId !== targetId) {
    owner._lastRankRingTargetId = targetId;
    owner._lastRankRingCount = 1;
    return false;
  }

  owner._lastRankRingCount = Math.max(0, Number(owner._lastRankRingCount) || 0) + 1;
  if (owner._lastRankRingCount < 2) return false;
  owner._lastRankRingCount = 0;
  const applied = addEffect(owner, { id: 'combat_rhythm' }, logFn, owner, { session });
  if (applied) {
    logFn?.(`♪ ${EQUIPMENT_EFFECTS.LAST_RANK_RING} даёт 1 заряд Боевого ритма.`);
  }
  return Boolean(applied);
}

function triggerEquipmentOnDirectDamage({
  attacker,
  target,
  dealt = 0,
  absorbed = 0,
  targetHpBeforeDamage = null,
  targetWasPoisoned = false,
  targetWasSlowed = false,
  session = null,
  logFn = () => {},
  ability = null,
  damageType = null,
  magicSchool = null,
  critical = false,
  schoolChanged = false,
  deliberateAction = null,
} = {}) {
  if (!attacker || !target) return;

  if (
    deliberateAction &&
    !ability?.isSecondaryDamage &&
    (dealt > 0 || absorbed > 0) &&
    deliberateAction.primaryTargetId === combatUnitId(target) &&
    !deliberateAction.burialWatchUniformProcessed &&
    attacker._burialWatchUniformReady &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.BURIAL_WATCH_UNIFORM)
  ) {
    deliberateAction.burialWatchUniformProcessed = true;
    attacker._burialWatchUniformReady = false;
    const actualHpDamage = Math.max(
      0,
      (Number(targetHpBeforeDamage) || 0) - Math.max(0, Number(target.hp) || 0)
    );
    if (actualHpDamage > 0) {
      const healed = applyHealing(attacker, Math.round(actualHpDamage * 0.2), {
        source: attacker,
        session,
        logFn,
        deliberateAction,
      });
      if (healed > 0) {
        logFn?.(`🧥 ${EQUIPMENT_EFFECTS.BURIAL_WATCH_UNIFORM} восстанавливает ${healed} HP.`);
      }
    }
  }

  if (
    deliberateAction &&
    !ability?.isSecondaryDamage &&
    (dealt > 0 || absorbed > 0) &&
    deliberateAction.primaryTargetId === combatUnitId(target) &&
    !deliberateAction.unhealedWoundsReleased &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.UNHEALED_WOUNDS_GLADIUS)
  ) {
    deliberateAction.unhealedWoundsReleased = true;
    const stored = Math.max(0, Math.round(Number(attacker._unhealedWoundsStored) || 0));
    if (stored > 0) {
      attacker._unhealedWoundsStored = 0;
      if (target.hp > 0) {
        const released = applyDamage(target, stored, 'magical', {
          source: attacker,
          session,
          logFn,
          magicSchool: MAGIC_SCHOOLS.DEATH,
          directAttack: false,
          fromEffect: 'unhealed_wounds_gladius',
          deliberateAction,
        });
        if (released > 0) {
          logFn?.(`🗡️ ${EQUIPMENT_EFFECTS.UNHEALED_WOUNDS_GLADIUS} высвобождает ${released} урона Смертью.`);
        }
      }
    }
  }
  const connected = Math.max(0, Number(dealt) || 0) + Math.max(0, Number(absorbed) || 0) > 0
    || target._lastBlockedHitAction === deliberateAction;

  const positiveDirectDamage = Math.max(0, Number(dealt) || 0) + Math.max(0, Number(absorbed) || 0) > 0;
  if (positiveDirectDamage && !ability?.passive) {
    wakeReverenceFromDirectHit(target, logFn);
  }
  if (connected && !ability?.isSecondaryDamage && !ability?.passive) {
    resolvePrideSwordConnectedHit(attacker, target, deliberateAction, session, logFn);
  }
  if (
    connected &&
    !ability?.isSecondaryDamage &&
    !ability?.passive &&
    deliberateAction?.primaryTargetId === combatUnitId(target)
  ) {
    registerLastRankRingHit(attacker, target, deliberateAction, session, logFn);
  }

  if (
    connected &&
    damageType === 'magical' &&
    !ability?.basic &&
    !ability?.passive &&
    !ability?.isSecondaryDamage &&
    deliberateAction &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.BURNED_MEMORY_STAFF)
  ) {
    const contribution = Math.max(0, Math.round((Number(dealt) || 0) + (Number(absorbed) || 0)));
    if (contribution > 0) {
      attacker._burnedMemoryCurrentTurnDamage =
        Math.max(0, Number(attacker._burnedMemoryCurrentTurnDamage) || 0) + contribution;
    }
  }

  if (
    connected &&
    target.hp > 0 &&
    !ability?.isSecondaryDamage &&
    !ability?.passive &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.ERASED_NAME_AMULET) &&
    (attacker._erasedNameCooldown || 0) <= 0
  ) {
    const buff = deterministicTimedEffects(
      (target.effects || []).filter(effect => {
        const def = getEffectDefinition(effect?.id);
        return (effect?.type || def?.type) === 'buff' && isFiniteTimedEffect(effect);
      }),
      'desc'
    )[0] || null;
    if (buff && canUseEquipmentTurnFlag(attacker, 'erasedNameAmulet')) {
      const label = buff.name || getEffectDefinition(buff.id)?.name || buff.id;
      if (shortenTimedEffect(target, buff, 1, logFn)) {
        attacker._erasedNameCooldown = 2;
        logFn?.(`📿 ${EQUIPMENT_EFFECTS.ERASED_NAME_AMULET} сокращает длительность «${label}».`);
      }
    }
  }

  if (
    positiveDirectDamage &&
    target.hp > 0 &&
    damageType === 'magical' &&
    !ability?.basic &&
    !ability?.passive &&
    !ability?.isSecondaryDamage &&
    deliberateAction &&
    deliberateAction.primaryTargetId === combatUnitId(target) &&
    attacker._blackVeinLanternEnabled === true &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.BLACK_VEIN_LANTERN) &&
    Math.max(0, Number(attacker.shield) || 0) > 0 &&
    canUseEquipmentTurnFlag(attacker, 'blackVeinLantern')
  ) {
    const shieldBefore = Math.max(0, Number(attacker.shield) || 0);
    const spent = spendShieldWithoutBreak(attacker, Math.max(1, Math.round(shieldBefore * 0.5)));
    if (spent > 0) {
      const bonusDamage = Math.max(1, Math.round(spent * 1.5));
      const dealtByLantern = applyDamage(target, bonusDamage, 'magical', {
        source: attacker,
        session,
        logFn,
        magicSchool: MAGIC_SCHOOLS.LIGHT,
        directAttack: false,
        fromEffect: 'black_vein_lantern',
        sourceEffectId: 'black_vein_lantern',
        deliberateAction,
      });
      logFn?.(`🏮 ${EQUIPMENT_EFFECTS.BLACK_VEIN_LANTERN} расходует ${spent} Щита и наносит ${dealtByLantern} урона Светом.`);
    }
  }

  if (
    connected &&
    target.hp > 0 &&
    !ability?.basic &&
    !ability?.passive &&
    !ability?.isSecondaryDamage &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.SCORCHED_VEIN_SCEPTER) &&
    canUseEquipmentTurnFlag(attacker, 'scorchedVeinScepter')
  ) {
    const ownerId = combatUnitId(attacker);
    const ownBrand = (target.effects || []).find(effect =>
      effect?.id === 'searing_mark' &&
      (effect.sourceRef === attacker || effect.sourceId === ownerId || effect.sourceSnapshot?.entity === attacker)
    );
    if (!ownBrand) {
      addEffect(target, { id: 'searing_mark' }, logFn, attacker, {
        session,
        forceIndependentInstance: true,
      });
      logFn?.(`🔥 ${EQUIPMENT_EFFECTS.SCORCHED_VEIN_SCEPTER} накладывает собственное Испепеляющее клеймо.`);
    } else {
      const remainingTurns = Math.max(0, Number(ownBrand.remainingTurns ?? ownBrand.duration) || 0);
      const remainingDamage = calculateSearingMarkTickDamage(target, ownBrand) * remainingTurns;
      cleanseEffects(target, effect => effect === ownBrand, logFn);
      if (remainingDamage > 0 && target.hp > 0) {
        const exploded = applyDamage(target, remainingDamage, 'magical', {
          source: attacker,
          session,
          logFn,
          magicSchool: MAGIC_SCHOOLS.DARKNESS,
          directAttack: false,
          fromEffect: 'scorched_vein_scepter',
          sourceEffectId: 'searing_mark',
          bypassShield: true,
        });
        logFn?.(`🌑 ${EQUIPMENT_EFFECTS.SCORCHED_VEIN_SCEPTER} взрывает Клеймо на ${exploded} урона Тьмой.`);
      }
    }
  }

  if (connected && !ability?.isSecondaryDamage && !ability?.passive) {
    triggerDebtorsBlade(attacker, target, deliberateAction, logFn);
    triggerUnfinishedOrderCirclet(attacker, target, deliberateAction, session, logFn);
    registerSightingBowDamage(attacker, target, ability, deliberateAction, damageType, dealt, absorbed);
    if (target.hp > 0) {
      triggerViscousVeinBow({ attacker, target, deliberateAction, targetWasPoisoned, session, logFn });
      triggerStilledSapFocus({ attacker, target, deliberateAction, targetWasSlowed, session, logFn });
      triggerClingingIvyRing({ attacker, target, deliberateAction, targetWasPoisoned, session, logFn });
      triggerForestSentinelMaskHit(attacker, target, deliberateAction, session, logFn);
      triggerLastBloomBow(attacker, target, deliberateAction, session, logFn);
      triggerStolenTideVessel({ attacker, target, deliberateAction, targetWasSlowed, damageType, session, logFn });
      triggerLivingScarsRing({ attacker, target, deliberateAction, targetWasPoisoned, session, logFn });
    }
  }
  if (connected && Number(targetHpBeforeDamage) > 0 && target.hp <= 0) {
    triggerPursuerBootsKill(attacker, target, deliberateAction, session, logFn);
  }
  if (dealt <= 0) return;
  const canTriggerMushroomWeapon = !ability?.isSecondaryDamage && !ability?.passive;

  if (canTriggerMushroomWeapon && hasEquipped(attacker, EQUIPMENT_EFFECTS.FATHER_OF_BONFIRES_CENSER)) {
    const combatEnemies = session?.state?.enemies || [];
    const hasActiveFlame = combatEnemies.some(enemy => (enemy?.effects || []).some(effect =>
      effect?.id === 'great_bonfire_flame' &&
      (effect.sourceRef === attacker || effect.extra?.sourceOwnerId === (attacker.id || attacker.name))
    ));
    if (!hasActiveFlame) {
      const livingRecipients = combatEnemies.filter(enemy => enemy && enemy.hp > 0);
      const rng = typeof session?.rng === 'function' ? session.rng : Math.random;
      const recipient = target.hp > 0
        ? target
        : livingRecipients[Math.floor(rng() * livingRecipients.length)];
      if (recipient) {
        addEffect(recipient, {
          id: 'great_bonfire_flame',
          extra: {
            burnTicks: 0,
            lastKnownMagAtk: attacker.magAtk ?? 0,
            sourceOwnerId: attacker.id || attacker.name,
          },
        }, logFn, attacker, { session });
      }
    }
  }

  if (
    canTriggerMushroomWeapon &&
    target.effects?.some(effect => effect?.id === BLEED_EFFECT_ID) &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.RAT_VEIN_AMULET) &&
    canUseEquipmentTurnFlag(attacker, 'ratVeinTempo')
  ) {
    attacker.turnMeter = Math.min(TURN_METER_THRESHOLD, Math.max(0, attacker.turnMeter ?? 0) + TURN_METER_THRESHOLD * 0.1);
    logFn(`🩸 ${EQUIPMENT_EFFECTS.RAT_VEIN_AMULET} заполняет шкалу хода.`);
  }

  if (canTriggerMushroomWeapon && deliberateAction && hasEquipped(attacker, EQUIPMENT_EFFECTS.OATHBREAKER)) {
    applyOathbreakerAction(attacker, target, deliberateAction, logFn);
  }

  if (canTriggerMushroomWeapon && target.hp > 0 && hasEquipped(attacker, EQUIPMENT_EFFECTS.SPORE_GUARD_HAMMER) && combatRng(session)() < 0.4) {
    const removed = removeRandomPositiveEffect(target, combatRng(session), logFn);
    if (removed) {
      logFn(`🔨 ${EQUIPMENT_EFFECTS.SPORE_GUARD_HAMMER} снимает с ${target.name || 'цели'} эффект «${removed.name || removed.id}».`);
    }
  }

  if (canTriggerMushroomWeapon && target.hp > 0 && hasEquipped(attacker, EQUIPMENT_EFFECTS.SPOREBEARER_BOW) && combatRng(session)() < 0.25) {
    addEffect(target, { id: POISON_EFFECT_ID }, logFn, attacker, { session });
  }

  if (
    damageType === 'magical' &&
    magicSchool &&
    schoolChanged &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.FIRST_SPARK_STAFF) &&
    canUseEquipmentTurnFlag(attacker, 'firstSparkStaffDamage')
  ) {
    const extra = applyDamage(target, Math.max(1, Math.round((attacker.magAtk || 0) * 0.15)), 'magical', {
      source: attacker,
      logFn,
      session,
      magicSchool,
      fromEffect: 'equipment-first-spark',
      sourceEffectId: 'equipment-first-spark',
      skipFlameRuneTrigger: true,
    });
    if (extra > 0) {
      logFn(`⚡ ${EQUIPMENT_EFFECTS.FIRST_SPARK_STAFF} добавляет ${extra} магического урона.`);
    }
  }

  if (
    damageType === 'magical' &&
    critical &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.WARM_GLASS_WAND) &&
    canUseEquipmentTurnFlag(attacker, 'warmGlassWandPenalty')
  ) {
    addEffect(target, { id: MINOR_MAGIC_DEFENSE_PENALTY_ID, duration: 1 }, logFn, attacker, { session });
  }

  if (hasEquipped(attacker, EQUIPMENT_EFFECTS.OLD_CENTURION_MACE) && (attacker.shield ?? 0) > 0) {
    const extra = applyDamage(target, Math.max(1, Math.round((attacker.attack || 0) * 0.2)), 'physical', {
      source: attacker,
      logFn,
      session,
      fromEffect: 'equipment-mace',
    });
    if (extra > 0) {
      logFn(`🔨 ${EQUIPMENT_EFFECTS.OLD_CENTURION_MACE} добавляет ${extra} физического урона.`);
    }
  }

  if (hasEquipped(attacker, EQUIPMENT_EFFECTS.ABYSS_VETERAN_AMULET) && countDebuffs(target) >= 2) {
    const extra = applyDamage(target, Math.max(1, Math.round((attacker.attack || 0) * 0.2)), 'physical', {
      source: attacker,
      logFn,
      session,
      fromEffect: 'equipment-amulet',
    });
    if (extra > 0) {
      logFn(`📿 ${EQUIPMENT_EFFECTS.ABYSS_VETERAN_AMULET} добавляет ${extra} физического урона.`);
    }
  }

  if (
    hasEquipped(attacker, EQUIPMENT_EFFECTS.BORDER_WATCH_HALBERD) &&
    hasAnyDebuff(target) &&
    canUseEquipmentTurnFlag(attacker, 'halberdShield')
  ) {
    addEffect(attacker, { id: 'shield', duration: 2, value: Math.max(1, Math.round((attacker.maxHp || 1) * 0.1)) }, logFn, attacker, { session });
  }
}

function triggerEquipmentAfterMagicalAbility(attacker, ability, target, session, logFn = () => {}) {
  if (!attacker || !ability) return;
  const isMagicalAbility =
    resolveDamageType(ability, attacker, target || attacker) === 'magical' ||
    ability.type === 'magical' ||
    Boolean(ability.school);
  const magicSchool = isMagicalAbility
    ? resolveMagicSchool(ability, attacker, target || attacker, resolveDamageType(ability, attacker, target || attacker))
    : null;
  const directDamageValue = resolveDamageValue(ability, attacker, target || attacker, session);
  if (isMagicalAbility && magicSchool && directDamageValue <= 0) {
    const schoolState = noteMagicSchoolUse(attacker, magicSchool, logFn);
    if (
      schoolState.changed &&
      hasEquipped(attacker, EQUIPMENT_EFFECTS.SHIFTING_SPARK_RING) &&
      canUseEquipmentTurnFlag(attacker, 'shiftingSparkRingHeal')
    ) {
      healFromEquipment(attacker, 2, logFn, EQUIPMENT_EFFECTS.SHIFTING_SPARK_RING);
    }
  }
  if (
    isMagicalAbility &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.QUIET_CHANNEL_MANTLE) &&
    canUseEquipmentTurnFlag(attacker, 'quietChannelMantleShield')
  ) {
    addEffect(attacker, { id: 'shield', duration: 2, value: 6 + Math.max(0, Math.round((attacker.magAtk || 0) * 0.1)) }, logFn, attacker, { session });
  }
}

function triggerEquipmentOnDamageTaken(target, damage, options = {}) {
  const {
    shieldBefore = 0,
    logFn = () => {},
    source = null,
    session = null,
    fromEffect = null,
    directAttack = false,
    actualHpLost = null,
  } = options;
  if (!target || damage <= 0) return;
  if (
    directAttack &&
    !fromEffect &&
    hasEquipped(target, EQUIPMENT_EFFECTS.UNHEALED_WOUNDS_GLADIUS)
  ) {
    const cap = Math.max(0, Math.round(target.attack || 0));
    const stored = Math.max(0, Number(target._unhealedWoundsStored) || 0);
    const hpLost = Math.max(0, Number(actualHpLost) || 0);
    target._unhealedWoundsStored = Math.min(cap, stored + Math.max(0, Math.round(hpLost * 0.3)));
  }
  if (fromEffect === 'bleed' && hasEquipped(target, EQUIPMENT_EFFECTS.RAT_WRAPS) && canUseEquipmentTurnFlag(target, 'ratWrapsBleedTempo')) target.turnMeter = Math.min(TURN_METER_THRESHOLD, (target.turnMeter || 0) + 80);
  if (
    shieldBefore > 0 &&
    hasEquipped(target, EQUIPMENT_EFFECTS.WEAK_BARRIER_CLOAK) &&
    canUseEquipmentTurnFlag(target, 'weakBarrierCloakHeal')
  ) {
    healFromEquipment(target, 4, logFn, EQUIPMENT_EFFECTS.WEAK_BARRIER_CLOAK);
  }
  if (source && hasEquipped(target, EQUIPMENT_EFFECTS.RED_BONFIRE_CLOAK) && canUseEquipmentTurnFlag(target, `redBonfire-${source.id || source.name}`)) {
    addEffect(source, { id: EFFECT_IDS.burn, duration: 1 }, logFn, target, { session });
  }
  if (source && hasEquipped(target, EQUIPMENT_EFFECTS.SHIMMERING_SHELL) && canUseEquipmentTurnFlag(target, `shimmer-${source.id || source.name}`) && combatRng(session)() < 0.25) {
    addEffect(source, { id: EFFECT_IDS.blind || 'blind', duration: 1 }, logFn, target, { session });
  }
}

function triggerEquipmentOnConsumableUsed(player, session, logFn = () => {}) {
  if (hasEquipped(player, EQUIPMENT_EFFECTS.SPOREWORKER_MASK) && combatRng(session)() < 0.2) {
    addEffect(player, { id: MINOR_DEFENSE_BLESSING_ID, duration: 1 }, logFn, player, { session });
  }

  if (
    hasEquipped(player, EQUIPMENT_EFFECTS.SURVIVING_MINER_JACKET) &&
    canUseEquipmentTurnFlag(player, 'survivingMinerJacket')
  ) {
    const debuff = deterministicTimedEffects(
      (player.effects || []).filter(effect => {
        const def = getEffectDefinition(effect?.id);
        return (effect?.type || def?.type) === 'debuff' && isFiniteTimedEffect(effect);
      }),
      'desc'
    )[0] || null;
    if (debuff && shortenTimedEffect(player, debuff, 1, logFn)) {
      logFn?.(`🧥 ${EQUIPMENT_EFFECTS.SURVIVING_MINER_JACKET} сокращает длительность «${debuff.name || getEffectDefinition(debuff.id)?.name || debuff.id}».`);
    }
  }

  const battleFlags = ensureEquipmentBattleFlags(player);
  if (
    hasEquipped(player, EQUIPMENT_EFFECTS.DEEP_WATCH_CUIRASS) &&
    !battleFlags.deepWatchCuirassUsed
  ) {
    battleFlags.deepWatchCuirassUsed = true;
    const value = Math.max(1, Math.round((player.maxHp || 0) * 0.1));
    addEffect(player, { id: 'shield', duration: 2, value }, logFn, player, {
      session,
      forceIndependentInstance: true,
    });
    logFn?.(`🛡️ ${EQUIPMENT_EFFECTS.DEEP_WATCH_CUIRASS} даёт ${value} Щита.`);
  }

  if (
    hasEquipped(player, EQUIPMENT_EFFECTS.DEEP_WATCH_BOOTS) &&
    canUseEquipmentTurnFlag(player, 'deepWatchBootsTempo')
  ) {
    grantEquipmentTurnMeter(player, 120, session, {
      source: EQUIPMENT_EFFECTS.DEEP_WATCH_BOOTS,
      trigger: 'consumable',
    });
    logFn?.(`🥾 ${EQUIPMENT_EFFECTS.DEEP_WATCH_BOOTS} заполняют ШХ на 12%.`);
  }

  const setRuntime = getEquipmentSetRuntimeBonuses(player?.equipment);
  if (setRuntime.deepWatchFullSet && !battleFlags.deepWatchFullSetUsed) {
    battleFlags.deepWatchFullSetUsed = true;
    addEffect(player, { id: 'attack_boost_minor', duration: 2 }, logFn, player, { session });
    addEffect(player, { id: 'magic_attack_boost_minor', duration: 2 }, logFn, player, { session });
    logFn?.('🟢 Глубинный дозор: первый расходник даёт Натиск и Магическую мощь на 2 хода.');
  }
}

function shouldPreserveConsumableFromEquipmentSet(player, session) {
  const preserveChance = getEquipmentSetRuntimeBonuses(player?.equipment).consumablePreserveChance ?? 0;
  return preserveChance > 0 && combatRng(session)() < preserveChance;
}

// === Формула защиты ===
export const calcMitigation = (def = 0) => def / (def + 100);

export function calculateVisibleDamage(raw, type = 'physical', target = {}, options = {}) {
  const effectiveType = type === 'true' ? 'pure' : type;
  if ((effectiveType === 'physical' && target.physImmune) || (effectiveType === 'magical' && target.magicImmune)) return 0;
  const fromOptions = Math.max(0, Math.min(1, options.ignoreDefenseFraction || 0));
  const fromTarget = effectiveType === 'magical'
    ? Math.max(0, Math.min(1, target.incomingMagicDefenseIgnore || 0))
    : effectiveType === 'physical' ? Math.max(0, Math.min(1, target.incomingPhysDefenseIgnore || 0)) : 0;
  const defenseIgnore = 1 - (1 - fromOptions) * (1 - fromTarget);
  let defense = effectiveType === 'magical' ? target.magicDef || 0 : effectiveType === 'pure' ? 0 : target.physDef || 0;
  if (defenseIgnore && effectiveType !== 'pure') defense = Math.max(0, defense * (1 - defenseIgnore));
  let damage = Math.max(0, Math.round(Number(raw || 0) * Math.max(0, options.directDamageMultiplier ?? 1) * (1 - (effectiveType === 'pure' ? 0 : calcMitigation(defense)))));
  damage = Math.max(0, Math.round(damage * (target.statMultipliers?.damageTaken ?? 1)));
  const typeMultiplier = target.damageTypeMultipliers?.[effectiveType];
  if (Number.isFinite(typeMultiplier)) damage = Math.max(0, Math.round(damage * typeMultiplier));
  if (target.immortal && effectiveType !== 'pure') damage = Math.min(damage, Math.max(0, (target.hp || 0) - 1));
  return damage;
}

export function getVisibleHitChance(attacker = {}, target = {}, ability = {}) {
  if (ability.alwaysHits) return 1;
  const targetHasEvasion = (target.effects || []).some(effect => effect?.id === 'evasion');
  const attackerIsBlind = (attacker.effects || []).some(effect => effect?.id === 'blind');
  const dodge = Math.max(target.statAdditives?.dodgeBonus ?? 0, targetHasEvasion ? 0.3 : 0);
  const bonus = attacker.statAdditives?.accuracyBonus ?? 0;
  const penalty = Math.max(attacker.statAdditives?.accuracyPenalty ?? 0, attackerIsBlind ? 0.3 : 0);
  return Math.max(0.05, Math.min(1, (ability.accuracy ?? 1) + bonus - penalty - dodge));
}

function log(state, text) {
  state.log.push(text);
  if (state.log.length > 120) state.log.shift();
}

function determineEncounterLocation(playerData, enemiesData = []) {
  if (playerData?.currentLocation) {
    return playerData.currentLocation;
  }
  if (Array.isArray(enemiesData)) {
    const withLocation = enemiesData.find(enemy => enemy?.location);
    if (withLocation?.location) {
      return withLocation.location;
    }
  }
  return null;
}

function applyLocationEffect(session, locationName) {
  if (!session?.state || !locationName) return;
  const effectDef = LOCATION_EFFECTS[locationName];
  if (!effectDef) return;

  const { state } = session;
  state.locationName = locationName;
  session.location = locationName;
  session.locationEffectId = effectDef.id ?? null;

  const logger = text => log(state, text);

  if (effectDef.name) {
    logger(`🌍 ${effectDef.name}`);
  }
  if (effectDef.description) {
    logger(effectDef.description);
  }

  if (typeof effectDef.applyAtBattleStart === "function") {
    try {
      effectDef.applyAtBattleStart({
        session,
        location: locationName,
        log: logger,
        random: combatRng(session),
      });
    } catch (err) {
      console.warn("Ошибка применения эффекта локации", locationName, err);
      logger("⚠️ Энергии локации ведут себя непредсказуемо.");
    }
  }
}

const grantSublocationEnemyTempo = (session, amount, logFn = () => {}, reason = '') => {
  if (!session?.state) return 0;
  let totalGained = 0;
  (session.state.enemies || []).forEach(enemy => {
    if (!enemy || enemy.hp <= 0 || enemy.nonActingCombatObject) return;
    const before = Math.max(0, Number(enemy.turnMeter) || 0);
    enemy.turnMeter = Math.min(TURN_METER_THRESHOLD, before + amount);
    totalGained += Math.max(0, enemy.turnMeter - before);
  });
  if (totalGained > 0 && reason) logFn(`☠ ${reason}`);
  return totalGained;
};

const applySublocationBattleStartEffect = (session, effectId) => {
  if (!session?.state || !effectId) return;
  const logger = text => log(session.state, text);
  const hero = session.state.players?.[0];
  const livingEnemies = () => (session.state.enemies || [])
    .filter(enemy => enemy?.hp > 0 && !enemy.nonActingCombatObject);

  session.sublocationEffectId = effectId;
  session.state.sublocationEffectId = effectId;

  if (effectId === 'rat-riders') {
    livingEnemies().forEach(enemy => {
      // If a caller already decorated its blueprint, ensureInitiativeState
      // will apply startingTurnMeterBonus once; do not double the opening bonus.
      if (enemy.expeditionSublocationStartingMeterBonus) return;
      const bonus = isRatRelatedEnemy(enemy) ? RAT_RIDERS_START_METER.rat : RAT_RIDERS_START_METER.other;
      enemy.turnMeter = Math.min(TURN_METER_THRESHOLD, Math.max(0, Number(enemy.turnMeter) || 0) + bonus);
      enemy.expeditionSublocationStartingMeterBonus = bonus;
    });
    logger('🐀 Кавалерийский наскок: враги начинают с 15% шкалы хода, крысиные — с 30%.');
    return;
  }

  if (effectId === 'rat-matriarchs' && hero) {
    const existing = (hero.effects || []).find(effect => effect?.id === 'bleed');
    if (existing) {
      existing.duration = Math.max(2, Number(existing.duration) || 0);
      existing.remainingTurns = Math.max(2, Number(existing.remainingTurns) || 0);
    } else {
      addEffect(hero, {
        id: 'bleed',
        duration: 2,
        sourceName: 'Материнское логово',
        sourceAttack: 5,
      }, logger, livingEnemies()[0] || hero, { session });
    }
    session.state._plagueRatSummons = 0;
    session.state._plagueRatNextEligibleTurn = 2;
    logger('🐀 Материнское логово гарантирует [Кровотечение] на 2 хода.');
    return;
  }

  if (effectId === 'pyromancers' && hero) {
    const source = livingEnemies()
      .sort((a, b) => (Number(b.magAtk) || 0) - (Number(a.magAtk) || 0))[0] || hero;
    for (let index = 0; index < 3; index += 1) {
      addEffect(hero, { id: 'charring', duration: 3, sourceName: 'Пламенные коридоры' }, logger, source, { session });
    }
    if (combatRng(session)() < 0.65) {
      session.state._pyromancerBurnTriggerTurn = 2 + Math.floor(combatRng(session)() * 5);
    }
    logger('🔥 Пламенные коридоры накладывают 3 [Обугливания].');
    return;
  }

  if (effectId === 'cursed-rubble') {
    logger('☠ Проклятые завалы ускоряют врагов, когда герой истекает кровью или теряет Щит.');
    return;
  }

  if (effectId === MINES_SUBLOCATION_EFFECTS.SURVEYOR) {
    const count = applyMinesBlackMarkings(session, logger);
    logger('⛏ Чёрная разметка: ' + count + ' шахтёра получают усиления.');
  }
};

const processSublocationTurnEvent = (session, actor, logFn = () => {}) => {
  const state = session?.state;
  if (!state) return;
  const totalTurns = Math.max(0, Number(state._completedCombatTurns) || 0);

  if (
    session.sublocationEffectId === 'rat-matriarchs'
    && (state.enemies || []).includes(actor)
    && actor?.hp > 0
    && (state._plagueRatSummons || 0) < 2
    && totalTurns >= (state._plagueRatNextEligibleTurn || 0)
    && combatRng(session)() < 0.25
  ) {
    const summoned = session.summonEnemy?.('Чумная крыса', { source: actor });
    if (summoned?.success) {
      state._plagueRatSummons = (state._plagueRatSummons || 0) + 1;
      state._plagueRatNextEligibleTurn = totalTurns + 2;
      logFn(`🐀 Из норы вырывается Чумная крыса (${state._plagueRatSummons}/2).`);
    }
  }

  if (
    session.sublocationEffectId === 'pyromancers'
    && !state._pyromancerBurnTriggered
    && state._pyromancerBurnTriggerTurn
    && totalTurns >= state._pyromancerBurnTriggerTurn
  ) {
    const hero = state.players?.[0];
    if (hero?.hp > 0) {
      const source = (state.enemies || [])
        .filter(enemy => enemy?.hp > 0 && !enemy.nonActingCombatObject)
        .sort((a, b) => (Number(b.magAtk) || 0) - (Number(a.magAtk) || 0))[0] || hero;
      addEffect(hero, { id: 'burn', duration: 2, sourceName: 'Пламенные коридоры' }, logFn, source, { session });
      state._pyromancerBurnTriggered = true;
      logFn('🔥 Пламенные коридоры вызывают [Поджог].');
    }
  }
};

const notifySublocationBleedTick = (session, target, logFn = () => {}) => {
  if (
    session?.sublocationEffectId === 'cursed-rubble'
    && session?.state?.players?.[0] === target
  ) {
    grantSublocationEnemyTempo(session, 50, logFn, '[Кровотечение] заполняет врагам 5% шкалы хода.');
  }
};

const notifySublocationShieldBroken = (session, target, logFn = () => {}) => {
  if (
    session?.sublocationEffectId === 'cursed-rubble'
    && session?.state?.players?.[0] === target
  ) {
    grantSublocationEnemyTempo(session, 100, logFn, 'Разрушение Щита заполняет врагам 10% шкалы хода.');
  }
};

// === Нанесение урона ===
function applyDefenderSpikedShield(target, options = {}) {
  const {
    source = null,
    shieldBefore = 0,
    directAttack = false,
    fromEffect = null,
    logFn = null,
    session = null,
  } = options;
  if (!directAttack || fromEffect || shieldBefore <= 0) return;
  if (!target || target.class !== 'Defender') return;
  if (!source || source === target || source.hp <= 0) return;
  const applied = addEffect(
    source,
    { id: EFFECT_IDS['Кровотечение'] || 'bleed', duration: 1 },
    logFn,
    target,
    { session }
  );
  if (
    applied?.id === BLEED_EFFECT_ID &&
    hasEquipped(target, EQUIPMENT_EFFECTS.BURROW_SPIKED_SHIELD) &&
    canUseEquipmentTurnFlag(target, 'burrowSpikedShield')
  ) {
    addEffect(target, { id: 'shield', duration: 2, value: Math.max(1, Math.round((target.maxHp || 1) * 0.08)) }, logFn, target, { session });
  }
}

function applySmolderingVeinShieldRetaliation(target, attacker, deliberateAction, shieldBefore, session, logFn = () => {}) {
  if (
    !target || !attacker || attacker === target || attacker.hp <= 0 ||
    !deliberateAction || shieldBefore <= 0 ||
    !hasEquipped(target, EQUIPMENT_EFFECTS.SMOLDERING_VEIN_SHIELD)
  ) return false;

  const targetId = combatUnitId(target) || target.name;
  deliberateAction._smolderingVeinTargets ||= [];
  if (deliberateAction._smolderingVeinTargets.includes(targetId)) return false;

  deliberateAction._smolderingVeinTargets.push(targetId);
  const triggers = Math.max(0, Number(target._smolderingVeinShieldTriggers) || 0);
  if (triggers >= 3) return false;
  target._smolderingVeinShieldTriggers = triggers + 1;

  recordCombatPresentationEvent(session, {
    type: "procTriggered",
    actor: target,
    target,
    procKind: "equipment",
    procId: "smoldering_vein_shield",
    label: EQUIPMENT_EFFECTS.SMOLDERING_VEIN_SHIELD,
    afterEventType: target.shield <= 0 ? "shieldBreak" : "shieldImpact",
    afterTargetId: targetId,
    afterEventDirection: "preceding",
  });
  const applied = addEffect(
    attacker,
    { id: EFFECT_IDS['Горение'] || 'burn', duration: 1 },
    logFn,
    target,
    {
      session,
      presentationCause: {
        type: "procTriggered",
        target,
        direction: "preceding",
        label: EQUIPMENT_EFFECTS.SMOLDERING_VEIN_SHIELD,
      },
    }
  );
  if (applied) {
    logFn?.(`🔥 ${EQUIPMENT_EFFECTS.SMOLDERING_VEIN_SHIELD} обжигает ${attacker.name || 'атакующего'}.`);
  }
  return Boolean(applied);
}

function applySerpentCarapaceRetaliation(target, options = {}) {
  const {
    source = null,
    shieldBefore = 0,
    directAttack = false,
    fromEffect = null,
    logFn = null,
    session = null,
  } = options;
  if (!target || !source || source === target || source.hp <= 0) return;
  if (!directAttack || fromEffect || shieldBefore <= 0) return;
  if (!hasEquipped(target, EQUIPMENT_EFFECTS.DEMIGOD_SERPENT_CARAPACE)) return;
  addEffect(source, { id: POISON_EFFECT_ID }, logFn, target, { session });
}

export function applyHealing(target, amount, options = {}) {
  if (!target || amount <= 0) return 0;
  const {
    source = null,
    logFn = null,
    session = null,
    skipBloodBond = false,
    deliberateAction = null,
    presentationCause = null,
  } = options;
  let resolvedAmount = Math.max(0, Number(amount) || 0);
  if (session?.state?.players?.[0] === target && getUndeathTier(target) >= 5) {
    resolvedAmount *= 1 - getUndeathLowHpPenalty(target);
  }
  const bitterDewOwner = (session?.state?.players || []).find(unit =>
    unit?.hp > 0 && hasEquipped(unit, EQUIPMENT_EFFECTS.BITTER_DEW_AMULET)
  );
  if (
    bitterDewOwner &&
    (session?.state?.enemies || []).includes(target) &&
    (target.effects || []).some(effect => effect?.id === POISON_EFFECT_ID)
  ) {
    resolvedAmount *= 0.7;
  }
  if (target.healingInverted) {
    return applyDamage(target, Math.round(resolvedAmount), "pure", { source, logFn, session });
  }

  const prev = target.hp ?? 0;
  const max = target.maxHp ?? prev;
  target.hp = Math.min(max, prev + Math.round(resolvedAmount));
  if (getUndeathTier(target) >= 5) syncUndeathLowHpPenalty(target);
  const restored = target.hp - prev;
  const overheal = Math.max(0, Math.round(resolvedAmount) - restored);
  if (restored > 0) {
    recordCombatPresentationEvent(session, {
      type: "heal",
      actor: source,
      target,
      amount: restored,
      afterEventType: presentationCause?.type,
      afterTargetId: presentationCause?.target
        ? (combatUnitId(presentationCause.target) || presentationCause.target.name)
        : presentationCause?.targetId,
      afterEventDirection: presentationCause?.direction,
      afterDelay: presentationCause?.delay,
    });

    if (
      hasEquipped(target, EQUIPMENT_EFFECTS.INSATIABLE_VEIN_RING) &&
      canUseEquipmentTurnFlag(target, 'insatiableVeinRing')
    ) {
      const enemies = (session?.state?.enemies || []).filter(unit => unit?.hp > 0);
      if (enemies.length > 0) {
        const rng = combatRng(session);
        const selected = enemies[Math.min(enemies.length - 1, Math.floor(rng() * enemies.length))];
        const amount = Math.max(1, Math.round(restored * 0.35));
        const dealt = applyDamage(selected, amount, 'magical', {
          source: null,
          session,
          logFn,
          magicSchool: MAGIC_SCHOOLS.LIGHT,
          directAttack: false,
          fromEffect: 'insatiable_vein_ring',
          sourceEffectId: 'insatiable_vein_ring',
          suppressDamageReactions: true,
        });
        if (dealt > 0) {
          logFn?.(`💍 ${EQUIPMENT_EFFECTS.INSATIABLE_VEIN_RING} поражает ${selected.name || 'врага'} Светом на ${dealt}.`);
        }
      }
    }

    // Transfer only actual recovery by a living Gnat to its own living Sower.
    // Never recurse or turn overheal / inverted healing into extra HP.
    const owner = !skipBloodBond && prev > 0 ? findLivingBloodBondOwner(session, target) : null;
    if (owner) {
      const linkedHeal = applyHealing(owner, Math.round(restored * BLOOD_BOND_RATIO), {
        source: target, logFn, session, skipBloodBond: true,
      });
      if (linkedHeal > 0 && typeof logFn === 'function') {
        logFn(`🩸 Кровавая связь восстанавливает ${linkedHeal} HP ${owner.name}.`);
      }
    }
  }
  if (overheal > 0 && source && !target.passivesDisabled) {
    const passive = (target.abilities || []).find(ability => ability?.passive && ability.wildOvergrowth);
    const actionToken = deliberateAction || options.originatingAction || null;
    if (passive && actionToken && target._wildOvergrowthAction !== actionToken) {
      target._wildOvergrowthAction = actionToken;
      const hero = (session?.state?.players || []).find(unit => unit?.hp > 0);
      if (hero) {
        addEffect(hero, { id: 'entanglement', stacks: 1 }, logFn, target, { session });
        logFn?.(`🌿 Буйное разрастание накладывает Опутывание на ${hero.name}.`);
      }
    }
  }
  return restored;
}

const getArchonCleanseBurden = (effect, metadata) => {
  if (!effect) return 0;
  if (metadata?.stacking === 'extend') {
    return Math.max(1, Number(effect.remainingTurns ?? effect.duration) || 1);
  }
  if (metadata?.stacking === 'stack') {
    return Math.max(1, Number(effect.stacks ?? effect.charges) || 1);
  }
  return 1;
};

const isArchonCleanseCandidate = effect => {
  const metadata = getEffectDefinition(effect?.id);
  return Boolean(
    effect &&
    metadata?.type === 'debuff' &&
    metadata?.unremovable !== true &&
    effect?.unremovable !== true &&
    metadata?.removable !== false &&
    effect?.removable !== false &&
    effect?.extra?.removable !== false
  );
};

function triggerBloomArchonPetalShedding(enemy, session = null, logFn = () => {}) {
  if (!enemy || enemy.hp <= 0) return null;
  const passive = (enemy.abilities || []).find(ability => (
    ability?.passive && Number(ability?.bloomArchonCleanseEveryTurns) > 0
  ));
  if (!passive || enemy.passivesDisabled) return null;

  const interval = Math.max(1, Math.floor(Number(passive.bloomArchonCleanseEveryTurns) || 0));
  enemy._bloomArchonCleanseTurnCounter = Math.max(0, Number(enemy._bloomArchonCleanseTurnCounter) || 0) + 1;
  if (enemy._bloomArchonCleanseTurnCounter < interval) return null;
  enemy._bloomArchonCleanseTurnCounter = 0;

  const families = new Map();
  (enemy.effects || []).forEach(effect => {
    if (!isArchonCleanseCandidate(effect)) return;
    const metadata = getEffectDefinition(effect.id);
    const entry = families.get(effect.id) || {
      id: effect.id,
      name: metadata?.name || effect.name || effect.id,
      burden: 0,
    };
    entry.burden += getArchonCleanseBurden(effect, metadata);
    families.set(effect.id, entry);
  });
  if (families.size === 0) return null;

  let selected = null;
  families.forEach(entry => {
    if (!selected || entry.burden > selected.burden) selected = entry;
  });
  if (!selected) return null;

  const removed = cleanseEffects(enemy, effect => (
    effect?.id === selected.id && isArchonCleanseCandidate(effect)
  ), logFn, { session, actor: enemy });
  if (removed > 0) {
    logFn(`🌺 Сброс лепестков: ${enemy.name} очищается от эффекта «${selected.name}» целиком.`);
    return { ...selected, removed };
  }
  return null;
}

export function transitionBloomArchonPhaseTwo(target, session = null, logFn = () => {}) {
  if (!target || target.name !== 'Архонт Цветения' || target.hp <= 0
      || target.hp > target.maxHp * 0.5 || Number(target._bloomArchonPhase || 1) >= 2) return false;
  const roots = (target.abilities || []).find(ability => ability?.name === 'Корни Архонта');
  const petalShedding = (target.abilities || []).find(ability => ability?.name === 'Сброс лепестков');
  const basic = (target.abilities || []).find(ability => ability?.basic || ability?.name === 'Атака');
  target._bloomArchonPhase = 2;
  target.abilities = [
    roots || createAbilityByName('Корни Архонта', target.attack),
    createAbilityByName('Смертельное цветение', target.attack),
    createAbilityByName('Погребение в корнях', target.attack),
    petalShedding || createAbilityByName('Сброс лепестков', target.attack),
    basic || createAbilityByName('Атака', target.attack),
  ];
  logFn?.('🌑 Цветы Архонта чернеют и осыпаются. Цветение сменяется увяданием.');
  return true;
}

function consumeShieldEffectBookkeeping(target, absorbedShield) {
  if (!target || absorbedShield <= 0 || !Array.isArray(target.effects)) return [];
  let remainingAbsorb = absorbedShield;
  const exhaustedSources = [];
  target.effects.forEach(effect => {
    if (remainingAbsorb <= 0 || effect?.id !== "shield") return;
    const appliedShield = Math.max(0, effect.appliedShield ?? effect.value ?? 0);
    const reduction = Math.min(appliedShield, remainingAbsorb);
    effect.appliedShield = Math.max(0, appliedShield - reduction);
    if (typeof effect.value === "number") {
      effect.value = Math.max(0, effect.value - reduction);
    }
    if (Array.isArray(effect.extra?.shieldSources)) {
      let sourceReduction = reduction;
      effect.extra.shieldSources.forEach(segment => {
        if (sourceReduction <= 0 || segment.remaining <= 0) return;
        const before = segment.remaining;
        const used = Math.min(segment.remaining, sourceReduction);
        segment.remaining -= used;
        sourceReduction -= used;
        if (before > 0 && segment.remaining === 0 && !segment.consumedWithoutBreak) {
          exhaustedSources.push(segment);
        }
      });
    }
    remainingAbsorb -= reduction;
  });
  return exhaustedSources;
}

function removeDepletedShieldEffects(target) {
  if (!Array.isArray(target?.effects)) return 0;
  const before = target.effects.length;
  target.effects = target.effects.filter(effect => (
    effect?.id !== 'shield' || Math.max(0, Number(effect.appliedShield ?? effect.value) || 0) > 0
  ));
  return before - target.effects.length;
}

function captureDirectShieldDurabilityReducers(target) {
  if (!target || !Array.isArray(target.effects)) return [];
  return target.effects
    .filter(effect => effect?.id === 'shield')
    .map(effect => ({
      effect,
      before: Math.max(0, Number(effect.appliedShield ?? effect.value) || 0),
      multiplier: Number(effect.extra?.directShieldDamageMultiplier),
    }))
    .filter(entry => entry.before > 0 && Number.isFinite(entry.multiplier) && entry.multiplier >= 0 && entry.multiplier < 1);
}

function restoreReducedDirectShieldDurability(target, snapshots, { directAttack = false, fromEffect = null } = {}) {
  if (!target || !directAttack || fromEffect || !Array.isArray(snapshots) || snapshots.length === 0) return 0;
  let restoredTotal = 0;
  snapshots.forEach(({ effect, before, multiplier }) => {
    if (!effect || !target.effects?.includes(effect)) return;
    const after = Math.max(0, Number(effect.appliedShield ?? effect.value) || 0);
    const spent = Math.max(0, before - after);
    if (spent <= 0) return;
    const reducedSpend = Math.max(0, Math.round(spent * multiplier));
    const restored = Math.max(0, spent - reducedSpend);
    if (restored <= 0) return;
    effect.appliedShield = after + restored;
    if (typeof effect.value === 'number') effect.value = Math.max(0, effect.value) + restored;
    target.shield = Math.max(0, Number(target.shield) || 0) + restored;
    restoredTotal += restored;
  });
  return restoredTotal;
}

function spendShieldWithoutBreak(target, amount) {
  if (!target) return 0;
  const before = Math.max(0, Number(target.shield) || 0);
  const spent = Math.min(before, Math.max(0, Math.round(Number(amount) || 0)));
  if (spent <= 0) return 0;

  target.shield = Math.max(0, before - spent);
  let remaining = spent;
  (target.effects || []).forEach(effect => {
    if (remaining <= 0 || effect?.id !== 'shield') return;
    const applied = Math.max(0, effect.appliedShield ?? effect.value ?? 0);
    const used = Math.min(applied, remaining);
    effect.appliedShield = Math.max(0, applied - used);
    if (typeof effect.value === 'number') effect.value = Math.max(0, effect.value - used);
    if (Array.isArray(effect.extra?.shieldSources)) {
      let sourceUse = used;
      effect.extra.shieldSources.forEach(segment => {
        if (sourceUse <= 0 || !segment || segment.remaining <= 0) return;
        const segmentUse = Math.min(segment.remaining, sourceUse);
        segment.remaining -= segmentUse;
        sourceUse -= segmentUse;
        if (segment.remaining === 0) segment.consumedWithoutBreak = true;
      });
    }
    remaining -= used;
  });
  removeDepletedShieldEffects(target);
  return spent;
}

function triggerExhaustedShieldSources(target, segments, source, session, logFn = () => {}) {
  if (!Array.isArray(segments) || segments.length === 0) return;
  const combatants = [...(session?.state?.players || []), ...(session?.state?.enemies || [])];
  const validSource = source?.hp > 0 && (combatants.length === 0 || combatants.includes(source)) ? source : null;
  let presentationProcRecorded = false;
  segments.forEach(segment => {
    const stacks = Number(segment?.breakEntanglement) || 0;
    if (segment.breakTriggered || stacks <= 0) return;
    // The segment has been destroyed by this damage event even when its owner
    // dies or other Shield segments remain. Mark it consumed exactly once;
    // an unknown/stale damage source is intentionally never guessed.
    segment.breakTriggered = true;
    if (!validSource) return;
    if (!presentationProcRecorded) {
      presentationProcRecorded = true;
      recordCombatPresentationEvent(session, {
        type: "procTriggered",
        actor: target,
        target,
        procKind: "equipment",
        procId: "crystal_carapace",
        label: "Кристаллический панцирь",
        afterEventType: "shieldImpact",
        afterTargetId: combatUnitId(target) || target.name,
        afterEventDirection: "following",
      });
    }
    addEffect(validSource, { id: 'entanglement', stacks }, logFn, target, {
      session,
      presentationCause: {
        type: "procTriggered",
        target,
        direction: "preceding",
        label: "Кристаллический панцирь",
      },
    });
    logFn?.(`💎 Разрушение Кристаллического панциря накладывает ${stacks} Опутывания на ${validSource.name}.`);
  });
}


function canUnitContinueAction(unit) {
  return Boolean(unit && unit.hp > 0 && !unit.stunned && !unit.frozen && !unit.pendingShockSkip && !unit.prostrated);
}

export function canUnitPerformReactiveAction(unit) {
  return Boolean(unit && unit.hp > 0 && !unit.stunned && !unit.frozen && !unit.asleep && !unit.prostrated);
}

function triggerFirstTraitorThreshold(target, hpBeforeDamage, session, logFn = () => {}) {
  const enemies = session?.state?.enemies || [];
  if (!target || !enemies.includes(target) || target._betrayalThresholdReached) return;
  const threshold = (target.maxHp || 0) * 0.5;
  if (!(hpBeforeDamage > threshold && target.hp <= threshold)) return;
  const cloakOwner = (session?.state?.players || []).find(unit =>
    unit?.hp > 0 && hasEquipped(unit, EQUIPMENT_EFFECTS.FIRST_TRAITOR_CLOAK)
  );
  if (!cloakOwner) return;
  target._betrayalThresholdReached = true;
  const hasLivingAlly = enemies.some(unit => unit && unit !== target && unit.hp > 0);
  if (target.hp > 0 && hasLivingAlly) {
    addEffect(target, { id: 'betrayal' }, logFn, cloakOwner, { session });
  }
}

function flushDamageReaction(target, pending = {}) {
  if (!target || target.hp <= 0) return;
  const {
    damage = 0,
    sharedContext = {},
    shieldBefore = 0,
    source = null,
    directAttack = false,
    fromEffect = null,
    logFn = () => {},
    session = null,
  } = pending;

  notifyDamageTaken(target, damage, sharedContext);
  if (damage > 0) {
    triggerEquipmentOnDamageTaken(target, damage, {
      shieldBefore,
      logFn,
      session,
      source,
      directAttack,
      fromEffect,
      actualHpLost: sharedContext.actualHpLostFromHit ?? sharedContext.actualHpLost,
    });
  }
  applyDefenderSpikedShield(target, {
    source,
    shieldBefore,
    directAttack,
    fromEffect,
    logFn,
    session,
  });
  applySerpentCarapaceRetaliation(target, {
    source,
    shieldBefore,
    directAttack,
    fromEffect,
    logFn,
    session,
  });
  if (damage > 0) {
    triggerPassiveDamageReactions(target, damage, { source, session, logFn, context: sharedContext });
    triggerRuneOnDamageTaken(target, { source, session, logFn, directAttack, fromEffect });
  }
  if (target.hp > 0 && target.shield <= 0 && shieldBefore > 0) {
    handleShieldBreak(target, {
      attacker: source, session, logFn,
      deliberateAction: sharedContext.deliberateAction,
      directAttack: sharedContext.directAttack,
      fromEffect: sharedContext.fromEffect,
    });
  }
  removeDepletedShieldEffects(target);
}

function queueDamageReaction(target, pending) {
  if (!target || target.hp <= 0) return;
  target._pendingDamageReactions = target._pendingDamageReactions || [];
  target._pendingDamageReactions.push(pending);
}

function flushPendingDamageReactions(target) {
  if (!target?._pendingDamageReactions?.length) return;
  const pending = target._pendingDamageReactions.splice(0);
  pending.forEach(entry => flushDamageReaction(target, entry));
}

function triggerDeathPreventionEffects(target, damage, sharedContext) {
  if (!target || target.hp > 0 || !Array.isArray(target.effects)) return false;
  const rebirthEffects = target.effects.filter(effect => effect?.id === 'rebirth');
  if (rebirthEffects.length === 0) return false;
  const originalEffects = target.effects;
  target.effects = rebirthEffects;
  notifyDamageTaken(target, damage, sharedContext);
  if (target.hp > 0) {
    target.effects = originalEffects.filter(effect => effect?.id !== 'rebirth');
    return true;
  }
  target.effects = originalEffects;
  return false;
}

function triggerEnemyCombatObject(object, session, actor, actionToken, logFn = () => {}) {
  if (!object?.nonActingCombatObject || object.hp <= 0 || object._triggeredByAction === actionToken) return false;
  object._triggeredByAction = actionToken;
  object.hp = 0;
  const player = session?.state?.players?.find(unit => unit?.hp > 0);
  const owner = session?.state?.enemies?.find(unit => unit?.id === object.ownerId);
  const sourceAttack = owner?.attack ?? object.sourceAttack ?? 0;
  if (player && sourceAttack > 0) {
    applyDamage(player, sourceAttack * (object.triggerDamageMultiplier ?? 0.7), 'physical', {
      source: owner || object, session, logFn, directAttack: false, fromEffect: 'enemy_combat_object', deliberateAction: actionToken,
    });
    if (object.triggerEffect) addEffect(player, object.triggerEffect, logFn, owner || object, { session });
  }
  session.state.metrics ||= {};
  session.state.metrics.snaresTriggered = (session.state.metrics.snaresTriggered || 0) + 1;
  logFn(`🪤 ${object.name} срабатывают${actor?.name ? ` из-за действия ${actor.name}` : ''}!`);
  return true;
}

export function applyDamage(target, raw, type = "physical", options = {}) {
  const {
    source = null,
    logFn = null,
    session = null,
    ignoreDefenseFraction = 0,
    magicSchool = null,
    fromEffect = null,
    sourceEffectId = null,
    sourceEffectInstance = null,
    skipFlameRuneTrigger = false,
    directAttack = false,
    counterAttack = false,
    isPeriodic = false,
    areaAttack = false,
    deferReactions = false,
    directDamageMultiplier = 1,
    shieldDamageMultiplier = 1,
    shieldBeforeDefense = null,
    hpDamageMultiplier = 1,
    deliberateAction = null,
    originActionId = null,
    bypassShield = false,
    bypassDamageModifiers = false,
    isSecondaryDamage = false,
    suppressDamageReactions = false,
    bypassOutgoingModifiers = false,
    presentationCause = null,
  } = options;
  const presentationCauseFields = presentationCause ? {
    afterEventType: presentationCause.type,
    afterTargetId: presentationCause.target
      ? (combatUnitId(presentationCause.target) || presentationCause.target.name)
      : presentationCause.targetId,
    afterEventDirection: presentationCause.direction,
    afterDelay: presentationCause.delay,
  } : {};
  const hero = session?.state?.players?.[0];
  let outgoingMultiplier = 1;
  if (!bypassOutgoingModifiers && source) {
    if (source === hero && session?.state?.enemies?.includes(target) && !source.summoned) {
      outgoingMultiplier = getCorruptionOutgoingMultiplier(source) + getWitheringOutgoingBonus(source, session) +
        (getUndeathTier(source) >= 4 ? 0.1 : 0) + getDecayHeroOutgoingBonus(source);
    } else if (session?.state?.enemies?.includes(source)) {
      outgoingMultiplier += getDecayEnemyCooldownBonus(source, session);
    }
  }
  outgoingMultiplier *= 1 + getRuinsBannerDamageBonus(source, session, directAttack, fromEffect);
  let outgoingRaw = raw * outgoingMultiplier * getClassDamageMultiplier(source, options);
  const effectiveType = type === "true" ? "pure" : type;
  const hpBeforeDamage = target?.hp ?? 0;
  const preparationAtDamageStart = Boolean(target?._preparation);
  const stormShield = (target?.effects || []).find(effect => effect?.id === 'shield' && effect?.extra?.stormRetaliation)?.extra?.stormRetaliation;
  if (target?.nonActingCombatObject && target.hp > 0) {
    const safeDisarm = directAttack && options?.deliberateAction?.safeCombatObjectId === target.id;
    if (!safeDisarm) {
      triggerEnemyCombatObject(target, session, source, deliberateAction || options, logFn || (() => {}));
      return 0;
    }
  }
  if (effectiveType === "physical" && target.physImmune) {
    if (!suppressDamageReactions) {
      notifyDamageTaken(target, 0, { source, log: logFn, session, damageType: effectiveType, directAttack, isPeriodic, fromEffect, sourceEffectId });
    }
    return 0;
  }
  if (effectiveType === "magical" && target.magicImmune) {
    if (!suppressDamageReactions) {
      notifyDamageTaken(target, 0, { source, log: logFn, session, damageType: effectiveType, directAttack, isPeriodic, fromEffect, sourceEffectId });
    }
    return 0;
  }
  if (target && directAttack && !fromEffect && (target.effects || []).some(effect => effect?.id === 'block')) {
    consumeEffectStacks(target, 'block', 1);
    target.lastAbsorbed = 0;
    target._lastBlockedHitAction = deliberateAction || options;
    if (typeof logFn === 'function') logFn('🛡️ ' + (target.name || 'Цель') + ' блокирует попадание.');
    recordCombatPresentationEvent(session, { type: "shieldAbsorbed", actor: source, target, amount: 0, blocked: true, directAttack, isPeriodic, fromEffect, sourceEffectId, damageType: effectiveType, magicSchool, maxHp: target.maxHp, ...presentationCauseFields });
    return 0;
  }
  // Explicit reactive attacks (not reflected or periodic damage) still count as
  // an enemy attack for Torn Ritual Jacket. Ordinary direct abilities already
  // apply this modifier through performDirectDamage before calling applyDamage.
  if (counterAttack && !bypassDamageModifiers && target?.hp > 0) {
    outgoingRaw *= getTornRitualDamageMultiplier(
      target, source, deliberateAction || {}, session, logFn || (() => {})
    );
  }
  const defenseIgnore = (() => {
    const fromOptions = Math.max(0, Math.min(1, ignoreDefenseFraction || 0));
    const fromTarget = effectiveType === "magical"
      ? Math.max(0, Math.min(1, target.incomingMagicDefenseIgnore || 0))
      : effectiveType === "physical"
      ? Math.max(0, Math.min(1, target.incomingPhysDefenseIgnore || 0))
      : 0;
    return 1 - (1 - fromOptions) * (1 - fromTarget);
  })();

  let def = effectiveType === "magical"
    ? target.magicDef || 0
    : effectiveType === "pure"
    ? 0
    : target.physDef || 0;
  if (defenseIgnore > 0 && effectiveType !== "pure") {
    def = Math.max(0, def * (1 - defenseIgnore));
  }
  const mitigation = effectiveType === "pure" ? 0 : calcMitigation(def);
  const provocationGuard = directAttack && !fromEffect && source
    ? (target?.effects || []).find(effect => effect?.id === 'provocation_guard'
      && effect.extra?.talentId === 'defender.bloody_challenge.defensive_stance'
      && (source.effects || []).some(entry => entry?.id === 'provoked'
        && entry.extra?.defenderId === (effect.extra?.defenderId || target?.id)))
    : null;
  const defensiveStanceMultiplier = provocationGuard ? 0.8 : 1;

  const applyIncomingDamageModifiers = value => {
    let modified = Math.max(0, Math.round(value));

    if (magicSchool === MAGIC_SCHOOLS.FIRE) {
      const charringStacks = Math.min(3, (target.effects || []).filter(effect => effect?.id === 'charring').reduce((sum, effect) => sum + Math.max(1, Number(effect.stacks) || 1), 0));
      const bonus = [0, 0.05, 0.12, 0.25][charringStacks] || 0;
      modified = Math.max(0, Math.round(modified * (1 + bonus)));
    }

    const damageTakenMultiplier = bypassDamageModifiers ? 1 : (target.statMultipliers?.damageTaken ?? 1);
    modified = Math.max(0, Math.round(modified * damageTakenMultiplier));

    if (!bypassDamageModifiers && target === hero && getDecayTier(hero) >= 3) {
      modified = Math.max(0, Math.round(modified * Math.max(0, 1 - getDecayStatusBonus(hero))));
    }
    if (!bypassDamageModifiers && session?.state?.enemies?.includes(target)) {
      modified = Math.max(0, Math.round(modified * (1 + getDecayEnemyCooldownBonus(target, session))));
    }

    if (!bypassDamageModifiers && directAttack) {
      modified = Math.max(0, Math.round(modified *
        minesGalleryDamageMultiplier(session, target, source, { directAttack, areaAttack })));
    }

    const typeBonus = bypassDamageModifiers ? null : target.damageTypeMultipliers?.[effectiveType];
    if (typeof typeBonus === "number" && Number.isFinite(typeBonus) && typeBonus !== 1) {
      modified = Math.max(0, Math.round(modified * typeBonus));
    }
    return modified;
  };

  const shieldBefore = target.shield ?? 0;
  const shieldEffectStocksBefore = (target.effects || [])
    .filter(effect => effect?.id === 'shield')
    .map(effect => ({ effect, before: Math.max(0, Number(effect.appliedShield ?? effect.value) || 0) }));
  const directShieldDurabilityReducers = captureDirectShieldDurabilityReducers(target);
  // Direct attacks and ordinary periodic ticks consume Shield before defense.
  // Only the overflow reaching HP is reduced by physical or magical defense.
  // Gloom and Searing Mark bypass Shield explicitly; other indirect effects
  // retain their existing behavior unless shieldBeforeDefense is supplied.
  const usesShieldBeforeDefense = Boolean(
    (shieldBeforeDefense ?? ((directAttack && !fromEffect) || isPeriodic)) &&
    !bypassShield &&
    shieldBefore > 0
  );

  const preDefenseDirectDamage = applyIncomingDamageModifiers(
    Math.max(0, Math.round(outgoingRaw * defensiveStanceMultiplier * Math.max(0, directDamageMultiplier || 1)))
  );
  let dmg = usesShieldBeforeDefense
    ? preDefenseDirectDamage
    : applyIncomingDamageModifiers(
        Math.max(0, Math.round(outgoingRaw * defensiveStanceMultiplier * Math.max(0, directDamageMultiplier || 1) * (1 - mitigation)))
      );

  if (!usesShieldBeforeDefense && target.immortal && effectiveType !== "pure") {
    const projected = Math.max(0, (target.hp ?? 0) - dmg);
    if (projected < 1) {
      dmg = Math.max(0, (target.hp ?? 0) - 1);
    }
  }

  let absorbed = 0;
  let shieldDamageTaken = 0;
  let exhaustedShieldSources = [];
  if (!bypassShield && shieldBefore > 0) {
    const incomingToShield = usesShieldBeforeDefense ? preDefenseDirectDamage : dmg;
    if (incomingToShield > 0) {
      absorbed = Math.min(shieldBefore, incomingToShield);
      const requestedShieldMultiplier = Number(shieldDamageMultiplier);
      const resolvedShieldMultiplier = Number.isFinite(requestedShieldMultiplier)
        ? Math.max(0, requestedShieldMultiplier)
        : 1;
      // Multipliers above 1 are shield-break bonuses and may consume more Shield
      // than the hit actually absorbs. Multipliers below 1 preserve the same-hit
      // HP overflow while reducing only the Shield durability spent.
      const requestedShieldDamage = resolvedShieldMultiplier >= 1
        ? Math.max(absorbed, Math.round(incomingToShield * resolvedShieldMultiplier))
        : Math.round(absorbed * resolvedShieldMultiplier);
      shieldDamageTaken = Math.min(shieldBefore, Math.max(0, requestedShieldDamage));
      target.shield -= shieldDamageTaken;
      exhaustedShieldSources = consumeShieldEffectBookkeeping(target, shieldDamageTaken);
      const restoredShieldDurability = restoreReducedDirectShieldDurability(
        target,
        directShieldDurabilityReducers,
        { directAttack, fromEffect }
      );
      shieldDamageTaken = Math.max(0, shieldDamageTaken - restoredShieldDurability);
      target.lastShieldDamage = shieldDamageTaken;

      if (usesShieldBeforeDefense) {
        const overflow = Math.max(0, incomingToShield - absorbed);
        dmg = effectiveType === "pure"
          ? overflow
          : Math.max(0, Math.round(overflow * (1 - mitigation)));
      } else {
        dmg -= absorbed;
      }
    }
  }

  if (usesShieldBeforeDefense && target.immortal && effectiveType !== "pure") {
    dmg = Math.min(dmg, Math.max(0, (target.hp || 0) - 1));
  }

  if (dmg > 0 && hpDamageMultiplier !== 1) {
    dmg = Math.max(0, Math.round(dmg * Math.max(0, Number(hpDamageMultiplier) || 0)));
    if (target.immortal && effectiveType !== "pure") {
      dmg = Math.min(dmg, Math.max(0, (target.hp || 0) - 1));
    }
  }
  dmg = Math.round(dmg * getRuinsLegionGuardReduction(target, session, directAttack));
  dmg = reduceRuinsDeadshotDamage(target, dmg, session, { directAttack, fromEffect, isPeriodic });
  const distortion = session?.state?.players?.[0] === target
    ? calculateDistortionIncoming(target, dmg, { directAttack, fromEffect, isPeriodic })
    : { damage: dmg, prevented: 0, enhancedConsumed: false };
  dmg = distortion.damage;
  if (distortion.enhancedConsumed) target._distortionEnhancedHitReady = false;
  let distortionDeathSaved = false;
  if (
    dmg >= (target.hp || 0) && target.hp > 0 && getDistortionTier(target) >= 5 &&
    directAttack && !fromEffect && !isPeriodic && session?.state?.enemies?.includes(source) &&
    !target._distortionDeathSaveConsumed
  ) {
    target._distortionDeathSaveConsumed = true;
    distortionDeathSaved = true;
    dmg = Math.max(0, (target.hp || 0) - 1);
    recordCombatPresentationEvent(session, {
      type: "procTriggered",
      actor: target,
      target,
      procKind: "curse",
      procId: "distortion_impossible_outcome",
      label: "Невозможный исход",
      deathSave: true,
      afterEventType: "damage",
      afterTargetId: combatUnitId(target) || target.name,
      afterEventDirection: "following",
    });
    logFn?.(`◇ [Невозможный исход] оставляет ${target.name || 'героя'} с 1 HP.`);
  }
  if (target._distortionSaveChainActive && fromEffect === 'charge') {
    dmg = Math.min(dmg, Math.max(0, (target.hp || 0) - 1));
  }
  let undeathDeathSaved = false;
  if (
    dmg >= (target.hp || 0) && target.hp > 0 && session?.state?.players?.[0] === target &&
    getUndeathTier(target) >= 5 && !target._undeathDeathSaveConsumed
  ) {
    target._undeathDeathSaveConsumed = true;
    undeathDeathSaved = true;
    dmg = Math.max(0, (target.hp || 0) - 1);
    recordCombatPresentationEvent(session, {
      type: "procTriggered",
      actor: target,
      target,
      procKind: "curse",
      procId: "undeath_death_grip",
      label: "Хватка смерти",
      deathSave: true,
      afterEventType: "damage",
      afterTargetId: combatUnitId(target) || target.name,
      afterEventDirection: "following",
    });
  }
  triggerExhaustedShieldSources(target, exhaustedShieldSources, source, session, logFn);
  target.lastAbsorbed = absorbed;
  if (session?.state) {
    const metrics = (session.state.metrics ||= {});
    const sourceIsPlayer = (session.state.players || []).includes(source);
    const targetIsPlayer = (session.state.players || []).includes(target);
    if (fromEffect === 'poison' || sourceEffectId === 'poison') {
      if (effectiveType === 'physical') metrics.poisonTicks = (metrics.poisonTicks || 0) + 1;
      const key = sourceIsPlayer && !targetIsPlayer ? 'poisonDamagePlayerToEnemies' : !sourceIsPlayer && targetIsPlayer ? 'poisonDamageEnemiesToPlayer' : 'poisonDamageOther';
      metrics[key] = (metrics[key] || 0) + dmg;
      if (target.hp > 0 && target.hp - dmg <= 0) metrics.poisonDeaths = (metrics.poisonDeaths || 0) + 1;
    }
    if (isPeriodic) {
      const key = sourceIsPlayer && !targetIsPlayer ? 'periodicDamagePlayerToEnemies' : !sourceIsPlayer && targetIsPlayer ? 'periodicDamageEnemiesToPlayer' : 'periodicDamageOther';
      metrics[key] = (metrics[key] || 0) + dmg;
    } else if (directAttack) {
      const key = sourceIsPlayer && !targetIsPlayer ? 'directDamagePlayerToEnemies' : !sourceIsPlayer && targetIsPlayer ? 'directDamageEnemiesToPlayer' : 'directDamageOther';
      metrics[key] = (metrics[key] || 0) + dmg;
      metrics.directHits = (metrics.directHits || 0) + 1;
    }
    metrics.shieldAbsorbed = (metrics.shieldAbsorbed || 0) + absorbed;
  }
  if (absorbed > 0) {
    const shieldBroken = shieldBefore > 0 && target.shield <= 0;
    recordCombatPresentationEvent(session, { type: "shieldAbsorbed", actor: source, target, amount: shieldDamageTaken, directAttack, isPeriodic, fromEffect, sourceEffectId, damageType: effectiveType, magicSchool, maxHp: target.maxHp, shieldBroken, ...presentationCauseFields });
    if (shieldBroken) notifySublocationShieldBroken(session, target, logFn || (() => {}));
    if (
      directAttack &&
      !fromEffect &&
      session?.state?.players?.includes(target) &&
      session?.state?.enemies?.includes(source) &&
      hasEquipped(target, EQUIPMENT_EFFECTS.UNRELENTING_MARCH_SHIELD) &&
      canUseEquipmentTurnFlag(target, 'unrelentingMarchTempo')
    ) {
      grantEquipmentTurnMeter(target, 150, session, {
        source: EQUIPMENT_EFFECTS.UNRELENTING_MARCH_SHIELD,
        trigger: 'shield_absorb',
      });
      logFn?.(`🛡️ ${EQUIPMENT_EFFECTS.UNRELENTING_MARCH_SHIELD} заполняет ШХ на 15%.`);
    }
  }

  const sharedContext = {
    source,
    log: logFn,
    applyHealing: (unit, amount) => applyHealing(unit, amount, { source, logFn, session, deliberateAction }),
    applyDamage: (unit, amount, subtype = "physical", extra = {}) =>
      applyDamage(unit, amount, subtype, {
        ...extra,
        source: extra?.source ?? target,
        logFn,
        session,
        fromEffect: fromEffect || extra?.fromEffect || null,
        sourceEffectId: extra?.sourceEffectId ?? sourceEffectId ?? null,
        skipFlameRuneTrigger: Boolean(extra?.skipFlameRuneTrigger || skipFlameRuneTrigger),
        directAttack: extra?.directAttack ?? false,
        directDamageMultiplier: extra?.directDamageMultiplier ?? 1,
        shieldDamageMultiplier: extra?.shieldDamageMultiplier ?? 1,
        hpDamageMultiplier: extra?.hpDamageMultiplier ?? 1,
        deliberateAction: extra?.deliberateAction ?? deliberateAction,
        isPeriodic: extra?.isPeriodic ?? isPeriodic,
      }),
    session,
    damageType: effectiveType,
    magicSchool,
    directAttack,
    isPeriodic,
    fromEffect,
    sourceEffectId,
    skipFlameRuneTrigger,
    shieldBefore,
    shieldEffectStocksBefore,
    deliberateAction,
    shieldDamageMultiplier,
    hpDamageMultiplier,
    getRetaliatoryAssaultBonuses,
    consumeRetaliatoryAssault,
  };

  const positiveDamageEvent = dmg > 0 || absorbed > 0;

  if (
    positiveDamageEvent &&
    isPeriodic &&
    sourceEffectInstance &&
    target.hp > 0 &&
    hasEquipped(target, EQUIPMENT_EFFECTS.BLACK_STRATUM_BOOTS) &&
    getEffectDefinition(sourceEffectInstance.id)?.type === 'debuff' &&
    isFiniteTimedEffect(sourceEffectInstance) &&
    canUseEquipmentTurnFlag(target, 'blackStratumBoots')
  ) {
    const label = sourceEffectInstance.name || getEffectDefinition(sourceEffectInstance.id)?.name || sourceEffectInstance.id;
    if (shortenTimedEffect(target, sourceEffectInstance, 1, logFn || (() => {}))) {
      logFn?.(`🥾 ${EQUIPMENT_EFFECTS.BLACK_STRATUM_BOOTS} дополнительно сокращают «${label}» на 1 ход.`);
    }
  }

  if (positiveDamageEvent && directAttack && !fromEffect && !isSecondaryDamage && deliberateAction && source
      && target?.name === 'Архонт Цветения' && session?.state?.players?.includes(source)
      && !deliberateAction.bloomArchonAttackCounted) {
    deliberateAction.bloomArchonAttackCounted = true;
    target._bloomArchonAttackActionCounter = ((target._bloomArchonAttackActionCounter || 0) + 1) % 2;
    if (target._bloomArchonAttackActionCounter === 0) {
      addEffect(source, { id: 'entanglement', stacks: 1 }, logFn, target, { session });
      logFn?.(`🌿 Архонт Цветения опутывает ${source.name} за второе атакующее действие.`);
    }
  }
  if (positiveDamageEvent && directAttack && !fromEffect && source && source !== target && deliberateAction &&
      hasEquippedClassPassive(target, 'retaliatory_assault') && !target.passivesDisabled && !deliberateAction.retaliatoryAssaultRegistered) {
    registerRetaliatoryAssaultAttack(target, source);
    deliberateAction.retaliatoryAssaultRegistered = true;
  }
  if (positiveDamageEvent && directAttack && !fromEffect && source && source !== target) {
    const attackerId = source.instanceId || source.combatId || source.id || source.name;
    if (attackerId != null) {
      target._defensiveStrikeAttackers ||= [];
      if (!target._defensiveStrikeAttackers.includes(attackerId)) target._defensiveStrikeAttackers.push(attackerId);
    }
    const guard = (target.effects || []).find(effect => effect?.id === 'provocation_guard'
      && effect.extra?.talentId === 'defender.bloody_challenge.bloody_reckoning'
      && !effect.extra?.reckoningResolved);
    if (guard && attackerId != null) {
      guard.extra.reckoningTargetIds ||= [];
      if (!guard.extra.reckoningTargetIds.includes(attackerId)) guard.extra.reckoningTargetIds.push(attackerId);
    }
  }
  const iceElementalAttack = source?.summoned && (source?.owner?.class === 'Mage' || source?.owner?.class === 'Elementalist') && source?.element === MAGIC_SCHOOLS.ICE;
  const iceShardProc = positiveDamageEvent && directAttack && !fromEffect && !iceElementalAttack
    && deliberateAction?.incomingElementSchool !== MAGIC_SCHOOLS.FIRE
    && deliberateAction?.incomingElementSchool !== MAGIC_SCHOOLS.LIGHTNING
    ? (() => {
      const shards = (target.effects || []).filter(effect => effect?.id === 'ice_shards');
      if (!shards.length) return null;
      return { shard: shards[0], stacks: Math.min(3, shards.length) };
    })()
    : null;
  const resolveIceShardProc = () => {
    if (!iceShardProc || !(target.effects || []).includes(iceShardProc.shard) || target.hp <= 0) return;
    const shardOwner = iceShardProc.shard.sourceRef || iceShardProc.shard.sourceSnapshot?.entity || null;
    const currentMagAtk = Number.isFinite(shardOwner?.magAtk)
      ? shardOwner.magAtk
      : iceShardProc.shard.sourceSnapshot?.magAtk || 0;
    cleanseEffects(target, effect => effect === iceShardProc.shard, logFn);
    const shardDamage = currentMagAtk * ([0, 0.2, 0.5, 1][iceShardProc.stacks] || 0)
      * Math.max(1, Number(deliberateAction?.iceShardDamageMultiplier) || 1);
    if (shardDamage > 0) applyDamage(target, shardDamage, 'magical', {
      source: shardOwner, session, logFn, magicSchool: MAGIC_SCHOOLS.ICE,
      directAttack: false, fromEffect: 'ice_shards', sourceEffectId: 'ice_shards',
    });
  };
  if (positiveDamageEvent && magicSchool === MAGIC_SCHOOLS.LIGHTNING && session?._processingEnemyTurn && source && session?.state?.enemies?.includes(source)) {
    const hero = session.state.players?.[0];
    if (hero) hero._enemyTurnLightningPositive = true;
  }
  if (positiveDamageEvent && directAttack && stormShield && deliberateAction && session?.state?.players?.includes(source) && stormShield.lastAction !== deliberateAction) {
    stormShield.lastAction = deliberateAction;
    const caster = stormShield.caster?.hp > 0 ? stormShield.caster : session.state.enemies?.find(unit => unit?.id === stormShield.casterId && unit.hp > 0);
    if (caster) {
      applyDamage(source, (caster.magAtk || 0) * (stormShield.multiplier ?? 0.4), 'magical', {
        source: caster, session, logFn, magicSchool: MAGIC_SCHOOLS.LIGHTNING, directAttack: false, fromEffect: 'storm_shield_retaliation',
      });
      if (combatRng(session)() < (stormShield.chance ?? 0.2)) addEffect(source, { id: 'shock', duration: 1 }, logFn, caster, { session, elementalistControlFallback: false });
      logFn?.(`⚡ Грозовой щит ${target.name} отвечает разрядом.`);
    }
  }
  if (dmg <= 0) {
    if (absorbed > 0) {
      const pendingReaction = {
        damage: 0,
        sharedContext,
        shieldBefore,
        source,
        directAttack,
        fromEffect,
        logFn,
        session,
      };
      if (!suppressDamageReactions) {
        if (deferReactions) {
          queueDamageReaction(target, pendingReaction);
        } else {
          flushDamageReaction(target, pendingReaction);
        }
      }
    }
    resolveIceShardProc();
    return 0;
  }

  target.hp = Math.max(0, target.hp - dmg);
  if (getUndeathTier(target) >= 5) syncUndeathLowHpPenalty(target);
  if (undeathDeathSaved) {
    cleanseEffects(
      target,
      (effect, metadata) => (effect.type || metadata?.type) === 'debuff',
      logFn || (() => {}),
      {
        session,
        actor: target,
        presentationCause: {
          type: "procTriggered",
          target,
          direction: "preceding",
        },
      }
    );
    logFn?.(`☠️ [Хватка смерти] оставляет ${target.name || 'героя'} с 1 HP.`);
    if (target._undeathLastEcho) {
      resolvePendingRuinsEcho(target, session, logFn || (() => {}), {
        ...cloneEchoSnapshot(target._undeathLastEcho),
        abilityName: target._undeathLastEcho.abilityName,
        efficiency: UNDEATH_ECHO_EFFICIENCY,
        source: 'undeath_death_save',
        heroOwned: true,
        suppressRecursion: true,
      });
    }
  }
  sharedContext.actualHpLostFromHit = Math.max(0, hpBeforeDamage - target.hp);
  if (distortion.prevented > 0) {
    if (distortionDeathSaved) target._distortionSaveChainActive = true;
    addRefraction(target, distortion.prevented, session, logFn || (() => {}));
    if (distortionDeathSaved) target._distortionSaveChainActive = false;
  }
  if (
    sharedContext.actualHpLostFromHit > 0 && directAttack && !fromEffect && !isPeriodic &&
    session?.state?.players?.[0] === target && session?.state?.enemies?.includes(source) &&
    getCorruptionTier(target) >= 2 && target._corruptionIncomingThirstAvailable !== false
  ) {
    target._corruptionIncomingThirstAvailable = false;
    grantCorruptionThirst(target, session, logFn || (() => {}));
  }
  if (
    isPeriodic &&
    target.hp > 0 &&
    (target.effects || []).some(effect => effect?.id === 'reverence')
  ) {
    const periodicHpLost = Math.max(0, hpBeforeDamage - target.hp);
    if (periodicHpLost > 0) {
      target._reverencePeriodicDamage = Math.max(0, Number(target._reverencePeriodicDamage) || 0) + periodicHpLost;
      const threshold = Math.max(1, (target.maxHp || 0) * 0.15);
      if (target._reverencePeriodicDamage >= threshold) {
        cleanseEffects(target, effect => effect?.id === 'reverence', logFn || (() => {}));
        target._reverencePeriodicDamage = 0;
        logFn?.(`👑 Накопленный периодический урон пробуждает ${target.name || 'цель'} от Преклонения.`);
      }
    }
  }
  if (
    hpBeforeDamage > 0 &&
    target.hp <= 0 &&
    target.summoned &&
    session?.state?.players?.includes(target) &&
    !target._temporaryDisappearNotified
  ) {
    target._temporaryDisappearNotified = true;
    const owner = (session.state.players || []).find(unit => unit?.id === target.summonerId) || session.state.players?.[0] || null;
    const template = target._summonTemplate || target._temporarySummonTemplate || createUnitSummonTemplate(target);
    notifyFriendlyTemporarySummonDisappeared(owner, session, logFn || (() => {}), {
      kind: target.summonKind,
      reason: 'death',
      template,
      temporary: Boolean(target.temporarySummon),
      vanishedUnit: target,
      lastEchoCopy: Boolean(target._lastEchoCopy),
    });
  }
  triggerLateSpringShroud(target, hpBeforeDamage, session, logFn || (() => {}));
  const bloomArchonPhaseTransitioned = transitionBloomArchonPhaseTwo(target, session, logFn || (() => {}));
  transitionRuinsLegion(target, session);
  if (target.hp <= 0) cleanupRuinsOwnerDeath(target, session);
  transitionMinesBossPhase(target, session, logFn || (() => {}));
  triggerMinesLastShift(session, target, hpBeforeDamage);
  if (target.nonActingCombatObject && target.hp <= 0 && deliberateAction?.safeCombatObjectId === target.id && session) {
    session.state.metrics ||= {};
    session.state.metrics.snaresSafeDisarmed = (session.state.metrics.snaresSafeDisarmed || 0) + 1;
  }
  if (target._preparation?.durability != null && dmg > 0) {
    target._preparation.durability -= dmg;
    if (target._preparation.durability <= 0) {
      target._preparation = null;
      session && (session.state.metrics ||= {});
      if (session) session.state.metrics.bladePreparationsBroken = (session.state.metrics.bladePreparationsBroken || 0) + 1;
      logFn?.(`💥 Подготовка ${target.name || 'цели'} сорвана.`);
    }
  }
  (target.abilities || []).filter(passive => passive?.passive && passive.hpThresholdPreparation).forEach(passive => {
    const config = passive.hpThresholdPreparation;
    if (target._hpThresholdPreparationUsed || target.hp > target.maxHp * config.ratio) return;
    target._hpThresholdPreparationUsed = true;
    target._brokenOathTriggered = true;
    if (!target._preparation && !preparationAtDamageStart) {
      target._preparation = { ...config.preparation };
      session && (session.state.metrics ||= {});
      if (session) session.state.metrics.bladePreparationsStarted = (session.state.metrics.bladePreparationsStarted || 0) + 1;
      logFn?.(`⚔️ ${passive.name}: ${target.name} начинает ${target._preparation.resolveName}.`);
    }
    if (session) {
      session.state.metrics ||= {};
      session.state.metrics.brokenOathActivations = (session.state.metrics.brokenOathActivations || 0) + 1;
    }
  });
  if (!suppressDamageReactions) {
    triggerFirstTraitorThreshold(target, hpBeforeDamage, session, logFn || (() => {}));
  }
  let lastStandDeathSaved = false;
  if (target.hp <= 0 && source && source !== target && hasEquippedClassPassive(target, 'last_stand') && !target.passivesDisabled && !target.lastStandConsumed && !target._lastStandConsumed) {
    // Consume first: later packets in this action must never save the Defender again.
    target.lastStandConsumed = true;
    target._lastStandConsumed = true;
    lastStandDeathSaved = true;
    target.hp = 1;
    const deathSaveRecoveryCause = {
      type: "procTriggered",
      target,
      direction: "following",
    };
    applyHealing(target, (target.maxHp || 0) * 0.3, {
      source: target,
      logFn,
      session,
      presentationCause: deathSaveRecoveryCause,
    });
    addEffect(
      target,
      { id: 'shield', duration: 3, value: Math.round((target.maxHp || 0) * 0.5) },
      logFn,
      target,
      { session, presentationCause: deathSaveRecoveryCause }
    );
    target.turnMeter = TURN_METER_THRESHOLD;
    logFn?.(`🛡️ Последний рубеж спасает ${target.name}: лечение 30%, Щит 50% и полная шкала хода.`);
    recordCombatPresentationEvent(session, {
      type: "procTriggered",
      actor: target,
      target,
      procKind: "passive",
      procId: "last_stand",
      label: "Последний рубеж",
      deathSave: true,
      afterEventType: "damage",
      afterTargetId: combatUnitId(target) || target.name,
      afterEventDirection: "following",
    });
  }
  sharedContext.actualHpLost = Math.max(0, hpBeforeDamage - target.hp);
  const thornReflection = getThornReflectionDamage(target, {
    source, actualHpLost: sharedContext.actualHpLost, directAttack, isPeriodic, fromEffect, sourceEffectId,
  });
  target.lastDamageTaken = dmg;
  const periodicPresentationEffectId = isPeriodic ? (sourceEffectId || fromEffect) : null;
  if (periodicPresentationEffectId) {
    const periodicDefinition = getEffectDefinition(periodicPresentationEffectId);
    recordCombatPresentationEvent(session, {
      type: "statusTriggered",
      actor: source,
      target,
      effectId: periodicDefinition?.id || periodicPresentationEffectId,
      effectType: periodicDefinition?.type,
      label: periodicDefinition?.name || periodicPresentationEffectId,
      statusOperation: "trigger",
    });
  }
  const deathSavePresentation = lastStandDeathSaved
    ? { kind: "passive", id: "last_stand", label: "Последний рубеж" }
    : undeathDeathSaved
    ? { kind: "curse", id: "undeath_death_grip", label: "Хватка смерти" }
    : distortionDeathSaved
    ? { kind: "curse", id: "distortion_impossible_outcome", label: "Невозможный исход" }
    : null;
  recordCombatPresentationEvent(session, {
    type: "damage",
    actor: source,
    target,
    amount: dmg,
    lethal: hpBeforeDamage > 0 && target.hp <= 0,
    deathSaveKind: deathSavePresentation?.kind,
    deathSaveId: deathSavePresentation?.id,
    deathSaveLabel: deathSavePresentation?.label,
    directAttack,
    isPeriodic,
    fromEffect,
    sourceEffectId,
    damageType: effectiveType,
    magicSchool,
    maxHp: target.maxHp,
    ...presentationCauseFields,
  });
  if (bloomArchonPhaseTransitioned) {
    recordCombatPresentationEvent(session, {
      type: "bossPhaseTransition",
      actor: target,
      target,
      phase: 2,
      label: "Увядание",
      subtitle: "Цветение сменяется увяданием",
    });
  }
  if (deathSavePresentation) {
    recordCombatPresentationEvent(session, {
      type: "deathSaveResolved",
      actor: target,
      target,
      deathSaveKind: deathSavePresentation.kind,
      deathSaveId: deathSavePresentation.id,
      label: deathSavePresentation.label,
      afterEventType: "damage",
      afterTargetId: combatUnitId(target) || target.name,
      afterEventDirection: "preceding",
      afterDelay: COMBAT_PRESENTATION_TIMING.deathSaveProcDelay + COMBAT_PRESENTATION_TIMING.deathSaveResolveDelay,
    });
  }

  const pendingReaction = {
    damage: dmg,
    sharedContext,
    shieldBefore,
    source,
    directAttack,
    fromEffect,
    logFn,
    session,
  };
  if (!suppressDamageReactions) {
    notifyVampireMarkOnLethalDamage(target, dmg, sharedContext);
    notifyConductivityOnLethalDamage(target, dmg, sharedContext);
  }
  const deathPrevented = target.hp <= 0
    ? triggerDeathPreventionEffects(target, dmg, sharedContext)
    : false;
  if (hpBeforeDamage > 0 && target.hp <= 0) {
    triggerOnDeath(target, source, session, logFn);
    if (target.hp <= 0) {
      registerForestEnemyDeath({ session, unit: target, deliberateAction, originActionId, logFn: logFn || (() => {}) });
      recordCombatPresentationEvent(session, {
        type: "death",
        actor: source,
        target,
      });
    }
  }
  // Reflect after resolving a lethal hit as well. Indirect pure damage cannot
  // re-trigger Thorns, and neither defenses nor Shield reduce this exact amount.
  if (thornReflection > 0 && source?.hp > 0) {
    const reflected = applyDamage(source, Math.min(thornReflection, source.hp), 'pure', {
      source: target, session, logFn, directAttack: false, isPeriodic: false,
      fromEffect: THORN_REFLECTION_ID, sourceEffectId: THORN_REFLECTION_ID,
      bypassShield: true, bypassDamageModifiers: true,
    });
    if (reflected > 0 && typeof logFn === 'function') {
      logFn(`🌿 Ответные шипы ${target.name || 'стража'} отражают ${reflected} урона по ${source.name || 'атакующему'}.`);
    }
  }
  if (deathPrevented) {
    return dmg;
  }
  if (!suppressDamageReactions) {
    if (deferReactions) {
      queueDamageReaction(target, pendingReaction);
    } else {
      flushDamageReaction(target, pendingReaction);
    }
  }
  resolveIceShardProc();
  return dmg;
}

function resolveDamageValue(ability, attacker, target, session = null, actionSnapshot = null) {
  if (!ability) return attacker.attack;

  let value;
  if (typeof ability.damage === "function") {
    try {
      value = ability.damage({ attacker, target, session, actionSnapshot });
    } catch (err) {
      console.warn("Ошибка вычисления урона способности", ability.name, err);
      value = attacker.attack;
    }
  } else if (typeof ability.damage === "number") {
    value = ability.damage;
  } else {
    value = attacker.attack;
  }

  if (!Number.isFinite(value)) {
    value = attacker.attack;
  }

  if (attacker?.abilities && !attacker.passivesDisabled) {
    attacker.abilities.forEach(passive => {
      if (!passive?.passive || typeof passive.modifyDamage !== "function") return;
      try {
        const modified = passive.modifyDamage({
          damage: value,
          attacker,
          target,
          ability,
          session,
        });
        if (typeof modified === "number" && Number.isFinite(modified)) {
          value = modified;
        }
      } catch (err) {
        console.warn("Ошибка модификации урона пассивом", passive.name, err);
      }
    });
  }
  return value;
}

function resolveDamageType(ability, attacker, target) {
  if (!ability) return "physical";
  if (typeof ability.typeResolver === "function") {
    try {
      return ability.typeResolver({ attacker, target }) || "physical";
    } catch (e) {
      console.warn("Ошибка определения типа урона способности", ability.name, e);
    }
  }
  if (typeof ability.type === "function") {
    try {
      return ability.type({ attacker, target }) || "physical";
    } catch (e) {
      console.warn("Ошибка определения типа урона способности", ability.name, e);
    }
  }
  return ability.type || "physical";
}

function resolveMagicSchool(ability, attacker, target, damageType = null) {
  if (!ability) return null;
  if (typeof ability.schoolResolver === "function") {
    try {
      const resolved = ability.schoolResolver({ attacker, target });
      if (resolved) return resolved;
    } catch (err) {
      console.warn("Ошибка определения школы магии", ability.name, err);
    }
  }
  if (typeof ability.school === "function") {
    try {
      const resolved = ability.school({ attacker, target });
      if (resolved) return resolved;
    } catch (err) {
      console.warn("Ошибка вычисления школы магии", ability.name, err);
    }
  } else if (ability.school) {
    return ability.school;
  }
  const effectiveType = damageType || resolveDamageType(ability, attacker, target);
  if (effectiveType === "magical") {
    return attacker?.weaponMagicSchool || DEFAULT_MAGIC_SCHOOL;
  }
  return null;
}

function resolveAbilityEffect(effectDescriptor, context = {}) {
  if (!effectDescriptor) return [];

  const convert = descriptor => {
    if (!descriptor) return null;
    if (typeof descriptor === "function") {
      const result = descriptor(context);
      return result ? { ...result } : null;
    }
    if (typeof descriptor === "string") {
      return { name: descriptor };
    }
    if (typeof descriptor === "object") {
      return { ...descriptor };
    }
    return null;
  };

  if (Array.isArray(effectDescriptor)) {
    return effectDescriptor
      .map(entry => convert(entry))
      .filter(Boolean);
  }

  const single = convert(effectDescriptor);
  return single ? [single] : [];
}

function performDirectDamage({
  attacker,
  ability,
  target,
  baseDamage,
  session,
  logFn = () => {},
  opposingGroup = [],
  allowCritical = true,
  deferReactions = false,
  deliberateAction = null,
}) {
  if (!target || baseDamage <= 0) {
    return { damage: 0, absorbed: 0, critical: false };
  }

  const targeting = ability?.targeting || ability?.area;
  const isAoE = (targeting && String(targeting).toLowerCase().includes('all')) || targeting === 'enemies';
  if (!isAoE && targeting !== 'self' && opposingGroup.includes(target)
    && !getEligibleHostileUnits(opposingGroup).includes(target)) {
    logFn(`🛡️ ${target.name || 'Цель'} недоступна для направленной атаки из-за Невидимости или Защиты союзников.`);
    return { damage: 0, absorbed: 0, critical: false };
  }

  const damageType = resolveDamageType(ability, attacker, target);
  const magicSchool = resolveMagicSchool(ability, attacker, target, damageType);
  const bonuses = attacker?.relicBonuses?.[attacker?.activeRelicId] || {};
  const isHeroElemental = isElementalist(attacker) && !attacker?.summoned && [MAGIC_SCHOOLS.FIRE, MAGIC_SCHOOLS.ICE, MAGIC_SCHOOLS.LIGHTNING].includes(magicSchool) && !ability?.basic && !ability?.passive && !ability?.isSecondaryDamage;
  const equipmentCritBonus = getPathfinderHoodCritBonus(attacker) + getOathbreakerCritBonus(attacker) + (deliberateAction?.markedBowstringCritBonus || 0);
  const critChance = Math.max(0, (attacker?.critChance ?? DEFAULT_CRIT_CHANCE) + equipmentCritBonus +
    (ability?.artId === 'ruins_four_blades' ? Math.max(0, Math.min(3, deliberateAction?.ruinsHitIndex || 0)) * 0.10 : 0));
  let critDamageBonus = attacker?.critDamage ?? DEFAULT_CRIT_DAMAGE;
  const huntingMark = !isAoE && isArcherUnit(attacker) && !ability?.isSecondaryDamage
    ? (target.effects || []).find(effect => effect?.id === 'hunting_mark')
    : null;
  const usesHuntingMark = Boolean(
    huntingMark
    || deliberateAction?.huntingMarkCrit
    || deliberateAction?.redirectHuntingMarkCrit
  );

  let modifiedDamage = baseDamage;
  // Mines overseers empower OTHER allied workers based on each worker's missing HP.
  if (session?.state?.enemies?.includes(attacker) && attacker?.hp > 0) {
    const aura = (session.state.enemies || []).some(unit =>
      unit !== attacker && unit?.hp > 0 && !unit.passivesDisabled &&
      (unit.abilities || []).some(passive => passive?.minesOverseerAura));
    if (aura && attacker?.maxHp > 0)
      modifiedDamage *= 1 + 0.4 * Math.max(0, Math.min(1, 1 - attacker.hp / attacker.maxHp));
  }
  if (deliberateAction?.overheatDamageMultiplier && magicSchool === MAGIC_SCHOOLS.FIRE) {
    modifiedDamage *= deliberateAction.overheatDamageMultiplier;
  }
  if (attacker._retaliatoryActionMultiplier) modifiedDamage *= attacker._retaliatoryActionMultiplier;
  if (deliberateAction?.shadowBackstabMultiplier && !ability?.isSecondaryDamage) {
    modifiedDamage *= deliberateAction.shadowBackstabMultiplier;
  }
  let ignoreDefenseFraction = 0;
  let wasCritical = false;
  if (
    deliberateAction &&
    !ability?.isSecondaryDamage &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.BROKEN_FORMATION_BOW) &&
    deliberateAction.primaryTargetId === combatUnitId(target) &&
    (target.shield || 0) > 0 &&
    canUseEquipmentTurnFlag(attacker, 'brokenFormationBowShieldSteal')
  ) {
    const requested = Math.max(0, Math.min(
      Math.round((target.shield || 0) * 0.25),
      Math.round((attacker.maxHp || 0) * 0.15)
    ));
    const receivedMultiplier = Math.max(0, Number(attacker._shieldReceivedMultiplier ?? 1));
    if (requested > 0 && receivedMultiplier > 0) {
      const shieldBeforeSteal = Math.max(0, attacker.shield || 0);
      addEffect(
        attacker,
        { id: 'shield', duration: 2, value: requested / receivedMultiplier },
        logFn,
        attacker,
        { session, forceIndependentInstance: true }
      );
      const gained = Math.max(0, (attacker.shield || 0) - shieldBeforeSteal);
      if (gained > 0) {
        const stolen = Math.min(gained, Math.max(0, target.shield || 0));
        target.shield = Math.max(0, (target.shield || 0) - stolen);
        let remaining = stolen;
        (target.effects || []).forEach(effect => {
          if (remaining <= 0 || effect?.id !== 'shield') return;
          const applied = Math.max(0, effect.appliedShield ?? effect.value ?? 0);
          const used = Math.min(applied, remaining);
          effect.appliedShield = Math.max(0, applied - used);
          if (typeof effect.value === 'number') effect.value = Math.max(0, effect.value - used);
          if (Array.isArray(effect.extra?.shieldSources)) {
            let sourceUse = used;
            effect.extra.shieldSources.forEach(segment => {
              if (sourceUse <= 0 || !segment || segment.remaining <= 0) return;
              const segmentUse = Math.min(segment.remaining, sourceUse);
              segment.remaining -= segmentUse;
              sourceUse -= segmentUse;
              if (segment.remaining === 0) segment.consumedWithoutBreak = true;
            });
          }
          remaining -= used;
        });
        removeDepletedShieldEffects(target);
        logFn?.(`🏹 ${EQUIPMENT_EFFECTS.BROKEN_FORMATION_BOW} похищает ${stolen} Щита.`);
      }
    }
  }

  const targetHpBeforeDamage = target.hp;
  const targetShieldBeforeDamage = target.shield || 0;
  if (damageType === 'magical' && magicSchool && !ability?.isSecondaryDamage && !ability?.basic) {
    const threeSparks = consumeThreeSparksBonus(attacker, modifiedDamage, ability);
    modifiedDamage = threeSparks.damage;
    if (threeSparks.consumed) {
      logFn(`📿 ${EQUIPMENT_EFFECTS.THREE_SPARKS_AMULET} усиливает прямой магический удар.`);
    }
  }

  let naturalCritical;
  if (usesHuntingMark && deliberateAction?.huntingMarkCrit) {
    naturalCritical = deliberateAction.huntingMarkCrit.natural;
  } else if (allowCritical) {
    naturalCritical = combatRng(session)() < critChance;
  } else {
    naturalCritical = false;
  }
  if (deliberateAction?.redirectHuntingMarkCrit && !deliberateAction.huntingMarkCrit) {
    deliberateAction.huntingMarkCrit = { natural: naturalCritical };
  }
  if (huntingMark && deliberateAction && !deliberateAction.huntingMarkCrit) {
    deliberateAction.huntingMarkCrit = { natural: naturalCritical };
    cleanseEffects(target, effect => effect === huntingMark, logFn);
  }
  if (huntingMark && !deliberateAction) cleanseEffects(target, effect => effect === huntingMark, logFn);
  if (usesHuntingMark && naturalCritical) critDamageBonus += 0.5;
  if (allowCritical && (naturalCritical || usesHuntingMark)) {
    wasCritical = true;
    modifiedDamage = Math.max(0, Math.round(modifiedDamage * (1 + critDamageBonus)));
    ignoreDefenseFraction = Math.max(ignoreDefenseFraction, bonuses.ignoreDefenseFraction ?? 0);

    if (bonuses.healOnCrit) {
      const healed = applyHealing(attacker, bonuses.healOnCrit, { source: attacker, session });
      if (healed > 0) {
        logFn(`💚 ${attacker?.name || 'Боец'} восстанавливает ${healed} HP.`);
      }
    }

    if (bonuses.manaOnCrit) {
      attacker.mana = (attacker.mana ?? 0) + bonuses.manaOnCrit;
      logFn(`🔷 ${attacker?.name || 'Боец'} восстанавливает ${bonuses.manaOnCrit} маны.`);
    }
  }

  const targetWasBleeding = Array.isArray(target?.effects)
    && target.effects.some(effect => effect?.id === 'bleed');
  const targetWasPoisoned = Array.isArray(target?.effects)
    && target.effects.some(effect => effect?.id === 'poison');
  const targetIdForForestGear = combatUnitId(target);
  const forestTargetWasPoisoned = deliberateAction?.forestPoisonBeforeByTarget?.[targetIdForForestGear] ?? targetWasPoisoned;
  const forestTargetWasSlowed = deliberateAction?.forestSlowBeforeByTarget?.[targetIdForForestGear] ?? hasForestSlow(target);
  const scoutCloakMultiplier = getScoutCloakDirectMultiplier(target, deliberateAction);
  const tornRitualMultiplier = getTornRitualDamageMultiplier(target, attacker, deliberateAction, session, logFn);
  const eternalSentinelMultiplier = getEternalSentinelDamageMultiplier(target, deliberateAction);
  const prideSwordMultiplier = getPrideSwordDirectMultiplier(attacker, target, deliberateAction);
  const hpDamageMultiplier = typeof ability?.hpDamageMultiplier === 'function'
    ? ability.hpDamageMultiplier({ attacker, target, session, deliberateAction })
    : (ability?.hpDamageMultiplier ?? 1);
  if (deliberateAction && typeof ability?.iceShardDamageMultiplier === 'function') {
    deliberateAction.iceShardDamageMultiplier = Math.max(1, Number(ability.iceShardDamageMultiplier({ attacker, target, session })) || 1);
  } else if (deliberateAction && Number.isFinite(Number(ability?.iceShardDamageMultiplier))) {
    deliberateAction.iceShardDamageMultiplier = Math.max(1, Number(ability.iceShardDamageMultiplier));
  }
  const shieldPassiveMultiplier = !attacker?.passivesDisabled
    ? (attacker?.abilities || []).reduce((ratio, passive) =>
      passive?.passive && typeof passive.modifyShieldDamage === 'function'
        ? ratio * (Number(passive.modifyShieldDamage({ attacker, target, ability, session })) || 1)
        : ratio, 1)
    : 1;
  if (ability?.artId === 'ruins_four_blades' && !attacker.passivesDisabled &&
      getEffectStackCount(attacker, 'ruins_unrest') > 0) {
    ignoreDefenseFraction = Math.max(ignoreDefenseFraction, 0.3);
  }
  const dealt = applyDamage(target, modifiedDamage * scoutCloakMultiplier * tornRitualMultiplier * eternalSentinelMultiplier * prideSwordMultiplier, damageType, {
    source: attacker,
    logFn,
    session,
    ignoreDefenseFraction,
    magicSchool,
    directAttack: true,
    areaAttack: Boolean(isAoE),
    shieldDamageMultiplier: (ability?.shieldDamageMultiplier ?? 1) * shieldPassiveMultiplier,
    hpDamageMultiplier,
    deferReactions,
    deliberateAction,
    isSecondaryDamage: ability?.isSecondaryDamage === true,
  });
  const corruptionActualHpLost = Math.max(0, targetHpBeforeDamage - target.hp);
  if (
    corruptionActualHpLost > 0 && session?.state?.players?.[0] === attacker && !attacker.summoned &&
    deliberateAction && getDistortionTier(attacker) >= 1
  ) {
    consumeRefraction(attacker, target, damageType, deliberateAction, session, logFn);
  }
  if (
    corruptionActualHpLost > 0 && session?.state?.players?.[0] === attacker && !attacker.summoned &&
    deliberateAction
  ) {
    attacker._corruptionDirectHpDamageThisTurn = true;
    deliberateAction.corruptionDirectHpDamage = true;
    if (!deliberateAction.corruptionThirstGranted) {
      deliberateAction.corruptionThirstGranted = true;
      grantCorruptionThirst(attacker, session, logFn);
    }
    if (getCorruptionTier(attacker) >= 2 && getEffectStackCount(attacker, 'thirst') >= 3 && attacker.hp > 0) {
      const recovered = applyHealing(attacker, Math.round(corruptionActualHpLost * 0.05), {
        source: attacker, session, logFn, deliberateAction,
      });
      if (recovered > 0) logFn(`🩸 [Кровавый голод] восстанавливает ${recovered} HP.`);
    }
  }
  const connectedDirectHit = dealt + (target.lastAbsorbed || 0) > 0 || target._lastBlockedHitAction === deliberateAction;
  if (connectedDirectHit && session?.state?.enemies?.includes(attacker) && !attacker.passivesDisabled &&
      (attacker.abilities || []).some(passive => passive?.minesBullTempo) &&
      (attacker.effects || []).some(effect => effect?.id === 'speed_boost_minor' || effect?.id === 'speed_boost_major')) {
    target.turnMeter = Math.max(0, (target.turnMeter || 0) - 100);
  }
  if (connectedDirectHit) {
    applySmolderingVeinShieldRetaliation(
      target,
      attacker,
      deliberateAction,
      targetShieldBeforeDamage,
      session,
      logFn
    );
    registerLastInLineIncomingAction(target, attacker, deliberateAction, session, logFn);
    registerEternalSentinelIncomingAction(target, attacker, deliberateAction, session);
    triggerBlindingGoldAmulet(target, attacker, deliberateAction, session, logFn);
  }

  if (ability?.lifestealFromActualHp > 0 && attacker.hp > 0) {
    const actualHpLost = Math.max(0, targetHpBeforeDamage - target.hp);
    const recovered = applyHealing(attacker, Math.round(actualHpLost * ability.lifestealFromActualHp), {
      source: attacker, session, logFn,
    });
    if (recovered > 0 && typeof logFn === 'function') {
      logFn(`🩸 ${attacker.name || 'Атакующий'} восстанавливает ${recovered} HP.`);
    }
  }
  triggerPassiveDamageDealt(attacker, target, dealt, {
    session,
    logFn,
    context: {
      damageType,
      directAttack: true,
      fromEffect: null,
      ability,
      targetWasBleeding,
      targetWasPoisoned,
      deliberateAction,
    },
  });
  if (dealt > 0 && registerStretchedBowDirectTarget(attacker, target, deliberateAction, targetWasBleeding)) {
    logFn(`🏹 ${EQUIPMENT_EFFECTS.STRETCHED_HUNTING_BOW} заполняет шкалу хода на 15%.`);
  }
  if (isHeroElemental) {
    attacker._lastElementalSchool = magicSchool;
  }
  if (isArcherUnit(attacker) && hasEquippedClassPassive(attacker, 'finish_the_prey') && dealt > 0 && !target._finishThePreyTriggered && targetHpBeforeDamage > target.maxHp * 0.3 && target.hp <= target.maxHp * 0.3) {
    target._finishThePreyTriggered = true; attacker.turnMeter = Math.min(TURN_METER_THRESHOLD, (attacker.turnMeter || 0) + 150);
  }
  const absorbed = target.lastAbsorbed || 0;
  if (attacker?.name === 'Мастер клинков' && ability?.name === 'Точный выпад' && session?.state) {
    const metrics = (session.state.metrics ||= {});
    const shieldDestroyed = Math.max(0, targetShieldBeforeDamage - (target.shield || 0));
    const bonusShieldOnly = Math.max(0, shieldDestroyed - absorbed);
    metrics.preciseStrikeHits = (metrics.preciseStrikeHits || 0) + 1;
    metrics.preciseStrikeCalculatedDamage = (metrics.preciseStrikeCalculatedDamage || 0) + dealt + absorbed;
    metrics.preciseStrikeHpDamage = (metrics.preciseStrikeHpDamage || 0) + dealt;
    metrics.preciseStrikeShieldAbsorption = (metrics.preciseStrikeShieldAbsorption || 0) + absorbed;
    metrics.preciseStrikeBonusShieldOnlyDamage = (metrics.preciseStrikeBonusShieldOnlyDamage || 0) + bonusShieldOnly;
    if (targetShieldBeforeDamage > 0) {
      metrics.preciseStrikeHitsOnShield = (metrics.preciseStrikeHitsOnShield || 0) + 1;
      metrics.preciseStrikeShieldBeforeTotal = (metrics.preciseStrikeShieldBeforeTotal || 0) + targetShieldBeforeDamage;
      if ((target.shield || 0) === 0) metrics.preciseStrikeShieldsBroken = (metrics.preciseStrikeShieldsBroken || 0) + 1;
      if ((ability.shieldDamageMultiplier || 1) > 1 && Math.round((dealt + absorbed) * ability.shieldDamageMultiplier) > targetShieldBeforeDamage) metrics.preciseStrikePotentialOverflowCases = (metrics.preciseStrikePotentialOverflowCases || 0) + 1;
    }
    metrics.preciseStrikeActualOverflowCases = metrics.preciseStrikeActualOverflowCases || 0;
  }
  if (deliberateAction && (dealt > 0 || absorbed > 0)) {
    deliberateAction.successfulDirectHit = true;
    deliberateAction.successfulDirectTargets ||= [];
    if (!deliberateAction.successfulDirectTargets.includes(target)) deliberateAction.successfulDirectTargets.push(target);
    if (deliberateAction.overheatCharring && magicSchool === MAGIC_SCHOOLS.FIRE) {
      deliberateAction.overheatHitTargets ||= [];
      if (!deliberateAction.overheatHitTargets.includes(target)) deliberateAction.overheatHitTargets.push(target);
    }
    if (deliberateAction.elementalResonanceSchool && !ability?.noElementalResonance) {
      deliberateAction.elementalResonanceHitTargets ||= [];
      if (!deliberateAction.elementalResonanceHitTargets.includes(target)) deliberateAction.elementalResonanceHitTargets.push(target);
    }
    const preparedWeapon = (attacker?.effects || []).find(effect => effect?.id === 'prepared_weapon') || null;
    if (preparedWeapon && !deliberateAction.preparedWeaponConsumed) {
      deliberateAction.preparedWeaponConsumed = true;
      const payload = { ...(preparedWeapon.extra || {}) };
      cleanseEffects(attacker, effect => effect === preparedWeapon, logFn);
      if (target?.hp > 0 && payload.triggerEffect) {
        addEffect(target, { ...payload.triggerEffect }, logFn, attacker, { session });
        logFn(`🧪 ${payload.sourceItemName || 'Подготовленное оружие'} срабатывает на ${target.name}.`);
      }
    }
  }

  const shieldNote = absorbed > 0 ? ` (щит поглотил ${absorbed})` : '';
  if (wasCritical) {
    logFn(
      `💥 ${attacker?.name || 'Боец'} наносит критический удар "${ability?.name || 'Атака'}" по ${target.name} на ${dealt} урона${shieldNote}.`
    );
  } else {
    logFn(
      `🗡️ ${attacker?.name || 'Боец'} использует "${ability?.name || 'Атака'}" и наносит ${dealt} урона ${target.name}.${shieldNote}`
    );
  }

  if (wasCritical && bonuses.doubleCritChance && combatRng(session)() < bonuses.doubleCritChance) {
    const repeat = applyDamage(target, modifiedDamage, damageType, {
      source: attacker,
      logFn,
      session,
      ignoreDefenseFraction,
      magicSchool,
      shieldBeforeDefense: true,
    });
    logFn(`⚔️ ${attacker?.name || 'Боец'} проводит двойной критический удар по ${target.name} на ${repeat} урона!`);
  }

  if (wasCritical && bonuses.splashPercent > 0) {
    const splashTargets = opposingGroup.filter(unit => unit && unit !== target && unit.hp > 0);
    splashTargets.forEach(extraTarget => {
      const splashDamage = Math.max(0, Math.round(modifiedDamage * bonuses.splashPercent));
      if (splashDamage <= 0) return;
      const splashResult = applyDamage(extraTarget, splashDamage, damageType, {
        source: attacker,
        logFn,
        session,
        ignoreDefenseFraction,
        magicSchool,
      });
      if (splashResult > 0) {
        logFn(`🔥 Крит ${attacker?.name || 'Боец'} задевает ${extraTarget.name}, нанося ${splashResult} урона.`);
      }
    });
  }

  if (attacker?._stormOrder && !ability?.isSecondaryDamage && !ability?.passive && dealt + absorbed > 0 && target.hp > 0) {
    const order = attacker._stormOrder;
    attacker._stormOrder = null;
    performDirectDamage({
      attacker, target, session, logFn, opposingGroup, allowCritical: false, deliberateAction,
      ability: { name: 'Грозовой приказ', type: 'magical', school: MAGIC_SCHOOLS.LIGHTNING, isSecondaryDamage: true },
      baseDamage: order.damage || 0,
    });
  }
  const schoolState = damageType === 'magical' && magicSchool
    ? noteMagicSchoolUse(attacker, magicSchool, logFn)
    : { changed: false };
  if (
    schoolState.changed &&
    hasEquipped(attacker, EQUIPMENT_EFFECTS.SHIFTING_SPARK_RING) &&
    canUseEquipmentTurnFlag(attacker, 'shiftingSparkRingHeal')
  ) {
      healFromEquipment(attacker, 3, logFn, EQUIPMENT_EFFECTS.SHIFTING_SPARK_RING);
  }
  triggerEquipmentOnDirectDamage({
    attacker,
    target,
    dealt,
    absorbed,
    targetHpBeforeDamage,
    targetWasPoisoned: forestTargetWasPoisoned,
    targetWasSlowed: forestTargetWasSlowed,
    session,
    logFn,
    ability,
    damageType,
    magicSchool,
    critical: wasCritical,
    schoolChanged: schoolState.changed,
    deliberateAction,
  });
  triggerRuneOnHit(attacker, target, { session, logFn, ability, dealt });
  if (attacker?.name === 'Кристальный мертвострел — Искажение' && ability?.name === 'Преломлённый выстрел' && targetHpBeforeDamage > target.hp) {
    consumeRuinsDeadshotRefraction(attacker, target, session);
  }
  const hero = session?.state?.players?.[0];
  if (
    deliberateAction?.ruinsEchoEligible && session?.state?.enemies?.includes(attacker) && attacker._ruinsCaptureEcho
  ) {
    captureRuinsEchoDamage(deliberateAction, target, modifiedDamage);
  }
  if (
    getUndeathTier(hero) >= 4 && session?.state?.enemies?.includes(attacker) &&
    !attacker._undeathFirstActionEchoUsed && !deliberateAction?.preparation && deliberateAction
  ) {
    deliberateAction.ruinsEchoEligible = true;
    captureRuinsEchoDamage(deliberateAction, target, modifiedDamage);
    attacker._undeathEchoAction = { ability, deliberateAction };
  }
  return { damage: dealt, actualHpLost: Math.max(0, targetHpBeforeDamage - target.hp), absorbed, critical: wasCritical, targetHpBeforeDamage, rawDamage: modifiedDamage, shieldDestroyed: Math.max(0, targetShieldBeforeDamage - (target.shield || 0)) };
}

function triggerTargetedDirectMiss(target, attacker, session, logFn = () => {}) {
  (target?.abilities || []).forEach(passive => {
    const config = passive?.passive && passive.onTargetedDirectMiss;
    if (!config?.effect) return;
    addEffect(target, config.effect, logFn, target, { session });
    logFn(`🎭 ${target.name} использует «${passive.name}».`);
  });
}

function grantAttackActionRhythm(attacker, deliberateAction, session, logFn = () => {}) {
  if (!deliberateAction?.successfulDirectHit || deliberateAction.suppressRhythm) return;
  const passive = (attacker?.abilities || []).find(ability => ability?.passive && ability.attackRhythm);
  if (!passive) return;
  const maxStacks = passive.attackRhythm.maxStacks || 3;
  const existing = (attacker.effects || []).filter(effect => effect?.id === 'combat_rhythm');
  if (existing.length < maxStacks) addEffect(attacker, { id: 'combat_rhythm', duration: 999 }, logFn, attacker, { session });
  const stacks = Math.min(maxStacks, (attacker.effects || []).filter(effect => effect?.id === 'combat_rhythm').length);
  if (stacks >= maxStacks && passive.attackRhythm.startPreparation && !attacker._preparation) {
    cleanseEffects(attacker, effect => effect?.id === 'combat_rhythm', logFn);
    attacker._preparation = { ...passive.attackRhythm.startPreparation };
    session.state.metrics ||= {};
    session.state.metrics.bladePreparationsStarted = (session.state.metrics.bladePreparationsStarted || 0) + 1;
    logFn(`⚔️ ${attacker.name} начинает подготовку: ${attacker._preparation.resolveName}.`);
  }
}

function finalizeStormConductorTurn(session, logFn = () => {}) {
  const hero = session?.state?.players?.[0];
  if (!hero) return;
  const conductors = (session.state.enemies || []).filter(unit => unit?.hp > 0 && (unit.abilities || []).some(ability => ability?.passive && ability.stormConductor));
  if (!conductors.length) { hero._enemyTurnLightningPositive = false; return; }
  hero._stormConductorSequence = hero._enemyTurnLightningPositive ? (hero._stormConductorSequence || 0) + 1 : 0;
  if (hero._stormConductorSequence >= 3) {
    hero._stormConductorSequence = 0;
    addEffect(hero, { id: 'shock', duration: 1 }, logFn, conductors[0], { session });
    session.state.metrics ||= {};
    session.state.metrics.stormConductorProcs = (session.state.metrics.stormConductorProcs || 0) + 1;
    logFn('⚡ Проводник грозы замыкает последовательность из трёх ходов.');
  }
  hero._enemyTurnLightningPositive = false;
}

function isArcherUnit(unit) {
  return ARCHER_CLASS_NAMES.has(unit?.class) || ARCHER_CLASS_NAMES.has(unit?.displayClass) || ARCHER_CLASS_NAMES.has(unit?.name);
}

function shouldTriggerPiercingWounds({ attacker, ability, target, wasAoE, fromEffect }) {
  if (!isArcherUnit(attacker) || !target || fromEffect) return false;
  if (!ability || ability?.isSecondaryDamage || ability?.passive) return false;
  if (wasAoE) return false;
  const targetType = ability.targeting || ability.target || ability.targetType || 'enemy';
  if (targetType === 'allEnemies') return false;
  return true;
}

function formatDuplicateAwareUnitName(unit, group = []) {
  const name = unit?.name || 'цель';
  const matchingUnits = (group || []).filter(candidate => candidate?.name === name);
  if (matchingUnits.length <= 1) return name;
  const duplicateIndex = matchingUnits.findIndex(candidate => candidate === unit);
  return `${name} #${duplicateIndex >= 0 ? duplicateIndex + 1 : 1}`;
}

function triggerPiercingWounds({ attacker, ability, target, session, logFn = () => {}, hitResult, enemyGroup = [], wasAoE = false, fromEffect = null }) {
  if (!shouldTriggerPiercingWounds({ attacker, ability, target, wasAoE, fromEffect })) return;
  const overkill = target?.hp <= 0 ? Math.max(0, (hitResult?.damage ?? 0) - (hitResult?.targetHpBeforeDamage ?? 0)) : 0;
  if (overkill <= 0) return;
  const candidates = (enemyGroup || []).filter(unit => unit && unit !== target && unit.hp > 0);
  if (candidates.length === 0) return;
  const rng = typeof session?.rng === 'function' ? session.rng : Math.random;
  const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
  const spillTarget = candidates[Math.floor(roll * candidates.length)] || candidates[0];
  const spillDamageType = resolveDamageType(ability, attacker, target);
  const configuredMultiplier = typeof ability?.piercingWoundsMultiplier === 'function'
    ? ability.piercingWoundsMultiplier({ attacker, target, hitResult, session })
    : ability?.piercingWoundsMultiplier;
  const spillMultiplier = Math.max(0, Number(configuredMultiplier) || 1);
  const spillDamage = overkill * spillMultiplier;
  const dealt = applyDamage(spillTarget, spillDamage, spillDamageType, {
    source: attacker,
    logFn,
    session,
    fromEffect: 'piercing_wounds',
    sourceEffectId: 'piercing_wounds',
    bypassClassDamageMultiplier: true, // Already reduced in the original hit.
    directAttack: false,
  });
  if (dealt > 0 && typeof logFn === 'function') {
    const targetLabel = formatDuplicateAwareUnitName(spillTarget, enemyGroup);
    logFn(`🩸 Сквозные раны переносят ${dealt} избыточного урона на ${targetLabel}.`);
  }
}

function applyRelicBonusesToPlayer(player, playerData) {
  if (!player) return;
  const relicState = ensureRelicState(playerData?.relics);
  const activeId = relicState.activeRelicId;
  const activeLevel = relicState.progress?.[activeId]?.level ?? 0;
  const bonuses = activeLevel > 0 ? getRelicBonuses(activeId, activeLevel) : null;

  player.activeRelicId = activeId;

  player.critChance = player.critChance ?? playerData?.critChance ?? DEFAULT_CRIT_CHANCE;
  player.critDamage = player.critDamage ?? playerData?.critDamage ?? DEFAULT_CRIT_DAMAGE;

  if (!bonuses) {
    return;
  }

  player.relicBonuses = {
    ...(player.relicBonuses || {}),
    [activeId]: bonuses,
  };

  if (bonuses.critChanceBonus) {
    player.critChance += bonuses.critChanceBonus;
  }
  if (bonuses.critDamageBonus) {
    player.critDamage += bonuses.critDamageBonus;
  }
  if (bonuses.attackFlatBonus) {
    player.attack = (player.attack ?? 0) + bonuses.attackFlatBonus;
  }
}

function attachRunesToUnit(unit, equipment) {
  if (!unit) return;
  unit.activeRunes = getActiveSocketedRunes(equipment);
}

function applyCurseBonusesToPlayer(player, playerData) {
  if (!player || !playerData?.curses || Object.keys(playerData.curses).length === 0) {
    return null;
  }
  const modifiers = aggregateCurseModifiers(playerData.curses);
  if (!modifiers) return null;

  const applyPercent = (key, percent) => {
    if (!percent) return;
    const base = player[key] ?? 0;
    player[key] = Math.max(0, Math.round(base * (1 + percent)));
  };

  const applyFlat = (key, value) => {
    if (!value) return;
    player[key] = (player[key] ?? 0) + value;
  };

  applyPercent("attack", modifiers.attackPercent);
  applyFlat("attack", modifiers.attackFlat);
  applyPercent("magAtk", modifiers.magAtkPercent);
  applyFlat("magAtk", modifiers.magAtkFlat);
  applyPercent("physDef", modifiers.physDefPercent);
  applyPercent("magicDef", modifiers.magicDefPercent);
  applyPercent("speed", modifiers.speedPercent);

  if (modifiers.maxHpPercent) {
    const baseMaxHp = player.maxHp ?? player.baseStats?.maxHp ?? player.hp ?? 1;
    const delta = Math.round(baseMaxHp * modifiers.maxHpPercent);
    player.maxHp = Math.max(1, baseMaxHp + delta);
    player.hp = Math.min(player.maxHp, player.hp ?? player.maxHp);
  }

  if (modifiers.critChanceBonus) {
    player.critChance = (player.critChance ?? DEFAULT_CRIT_CHANCE) + modifiers.critChanceBonus;
  }

  if (modifiers.critDamageBonus) {
    player.critDamage = (player.critDamage ?? DEFAULT_CRIT_DAMAGE) + modifiers.critDamageBonus;
  }

  if (modifiers.dodgeBonus) {
    player.dodge = (player.dodge ?? 0) + modifiers.dodgeBonus;
  }

  if (modifiers.damageTakenPercent) {
    const base = player.statMultipliers?.damageTaken ?? 1;
    player.statMultipliers = {
      ...(player.statMultipliers || {}),
      damageTaken: base * (1 + modifiers.damageTakenPercent),
    };
  }

  player.curseNotes = modifiers.notes;
  return modifiers;
}

function initializeUndeathCombat(player) {
  const tier = getUndeathTier(player);
  player._undeathFirstEchoUsed = false;
  player._undeathEnemyEchoPrepared = false;
  player._undeathNonBasicCasts = 0;
  player._undeathDeathSaveConsumed = false;
  player._undeathLastEcho = null;
  delete player._pendingRuinsEcho;
  if (tier >= 4) {
    const baseMaxHp = Math.max(1, Number(player.maxHp) || 1);
    player.maxHp = Math.max(1, Math.round(baseMaxHp * 1.15));
    player.hp = Math.min(player.hp, player.maxHp);
  }
  syncUndeathLowHpPenalty(player);
}

export function triggerRuneOnHit(attacker, target, context = {}) {
  if (!attacker?.activeRunes || !target || target.hp <= 0) return;
  const targeting = context.ability?.targeting || context.ability?.target || 'enemy';
  if ((attacker.activeRunes.amulet || attacker.activeRunes.ring) === RUNE_IDS.ASTRAL_FOCUS && attacker._astralEchoAvailable && targeting !== 'allEnemies' && context.dealt > 0) {
    attacker._astralEchoAvailable = false;
    (context.session?.state?.enemies || []).filter(enemy => enemy !== target && enemy.hp > 0).forEach(enemy => {
      applyDamage(enemy, Math.max(1, Math.round(context.dealt * 0.28)), 'pure', { source: attacker, session: context.session, logFn: context.logFn, fromEffect: 'astral_echo', sourceEffectId: 'astral_echo' });
    });
  }
  const runeId = attacker.activeRunes.mainHand || attacker.activeRunes.weapon;
  if (runeId !== RUNE_IDS.FLAME_HEART) return;
  const actionKey = `${context.ability?.name || 'attack'}:${attacker.turnMeter ?? 0}`;
  if (attacker._flameRuneActionKey === actionKey) return;
  attacker._flameRuneActionKey = actionKey;
  attacker._flameRuneActions = (attacker._flameRuneActions || 0) + 1;
  if (attacker._flameRuneActions % 3 !== 0) return;
  const logFn = context.logFn || (() => {});
  addEffect(
    target,
    { id: EFFECT_IDS.burn, duration: 1 },
    text => logFn(text),
    attacker,
    { session: context.session }
  );
  logFn(`🔥 ${attacker?.name || 'Боец'} воспламеняет ${target.name} руной Пламенного сердца.`);
}

export function triggerRuneOnDamageTaken(target, context = {}) {
  if (!target?.activeRunes || !canUnitPerformReactiveAction(target)) return;
  const runeId = target.activeRunes.armor;
  if (runeId !== RUNE_IDS.STONE_VIGIL) return;
  if (!context.directAttack || context.fromEffect || !context.source || context.source === target || combatRng(context.session)() >= 0.2) return;
  const logFn = context.logFn || (() => {});
  const counterDamage = Math.max(1, Math.round((target.attack || target.baseAtk || 1) * 0.6));
  applyDamage(context.source, counterDamage, 'physical', { source: target, session: context.session, logFn, counterAttack: true, fromEffect: 'steel_rebuke', sourceEffectId: 'steel_rebuke' });
  logFn(`⚔️ Руна Стального Отпора позволяет ${target.name} контратаковать.`);
}

function applyRuneBattleStartEffects(session) {
  if (!session?.state) return;
  const player = session.state.players?.[0];
  if (!player?.activeRunes) return;
  const runeId = player.activeRunes.amulet || player.activeRunes.ring;
  if (runeId === RUNE_IDS.ASTRAL_FOCUS) player._astralEchoAvailable = true;
}

function abilityRequiresHitCheck(ability, baseDamage) {
  if (!ability) return baseDamage > 0;
  if (ability.alwaysHits) return false;
  if (ability.forceHitCheck) return true;
  const damageValue = typeof baseDamage === "number" ? baseDamage : 0;
  return damageValue > 0;
}

function determineHitOutcome(attacker, target, ability, session = null) {
  if (!target) {
    return { hit: false, chance: 0, reason: 'no_target' };
  }
  const accuracy = ability?.accuracy ?? 1;
  const targetHasEvasion = Array.isArray(target?.effects) && target.effects.some(effect => effect?.id === 'evasion');
  const attackerIsBlind = Array.isArray(attacker?.effects) && attacker.effects.some(effect => effect?.id === 'blind');
  const dodge = Math.max(target?.statAdditives?.dodgeBonus ?? 0, targetHasEvasion ? 0.3 : 0);
  const accuracyBonus = attacker?.statAdditives?.accuracyBonus ?? 0;
  const accuracyPenalty = Math.max(attacker?.statAdditives?.accuracyPenalty ?? 0, attackerIsBlind ? 0.3 : 0);
  let chance = accuracy + accuracyBonus - accuracyPenalty - dodge;
  chance = Math.max(0.05, Math.min(1, chance));
  const hit = combatRng(session)() < chance;
  let reason = 'accuracy';
  if (accuracyPenalty > 0) {
    reason = 'blind';
  } else if (dodge > 0) {
    reason = 'evasion';
  }
  return { hit, chance, reason };
}

function formatMissLog({ attacker, target, ability, hitInfo, context = 'ability', itemName = null }) {
  const attackerName = attacker?.name || 'Атакующий';
  const targetName = target?.name || 'цель';
  const chanceText = `${Math.round((hitInfo?.chance ?? 0) * 100)}%`;
  if (hitInfo?.reason === 'blind') {
    return `🛡️ ${attackerName} промахивается из-за Слепоты (${chanceText}).`;
  }
  if (hitInfo?.reason === 'evasion') {
    return `🛡️ ${targetName} уклоняется от атаки ${attackerName} (${chanceText}).`;
  }
  if (context === 'item') {
    return `🛡️ ${attackerName} промахивается по ${targetName} с ${itemName || 'предметом'} (${chanceText}).`;
  }
  if (context === 'enemyAbility') {
    return `🛡️ ${attackerName} промахивается способностью "${ability?.name || 'Атака'}" по ${targetName} (${chanceText}).`;
  }
  if (context === 'fallback') {
    return `🛡️ ${attackerName} промахивается атакой по ${targetName} (${chanceText}).`;
  }
  return `🛡️ ${attackerName} промахивается по ${targetName} (${chanceText}).`;
}

function applyEffectsToTargets(descriptors, options) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return;
  const {
    attacker,
    primaryTarget,
    opposingGroup = [],
    alliedGroup = [],
    logFn = () => {},
    session = null,
    magicalSource = false,
    deliberateAction = null,
  } = options;

  descriptors.forEach(descriptor => {
    if (!descriptor) return;
    const chance = descriptor.chance ?? descriptor.probability ?? 1;
    if (combatRng(session)() > chance) {
      return;
    }

    const scope = descriptor.target || descriptor.targeting || "target";
    const payload = { ...descriptor };
    delete payload.target;
    delete payload.targeting;
    delete payload.chance;
    delete payload.probability;

    let recipients = [];
    switch (scope) {
      case "self":
        recipients = attacker ? [attacker] : [];
        break;
      case "allEnemies":
        recipients = opposingGroup.filter(unit => unit && unit.hp > 0);
        break;
      case "otherEnemies":
        recipients = opposingGroup.filter(unit => unit && unit !== primaryTarget && unit.hp > 0);
        break;
      case "allAllies":
        recipients = alliedGroup.filter(unit => unit && unit.hp > 0);
        break;
      case "ally":
        recipients = primaryTarget && primaryTarget.hp > 0 ? [primaryTarget] : [];
        break;
      default:
        recipients = primaryTarget ? [primaryTarget] : [];
        break;
    }

    recipients.forEach(recipient => {
      const shieldBeforeEchoCapture = Math.max(0, Number(recipient?.shield) || 0);
      const { name, ...effectPayload } = payload;
      const resolvedId = effectPayload.id || effectPayload.name || name;
      const normalizedId = EFFECT_IDS[resolvedId] || resolvedId;
      const before = (recipient.effects || []).find(effect => effect?.id === normalizedId || effect?.name === resolvedId);
      const beforeTurns = before?.remainingTurns;
      const applied = addEffect(
        recipient,
        effectPayload,
        text => logFn(text),
        attacker,
        { session, deliberateAction, elementalistControlFallback: isElementalist(attacker) }
      );
      if (applied && deliberateAction?.ruinsEchoEligible) {
        captureRuinsEchoAppliedEffect(
          deliberateAction,
          recipient,
          applied,
          Math.max(0, (Number(recipient?.shield) || 0) - shieldBeforeEchoCapture)
        );
      }
      triggerEquipmentOnEffectApplied({
        attacker,
        recipient,
        effect: applied,
        beforeTurns,
        session,
        logFn,
        magicalSource,
        deliberateAction,
      });
    });
  });
}

function triggerPassiveDamageReactions(target, damage, options = {}) {
  if (!target?.abilities || target.passivesDisabled || damage <= 0) return;
  const { source = null, session = null, logFn = () => {}, context = null } = options;
  const logger = typeof logFn === 'function' ? logFn : () => {};
  target.abilities.forEach(ability => {
    if (!ability?.passive || typeof ability.onOwnerDamaged !== "function") return;
    try {
      ability.onOwnerDamaged({
        owner: target,
        damage,
        attacker: source,
        damageType: context?.damageType,
        session,
        log: text => logger(text),
        context,
      });
    } catch (err) {
      console.warn("Ошибка обработки пассивной реакции", ability.name, err);
    }
  });
}

function triggerPassiveDamageDealt(source, target, damage, options = {}) {
  if (!source?.abilities || source.passivesDisabled || damage <= 0) return;
  const { session = null, logFn = () => {}, context = null } = options;
  source.abilities.forEach(ability => {
    if (!ability?.passive || typeof ability.onDamageDealt !== "function") return;
    try {
      ability.onDamageDealt({
        owner: source,
        target,
        damage,
        damageType: context?.damageType,
        session,
        log: text => logFn(text),
        context,
      });
    } catch (err) {
      console.warn("Ошибка обработки пассивной реакции на нанесённый урон", ability.name, err);
    }
  });
}


export function triggerOnDeath(unit, killer = null, session = null, logFn = () => {}) {
  const logger = typeof logFn === 'function' ? logFn : () => {};
  if (!unit || unit.hp > 0 || unit._deathTriggered) return false;
  // Death and location mechanics are not passive abilities and must work while silenced.
  if (session?.state?.enemies?.includes(unit)) {
    queueRuinsDeath(unit, session);
    cleanupRuinsOwnerDeath(unit, session);
  }
  if (unit.passivesDisabled) {
    const enemies = session?.state?.enemies || [];
    const players = session?.state?.players || [];
    const allies = (enemies.includes(unit) ? enemies : players).filter(entry => entry && entry.hp > 0);
    notifyEffectOwnerDeath(unit, allies, {
      session,
      rng: typeof session?.rng === 'function' ? session.rng : Math.random,
      log: text => logger(text),
    });
    return false;
  }
  unit._deathTriggered = true;
  const abilities = Array.isArray(unit.abilities) ? unit.abilities : [];
  const enemies = session?.state?.enemies || [];
  const players = session?.state?.players || [];
  const unitIsEnemy = enemies.includes(unit);
  const hero = players[0];
  if (unitIsEnemy && !unit.summoned && !unit.nonActingCombatObject && getUndeathTier(hero) >= 2) {
    hero._undeathEnemyEchoPrepared = true;
  }
  const allies = (unitIsEnemy ? enemies : players).filter(entry => entry && entry.hp > 0);
  const opponents = (unitIsEnemy ? players : enemies).filter(entry => entry && entry.hp > 0);
  notifyEffectOwnerDeath(unit, allies, {
    session,
    rng: typeof session?.rng === 'function' ? session.rng : Math.random,
    log: text => logger(text),
  });
  abilities.forEach(ability => {
    if (!ability?.passive || typeof ability.onDeath !== 'function') return;
    try {
      ability.onDeath({
        owner: unit,
        killer,
        session,
        allies,
        opponents,
        log: text => logger(text),
      });
    } catch (err) {
      console.warn('Ошибка обработки onDeath пассива', ability.name, err);
    }
  });
  allies.forEach(ally => {
    if (ally === unit || ally.passivesDisabled) return;
    (ally.abilities || []).forEach(ability => {
      if (!ability?.passive || typeof ability.onAllyDeath !== 'function') return;
      try {
        ability.onAllyDeath({ owner: ally, ally: unit, killer, session, log: text => logger(text) });
      } catch (err) {
        console.warn('Ошибка обработки onAllyDeath пассива', ability.name, err);
      }
    });
  });
  return true;
}

function registerPassiveAbilities(unit, session) {
  if (!unit || unit.passivesInitialized || !Array.isArray(unit.abilities)) return;
  const state = session?.state;
  const logger = text => {
    if (state) {
      log(state, text);
    }
  };
  unit.abilities.forEach(ability => {
    if (!ability?.passive) return;
    if (typeof ability.onBattleStart === "function") {
      try {
        ability.onBattleStart({ owner: unit, session, log: logger });
      } catch (err) {
        console.warn("Ошибка инициализации пассивной способности", ability.name, err);
      }
    }
    if (ability.vampirismBonus) {
      unit.vampirismBonus = (unit.vampirismBonus ?? 0) + ability.vampirismBonus;
    }
  });
  unit.passivesInitialized = true;
}

function triggerPassiveTurnStart(unit, session, logFn = () => {}) {
  if (!unit?.abilities || unit.passivesDisabled) return;
  unit.abilities.forEach(ability => {
    if (!ability || typeof ability.onTurnStart !== "function") return;
    try {
      ability.onTurnStart({ owner: unit, session, ability, log: logFn });
    } catch (err) {
      console.warn("Ошибка обработки onTurnStart пассива", ability.name, err);
    }
  });
}

export function handleShieldBreak(target, options = {}) {
  if (!target || !Array.isArray(target.effects) || target.effects.length === 0) return;
  const { attacker = null, session = null, logFn: suppliedLogFn = null, deliberateAction = null, directAttack = false, fromEffect = null } = options;
  // A healing-curse inversion can break a shield with no combat logger supplied.
  // Log callbacks are optional; avoid crashing equipment/passive shield-break reactions.
  const logFn = typeof suppliedLogFn === 'function' ? suppliedLogFn : () => {};
  const enemies = session?.state?.enemies || [];
  const players = session?.state?.players || [];
  const isEnemy = enemies.includes(target);
  const opponents = (isEnemy ? players : enemies).filter(unit => unit && unit.hp > 0);
  const allies = (isEnemy ? enemies : players).filter(unit => unit && unit.hp > 0);

  allies.forEach(owner => {
    if (owner === target || owner.passivesDisabled) return;
    (owner.abilities || []).forEach(ability => {
      if (!ability?.passive || typeof ability.onAllyShieldBreak !== 'function' || !canUnitPerformReactiveAction(owner)) return;
      ability.onAllyShieldBreak({
        owner, target, attacker, session, actionToken: deliberateAction,
        eligiblePlayerAction: Boolean(isEnemy && players.includes(attacker) && deliberateAction && directAttack && !fromEffect),
        log: text => logFn(text),
        retaliate: (counterattacker, multiplier = 1) => {
          const counterTarget = players.find(unit => unit && unit.hp > 0);
          if (!counterTarget || counterattacker.hp <= 0) return;
          const damage = Math.max(1, Math.round((counterattacker.attack ?? 1) * multiplier));
          const dealt = applyDamage(counterTarget, damage, 'physical', {
            source: counterattacker, session, logFn, directAttack: false, counterAttack: true, fromEffect: 'boneguard_retaliation',
          });
          logFn(`🦴 ${counterattacker.name} карает ${counterTarget.name} ответным ударом на ${dealt} урона.`);
        },
      });
    });
  });

  if (hasEquipped(target, EQUIPMENT_EFFECTS.THIRD_PATCH_SHIELD)) {
    const flags = ensureEquipmentBattleFlags(target);
    if (!flags.thirdPatchBlockGranted) {
      flags.thirdPatchBlockGranted = true;
      addEffect(target, { id: 'block', stacks: 1 }, logFn, target, { session });
      logFn('🛡️ ' + EQUIPMENT_EFFECTS.THIRD_PATCH_SHIELD + ' подготавливает Блок.');
    }
  }

  if (hasEquipped(target, EQUIPMENT_EFFECTS.CLINGING_ROOTS_SHIELD)) {
    const flags = ensureEquipmentBattleFlags(target);
    const attackerIsOpponent = attacker && attacker !== target && (
      (players.includes(target) && enemies.includes(attacker)) ||
      (enemies.includes(target) && players.includes(attacker))
    );
    if (!flags.clingingRootsTriggered && attackerIsOpponent) {
      flags.clingingRootsTriggered = true;
      if (attacker.hp > 0) addEffect(attacker, { id: 'entanglement', stacks: 3 }, logFn, target, { session });
      addEffect(target, { id: 'regeneration', duration: 1 }, logFn, target, { session });
      logFn('🌿 ' + EQUIPMENT_EFFECTS.CLINGING_ROOTS_SHIELD + ' отвечает корнями на разрушение Щита.');
    }
  }

  if (hasEquipped(target, EQUIPMENT_EFFECTS.WANDERING_SPORE_CROWN) && !target._sporeCrownCooldown) {
    addEffect(target, { id: EFFECT_IDS.regeneration, duration: 1 }, logFn, target, { session });
    target._sporeCrownCooldown = 3;
  }

  target.effects.forEach(effect => {
    if (!effect || effect.id !== "shield" || effect.breakTriggered || !effect.onBreak) return;
    effect.breakTriggered = true;
    const hook = effect.onBreak;
    const logger = text => {
      if (typeof logFn === "function") logFn(text);
    };

    if (typeof hook === "function") {
      try {
        hook({ owner: target, attacker, session, log: logger });
      } catch (err) {
        console.warn("Ошибка пользовательского onBreak щита", err);
      }
      return;
    }

    const baseSource = hook.source === "attacker" ? attacker || target : target;
    const scope = hook.target || "enemies";
    let recipients = [];
    if (scope === "self") {
      recipients = [target];
    } else if (scope === "allies") {
      recipients = allies;
    } else {
      recipients = opponents;
    }

    recipients.forEach(recipient => {
      let damageValue = 0;
      if (typeof hook.damage === "function") {
        try {
          damageValue = hook.damage({ owner: target, attacker: baseSource, recipient });
        } catch (err) {
          console.warn("Ошибка расчёта урона взрыва щита", err);
          damageValue = 0;
        }
      } else if (typeof hook.damage === "number") {
        damageValue = hook.damage;
      } else if (typeof hook.damageMultiplier === "number") {
        const sourceAttack = baseSource?.attack ?? baseSource?.magAtk ?? 0;
        damageValue = Math.round(Math.max(0, sourceAttack * hook.damageMultiplier));
      }

      if (damageValue > 0) {
        const damageType = hook.type || "magical";
        const school = hook.school || null;
        const dealt = applyDamage(recipient, damageValue, damageType, {
          source: baseSource,
          logFn: logger,
          session,
          magicSchool: school,
        });
        const absorbed = recipient.lastAbsorbed || 0;
        const shieldNote = absorbed > 0 ? ` (щит поглотил ${absorbed})` : "";
        logger(
          `💥 Щит ${target.name || 'цели'} взрывается и наносит ${dealt} урона ${recipient.name}.${shieldNote}`
        );
      }

      const breakEffects = resolveAbilityEffect(hook.effects, {
        attacker: baseSource,
        target: recipient,
        primary: recipient,
        targets: [recipient],
      });
      applyEffectsToTargets(breakEffects, {
        attacker: baseSource,
        primaryTarget: recipient,
        opposingGroup: opponents,
        alliedGroup: allies,
        logFn: logger,
        session,
      });
    });
  });
}

// === Инициализация боя ===
export const MAX_ACTIVE_ENEMIES = 6;

function getEnemyAbilityTargetCandidates(ability, enemy, session) {
  if (!session?.state) {
    return { candidates: [], targeting: 'enemy' };
  }

  const s = session.state;
  const targeting = ability?.targeting || ability?.target || ability?.targetType || 'enemy';
  const alivePlayers = (s.players || []).filter(unit => unit && unit.hp > 0);
  const aliveEnemies = (s.enemies || []).filter(unit => unit && unit.hp > 0);

  if (targeting === 'self') {
    return { candidates: [enemy], targeting };
  }

  if (targeting === 'ally' || targeting === 'allAllies') {
    return { candidates: aliveEnemies.length > 0 ? aliveEnemies : [enemy], targeting };
  }

  if (targeting === 'allEnemies') {
    return { candidates: alivePlayers, targeting };
  }

  return { candidates: getEligibleHostileUnits(alivePlayers), targeting };
}

function scoreEnemyDecision(callback, context, label) {
  if (typeof callback !== 'function') return 0;
  try {
    const score = callback(context);
    return Number.isFinite(score) ? score : 0;
  } catch (err) {
    console.warn(`Ошибка оценки ${label}`, context?.ability?.name, err);
    return 0;
  }
}

function chooseEnemyAbilityTarget(ability, enemy, session) {
  const { candidates, targeting } = getEnemyAbilityTargetCandidates(ability, enemy, session);
  if (candidates.length === 0) return null;
  const allies = (session.state.enemies || []).filter(unit => unit && unit.hp > 0);
  const opponents = (session.state.players || []).filter(unit => unit && unit.hp > 0);
  const baseContext = {
    attacker: enemy,
    actor: enemy,
    ability,
    session,
    allies,
    opponents,
    candidateTargets: candidates,
    target: candidates[0] || null,
  };

  if (typeof ability.canUse === 'function') {
    try {
      if (!ability.canUse(baseContext)) return null;
    } catch (err) {
      console.warn('Ошибка проверки доступности способности', ability.name, err);
      return null;
    }
  }

  let primary = candidates[0] || null;
  if (targeting !== 'self' && targeting !== 'allEnemies' && targeting !== 'allAllies' && typeof ability.targetScore === 'function') {
    let bestScore = scoreEnemyDecision(ability.targetScore, { ...baseContext, target: primary }, 'цели способности');
    candidates.slice(1).forEach(candidate => {
      const score = scoreEnemyDecision(ability.targetScore, { ...baseContext, target: candidate }, 'цели способности');
      if (score > bestScore) {
        bestScore = score;
        primary = candidate;
      }
    });
  }

  const targets = targeting === 'allEnemies' || targeting === 'allAllies'
    ? candidates
    : primary ? [primary] : [];
  const context = { ...baseContext, target: primary, selectedTarget: primary, targets };
  return {
    ability,
    targets,
    primary,
    targeting,
    score: scoreEnemyDecision(ability.aiScore, context, 'приоритета способности'),
  };
}

export function selectEnemyAction(enemy, session) {
  if (!enemy || !session?.state) return null;
  const provoked = (enemy.effects || []).some(effect => effect?.id === 'provoked' && (effect.remainingTurns ?? effect.duration ?? 0) > 0);
  if (provoked) {
    const basic = (enemy.abilities || []).find(ability => ability.basic || ability.name === 'Атака');
    if (basic && (basic.currentCooldown ?? 0) <= 0) return chooseEnemyAbilityTarget(basic, enemy, session);
  }
  let selected = null;
  for (const ability of enemy.abilities || []) {
    if (ability.passive) continue;
    if (ability.currentCooldown > 0) continue;
    if (enemy.silenced && !ability.basic) continue;
    const decision = chooseEnemyAbilityTarget(ability, enemy, session);
    if (!decision) continue;
    if (!selected || decision.score > selected.score) selected = decision;
  }
  return selected;
}

function resolveAbility(ability, fallbackDamage = 10) {
  if (typeof ability === "string") {
    return {
      ...createAbilityByName(ability, fallbackDamage),
      currentCooldown: 0,
    };
  }

  const resolved = ability ? { ...ability } : {};
  const damage =
    typeof resolved.damage === "number" || typeof resolved.damage === "function"
      ? resolved.damage
      : fallbackDamage;

  return {
    ...resolved,
    name: resolved.name || "Атака",
    damage,
    cooldown: resolved.cooldown ?? 2,
    type: resolved.type || "physical",
    currentCooldown: 0,
  };
}

function hydrateEnemy(enemyData, index, customId) {
  if (!enemyData) return null;
  const attackValue = enemyData.attack ?? enemyData.baseAtk ?? 6;
  const abilityTemplates = enemyData.abilities
    ? enemyData.abilities
    : (enemyData.abilityNames || []).map(name => createAbilityByName(name, attackValue));

  const resolvedAbilities = abilityTemplates.map(ab => resolveAbility(ab, attackValue));

  const templateId = enemyData.templateId || enemyData.id || enemyData.name || `enemy-template-${index}`;
  const combatInstanceId = customId || enemyData.combatInstanceId || `enemy-${index}`;
  const hydrated = {
    ...enemyData,
    templateId,
    id: combatInstanceId,
    combatInstanceId,
    name: enemyData.name || "Враг",
    hp: enemyData.hp ?? enemyData.maxHp ?? 50,
    maxHp: enemyData.maxHp ?? enemyData.hp ?? 50,
    attack: attackValue,
    baseAtk: attackValue,
    physDef: enemyData.physDef || enemyData.basePhysDef || 0,
    magicDef: enemyData.magicDef || enemyData.baseMagicDef || 0,
    magAtk: enemyData.magAtk || 0,
    speed: enemyData.speed ?? 100,
    critChance: enemyData.critChance ?? enemyData.baseStats?.critChance ?? DEFAULT_CRIT_CHANCE,
    critDamage: enemyData.critDamage ?? enemyData.baseStats?.critDamage ?? DEFAULT_CRIT_DAMAGE,
    mana: enemyData.mana ?? 0,
    maxMana: enemyData.maxMana ?? enemyData.mana ?? 0,
    abilities: resolvedAbilities,
    effects: [],
    shield: 0,
    turnMeter: enemyData.turnMeter ?? 0,
    _startingTurnMeterApplied: Boolean(enemyData._startingTurnMeterApplied),
  };

  prepareEffectTracking(hydrated);
  if (enemyData.startsInvisible) {
    addEffect(hydrated, { id: 'invisibility', duration: 999 }, () => {}, hydrated);
  }
  return hydrated;
}

function createSummonHelper(session) {
  return (enemyName, options = {}) => {
    const blueprint = createEnemyInstanceByName(enemyName, { rng: combatRng(session), idPrefix: 'combat-blueprint' });
    if (!blueprint) {
      return { success: false, reason: "not_found" };
    }

    const { enemies } = session.state;
    const aliveCount = enemies.filter(enemy => enemy.hp > 0).length;
    if (aliveCount >= MAX_ACTIVE_ENEMIES) {
      return { success: false, reason: "no_slot" };
    }

    session._summonSequence = (session._summonSequence || 0) + 1;
    const uniqueId = `summon-${enemyName}-${session._summonSequence}-${Math.floor(combatRng(session)() * 1000)}`;
    // ownerId is serializable and never uses a mutable board position.
    const hydrated = hydrateEnemy({
      ...blueprint, summoned: true, ownerId: options.source?.id ?? blueprint.ownerId ?? null,
    }, enemies.length, uniqueId);
    if (!hydrated) {
      return { success: false, reason: "invalid" };
    }
    registerPassiveAbilities(hydrated, session);

    const emptyIndex = enemies.findIndex(enemy => enemy.hp <= 0);
    const rosterIndex = emptyIndex >= 0 ? emptyIndex : enemies.length;
    if (emptyIndex >= 0) {
      enemies[emptyIndex] = hydrated;
    } else {
      enemies.push(hydrated);
    }

    if (session?.state) {
      log(session.state, `${options.source?.name || 'Союзник'} призывает ${hydrated.name}`);
    }
    recordCombatPresentationEvent(session, {
      type: "summon",
      actor: options.source || null,
      target: hydrated,
      side: "enemy",
      summonedUnitId: hydrated.id,
      rosterIndex,
    });

    return { success: true, enemy: hydrated };
  };
}


function cloneSummonTemplateValue(value, depth = 0) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function' || depth > 5) return undefined;
  if (Array.isArray(value)) {
    return value
      .map(entry => cloneSummonTemplateValue(entry, depth + 1))
      .filter(entry => entry !== undefined);
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const result = {};
  Object.entries(value).forEach(([key, entry]) => {
    const cloned = cloneSummonTemplateValue(entry, depth + 1);
    if (cloned !== undefined) result[key] = cloned;
  });
  return result;
}

const SUMMON_TEMPLATE_RUNTIME_KEYS = new Set([
  'id', 'combatInstanceId', 'hp', 'shield', 'effects', 'turnMeter', 'abilities',
  'currentCooldown', 'passivesInitialized', 'owner',
]);

function createUnitSummonTemplate(unit, options = {}) {
  if (!unit) return null;
  const snapshot = {};
  Object.entries(unit).forEach(([key, value]) => {
    if (SUMMON_TEMPLATE_RUNTIME_KEYS.has(key) || key.startsWith('_')) return;
    const cloned = cloneSummonTemplateValue(value);
    if (cloned !== undefined) snapshot[key] = cloned;
  });
  snapshot.summoned = true;
  return {
    form: 'unit',
    snapshot,
    abilityNames: (unit.abilities || []).map(ability => ability?.presetKey || ability?.name).filter(Boolean),
    startingTurnMeter: Math.max(0, Number(options.startingTurnMeter ?? unit.turnMeter) || 0),
    durationTurns: Number.isFinite(options.durationTurns)
      ? Math.max(1, Math.round(options.durationTurns))
      : null,
    spawnEffects: cloneSummonTemplateValue(options.spawnEffects || []) || [],
  };
}

function attachUnitSummonTemplate(unit, options = {}) {
  const template = createUnitSummonTemplate(unit, options);
  if (!template) return unit;
  unit._summonTemplate = template;
  if (unit.temporarySummon) unit._temporarySummonTemplate = template;
  return unit;
}

function applySummonSpawnEffects(ally, session, template, logFn = () => {}) {
  (template?.spawnEffects || []).forEach(entry => {
    if (!entry?.effect) return;
    const targets = entry.target === 'allEnemies'
      ? (session?.state?.enemies || []).filter(unit => unit?.hp > 0)
      : entry.target === 'owner'
        ? [(session?.state?.players || []).find(unit => unit?.id === ally.summonerId)].filter(Boolean)
        : entry.target === 'summon'
          ? [ally]
          : [];
    targets.forEach(target => {
      const effect = cloneSummonTemplateValue(entry.effect) || {};
      effect.extra = { ...(effect.extra || {}) };
      if (entry.linkSummonIdToExtra) effect.extra[entry.linkSummonIdToExtra] = ally.id;
      addEffect(target, effect, logFn, ally, { session });
    });
  });
}

function restoreSummonFromTemplate(owner, session, template, options = {}) {
  if (!owner || !session?.state || !template) return { success: false, reason: 'invalid_template' };

  if (template.form === 'owner_slot') {
    const slot = template.slot;
    if (!slot || owner[slot]) return { success: false, reason: 'occupied' };
    const payload = cloneSummonTemplateValue(template.payload) || {};
    owner[slot] = {
      ...payload,
      lastEchoCopy: Boolean(options.lastEchoCopy),
      _summonTemplate: template,
    };
    recordCombatPresentationEvent(session, {
      type: 'temporaryEntitySpawn',
      actor: owner,
      entityId: payload.type || payload.kind || slot,
    });
    return { success: true, summon: owner[slot] };
  }

  if (template.form !== 'unit') return { success: false, reason: 'unsupported_template' };
  const players = session.state.players || [];
  if (players.filter(unit => unit?.hp > 0).length >= 3) return { success: false, reason: 'no_slot' };

  session._friendlySummonCopySequence = (session._friendlySummonCopySequence || 0) + 1;
  const snapshot = cloneSummonTemplateValue(template.snapshot) || {};
  const maxHp = Math.max(1, Math.round(Number(snapshot.maxHp ?? snapshot.baseStats?.maxHp) || 1));
  const attack = Math.max(0, Math.round(Number(snapshot.attack ?? snapshot.baseStats?.attack) || 0));
  const ally = {
    ...snapshot,
    id: `summon-copy-${session._friendlySummonCopySequence}`,
    summoned: true,
    summonerId: owner.id,
    hp: maxHp,
    maxHp,
    shield: 0,
    effects: [],
    turnMeter: Math.max(0, Number(template.startingTurnMeter) || 0),
    abilities: (template.abilityNames || []).map(name => resolveAbility(createAbilityByName(name), attack)),
    _lastEchoCopy: Boolean(options.lastEchoCopy),
    _summonTemplate: template,
  };
  if (Number.isFinite(template.durationTurns)) {
    ally.temporarySummon = true;
    ally._temporaryOwnTurnsRemaining = Math.max(1, Math.round(template.durationTurns));
    ally._temporarySummonTemplate = template;
  }

  prepareEffectTracking(ally);
  registerPassiveAbilities(ally, session);
  players.push(ally);
  applySummonSpawnEffects(ally, session, template, options.logFn || (() => {}));
  recordCombatPresentationEvent(session, {
    type: 'summon',
    actor: owner,
    target: ally,
    side: 'ally',
    summonedUnitId: ally.id,
    rosterIndex: players.length - 1,
  });
  return { success: true, ally };
}

export function createRoyalExecutioner(owner, options = {}) {
  const templateStats = options?.template?.stats || null;
  const maxHp = Math.max(1, Math.round(templateStats?.maxHp ?? ((owner?.maxHp || 1) * 0.5)));
  const attack = Math.max(0, Math.round(templateStats?.attack ?? Math.max(owner?.attack || 0, owner?.magAtk || 0)));
  const physDef = Math.max(0, Math.round(templateStats?.physDef ?? ((owner?.physDef || 0) * 0.75)));
  const magicDef = Math.max(0, Math.round(templateStats?.magicDef ?? ((owner?.magicDef || 0) * 0.75)));
  const speed = 120;
  const id = options.id || `royal-executioner-${Date.now()}`;
  const stats = { maxHp, attack, physDef, magicDef, speed };
  const ally = {
    id,
    name: 'Королевский палач',
    class: 'RoyalExecutioner',
    summonKind: 'royal_executioner',
    summoned: true,
    temporarySummon: true,
    summonerId: owner?.id || null,
    allyPortraitKey: 'summons/royal_executioner',
    hp: maxHp,
    maxHp,
    attack,
    magAtk: 0,
    physDef,
    magicDef,
    speed,
    baseStats: { ...stats, magAtk: 0 },
    primaryMagicSchool: MAGIC_SCHOOLS.DEATH,
    abilities: [resolveAbility(createAbilityByName('Приказ Королей'), 0)],
    effects: [],
    shield: 0,
    turnMeter: 500,
    _temporaryOwnTurnsRemaining: 2,
    _lastEchoCopy: Boolean(options.lastEchoCopy),
  };
  attachUnitSummonTemplate(ally, {
    durationTurns: 2,
    startingTurnMeter: 500,
    spawnEffects: [{
      target: 'allEnemies',
      effect: { id: 'provoked', duration: 1, extra: { source: 'will_of_allking' } },
      linkSummonIdToExtra: 'defenderId',
    }],
  });
  return ally;
}

function summonRoyalExecutioner(session, owner, options = {}) {
  if (!session?.state || !owner || owner.hp <= 0) return { success: false, reason: 'invalid' };
  const players = session.state.players || [];
  const existing = players.find(unit => unit?.hp > 0 && unit?.summonKind === 'royal_executioner');
  if (existing && !options.allowAlongsideExisting) return { success: false, reason: 'already_active', ally: existing };
  if (players.filter(unit => unit?.hp > 0).length >= 3) return { success: false, reason: 'no_slot' };

  session._royalExecutionerSequence = (session._royalExecutionerSequence || 0) + 1;
  const ally = createRoyalExecutioner(owner, {
    ...options,
    id: options.id || `royal-executioner-${session._royalExecutionerSequence}`,
  });
  prepareEffectTracking(ally);
  registerPassiveAbilities(ally, session);
  players.push(ally);

  (session.state.enemies || []).filter(enemy => enemy?.hp > 0).forEach(enemy => {
    addEffect(enemy, {
      id: 'provoked',
      duration: 1,
      extra: { defenderId: ally.id, source: 'will_of_allking' },
    }, text => log(session.state, text), ally, { session });
  });

  recordCombatPresentationEvent(session, {
    type: 'summon',
    actor: owner,
    target: ally,
    side: 'ally',
    summonedUnitId: ally.id,
    rosterIndex: players.length - 1,
  });
  log(session.state, `👑 ${owner.name || 'Герой'} призывает Королевского палача.`);
  return { success: true, ally };
}

function activateBurnedMemoryStaff(session, player, targetIndex = 0) {
  if (!player || !hasEquipped(player, EQUIPMENT_EFFECTS.BURNED_MEMORY_STAFF)) {
    return { success: false, reason: 'not_equipped' };
  }
  if ((player._burnedMemoryStaffCooldown || 0) > 0) {
    return { success: false, reason: 'cooldown' };
  }
  const stored = Math.max(0, Math.round(Number(player._burnedMemoryStoredDamage) || 0));
  if (stored <= 0) return { success: false, reason: 'empty' };

  const enemies = session?.state?.enemies || [];
  const requested = enemies[targetIndex];
  const target = requested?.hp > 0 ? requested : enemies.find(unit => unit?.hp > 0);
  if (!target) return { success: false, reason: 'no_target' };

  const cap = Math.max(0, Math.round((player.magAtk || 0) * 2));
  const amount = Math.min(stored, cap);
  if (amount <= 0) return { success: false, reason: 'empty' };

  const dealt = applyDamage(target, amount, 'magical', {
    source: player,
    session,
    logFn: text => log(session.state, text),
    magicSchool: MAGIC_SCHOOLS.LIGHT,
    directAttack: false,
    fromEffect: 'burned_memory_staff',
    sourceEffectId: 'burned_memory_staff',
  });
  player._burnedMemoryStoredDamage = 0;
  player._burnedMemoryStaffCooldown = 3;
  log(session.state, `☀️ ${EQUIPMENT_EFFECTS.BURNED_MEMORY_STAFF}: «Вспомнить свет» высвобождает ${amount} накопленного урона${dealt !== amount ? ` (${dealt} после защиты)` : ''}.`);
  return { success: true, target, amount, dealt };
}

function activateAllkingSignet(session, player) {
  if (!player || !hasEquipped(player, EQUIPMENT_EFFECTS.ALLKING_SIGNET)) {
    return { success: false, reason: 'not_equipped' };
  }
  if ((player._allkingSignetCooldown || 0) > 0) {
    return { success: false, reason: 'cooldown' };
  }
  if ((session?.state?.players || []).some(unit => unit?.hp > 0 && unit?.summonKind === 'royal_executioner')) {
    return { success: false, reason: 'already_active' };
  }
  const result = summonRoyalExecutioner(session, player);
  if (result.success) player._allkingSignetCooldown = 4;
  return result;
}

// The burial seal creates a temporary *basic attacker*, not a class summon.
// Its magical attack is based on the owner's stronger current attack stat.
function summonBurialSealSoul(session, owner, activator) {
  const allies = session?.state?.players || [];
  if (!session?.state || !owner?.hp || allies.filter(unit => unit?.hp > 0).length >= 3) {
    return { success: false, reason: 'no_slot' };
  }
  session._burialSealSequence = (session._burialSealSequence || 0) + 1;
  const magAtk = Math.max(0, Math.round(Math.max(Number(owner.attack) || 0, Number(owner.magAtk) || 0)));
  const soul = {
    id: `burial-seal-soul-${session._burialSealSequence}`,
    name: 'Погребённая душа',
    class: 'FieldTrapSummon',
    summonKind: 'burial_seal_soul',
    summoned: true,
    temporarySummon: true,
    summonerId: owner.id || null,
    hp: 150, maxHp: 150,
    attack: 0, magAtk,
    physDef: 12, magicDef: 12,
    speed: 100, turnMeter: 750,
    baseAttack: 0, baseMagAtk: magAtk,
    basicAttackProfile: 'magical',
    primaryMagicSchool: MAGIC_SCHOOLS.DEATH,
    baseStats: { maxHp: 150, attack: 0, magAtk, physDef: 12, magicDef: 12, speed: 100 },
    abilities: [resolveAbility(createAbilityByName('Атака', 0), 0)],
    effects: [], shield: 0,
    _temporaryOwnTurnsRemaining: 2,
    _burialSealFocusTargetId: activator?.id ?? activator?.combatInstanceId ?? null,
    _burialSealFocusTargetName: activator?.name ?? null,
  };
  attachUnitSummonTemplate(soul, { durationTurns: 2, startingTurnMeter: 750 });
  prepareEffectTracking(soul);
  registerPassiveAbilities(soul, session);
  allies.push(soul);
  recordCombatPresentationEvent(session, {
    type: 'summon', actor: owner, target: soul, side: 'ally',
    summonedUnitId: soul.id, rosterIndex: allies.length - 1,
  });
  log(session.state, `🕯️ Погребальная печать призывает душу (МА ${magAtk}) на два хода.`);
  return { success: true, ally: soul };
}

export function createFireElemental(owner, options = {}) {
  const base = owner?.baseStats || owner || {};
  const greater = options.variant === 'greater_fire';
  const lightning = options.variant === 'lightning';
  const ice = options.variant === 'ice';
  const stat = (key, fraction) => Math.max(key === 'maxHp' ? 1 : 0, Math.round((base[key] ?? owner?.[key] ?? 0) * fraction));
  const maxHp = stat('maxHp', ice ? 0.7 : greater ? 0.6 : 0.5);
  const attack = stat('attack', 0.2);
  const magAtk = stat('magAtk', greater ? 0.75 : lightning ? 0.65 : ice ? 0.55 : 0.6);
  const physDef = stat('physDef', ice ? 0.8 : 0.5);
  const magicDef = stat('magicDef', ice ? 0.8 : 0.6);
  const speed = stat('speed', lightning ? 1.05 : ice ? 0.75 : 0.9);
  const abilityKeys = lightning
    ? ['Разряд молниевого элементаля', 'Грозовой импульс', 'Последний импульс']
    : ice
      ? ['Ледяной снаряд', 'Морозная хватка', 'Ледяное наследие']
      : greater
        ? ['Огненный сгусток', 'Разжечь великого элементаля', 'Великое пылающее ядро']
        : ['Огненный сгусток', 'Разжечь', 'Пылающее ядро'];
  const ally = {
    id: options.id || `${lightning ? 'lightning' : ice ? 'ice' : 'fire'}-elemental-${Date.now()}`,
    name: lightning ? 'Молниевый элементаль' : ice ? 'Ледяной элементаль' : greater ? 'Великий огненный элементаль' : 'Огненный элементаль',
    class: 'ElementalistSummon',
    summonKind: lightning ? 'lightning_elemental' : ice ? 'ice_elemental' : 'fire_elemental',
    summonVariant: lightning ? 'lightning' : ice ? 'ice' : greater ? 'greater_fire' : 'base_fire',
    elementalistElemental: true,
    summoned: true,
    summonerId: owner?.id || null,
    allyPortraitKey: lightning
      ? 'summons/elementalist/lightning_elemental'
      : ice
        ? 'summons/elementalist/ice_elemental'
        : 'summons/elementalist/fire_elemental',
    hp: maxHp,
    maxHp,
    attack,
    magAtk,
    physDef,
    magicDef,
    speed,
    baseStats: { maxHp, attack, magAtk, physDef, magicDef, speed },
    primaryMagicSchool: lightning ? MAGIC_SCHOOLS.LIGHTNING : ice ? MAGIC_SCHOOLS.ICE : MAGIC_SCHOOLS.FIRE,
    abilities: abilityKeys.map(name => resolveAbility(createAbilityByName(name), 0)),
    effects: [],
    shield: 0,
    turnMeter: 500,
  };
  attachUnitSummonTemplate(ally, { startingTurnMeter: 500 });
  return ally;
}
function createPlayerSummonHelper(session) {
  return (kind, { source, variant = null } = {}) => {
    if (kind !== 'fire_elemental') return { success: false, reason: 'not_found' };
    const players = session.state.players || [];
    if (players.filter(unit => unit?.hp > 0).length >= 3 || players.some(unit => unit?.elementalistElemental && unit.hp > 0)) return { success: false, reason: 'no_slot' };
    session.state.elementalSequence = (session.state.elementalSequence || 0) + 1;
    const ally = createFireElemental(source || players[0], { variant, id: `elemental-${session.state.elementalSequence}` });
    prepareEffectTracking(ally); registerPassiveAbilities(ally, session); players.push(ally);
    recordCombatPresentationEvent(session, { type: 'summon', actor: source, target: ally, side: 'ally', summonedUnitId: ally.id, rosterIndex: players.length - 1 });
    return { success: true, ally };
  };
}

function createTurnState() {
  return { started: false, itemUsed: false, cooldownsProcessed: false, defeated: false, stunned: false };
}

function ensureInitiativeState(session) {
  if (!session?.state) return { playerReady: false };
  const s = session.state;
  if (!s.initiative) {
    s.initiative = { playerReady: false, nextActorType: null };
  }
  const player = s.players?.[0];
  if (player && typeof player.turnMeter !== "number") {
    player.turnMeter = 0;
  }
  (s.enemies || []).forEach(enemy => {
    if (!enemy || enemy.nonActingCombatObject) return;
    if (typeof enemy.turnMeter !== "number") enemy.turnMeter = 0;
    if (!enemy._startingTurnMeterApplied) {
      enemy.turnMeter += Math.max(0, Number(enemy.startingTurnMeterBonus) || 0);
      enemy._startingTurnMeterApplied = true;
    }
  });
  return s.initiative;
}

export function getEffectiveSpeed(unit, session = null) {
  if (!unit) return 0;
  const base = typeof unit.speed === "number" ? unit.speed
    : unit.baseStats?.speed != null ? unit.baseStats.speed : unit.baseSpeed ?? 0;
  const location = session?.state?.encounterReward?.location || session?.location;
  const poisoned = (unit.effects || []).some(effect => effect?.id === EFFECT_IDS['Отравление'] || effect?.id === 'poison');
  const locationMultiplier = location === 'Грибные Пещеры' && poisoned ? 0.85 : 1;
  const bloodPressureMultiplier = 1 + getBloodPressureSpeedBonus(unit, session?.state?.enemies || []);
  return applyEntanglementSpeed(Math.max(0, Math.round(base * locationMultiplier * bloodPressureMultiplier)), unit);
}

function collectActingUnits(session) {
  if (!session?.state) return [];
  const units = [];
  (session.state.players || []).forEach((player, index) => {
    if (player && player.hp > 0) units.push({ type: index === 0 ? 'player' : 'ally', unit: player, index });
  });
  (session.state.enemies || []).forEach((enemy, index) => {
    if (enemy && enemy.hp > 0 && !enemy.nonActingCombatObject && !enemy.nonActingSummon) {
      units.push({ type: "enemy", unit: enemy, index });
    }
  });
  return units;
}

function incrementTurnMeters(units, session) {
  let progressed = false;
  units.forEach(entry => {
    const unit = entry.unit;
    if (!unit) return;
    const increment = Math.max(1, getEffectiveSpeed(unit, session));
    if (increment <= 0) return;
    unit.turnMeter = (unit.turnMeter ?? 0) + increment;
    progressed = true;
  });
  if (!progressed) {
    units.forEach(entry => {
      if (!entry.unit) return;
      entry.unit.turnMeter = TURN_METER_THRESHOLD;
    });
  }
}

function popNextActor(session) {
  const outcome = evaluateBattleStatus(session);
  if (outcome.victory || outcome.defeat) return null;
  const initiative = ensureInitiativeState(session);
  const units = collectActingUnits(session);
  if (units.length === 0) {
    initiative.nextActorType = null;
    initiative.playerReady = false;
    return null;
  }

  let actor = units.find(entry => (entry.unit.turnMeter ?? 0) >= TURN_METER_THRESHOLD);
  let iterations = 0;
  while (!actor && iterations < TURN_METER_MAX_ITERATIONS) {
    incrementTurnMeters(units, session);
    actor = units.find(entry => (entry.unit.turnMeter ?? 0) >= TURN_METER_THRESHOLD);
    iterations += 1;
  }

  if (!actor) {
    actor = units[0];
    actor.unit.turnMeter = TURN_METER_THRESHOLD;
  }

  actor.unit.turnMeter = Math.max(0, (actor.unit.turnMeter ?? 0) - TURN_METER_THRESHOLD);
  markCombatTurnStarted(session, actor.unit, text => log(session.state, text), true);
  initiative.nextActorType = actor.type;
  if (actor.type === "player") {
    initiative.playerReady = true;
  } else {
    initiative.playerReady = false;
  }
  return actor;
}

function getTurnControl(session) {
  if (!session?.state) return createTurnState();
  if (!session.state.turnState) {
    session.state.turnState = createTurnState();
  }
  return session.state.turnState;
}

function resetTurnControl(session) {
  if (!session?.state) return;
  session.state.turnState = createTurnState();
}

function finalizeElementalCharge(source, ability, school, deliberateAction, session, logFn) {
  if (!source || source.hp <= 0 || !isElementalist(source) || source.summoned || !ELEMENTAL_CHARGE_IDS[school]) return;
  // A rejected summon must never grant a charge.
  if ((ability.artId === 'elemental' || ability.name === 'Призыв элементаля') &&
      !deliberateAction.elementalSummonSucceeded) return;
  const id = ELEMENTAL_CHARGE_IDS[school];
  const count = getEffectStackCount(source, id) + 1;
  if (count < ELEMENTAL_CHARGE_THRESHOLD) {
    setEffectStackCount(source, id, count);
    recordCombatPresentationEvent(session, { type: 'statusApplied', actor: source, target: source, effectId: id, label: getEffectDefinition(id).name });
    logFn(`✨ ${getEffectDefinition(id).name}: ${count}/${ELEMENTAL_CHARGE_THRESHOLD}.`);
    return;
  }
  setEffectStackCount(source, id, 0);
  source._elementalChargeTriggers ||= { fire: 0, ice: 0, lightning: 0 };
  source._elementalChargeTriggers[school] += 1;
  recordCombatPresentationEvent(session, { type: 'statusTriggered', actor: source, target: source, effectId: id, label: getEffectDefinition(id).name });
  if (school === 'fire') {
    logFn('🔥 Заряд Огня: стихийный взрыв!');
    for (const target of (session.state.enemies || []).filter(unit => unit.hp > 0)) {
      if (source.hp <= 0) break;
      applyDamage(target, Math.round(source.magAtk * 0.75), 'magical', {
        source, session, logFn, magicSchool: 'fire', directAttack: false,
        fromEffect: 'elemental_charge_fire', sourceEffectId: id, deliberateAction,
      });
    }
  } else if (school === 'ice') {
    addEffect(source, { id: 'shield', duration: 2, value: Math.round(source.maxHp * 0.2) }, logFn, source,
      { session, deliberateAction, forceIndependentInstance: true });
    logFn('❄ Заряд Льда: Щит на 20% максимального здоровья на 2 хода.');
  } else {
    const before = source.turnMeter || 0;
    source.turnMeter = Math.min(TURN_METER_THRESHOLD, before + 300);
    session.notifyPositiveTempoChange?.(source, source.turnMeter - before, { source: id, trigger: 'elemental_charge', natural: false });
    logFn('⚡ Заряд Молнии: +30% шкалы хода.');
  }
  if (source.hp > 0 && hasEquippedClassPassive(source, 'elemental_shell')) {
    addEffect(source, { id: 'shield', duration: 2, value: Math.round(source.maxHp * 0.1) }, logFn, source,
      { session, deliberateAction, forceIndependentInstance: true });
    logFn('🛡️ Стихийная оболочка: дополнительный Щит на 10% максимального здоровья.');
  }
}

export function initCombatSession(playerData, enemiesData, options = {}) {
  const { expeditionMap, ...combatPlayerData } = playerData;
  const baseAttack = playerData.attack ?? playerData.baseAtk ?? 10;
  const effectiveMaxHp = playerData.maxHp || 100;
  const effectivePhysDef = playerData.physDef || 0;
  const effectiveMagicDef = playerData.magicDef || 0;
  const effectiveMagAtk = playerData.magAtk || 0;
  const effectiveSpeed = playerData.speed ?? playerData.stats?.speed ?? 100;
  const suppliedPlayerAbilities =
    playerData.abilities && playerData.abilities.length > 0
      ? playerData.abilities
      : [createAbilityByName("Атака", baseAttack)];
  const passivePlayerAbilities = (playerData.equippedClassPassiveIds || [])
    .map(id => createAbilityByName(id, baseAttack))
    .filter(ability => ability?.passive);
  const suppliedPassiveIds = new Set(suppliedPlayerAbilities.filter(ability => ability?.passive).map(ability => ability.id || ability.name));
  const playerAbilities = [...suppliedPlayerAbilities, ...passivePlayerAbilities.filter(ability => !suppliedPassiveIds.has(ability.id || ability.name))];

  const rawItems = playerData.runInventory
    ? slotsToLegacyInventory(playerData.runInventory)
    : playerData.items || playerData.inventory || [];
  const combatItems = rawItems
    .map(item => (typeof item === "string" ? { name: item } : { ...item }))
    .filter(item => {
      const def = getItemDefinition(item.name);
      return Boolean(def);
    });

  const player = {
    ...combatPlayerData,
    preparedTrap: null, // Traps are deployed with an action inside this battle.
    name: playerData.name || "Безымянный",
    hp: playerData.hp ?? effectiveMaxHp,
    maxHp: effectiveMaxHp,
    attack: baseAttack,
    physDef: effectivePhysDef,
    magicDef: effectiveMagicDef,
    magAtk: effectiveMagAtk,
    speed: effectiveSpeed,
    baseStats: {
      ...(playerData.baseStats || {}),
      maxHp: effectiveMaxHp,
      attack: baseAttack,
      magAtk: effectiveMagAtk,
      physDef: effectivePhysDef,
      magicDef: effectiveMagicDef,
      speed: effectiveSpeed,
    },
    critChance: playerData.critChance ?? playerData.baseStats?.critChance ?? DEFAULT_CRIT_CHANCE,
    critDamage: playerData.critDamage ?? playerData.baseStats?.critDamage ?? DEFAULT_CRIT_DAMAGE,
    dodge: playerData.dodge ?? playerData.baseStats?.dodge ?? 0,
    mana: playerData.mana ?? 0,
    maxMana: playerData.maxMana ?? playerData.mana ?? 0,
    abilities: playerAbilities.map(ab => resolveAbility(ab, baseAttack)),
    items: combatItems,
    effects: [],
    shield: 0,
    turnMeter: 0,
    _elementalChargeTriggers: { fire: 0, ice: 0, lightning: 0 },
    _equipmentBattleFlags: {},
    _equipmentTurnFlags: {},
    _refraction: 0,
    _distortionEnhancedHitReady: false,
    _distortionDeathSaveConsumed: false,
    _distortionSaveChainActive: false,
    _dynamicStatSteps: {},
    equippedClassPassiveIds: [...(playerData.equippedClassPassiveIds || [])],
  };
  const offHand = playerData?.equipment?.offHand;
  const offHandName = typeof offHand === 'string' ? offHand : offHand?.itemId || offHand?.name;
  player._hasPhysicalShield = (equipmentByName[offHandName] || getItemDefinition(offHandName))?.type === 'Shield';
  attachRunesToUnit(player, playerData?.equipment);
  prepareEffectTracking(player);
  applyRelicBonusesToPlayer(player, playerData);
  const recruitSeal = player.relicBonuses?.[DEFAULT_RELIC_ID];
  if (player.activeRelicId === DEFAULT_RELIC_ID && recruitSeal?.startTurnMeter) {
    player.turnMeter = Math.min(TURN_METER_THRESHOLD, Math.round(TURN_METER_THRESHOLD * recruitSeal.startTurnMeter));
    player._recruitSealMetrics = { startTriggers: 1, consumableTriggers: 0, firstConsumableTriggers: 0, preservedConsumables: 0 };
  }
  const curseModifiers = applyCurseBonusesToPlayer(player, playerData);
  initializeUndeathCombat(player);
  const tarotPreCombatEffects = getTarotPreCombatEffects(
    playerData.tarotSpread,
    player,
    { ignoreTarot: playerData.ignoreTarot }
  );
  const pendingEffects = [
    ...(Array.isArray(playerData.preCombatEffects) ? playerData.preCombatEffects : []),
    ...tarotPreCombatEffects,
    ...(curseModifiers?.preCombatEffects || []),
  ];
  if (pendingEffects.length > 0) {
    pendingEffects.forEach(effect => {
      try {
        addEffect(player, effect, () => {}, player);
      } catch (err) {
        console.warn("Не удалось применить предбоевой эффект", effect, err);
      }
    });
    player.preCombatEffects = [];
  }

  const enemies = enemiesData
    .map((enemy, index) => hydrateEnemy(enemy, index))
    .filter(Boolean);

  enemies.forEach(prepareEffectTracking);

  const encounterLocation = determineEncounterLocation(playerData, enemiesData);

  const session = {
    state: {
      players: [player],
      enemies,
      encounterReward: {
        location: encounterLocation,
        roster: createEncounterRewardRoster(enemiesData),
        expeditionZone: playerData?.activeExpeditionZone || null,
        sublocationId: playerData?.activeSublocationId || null,
        resolvedLoot: null,
      },
      log: ["Бой начался!"],
      turnState: { started: false, itemUsed: false },
    },
    location: encounterLocation,
    alertLevel: Math.max(0, ...enemiesData.map(enemy => Number(enemy?.encounterAlertLevel) || 0)),
    ...(typeof options.rng === 'function' ? { rng: options.rng } : {}),
  };
  const simulationPoisonMultiplier = [...(session.state.players || []), ...(session.state.enemies || [])]
    .map(unit => Number(unit?._simulationPoisonDamageMultiplier))
    .find(value => Number.isFinite(value) && value !== 1);
  if (simulationPoisonMultiplier) session._simulationPoisonDamageMultiplier = simulationPoisonMultiplier;
  session.onChargeDischarge = ({ source, deliberateAction = null } = {}) =>
    triggerLightningSpeedFromChargeDischarge(source, session, deliberateAction, text => log(session.state, text));
  session.summonEnemy = createSummonHelper(session);
  session.spawnEnemyCombatObject = ({ owner, name, triggerDamageMultiplier = 0.7, triggerEffect = null } = {}) => {
    if (!owner || !name) return null;
    const existing = session.state.enemies.find(unit => unit?.nonActingCombatObject && unit.hp > 0 && unit.ownerId === owner.id && unit.name === name);
    if (existing) return existing;
    session.state.combatObjectSequence = (session.state.combatObjectSequence || 0) + 1;
    const object = hydrateEnemy({
      name, hp: 1, maxHp: 1, attack: 0, speed: 0, abilities: [], nonActingCombatObject: true,
      nonBlocking: true, ownerId: owner.id, sourceAttack: owner.attack, triggerDamageMultiplier, triggerEffect,
      encounterAlertLevel: session.alertLevel,
    }, session.state.enemies.length, `object-${owner.id}-${session.state.combatObjectSequence}`);
    object.turnMeter = null;
    session.state.enemies.push(object);
    session.state.metrics ||= {};
    session.state.metrics.snaresSpawned = (session.state.metrics.snaresSpawned || 0) + 1;
    return object;
  };
  session.summonPlayer = createPlayerSummonHelper(session);
  session.applyIndirectDamage = (target, amount, type, extra = {}) => applyDamage(target, amount, type, { ...extra, session, logFn: extra.logFn || (text => log(session.state, text)), directAttack: false, fromEffect: extra.fromEffect || 'summon_passive' });
  session.notifyPositiveTempoChange = (target, gained, meta = {}) => {
    const adjusted = applyRuinsFrostbiteTempoReduction(target, gained, meta);
    return handleForestTempoSignal(target, adjusted, meta, session);
  };
  session.onPoisonTick = payload => handleForestPoisonTick(payload, session);
  session.onPoisonEnded = payload => handleForestPoisonEnded(payload, session);
  session.onRegenerationTick = payload => handleForestRegenerationTick(payload, session);
  session.onEntanglementAdded = payload => handleEntanglementApplication(payload, session);
  initializeDecayCombat(session);
  installMinesCombatHooks(session);
  registerPassiveAbilities(player, session);
  enemies.forEach(enemy => registerPassiveAbilities(enemy, session));
  applyRuneBattleStartEffects(session);
  applyLocationEffect(session, encounterLocation);
  applySublocationBattleStartEffect(session, playerData?.activeSublocationEffectId || null);
  applyTarotBattleStartEffects(session, playerData);
  applyForestEquipmentBattleStartEffects(session, text => log(session.state, text));
  initializeWitheringCombat(session, text => log(session.state, text));
  initRuinsBattle(session);
  if (hasEquipped(player, EQUIPMENT_EFFECTS.TWO_VOICES_STAFF)) {
    setEffectStackCount(player, RUINS_ECHO_CHARGE_ID, getEffectStackCount(player, RUINS_ECHO_CHARGE_ID) + 1);
    log(session.state, `◈ ${EQUIPMENT_EFFECTS.TWO_VOICES_STAFF} даёт 1 заряд Эха.`);
  }
  ensureInitiativeState(session);
  return session;
}

// === Перезарядки ===
function tickCooldowns(unit) {
  unit.abilities?.forEach(ab => {
    if (ab.currentCooldown > 0) {
      ab.currentCooldown = Math.max(0, ab.currentCooldown - 1);
    }
  });
}

export function completeEntanglementTurn(unit, logFn = () => {}, session = null) {
  const epoch = unit?._effectTurnActive ? unit._effectTurnEpoch : null;
  const before = getEntanglementStacks(unit);
  const remaining = advanceEntanglementDecayAtTurnEnd(unit, epoch);
  const context = session ? {
    session,
    applyDamage: (target, amount, type, extra = {}) =>
      applyDamage(target, amount, type, { ...extra, session, logFn }),
    applyHealing: (target, amount) => applyHealing(target, amount, { session }),
    getAllies: () => (session.state.players || []).includes(unit) ? session.state.players : session.state.enemies,
    getOpponents: () => (session.state.players || []).includes(unit) ? session.state.enemies : session.state.players,
  } : {};
  if (
    session?.state?.players?.[0] === unit && getCorruptionTier(unit) >= 3 &&
    !unit._corruptionDirectHpDamageThisTurn && unit.hp > 0
  ) {
    addEffect(unit, { id: 'bleed', duration: 1 }, logFn, unit, { session });
    logFn(`🩸 [Открытая рана] накладывает на ${unit.name || 'героя'} [Кровотечение].`);
  }
  finishEffectTurn(unit, logFn, context);
  if (session?.state?.players?.[0] === unit) unit._corruptionIncomingThirstAvailable = true;
  if (session?.state?.players?.[0] === unit && getDistortionTier(unit) >= 2) {
    unit._distortionEnhancedHitReady = true;
  }
  if (session?.state?.players?.[0] === unit) {
    if (unit._decayForgetfulnessSetThisTurn) unit._decayForgetfulnessSetThisTurn = false;
    else unit._decayForgetfulnessCooldown = Math.max(0, (unit._decayForgetfulnessCooldown || 0) - 1);
    if (unit._decaySearingMarkSetThisTurn) unit._decaySearingMarkSetThisTurn = false;
    else unit._decaySearingMarkCooldown = Math.max(0, (unit._decaySearingMarkCooldown || 0) - 1);
  }
  if (remaining < before && typeof logFn === 'function') {
    logFn(`🌿 ${unit.name || 'Цель'} теряет один заряд Опутывания.`);
  }
  if (unit?._undeathEchoAction && session?.state?.enemies?.includes(unit) && !unit._undeathFirstActionEchoUsed) {
    const { ability, deliberateAction } = unit._undeathEchoAction;
    const snapshot = deliberateAction?.ruinsEchoSnapshot;
    if (ruinsEchoHasPayload(snapshot)) {
      unit._pendingRuinsEcho = {
        abilityName: ability?.name || deliberateAction.ability || 'Действие',
        ...cloneEchoSnapshot(snapshot), efficiency: ECHO_BASE_EFFICIENCY,
        source: 'undeath_enemy_first', heroOwned: false, suppressRecursion: true,
      };
      unit._undeathFirstActionEchoUsed = true;
    }
    delete unit._undeathEchoAction;
  }
  advanceForestSentinelMaskCooldownsForTarget(unit, session);
  registerCompletedCombatTurn(session, unit, logFn);
  return remaining;
}

function performEnemyBasicAttackFallback({ enemy, target, session, playerGroup = [], logFn = () => {} }) {
  if (!enemy || enemy.hp <= 0 || !target || target.hp <= 0) return { acted: false, returnShotArcher: null };
  const basicAbility = { name: "Атака", accuracy: 1, basic: true };
  let currentTarget = target;
  let baseDamage = enemy.attack;
  const redirect = consumeArcherRedirect(enemy, currentTarget, basicAbility, baseDamage, session, logFn);
  const returnShotArcher = redirect.returnShot ? redirect.archer : null;
  if (redirect.dodged) return { acted: true, returnShotArcher };
  if (redirect.target !== currentTarget) {
    currentTarget = redirect.target;
    baseDamage = enemy.attack;
  }
  recordCombatPresentationEvent(session, { type: "actionStart", actor: enemy, action: basicAbility });
  logFn(`⚔️ ${enemy.name} не находит подходящей особой способности и атакует напрямую.`);
  const deliberateAction = { actorId: enemy.id, ability: basicAbility.name };
  beginInvisibleAttack(enemy, basicAbility, deliberateAction, logFn);
  const hitInfo = determineHitOutcome(enemy, currentTarget, basicAbility, session);
  if (!hitInfo.hit) {
    if (isArcherUnit(currentTarget) && hasEquippedClassPassive(currentTarget, 'false_trail')) {
      currentTarget._falseTrailReady = true;
    }
    logFn(formatMissLog({ attacker: enemy, target: currentTarget, ability: basicAbility, hitInfo, context: 'fallback' }));
    if (playerGroup.includes(currentTarget)) registerDefenderEnemyAttackAction(currentTarget, enemy);
    return { acted: true, returnShotArcher };
  }
  applyArcherRedirectHuntingMark(redirect, currentTarget, deliberateAction, logFn);
  performDirectDamage({
    attacker: enemy,
    ability: basicAbility,
    target: currentTarget,
    baseDamage,
    session,
    logFn,
    opposingGroup: playerGroup.includes(currentTarget)
      ? playerGroup
      : (session.state.enemies || []).filter(unit => unit && unit !== enemy && unit.hp > 0),
    allowCritical: true,
    deliberateAction,
  });
  if (playerGroup.includes(currentTarget)) registerDefenderEnemyAttackAction(currentTarget, enemy);
  return { acted: true, returnShotArcher };
}

function resolveEnemyPreparation(enemy, session, logFn = () => {}) {
  const preparation = enemy?._preparation;
  if (!preparation) return false;
  if (preparation.kind === 'bloom_archon_burial') {
    enemy._preparation = null;
    const target = (session.state.players || []).find(unit => unit?.hp > 0 && unit.id === preparation.targetId);
    if (!target) {
      logFn(`🌑 ${enemy.name} теряет цель Погребения в корнях; подготовленный удар отменён.`);
      return true;
    }
    const stacks = getEffectStackCount(target, 'entanglement');
    const multiplier = stacks >= 5 ? 2.8 : stacks >= 3 ? 2.3 : 1.8;
    const ability = {
      name: 'Погребение в корнях', type: 'physical', targeting: 'enemy',
      accuracy: preparation.accuracy ?? 1, preparationResolution: true, noAttackActionTriggers: true,
    };
    const deliberateAction = { actorId: enemy.id, preparation: preparation.kind, sequence: enemy._turnSerial };
    beginInvisibleAttack(enemy, ability, deliberateAction, logFn);
    const hitInfo = determineHitOutcome(enemy, target, ability, session);
    if (!hitInfo.hit) {
      logFn(formatMissLog({ attacker: enemy, target, ability, hitInfo, context: 'enemyPreparation' }));
      triggerTargetedDirectMiss(target, enemy, session, logFn);
      return true;
    }
    performDirectDamage({
      attacker: enemy, ability, target, baseDamage: (enemy.attack || 0) * multiplier,
      session, logFn, opposingGroup: session.state.players || [], allowCritical: true, deliberateAction,
    });
    if (deliberateAction.successfulDirectHit && stacks >= 3) {
      consumeEffectStacks(target, 'entanglement', 2);
      addEffect(target, { id: 'vulnerability', duration: 2 }, logFn, enemy, { session });
      if (stacks >= 5) addEffect(target, { id: 'stun', duration: 1 }, logFn, enemy, { session });
    }
    logFn(`🌑 ${enemy.name} обрушивает Погребение в корнях на ${target.name}.`);
    return true;
  }
  const target = preparation.target?.hp > 0
    ? preparation.target
    : (session.state.players || []).find(unit => unit?.hp > 0);
  enemy._preparation = null;
  if (!target) return false;
  if (preparation.kind === 'resonant_discharge') {
    resolveResonantDischarge(enemy, target, session, logFn);
    return true;
  }
  let multiplier = preparation.damageMultiplier ?? 0;
  if (preparation.bonusDamageMultiplier && (target.effects || []).some(effect => (
    effect?.appliedSerial > (preparation.negativeEffectSerial || 0) && effect?.sourceId && effect.sourceId !== enemy.id
  ))) multiplier = preparation.bonusDamageMultiplier;
  const ability = {
    name: preparation.resolveName || preparation.name || 'Подготовленный удар',
    type: preparation.type || 'physical', school: preparation.school || null,
    preparationResolution: true, noAttackActionTriggers: true,
  };
  const hits = Math.max(1, preparation.hits || 1);
  const deliberateAction = { actorId: enemy.id, preparation: preparation.kind, sequence: enemy._turnSerial };
  if (multiplier > 0) beginInvisibleAttack(enemy, ability, deliberateAction, logFn);
  for (let index = 0; index < hits && target.hp > 0; index += 1) {
    performDirectDamage({
      attacker: enemy, ability, target, baseDamage: (enemy.attack || 0) * multiplier,
      session, logFn, opposingGroup: session.state.players || [], allowCritical: true,
      deliberateAction,
    });
  }
  session.state.metrics ||= {};
  if (preparation.kind === 'blade_dance') session.state.metrics.bladePreparationsResolved = (session.state.metrics.bladePreparationsResolved || 0) + 1;
  logFn(`⚔️ ${enemy.name} завершает ${ability.name}.`);
  return true;
}

export function resolveResonantDischarge(enemy, target, session, logFn = () => {}) {
  const consumed = Math.max(0, enemy?.shield || 0);
  enemy.shield = 0;
  (enemy.effects || []).forEach(effect => {
    if (effect?.id === 'shield') {
      effect.appliedShield = 0; effect.value = 0;
      (effect.extra?.shieldSources || []).forEach(segment => {
        segment.remaining = 0;
        segment.consumedWithoutBreak = true;
      });
    }
  });
  removeDepletedShieldEffects(enemy);
  if (consumed > 0 && target) {
    applyDamage(target, Math.round(consumed * WITHERING_FOREST_TUNING.splitterDischargeShieldMultiplier), 'magical', {
      source: enemy, session, logFn, directAttack: true,
      deliberateAction: { actorId: enemy.id, preparation: 'resonant_discharge', sequence: enemy._turnSerial },
    });
    if (consumed >= enemy.maxHp * WITHERING_FOREST_TUNING.splitterDischargeShockThresholdMaxHp) {
      addEffect(target, { id: 'shock', duration: 1 }, logFn, enemy, { session });
    }
  }
  logFn(`💎 ${enemy.name} завершает Резонансный разряд, поглощая ${consumed} Щита.`);
  return consumed;
}

function beginPlayerTurn(session, logFn, options = {}) {
  const { tickCooldowns: shouldTick = true } = options;
  const s = session.state;
  const player = s.players[0];
  if (!player) return { player: null, stunned: false, defeated: true };
  const outcome = evaluateBattleStatus(session);
  if (outcome.victory || outcome.defeat) return { player, stunned: false, defeated: outcome.defeat, terminal: true };

  const turn = getTurnControl(session);
  if (!turn.started) {
    markCombatTurnStarted(session, player, logFn);
    // The player must get an action window after Zolotoplavets's phase-wide Mark.
    (s.enemies || []).forEach(unit => { if (unit._minesPhaseAwaitingHeroTurn) unit._minesPhaseAwaitingHeroTurn = false; });
    player._corruptionDirectHpDamageThisTurn = false;
    player._corruptionIncomingThirstAvailable = false;
    player._defensiveStrikeWindowAttackers = [...(player._defensiveStrikeAttackers || [])];
    player._defensiveStrikeAttackers = [];
    player._survivingStandardBearerReady = Boolean(
      hasEquipped(player, EQUIPMENT_EFFECTS.SURVIVING_STANDARD_BEARER_CUIRASS) &&
      Math.max(0, Number(player.shield) || 0) > 0
    );
    resetEquipmentTurnFlags(player);
    if (hasEquipped(player, EQUIPMENT_EFFECTS.BURNED_MEMORY_STAFF)) {
      player._burnedMemoryStoredDamage = Math.max(0, Math.round(Number(player._burnedMemoryCurrentTurnDamage) || 0));
      player._burnedMemoryCurrentTurnDamage = 0;
    } else {
      player._burnedMemoryStoredDamage = 0;
      player._burnedMemoryCurrentTurnDamage = 0;
    }
    player._turnSerial = (player._turnSerial || 0) + 1;
    if (isArcherUnit(player)) {
      player._redirectPrepared = false;
      if (hasEquippedClassPassive(player, 'initiative')) player._initiativeStacks = Math.min(3, Math.max(0, player._archerTurnStreak || 0));
      player._archerTurnStreak = Math.min(4, (player._archerTurnStreak || 0) + 1);
    }
    let pendingHeadlong = null;
    processEffects(player, logFn, {
      applyDamage: (target, amount, type, extra = {}) =>
        applyDamage(target, amount, type, { ...extra, logFn, session }),
      applyHealing: (unit, amount) => applyHealing(unit, amount, { session }),
      getAllies: () => s.players,
      getOpponents: () => s.enemies,
      getRetaliatoryAssaultBonuses,
      consumeRetaliatoryAssault,
      grantHeadlongShield: (unit, ability, deliberateAction) => {
        pendingHeadlong = { unit, ability, deliberateAction };
      },
      session,
      log: logFn,
      onEffectTick: ({ effectId }) => {
        if (effectId === 'bleed') {
          grantCrimsonEcstasy(player, logFn);
          notifySublocationBleedTick(session, player, logFn);
          registerMinesBleedTick(session);
        }
      },
    });
    syncCrimsonEcstasy(player, logFn);
    if (player.hp > 0 && getCorruptionTier(player) >= 5) {
      addEffect(player, { id: 'bleed', duration: 1 }, logFn, player, { session });
    }
    if (pendingHeadlong) {
      grantHeadlongShield(pendingHeadlong.unit, pendingHeadlong.ability, pendingHeadlong.deliberateAction, session, logFn);
    }
    triggerPassiveTurnStart(player, session, text => log(s, text));
    if (player.hp > 0 && player._pendingRuinsEcho) {
      resolvePendingRuinsEcho(player, session, logFn);
    }

    if (player.hp <= 0) {
      turn.started = true;
      turn.defeated = true;
      turn.stunned = false;
      turn.itemUsed = true;
      turn.cooldownsProcessed = true;
      return { player, stunned: false, defeated: true };
    }

    turn.started = true;
    turn.defeated = false;
    turn.stunned = Boolean(player.stunned);
    turn.itemUsed = false;
    turn.cooldownsProcessed = false;
    if (turn.stunned) {
      player.stunned = false;
    }
  }

  if (shouldTick && !turn.cooldownsProcessed) {
    tickCooldowns(player);
    turn.cooldownsProcessed = true;
  }

  return {
    player,
    stunned: Boolean(turn.stunned),
    defeated: Boolean(turn.defeated),
  };
}

// === Игрок ===
export function performPlayerAction(session, abilityName, targetIndex = 0) {
  const s = session.state;
  const player = s.players[0];
  if (!player) {
    return { session, turnConsumed: false };
  }

  const initiative = ensureInitiativeState(session);
  if (!initiative.playerReady) {
    log(s, "⏳ Сейчас не ваш ход.");
    return { session, turnConsumed: false };
  }

  let ability = player.abilities.find(a => a.name === abilityName);
  if (!ability) {
    log(s, `❌ Способность "${abilityName}" не найдена.`);
    return { session, turnConsumed: false };
  }

  beginCombatPresentation(session);

  const remainingCooldown = ability.currentCooldown ?? 0;
  if (remainingCooldown > 0) {
    log(s, `⏳ "${ability.name}" ещё восстанавливается (${remainingCooldown}).`);
    return { session, turnConsumed: false };
  }

  let forgetfulnessSubstituted = false;
  const forgetfulnessActive = (player.effects || []).some(effect => effect?.id === 'forgetfulness');
  if (forgetfulnessActive && !ability.basic && !ability.passive) {
    const alternatives = (player.abilities || []).filter(candidate => {
      if (!candidate || candidate === ability || candidate.basic || candidate.passive || (candidate.currentCooldown || 0) > 0) return false;
      if (typeof candidate.canUse !== 'function') return true;
      const livingEnemies = (s.enemies || []).filter(unit => unit?.hp > 0);
      try {
        return candidate.canUse({ attacker: player, target: livingEnemies[0] || player, targets: livingEnemies, session });
      } catch (_) {
        return false;
      }
    });
    if (combatRng(session)() < 0.5 && alternatives.length > 0) {
      ability = alternatives[Math.floor(combatRng(session)() * alternatives.length)];
      forgetfulnessSubstituted = true;
      log(s, `◌ [Беспамятство] подменяет выбранную способность на «${ability.name}».`);
    }
  }

  const targetType = ability.targeting || ability.target || ability.targetType || "enemy";
  let targetIndexValue = targetIndex;

  const selectTargets = () => {
    if (targetType === "self") {
      return { targets: [player], primary: player };
    }

    if (targetType === "ally" || targetType === "allAllies") {
      const allies = (s.players || []).filter(unit => unit && unit.hp > 0);
      return { targets: allies.length > 0 ? allies : [player], primary: player };
    }

    if (targetType === "allEnemies") {
      const alive = (s.enemies || []).filter(enemy => enemy && enemy.hp > 0);
      let primary = null;
      if (alive.length > 0) {
        const direct = s.enemies[targetIndexValue];
        if (direct && direct.hp > 0) {
          primary = direct;
        } else {
          primary = alive[0];
          targetIndexValue = s.enemies.findIndex(enemy => enemy === primary);
        }
      }
      return { targets: alive, primary };
    }

    const eligible = getEligibleHostileUnits(s.enemies || []);
    let target = s.enemies[targetIndexValue];
    if (!eligible.includes(target)) {
      target = eligible[0] || null;
      if (target) targetIndexValue = s.enemies.indexOf(target);
    }
    return { targets: target ? [target] : [], primary: target };
  };

  const turnState = beginPlayerTurn(session, text => log(s, text));
  if (turnState.defeated) {
    log(s, `☠️ ${player.name} пал от эффектов и не может действовать.`);
    initiative.playerReady = false;
    return { session, turnConsumed: true };
  }

  if (turnState.stunned) {
    log(s, `😵 ${player.name} оглушён и пропускает ход.`);
    completeEntanglementTurn(player, text => log(s, text), session);
    initiative.playerReady = false;
    return { session, turnConsumed: true };
  }

  const actingPlayer = turnState.player || player;
  const actionSnapshot = {
    shieldBefore: Math.max(0, (turnState.player || player)?.shield ?? 0),
    livingEnemyCountBeforeAction: (s.enemies || []).filter(enemy => enemy?.hp > 0).length,
  };

  if (actingPlayer.prostrated) {
    log(s, `👑 ${actingPlayer.name} пребывает в Преклонении и пропускает ход.`);
    completeEntanglementTurn(actingPlayer, text => log(s, text), session);
    initiative.playerReady = false;
    return { session, turnConsumed: true };
  }

  if (actingPlayer.pendingShockSkip) {
    actingPlayer.pendingShockSkip = false;
    log(s, `⚡ ${actingPlayer.name} сотрясается от шока и не успевает действовать.`);
    completeEntanglementTurn(actingPlayer, text => log(s, text), session);
    initiative.playerReady = false;
    return { session, turnConsumed: true };
  }

  actingPlayer.turnDelay = actingPlayer.turnDelay ?? 0;
  if (actingPlayer.turnDelay >= 1) {
    actingPlayer.turnDelay = Math.max(0, actingPlayer.turnDelay - 1);
    log(s, `⏳ ${actingPlayer.name} замедлён и вынужден пропустить ход.`);
    completeEntanglementTurn(actingPlayer, text => log(s, text), session);
    initiative.playerReady = false;
    return { session, turnConsumed: true };
  }

  if (actingPlayer.silenced && !ability.basic) {
    log(s, `🤐 ${actingPlayer.name} не может использовать "${ability.name}" под действием немоты.`);
    return { session, turnConsumed: false };
  }

  const { targets, primary } = selectTargets();
  const reactionSchool = resolveMagicSchool(ability, actingPlayer, primary, resolveDamageType(ability, actingPlayer, primary));
  const chargeSchool = getElementalChargeSchool(ability, actingPlayer);

  if (typeof ability.canUse === 'function' && !ability.canUse({ attacker: actingPlayer, target: primary, targets, session })) {
    log(s, `❌ ${ability.disabledReason || `Нельзя использовать «${ability.name}»`}.`);
    return { session, turnConsumed: false };
  }

  if (!targets || targets.length === 0) {
    log(s, "⚠️ Нет живых целей для атаки.");
    ability.currentCooldown = ability.cooldown ?? 2;
    completeEntanglementTurn(actingPlayer, text => log(s, text), session);
    initiative.playerReady = false;
    return { session, turnConsumed: true };
  }

  const retaliatory = getRetaliatoryAssaultBonuses(actingPlayer);
  const consumesRetaliatory = retaliatory.stacks === 3 && !ability.basic && !ability.passive && targets.some(target => resolveDamageValue(ability, actingPlayer, target, session, actionSnapshot) > 0);
  if (consumesRetaliatory) actingPlayer._retaliatoryActionMultiplier = 1 + retaliatory.directDamagePercent;

  const overgrowthAtStart = captureOvergrowth(actingPlayer);
  const forestRootsOriginId = beginForestRootsAction(session);
  recordCombatPresentationEvent(session, { type: "actionStart", actor: actingPlayer, action: ability });

  let anyAction = false;
  let primaryHit = false;
  let primaryPreparedForSecondary = false;
  const hitTargets = [];
  const preHitTargetStates = targets.map(target => ({
    target,
    hadBleed: Boolean(target?.effects?.some(effect => effect?.id === 'bleed')),
    hadBurn: Boolean(target?.effects?.some(effect => effect?.id === 'burn')),
    charringStacks: (target?.effects || []).filter(effect => effect?.id === 'charring').length,
    hadPoison: Boolean(target?.effects?.some(effect => effect?.id === POISON_EFFECT_ID)),
    hadSlow: hasForestSlow(target),
    hadHuntingMark: Boolean(target?.effects?.some(effect => effect?.id === 'hunting_mark')),
    turnMeter: Math.max(0, Number(target?.turnMeter) || 0),
  }));
  const enemyGroup = (s.enemies || []).filter(enemy => enemy && enemy.hp > 0);
  prepareOathbreakerPrimaryTarget(actingPlayer, primary);
  const deliberateAction = {
    actorId: actingPlayer.id,
    ability: ability.name,
    primaryTargetId: combatUnitId(primary),
    multiTargetAction: targetType === 'allEnemies' || ['allEnemies', 'otherEnemies'].includes(ability.secondary?.target),
    attackingAction: targets.some(target =>
      target && target !== actingPlayer && resolveDamageValue(ability, actingPlayer, target, session, actionSnapshot) > 0
    ),
    counterformulaPreexistingByTarget: Object.fromEntries(
      targets.filter(Boolean).map(target => [
        combatUnitId(target),
        (target.effects || [])
          .filter(effect => isOwnerTimedDebuff(effect, actingPlayer, { excludeControl: true }))
          .map(effect => effect.id),
      ])
    ),
    forestPoisonBeforeByTarget: Object.fromEntries(
      preHitTargetStates.map(entry => [combatUnitId(entry.target), entry.hadPoison])
    ),
    forestSlowBeforeByTarget: Object.fromEntries(
      preHitTargetStates.map(entry => [combatUnitId(entry.target), entry.hadSlow])
    ),
  };
  deliberateAction.thirdVoiceEchoArmed = Boolean(
    !ability.basic &&
    !ability.passive &&
    deliberateAction.attackingAction &&
    hasEquipped(actingPlayer, EQUIPMENT_EFFECTS.THIRD_VOICE_MIRROR) &&
    getEffectStackCount(actingPlayer, THIRD_VOICE_READY_ID) > 0
  );
  const nonBasicAbility = !ability.basic && !ability.passive;
  deliberateAction.echoCandidates = [];
  if (nonBasicAbility) {
    actingPlayer._undeathNonBasicCasts = Math.max(0, Number(actingPlayer._undeathNonBasicCasts) || 0) + 1;
    const tier = getUndeathTier(actingPlayer);
    const heroEfficiency = value => Math.min(1, tier >= 3 ? Math.max(UNDEATH_ECHO_EFFICIENCY, value) : value);
    if (tier >= 1 && !actingPlayer._undeathFirstEchoUsed) deliberateAction.echoCandidates.push({ reason: 'undeath_first', efficiency: heroEfficiency(ECHO_BASE_EFFICIENCY), consumable: false });
    if (tier >= 3 && actingPlayer._undeathNonBasicCasts % 3 === 0) deliberateAction.echoCandidates.push({ reason: 'undeath_third', efficiency: heroEfficiency(ECHO_BASE_EFFICIENCY), consumable: false });
    if (tier >= 2 && actingPlayer._undeathEnemyEchoPrepared) deliberateAction.echoCandidates.push({ reason: 'undeath_death', efficiency: heroEfficiency(ECHO_BASE_EFFICIENCY), consumable: true });
    if (getEffectStackCount(actingPlayer, RUINS_ECHO_CHARGE_ID) > 0) deliberateAction.echoCandidates.push({ reason: 'item', effectId: RUINS_ECHO_CHARGE_ID, efficiency: heroEfficiency(ECHO_BASE_EFFICIENCY), consumable: true });
    if (deliberateAction.thirdVoiceEchoArmed) deliberateAction.echoCandidates.push({ reason: 'item', effectId: THIRD_VOICE_READY_ID, efficiency: heroEfficiency(ECHO_BASE_EFFICIENCY), consumable: true });
  }
  deliberateAction.ruinsEchoEligible = Boolean(nonBasicAbility && (deliberateAction.echoCandidates.length || getUndeathTier(actingPlayer) >= 5));
  if (deliberateAction.ruinsEchoEligible) ensureRuinsEchoSnapshot(deliberateAction);
  deliberateAction.incomingElementSchool = reactionSchool;
  if (
    isElementalist(actingPlayer) &&
    !actingPlayer.summoned &&
    hasEquippedClassPassive(actingPlayer, 'elemental_resonance') &&
    !ability.basic &&
    !ability.passive &&
    deliberateAction.attackingAction &&
    [MAGIC_SCHOOLS.FIRE, MAGIC_SCHOOLS.ICE, MAGIC_SCHOOLS.LIGHTNING].includes(reactionSchool)
  ) {
    deliberateAction.elementalResonanceSchool = reactionSchool;
  }
  if (
    isElementalist(actingPlayer) &&
    !actingPlayer.summoned &&
    hasEquippedClassPassive(actingPlayer, 'overheat') &&
    !ability.basic &&
    !ability.passive &&
    [MAGIC_SCHOOLS.FIRE, MAGIC_SCHOOLS.ICE, MAGIC_SCHOOLS.LIGHTNING].includes(reactionSchool)
  ) {
    const overheatStacks = Math.min(2, getEffectStackCount(actingPlayer, 'overheat'));
    if (reactionSchool === MAGIC_SCHOOLS.FIRE && deliberateAction.attackingAction && overheatStacks > 0) {
      deliberateAction.overheatStacks = overheatStacks;
      deliberateAction.overheatDamageMultiplier = 1 + 0.2 * overheatStacks;
      deliberateAction.overheatCharring = overheatStacks >= 2;
      consumeEffectStacks(actingPlayer, 'overheat', overheatStacks);
      log(s, `🔥 Перегрев расходует ${overheatStacks} зар. и усиливает «${ability.name}» на ${overheatStacks * 20}% прямого урона.`);
    } else if (reactionSchool === MAGIC_SCHOOLS.ICE || reactionSchool === MAGIC_SCHOOLS.LIGHTNING) {
      deliberateAction.overheatGain = overheatStacks < 2;
    }
  }
  const activatesStandardBearer = Boolean(
    actingPlayer._survivingStandardBearerReady &&
    !ability.basic &&
    !ability.passive &&
    ability.abilityRole === 'defense'
  );
  if (activatesStandardBearer) {
    session._survivingStandardBearerShieldAction = { sourceId: combatUnitId(actingPlayer) };
  }
  if (!ability.passive && targets.some(target =>
    target !== actingPlayer && resolveDamageValue(ability, actingPlayer, target, session, actionSnapshot) > 0
  )) beginInvisibleAttack(actingPlayer, ability, deliberateAction, text => log(s, text));
  if (ability.basic && primary?.nonActingCombatObject) deliberateAction.safeCombatObjectId = primary.id;
  if (!ability.basic && !ability.passive) {
    (s.enemies || []).filter(unit => unit?.nonActingCombatObject && unit.hp > 0).forEach(object => {
      triggerEnemyCombatObject(object, session, actingPlayer, deliberateAction, text => log(s, text));
    });
  }
  deliberateAction.markedBowstringCritBonus = resolveMarkedBowstringCritBonus(
    actingPlayer,
    primary,
    targets.some(target => resolveDamageValue(ability, actingPlayer, target, session, actionSnapshot) > 0) && !ability.isSecondaryDamage && !ability.passive
  );
  for (const currentTarget of targets) {
    const baseDamage = resolveDamageValue(ability, actingPlayer, currentTarget, session, actionSnapshot);
    const preparedBeforeEffects = currentTarget === primary && isPreparedForFireballSplash(currentTarget);
    const requiresHit = abilityRequiresHitCheck(ability, baseDamage);
    let hitInfo = { hit: true, chance: 1 };
    if (requiresHit) {
      hitInfo = determineHitOutcome(actingPlayer, currentTarget, ability, session);
    }

    if (requiresHit && !hitInfo.hit) {
      if (currentTarget === primary && deliberateAction.attackingAction) {
        resetLastRankRingOnMiss(actingPlayer, currentTarget, deliberateAction);
      }
      log(
        s,
        formatMissLog({ attacker: actingPlayer, target: currentTarget, ability, hitInfo, context: 'playerAbility' })
      );
      triggerTargetedDirectMiss(currentTarget, actingPlayer, session, text => log(s, text));
      anyAction = true;
      continue;
    }

    let absorbed = 0;
    const hitCount = Math.max(1, ability.hitCount ?? ability.hits ?? 1);
    if (!requiresHit || hitInfo.hit) {
      for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
        if (!canUnitContinueAction(actingPlayer) || !currentTarget || currentTarget.hp <= 0) break;
        let result = { damage: 0, absorbed: 0, targetHpBeforeDamage: currentTarget.hp };
        if (baseDamage > 0) {
          if (hitIndex === 0 && typeof ability.beforeDirectDamage === 'function') {
            ability.beforeDirectDamage({
              attacker: actingPlayer,
              target: currentTarget,
              primary,
              targets,
              session,
              log: text => log(s, text),
              deliberateAction,
              actionSnapshot,
            });
          }
          result = performDirectDamage({
            attacker: actingPlayer,
            ability,
            target: currentTarget,
            baseDamage,
            session,
            logFn: text => log(s, text),
            opposingGroup: enemyGroup,
            allowCritical: true,
            deferReactions: true,
            deliberateAction,
          });
          absorbed = result.absorbed || currentTarget.lastAbsorbed || 0;
          if (deliberateAction.ruinsEchoEligible && result.rawDamage > 0) {
            captureRuinsEchoDamage(deliberateAction, currentTarget, result.rawDamage);
          }
          if (hitIndex === 0 && typeof ability.afterDirectDamage === 'function') {
            ability.afterDirectDamage({
              attacker: actingPlayer,
              target: currentTarget,
              primary,
              targets,
              session,
              log: text => log(s, text),
              deliberateAction,
              actionSnapshot,
              hitResult: result,
              applyDamage: (unit, amount, type, extra = {}) => applyDamage(unit, amount, type, {
                ...extra,
                session,
                source: extra.source ?? actingPlayer,
                logFn: text => log(s, text),
              }),
            });
          }

        } else if (!anyAction && hitIndex === 0) {
          const shieldNote = absorbed > 0 ? `Щит ${currentTarget.name} полностью поглотил эффект.` : "";
          log(s, `✨ ${actingPlayer.name} использует "${ability.name}". ${shieldNote}`.trim());
        }

        hitTargets.push(currentTarget);
        if (currentTarget === primary) {
          primaryHit = true;
          primaryPreparedForSecondary = preparedBeforeEffects;
        }
        // Reactions belong to the damage state that existed at impact.
        // A status applied by this same hit must not retroactively react to it.
        flushPendingDamageReactions(currentTarget);
        const effectDescriptors = resolveAbilityEffect(ability.effect, {
          attacker: actingPlayer,
          target: currentTarget,
          primary,
          targets,
          session,
          actionSnapshot,
        });
        applyEffectsToTargets(effectDescriptors, {
          attacker: actingPlayer,
          primaryTarget: currentTarget,
          opposingGroup: (s.enemies || []).filter(enemy => enemy && enemy.hp > 0),
          alliedGroup: (s.players || []).filter(unit => unit && unit.hp > 0),
          logFn: text => log(s, text),
          session,
          magicalSource: resolveDamageType(ability, actingPlayer, currentTarget) === 'magical' || Boolean(ability.school || ability.schoolResolver),
          deliberateAction,
        });
        triggerPiercingWounds({
          attacker: actingPlayer,
          ability,
          target: currentTarget,
          session,
          logFn: text => log(s, text),
          hitResult: result,
          enemyGroup: s.enemies || [],
          wasAoE: targetType === 'allEnemies',
        });
        if (!canUnitContinueAction(actingPlayer)) break;
      }
    }

    anyAction = true;
  }

  if (!anyAction) {
    log(s, `✨ ${actingPlayer.name} использует "${ability.name}".`);
  }


  const trapBeforeApply = actingPlayer._armedTrap;
  const ruinsEchoApplyBefore = deliberateAction.ruinsEchoEligible
    ? snapshotRuinsEchoApplyState(session)
    : null;
  if (canUnitContinueAction(actingPlayer) && typeof ability.apply === "function") {
    ability.apply({
      attacker: actingPlayer,
      target: primary || targets[0] || null,
      targets,
      hitTargets,
      preHitTargetStates,
      session,
      actionSnapshot,
      deliberateAction,
      log: text => log(s, text),
      applyDamage: (unit, amount, type, extra = {}) => applyDamage(unit, amount, type, {
        ...extra, session, source: extra.source ?? actingPlayer, logFn: text => log(s, text),
      }),
      applyDirectDamage: (unit, amount, secondaryAbility = {}) => performDirectDamage({
        attacker: actingPlayer,
        ability: { ...ability, ...secondaryAbility, isSecondaryDamage: true },
        target: unit,
        baseDamage: amount,
        session,
        logFn: text => log(s, text),
        opposingGroup: (s.enemies || []).filter(enemy => enemy && enemy.hp > 0),
        allowCritical: false,
        deferReactions: true,
        deliberateAction,
      }),
      flushDamageReactions: unit => flushPendingDamageReactions(unit),
    });
  }
  if (deliberateAction.ruinsEchoEligible && ruinsEchoApplyBefore) {
    captureRuinsEchoApplyDiff(deliberateAction, ruinsEchoApplyBefore, session);
  }
  if (!trapBeforeApply && actingPlayer._armedTrap) {
    recordCombatPresentationEvent(session, { type: 'temporaryEntitySpawn', actor: actingPlayer, entityId: actingPlayer._armedTrap.type });
  }

  const selfEffects = resolveAbilityEffect(ability.selfEffects, {
    attacker: actingPlayer,
    target: primary || targets[0] || null,
    targets,
  });
  applyEffectsToTargets(selfEffects, {
    attacker: actingPlayer,
    primaryTarget: actingPlayer,
    opposingGroup: (s.enemies || []).filter(enemy => enemy && enemy.hp > 0),
    alliedGroup: (s.players || []).filter(unit => unit && unit.hp > 0),
    logFn: text => log(s, text),
    session,
    magicalSource: Boolean(ability.school || ability.schoolResolver || ability.type === 'magical'),
    deliberateAction,
  });

  if (activatesStandardBearer) {
    delete session._survivingStandardBearerShieldAction;
    actingPlayer._survivingStandardBearerReady = false;
  }

  if (canUnitContinueAction(actingPlayer) && ability.secondary) {
    const secondary = ability.secondary;
    const scope = secondary.target || "otherEnemies";
    const opponents = (s.enemies || []).filter(enemy => enemy && enemy.hp > 0);
    let secondaryTargets = [];
    if (scope === "allEnemies") {
      secondaryTargets = opponents;
    } else if (scope === "otherEnemies") {
      secondaryTargets = opponents.filter(enemy => !targets.includes(enemy));
    } else if (scope === "target" && primary) {
      secondaryTargets = [primary];
    }

    secondaryTargets.forEach(secTarget => {
      if (
        typeof secondary.condition === "function" &&
        !secondary.condition({
          attacker: actingPlayer,
          target: secTarget,
          primary,
          targets,
          session,
          primaryHit,
          primaryPrepared: primaryPreparedForSecondary,
        })
      ) {
        return;
      }
      const secDamage =
        typeof secondary.damage === "function"
          ? secondary.damage({
              attacker: actingPlayer,
              target: secTarget,
              primary,
              targets,
              session,
              primaryHit,
              primaryPrepared: primaryPreparedForSecondary,
            })
          : secondary.damage ?? 0;
      if (secDamage <= 0) return;
      const secondaryResult = performDirectDamage({
        attacker: actingPlayer,
        ability: {
          ...ability,
          name: secondary.name || ability.name,
          type: secondary.type || ability.type,
          school: secondary.school || ability.school,
          schoolResolver: secondary.schoolResolver || ability.schoolResolver,
          targeting: scope === 'allEnemies' || scope === 'otherEnemies' ? 'allEnemies' : ability.targeting,
          noElementalResonance: secondary.noElementalResonance === true,
          isSecondaryDamage: true,
        },
        target: secTarget,
        baseDamage: secDamage,
        session,
        logFn: text => log(s, text),
        opposingGroup: opponents,
        allowCritical: secondary.allowCritical !== false,
        deferReactions: true,
        deliberateAction,
      });
      if (deliberateAction.ruinsEchoEligible && secondaryResult?.rawDamage > 0) {
        captureRuinsEchoDamage(deliberateAction, secTarget, secondaryResult.rawDamage);
      }
      // Same ordering as the primary hit: resolve reactions before applying
      // a status created by this secondary hit.
      flushPendingDamageReactions(secTarget);
      const secondaryEffects = resolveAbilityEffect(secondary.effects, {
        attacker: actingPlayer,
        target: secTarget,
        primary,
        targets,
      });
      applyEffectsToTargets(secondaryEffects, {
        attacker: actingPlayer,
        primaryTarget: secTarget,
        opposingGroup: opponents,
        alliedGroup: (s.players || []).filter(unit => unit && unit.hp > 0),
        logFn: text => log(s, text),
        session,
        magicalSource: (secondary.type || ability.type) === 'magical' || Boolean(secondary.school || ability.school),
        deliberateAction,
      });
    });
  }

  resolveClingingResinAmulet(actingPlayer, deliberateAction, session, text => log(s, text));

  if (deliberateAction.overheatCharring) {
    (deliberateAction.overheatHitTargets || [])
      .filter(target => target?.hp > 0)
      .forEach(target => addEffect(
        target,
        { id: 'charring', duration: 3 },
        text => log(s, text),
        actingPlayer,
        { session, deliberateAction }
      ));
  }
  finalizeElementalResonance(actingPlayer, deliberateAction, session, text => log(s, text));
  if (deliberateAction.overheatGain && actingPlayer.hp > 0) {
    const before = getEffectStackCount(actingPlayer, 'overheat');
    addEffect(actingPlayer, { id: 'overheat' }, text => log(s, text), actingPlayer, { session });
    const after = getEffectStackCount(actingPlayer, 'overheat');
    if (after > before) log(s, `🔥 Перегрев: ${after}/2.`);
  }
  finalizeElementalCharge(actingPlayer, ability, chargeSchool, deliberateAction, session, text => log(s, text));

  triggerEquipmentAfterMagicalAbility(actingPlayer, ability, primary || targets[0] || actingPlayer, session, text => log(s, text));

  scheduleRuinsEcho(actingPlayer, ability, deliberateAction, text => log(s, text));
  registerThirdVoiceMirrorSupport(actingPlayer, ability, deliberateAction, text => log(s, text));

  finalizeSightingBowAction(actingPlayer, primary, deliberateAction, session, text => log(s, text));
  if (
    hasEquipped(actingPlayer, EQUIPMENT_EFFECTS.UNFINISHED_ORDER_CIRCLET) &&
    !ability.basic && !ability.passive && !deliberateAction.attackingAction
  ) {
    actingPlayer._unfinishedOrderReady = true;
    log(s, '👑 ' + EQUIPMENT_EFFECTS.UNFINISHED_ORDER_CIRCLET + ' подготавливает следующую прямую атаку.');
  }
  if (
    hasEquipped(actingPlayer, EQUIPMENT_EFFECTS.BURIAL_WATCH_UNIFORM) &&
    !ability.basic && !ability.passive && !deliberateAction.attackingAction
  ) {
    actingPlayer._burialWatchUniformReady = true;
    log(s, '🧥 ' + EQUIPMENT_EFFECTS.BURIAL_WATCH_UNIFORM + ' подготавливает лечение от следующего прямого удара.');
  }
  if (
    hasEquipped(actingPlayer, EQUIPMENT_EFFECTS.DEAF_FACE_HELMET) &&
    !ability.basic && !ability.passive && !deliberateAction.attackingAction &&
    canUseEquipmentTurnFlag(actingPlayer, 'deafFaceHelmet')
  ) {
    addEffect(actingPlayer, { id: MINOR_DEFENSE_BLESSING_ID, duration: 1 }, text => log(s, text), actingPlayer, { session });
    log(s, '⛑️ ' + EQUIPMENT_EFFECTS.DEAF_FACE_HELMET + ' даёт Укрепление.');
  }

  grantHeadlongShield(actingPlayer, ability, deliberateAction, session, text => log(s, text));

  if (consumesRetaliatory) consumeRetaliatoryAssault(actingPlayer);
  if (actingPlayer._falseTrailReady && targets.some(target => resolveDamageValue(ability, actingPlayer, target, session, actionSnapshot) > 0)) actingPlayer._falseTrailReady = false;
  if ([MAGIC_SCHOOLS.FIRE, MAGIC_SCHOOLS.ICE, MAGIC_SCHOOLS.LIGHTNING].includes(ability.school)) actingPlayer._lastElementalSchool = ability.school;

  ability.currentCooldown = ability.cooldown ?? 2;
  const exhaustion = (actingPlayer.effects || []).find(effect => effect?.id === 'curse_of_exhaustion');
  if (exhaustion && !ability.basic && !ability.passive ) {
    ability.currentCooldown += 1;
    const caster = (s.enemies || []).find(unit => unit?.id === exhaustion.sourceId);
    if (caster) caster._exhaustionEmpowered = true;
    cleanseEffects(actingPlayer, effect => effect === exhaustion, text => log(s, text));
    log(s, `☾ Проклятие истощения продлевает восстановление «${ability.name}».`);
  }
  if (applyDeserterGrimoireCooldown(actingPlayer, ability)) {
    log(s, `📖 ${EQUIPMENT_EFFECTS.DESERTER_FIELD_GRIMOIRE} сокращает перезарядку «${ability.name}» на 1.`);
  }
  const progression = actingPlayer?.classProgression;
  const classRecord = progression?.[actingPlayer?.class || 'Defender'] || progression;
  const hasNoRespite = ability.name === 'Бросок щита' &&
    classRecord?.talentSelections?.['defender.shield_throw'] === 'defender.shield_throw.no_respite';
  const primaryState = preHitTargetStates.find(entry => entry.target === primary);
  if (hasNoRespite && primaryState?.hadBleed) {
    ability.currentCooldown = Math.max(0, ability.currentCooldown - 1);
    log(s, `🩸 «Без передышки» сокращает перезарядку «${ability.name}» на 1.`);
  }
  if (applyLastShiftHammerCooldown(actingPlayer, ability)) {
    log(s, `🔨 ${EQUIPMENT_EFFECTS.LAST_SHIFT_HAMMER} сокращает перезарядку «${ability.name}» на 1.`);
  }
  if (
    actingPlayer._foreignShiftPrimed &&
    !ability.basic &&
    !ability.passive &&
    (ability.currentCooldown || 0) > 0 &&
    hasEquipped(actingPlayer, EQUIPMENT_EFFECTS.FOREIGN_SHIFT_RING)
  ) {
    ability.currentCooldown = Math.max(0, ability.currentCooldown - 1);
    actingPlayer._foreignShiftPrimed = false;
    actingPlayer._foreignShiftCooldown = 3;
    log(s, `💍 ${EQUIPMENT_EFFECTS.FOREIGN_SHIFT_RING} сокращает перезарядку «${ability.name}» на 1.`);
  }
  if (
    ability.basic &&
    hasEquipped(actingPlayer, EQUIPMENT_EFFECTS.FOREIGN_SHIFT_RING) &&
    !actingPlayer._foreignShiftPrimed &&
    (actingPlayer._foreignShiftCooldown || 0) <= 0
  ) {
    actingPlayer._foreignShiftPrimed = true;
    log(s, `💍 ${EQUIPMENT_EFFECTS.FOREIGN_SHIFT_RING} подготавливает сокращение следующей классовой перезарядки.`);
  }
  if (!ability.basic && !ability.passive && getDecayTier(actingPlayer) >= 1 && !actingPlayer._decayFirstCooldownUsed) {
    actingPlayer._decayFirstCooldownUsed = true;
    ability.currentCooldown = Math.max(0, (ability.currentCooldown || 0) - 1);
    log(s, `🔥 [Пепельная ясность] сокращает перезарядку «${ability.name}» на 1.`);
  }
  if (forgetfulnessActive && !forgetfulnessSubstituted && !ability.basic && !ability.passive) {
    ability.currentCooldown = Math.max(0, (ability.currentCooldown || 0) + 1);
    log(s, `◌ [Беспамятство] увеличивает перезарядку «${ability.name}» на 1.`);
  }
  consumeOvergrowthAfterAction(actingPlayer, ability, overgrowthAtStart, text => log(s, text));
  completeEntanglementTurn(actingPlayer, text => log(s, text), session);
  endForestRootsAction(session, forestRootsOriginId);
  flushRuinsSouls(session);
  initiative.playerReady = false;
  return { session, turnConsumed: true };
}

export function consumeBetrayalRedirectTarget(enemy, session, ability, baseDamage, logFn = () => {}) {
  if (!enemy || baseDamage <= 0 || ability?.passive) return null;
  const targeting = String(ability?.targeting || ability?.area || ability?.target || '').toLowerCase();
  if (targeting.includes('all')) return null;
  const betrayal = (enemy.effects || []).find(effect => effect?.id === 'betrayal');
  if (!betrayal) return null;
  const allies = (session?.state?.enemies || []).filter(unit => unit && unit !== enemy && unit.hp > 0);
  if (!allies.length) {
    cleanseEffects(enemy, effect => effect === betrayal, logFn);
    return null;
  }
  const rng = typeof session?.rng === 'function' ? session.rng : Math.random;
  const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
  const target = allies[Math.floor(roll * allies.length)];
  cleanseEffects(enemy, effect => effect === betrayal, logFn);
  logFn(`🗡️ Предательство заставляет ${enemy.name || 'врага'} атаковать ${target.name || 'союзника'}.`);
  return target;
}

export function consumeArcherRedirect(enemy, originalTarget, ability, baseDamage, session, logFn) {
  const archer = originalTarget;
  const targeting = String(ability?.targeting || ability?.target || '').toLowerCase();
  const prepared = archer?._redirectPrepared;
  if (!prepared || !isArcherUnit(archer) || baseDamage <= 0 || targeting.includes('all')) return { target: originalTarget, dodged: false };
  const talentId = typeof prepared === 'object' ? prepared.talentId : null;
  archer._redirectPrepared = false;
  const candidates = (session.state.enemies || []).filter(unit => unit && unit !== enemy && unit.hp > 0);
  archer._falseTrailReady = hasEquippedClassPassive(archer, 'false_trail') || archer._falseTrailReady;
  const returnShot = talentId === 'archer.redirect.return_shot';
  if (!candidates.length) {
    logFn(`🏹 ${archer.name} уклоняется благодаря Перенаправлению.`);
    return { target: originalTarget, dodged: true, archer, returnShot, consumeHuntingMark: false };
  }
  const markedCandidates = talentId === 'archer.redirect.offer_prey'
    ? candidates.filter(unit => (unit.effects || []).some(effect => effect?.id === 'hunting_mark'))
    : [];
  const pool = markedCandidates.length > 0 ? markedCandidates : candidates;
  const rng = typeof session.rng === 'function' ? session.rng : Math.random;
  const target = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const consumeHuntingMark = markedCandidates.includes(target);
  logFn(`🏹 ${archer.name} перенаправляет атаку ${enemy.name} в ${target.name}.`);
  return { target, dodged: false, archer, returnShot, consumeHuntingMark };
}

export function applyArcherRedirectHuntingMark(redirect, currentTarget, deliberateAction, logFn = () => {}) {
  if (!redirect?.consumeHuntingMark || !currentTarget || currentTarget !== redirect.target || !deliberateAction) return false;
  const huntingMark = (currentTarget.effects || []).find(effect => effect?.id === 'hunting_mark');
  if (!huntingMark) return false;
  cleanseEffects(currentTarget, effect => effect === huntingMark, logFn);
  deliberateAction.redirectHuntingMarkCrit = true;
  return true;
}

export function triggerArcherRedirectReturnShot(archer, enemy, session, logFn = () => {}) {
  if (!canUnitPerformReactiveAction(archer) || !enemy || enemy.hp <= 0) return 0;
  const result = performDirectDamage({
    attacker: archer,
    ability: {
      name: 'Ответный выстрел',
      type: 'physical',
      targeting: 'enemy',
      isSecondaryDamage: true,
    },
    target: enemy,
    baseDamage: Math.max(0, Number(archer.attack) || 0),
    session,
    logFn,
    opposingGroup: (session?.state?.enemies || []).filter(unit => unit?.hp > 0),
    allowCritical: true,
    deliberateAction: { actorId: archer.id, ability: 'Ответный выстрел', redirectReaction: true },
  });
  flushPendingDamageReactions(enemy);
  const dealt = Math.max(0, Number(result?.damage) || 0);
  if (dealt > 0) logFn(`🏹 Ответный выстрел наносит ${dealt} урона ${enemy.name || 'врагу'}.`);
  return dealt;
}

export function notifyFriendlyTemporarySummonDisappeared(owner, session, logFn = () => {}, meta = {}) {
  if (!owner || owner.hp <= 0 || meta?.reason === 'battle_end') return 0;

  if (
    hasEquipped(owner, EQUIPMENT_EFFECTS.LAST_ECHO_AMULET) &&
    !owner._lastEchoAmuletUsed &&
    !meta?.lastEchoCopy &&
    meta?.template
  ) {
    const result = restoreSummonFromTemplate(owner, session, meta.template, {
      lastEchoCopy: true,
      logFn,
    });
    if (result?.success) {
      owner._lastEchoAmuletUsed = true;
      logFn?.(`📿 ${EQUIPMENT_EFFECTS.LAST_ECHO_AMULET} возвращает исчезнувший призыв.`);
    }
  }

  const wasTemporary = meta?.temporary ?? Boolean(
    meta?.vanishedUnit?.temporarySummon ||
    meta?.template?.form === 'owner_slot' ||
    Number.isFinite(meta?.template?.durationTurns)
  );
  if (
    !wasTemporary ||
    !hasEquipped(owner, EQUIPMENT_EFFECTS.BURIAL_FORMATION_RING) ||
    !canUseEquipmentTurnFlag(owner, 'burialFormationShield')
  ) {
    return 0;
  }
  const value = Math.max(1, Math.round((owner.maxHp || 0) * 0.12));
  if (value <= 0) return 0;
  addEffect(owner, { id: 'shield', duration: 2, value }, logFn, owner, {
    session,
    forceIndependentInstance: true,
  });
  logFn?.(`💍 ${EQUIPMENT_EFFECTS.BURIAL_FORMATION_RING} даёт ${value} Щита после исчезновения временного призыва.`);
  return value;
}

export function triggerArcherTrap(archer, enemy, session, logFn, phase = 'after_action') {
  const trap = archer?._armedTrap;
  if (!trap || !enemy || enemy.hp <= 0) return false;
  const wolfPitBeforeAction = trap.type === 'wolf_pit' && trap.talentId === 'archer.wolf_pit.trap';
  if (wolfPitBeforeAction ? phase !== 'before_action' : phase !== 'after_action') return false;
  const { lastEchoCopy, _summonTemplate, ...trapPayload } = trap;
  const summonTemplate = _summonTemplate || {
    form: 'owner_slot',
    slot: '_armedTrap',
    payload: cloneSummonTemplateValue(trapPayload) || {},
  };
  recordCombatPresentationEvent(session, { type: 'temporaryEntityActivate', actor: archer, target: enemy, entityId: trap.type });
  let remainsArmed = false;
  if (trap.type === 'wolf_pit') {
    const bleedCount = enemy.controlImmune ? 3 : 2;
    for (let i = 0; i < bleedCount; i += 1) addEffect(enemy, { id: 'bleed', duration: 2 }, logFn, archer, { session });
    let stunEffect = null;
    if (!enemy.controlImmune) {
      stunEffect = addEffect(enemy, { id: 'stun', duration: 1 }, logFn, archer, { session });
    }
    if (trap.talentId === 'archer.wolf_pit.drive_prey') {
      addEffect(enemy, { id: 'hunting_mark', duration: 2 }, logFn, archer, { session });
    }
    if (wolfPitBeforeAction && stunEffect) {
      delete stunEffect._appliedTurnEpoch;
      enemy._archerTrapCancelledAction = true;
    }
  } else if (trap.type === 'snake_trap') {
    const poisonDuration = trap.talentId === 'archer.snake_trap.long_poison' ? 4 : 2;
    for (let i = 0; i < 2 && enemy.hp > 0; i += 1) {
      applyDamage(enemy, Math.round((archer.attack || 0) * 0.6), 'physical', { source: archer, session, logFn, directAttack: false, fromEffect: 'snake_trap' });
      addEffect(enemy, { id: 'poison', duration: poisonDuration }, logFn, archer, { session });
    }
    const remaining = Math.max(1, Number(trap.activationsRemaining) || 1);
    if (trap.talentId === 'archer.snake_trap.snake_tangle' && remaining > 1) {
      trap.activationsRemaining = remaining - 1;
      remainsArmed = true;
    }
  }
  if (hasEquippedClassPassive(archer, 'hunting_rhythm')) archer.turnMeter = Math.min(TURN_METER_THRESHOLD, (archer.turnMeter || 0) + 500);
  if (remainsArmed) {
    archer._armedTrap = trap;
    return true;
  }
  archer._armedTrap = null;
  notifyFriendlyTemporarySummonDisappeared(archer, session, logFn, {
    kind: trap.type,
    reason: 'resolved',
    template: summonTemplate,
    temporary: true,
    lastEchoCopy: Boolean(lastEchoCopy),
  });
  return true;
}

export function processEnemyAI(session) {
  const s = session.state;
  const turnReports = [];
  ensureInitiativeState(session);

  let steps = 0;
  while (steps < MAX_ENEMY_AUTOMATION_STEPS) {
    const terminal = evaluateBattleStatus(session);
    if (terminal.victory || terminal.defeat) break;
    const actorInfo = popNextActor(session);
    if (!actorInfo) break;

    if (actorInfo.type === 'ally') {
      const ally = actorInfo.unit;
      processEffects(ally, text => log(s, text), {
        onEffectTick: ({ effectId }) => { if (effectId === 'bleed') registerMinesBleedTick(session); },
        applyDamage: (unit, amount, type, extra = {}) => applyDamage(unit, amount, type, { ...extra, session, logFn: text => log(s, text) }),
        getAllies: () => s.players, getOpponents: () => s.enemies, session,
      });
      if (ally.hp > 0) {
        tickCooldowns(ally);
        let controlSkipped = false;
        if (ally.stunned) {
          ally.stunned = false;
          log(s, `💫 ${ally.name || 'Призванный союзник'} оглушён и пропускает ход.`);
          controlSkipped = true;
        } else if (ally.prostrated) {
          log(s, `👑 ${ally.name || 'Призванный союзник'} пребывает в Преклонении и пропускает ход.`);
          controlSkipped = true;
        } else if (ally.pendingShockSkip) {
          ally.pendingShockSkip = false;
          log(s, `⚡ ${ally.name || 'Призванный союзник'} парализован шоком и не может действовать.`);
          controlSkipped = true;
        } else {
          ally.turnDelay = ally.turnDelay ?? 0;
          if (ally.turnDelay >= 1) {
            ally.turnDelay = Math.max(0, ally.turnDelay - 1);
            log(s, `⏳ ${ally.name || 'Призванный союзник'} замедлен и пропускает ход.`);
            controlSkipped = true;
          }
        }
        if (!controlSkipped) {
          const candidates = getEligibleHostileUnits(s.enemies || []);
          const preferred = ally.summonKind === 'burial_seal_soul'
            ? candidates.find(unit =>
                (ally._burialSealFocusTargetId && (unit.id === ally._burialSealFocusTargetId || unit.combatInstanceId === ally._burialSealFocusTargetId))
                || (!ally._burialSealFocusTargetId && unit.name === ally._burialSealFocusTargetName))
            : null;
          const target = preferred || (ally.summonKind === 'burial_seal_soul' && candidates.length
            ? candidates[Math.floor(combatRng(session)() * candidates.length)]
            : candidates[0]) || null;
          const ready = (ally.abilities || []).filter(entry => !entry.passive && (entry.currentCooldown || 0) <= 0);
          const ability = ally.silenced
            ? ready.find(entry => entry.basic)
            : ready.find(entry => !entry.basic) || ready.find(entry => entry.basic);
          if (target && ability) {
            const overgrowthAtStart = captureOvergrowth(ally);
            const deliberateAction = { actorId: ally.id, ability: ability.name };
            if (resolveDamageValue(ability, ally, target, session) > 0) {
              beginInvisibleAttack(ally, ability, deliberateAction, text => log(s, text));
            }
            recordCombatPresentationEvent(session, { type: "actionStart", actor: ally, action: ability });
            log(s, `✨ ${ally.name || 'Призванный союзник'} использует «${ability.name}».`);
            const damage = resolveDamageValue(ability, ally, target, session);
            const directResult = performDirectDamage({ attacker: ally, ability, target, baseDamage: damage, session, logFn: text => log(s, text), opposingGroup: s.enemies, deliberateAction });
            if (typeof ability.allyAfterDirectDamage === 'function') {
              ability.allyAfterDirectDamage({
                attacker: ally,
                target,
                session,
                log: text => log(s, text),
                deliberateAction,
                hitResult: directResult,
              });
            }
            const descriptors = resolveAbilityEffect(ability.effect, { attacker: ally, target, primary: target, targets: [target], session });
            applyEffectsToTargets(descriptors, { attacker: ally, primaryTarget: target, opposingGroup: s.enemies, alliedGroup: s.players, logFn: text => log(s, text), session, magicalSource: true, deliberateAction });
            ability.currentCooldown = ability.cooldown || 0;
            consumeOvergrowthAfterAction(ally, ability, overgrowthAtStart, text => log(s, text));
          }
        }
      }
      if (ally.hp > 0) {
        completeEntanglementTurn(ally, text => log(s, text), session);
        if (Number.isFinite(ally._temporaryOwnTurnsRemaining)) {
          ally._temporaryOwnTurnsRemaining = Math.max(0, ally._temporaryOwnTurnsRemaining - 1);
          if (ally._temporaryOwnTurnsRemaining === 0 && !ally._temporaryDisappearNotified) {
            ally._temporaryDisappearNotified = true;
            ally.hp = 0;
            ally.turnMeter = 0;
            const owner = (s.players || []).find(unit => unit?.id === ally.summonerId) || s.players?.[0] || null;
            log(s, `⌛ ${ally.name || 'Временный союзник'} исчезает.`);
            notifyFriendlyTemporarySummonDisappeared(owner, session, text => log(s, text), {
              kind: ally.summonKind,
              reason: 'duration',
              template: ally._summonTemplate || ally._temporarySummonTemplate,
              temporary: true,
              vanishedUnit: ally,
              lastEchoCopy: Boolean(ally._lastEchoCopy),
            });
          }
        }
      }
      steps += 1; continue;
    }

    if (actorInfo.type === "player") {
      session._processingEnemyTurn = false;
      (s.enemies || []).forEach(unit => {
        if (!unit?._bloomArchonPreparationAwaitingResponse) return;
        unit.turnMeter = 0;
        delete unit._bloomArchonPreparationAwaitingResponse;
      });
      resetTurnControl(session);
      const playerTurn = beginPlayerTurn(session, text => log(s, text));
      ensureInitiativeState(session).playerReady = !playerTurn.defeated;
      return { session, turnReports };
    }

    const enemy = actorInfo.unit;
    session._processingEnemyTurn = true;
    if (s.players?.[0]) s.players[0]._enemyTurnLightningPositive = false;
    resetEquipmentTurnFlags(enemy);
    if (!enemy || enemy.hp <= 0) {
      steps += 1;
      continue;
    }

    const playerGroup = (s.players || []).filter(unit => unit && unit.hp > 0);

    const beforeLogLength = s.log.length;
    const hpAtActionStart = playerGroup[0]?.hp ?? null;
    const metricBefore = { ...(s.metrics || {}) };
    const enemyTempoBeforeAction = new Map(
      (s.enemies || []).filter(Boolean).map(unit => [combatUnitId(unit), Math.max(0, Number(unit.turnMeter) || 0)])
    );
    const preparationAtTurnStart = enemy._preparation ? { kind: enemy._preparation.kind || null, name: enemy._preparation.resolveName || enemy._preparation.name || null, hits: Math.max(1, enemy._preparation.hits || 1) } : null;
    let reportedAbility = preparationAtTurnStart ? { name: preparationAtTurnStart.name || preparationAtTurnStart.kind, artId: preparationAtTurnStart.kind } : null;
    const pushReport = (fallbackMessage = null) => {
      (s.enemies || []).filter(unit => unit?.hp > 0).forEach(unit => {
        const id = combatUnitId(unit);
        const before = enemyTempoBeforeAction.get(id);
        if (!Number.isFinite(before)) return;
        const gained = Math.max(0, (Number(unit.turnMeter) || 0) - before);
        if (gained > 0) session.notifyPositiveTempoChange?.(unit, gained, {
          source: enemy,
          reason: 'enemy_action_turn_meter_gain',
          natural: false,
        });
      });
      const lines = s.log.slice(beforeLogLength);
      const metrics = s.metrics || {};
      const report = {
        enemyId: enemy.id, enemyName: enemy.name,
        actorId: enemy.id, actorName: enemy.name,
        abilityId: reportedAbility?.artId || reportedAbility?.enemyArtId || reportedAbility?.presetKey || reportedAbility?.name || null,
        abilityName: reportedAbility?.name || null,
        preparationResolution: preparationAtTurnStart,
        directHits: Math.max(0, (metrics.directHits || 0) - (metricBefore.directHits || 0)),
        directDamage: Math.max(0, (metrics.directDamageEnemiesToPlayer || 0) - (metricBefore.directDamageEnemiesToPlayer || 0)),
        periodicDamage: Math.max(0, (metrics.periodicDamageEnemiesToPlayer || 0) - (metricBefore.periodicDamageEnemiesToPlayer || 0)),
        shieldAbsorbed: Math.max(0, (metrics.shieldAbsorbed || 0) - (metricBefore.shieldAbsorbed || 0)),
        hpBefore: hpAtActionStart,
        hpAfter: s.players?.[0]?.hp ?? null,
        death: Boolean(hpAtActionStart > 0 && (s.players?.[0]?.hp || 0) <= 0),
      };
      if (lines.length > 0) {
        turnReports.push({ ...report, lines });
        return;
      }
      const defaultLine = fallbackMessage || `${enemy.name} не совершает заметных действий.`;
      turnReports.push({ ...report, lines: [defaultLine] });
    };

    triggerBloomArchonPetalShedding(enemy, session, text => log(s, text));
    processForeignSignalHelmet(enemy, session, text => log(s, text));

    processEffects(enemy, t => log(s, t), {
      onEffectTick: ({ effectId }) => { if (effectId === 'bleed') registerMinesBleedTick(session); },
      applyDamage: (unit, amount, type, extra = {}) =>
        applyDamage(unit, amount, type, { ...extra, logFn: text => log(s, text), session }),
      applyHealing: (unit, amount) => applyHealing(unit, amount, { session }),
      getAllies: () => s.enemies,
      getOpponents: () => s.players,
      session,
      log: text => log(s, text),
    });
    if (enemy.hp > 0 && enemy._pendingRuinsEcho) {
      resolvePendingRuinsEcho(enemy, session, text => log(s, text));
    } else if (enemy.hp <= 0) {
      delete enemy._pendingRuinsEcho;
    }
    resolveRuinsPreparedAction(enemy, session);
    flushRuinsSouls(session);
    tickCooldowns(enemy);

    enemy.turnDelay = enemy.turnDelay ?? 0;
    if (enemy.turnDelay >= 1) {
      enemy.turnDelay = Math.max(0, enemy.turnDelay - 1);
      log(s, `⏳ ${enemy.name} замедлен и пропускает ход.`);
      completeEntanglementTurn(enemy, text => log(s, text), session);
      pushReport(`${enemy.name} теряет время и не действует.`);
      finalizeStormConductorTurn(session, text => log(s, text));
      session._processingEnemyTurn = false;
      steps += 1;
      continue;
    }

    if (enemy.hp <= 0) {
      pushReport(`${enemy.name} погиб от эффектов.`);
      steps += 1;
      continue;
    }

    const playerTarget = (s.players || []).find(unit => unit && unit.hp > 0);
    if (!playerTarget) {
      pushReport(`${enemy.name} не находит противников.`);
      steps += 1;
      break;
    }

    if (enemy.prostrated) {
      if (enemy._preparation && !enemy.controlImmune) {
        enemy._preparation = null;
        log(s, `👑 Преклонение срывает подготовку ${enemy.name}.`);
      }
      log(s, `👑 ${enemy.name} пребывает в Преклонении и пропускает ход.`);
      completeEntanglementTurn(enemy, text => log(s, text), session);
      pushReport();
      finalizeStormConductorTurn(session, text => log(s, text));
      session._processingEnemyTurn = false;
      steps += 1;
      continue;
    }

    if (enemy.stunned) {
      if (enemy._preparation && !enemy.controlImmune) {
        enemy._preparation = null;
        log(s, `💫 Контроль срывает подготовку ${enemy.name}.`);
      }
      log(s, `💫 ${enemy.name} оглушён и пропускает ход.`);
      enemy.stunned = false;
      completeEntanglementTurn(enemy, text => log(s, text), session);
      pushReport();
      finalizeStormConductorTurn(session, text => log(s, text));
      session._processingEnemyTurn = false;
      steps += 1;
      continue;
    }

    if (enemy.pendingShockSkip) {
      if (enemy._preparation && !enemy.controlImmune) {
        enemy._preparation = null;
        log(s, `⚡ Контроль срывает подготовку ${enemy.name}.`);
      }
      const shockSourceId = enemy._pendingShockSourceId || null;
      enemy.pendingShockSkip = false;
      enemy._pendingShockSourceId = null;
      log(s, `⚡ ${enemy.name} парализован шоком и не может действовать.`);
      completeEntanglementTurn(enemy, text => log(s, text), session);
      const elementalist = findElementalistOwnerForSourceId(shockSourceId, session, 'lightning_speed');
      if (elementalist) triggerLightningSpeedFromShockSkip(elementalist, session, text => log(s, text));
      pushReport();
      finalizeStormConductorTurn(session, text => log(s, text));
      session._processingEnemyTurn = false;
      steps += 1;
      continue;
    }

    triggerPreparedFieldTrap(session, enemy, text => log(s, text),
      (victim, raw, type, source, school = null) => applyDamage(victim, raw, type, {
        source, session, logFn: text => log(s, text), magicSchool: school,
        directAttack: true,
      }),
      summonBurialSealSoul);
    // A trap can kill the enemy before its action; do not process its AI turn.
    if (enemy.hp <= 0) {
      pushReport();
      session._processingEnemyTurn = false;
      steps += 1;
      continue;
    }
    const heroBeforeAction = s.players?.[0];
    if (isArcherUnit(heroBeforeAction)) {
      triggerArcherTrap(heroBeforeAction, enemy, session, text => log(s, text), 'before_action');
      if (enemy._archerTrapCancelledAction) {
        delete enemy._archerTrapCancelledAction;
        log(s, `🪤 Капкан отменяет действие ${enemy.name}.`);
        completeEntanglementTurn(enemy, text => log(s, text), session);
        pushReport();
        finalizeStormConductorTurn(session, text => log(s, text));
        session._processingEnemyTurn = false;
        steps += 1;
        continue;
      }
    }

    triggerPassiveTurnStart(enemy, session, text => log(s, text));
    const preparationKind = enemy._preparation?.kind || null;
    const resolvedPreparation = resolveEnemyPreparation(enemy, session, text => log(s, text));
    if (enemy.hp <= 0 || !(s.players || []).some(unit => unit?.hp > 0)) {
      pushReport();
      steps += 1;
      continue;
    }

    let acted = preparationKind === 'bloom_archon_burial' && resolvedPreparation;
    let redirectReturnShotArcher = null;
    const preparationBeforeAction = Boolean(enemy._preparation);
    const selectedAction = acted ? null : selectEnemyAction(enemy, session);
    for (const decision of selectedAction ? [selectedAction] : []) {
      const { ability, targets, primary } = decision;
      const overgrowthAtStart = captureOvergrowth(enemy);
      reportedAbility = ability;
      let targetList = Array.isArray(targets) && targets.length > 0 ? targets : primary ? [primary] : [];
      let currentTarget = primary || targetList[0] || playerTarget || null;
      const primaryPreparedForSecondary = currentTarget ? isPreparedForFireballSplash(currentTarget) : false;
      let primaryHit = false;

      if (!currentTarget && ability.targeting !== 'self' && ability.target !== 'self') {
        continue;
      }

      let baseDamage = resolveDamageValue(ability, enemy, currentTarget || enemy, session);
      const redirect = consumeArcherRedirect(enemy, currentTarget, ability, baseDamage, session, text => log(s, text));
      if (redirect.returnShot) redirectReturnShotArcher = redirect.archer;
      if (redirect.dodged) {
        ability.currentCooldown = ability.cooldown ?? 2;
        consumeOvergrowthAfterAction(enemy, ability, overgrowthAtStart, text => log(s, text));
        acted = true; break;
      }
      if (redirect.target !== currentTarget) { currentTarget = redirect.target; targetList = [currentTarget]; baseDamage = resolveDamageValue(ability, enemy, currentTarget, session); }
      const betrayalTarget = consumeBetrayalRedirectTarget(enemy, session, ability, baseDamage, text => log(s, text));
      if (betrayalTarget) {
        currentTarget = betrayalTarget;
        targetList = [betrayalTarget];
        baseDamage = resolveDamageValue(ability, enemy, betrayalTarget, session);
      }
      const deliberateAction = { actorId: enemy.id, ability: ability.name, sequence: steps };
      const ruinsCharged = enemy.location === 'Руины Неупокоенных' &&
        !ability.basic && !ability.passive && getEffectStackCount(enemy, 'ruins_echo_charge') > 0;
      const ruinsEchoBefore = ruinsCharged ? snapshotRuinsEchoApplyState(session) : null;
      if (ruinsCharged) {
        consumeEffectStacks(enemy, 'ruins_echo_charge', 1);
        deliberateAction.ruinsEchoEligible = true;
        ensureRuinsEchoSnapshot(deliberateAction);
        enemy._ruinsCaptureEcho = true;
      }
      if (baseDamage > 0 && currentTarget && currentTarget !== enemy) {
        prepareEternalSentinelAgainstAction(currentTarget, enemy, deliberateAction, session, text => log(s, text));
        beginInvisibleAttack(enemy, ability, deliberateAction, text => log(s, text));
      }
      const directlyAttackedPlayers = new Set();
      if (enemy.name === 'Мастер клинков' && ability.name === 'Точный выпад') {
        s.metrics ||= {}; s.metrics.preciseStrikeUses = (s.metrics.preciseStrikeUses || 0) + 1;
      }
      if (betrayalTarget?.nonActingCombatObject) deliberateAction.safeCombatObjectId = betrayalTarget.id;
      deliberateAction.vampireHealingBefore = enemy._vampireHealingTotal || 0;
      deliberateAction.suppressRhythm = Boolean(ability.consumesRhythm);
      recordCombatPresentationEvent(session, { type: "actionStart", actor: enemy, action: ability });
      const requiresHit = abilityRequiresHitCheck(ability, baseDamage);
      let hitInfo = { hit: true, chance: 1 };
      if (requiresHit && currentTarget) {
        hitInfo = determineHitOutcome(enemy, currentTarget, ability, session);
      }

      if (requiresHit && !hitInfo.hit) {
        if (isArcherUnit(currentTarget) && hasEquippedClassPassive(currentTarget, 'false_trail')) currentTarget._falseTrailReady = true;
        log(
          s,
          formatMissLog({ attacker: enemy, target: currentTarget, ability, hitInfo, context: 'enemyAbility' })
        );
        triggerTargetedDirectMiss(currentTarget, enemy, session, text => log(s, text));
        if ((s.players || []).includes(currentTarget)) directlyAttackedPlayers.add(currentTarget);
        directlyAttackedPlayers.forEach(unit => registerDefenderEnemyAttackAction(unit, enemy));
        ability.currentCooldown = ability.cooldown ?? 2;
        consumeOvergrowthAfterAction(enemy, ability, overgrowthAtStart, text => log(s, text));
        acted = true;
        break;
      }

      ability.currentCooldown = ability.cooldown ?? 2;
      if (!requiresHit || hitInfo.hit) {
        applyArcherRedirectHuntingMark(redirect, currentTarget, deliberateAction, text => log(s, text));
      }
      let absorbed = 0;
      if (!requiresHit || hitInfo.hit) {
        const hitCount = Math.max(1, ability.hitCount ?? ability.hits ?? 1);
        for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
          deliberateAction.ruinsHitIndex = hitIndex;
          if (!canUnitContinueAction(enemy)) break;
          if (currentTarget && currentTarget.hp <= 0) break;
          if (baseDamage > 0 && currentTarget) {
            if ((s.players || []).includes(currentTarget)) directlyAttackedPlayers.add(currentTarget);
            const result = performDirectDamage({
              attacker: enemy,
              ability,
              target: currentTarget,
              baseDamage,
              session,
              logFn: text => log(s, text),
              opposingGroup: betrayalTarget
                ? (s.enemies || []).filter(unit => unit && unit !== enemy && unit.hp > 0)
                : playerGroup,
              allowCritical: true,
              deferReactions: true,
              deliberateAction,
            });
            deliberateAction.shieldDestroyed = (deliberateAction.shieldDestroyed || 0) + (result.shieldDestroyed || 0);
            deliberateAction.actualHpDamage = (deliberateAction.actualHpDamage || 0) + (result.actualHpLost || 0);
            deliberateAction.targetHadShield = deliberateAction.targetHadShield || (result.shieldDestroyed || result.absorbed || 0) > 0;
            absorbed = result.absorbed || currentTarget.lastAbsorbed || 0;
          } else if (hitIndex === 0) {
            const shieldNote = absorbed > 0 ? `Щит ${(currentTarget && currentTarget.name) || 'цели'} нейтрализует урон.` : "";
            log(s, `👹 ${enemy.name} использует "${ability.name}". ${shieldNote}`.trim());
          }

          primaryHit = Boolean(currentTarget);
          const effectDescriptors = resolveAbilityEffect(ability.effect, {
            attacker: enemy,
            target: currentTarget,
            primary: currentTarget,
            targets: targetList,
          });
          applyEffectsToTargets(effectDescriptors, {
            attacker: enemy,
            primaryTarget: currentTarget,
            opposingGroup: (s.players || []).filter(unit => unit && unit.hp > 0),
            alliedGroup: (s.enemies || []).filter(unit => unit && unit.hp > 0),
            logFn: text => log(s, text),
            session,
          });
          if (currentTarget) {
            flushPendingDamageReactions(currentTarget);
          }
          if (!canUnitContinueAction(enemy)) break;
        }

        if (canUnitContinueAction(enemy)) {
          const selfDescriptors = resolveAbilityEffect(ability.selfEffects, {
            attacker: enemy,
            target: enemy,
            primary: enemy,
            targets: [enemy],
          });
          applyEffectsToTargets(selfDescriptors, {
            attacker: enemy,
            primaryTarget: enemy,
            opposingGroup: (s.players || []).filter(unit => unit && unit.hp > 0),
            alliedGroup: (s.enemies || []).filter(unit => unit && unit.hp > 0),
            logFn: text => log(s, text),
            session,
          });
        }

        if (canUnitContinueAction(enemy) && ability.secondary) {
          const secondary = ability.secondary;
          const scope = secondary.target || "otherEnemies";
          let secondaryTargets = [];
          const opponents = (s.players || []).filter(unit => unit && unit.hp > 0);
          if (betrayalTarget && scope !== 'target') {
            secondaryTargets = [];
          } else if (betrayalTarget && scope === 'target') {
            secondaryTargets = [betrayalTarget];
          } else if (scope === "allEnemies") {
            secondaryTargets = opponents;
          } else if (scope === "otherEnemies") {
            secondaryTargets = opponents.filter(unit => unit !== currentTarget);
          } else if (scope === "target") {
            secondaryTargets = currentTarget ? [currentTarget] : [];
          }
          secondaryTargets.forEach(secTarget => {
            if (
              typeof secondary.condition === "function" &&
              !secondary.condition({
                attacker: enemy,
                target: secTarget,
                primary: currentTarget,
                targets: targetList,
                session,
                primaryHit,
                primaryPrepared: primaryPreparedForSecondary,
              })
            ) {
              return;
            }
            let secDamage =
              typeof secondary.damage === "function"
                ? secondary.damage({
                    attacker: enemy,
                    target: secTarget,
                    primary: currentTarget,
                    targets: targetList,
                    session,
                    primaryHit,
                    primaryPrepared: primaryPreparedForSecondary,
                  })
                : secondary.damage ?? 0;
            if (!enemy.passivesDisabled) {
              (enemy.abilities || []).forEach(passive => {
                if (!passive?.passive || !passive.modifySecondaryDamage || typeof passive.modifyDamage !== 'function') return;
                const modified = passive.modifyDamage({
                  damage: secDamage, attacker: enemy, target: secTarget,
                  ability: { ...ability, isSecondaryDamage: true }, session,
                });
                if (Number.isFinite(modified)) secDamage = modified;
              });
            }
            if (secDamage <= 0) return;
            if ((s.players || []).includes(secTarget)) directlyAttackedPlayers.add(secTarget);
            performDirectDamage({
              attacker: enemy,
              ability: {
                ...ability,
                name: secondary.name || ability.name,
                type: secondary.type || ability.type,
                school: secondary.school || ability.school,
                schoolResolver: secondary.schoolResolver || ability.schoolResolver,
                targeting: scope === 'allEnemies' || scope === 'otherEnemies' ? 'allEnemies' : ability.targeting,
                isSecondaryDamage: true,
              },
              target: secTarget,
              baseDamage: secDamage,
              session,
              logFn: text => log(s, text),
              opposingGroup: playerGroup,
              allowCritical: secondary.allowCritical !== false,
              deferReactions: true,
              deliberateAction: ruinsCharged ? deliberateAction : null,
            });
            const secondaryEffects = resolveAbilityEffect(secondary.effects, {
              attacker: enemy,
              target: secTarget,
              primary: currentTarget,
              targets: targetList,
            });
            applyEffectsToTargets(secondaryEffects, {
              attacker: enemy,
              primaryTarget: secTarget,
              opposingGroup: opponents,
              alliedGroup: (s.enemies || []).filter(unit => unit && unit.hp > 0),
              logFn: text => log(s, text),
              session,
            });
            flushPendingDamageReactions(secTarget);
          });
        }
        const shieldedSecondary = (enemy.abilities || []).find(passive => passive?.passive && passive.shieldedAttackSecondary)?.shieldedAttackSecondary;
        if (canUnitContinueAction(enemy) && primaryHit && shieldedSecondary && (enemy.shield || 0) > 0 && currentTarget?.hp > 0 && baseDamage > 0) {
          performDirectDamage({
            attacker: enemy, target: currentTarget, session, logFn: text => log(s, text), opposingGroup: playerGroup,
            allowCritical: false, deliberateAction,
            ability: { name: 'Проводимость искажения', type: 'magical', school: shieldedSecondary.school, isSecondaryDamage: true },
            baseDamage: (enemy.magAtk || 0) * shieldedSecondary.multiplier,
          });
        }
        if (primaryHit && deliberateAction.targetHadShield && ability.shockIfTargetShielded && combatRng(session)() < ability.shockIfTargetShielded.chance) {
          addEffect(currentTarget, { id: 'shock', duration: ability.shockIfTargetShielded.duration || 1 }, text => log(s, text), enemy, { session });
        }
      }

      if (canUnitContinueAction(enemy) && typeof ability.apply === "function") {
        ability.apply({
          attacker: enemy,
          target: currentTarget || targetList[0] || enemy,
          targets: targetList.length > 0 ? targetList : [currentTarget || enemy],
          session,
          deliberateAction,
          heal: (target, amount) => applyHealing(target, amount, { source: enemy, session, logFn: text => log(s, text) }),
          applyDirectDamage: (unit, amount, overrides = {}) => performDirectDamage({
            attacker: enemy, target: unit, baseDamage: amount, session,
            ability: { ...ability, ...overrides, isSecondaryDamage: true },
            logFn: text => log(s, text), opposingGroup: playerGroup,
            allowCritical: true, deferReactions: false, deliberateAction,
          }),
          log: text => log(s, text),
        });
      }

      if (ruinsCharged) {
        if (enemy.hp > 0) {
          captureRuinsEchoApplyDiff(deliberateAction, ruinsEchoBefore, session);
          if (ruinsEchoHasPayload(deliberateAction.ruinsEchoSnapshot)) {
            enemy._pendingRuinsEcho = {
              abilityName: ability.name, ...cloneEchoSnapshot(deliberateAction.ruinsEchoSnapshot),
              efficiency: ECHO_BASE_EFFICIENCY, source: 'ruins_enemy', heroOwned: false, suppressRecursion: true,
            };
          }
        }
        enemy._ruinsCaptureEcho = false;
      }
      if (canUnitContinueAction(enemy) && ability.forestBloodFeast && (deliberateAction.actualHpDamage || 0) > 0) {
        const bleed = getBleedStacks(currentTarget);
        const ratio = Math.min(WITHERING_FOREST_TUNING.predatorBloodFeastLifestealCap,
          WITHERING_FOREST_TUNING.predatorBloodFeastBaseLifesteal + bleed * WITHERING_FOREST_TUNING.predatorBloodFeastLifestealPerBleed);
        applyHealing(enemy, Math.round(deliberateAction.actualHpDamage * ratio), {
          source: enemy, session, deliberateAction, logFn: text => log(s, text),
        });
      }

      grantAttackActionRhythm(enemy, deliberateAction, session, text => log(s, text));
      directlyAttackedPlayers.forEach(unit => registerDefenderEnemyAttackAction(unit, enemy));
      if (!preparationBeforeAction && enemy._preparation) (s.players || []).filter(unit => unit?.hp > 0 && hasEquipped(unit, EQUIPMENT_EFFECTS.DESERTER_BOOTS) && canUseEquipmentTurnFlag(unit, 'deserterBootsPreparation')).forEach(unit => { unit.turnMeter = Math.min(TURN_METER_THRESHOLD, (unit.turnMeter || 0) + 100); });

      consumeOvergrowthAfterAction(enemy, ability, overgrowthAtStart, text => log(s, text));
      acted = true;
      break;
    }

    if (!acted) {
      reportedAbility = { name: 'Атака', basic: true };
      const fallbackResult = performEnemyBasicAttackFallback({
        enemy,
        target: playerTarget,
        session,
        playerGroup,
        logFn: text => log(s, text),
      });
      acted = fallbackResult.acted;
      if (fallbackResult.returnShotArcher) redirectReturnShotArcher = fallbackResult.returnShotArcher;
    }

    if (redirectReturnShotArcher && enemy.hp > 0) {
      triggerArcherRedirectReturnShot(redirectReturnShotArcher, enemy, session, text => log(s, text));
    }

    const hero = s.players?.[0];
    if (acted) {
      if (hero) hero._enemyCompletedFullTurn = true;
    }
    finalizeStormConductorTurn(session, text => log(s, text));
    flushRuinsSouls(session);
    session._processingEnemyTurn = false;
    if (isArcherUnit(hero)) { hero._initiativeStacks = 0; hero._archerTurnStreak = 0; triggerArcherTrap(hero, enemy, session, text => log(s, text), 'after_action'); }
    completeEntanglementTurn(enemy, text => log(s, text), session);
    pushReport();
    steps += 1;

    const outcome = evaluateBattleStatus(session);
    if (outcome.victory || outcome.defeat) {
      resetTurnControl(session);
      return { session, turnReports };
    }
  }

  resetTurnControl(session);
  return { session, turnReports };
}


// === Враги ===

// === Использование предметов ===
export function toggleBlackVeinLantern(session, enabled = null) {
  const player = session?.state?.players?.[0];
  if (
    !player ||
    !hasEquipped(player, EQUIPMENT_EFFECTS.BLACK_VEIN_LANTERN) ||
    ensureInitiativeState(session).playerReady === false
  ) {
    return {
      session,
      changed: false,
      enabled: Boolean(player?._blackVeinLanternEnabled),
      itemUsed: false,
      turnConsumed: false,
    };
  }
  const next = typeof enabled === 'boolean' ? enabled : !Boolean(player._blackVeinLanternEnabled);
  player._blackVeinLanternEnabled = next;
  return { session, changed: true, enabled: next, itemUsed: false, turnConsumed: false };
}

export function applyItemInCombat(session, itemName, options = {}) {
  const s = session.state;
  const player = s.players[0];
  if (!player) {
    return { session, itemUsed: false, turnConsumed: false };
  }

  const initiative = ensureInitiativeState(session);
  if (!initiative.playerReady) {
    log(s, "⏳ Сейчас не ваш ход для использования предметов.");
    return { session, itemUsed: false, turnConsumed: false };
  }

  const index = player.items.findIndex(i => i.name === itemName);
  const equipmentDef = equipmentByName[itemName] || null;
  const activeEquipment = Boolean(
    index === -1 &&
    equipmentDef?.mechanicTags?.includes('active_equipment') &&
    hasEquipped(player, itemName)
  );
  if (index === -1 && !activeEquipment) {
    log(s, `❌ Нет предмета "${itemName}".`);
    return { session, itemUsed: false, turnConsumed: false };
  }

  const turnControl = getTurnControl(session);
  const freeActiveEquipment = activeEquipment && itemName === EQUIPMENT_EFFECTS.BURNED_MEMORY_STAFF;
  if (turnControl.itemUsed && !freeActiveEquipment) {
    log(s, `⚠️ ${player.name} уже использовал предмет в этот ход.`);
    return { session, itemUsed: false, turnConsumed: false };
  }

  if (!combatItemConsumesTurn(itemName)) {
    if (turnControl.started) {
      const turnInfo = beginPlayerTurn(session, text => log(s, text), { tickCooldowns: false });
      if (turnInfo.defeated) {
        log(s, `☠️ ${player.name} пал от эффектов и не может использовать предмет.`);
        return { session, itemUsed: false, turnConsumed: true };
      }
  
      if (turnInfo.stunned) {
        log(s, `😵 ${player.name} оглушён и не может воспользоваться предметом.`);
        return { session, itemUsed: false, turnConsumed: true };
      }
    } else {
      if (player.hp <= 0) {
        log(s, `☠️ ${player.name} не может пользоваться предметами будучи без сознания.`);
        return { session, itemUsed: false, turnConsumed: true };
      }
      if (player.stunned) {
        log(s, `😵 ${player.name} оглушён и не может воспользоваться предметом.`);
        return { session, itemUsed: false, turnConsumed: true };
      }
    }
  }

  if (activeEquipment) {
    beginCombatPresentation(session);
    recordCombatPresentationEvent(session, { type: "actionStart", actor: player, action: equipmentDef });
    if (itemName === EQUIPMENT_EFFECTS.ALLKING_SIGNET) {
      const result = activateAllkingSignet(session, player);
      if (!result.success) {
        const reasonText = result.reason === 'cooldown'
          ? `Печатка ещё восстанавливается (${player._allkingSignetCooldown || 0}).`
          : result.reason === 'already_active'
            ? 'Королевский палач уже находится на поле.'
            : result.reason === 'no_slot'
              ? 'Нет свободного места для Королевского палача.'
              : 'Печатку сейчас нельзя использовать.';
        log(s, `⚠️ ${reasonText}`);
        return { session, itemUsed: false, turnConsumed: false, activeEquipment: true };
      }
      turnControl.itemUsed = true;
      return { session, itemUsed: true, turnConsumed: false, activeEquipment: true };
    }
    if (itemName === EQUIPMENT_EFFECTS.BURNED_MEMORY_STAFF) {
      const result = activateBurnedMemoryStaff(session, player, options.targetIndex ?? 0);
      if (!result.success) {
        const reasonText = result.reason === 'cooldown'
          ? `Посох ещё восстанавливается (${player._burnedMemoryStaffCooldown || 0}).`
          : result.reason === 'empty'
            ? 'Посоху нечего вспоминать: в предыдущем собственном ходу не накоплен прямой магический урон.'
            : result.reason === 'no_target'
              ? 'Нет живой цели для «Вспомнить свет».'
              : 'Посох сейчас нельзя использовать.';
        log(s, `⚠️ ${reasonText}`);
        return { session, itemUsed: false, turnConsumed: false, activeEquipment: true, freeActiveEquipment: true };
      }
      return { session, itemUsed: true, turnConsumed: false, activeEquipment: true, freeActiveEquipment: true };
    }
    log(s, `⚠️ У ${itemName} нет доступной активной способности.`);
    return { session, itemUsed: false, turnConsumed: false, activeEquipment: true };
  }

  const itemDef = getItemDefinition(itemName);
  const consumesTurn = combatItemConsumesTurn(itemName);
  if (consumesTurn) {
    const turnInfo = beginPlayerTurn(session, text => log(s, text));
    if (turnInfo.defeated || turnInfo.stunned || player.prostrated || player.pendingShockSkip || player.turnDelay >= 1) {
      if (player.pendingShockSkip) player.pendingShockSkip = false;
      else if (player.turnDelay >= 1) player.turnDelay = Math.max(0, player.turnDelay - 1);
      completeEntanglementTurn(player, text => log(s, text), session);
      initiative.playerReady = false;
      return { session, itemUsed: false, turnConsumed: true };
    }
  }
  beginCombatPresentation(session);
  recordCombatPresentationEvent(session, { type: "actionStart", actor: player, action: itemDef || { name: itemName } });
  let used = false;

  if (!itemDef) {
    log(s, `📦 ${player.name} использует ${itemName}, но ничего не происходит.`);
    used = true;
  } else if (itemDef.type === 'preparedTrap') {
    if (player.preparedTrap) return { session, itemUsed: false, turnConsumed: false };
    player.preparedTrap = itemName;
    turnControl.itemUsed = true;
    completeEntanglementTurn(player, text => log(s, text), session);
    initiative.playerReady = false;
    log(s, `Ловушка «${itemName}» установлена. Она сработает перед следующим действием противника.`);
    return { session, itemUsed: true, turnConsumed: true };
  } else if (itemDef.type === 'tacticalScroll') {
    const eligible = getEligibleHostileUnits(s.enemies || []);
    const target = s.enemies[options.targetIndex ?? 0];
    if (!eligible.includes(target)) return { session, itemUsed: false, turnConsumed: false };
    if (itemDef.control && isFieldControlImmune(target)) {
      log(s, `${target.name} невосприимчив к контролю.`);
      return { session, itemUsed: false, turnConsumed: false };
    }
    const kind = itemDef.kind || null;
    const opponentGroup = (s.enemies || []).filter(unit => unit && unit.hp > 0 && !unit.nonActingCombatObject);
    const report = text => log(s, text);
    const add = (recipient, id, duration, extra = {}) =>
      addEffect(recipient, { id, duration, ...extra }, report, player, { session });
    const stat = Math.max(0, Number(player.attack) || 0, Number(player.magAtk) || 0);
    const strike = (victim, coefficient, school = null, type = 'magical') => {
      if (!victim || victim.hp <= 0) return 0;
      const amount = Math.max(0, Math.round(stat * coefficient));
      return applyDamage(victim, amount, type, {
        source: player, session, logFn: report,
        magicSchool: school, directAttack: true,
      });
    };

    if (kind === 'vulnerabilityStrike') {
      const base = player.baseStats || player;
      const physical = (Number(base.attack ?? player.attack) || 0) >= (Number(base.magAtk ?? player.magAtk) || 0);
      add(player, physical ? 'attack_boost_minor' : 'magic_attack_boost_minor', 2);
      add(target, physical ? 'phys_def_penalty_minor' : 'magic_def_penalty_minor', 2);
      // This strike includes the just-applied buff, but does not trigger class-ability talents.
      const buffed = Number(physical ? player.attack : player.magAtk) || 0;
      applyDamage(target, Math.round(Math.max(0, buffed)), physical ? 'physical' : 'magical', {
        source: player, session, logFn: report, directAttack: true,
      });
    } else if (kind === 'shieldTheft') {
      if (!opponentGroup.some(unit => (unit.shield || 0) > 0)) return { session, itemUsed: false, turnConsumed: false };
      const drainHalf = victim => {
        const removed = Math.ceil(Math.max(0, victim.shield || 0) / 2);
        if (!removed) return 0;
        consumeShieldEffectBookkeeping(victim, removed);
        victim.shield = Math.max(0, victim.shield - removed);
        removeDepletedShieldEffects(victim);
        return removed;
      };
      const stolen = drainHalf(target);
      opponentGroup.filter(victim => victim !== target).forEach(drainHalf);
      if (stolen > 0) addEffect(player, { id: 'shield', value: stolen, duration: 2 }, report, player, { session });
      report(`📜 Кража щита: ${target.name} теряет половину Щита, герой получает ${stolen} Щита.`);
    } else if (kind === 'dispelAll') {
      let removed = 0;
      // The helper respects unremovable effects and refuses innate properties.
      for (let i = 0; i < 50; i += 1) {
        if (!removeRandomPositiveEffect(target, options.rng || combatRng(session), report)) break;
        removed += 1;
      }
      if (!removed) return { session, itemUsed: false, turnConsumed: false };
    } else if (kind === 'fireball') {
      opponentGroup.forEach(victim => strike(victim, 1.2, MAGIC_SCHOOLS.FIRE));
      if (target.hp > 0) add(target, 'burn', 2);
    } else if (kind === 'poisonCloud') {
      opponentGroup.forEach(victim => {
        strike(victim, 0.5, MAGIC_SCHOOLS.NATURE);
        if (victim.hp > 0) add(victim, 'poison', 2);
      });
    } else if (kind === 'iceCone') {
      opponentGroup.forEach(victim => {
        const main = victim === target;
        strike(victim, main ? 0.5 : 0.25, MAGIC_SCHOOLS.ICE);
        if (victim.hp <= 0) return;
        victim.turnMeter = Math.max(0, (victim.turnMeter || 0) - (main ? 300 : 150));
        if (!isFieldControlImmune(victim)) add(victim, main ? 'speed_penalty_major' : 'speed_penalty_minor', 2);
      });
    } else if (kind === 'bloodTouch') {
      add(target, 'vampire_mark', 2); // Apply first so the opening strike heals immediately.
      strike(target, 1.5, MAGIC_SCHOOLS.BLOOD);
      if (target.hp > 0) add(target, 'bleed', 1);
    } else if (kind === 'clingingRoots') {
      opponentGroup.forEach(victim => {
        victim.turnMeter = Math.max(0, (victim.turnMeter || 0) - 150);
        if (!isFieldControlImmune(victim) && !victim.entanglementImmune)
          addEffect(victim, { id: 'entanglement', stacks: 3 }, report, player, { session });
      });
    } else {
      if (itemDef.shieldRemoval) {
        const removed = Math.min(Math.max(0, target.shield || 0), itemDef.shieldRemoval);
        if (!removed) return { session, itemUsed: false, turnConsumed: false };
        consumeShieldEffectBookkeeping(target, removed);
        target.shield -= removed;
        removeDepletedShieldEffects(target);
      }
      if (itemDef.dispelCount && !removeRandomPositiveEffect(target, options.rng || combatRng(session), report))
        return { session, itemUsed: false, turnConsumed: false };
      if (itemDef.turnMeterReduction) target.turnMeter = Math.max(0, (target.turnMeter || 0) - itemDef.turnMeterReduction);
      (itemDef.effects || []).forEach(effect => addEffect(target, { ...effect }, report, player, { session }));
    }
    log(s, `${player.name} использует ${itemName} на ${target.name}.`);
    used = true;
  } else if (itemDef.type === "heal") {
    const target = player;
    const amount = itemDef.amount ?? Math.round((target.maxHp ?? 0) * (itemDef.percent ?? 0));
    if (amount > 0) {
      const restored = applyHealing(target, amount, { source: player, session });
      log(s, `💊 ${itemName} восстанавливает ${target.name || player.name} ${restored} здоровья.`);
      const overheal = Math.max(0, Math.round(amount) - restored);
      if (overheal > 0 && hasEquipped(player, EQUIPMENT_EFFECTS.QUARTERMASTER_TOKEN)) {
        const shieldValue = Math.min(
          Math.round(overheal * 0.5),
          Math.round((player.maxHp || 0) * 0.15)
        );
        if (shieldValue > 0) {
          addEffect(player, { id: 'shield', duration: 2, value: shieldValue }, text => log(s, text), player, { session });
          log(s, '📿 ' + EQUIPMENT_EFFECTS.QUARTERMASTER_TOKEN + ' превращает избыточное лечение в ' + shieldValue + ' Щита.');
        }
      }
      if (Array.isArray(itemDef.effects)) {
        itemDef.effects.forEach(effect => {
          const applied = addEffect(target, effect, text => log(s, text), player, { session });
          if (applied?.id === 'regeneration') {
            log(s, `💊 ${itemName} накладывает Регенерацию на ${target.name || player.name}.`);
          }
        });
      }
      (itemDef.removeEffects || []).forEach(removal => {
        const ids = new Set(removal?.ids || (removal?.id ? [removal.id] : []));
        const count = Math.max(0, Math.floor(Number(removal?.count) || 0));
        for (let index = 0; index < count; index += 1) {
          const effectInstance = (target.effects || []).find(effect => ids.has(effect?.id));
          if (!effectInstance) break;
          cleanseEffects(target, effect => effect === effectInstance, text => log(s, text), { session, actor: player });
        }
      });
      used = true;
    }
  } else if (itemDef.type === "effects") {
    const recipient = player;
    if (Array.isArray(itemDef.effects)) {
      itemDef.effects.forEach(effect => {
        addEffect(
          recipient,
          effect,
          text => log(s, text),
          player,
          { session }
        );
      });
    }

    const removeEffectId = itemDef.removeEffect?.id || null;
    const removeEffectCount = Math.max(0, Math.floor(Number(itemDef.removeEffect?.count) || 0));
    let removedSpecific = 0;
    for (let index = 0; index < removeEffectCount; index += 1) {
      const effectInstance = (recipient.effects || []).find(effect => effect?.id === removeEffectId);
      if (!effectInstance) break;
      removedSpecific += cleanseEffects(recipient, effect => effect === effectInstance, text => log(s, text), { session, actor: player });
    }

    if (Array.isArray(itemDef.effects) || removeEffectId) {
      if (removedSpecific > 0 && removeEffectId === 'poison') {
        log(s, `🌿 ${itemName} снимает один эффект Отравления.`);
      }
      log(s, `🧪 ${player.name} использует ${itemName}.`);
      used = true;
    }
  } else if (itemDef.type === "cleanseGuard") {
    // The protective buff is always useful; cleansing is optional, so using the
    // compound without a debuff still consumes exactly one vial.
    const removed = removeRandomNegativeEffect(player, options.rng || combatRng(session), text => log(s, text));
    addEffect(player, { id: 'block_curses', duration: itemDef.protectionDuration || 2 }, text => log(s, text), player, { session });
    log(s, `🧪 ${player.name} применяет ${itemName}: ${removed ? 'один отрицательный эффект снят' : 'очищать нечего'}; новые дебаффы заблокированы.`);
    used = true;
  } else if (itemDef.type === "primeNextDirectAttack") {
    const preparedWeapon = (player.effects || []).find(effect => effect?.id === 'prepared_weapon');
    if (preparedWeapon) {
      log(s, `⚠️ Оружие ${player.name} уже подготовлено другим составом.`);
    } else if (itemDef.effect) {
      const itemData = findItemData(itemName);
      const preparedDescription = `${itemName}: ${itemData?.description || 'Эффект сработает при следующем успешном прямом попадании.'}`;
      const applied = addEffect(
        player,
        {
          id: 'prepared_weapon',
          persistent: true,
          extra: {
            sourceItemName: itemName,
            triggerEffect: { ...itemDef.effect },
            preparedDescription,
          },
        },
        text => log(s, text),
        player,
        { session }
      );
      if (applied) {
        log(s, `🧪 ${player.name} использует ${itemName} и подготавливает оружие.`);
        used = true;
      }
    }
  } else if (itemDef.type === "entanglementScroll") {
    const eligibleTargets = getEligibleHostileUnits(s.enemies || []);
    const requestedIndex = options.targetIndex ?? 0;
    let target = s.enemies?.[requestedIndex] || null;
    if (!eligibleTargets.includes(target)) target = eligibleTargets[0] || null;

    if (!target) {
      log(s, `⚠️ Нет подходящей цели для ${itemName}.`);
    } else {
      const immuneToEntanglement = target.entanglementImmune === true
        || target.controlImmune === true
        || target.innateControlImmune === true
        || target._temporaryControlImmunity === true;

      if (immuneToEntanglement) {
        const before = Math.max(0, Number(target.turnMeter) || 0);
        const requestedReduction = Math.max(0, Number(itemDef.immuneTurnMeterReduction) || 0);
        target.turnMeter = Math.max(0, before - requestedReduction);
        const reduced = before - target.turnMeter;
        log(s, `🌿 ${itemName} не может опутать ${target.name}, но уменьшает его шкалу хода на ${Math.round(reduced / TURN_METER_THRESHOLD * 100)}%.`);
      } else {
        const before = getEffectStackCount(target, 'entanglement');
        addEffect(
          target,
          { id: 'entanglement', stacks: Math.max(1, Number(itemDef.stacks) || 1) },
          text => log(s, text),
          player,
          { session }
        );
        const after = getEffectStackCount(target, 'entanglement');
        const added = Math.max(0, after - before);
        log(s, `🌿 ${itemName} накладывает ${added} зар. Опутывания на ${target.name}.`);
        if (after >= 5) {
          const turnMeterBefore = Math.max(0, Number(target.turnMeter) || 0);
          const requestedReduction = Math.max(0, Number(itemDef.maxEntanglementTurnMeterReduction) || 0);
          target.turnMeter = Math.max(0, turnMeterBefore - requestedReduction);
          const reduced = turnMeterBefore - target.turnMeter;
          if (reduced > 0) {
            log(s, `🌿 5 зарядов Опутывания дополнительно уменьшают шкалу хода ${target.name} на ${Math.round(reduced / TURN_METER_THRESHOLD * 100)}%.`);
          }
        }
      }
      used = true;
    }
  } else if (itemDef.type === "cleanse") {
    let removed = 0;
    const cleanseCount = Math.max(0, itemDef.cleanseCount ?? 1);
    for (let index = 0; index < cleanseCount; index += 1) {
      if (!removeRandomNegativeEffect(player, options.rng || combatRng(session), text => log(s, text))) break;
      removed += 1;
    }
    if (removed > 0) {
      log(s, `🌀 ${player.name} очищается от негативных эффектов (${removed}).`);
    } else {
      log(s, `🌀 ${player.name} использует ${itemName}, но вредных эффектов не найдено.`);
    }
    used = true;
  } else if (itemDef.type === "ability") {
    const abilityTemplate = createAbilityByName(itemDef.ability, player.attack);
    const ability = resolveAbility(abilityTemplate, player.attack);
    const targetType = itemDef.target || ability.targeting || "enemy";

    if (targetType === "ally" || targetType === "self") {
      const effectDescriptors = resolveAbilityEffect(ability.effect, {
        attacker: player,
        target: player,
        primary: player,
        targets: [player],
      });
      applyEffectsToTargets(effectDescriptors, {
        attacker: player,
        primaryTarget: player,
        opposingGroup: (s.enemies || []).filter(enemy => enemy && enemy.hp > 0),
        alliedGroup: (s.players || []).filter(unit => unit && unit.hp > 0),
        logFn: text => log(s, text),
        session,
      });
      if (typeof ability.apply === "function") {
        ability.apply({ attacker: player, target: player, targets: [player], session, log: text => log(s, text) });
      }
      const selfDescriptors = resolveAbilityEffect(ability.selfEffects, {
        attacker: player,
        target: player,
        primary: player,
        targets: [player],
      });
      applyEffectsToTargets(selfDescriptors, {
        attacker: player,
        primaryTarget: player,
        opposingGroup: (s.enemies || []).filter(enemy => enemy && enemy.hp > 0),
        alliedGroup: (s.players || []).filter(unit => unit && unit.hp > 0),
        logFn: text => log(s, text),
        session,
      });
      log(s, `✨ ${player.name} использует ${itemName}.`);
      used = true;
    } else {
      const resolveTargets = () => {
        if (targetType === "allEnemies") {
          return s.enemies.filter(enemy => enemy && enemy.hp > 0);
        }
        const requested = options.targetIndex ?? 0;
        const direct = s.enemies[requested];
        if (direct && direct.hp > 0) return [direct];
        const fallback = s.enemies.find(enemy => enemy && enemy.hp > 0);
        return fallback ? [fallback] : [];
      };

      const targets = resolveTargets();
      if (targets.length === 0) {
        log(s, `⚠️ Нет подходящих целей для ${itemName}.`);
      } else {
        let interacted = false;
        const enemyGroup = (s.enemies || []).filter(enemy => enemy && enemy.hp > 0);
        const allyGroup = (s.players || []).filter(unit => unit && unit.hp > 0);
        const primaryTargetRef = targets[0] || null;
        const primaryPreparedForSecondary = primaryTargetRef ? isPreparedForFireballSplash(primaryTargetRef) : false;
        let primaryHit = false;
        const hitTargets = [];

        for (const target of targets) {
          const baseDamage = resolveDamageValue(ability, player, target, session);
          const requiresHit = abilityRequiresHitCheck(ability, baseDamage);
          let hitInfo = { hit: true, chance: 1 };
          if (requiresHit) {
            hitInfo = determineHitOutcome(player, target, ability, session);
          }

    if (requiresHit && !hitInfo.hit) {
      log(
              s,
              formatMissLog({ attacker: player, target, ability, hitInfo, context: 'item', itemName })
      );
            interacted = true;
            continue;
          }

          const damageType = resolveDamageType(ability, player, target);
          const magicSchool = resolveMagicSchool(ability, player, target, damageType);
          const damage =
            baseDamage > 0
              ? applyDamage(target, baseDamage, damageType, {
                  source: player,
                  logFn: text => log(s, text),
                  session,
                  magicSchool,
                })
              : 0;
          const absorbed = target.lastAbsorbed || 0;
          if (damage > 0) {
            const shieldNote = absorbed > 0 ? ` (щит поглотил ${absorbed})` : "";
            log(
              s,
              `📜 ${player.name} применяет ${itemName} и наносит ${damage} урона ${target.name}.${shieldNote}`
            );
          } else {
            const shieldNote = absorbed > 0 ? `Щит ${target.name} полностью поглощает эффект.` : "";
            log(s, `📜 ${player.name} применяет ${itemName}. ${shieldNote}`.trim());
          }

          if (!requiresHit || hitInfo.hit) {
            hitTargets.push(target);
            if (target === primaryTargetRef) {
              primaryHit = true;
            }
            const effectDescriptors = resolveAbilityEffect(ability.effect, {
              attacker: player,
              target,
              primary: target,
              targets,
            });
            applyEffectsToTargets(effectDescriptors, {
              attacker: player,
              primaryTarget: target,
              opposingGroup: enemyGroup,
              alliedGroup: allyGroup,
              logFn: text => log(s, text),
              session,
            });
          }

          interacted = true;
        }

        if (typeof ability.apply === "function") {
          ability.apply({
            attacker: player,
            target: primaryTargetRef,
            targets,
            hitTargets,
            session,
            log: text => log(s, text),
          });
          interacted = true;
        }

        const selfDescriptors = resolveAbilityEffect(ability.selfEffects, {
          attacker: player,
          target: primaryTargetRef,
          primary: primaryTargetRef,
          targets,
        });
        applyEffectsToTargets(selfDescriptors, {
          attacker: player,
          primaryTarget: player,
          opposingGroup: enemyGroup,
          alliedGroup: allyGroup,
          logFn: text => log(s, text),
          session,
        });

        if (ability.secondary) {
          const secondary = ability.secondary;
          const scope = secondary.target || "otherEnemies";
          let secondaryTargets = [];
          if (scope === "allEnemies") {
            secondaryTargets = enemyGroup;
          } else if (scope === "otherEnemies") {
            secondaryTargets = enemyGroup.filter(enemy => !targets.includes(enemy));
          } else if (scope === "target" && primaryTargetRef) {
            secondaryTargets = [primaryTargetRef];
          }
          secondaryTargets.forEach(secTarget => {
            if (
              typeof secondary.condition === "function" &&
              !secondary.condition({
                attacker: player,
                target: secTarget,
                primary: primaryTargetRef,
                targets,
                session,
                primaryHit,
                primaryPrepared: primaryPreparedForSecondary,
              })
            ) {
              return;
            }
            const secDamage =
              typeof secondary.damage === "function"
                ? secondary.damage({
                    attacker: player,
                    target: secTarget,
                    primary: primaryTargetRef,
                    targets,
                    session,
                    primaryHit,
                    primaryPrepared: primaryPreparedForSecondary,
                  })
                : secondary.damage ?? 0;
            if (secDamage <= 0) return;
            const damageType = secondary.type || resolveDamageType(ability, player, secTarget);
            const virtualAbility = {
              ...ability,
              name: secondary.name || ability.name,
              type: secondary.type || ability.type,
              school: secondary.school || ability.school,
              schoolResolver: secondary.schoolResolver || ability.schoolResolver,
              isSecondaryDamage: true,
            };
            const secMagicSchool = resolveMagicSchool(virtualAbility, player, secTarget, damageType);
            const dealt = applyDamage(secTarget, secDamage, damageType, {
              source: player,
              logFn: text => log(s, text),
              session,
              magicSchool: secMagicSchool,
            });
            const absorbed = secTarget.lastAbsorbed || 0;
            const shieldNote = absorbed > 0 ? ` (щит поглотил ${absorbed})` : "";
            log(
              s,
              `📜 ${player.name} задевает ${secTarget.name} вторичным эффектом ${itemName} и наносит ${dealt} урона.${shieldNote}`
            );
            const secondaryEffects = resolveAbilityEffect(secondary.effects, {
              attacker: player,
              target: secTarget,
              primary: secTarget,
              targets,
            });
            applyEffectsToTargets(secondaryEffects, {
              attacker: player,
              primaryTarget: secTarget,
              opposingGroup: enemyGroup,
              alliedGroup: allyGroup,
              logFn: text => log(s, text),
              session,
            });
          });
        }

        if (!interacted) {
          log(s, `📜 ${player.name} использует ${itemName}, но эффекта нет.`);
        } else {
          used = true;
        }
      }
    }
  }

  if (used) {
    triggerEquipmentOnConsumableUsed(player, session, text => log(s, text));
    const seal = player.activeRelicId === DEFAULT_RELIC_ID ? player.relicBonuses?.[DEFAULT_RELIC_ID] : null;
    if (seal?.consumableTurnMeter) {
      const first = !player._recruitSealFirstConsumableUsed;
      const gain = seal.consumableTurnMeter + (first ? seal.firstConsumableTurnMeter : 0);
      player.turnMeter = Math.min(TURN_METER_THRESHOLD, (player.turnMeter || 0) + Math.round(TURN_METER_THRESHOLD * gain));
      player._recruitSealFirstConsumableUsed = true;
      const metrics = (player._recruitSealMetrics ||= { startTriggers: 0, consumableTriggers: 0, firstConsumableTriggers: 0, preservedConsumables: 0 });
      metrics.consumableTriggers += 1; if (first) metrics.firstConsumableTriggers += 1;
    }
    const preservedBySeal = Boolean(seal?.preserveConsumableChance && combatRng(session)() < seal.preserveConsumableChance);
    if (preservedBySeal) (player._recruitSealMetrics ||= {}).preservedConsumables = (player._recruitSealMetrics?.preservedConsumables || 0) + 1;
    const preservedBySet = shouldPreserveConsumableFromEquipmentSet(player, session);
    if (preservedBySet || preservedBySeal) {
      log(s, preservedBySeal ? '🔰 Печать Новобранца сохранила расходник.' : '🎒 Комплект Новобранца сохранил предмет.');
    }
    turnControl.itemUsed = true;
    if (!preservedBySet && !preservedBySeal) {
      player.items = player.items.filter((_, i) => i !== index);
    }
    if (consumesTurn) {
      completeEntanglementTurn(player, text => log(s, text), session);
      initiative.playerReady = false;
    }
    return { session, itemUsed: true, turnConsumed: consumesTurn };
  }

  return { session, itemUsed: false, turnConsumed: false };
}

export function rollLootForEnemies(enemies = []) {
  const authored = enemies.filter(enemy => !enemy?.summoned && !enemy?.summonOnly);
  return resolveEncounterRewards({
    roster: createEncounterRewardRoster(authored),
    location: authored.find(enemy => enemy?.location)?.location || null,
  });
}

export { resolveEncounterRewardsOnce };

// === Проверка конца боя ===
export function evaluateBattleStatus(session) {
  const s = session.state;
  const players = Array.isArray(s.players) ? s.players : [];
  const enemies = Array.isArray(s.enemies) ? s.enemies : [];
  const isValidHp = unit => Number.isFinite(unit?.hp);
  const playerDead = players.length > 0 && players.every(p => p && isValidHp(p) && p.hp <= 0);
  const combatants = enemies.filter(enemy => !enemy?.nonBlocking && !enemy?.nonActingCombatObject);
  const allEnemiesDead = combatants.length > 0 && combatants.every(e => e && isValidHp(e) && e.hp <= 0);
  return { victory: allEnemiesDead, defeat: playerDead };
}

export function checkBattleOutcome(session) {
  const s = session.state;
  const outcome = evaluateBattleStatus(session);

  if (outcome.defeat) log(s, "☠️ Вы пали в бою...");
  if (outcome.victory) log(s, "🏆 Победа!");

  return outcome;
}


