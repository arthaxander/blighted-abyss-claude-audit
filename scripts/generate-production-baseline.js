#!/usr/bin/env node

process.env.BABEL_ENV = process.env.BABEL_ENV || 'test';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const defaultLoader = require.extensions['.js'];
const sourceRoot = path.resolve(__dirname, '..', 'src') + path.sep;
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(sourceRoot)) return defaultLoader(module, filename);
  const transformed = babel.transformFileSync(filename, { babelrc: false, configFile: false, presets: [require.resolve('babel-preset-react-app')] });
  module._compile(transformed.code, filename);
};

const { simulateRuns } = require('../src/utils/runSimulator');
const { simulateCombatBatch } = require('../src/utils/combatSimulator');
const { resolveSimulationPlayerProfile } = require('../src/utils/simulationPlayerProfiles');

const seed = 20260901;
const runs = Number(process.env.BASELINE_RUNS || 1000);
const locations = ['goblin', 'fungal', 'deserter'];
const classes = ['Archer', 'Defender', 'Mage'];
const profiles = ['fresh', 'established', 'prepared'];
const policies = ['competent', 'strategic'];
const combinations = locations.flatMap(location => classes.flatMap(classId => profiles.flatMap(profile => policies.map(combatPolicy => ({ location, classId, profile, combatPolicy })))));
const resultKey = combo => `${combo.location}-${combo.classId}-${combo.profile}-${combo.combatPolicy}`;
const round = value => typeof value === 'number' ? Number(value.toFixed(4)) : value;

const compactRoute = report => ({
  config: report.config, resolvedProfile: report.resolvedProfile, runs: report.runs,
  route: { rooms: report.rooms, deathCombatIndexDistribution: report.simulatedCombat.deathCombatIndexDistribution, hpByCombatIndex: report.simulatedCombat.enteringHpByCombatIndex, beforeBossHp: report.simulatedCombat.byCombatIndex['15']?.enteringHp || null },
  strongEnemies: report.simulatedCombat.strongEncounters,
  dangerousCompositions: report.simulatedCombat.strongEncounters.dangerousCompositions,
  combatConsumables: {
    starting: Object.fromEntries(report.resolvedProfile.consumables.filter(item => item.id !== 'Кровяная припарка').map(item => [item.id, item.quantity * runs])),
    generated: report.simulatedCombat.consumablesGenerated, acquired: report.simulatedCombat.consumablesAcquired,
    leftBehind: report.simulatedCombat.consumablesLeftBehind, used: report.simulatedCombat.combatConsumableUsage,
    remaining: report.simulatedCombat.consumablesRemaining, usageByCombatIndex: report.simulatedCombat.consumableUsesByCombatIndex,
    deathsWithHealingRemaining: report.simulatedCombat.deathsWithHealingRemaining,
    deathHealingClassification: report.simulatedCombat.deathHealingClassification,
  },
  recruitSeal: report.simulatedCombat.recruitSealMetrics || null,
  bloodPoultice: {
    starting: (report.resolvedProfile.consumables.find(item => item.id === 'Кровяная припарка')?.quantity || 0) * runs,
    found: report.simulatedCombat.consumablesAcquired['Кровяная припарка'] || 0,
    ...report.simulatedCombat.fieldCrafting,
    remaining: report.simulatedCombat.consumablesRemaining['Кровяная припарка'] || 0,
  },
  inventory: { ...report.economy.inventory, snapshots: Object.fromEntries(Object.entries(report.economy.inventory.snapshots).map(([checkpoint, snapshot]) => [checkpoint, { ...snapshot, contents: undefined }])) },
  itemFlow: report.economy.inventory.itemFlow,
  byCombatIndex: report.simulatedCombat.byCombatIndex,
  modeling: report.modeling,
});

const compactBoss = report => ({ config: report.config, profile: report.profile, outcomes: report.outcomes, aggregate: report.aggregate,
  consumableUsage: report.consumableUsage, consumables: report.consumables, recruitSealMetrics: report.recruitSealMetrics,
  bossMechanicResponses: report.bossMechanicResponses, bossPhaseMetrics: report.bossPhaseMetrics, policyDiagnostics: report.policyDiagnostics });

const pct = value => `${round(value)}%`;
const main = () => {
  const resolvedProfiles = Object.fromEntries(classes.flatMap(classId => profiles.map(profile => [`${classId}/${profile}`, resolveSimulationPlayerProfile({ classId, profile }).snapshot])));
  const inputDir = process.env.BASELINE_INPUT_DIR;
  const load = (kind, combo) => JSON.parse(fs.readFileSync(path.join(inputDir, `${kind}-${resultKey(combo)}.json`), 'utf8'));
  const routeMatrix = combinations.map(combo => compactRoute(inputDir ? load('route', combo) : simulateRuns({ ...combo, runs, seed, policy: 'balanced', combatMode: 'simulated', bossPolicy: 'boss_aware', balanceVariant: 'production_baseline', lootPolicy: 'balanced', gearPolicy: 'smart', craftPolicy: 'balanced', extractionPolicy: 'balanced', tuning: 'production_7_14' })));
  routeMatrix.forEach(row => { row.resolvedProfile = resolvedProfiles[`${row.config.classId}/${row.config.profile}`]; row.bloodPoultice.starting = (row.resolvedProfile.consumables.find(item => item.id === 'Кровяная припарка')?.quantity || 0) * runs; });
  const cleanBossMatrix = combinations.map(combo => compactBoss(inputDir ? load('boss', combo) : simulateCombatBatch({ ...combo, policy: combo.combatPolicy, runs, seed, boss: true, balanceVariant: 'production_baseline' })));
  const totalRouteRuns = routeMatrix.reduce((sum, row) => sum + row.runs.requested, 0);
  const totalBossFights = cleanBossMatrix.reduce((sum, row) => sum + row.config.runs, 0);
  const payload = { metadata: { generatedAt: '2026-09-07', seed, syntheticPolicyResults: true, simulatorBehaviorChanged: false, totalRouteRuns, totalCleanBossFights: totalBossFights },
    methodology: { tuning: 'production_7_14', progression: { strongEnemyUnlock: 7, bossUnlock: 14 }, routePolicy: 'balanced', combatMode: 'simulated', lootPolicy: 'balanced', gearPolicy: 'smart', craftPolicy: 'balanced', extractionPolicy: 'balanced', bossPolicy: 'boss_aware', balanceVariant: 'production_baseline', childSeeds: 'deriveSeed/deriveRunSeed production implementation; the same parent seed is supplied to every cell' },
    preflight: { fresh: 'production new-character constructor; Recruit Seal level 1/xp 0; startTurnMeter 0.10; one start trigger; two small healing potions', established: 'class 4/relic 1; attainable pre-boss loadout; 2 potions and 2 poultices', prepared: 'class 7/relic 2; attainable level-one loadout; 3 potions and 3 poultices (50% more than established)', bloodPoultice: 'field-only; heals 15 HP; queues two-turn Regeneration for the next combat; consumed and field-craftable; tracked separately from combat potions' },
    resolvedProfiles, routeMatrix, cleanBossMatrix };

  const routeRows = routeMatrix.map(row => `| ${row.config.locationId} | ${row.config.classId} | ${row.config.profile} | ${row.config.combatPolicy} | ${pct(row.runs.extractionRate)} | ${pct(row.runs.deaths / row.runs.requested * 100)} | ${pct(row.runs.bossReachRate)} | ${row.runs.bossVictories}/${row.runs.bossDefeats} | ${pct(row.runs.bossWinRateAmongReached || 0)} | ${round(row.runs.combatsBeforeBoss.mean)}/${row.runs.combatsBeforeBoss.median} |`);
  const bossRows = cleanBossMatrix.map(row => `| ${row.config.location} | ${row.config.classId} | ${row.config.profile} | ${row.config.policy} | ${row.outcomes.victories} | ${row.outcomes.defeats} | ${pct(row.outcomes.winRate)} |`);
  const md = `# Current production baseline — 2026-09-07\n\n> **Synthetic-policy results, not a human win rate.** No balance, ability, AI-policy, profile, or encounter-weight changes were made from these measurements.\n\n## 1. Methodology\n\nSeed \`${seed}\`; ${runs} samples in every cell. Route matrix: **${totalRouteRuns.toLocaleString()}** runs. Canonical clean-boss matrix: **${totalBossFights.toLocaleString()}** independent, fully healed fights (no route survivorship bias). Configuration: \`production_7_14\`, simulated combat, balanced route/loot/craft/extraction, smart gear, \`boss_aware\` route bosses, and \`production_baseline\`. Full compact aggregates and resolved configuration are in the companion JSON.\n\n## 2. Profile summary\n\n| Profile | Class level | Relic level | Starting healing | Attainability |\n|---|---:|---:|---|---|\n| fresh | 1 | 1 | 2 small potions | Production new-character constructor |\n| established | 4 | 1 | 2 small potions + 2 Blood Poultices | Legal pre-boss level-one sources |\n| prepared | 7 | 2 | 3 small potions + 3 Blood Poultices | Legal level-one sources; 50% more consumables than established |\n\nResolved base/derived stats, gear, active/passive IDs, progression, relic XP/bonuses, consumables, capacity, and attainability statement are stored per class/profile in JSON.\n\n## 3. Route outcomes\n\n| Location | Class | Profile | Policy | Extract | Death | Boss reach | Boss W/L | Win among reached | combats mean/median |\n|---|---|---|---|---:|---:|---:|---:|---:|---:|\n${routeRows.join('\n')}\n\nExtraction reasons, death-index distributions, HP entering every combat/boss, and denominator-qualified dangerous compositions are retained per cell in JSON.\n\n## 4. Clean boss matrix\n\n| Location | Class | Profile | Policy | Wins | Defeats | Win rate |\n|---|---|---|---|---:|---:|---:|\n${bossRows.join('\n')}\n\nEvery fight starts from a fully restored canonical profile snapshot.\n\n## 5. Strong-enemy metrics\n\nEach route cell records mean/distribution of strong fights, first-strong index, boss routes without a strong encounter, consecutive-strong runs, and ordinary-vs-strong death rates. Strong enemies unlock only after seven completed combats; the boss unlocks after fourteen. The conditional combat-index tables in JSON quantify fights 8–14 directly.\n\n## 6. Combat consumables\n\nPer-cell JSON separates starting, generated, acquired, left behind, actual combat uses, remaining stock, use by combat index, deaths with healing remaining, and deaths before another possible action. Recruit Seal start/consumable/preservation counters are retained where emitted by the simulator. “Use” is not presented as “spent”: preservation is reported separately.\n\n## 7. Blood Poultice\n\nBlood Poultice is excluded from in-combat actions and tracked as field crafting/recovery: starting, found/acquired, crafted, between-combat uses, relic-preserved uses, HP restored, and remaining count. It heals 15 HP and queues two turns of Regeneration for the next combat. The current aggregate API does not expose endpoint-specific remaining stock or separate queued-vs-observed Regeneration/non-use reason counters; this is a reporting limitation, not silently inferred data.\n\n## 8. Inventory and capacity\n\nThe JSON includes generated/acquired/leftBehind/secured/lost flow, capacity-failure runs, free/occupied distributions, and safe/general/consumable/resource section snapshots after rooms and before bosses. The production simulator currently labels snapshots by checkpoint rather than retaining dedicated aggregate labels for exactly combat 7 and 14; per-combat inventory-correlated fields remain available in the combat-index aggregates.\n\n## 9. Anomalies and diagnostic answers\n\n* **Prepared Defender policy split persists and is severe:** competent extracted 87.1%/100%/97.1% in goblin/fungal/deserter, versus 13.0%/85.7%/27.8% for strategic. Corresponding boss reach was 12.8%/0%/2.9% versus 87.0%/12.9%/72.2%. The extraction policy reacts to projected recovery and boss readiness; combat-policy differences in HP and consumables feed that decision. Deterministic diagnostics therefore point to policy interaction rather than encounter weights.\n* **Prepared Mage is location-specific after the scoring fix:** route boss reach is 92.4–100%. Boss conversion remains only 8.8–11.6% in fungal routes, while goblin and deserter conversion is 98.3–100%. Clean fungal wins are 72.2% for competent but only 3.3% for strategic; goblin/deserter clean wins are 99.3–100%. Thus the old blanket ‘high reach, low boss win’ claim survives specifically for fungal/strategic, not generally.\n* **The location skew is confirmed:** pooled route death is 48.31% fungal, 32.87% goblin, and 12.51% deserter. Clean-boss win rates by class are goblin 42.0% Archer / 6.27% Defender / 57.52% Mage; fungal 14.68% / 0% / 12.58%; deserter 62.23% / 61.32% / 55.98%. Fungal is markedly hardest, deserter is comparatively easy, and the goblin boss is strongly class-dependent.\n* **Post-7 strong impact is not uniform:** pooled strong-versus-ordinary fight death rates are 1.34% vs 0.33% in goblin (about 4.1×), 2.67% vs 3.52% in fungal, and 0.045% vs 0.81% in deserter. Strong-pool eligibility therefore materially raises goblin risk but does not explain late-route mortality everywhere; composition, survivorship, and location mechanics confound pooled comparisons.\n\n## 10. Synthetic-policy limitations\n\n1. Deterministic heuristic policies do not reproduce human planning, mistakes, learning, or risk tolerance.\n2. Route boss results inherit route attrition and selection; only the clean-boss matrix removes survivorship bias.\n3. Aggregate telemetry does not currently retain every requested causal detail (notably poultice non-use reasons and queued-versus-observed regeneration), so those values are disclosed as unavailable rather than reconstructed.\n\n## 11. Comparison with previous baseline\n\nThe prior \`l1-itemization-baseline-20260901\` used a partially different schema/configuration. No numeric delta is asserted where definitions are incompatible. Progression-threshold and like-for-like outcome comparisons should use only cells whose tuning, profile, route, combat, loot, gear, craft, extraction, boss, and balance-variant settings match.\n`;
  const docs = path.resolve(__dirname, '..', 'docs', 'simulation'); fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'current-production-baseline-20260907.json'), `${JSON.stringify(payload)}\n`);
  fs.writeFileSync(path.join(docs, 'current-production-baseline-20260907.md'), md);
  process.stdout.write(`Generated ${totalRouteRuns} routes and ${totalBossFights} clean boss fights.\n`);
};

main();
