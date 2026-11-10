// Runtime hooks for authored Ruins of the Restless enemies.
// Do not apply Ruins rules to existing locations.
import { getEffectStackCount, setEffectStackCount, setDynamicStatMultiplier } from './effects';

export const RUINS_LOCATION = 'Руины Неупокоенных';
const alive = units => (units || []).filter(unit => unit && unit.hp > 0);
const isRuins = unit => unit?.location === RUINS_LOCATION;

export const isRuinsBanner = unit => Boolean(unit?.ruinsBanner);

// External positive turn-meter grants are reduced, natural speed-based tempo is untouched.
export function applyRuinsFrostbiteTempoReduction(target, gained, meta = {}) {
  const value = Math.max(0, Number(gained) || 0);
  if (!target || meta.natural === true || value <= 0 ||
      !(target.effects || []).some(effect => effect?.id === 'ruins_frostbite')) return value;
  const reduction = Math.min(Math.max(0, Number(target.turnMeter) || 0), Math.round(value * 0.4));
  target.turnMeter = Math.max(0, (Number(target.turnMeter) || 0) - reduction);
  return value - reduction;
}


export function gainRuinsSouls(unit, count = 1, session = null) {
  if (!unit || unit.hp <= 0 || unit.ruinsBanner) return 0;
  const previous = getEffectStackCount(unit, 'ruins_unrest');
  const next = Math.min(3, previous + count);
  if (next <= previous) return 0;
  setEffectStackCount(unit, 'ruins_unrest', next);
  const bonus = 1 + next * 0.1;
  setDynamicStatMultiplier(unit, 'ruins_unrest_attack', bonus, 'attack');
  setDynamicStatMultiplier(unit, 'ruins_unrest_magic', bonus, 'magAtk');
  setDynamicStatMultiplier(unit, 'ruins_unrest_speed', bonus, 'speed');
  session?.state?.log?.push?.(`◈ ${unit.name} получает [Неупокоенность] (${next}/3).`);
  return next - previous;
}

export function queueRuinsDeath(unit, session) {
  if (!unit || !session || !isRuins(unit) || unit._ruinsSoulQueued || unit.ruinsBanner) return;
  if (unit.ruinsLegionAbsorbed) return;
  if (unit.summoned && !unit.ruinsLegionSoldier) return;
  unit._ruinsSoulQueued = true;
  session._ruinsPendingSouls ||= [];
  session._ruinsPendingSouls.push({
    ownerId: unit.ruinsLegionSoldier ? unit.ownerId : null,
    sourceId: unit.id,
  });
  if (!unit.summoned) {
    alive(session.state.enemies).filter(ally => ally !== unit && !ally.summoned && !ally.ruinsBanner && ally._ruinsStartingAllyIds?.includes(unit.id))
      .forEach(ally => { ally._ruinsFallenStartingAllies = (ally._ruinsFallenStartingAllies || 0) + 1; });
  }
}

export function flushRuinsSouls(session) {
  const pending = session?._ruinsPendingSouls || [];
  if (!pending.length) return;
  session._ruinsPendingSouls = [];
  pending.forEach(({ ownerId }) => {
    const targets = alive(session.state.enemies).filter(u =>
      isRuins(u) && !u.ruinsBanner && !u.nonActingCombatObject &&
      getEffectStackCount(u, 'ruins_unrest') < 3 &&
      (ownerId ? u.id === ownerId : !u.summoned)
    );
    if (!targets.length) return;
    targets.sort((a, b) =>
      getEffectStackCount(b, 'ruins_unrest') - getEffectStackCount(a, 'ruins_unrest') ||
      Math.max(b.baseAttack || b.baseAtk || 0, b.baseMagAtk || 0) - Math.max(a.baseAttack || a.baseAtk || 0, a.baseMagAtk || 0) ||
      String(a.id).localeCompare(String(b.id))
    );
    gainRuinsSouls(targets[0], 1, session);
  });
}

export function initRuinsBattle(session) {
  const group = session?.state?.enemies || [];
  const living = alive(group);
  if (!living.some(isRuins)) return;
  const startingIds = living.filter(u => isRuins(u) && !u.summoned).map(u => u.id);
  living.forEach(unit => {
    if (isRuins(unit) && !unit.summoned) unit._ruinsStartingAllyIds = startingIds.filter(id => id !== unit.id);
  });
  for (const bearer of living.filter(u => u.name === 'Знаменосец павшей когорты')) {
    if (!alive(session.state.enemies).some(u => u.ruinsBanner && u.ownerId === bearer.id)) {
      session.summonEnemy?.('Знамя павшей когорты', { source: bearer });
    }
  }
  for (const boss of living.filter(u => u.name === 'Легион Погребённых')) {
    if (boss._ruinsLegionSummoned) continue;
    boss._legionPhase = 1;
    boss._ruinsLegionSummoned = 0;
    for (const name of ['Погребённый щитоносец', 'Погребённый рубака']) {
      const result = session.summonEnemy?.(name, { source: boss });
      if (result?.success) boss._ruinsLegionSummoned += 1;
    }
  }
}

export function transitionRuinsLegion(target, session) {
  if (target?.name !== 'Легион Погребённых' || target.hp <= 0 || (target._legionPhase || 1) !== 1 ||
      target.hp > target.maxHp * 0.5) return false;
  target._legionPhase = 2;
  const soldiers = alive(session?.state?.enemies).filter(u => u.ruinsLegionSoldier && u.ownerId === target.id);
  soldiers.forEach(unit => { unit.ruinsLegionAbsorbed = true; unit.hp = 0; });
  gainRuinsSouls(target, soldiers.length, session);
  setEffectStackCount(target, 'ruins_echo_charge', Math.max(1, getEffectStackCount(target, 'ruins_echo_charge')));
  session?.state?.log?.push?.(`☠️ ${target.name} поглощает оставшихся солдат. Началась фаза II!`);
  return true;
}

export function cleanupRuinsOwnerDeath(unit, session) {
  if (!isRuins(unit) || !session) return;
  if (unit.name === 'Знаменосец павшей когорты') {
    alive(session.state.enemies).filter(u => u.ruinsBanner && u.ownerId === unit.id)
      .forEach(banner => { banner.hp = 0; });
  }
  if (unit.name === 'Легион Погребённых') {
    alive(session.state.enemies).filter(u => u.ruinsLegionSoldier && u.ownerId === unit.id)
      .forEach(soldier => { soldier.ruinsLegionAbsorbed = true; soldier.hp = 0; });
  }
}

export function getRuinsBannerDamageBonus(source, session, directAttack, fromEffect) {
  if (!source || !isRuins(source) || source.ruinsBanner || !directAttack || fromEffect) return 0;
  return alive(session?.state?.enemies).some(u => u.ruinsBanner) ? 0.25 : 0;
}

export function getRuinsLegionGuardReduction(target, session, directAttack) {
  if (!directAttack || target?.name !== 'Легион Погребённых' || (target._legionPhase || 1) !== 1) return 1;
  return alive(session?.state?.enemies).some(u => u.ruinsLegionSoldier && u.ownerId === target.id && u.name === 'Погребённый щитоносец') ? 0.8 : 1;
}

export function reduceRuinsDeadshotDamage(target, amount, session, { directAttack, fromEffect, isPeriodic }) {
  if (target?.name !== 'Кристальный мертвострел — Искажение' || amount <= 0 || !directAttack || fromEffect || isPeriodic) return amount;
  const fraction = target._ruinsDeadshotFirstHitUsed ? 0.10 : 0.25;
  target._ruinsDeadshotFirstHitUsed = true;
  const after = Math.round(amount * (1 - fraction));
  const cap = Math.round(target.maxHp * 0.3);
  target._ruinsRefraction = Math.min(cap, (target._ruinsRefraction || 0) + Math.max(0, amount - after));
  setEffectStackCount(target, 'ruins_refraction', target._ruinsRefraction);
  return after;
}

export function consumeRuinsDeadshotRefraction(attacker, target, session) {
  if (attacker?.name !== 'Кристальный мертвострел — Искажение' || !target || target.hp <= 0) return 0;
  const value = Math.min(Math.round(attacker.maxHp * 0.3), attacker._ruinsRefraction || 0);
  if (value <= 0) return 0;
  attacker._ruinsRefraction = 0;
  setEffectStackCount(attacker, 'ruins_refraction', 0);
  return session?.applyIndirectDamage?.(target, value, 'physical', { source: attacker, fromEffect: 'ruins_refraction' }) || 0;
}

export function resolveRuinsPreparedAction(unit, session) {
  if (!isRuins(unit) || !session || unit.hp <= 0) return;
  if (unit.name === 'Кристальный мертвострел — Искажение') unit._ruinsDeadshotFirstHitUsed = false;
  if (unit.name === 'Осадный урод — Осквернение') {
    if ((unit.effects || []).some(e => e.id === 'bleed' && (e.sourceRef === unit || e.sourceSnapshot?.id === unit.id))) {
      unit._ruinsSiegeMomentum = Math.min(2, (unit._ruinsSiegeMomentum || 0) + 1);
    }
    if (unit._ruinsSiegePreparation) {
      unit._ruinsSiegePreparation = false;
      const extra = 1 + (unit._ruinsSiegeMomentum || 0) * .15;
      alive(session.state.players).forEach((target, i) =>
        session.applyIndirectDamage?.(target, Math.round(unit.attack * (i === 0 ? 3 : 1.7) * extra), 'physical', { source: unit, fromEffect: 'ruins_siege_ram' })
      );
      unit._ruinsSiegeMomentum = 0;
    }
  }
  if (unit.name === 'Легион Погребённых' && unit._ruinsLegionPreparation) {
    unit._ruinsLegionPreparation = false;
    const strong = (unit.shield || 0) > 0;
    alive(session.state.players).forEach((target, i) =>
      session.applyIndirectDamage?.(target, Math.round(unit.attack * (i === 0 ? (strong ? 3 : 1.7) : (strong ? 1.6 : .9))), 'physical', { source: unit, fromEffect: 'ruins_legion_breakthrough' })
    );
  }
}
