import { ensureRelicState, grantRelicExperience } from '../data/relics';

export const BASE_RESONANCE_BY_ENEMY_RANK = Object.freeze({ ordinary: 1, strong: 3, cursed: 5, boss: 15 });
export const ABYSS_LEVEL_RESONANCE_MULTIPLIER = Object.freeze({ 1: 1 });
export const getAbyssLevelResonanceMultiplier = level => ABYSS_LEVEL_RESONANCE_MULTIPLIER[level] ?? 1;
export const getEnemyResonanceRank = enemy => enemy?.cursed ? 'cursed' : enemy?.rank === 'boss' ? 'boss' : ['strong', 'miniBoss'].includes(enemy?.rank) ? 'strong' : 'ordinary';
export const calculateEncounterResonance = (roster = [], abyssLevel = 1) => {
  const seen = new Set(); const multiplier = getAbyssLevelResonanceMultiplier(abyssLevel);
  return (roster || []).reduce((total, enemy, index) => {
    const rewardId = enemy?.rewardId ?? `${enemy?.id || enemy?.name || 'enemy'}:${index}`;
    if (!enemy || enemy.summoned || enemy.summonOnly || enemy.rewardBearing === false || seen.has(rewardId)) return total;
    seen.add(rewardId);
    return total + Math.round((BASE_RESONANCE_BY_ENEMY_RANK[getEnemyResonanceRank(enemy)] || 0) * multiplier);
  }, 0);
};
export const addRunResonance = (player, amount) => ({ ...player, runResonance: Math.max(0, (player?.runResonance || 0) + Math.max(0, Math.floor(amount || 0))) });
export const loseRunResonance = player => ({ ...player, runResonance: 0 });
export const transferRunResonance = player => {
  const amount = Math.max(0, Math.floor(player?.runResonance || 0));
  const before = ensureRelicState(player?.relics);
  const relicId = before.activeRelicId;
  const oldProgress = before.progress?.[relicId] || { level: 0, xp: 0 };
  const award = grantRelicExperience(before, relicId, amount);
  const after = award.relicState;
  return { amount, relicId, before, after, oldProgress, newProgress: after.progress?.[relicId], player: { ...player, runResonance: 0, relics: after } };
};

export const shouldShowRelicResonanceTransfer = transfer => Boolean(transfer && transfer.amount > 0 && (transfer.oldProgress?.level || 0) < 10);
