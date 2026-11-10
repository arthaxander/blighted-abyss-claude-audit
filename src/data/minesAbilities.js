// Authored Level 2: Mines of Decay. Kept separate from the established L1/Forest kits.
// Mines remain unavailable in the location selector until their artwork and encounters pass QA.
import {
  addEffect, cleanseEffects, getEffectDefinition, getEffectStackCount,
  setEffectStackCount, consumeEffectStacks, countUniqueActiveBuffs,
  isEffectTransferable, removeRandomNegativeEffect,
} from '../utils/effects';
import { MAGIC_SCHOOLS } from '../constants/magicSchools';

export const MINES_LOCATION = 'Шахты Тления';
export const MINES_BOSS = 'Начальник шахт — Золотоплавец';
const raw = (unit, stat, factor) => Math.round(Math.max(0, Number(unit?.[stat]) || 0) * factor);
const alive = units => (units || []).filter(unit => unit && unit.hp > 0);
const rng = session => (typeof session?.rng === 'function' ? session.rng() : Math.random());
const random = (units, session) => units.length ? units[Math.min(units.length - 1, Math.floor(rng(session) * units.length))] : null;
const buffs = unit => (unit?.effects || []).filter(effect =>
  getEffectDefinition(effect?.id)?.type === 'buff' && isEffectTransferable(effect)
  && effect?.extra?.ownerBound !== true && !effect?.extra?.sourceKey
);
const debuffs = unit => (unit?.effects || []).filter(effect =>
  getEffectDefinition(effect?.id)?.type === 'debuff' && isEffectTransferable(effect)
  && effect?.extra?.ownerBound !== true
);
const isMarked = unit => (unit?.effects || []).some(effect => effect?.id === 'searing_mark');
const has = (unit, id) => (unit?.effects || []).some(effect => effect?.id === id);
const apply = (unit, id, duration, caster, session, log, extra = {}) =>
  addEffect(unit, { id, duration, ...extra }, log, caster, { session });
const cappedSupplies = (owner, amount) => setEffectStackCount(owner, 'supplies', Math.min(3, Math.max(0, amount)));
const hitHostiles = (attacker, targets, coefficient, dealDirectDamage, effectCallback = null) => {
  alive(targets).forEach(target => {
    const result = dealDirectDamage?.(target, raw(attacker, 'attack', coefficient), { targeting: 'allEnemies', type: 'physical' });
    if (target.hp > 0 && result && typeof effectCallback === 'function') effectCallback(target, result);
  });
};

// Statuses are moved using official remove/apply APIs, never by splicing effects.
// Preserves duration, source and remaining Shield strength. Rejects all protected statuses.
export function transferMinesStatus(from, to, effect, caster, session, log = () => {}) {
  if (!from || !to || from === to || !effect || !from.effects?.includes(effect)
    || !isEffectTransferable(effect) || effect?.extra?.ownerBound === true || effect?.extra?.sourceKey) return false;
  const def = getEffectDefinition(effect.id);
  if (!def || (def.type === 'buff' && to.blockBuffs) || (def.type === 'debuff' && to.blockDebuffs)) return false;
  const remaining = effect.remainingTurns ?? effect.duration ?? def.defaultDuration;
  const shieldValue = effect.id === 'shield'
    ? Math.min(Math.max(0, Number(from.shield) || 0), Math.max(0, Number(effect.appliedShield ?? effect.value) || 0))
    : null;
  if (effect.id === 'shield' && !shieldValue) return false;
  const payload = {
    id: effect.id,
    duration: remaining,
    ...(effect.stacks ? { stacks: effect.stacks } : {}),
    ...(effect.value != null ? { value: shieldValue ?? effect.value } : {}),
    ...(effect.extra ? { extra: { ...effect.extra } } : {}),
  };
  const applied = addEffect(to, payload, log, effect.sourceRef || caster, {
    session, forceIndependentInstance: effect.id === 'shield',
  });
  if (!applied) return false;
  const removed = cleanseEffects(from, candidate => candidate === effect, log, { session, actor: caster });
  return removed > 0;
}

// A single Bleed tick counts once regardless of its accumulated duration.
// Applies to a tick on ANY combatant, including the healer itself.
export function registerMinesBleedTick(session) {
  const healers = alive(session?.state?.enemies).filter(enemy =>
    enemy.name === 'Осквернённый лекарь' && !enemy.passivesDisabled
    && (enemy.abilities || []).some(ability => ability?.minesRapidClotting));
  healers.forEach(healer => {
    healer._minesBleedTicks = (healer._minesBleedTicks || 0) + 1;
    healer.baseStats ||= {
      attack: healer.attack ?? 0, magAtk: healer.magAtk ?? 0,
      physDef: healer.physDef ?? 0, magicDef: healer.magicDef ?? 0, speed: healer.speed ?? 0,
    };
    healer.baseStats.speed += 5;
    healer.speed = Math.round(healer.baseStats.speed * (healer.statMultipliers?.speed ?? 1));
  });
}

// Triggered immediately at the HP threshold, not delayed until the boss's next turn.
export function transitionMinesBossPhase(target, session, log = () => {}) {
  if (target?.name !== MINES_BOSS || !session?.state
    || target.hp <= 0 || target.hp > target.maxHp * 0.5 || target._minesPhase === 2) return false;
  target._minesPhase = 2;
  target._minesPhaseAwaitingHeroTurn = true;
  alive(session.state.players).forEach(unit => apply(unit, 'searing_mark', 3, target, session, log));
  log('✨ Золотоплавец переходит во вторую фазу: Общее клеймо!');
  return true;
}

const convertBuffToDebuff = Object.freeze({
  attack_boost_minor: 'attack_penalty_minor',
  attack_boost_major: 'attack_penalty_major',
  phys_def_boost_minor: 'phys_def_penalty_minor',
  phys_def_boost_major: 'phys_def_penalty_major',
  magic_def_boost_minor: 'magic_def_penalty_minor',
  magic_def_boost_major: 'magic_def_penalty_major',
  magic_attack_boost_minor: 'magic_attack_penalty_minor',
  magic_attack_boost_major: 'magic_attack_penalty_major',
  speed_boost_minor: 'speed_penalty_minor',
  speed_boost_major: 'speed_penalty_major',
});

export const MINES_ABILITY_LIBRARY = {
  'Шахты: Клеймящий удар': {
    name: 'Клеймящий удар', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 'attack', 1.15),
    effect: { id: 'searing_mark', duration: 3 }, aiScore: () => 105,
    description: '115% ФА и Испепеляющее клеймо на 3 хода.',
  },
  'Шахты: Крюк на цепи': {
    name: 'Крюк на цепи', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 'attack', 1),
    effect: { id: 'speed_penalty_minor', duration: 1 }, aiScore: () => 100,
    apply: ({ target }) => { if (target) target.turnMeter = Math.max(0, (target.turnMeter || 0) - 150); },
    description: '100% ФА, -15% шкалы хода и Замедление на 1 ход.',
  },
  'Шахты: Метание валуна': {
    name: 'Метание валуна', cooldown: 2, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 'attack', 1.25),
    effect: { id: 'stun', duration: 1, chance: 0.3 }, aiScore: () => 105,
    description: '125% ФА и 30% шанс Оглушения на 1 ход.',
  },
  'Шахты: Сброс ноши': {
    name: 'Сброс ноши', cooldown: 4, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 'attack', 1), aiScore: () => 96,
    apply: ({ attacker, target, session, log }) => {
      if (!target) return;
      const stolen = Math.min(100, Math.max(0, target.turnMeter || 0));
      target.turnMeter = Math.max(0, (target.turnMeter || 0) - stolen);
      attacker.turnMeter = Math.min(1000, (attacker.turnMeter || 0) + stolen);
      apply(attacker, 'speed_boost_minor', 2, attacker, session, log);
    },
    description: '100% ФА, крадёт до 10% шкалы хода, даёт Ускорение на 2 хода.',
  },
  'Шахты: Глухая оборона': {
    name: 'Глухая оборона', cooldown: 4, damage: 0, type: 'support', targeting: 'self',
    aiScore: ({ attacker, allies }) => (attacker.shield || 0) <= 0 || alive(allies).length > 1 ? 118 : 20,
    apply: ({ attacker, session, log }) => {
      apply(attacker, 'shield', 2, attacker, session, log, { value: Math.round(attacker.maxHp * 0.16) });
      alive(session?.state?.enemies).filter(unit => unit !== attacker)
        .forEach(unit => apply(unit, 'phys_def_boost_minor', 2, attacker, session, log));
    },
    description: 'Даёт себе Щит на 16% максимального здоровья; повышает физическую защиту остальных союзников на 25% на 2 хода.',
  },
  'Шахты: Обратить силу': {
    name: 'Обратить силу', cooldown: 4, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 'attack', 0.95), aiScore: ({ target }) => 78 + buffs(target).length * 24,
    apply: ({ attacker, target, session, log }) => {
      if (!target) return;
      buffs(target).filter(effect => convertBuffToDebuff[effect.id]).slice(0, 2).forEach(effect => {
        const opposite = convertBuffToDebuff[effect.id];
        if (cleanseEffects(target, candidate => candidate === effect, log, { session, actor: attacker }) > 0)
          apply(target, opposite, 2, attacker, session, log);
      });
    },
    description: '95% физической атаки; превращает до двух снимаемых положительных эффектов в аналогичные отрицательные.',
  },
  'Шахты: Выбить клин': {
    name: 'Выбить клин', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 'attack', 1.2),
    effect: { id: 'phys_def_penalty_minor', duration: 2 }, aiScore: () => 110,
    description: '120% ФА и -25% физической защиты на 2 хода.',
  },
  'Шахты: Скол породы': {
    name: 'Скол породы', cooldown: 2, type: 'physical',
    damage: ({ attacker, target }) => raw(attacker, 'attack', (target?.shield || 0) > 0 ? 1.45 : 1.10),
    aiScore: ({ target }) => (target?.shield || 0) > 0 ? 116 : 95,
    description: '110% ФА, либо 145% ФА против Щита.',
  },
  'Шахты: Бычий разбег': {
    name: 'Бычий разбег', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 'attack', 1.45),
    selfEffects: [{ id: 'speed_boost_minor', duration: 2 }], aiScore: () => 125,
    description: '145% ФА, даёт Ускорение на 2 хода.',
  },
  'Шахты: Давка': {
    name: 'Давка', cooldown: 4, damage: 0, type: 'support', targeting: 'allEnemies',
    aiScore: ({ attacker }) => has(attacker, 'speed_boost_minor') ? 140 : 96,
    apply: ({ attacker, targets, session, log, applyDirectDamage }) => {
      for (let i = 0; i < 3 && attacker.hp > 0; i++) {
        hitHostiles(attacker, targets, 0.30, applyDirectDamage);
      }
      log?.('🐂 Давка: три удара по всем противникам.');
    },
    description: 'Три отдельных физических удара по 30% ФА всем противникам.',
  },
  'Шахты: Неудержимый натиск': {
    name: 'Неудержимый натиск', passive: true, minesBullTempo: true,
    description: 'Под Ускорением каждый успешный прямой удар уменьшает шкалу хода цели на 10%.',
  },
  'Шахты: Продолжить работу!': {
    name: 'Продолжить работу!', cooldown: 4, damage: 0, type: 'support', targeting: 'self',
    canUse: ({ attacker, allies }) => alive(allies).some(unit => unit !== attacker),
    aiScore: () => 128,
    apply: ({ attacker, session }) => alive(session?.state?.enemies).filter(unit => unit !== attacker)
      .sort((a, b) => (a.turnMeter || 0) - (b.turnMeter || 0)).slice(0, 2)
      .forEach(unit => { unit.turnMeter = Math.min(1000, (unit.turnMeter || 0) + 200); }),
    description: 'Двум живым союзникам даёт по 20% шкалы хода.',
  },
  'Шахты: Виновный': {
    name: 'Виновный', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 'attack', 1),
    effect: { id: 'phys_def_penalty_minor', duration: 2 }, aiScore: () => 100,
    description: '100% ФА и -25% физической защиты на 2 хода.',
  },
  'Шахты: Работать до смерти!': {
    name: 'Работать до смерти!', passive: true, minesOverseerAura: true,
    description: 'Живые союзники наносят на 0,4% больше прямого урона за каждый недостающий 1% здоровья. На себя эффект не действует.',
  },
  'Шахты: Укрепить проход': {
    name: 'Укрепить проход', cooldown: 5, damage: 0, type: 'support', targeting: 'self',
    aiScore: ({ allies }) => alive(allies).length > 1 ? 128 : 65,
    apply: ({ attacker, session, log }) => {
      const team = alive(session?.state?.enemies);
      team.filter(unit => unit !== attacker).sort((a,b) => (a.shield||0)-(b.shield||0))
        .slice(0,2).forEach(unit => apply(unit, 'shield', 2, attacker, session, log, {
          value: Math.round(unit.maxHp * 0.14),
        }));
      team.forEach(unit => removeRandomNegativeEffect(unit, () => rng(session), log));
      apply(attacker, 'mines_guard_block', 2, attacker, session, log);
    },
    description: 'Даёт двум другим союзникам Щит на 14% их максимального здоровья, снимает по одному отрицательному эффекту с команды и блокирует следующий отрицательный эффект на себе на 2 хода.',
  },
  'Шахты: Кувалда': {
    name: 'Кувалда', cooldown: 3, type: 'physical',
    damage: ({ attacker, target }) => raw(attacker, 'attack', 1.55 + 0.15 * Math.min(4, countUniqueActiveBuffs(target))),
    aiScore: ({ target }) => 104 + countUniqueActiveBuffs(target) * 10,
    description: '155% ФА +15 п.п. за каждый тип положительного статуса цели (до 215%).',
  },
  'Шахты: Чёрная жила': {
    name: 'Чёрная жила', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.DARKNESS,
    damage: ({ attacker, session }) => {
      const n = alive(session?.state?.enemies).filter(unit => unit !== attacker)
        .reduce((total, unit) => total + countUniqueActiveBuffs(unit), 0);
      return raw(attacker, 'magAtk', 1.5 + 0.15 * Math.min(5, n));
    },
    effect: { id: 'gloom', duration: 2 }, aiScore: () => 140,
    description: '150–225% МА уроном Тьмы за усиления на союзниках (кроме себя) и Мрак на 2 хода.',
  },
  'Шахты: Утрата памяти': {
    name: 'Утрата памяти', cooldown: 4, type: 'support', damage: 0,
    effect: { id: 'forgetfulness', duration: 2 }, aiScore: () => 102,
    description: 'Беспамятство на 2 хода.',
  },
  'Шахты: Начальные припасы': {
    name: 'Начальные припасы', passive: true,
    onBattleStart: ({ owner }) => cappedSupplies(owner, 3),
    description: 'Начинает бой с тремя неснимаемыми Припасами (максимум 3).',
  },
  'Шахты: Бросок бомбами': {
    name: 'Бросок бомбами', cooldown: 0, damage: 0, type: 'support', targeting: 'allEnemies',
    canUse: ({ attacker }) => getEffectStackCount(attacker, 'supplies') > 0,
    aiScore: ({ attacker }) => 150 + getEffectStackCount(attacker, 'supplies') * 8,
    apply: ({ attacker, targets, session, log, applyDirectDamage }) => {
      const bombs = consumeEffectStacks(attacker, 'supplies', 3);
      for (let shot = 1; shot <= bombs && attacker.hp > 0; shot++) {
        hitHostiles(attacker, targets, 0.8, applyDirectDamage, unit => {
          if (bombs >= 2) apply(unit, 'charge', undefined, attacker, session, log);
          if (bombs >= 3 && shot === 3) apply(unit, 'burn', 2, attacker, session, log);
        });
      }
      log?.('💣 Бросок бомбами: ' + bombs + ' бомб.');
    },
    description: 'Расходует все Припасы, до 3 бомб по 80% ФА всем врагам; 2+ дают Заряд за каждую, 3 дают Горение.',
  },
  'Шахты: Искажённое пополнение': {
    name: 'Искажённое пополнение', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.LIGHTNING,
    damage: ({ attacker }) => raw(attacker, 'magAtk', 1.5),
    effect: { id: 'charge' },
    aiScore: ({ attacker }) => getEffectStackCount(attacker, 'supplies') <= 1 ? 146 : 86,
    apply: ({ attacker, target, log }) => {
      const gain = Math.floor(countUniqueActiveBuffs(target) / 2);
      if (gain) cappedSupplies(attacker, getEffectStackCount(attacker, 'supplies') + gain);
      log?.('💣 Припасов: ' + getEffectStackCount(attacker, 'supplies') + '/3.');
    },
    description: 'Наносит 150% магической атаки Молнией и накладывает Заряд; получает дополнительный Припас за каждые два вида положительных эффектов на цели.',
  },
  'Шахты: Плавящиеся щиты': {
    name: 'Плавящиеся щиты', passive: true,
    modifyShieldDamage: ({ target }) => has(target, 'burn') ? 1.3 : 1,
    description: 'По горящим целям наносит на 30% больше урона Щитам (но не здоровью).',
  },
  'Шахты: Порочное лекарство': {
    name: 'Порочное лекарство', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.DARKNESS,
    damage: ({ attacker }) => raw(attacker, 'magAtk', 1.1),
    effect: [{ id: 'gloom', duration: 2 }, { id: 'healing_curse', duration: 2 }],
    aiScore: () => 124,
    description: '110% МА Тьмой, Мрак и Проклятие исцеления на 2 хода.',
  },
  'Шахты: Переливание крови': {
    name: 'Переливание крови', cooldown: 4, type: 'magical', school: MAGIC_SCHOOLS.DARKNESS,
    damage: ({ attacker }) => raw(attacker, 'magAtk', 1.2),
    aiScore: () => 130,
    apply: ({ attacker, target, session, log }) => {
      if (!target || target.hp <= 0) return;
      for (const unit of [target, attacker]) {
        apply(unit, 'vampire_mark', 2, attacker, session, log);
        apply(unit, 'bleed', 1, attacker, session, log);
        apply(unit, 'bleed', 1, attacker, session, log);
      }
    },
    description: '120% МА Тьмой, Метка вампира на 2 хода и два продления Кровотечения себе и цели.',
  },
  'Шахты: Быстрое свёртывание': {
    name: 'Быстрое свёртывание', passive: true, minesRapidClotting: true,
    description: '+5 к базовой скорости навсегда за каждый тик Кровотечения у любого бойца.',
  },
  'Шахты: Клеймо начальника': {
    name: 'Клеймо начальника', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.LIGHT,
    damage: ({ attacker }) => raw(attacker, 'magAtk', 1),
    effect: { id: 'searing_mark', duration: 3 },
    aiScore: ({ target }) => isMarked(target) ? 84 : 140,
    description: '100% МА Светом, Испепеляющее клеймо на 3 хода.',
  },
  'Шахты: Взыскание': {
    name: 'Взыскание', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.DARKNESS,
    damage: ({ attacker }) => raw(attacker, 'magAtk', 1.35), aiScore: ({ target }) => isMarked(target) ? 116 : 82,
    apply: ({ attacker, target, session, log }) => {
      if (!isMarked(target)) return;
      const stolen = random(buffs(target), session);
      if (stolen && transferMinesStatus(target, attacker, stolen, attacker, session, log)) {
        apply(attacker, 'shield', 2, attacker, session, log, { value: Math.round(attacker.maxHp * 0.08) });
      }
    },
    description: 'Наносит 135% магической атаки Тьмой; при наличии Клейма крадёт один снимаемый положительный эффект и получает Щит на 8% максимального здоровья.',
  },
  'Шахты: Переплавка': {
    name: 'Переплавка', cooldown: 4, damage: 0, type: 'support', targeting: 'self',
    canUse: ({ attacker, opponents }) => attacker?._minesPhase === 2
      && !attacker._minesPhaseAwaitingHeroTurn && alive(opponents).some(isMarked),
    aiScore: () => 170,
    apply: ({ attacker, session, log, applyDirectDamage }) => {
      alive(session?.state?.players).filter(isMarked).forEach(unit => {
        applyDirectDamage?.(unit, raw(attacker, 'magAtk', 1.75), {
          name: 'Переплавка', targeting: 'allEnemies', type: 'magical',
          school: MAGIC_SCHOOLS.DARKNESS,
        });
        cleanseEffects(unit, effect => effect.id === 'searing_mark', log, { session, actor: attacker });
      });
      cleanseEffects(attacker, effect => getEffectDefinition(effect?.id)?.type === 'debuff' && isEffectTransferable(effect), log, { session, actor: attacker });
    },
    description: 'Во второй фазе наносит 175% магической атаки Тьмой целям с Клеймом, расходует их Клеймо и снимает собственные снимаемые отрицательные эффекты.',
  },
  'Шахты: Начальственный произвол': {
    name: 'Начальственный произвол', passive: true,
    onTurnStart: ({ owner, session, log }) => {
      owner._minesOwnTurns = (owner._minesOwnTurns || 0) + 1;
      const players = alive(session?.state?.players);
      if (owner._minesOwnTurns % 2 === 1) {
        const preferred = players[0] && buffs(players[0]).length ? players[0] : players.slice(1).find(unit => buffs(unit).length);
        if (preferred) {
          const picked = random(buffs(preferred), session);
          transferMinesStatus(preferred, owner, picked, owner, session, log);
        }
      } else {
        const picked = random(debuffs(owner), session);
        const chosen = random(players, session);
        if (picked && chosen) transferMinesStatus(owner, chosen, picked, owner, session, log);
      }
    },
    description: 'В нечётные ходы крадёт снимаемый положительный эффект (герой в приоритете). В чётные переносит один снимаемый отрицательный эффект с себя на противника.',
  },
};
