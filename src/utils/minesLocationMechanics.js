// Mines of Decay location and sublocation rules.
// No player-facing region is unlocked by importing this module.
import { addEffect } from './effects';

export const MINES_LOCATION_NAME = 'Шахты Тления';

export const MINES_SUBLOCATION_EFFECTS = Object.freeze({
  OVERSEER: 'mines-last-shift',
  SUPPORT: 'mines-fortified-galleries',
  SURVEYOR: 'mines-black-markings',
  CURSED: 'mines-clinging-curse',
});

const isMinesCombat = session => session?.location === MINES_LOCATION_NAME ||
  session?.state?.locationName === MINES_LOCATION_NAME;
const alive = units => (units || []).filter(unit => unit && unit.hp > 0 && !unit.nonActingCombatObject);
const isCursedMinesEnemy = (unit, session) => alive(session?.state?.enemies).includes(unit) &&
  unit.location === MINES_LOCATION_NAME && unit.roomRole === 'cursedEnemy';
const isNew = ({ statusOperation, previouslyActive }) =>
  statusOperation === 'apply' && !previouslyActive;
const rng = session => typeof session?.rng === 'function' ? session.rng() : Math.random();
const plusMeter = (unit, amount) => {
  const before = Math.max(0, Number(unit?.turnMeter) || 0);
  if (!unit) return 0;
  unit.turnMeter = Math.min(1000, before + amount);
  return unit.turnMeter - before;
};
const minusMeter = (unit, amount) => {
  const before = Math.max(0, Number(unit?.turnMeter) || 0);
  if (!unit) return 0;
  unit.turnMeter = Math.max(0, before - amount);
  return before - unit.turnMeter;
};

// Only one first-instance event per status ID and recipient triggers this.
// This deliberately does NOT use number of buffs/debuffs applied during an action.
export function handleMinesNewStatus(session, {
  target, source, effect, metadata, statusOperation, previouslyActive,
  cursedDurationBonus = false,
} = {}) {
  if (!isMinesCombat(session) || !target || !effect || !metadata) return;
  const enemies = alive(session?.state?.enemies);
  const players = alive(session?.state?.players);
  const newType = isNew({ statusOperation, previouslyActive });

  if (newType && metadata.type === 'buff' && enemies.includes(target)) {
    plusMeter(target, 100);
  } else if (newType && metadata.type === 'debuff' &&
             enemies.includes(source) && players.includes(target)) {
    minusMeter(target, 100);
  }

  // Mark the curse's one-time extension only AFTER the status was successfully
  // applied. Failed attempts against immunity/seals must not consume it.
  if (cursedDurationBonus && isCursedMinesEnemy(source, session) &&
      players.includes(target)) {
    target._minesCurseExtendedStatusIds ||= [];
    if (!target._minesCurseExtendedStatusIds.includes(effect.id)) {
      target._minesCurseExtendedStatusIds.push(effect.id);
    }
  }
}

// Transform only the FIRST successful instance of each status type inflicted
// by a cursed Mines enemy on each player-side unit. Repeat/refresh has no bonus.
// Charge and other stack/instant mechanics are never extended.
export function transformMinesCursedStatus({ session, target, source, effectData, metadata } = {}) {
  if (!isMinesCombat(session) ||
      session?.sublocationEffectId !== MINES_SUBLOCATION_EFFECTS.CURSED ||
      !isCursedMinesEnemy(source, session) ||
      !alive(session.state.players).includes(target) ||
      metadata?.type !== 'debuff' || metadata.stacking === 'stack' ||
      metadata.persistent || metadata.durationPresentation === 'permanent' ||
      (target._minesCurseExtendedStatusIds || []).includes(metadata.id)) {
    return effectData;
  }
  const duration = Number(effectData.duration ?? effectData.turns ?? metadata.defaultDuration);
  if (!Number.isFinite(duration) || duration <= 0 || duration >= 999) return effectData;
  return { ...effectData, duration: duration + 1, _minesCursedDurationBonus: true };
}

// Wound threshold fires only when an ordinary Mines enemy first CROSSES 50%
// HP alive. The threshold must not be farmable through healing.
export function triggerMinesLastShift(session, target, previousHp) {
  if (!isMinesCombat(session) ||
      session?.sublocationEffectId !== MINES_SUBLOCATION_EFFECTS.OVERSEER ||
      !alive(session.state.enemies).includes(target) ||
      target.roomRole !== 'normalEnemy' || target._minesLastShiftTriggered ||
      !(Number(previousHp) > target.maxHp * .5) ||
      target.hp <= 0 || target.hp > target.maxHp * .5) return 0;
  target._minesLastShiftTriggered = true;
  return plusMeter(target, 200);
}

// On a direct area attack, shielded Mines miners defend their UNSHIELDED allies.
// The owner of a shield never gains this protection from its own shield.
export function minesGalleryDamageMultiplier(session, target, source, { directAttack = false, areaAttack = false } = {}) {
  if (!isMinesCombat(session) ||
      session?.sublocationEffectId !== MINES_SUBLOCATION_EFFECTS.SUPPORT ||
      !directAttack || !areaAttack ||
      !alive(session.state.players).includes(source) ||
      !alive(session.state.enemies).includes(target) ||
      (target.shield || 0) > 0) return 1;
  const otherShielded = alive(session.state.enemies).some(unit =>
    unit !== target && (Number(unit.shield) || 0) > 0
  );
  return otherShielded ? .8 : 1;
}

export function applyMinesBlackMarkings(session, log = () => {}) {
  if (!isMinesCombat(session) ||
      session?.sublocationEffectId !== MINES_SUBLOCATION_EFFECTS.SURVEYOR) return 0;
  const eligible = alive(session.state.enemies).filter(unit => unit.roomRole === 'normalEnemy');
  const buffs = ['speed_boost_minor', 'phys_def_boost_minor', 'magic_def_boost_minor'];
  let appliedCount = 0;
  // Sample without replacement, using battle RNG for reproducibility.
  for (let i = 0; i < 2 && eligible.length; i += 1) {
    const selectedIndex = Math.min(eligible.length - 1, Math.floor(rng(session) * eligible.length));
    const [target] = eligible.splice(selectedIndex, 1);
    const buff = buffs[Math.min(buffs.length - 1, Math.floor(rng(session) * buffs.length))];
    if (addEffect(target, { id: buff, duration: 2 }, log, target, { session })) appliedCount += 1;
  }
  return appliedCount;
}

export function installMinesCombatHooks(session) {
  if (!isMinesCombat(session)) return;
  session.onMinesStatusApplied = payload => handleMinesNewStatus(session, payload);
  const previousTransform = session.transformEffectApplication;
  session.transformEffectApplication = payload => {
    const effective = typeof previousTransform === 'function'
      ? previousTransform(payload) || payload.effectData
      : payload.effectData;
    return transformMinesCursedStatus({ ...payload, effectData: effective, session });
  };
}
