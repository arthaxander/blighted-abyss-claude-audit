import { FIELD_CONSUMABLES } from '../data/fieldConsumables';
import { addEffect } from './effects';

export const isFieldControlImmune = target => Boolean(target?.controlImmune || target?.innateControlImmune || target?._temporaryControlImmunity);

export const triggerPreparedFieldTrap = (session, enemy, log = () => {}, dealDamage = () => {}, summonSoul = () => ({ success: false })) => {
  const player = session?.state?.players?.[0];
  const definition = FIELD_CONSUMABLES.find(entry => entry.name === player?.preparedTrap && entry.trap);
  if (!definition || !enemy || enemy.hp <= 0 || player.hp <= 0) return false;
  const index = (player.items || []).findIndex(item => item.name === definition.name);
  // A preparation is only a reservation, never an extra item outside the inventory.
  player.preparedTrap = null;
  if (index < 0) return false;
  player.items.splice(index, 1);
  session.state.fieldTrapUsage = { ...session.state.fieldTrapUsage, [definition.name]: (session.state.fieldTrapUsage?.[definition.name] || 0) + 1 };
  log(`Ловушка «${definition.name}» срабатывает на ${enemy.name} и расходуется.`);
  const alive = (session.state.enemies || []).filter(unit => unit?.hp > 0 && !unit.nonActingCombatObject);
  const base = Math.max(0, Number(player.attack) || 0, Number(player.magAtk) || 0);
  const magical = (Number(player.magAtk) || 0) > (Number(player.attack) || 0);
  if (definition.trap.kind === 'barbed') {
    alive.forEach(unit => addEffect(unit, { id: 'bleed', duration: 2 }, log, player, { session }));
    dealDamage(enemy, Math.round(base * 0.7), magical ? 'magical' : 'physical', player);
  } else if (definition.trap.kind === 'binding') {
    alive.forEach(unit => {
      unit.turnMeter = Math.max(0, (unit.turnMeter || 0) - 150);
      if (!isFieldControlImmune(unit)) addEffect(unit, { id: 'speed_penalty_minor', duration: 2 }, log, player, { session });
    });
    if (enemy.hp > 0) {
      addEffect(enemy, { id: 'poison', duration: 2 }, log, player, { session });
      addEffect(enemy, { id: 'poison', duration: 2 }, log, player, { session });
    }
  } else if (definition.trap.kind === 'predatoryShoots') {
    alive.forEach(unit => addEffect(unit, { id: 'overgrowth', duration: 4 }, log, player, { session }));
    if (enemy.hp > 0) {
      addEffect(enemy, { id: 'healing_curse', duration: 2 }, log, player, { session });
      dealDamage(enemy, Math.round(base * 0.5), 'magical', player, 'nature');
    }
    // The default 400 / 1000 turn meter is set in the field-consumable catalogue.
    // Tests can temporarily override the value for paired balance comparisons.
    const turnMeterGain = Math.max(0, Number(definition.trap.turnMeterGain) || 0);
    if (turnMeterGain > 0) {
      const before = Math.max(0, Number(player.turnMeter) || 0);
      player.turnMeter = Math.min(1000, before + turnMeterGain);
      log(`Хищные побеги ускоряют героя: +${Math.round((player.turnMeter - before) / 10)}% шкалы хода.`);
    }
  } else if (definition.trap.kind === 'burialSeal') {
    alive.forEach(unit => addEffect(unit, { id: 'magic_def_penalty_minor', duration: 2 }, log, player, { session }));
    if (enemy.hp > 0) addEffect(enemy, { id: 'vulnerability', duration: 2 }, log, player, { session });
    const summoned = summonSoul(session, player, enemy);
    if (!summoned?.success) log('Погребальная печать сработала, но для призрачного союзника нет места.');
  } else if (definition.trap.kind === 'fire') {
    alive.forEach(unit => {
      dealDamage(unit, Math.round(base * (unit === enemy ? 0.7 : 0.7 * 0.35)), 'magical', player, 'fire');
    });
    if (enemy.hp > 0) addEffect(enemy, { id: 'burn', duration: 2 }, log, player, { session });
  } else {
    definition.trap.effects.forEach(effect => {
      if (effect.id === 'speed_penalty_minor' && isFieldControlImmune(enemy)) return;
      addEffect(enemy, { ...effect }, log, player, { session });
    });
  }
  return true;
};
