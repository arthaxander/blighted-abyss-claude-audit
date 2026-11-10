export const CURSE_IDS = {
  CORRUPTION: 'corruption', DISTORTION: 'distortion', WITHERING: 'withering',
  UNDEATH: 'undeath', DECAY: 'decay',
};

export const MAX_CURSE_TIER = 5;
export const DOMINANT_CURSE_TIER = 3;
export const TOTAL_CURSE_PROGRESS_CAP = 13;

export const getCurseTierCapForAbyssLevel = abyssLevel => {
  const level = Math.max(1, Number(abyssLevel) || 1);
  if (level <= 1) return 1;
  if (level === 2) return 2;
  if (level === 3) return 4;
  return MAX_CURSE_TIER;
};

export const CURSE_PRESENTATION = Object.freeze({
  [CURSE_IDS.CORRUPTION]: { symbol: '◆', accent: '#9f4555', glow: 'rgba(126, 35, 55, .28)' },
  [CURSE_IDS.DISTORTION]: { symbol: '◇', accent: '#765a9d', glow: 'rgba(87, 63, 126, .3)' },
  [CURSE_IDS.WITHERING]: { symbol: '⌁', accent: '#627451', glow: 'rgba(66, 88, 53, .28)' },
  [CURSE_IDS.UNDEATH]: { symbol: '◌', accent: '#8293a3', glow: 'rgba(87, 108, 126, .28)' },
  [CURSE_IDS.DECAY]: { symbol: '✦', accent: '#907953', glow: 'rgba(117, 88, 48, .26)' },
});

const tier = (level, title, description, config = {}) => ({
  level, title, description, modifiers: config.modifiers || {}, effects: config.effects || [],
});

export const CURSE_DEFINITIONS = {
  [CURSE_IDS.CORRUPTION]: {
    id: CURSE_IDS.CORRUPTION, name: 'Алтарь Осквернения', shortName: 'Осквернение', presentation: CURSE_PRESENTATION[CURSE_IDS.CORRUPTION],
    description: 'Кровь отзывается на зов Бездны. Боль разжигает жажду, которая требует всё больше.',
    tiers: [
      tier(1, 'Жажда', 'Первое успешное прямое нанесение урона здоровью в свой ход даёт 1 заряд [Жажды], максимум 3. Каждый заряд [Жажды] даёт +5% всего исходящего урона и +8% физической Атаки.'),
      tier(2, 'Кровавый голод', 'Первое получение прямого урона здоровью между своими ходами также даёт 1 заряд [Жажды]. При 3 зарядах [Жажды] герой получает 5% вампиризма от фактически нанесённого прямого урона здоровью.'),
      tier(3, 'Открытая рана', 'Если герой завершает ход, не нанеся прямого урона здоровью, он получает 1 [Кровотечение].'),
      tier(4, 'Багровый экстаз', 'Каждое срабатывание собственного [Кровотечения] даёт 1 заряд эффекта [Багровый экстаз], максимум 3. Каждый заряд даёт +10% всего исходящего урона и +10% Скорости. Когда [Кровотечение] полностью исчезает, все заряды снимаются. При первом достижении 3 зарядов [Жажды] за бой герой получает 2 [Кровотечения].'),
      tier(5, 'Багровое перерождение', 'В начале каждого своего хода герой получает 1 [Кровотечение].'),
    ],
  },
  [CURSE_IDS.DISTORTION]: {
    id: CURSE_IDS.DISTORTION, name: 'Алтарь Искажения', shortName: 'Искажение', presentation: CURSE_PRESENTATION[CURSE_IDS.DISTORTION],
    description: 'Кристалл преломляет боль и возвращает её врагу. Накопленная сила делает реальность хрупкой.',
    commonText: 'Максимальный запас [Преломления] — 30% максимального здоровья. Следующее успешное прямое попадание по здоровью расходует весь запас и наносит дополнительный урон, равный накопленному значению.',
    tiers: [
      tier(1, 'Кристаллический панцирь', 'Урон, дошедший до здоровья, уменьшается на 10%. Предотвращённый Искажением урон сохраняется как [Преломление].'),
      tier(2, 'Обратное преломление', 'Первое прямое попадание по здоровью после каждого своего хода уменьшается на 25% вместо 10%. Предотвращённый урон также сохраняется как [Преломление].'),
      tier(3, 'Искажённое отражение', 'При расходовании [Преломления] дополнительный урон от него увеличивается на 50%. За каждые накопленные 10% максимального здоровья в [Преломлении] Скорость снижается на 4%.'),
      tier(4, 'Раскол реальности', 'Базовое снижение урона, дошедшего до здоровья, увеличивается до 15%. За каждые 10% максимального здоровья в [Преломлении] Скорость снижается на 5%. При полном запасе [Преломления] урон, дошедший до здоровья, после снижения увеличивается на 10%, пока запас не будет потрачен. Расход полного запаса накладывает на цель 1 [Заряд].'),
      tier(5, 'Невозможный исход', 'Один раз за бой смертельный прямой урон оставляет герою 1 единицу здоровья. При каждом заполнении [Преломления] до максимума герой получает 1 [Заряд]. Если спасение от смертельного удара одновременно вызывает разряд от [Заряда], этот разряд не может тут же добить героя.'),
    ],
  },
  [CURSE_IDS.WITHERING]: {
    id: CURSE_IDS.WITHERING, name: 'Алтарь Увядания', shortName: 'Увядание', presentation: CURSE_PRESENTATION[CURSE_IDS.WITHERING],
    description: 'Корни вплетаются в живую плоть. Всё поле боя становится частью единого организма.',
    tiers: [
      tier(1, 'Симбиоз', 'В начале каждого боя герой восстанавливает 5% максимального здоровья и получает +5% Скорости.'),
      tier(2, 'Первые корни', 'Перед первым фактическим ходом героя он и случайный враг получают по 1 [Опутыванию]. После этого каждый третий завершённый ход любого действующего участника боя накладывает 1 [Опутывание] на случайного врага.'),
      tier(3, 'Общая сеть', 'Каждое успешное наложение [Опутывания] даёт герою +10% шкалы хода. Дополнительно герой получает +10% Скорости. Один раз за бой, на случайном 4–8-м завершённом ходу, все живые действующие участники боя получают 1 [Опутывание].'),
      tier(4, 'Великие корни', 'Массовое срабатывание «Общей сети» накладывает 2 [Опутывания] вместо 1. За каждого живого врага с [Опутыванием] герой наносит на 8% больше урона.'),
      tier(5, 'Единый организм', 'Каждое успешное наложение [Опутывания] теперь даёт герою +20% шкалы хода и восстанавливает 8% максимального здоровья.'),
    ],
  },
  [CURSE_IDS.UNDEATH]: {
    id: CURSE_IDS.UNDEATH, name: 'Алтарь Несмертия', shortName: 'Несмертие', presentation: CURSE_PRESENTATION[CURSE_IDS.UNDEATH],
    description: 'Неупокоенные души повторяют движения героя. Смерть отступает, но оставляет свой след.',
    commonText: 'Базовая эффективность [Эха] — 40%. [Эхо] не может породить новое [Эхо].',
    tiers: [
      tier(1, 'Отголосок', 'Первая небазовая способность героя в каждом бою получает [Эхо] 40%.'),
      tier(2, 'Неупокоенность', 'После смерти врага следующая небазовая способность героя получает [Эхо] 40%. Одновременно может быть подготовлено только одно такое Эхо. Эффективность получаемых героем щитов снижена на 10%.'),
      tier(3, 'Неугасший след', 'Эффективность [Эха] собственных способностей героя повышается минимум до 60%. Каждая третья небазовая способность также получает [Эхо]. После срабатывания собственного [Эха] герой получает [Замедление] на 1 ход.'),
      tier(4, 'Неотпущенные души', '+15% к максимальному здоровью и +10% ко всему исходящему урону. Если собственное [Эхо] убивает хотя бы одного врага, герой восстанавливает 8% максимального здоровья и получает +20% шкалы хода. Первое успешно выполненное действие каждого врага в бою получает [Эхо] 40%.'),
      tier(5, 'Хватка смерти', 'Один раз за бой смертельный урон оставляет герою 1 единицу здоровья, снимает все снимаемые дебаффы и немедленно вызывает [Эхо] 60% последней подходящей небазовой способности. При здоровье ниже 50% Скорость и эффективность получаемого лечения постепенно снижаются: от 0% при 50% здоровья до −30% почти при 0.'),
    ],
  },
  [CURSE_IDS.DECAY]: {
    id: CURSE_IDS.DECAY, name: 'Алтарь Тления', shortName: 'Тление', presentation: CURSE_PRESENTATION[CURSE_IDS.DECAY],
    description: 'Время и память обращаются в пепел. Оставшаяся ясность превращает каждый эффект в оружие.',
    tiers: [
      tier(1, 'Пепельная ясность', 'Первая применённая небазовая способность в каждом бою после использования получает −1 ход текущей перезарядки. Герой наносит на 5% больше урона.'),
      tier(2, 'Затянувшееся мгновение', 'Баффы, накладываемые на героя на 2+ хода, длятся на 1 ход дольше. Дебаффы, накладываемые на врагов на 2+ хода, также длятся на 1 ход дольше.'),
      tier(3, 'Перегруженное сознание', 'За каждый уникальный активный бафф на герое он наносит на 4% больше и получает на 4% меньше урона. Получение или обновление баффа при 2+ уникальных активных баффах накладывает [Беспамятство]. Эффект может сработать не чаще одного раза в 3 собственных хода героя.'),
      tier(4, 'Испепелённая память', 'За каждый уникальный активный дебафф на герое он наносит на 3% больше и получает на 3% меньше урона. Получение или обновление баффа при 4+ уникальных активных баффах накладывает [Испепеляющее клеймо] на героя и случайного врага. Эффект может сработать не чаще одного раза в 3 собственных хода героя; после готовности требуется новое получение или обновление баффа.'),
      tier(5, 'Выжженное время', 'За каждый оставшийся ход перезарядки собственных активных способностей герой наносит на 4% больше урона. Каждый враг за каждый оставшийся ход перезарядки своих активных способностей наносит и получает на 2% больше урона.'),
    ],
  },
};

export const CURSE_POOL = Object.values(CURSE_DEFINITIONS);

export function ensureCurseState(source) {
  if (!source || typeof source !== 'object') return {};
  return Object.entries(source).reduce((result, [id, value]) => {
    const tierValue = Number(typeof value === 'number' ? value : value?.tier);
    if (CURSE_DEFINITIONS[id] && tierValue > 0) result[id] = { tier: Math.min(MAX_CURSE_TIER, tierValue) };
    return result;
  }, {});
}

export const getCurseDefinition = id => CURSE_DEFINITIONS[id] || null;
export const getCurseTier = (state = {}, curseId) => ensureCurseState(state)[curseId]?.tier ?? 0;
export const getCurseProgressTotal = (state = {}) => Object.values(ensureCurseState(state))
  .reduce((sum, entry) => sum + (Number(entry?.tier) || 0), 0);
export const getRemainingCurseProgress = (state = {}) =>
  Math.max(0, TOTAL_CURSE_PROGRESS_CAP - getCurseProgressTotal(state));
export const getAbyssBindingCurse = (state = {}) => getActiveCursesList(state)
  .find(curse => curse.tier >= MAX_CURSE_TIER) || null;
export const isAbyssBound = (state = {}) => Boolean(getAbyssBindingCurse(state));

export function getNextCurseTierPreview(
  state,
  curseId,
  dominantCurseId = null,
  { abyssLevel = null } = {}
) {
  const definition = getCurseDefinition(curseId);
  if (!definition) return null;
  const currentTier = getCurseTier(state, curseId);
  const nextTier = currentTier + 1;
  const atMaximum = currentTier >= MAX_CURSE_TIER;
  const progressionFull = getCurseProgressTotal(state) >= TOTAL_CURSE_PROGRESS_CAP;
  const floorCap = abyssLevel == null ? MAX_CURSE_TIER : getCurseTierCapForAbyssLevel(abyssLevel);
  const blockedByFloor = !atMaximum && nextTier > floorCap;
  const blockedByDominant = !atMaximum
    && nextTier >= DOMINANT_CURSE_TIER
    && dominantCurseId
    && dominantCurseId !== curseId;
  const canAccept = !atMaximum && !progressionFull && !blockedByFloor && !blockedByDominant;
  return {
    currentTier,
    nextTier: atMaximum ? null : nextTier,
    definition,
    tierData: atMaximum ? null : definition.tiers[nextTier - 1],
    canAccept,
    floorCap,
    blockedReason: atMaximum
      ? 'Проклятие уже достигло V уровня.'
      : progressionFull
        ? 'Достигнут общий предел развития Проклятий.'
        : blockedByFloor
          ? `На этом уровне Бездны Проклятие нельзя развить выше ${['—', 'I', 'II', 'III', 'IV', 'V'][floorCap]} уровня.`
          : blockedByDominant
            ? 'Другое Проклятие уже стало главным. Это Проклятие нельзя развить выше II уровня.'
            : null,
    requiresDominantConfirmation: canAccept && nextTier === DOMINANT_CURSE_TIER && !dominantCurseId,
    bindsToAbyss: canAccept && nextTier === MAX_CURSE_TIER,
  };
}

export const getEligibleCursePool = (
  state = {},
  dominantCurseId = null,
  abyssLevel = null
) => CURSE_POOL.filter(curse =>
  getNextCurseTierPreview(state, curse.id, dominantCurseId, { abyssLevel })?.canAccept
);

export function resolveCurseOffering(
  state = {},
  curseId,
  dominantCurseId = null,
  options = {}
) {
  const preview = getNextCurseTierPreview(state, curseId, dominantCurseId, options);
  if (!preview || !preview.canAccept) {
    return { ...preview, accepted: false, nextState: ensureCurseState(state), dominantCurseId };
  }
  const nextDominantCurseId = preview.requiresDominantConfirmation ? curseId : dominantCurseId;
  return {
    ...preview,
    accepted: true,
    nextState: { ...ensureCurseState(state), [curseId]: { tier: preview.nextTier } },
    dominantCurseId: nextDominantCurseId,
  };
}

const DEFAULT_SUMMARY = { attackPercent: 0, attackFlat: 0, magAtkPercent: 0, magAtkFlat: 0, physDefPercent: 0, magicDefPercent: 0, maxHpPercent: 0, speedPercent: 0, critChanceBonus: 0, critDamageBonus: 0, dodgeBonus: 0, damageTakenPercent: 0, preCombatEffects: [], notes: [] };
export function aggregateCurseModifiers(state = {}) {
  const summary = { ...DEFAULT_SUMMARY, preCombatEffects: [], notes: [] };
  Object.entries(ensureCurseState(state)).forEach(([id, entry]) => {
    const definition = getCurseDefinition(id);
    definition.tiers.slice(0, entry.tier).forEach(tierData => {
      Object.entries(tierData.modifiers || {}).forEach(([key, value]) => { if (typeof value === 'number') summary[key] = (summary[key] || 0) + value; });
      summary.preCombatEffects.push(...(tierData.effects || []).map(effect => ({ ...effect })));
      summary.notes.push(`${definition.shortName}: ${tierData.title}`);
    });
  });
  return summary;
}

export const formatCurseTierText = tierData => tierData?.description || '';
export function formatActiveCurseText(definition, currentTier) {
  if (!definition) return '';
  return [definition.commonText, ...definition.tiers.slice(0, currentTier).map(entry => `${entry.level}. ${entry.title}: ${entry.description}`)].filter(Boolean).join('\n');
}
export function getActiveCursesList(state = {}) {
  return Object.entries(ensureCurseState(state)).map(([id, entry]) => ({ id, tier: entry.tier, name: getCurseDefinition(id).shortName })).sort((a, b) => a.name.localeCompare(b.name));
}
