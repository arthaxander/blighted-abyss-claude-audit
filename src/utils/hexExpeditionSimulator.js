import { createHexCraftingRoute, simulateHexCraftingRun } from './hexCraftingSimulator';
import { HEX_SIMULATION_LOCATIONS } from './hexSimulationScenarios';
import { resolveSimulationPlayerProfile } from './simulationPlayerProfiles';
import { deriveSimulationSeed } from './simulationRng';

export const HEX_SIMULATION_LIMITATIONS = 'Полная зачистка одной ветки. Учитываются проходы, ключи, бои, HP, ловушки, переносимый лут, крафт и алтари по правилам этажа. Рыбалка, автоматическая смена найденной экипировки и эвакуация пока не моделируются. Это оценка выбранной политики, не винрейт игроков.';

// Aggregate only: neither maps nor combat traces accumulate across trials/candidates.
export const simulateHexExpeditions = (options = {}) => {
  const { location = 'goblin', runs = 1, seed = 1, templateId, sublocationSlot = 0,
    classId = 'Archer', profile = 'fresh', combatPolicy = 'competent', bossPolicy = 'boss_aware', craftPolicy = 'moderate', initialCurses = {}, altarPolicy = 'accept', preferredCurseId = null } = options;
  const definition = HEX_SIMULATION_LOCATIONS.find(entry => entry.id === location);
  if (!definition?.combatSupported) throw new Error('Для этой локации ещё нет готовой боевой модели');
  if (!Number.isInteger(runs) || runs < 1 || runs > 1000000) throw new Error('Invalid run count');
  const resolvedProfile = resolveSimulationPlayerProfile({ ...options, classId, profile }).snapshot;
  let completed = 0, deaths = 0, reached = 0, abnormal = 0, survived = 0, consumableUses = 0, movements = 0;
  const templates = {};
  const altars = { planned: 0, visited: 0, accepted: 0, skipped: 0, endingTiers: {} };
  for (let index = 0; index < runs; index++) {
    const runSeed = index === 0 ? seed : deriveSimulationSeed(seed, index);
    const route = createHexCraftingRoute({ location, seed: runSeed, templateId: templateId || undefined, sublocationSlot, initialCurses, altarPolicy, preferredCurseId });
    const result = simulateHexCraftingRun({ route, seed: runSeed, classId, profile, combatPolicy, bossPolicy, craftPolicy, playerOptions: options });
    altars.planned += route.altarBudget.total;
    for (const key of ['visited', 'accepted', 'skipped']) altars[key] += result.altars[key];
    for (const [id, entry] of Object.entries(result.endingCurses)) altars.endingTiers[id] = (altars.endingTiers[id] || 0) + entry.tier;
    templates[route.templateId] = (templates[route.templateId] || 0) + 1;
    movements += route.movementSteps;
    completed += Number(result.outcome === 'victory');
    deaths += Number(result.outcome === 'defeat');
    reached += Number(Boolean(result.beforeBoss));
    abnormal += Number(!['victory', 'defeat'].includes(result.outcome));
    survived += result.combats.filter(combat => combat.outcome === 'victory').length;
    consumableUses += Object.values(result.used).reduce((sum, count) => sum + count, 0);
  }
  return {
    config: { ...options, runs, seed, classId, profile, locationId: location, locationName: definition.name,
      abyssLevel: definition.abyssLevel, initialCurses, altarPolicy, preferredCurseId, routeModel: 'hex', policy: 'full_clear', templateId: templateId || null, sublocationSlot, combatPolicy, bossPolicy },
    limitations: HEX_SIMULATION_LIMITATIONS,
    resolvedProfile,
    altars: { ...altars, averageEndingTiers: Object.fromEntries(Object.entries(altars.endingTiers).map(([id, total]) => [id, total / runs])) },
    maps: { templates, averagePlannedMovementSteps: movements / runs },
    runs: { requested: runs, completed, deaths, abnormal, bossReachRate: reached / runs * 100,
      bossWinRateAmongReached: reached ? completed / reached * 100 : 0, extractionRate: 0 },
    simulatedCombat: { averageCombatsSurvived: survived / runs, consumableUses },
  };
};
