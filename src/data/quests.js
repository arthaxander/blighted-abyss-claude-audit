import { addGuildSilver } from '../utils/guildCurrency';

export const QUEST_EVENTS = {
  VICTORY: 'victory',
  CRAFT: 'craft',
  INVENTORY_CHECK: 'inventory_check',
};

const QUEST_DEFINITIONS = [
  {
    id: 'quest-goblin-clearing',
    name: 'Зачистка Нор',
    description: 'Победите 3 группы врагов в Гоблинских Норах.',
    tracking: {
      type: 'counter',
      eventType: QUEST_EVENTS.VICTORY,
      target: 3,
      condition: (event) => !event.location || event.location === 'Гоблинские Норы',
    },
    rewards: {
      silver: 200,
      items: [
        { name: 'Малое зелье здоровья', quantity: 2 },
        { name: 'Простая ткань', quantity: 3 },
      ],
      relicXp: 50,
    },
  },
  {
    id: 'quest-brew-supplies',
    name: 'Снабжение алхимика',
    description: 'Создайте 2 зелья или свитка через крафт.',
    tracking: {
      type: 'counter',
      eventType: QUEST_EVENTS.CRAFT,
      target: 2,
    },
    rewards: {
      silver: 150,
      items: [
        { name: 'Простая склянка', quantity: 4 },
        { name: 'Кровяной мох', quantity: 4 },
      ],
    },
  },
  {
    id: 'quest-stockpile-cloth',
    name: 'Пополнение запасов',
    description: 'Соберите 10 единиц Простой ткани в инвентаре.',
    tracking: {
      type: 'inventory',
      item: 'Простая ткань',
      target: 10,
    },
    rewards: {
      silver: 120,
      items: [
        { name: 'Малое зелье атаки', quantity: 1 },
      ],
    },
  },
];

const ensureEntry = (log, questId) => {
  const existing = log?.[questId];
  if (existing) return { ...existing };
  return { progress: 0, completed: false, claimed: false };
};

export const getQuestDefinitions = () => QUEST_DEFINITIONS;

export const getQuestById = (id) => QUEST_DEFINITIONS.find(q => q.id === id);

export const initializeQuestLog = (log = {}) => {
  const nextLog = { ...log };
  QUEST_DEFINITIONS.forEach(quest => {
    if (!nextLog[quest.id]) {
      nextLog[quest.id] = { progress: 0, completed: false, claimed: false };
    }
  });
  return nextLog;
};

const applyTracking = (entry, quest, event, context) => {
  const tracking = quest.tracking || {};
  const result = { changed: false, entry };

  if (tracking.type === 'counter') {
    if (event.type !== tracking.eventType) {
      return result;
    }
    if (typeof tracking.condition === 'function' && !tracking.condition(event, context)) {
      return result;
    }
    const increment = event.amount ?? tracking.increment ?? 1;
    const newProgress = Math.min(tracking.target ?? 1, (entry.progress || 0) + increment);
    if (newProgress !== entry.progress) {
      entry = { ...entry, progress: newProgress };
      result.changed = true;
    }
    if (!entry.completed && newProgress >= (tracking.target ?? 1)) {
      entry = { ...entry, completed: true };
      result.changed = true;
    }
    result.entry = entry;
    return result;
  }

  if (tracking.type === 'inventory') {
    if (event.type !== QUEST_EVENTS.INVENTORY_CHECK) {
      return result;
    }
    const inventory = event.runInventory || context.runInventory || [];
    const itemName = tracking.item;
    const count = inventory.reduce((sum, stack) => sum + (stack?.itemId === itemName ? Number(stack.quantity) || 1 : 0), 0);
    const clamped = Math.min(tracking.target ?? count, count);
    if (clamped !== entry.progress || (!entry.completed && clamped >= (tracking.target ?? 1))) {
      result.changed = true;
      entry = {
        ...entry,
        progress: clamped,
        completed: clamped >= (tracking.target ?? 1),
      };
    }
    result.entry = entry;
    return result;
  }

  return result;
};

export const processQuestEvents = (log = {}, events = [], context = {}) => {
  let questLog = initializeQuestLog(log);
  const completed = [];

  events.forEach(event => {
    QUEST_DEFINITIONS.forEach(quest => {
      const currentEntry = ensureEntry(questLog, quest.id);
      if (currentEntry.claimed) {
        questLog[quest.id] = currentEntry;
        return;
      }
      if (currentEntry.completed && quest.tracking?.type !== 'inventory') {
        questLog[quest.id] = currentEntry;
        return;
      }
      const { changed, entry } = applyTracking(currentEntry, quest, event, context);
      if (!changed) {
        questLog[quest.id] = entry;
        return;
      }
      questLog[quest.id] = entry;
      if (entry.completed && !currentEntry.completed) {
        completed.push(quest.id);
      }
    });
  });

  return { questLog, newlyCompleted: completed };
};

export const applyRunInventoryQuestProgress = (player, runInventory = player?.runInventory || []) => {
  if (!player) return player;
  const { questLog } = processQuestEvents(
    player.questLog,
    [{ type: QUEST_EVENTS.INVENTORY_CHECK, runInventory }],
    { ...player, runInventory }
  );
  return { ...player, runInventory, questLog };
};

export const describeQuestReward = (reward = {}) => {
  const parts = [];
  if (reward.silver) parts.push(`${reward.silver} серебра`);
  if (Array.isArray(reward.items) && reward.items.length > 0) {
    parts.push(
      reward.items
        .map(item => (item.quantity && item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name))
        .join(', ')
    );
  }
  if (reward.relicXp) parts.push(`Реликвия: +${reward.relicXp} опыта`);
  return parts.join('; ');
};

export const resolveQuestReward = (player, questId) => {
  const quest = getQuestById(questId);
  if (!quest) return player;
  const entry = player.questLog?.[questId];
  if (!entry || !entry.completed || entry.claimed) {
    return player;
  }

  const updatedLog = {
    ...player.questLog,
    [questId]: { ...entry, claimed: true },
  };

  return addGuildSilver({
    ...player,
    questLog: updatedLog,
  }, quest.rewards?.silver || 0);
};
