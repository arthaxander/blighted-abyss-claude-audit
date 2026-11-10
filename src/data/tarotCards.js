import { EFFECT_IDS } from '../utils/effects';

const resolveEffectId = (nameOrId) => {
  if (!nameOrId) return null;
  return EFFECT_IDS[nameOrId] || nameOrId;
};

const TAROT_CARDS = [
  {
    id: 'tarot_sun',
    name: 'Солнце',
    polarity: 'positive',
    description:
      'После каждой победы вы восстанавливаете часть здоровья и входите в следующий бой под действием регенерации.',
    effects: {
      postVictory: {
        healFraction: 0.2,
        addPreCombatEffects: [
          { id: 'regeneration', duration: 1, sourceName: 'Солнце' },
        ],
      },
    },
  },
  {
    id: 'tarot_chariot',
    name: 'Колесница',
    polarity: 'positive',
    description:
      'В начале боя вы получаете прилив скорости и быстрее заполняете шкалу хода.',
    effects: {
      turnMeter: { bonus: 250 },
      preCombatEffects: [
        { id: 'speed_boost_minor', duration: 2, sourceName: 'Колесница' },
      ],
    },
  },
  {
    id: 'tarot_star',
    name: 'Звезда',
    polarity: 'positive',
    description:
      'Каждый сундук дарит дополнительный предмет. Карта приносит вдохновение и надежду.',
    effects: {
      chestModifiers: { extraRolls: 1 },
    },
  },
  {
    id: 'tarot_highpriestess',
    name: 'Жрица',
    polarity: 'positive',
    description:
      'Перед боем вокруг вас возникает мягкий щит и короткая благословляющая мантра.',
    effects: {
      preCombatEffects: [
        { id: 'regeneration', duration: 1, sourceName: 'Жрица' },
        { id: 'shield', duration: 2, valuePercentMaxHp: 0.15, sourceName: 'Жрица' },
      ],
    },
  },
  {
    id: 'tarot_tower',
    name: 'Башня',
    polarity: 'negative',
    description:
      'Каждый бой начинается с дезориентирующего удара: вы медленнее заполняете шкалу хода.',
    effects: {
      turnMeter: { penalty: 150 },
      preCombatEffects: [
        { id: 'speed_penalty_minor', duration: 2, sourceName: 'Башня' },
      ],
    },
  },
  {
    id: 'tarot_moon',
    name: 'Луна',
    polarity: 'negative',
    description:
      'После победы сомнения ранят вас и оставляют слепящую дымку перед следующим боем.',
    effects: {
      postVictory: {
        damageFraction: 0.08,
        addPreCombatEffects: [
          { id: 'blind', duration: 1, sourceName: 'Луна' },
        ],
      },
    },
  },
  {
    id: 'tarot_devil',
    name: 'Дьявол',
    polarity: 'negative',
    description:
      'Сокровища часто оказываются пустышкой, а бой начинается с кровавых цепей.',
    effects: {
      preCombatEffects: [
        { id: 'bleed', duration: 1, sourceName: 'Дьявол' },
      ],
      chestModifiers: { removeRolls: 1 },
    },
  },
];

const POSITIVE_CARDS = TAROT_CARDS.filter(card => card.polarity === 'positive');
const NEGATIVE_CARDS = TAROT_CARDS.filter(card => card.polarity === 'negative');

const shuffle = (array) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const getTarotCardById = (id) => TAROT_CARDS.find(card => card.id === id);

export const getTarotCards = (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return ids
    .map(id => getTarotCardById(id))
    .filter(Boolean);
};

export const drawTarotSpread = () => {
  const positives = shuffle(POSITIVE_CARDS);
  const negatives = shuffle(NEGATIVE_CARDS);
  const chosen = [...positives.slice(0, 2), ...negatives.slice(0, 1)];
  return shuffle(chosen).map(card => card.id);
};

const transformEffect = (effect, unit, fallbackSource) => {
  const resolved = { ...effect };
  if (!resolved.id && resolved.name) {
    resolved.id = resolveEffectId(resolved.name);
  }
  resolved.id = resolveEffectId(resolved.id);
  if (!resolved.sourceName) {
    resolved.sourceName = fallbackSource || 'Карты Таро';
  }
  if (resolved.valuePercentMaxHp && unit) {
    const maxHp = unit.maxHp ?? unit.hp ?? 0;
    const computed = Math.max(1, Math.round(maxHp * resolved.valuePercentMaxHp));
    resolved.value = computed;
    delete resolved.valuePercentMaxHp;
  }
  return resolved;
};

export const getTarotPreCombatEffects = (ids = [], unit = null, options = {}) => {
  if (options?.ignoreTarot) return [];
  const cards = getTarotCards(ids);
  if (!cards.length) return [];
  const effects = [];
  cards.forEach(card => {
    const list = card.effects?.preCombatEffects;
    if (Array.isArray(list)) {
      list.forEach(effect => {
        effects.push(transformEffect(effect, unit, card.name));
      });
    }
  });
  return effects;
};

export const applyTarotBattleStartEffects = (session, playerData = {}) => {
  if (!session?.state || playerData.ignoreTarot) return;
  const cards = getTarotCards(playerData.tarotSpread);
  if (cards.length === 0) return;
  const player = session.state.players?.[0];
  if (!player) return;
  let turnShift = 0;
  cards.forEach(card => {
    const cfg = card.effects?.turnMeter;
    if (!cfg) return;
    if (cfg.bonus) turnShift += cfg.bonus;
    if (cfg.penalty) turnShift -= cfg.penalty;
  });
  if (turnShift !== 0) {
    player.turnMeter = Math.max(0, (player.turnMeter ?? 0) + turnShift);
    session.state.log.push(
      turnShift > 0
        ? 'Карты судьбы ускоряют ваши действия.'
        : 'Зловещая карта мешает вам собраться с силами.'
    );
  }
};

export const applyTarotPostVictoryEffects = (playerState, tarotIds = []) => {
  if (!playerState) return { player: playerState, messages: [] };
  const cards = getTarotCards(tarotIds);
  if (!cards.length) {
    return { player: playerState, messages: [] };
  }
  const updated = { ...playerState };
  const pendingEffects = Array.isArray(updated.preCombatEffects)
    ? [...updated.preCombatEffects]
    : [];
  const messages = [];
  cards.forEach(card => {
    const cfg = card.effects?.postVictory;
    if (!cfg) return;
    if (cfg.healFraction) {
      const maxHp = updated.maxHp ?? updated.hp ?? 0;
      const healAmount = Math.max(1, Math.round(maxHp * cfg.healFraction));
      const before = updated.hp ?? maxHp;
      updated.hp = Math.min(updated.maxHp ?? before, before + healAmount);
      messages.push(`«${card.name}» лечит вас на ${healAmount} HP.`);
    }
    if (cfg.damageFraction) {
      const maxHp = updated.maxHp ?? updated.hp ?? 0;
      const damage = Math.max(1, Math.round(maxHp * cfg.damageFraction));
      const before = updated.hp ?? maxHp;
      updated.hp = Math.max(1, before - damage);
      messages.push(`«${card.name}» истощает ${damage} HP.`);
    }
    if (Array.isArray(cfg.addPreCombatEffects)) {
      cfg.addPreCombatEffects.forEach(effect => {
        pendingEffects.push(transformEffect(effect, updated, card.name));
      });
      messages.push(`«${card.name}» готовит особое состояние к следующему бою.`);
    }
  });
  updated.preCombatEffects = pendingEffects;
  return { player: updated, messages };
};

export const getTarotChestModifiers = (tarotIds = []) => {
  const cards = getTarotCards(tarotIds);
  const modifiers = { extraRolls: 0, removeRolls: 0 };
  cards.forEach(card => {
    const cfg = card.effects?.chestModifiers;
    if (!cfg) return;
    if (cfg.extraRolls) modifiers.extraRolls += cfg.extraRolls;
    if (cfg.removeRolls) modifiers.removeRolls += cfg.removeRolls;
  });
  return modifiers;
};

export const describeTarotCard = (card) => {
  if (!card) return '';
  return `${card.name} — ${card.description}`;
};

export const TAROT_CARD_DEFINITIONS = TAROT_CARDS;
