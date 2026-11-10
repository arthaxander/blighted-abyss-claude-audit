// Ruins of the Restless: named, authored enemy abilities.
// Most actions reuse the canonical combat ability executor rather than
// introducing parallel damage/status calculations.
import { MAGIC_SCHOOLS } from '../constants/magicSchools';
import { addEffect, getEffectStackCount, setEffectStackCount } from '../utils/effects';

const raw = (actor, ratio, stat = 'attack') => Math.max(0, Math.round((actor?.[stat] || 0) * ratio));
const living = units => (units || []).filter(unit => unit?.hp > 0 && !unit?.ruinsBanner && !unit?.nonActingCombatObject);
const enemies = session => living(session?.state?.enemies);
const otherPlayers = (session, target) => living(session?.state?.players).filter(unit => unit !== target);
const giveEcho = unit => setEffectStackCount(unit, 'ruins_echo_charge', Math.min(1, getEffectStackCount(unit, 'ruins_echo_charge') + 1));

export const RESTLESS_RUINS_ABILITIES = {
  'Призыв павшей когорты': {
    name: 'Призыв павшей когорты', artId: 'attack', cooldown: 4, type: 'support', damage: 0, targeting: 'self',
    canUse: ({ allies }) => living(allies).length > 1,
    aiScore: () => 125,
    apply: ({ attacker, session, log }) => {
      const allies = enemies(session).filter(unit => unit !== attacker);
      allies.forEach(unit => { unit.turnMeter = Math.min(1000, (unit.turnMeter || 0) + 150); });
      const target = [...allies].sort((a, b) => Math.max(b.attack || 0, b.magAtk || 0) - Math.max(a.attack || 0, a.magAtk || 0))[0];
      if (target) { giveEcho(target); log?.(`◈ ${target.name} подготавливает [Эхо].`); }
    },
    description: 'Союзники +15% шкалы хода; сильнейший союзник готовит Эхо следующей небазовой способности (40%).',
  },
  'Погребальная дробь': {
    name: 'Погребальная дробь', artId: 'attack', cooldown: 2, type: 'magical', school: MAGIC_SCHOOLS.DEATH,
    damage: ({ attacker }) => raw(attacker, 1.5, 'magAtk'),
    apply: ({ target }) => { if (target) target.turnMeter = Math.max(0, (target.turnMeter || 0) - 200); },
    aiScore: () => 90, description: '150% МА Смертью, -20% шкалы хода.',
  },
  'Несокрушимый строй': {
    name: 'Несокрушимый строй', artId: 'attack', cooldown: 4, type: 'support', targeting: 'self', damage: 0, aiScore: () => 120,
    apply: ({ attacker, session, log }) => {
      addEffect(attacker, { id: 'shield', value: Math.round(attacker.maxHp * .3), duration: 2 }, log, attacker, { session });
      addEffect(attacker, { id: 'guard', duration: 2 }, log, attacker, { session });
      const ally = enemies(session).filter(unit => unit !== attacker).sort((a,b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (ally) addEffect(ally, { id: 'shield', value: Math.round(attacker.maxHp * .2), duration: 2 }, log, attacker, { session });
    },
    description: 'Даёт себе Щит на 30% максимального здоровья и наиболее раненому союзнику Щит на 20% собственного максимального здоровья; Защита союзников на 2 хода.',
  },
  'Сдвоенный таран': {
    name: 'Сдвоенный таран', artId: 'attack', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, (attacker.shield || 0) > 0 ? 2.7 : 1.8),
    description: '180% ФА, или 270% ФА под Щитом. Шкалу хода не снижает.',
  },
  'Погребальный холод': {
    name: 'Погребальный холод', artId: 'attack', cooldown: 3, type: 'magical', school: MAGIC_SCHOOLS.ICE,
    damage: ({ attacker }) => raw(attacker, 1.6, 'magAtk'),
    effect: { id: 'ruins_frostbite', duration: 2 },
    apply: ({ attacker }) => giveEcho(attacker),
    description: '160% МА льдом, Обморожение 2 хода, готовит Эхо следующего небазового умения.',
  },
  'Два голоса зимы': {
    name: 'Два голоса зимы', artId: 'attack', cooldown: 2, type: 'magical', school: MAGIC_SCHOOLS.ICE,
    hits: 2, damage: ({ attacker }) => raw(attacker, 1.15, 'magAtk'),
    apply: ({ attacker, target, session, log }) => {
      if (otherPlayers(session, target).length === 0 && (target?.effects || []).some(e => e.id === 'ruins_frostbite') && (typeof session?.rng === 'function' ? session.rng() : Math.random()) < 0.5) {
        addEffect(target, { id: 'freeze', duration: 1 }, log, attacker, { session });
      }
    },
    description: 'Два попадания по 115% МА льдом; одна обмороженная цель получает Заморозку с шансом 50%.',
  },
  'Загробный галоп': {
    name: 'Загробный галоп', artId: 'attack', cooldown: 2, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 1.8),
    apply: ({ attacker, target }) => {
      if (target) target.turnMeter = Math.max(0, (target.turnMeter || 0) - 200);
      attacker.turnMeter = Math.min(1000, (attacker.turnMeter || 0) + 200);
    },
    description: '180% ФА, -20% шкалы цели, +20% себе.',
  },
  'Последний натиск': {
    name: 'Последний натиск', artId: 'attack', cooldown: 3, type: 'physical',
    damage: ({ attacker, target }) => raw(attacker, (target?.turnMeter || 0) < 500 ? 2.835 : 2.1),
    description: '210% ФА или 283,5% ФА, если у цели менее 50% шкалы хода.',
  },
  'Скрещённые копья': {
    name: 'Скрещённые копья', artId: 'attack', cooldown: 2, type: 'physical', targeting: 'enemy',
    damage: ({ attacker }) => raw(attacker, 1.3),
    effect: { id: 'armor_sunder', duration: 2 },
    secondary: { target: 'otherEnemies', type: 'physical', damage: ({ attacker }) => raw(attacker, 1.3) },
    description: '130% ФА герою и его призывам; основной цели Раскол брони на 2 хода.',
  },
  'Клятва павших': {
    name: 'Клятва павших', artId: 'attack', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 1.9 * (1 + .3 * Math.min(2, attacker._ruinsFallenStartingAllies || 0))),
    description: '190% ФА, +30% урона за каждого погибшего стартового союзника, максимум +60%.',
  },
  'Четыре клинка': {
    name: 'Четыре клинка', artId: 'ruins_four_blades', enemyArtId: 'attack', cooldown: 2,
    type: 'physical', hits: 4, damage: ({ attacker }) => raw(attacker, .6),
    description: 'Четыре удара по 60% ФА; шанс крита растёт на 0/10/20/30 процентных пунктов.',
  },
  'Приговор двух душ': {
    name: 'Приговор двух душ', artId: 'attack', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 2.2), apply: ({ attacker }) => giveEcho(attacker),
    description: '220% ФА; готовит Эхо следующей небазовой способности.',
  },
  'Согласие двух душ': {
    name: 'Согласие двух душ', artId: 'attack', passive: true,
    description: 'С Неупокоенностью четыре клинка игнорируют 30% физической защиты.',
  },
  'Знамя павшей когорты': {
    name: 'Знамя павшей когорты', artId: 'attack', passive: true,
    description: 'При входе в бой призывает уничтожаемое Знамя: +25% прямого урона союзникам.',
  },
  'Когорта не падёт': {
    name: 'Когорта не падёт', artId: 'attack', cooldown: 4, damage: 0, type: 'support', targeting: 'self',
    canUse: ({ allies }) => living(allies).some(a => a.name !== 'Знаменосец павшей когорты' && !(a.effects || []).some(e => e.id === 'immortality')),
    aiScore: () => 130,
    apply: ({ attacker, session, log }) => {
      const ally = enemies(session).filter(a => a !== attacker && !(a.effects || []).some(e => e.id === 'immortality'))
        .sort((a,b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (ally) addEffect(ally, { id: 'immortality', duration: 2 }, log, attacker, { session });
    },
    description: 'Бессмертие на 2 хода наиболее раненому союзнику, кроме себя.',
  },
  'Под павшим знаменем': {
    name: 'Под павшим знаменем', artId: 'attack', cooldown: 3, type: 'physical',
    damage: ({ attacker, session }) => raw(attacker, 1.85 * (enemies(session).some(u => u !== attacker && (u.effects || []).some(e => e.id === 'immortality')) ? 1.35 : 1)),
    secondary: { target: 'otherEnemies', type: 'physical', damage: ({ attacker, session }) => raw(attacker, 1.85 * (enemies(session).some(u => u !== attacker && (u.effects || []).some(e => e.id === 'immortality')) ? 1.35 : 1)) },
    description: '185% ФА герою и призывам, +35% урона при союзнике под Бессмертием.',
  },
  'Сшить заново': {
    name: 'Сшить заново', artId: 'attack', cooldown: 5, damage: 0, type: 'support', targeting: 'self', aiScore: () => 140,
    canUse: ({ attacker, allies }) => living(allies).some(a => a !== attacker && !(a.effects || []).some(e => e.id === 'rebirth')),
    apply: ({ attacker, session, log }) => {
      enemies(session).filter(u => u !== attacker).forEach(u => addEffect(u, { id: 'rebirth', duration: 3 }, log, attacker, { session }));
    },
    description: 'Все живые союзники, кроме себя, получают снимаемое Перерождение на 3 хода.',
  },
  'Покинутая оболочка': {
    name: 'Покинутая оболочка', artId: 'attack', cooldown: 4,
    type: 'magical', school: MAGIC_SCHOOLS.DEATH,
    damage: ({ attacker }) => raw(attacker, 1.75, 'magAtk'),
    selfEffects: { id: 'spectral_form', duration: 1 },
    description: '175% МА Смертью, Спектральная форма на 1 ход.',
  },
  'Пролом строя': {
    name: 'Пролом строя', artId: 'attack', cooldown: 2, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 1.8 * (1 + (attacker._ruinsSiegeMomentum || 0) * .15)),
    effect: { id: 'bleed', duration: 2 },
    secondary: { target: 'otherEnemies', type: 'physical', damage: ({ attacker }) => raw(attacker, 1.15 * (1 + (attacker._ruinsSiegeMomentum || 0) * .15)) },
    apply: ({ attacker }) => { attacker._ruinsSiegeMomentum = 0; },
    description: '180% ФА основной цели, 115% остальным, Кровотечение 2 хода главной цели.',
  },
  'Мясной таран': {
    name: 'Мясной таран', artId: 'attack', cooldown: 4, damage: 0, type: 'support', targeting: 'self', aiScore: () => 125,
    canUse: ({ attacker }) => !attacker._ruinsSiegePreparation,
    apply: ({ attacker, session, log }) => {
      attacker.hp = Math.max(1, attacker.hp - Math.round(attacker.maxHp * .1));
      addEffect(attacker, { id: 'bleed', duration: 2 }, log, attacker, { session, forceIndependentInstance: true });
      addEffect(attacker, { id: 'bleed', duration: 2 }, log, attacker, { session, forceIndependentInstance: true });
      attacker._ruinsSiegePreparation = true;
      log?.(`⚠️ ${attacker.name} готовит Мясной таран!`);
    },
    description: 'Теряет 10% максимального здоровья, получает 2 Кровотечения и готовит удар на следующий ход: 300% физической атаки основной цели, 170% остальным.',
  },
  'Кровавая инерция': { name: 'Кровавая инерция', passive: true,
    description: 'Каждый тик собственного Кровотечения даёт +15% урона следующей атаке, до +30%.' },
  'Пристрелочный скол': {
    name: 'Пристрелочный скол', artId: 'attack', cooldown: 2, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 1.65), effect: { id: 'vulnerability', duration: 2 },
    description: '165% ФА и Уязвимость на 2 хода.',
  },
  'Преломлённый выстрел': {
    name: 'Преломлённый выстрел', artId: 'attack', cooldown: 3, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 2.1),
    description: '210% ФА; при попадании расходует накопленное Преломление как дополнительный урон.',
  },
  'Кристаллическая память': { name: 'Кристаллическая память', passive: true,
    description: 'Первый прямой урон по здоровью после собственного хода уменьшается на 25%, последующий — на 10%. Предотвращённый урон накапливается до 30% максимального здоровья.' },
  'Отделение шеренги': { name: 'Отделение шеренги', passive: true,
    description: 'В начале боя Легион призывает двух солдат.' },
  'Приказ на прорыв': {
    name: 'Приказ на прорыв', artId: 'attack', cooldown: 3, type: 'physical',
    canUse: ({ attacker }) => (attacker._legionPhase || 1) === 1, aiScore: () => 125,
    damage: ({ attacker }) => raw(attacker, 1.6),
    apply: ({ attacker, session }) => {
      living(session?.state?.enemies).filter(u => u.ruinsLegionSoldier && u.ownerId === attacker.id).forEach(soldier => {
        const target = living(session?.state?.players)[0];
        if (target) session.applyIndirectDamage?.(target, raw(soldier, soldier.name === 'Погребённый рубака' ? 1.2 : .8), 'physical', { source: soldier });
      });
    },
    description: '160% ФА по цели; каждый живой солдат немедленно атакует на 80% эффективности.',
  },
  'Восстановить строй': {
    name: 'Восстановить строй', artId: 'attack', cooldown: 4, type: 'support', targeting: 'self', damage: 0,
    canUse: ({ attacker, session }) => (attacker._legionPhase || 1) === 1 &&
      (attacker._ruinsLegionSummoned || 0) < 4 &&
      living(session?.state?.enemies).filter(u => u.ruinsLegionSoldier && u.ownerId === attacker.id).length < 2,
    aiScore: () => 130,
    apply: ({ attacker, session }) => {
      const soldiers = living(session.state.enemies).filter(u => u.ruinsLegionSoldier && u.ownerId === attacker.id);
      const name = soldiers.some(u => u.name === 'Погребённый щитоносец') ? 'Погребённый рубака' : 'Погребённый щитоносец';
      const result = session.summonEnemy?.(name, { source: attacker });
      if (result?.success) attacker._ruinsLegionSummoned = (attacker._ruinsLegionSummoned || 0) + 1;
    },
    description: 'Призывает недостающего солдата, не более 2 одновременно и 4 за бой.',
  },
  'Последняя шеренга': {
    name: 'Последняя шеренга', artId: 'attack', cooldown: 4, type: 'physical',
    canUse: ({ attacker }) => (attacker._legionPhase || 1) === 2 && !attacker._ruinsLegionPreparation,
    aiScore: () => 125,
    damage: ({ attacker }) => raw(attacker, 1.5),
    secondary: { target: 'otherEnemies', type: 'physical', damage: ({ attacker }) => raw(attacker, 1) },
    apply: ({ attacker, session, log }) => {
      addEffect(attacker, { id: 'shield', value: 200, duration: 2 }, log, attacker, { session });
      attacker._ruinsLegionPreparation = true;
      log?.(`⚠️ ${attacker.name} готовит Прорыв шеренги!`);
    },
    description: '150% ФА цели и 100% остальным; Щит 200 и подготовка прорыва на следующий ход.',
  },
  'Последний приказ': {
    name: 'Последний приказ', artId: 'attack', cooldown: 3, type: 'physical',
    canUse: ({ attacker }) => (attacker._legionPhase || 1) === 2,
    damage: ({ attacker }) => raw(attacker, 2.6),
    apply: ({ attacker }) => giveEcho(attacker),
    description: '260% ФА одной цели; готовит Эхо следующей небазовой способности.',
  },
  'Удар погребённого щитоносца': {
    name: 'Удар погребённого щитоносца', artId: 'attack', cooldown: 1, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 1),
    description: '100% ФА.',
  },
  'Удар погребённого рубаки': {
    name: 'Удар погребённого рубаки', artId: 'attack', cooldown: 1, type: 'physical',
    damage: ({ attacker }) => raw(attacker, 1.5),
    description: '150% ФА.',
  },
};
