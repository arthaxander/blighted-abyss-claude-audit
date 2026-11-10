process.env.BABEL_ENV = process.env.BABEL_ENV || 'test';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const path = require('path');
const babel = require('@babel/core');
const { parentPort, workerData } = require('worker_threads');

const sourceRoot = path.resolve(workerData.sourceRoot) + path.sep;
const defaultJsLoader = require.extensions['.js'];

require.extensions['.js'] = function(module, filename) {
  if (!filename.startsWith(sourceRoot)) return defaultJsLoader(module, filename);
  const transformed = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-react-app')],
    sourceMaps: 'inline'
  });
  module._compile(transformed.code, filename);
};

function fromSrc(relative) {
  return require(path.join(sourceRoot, relative));
}

const runSimulator = fromSrc('utils/runSimulator.js');
const profilesData = fromSrc('utils/simulationPlayerProfiles.js');
const locationsData = fromSrc('data/locations.js');
const abilityData = fromSrc('data/abilityPresets.js');
const progressionData = fromSrc('data/classProgression.js');
const talentData = fromSrc('data/classTalents.mjs');
const equipmentData = fromSrc('data/equipment.js');
const itemData = fromSrc('data/items.js');
const equipmentManager = fromSrc('utils/equipmentManager.js');

const simulateRuns = options => options.routeModel === 'hex'
  ? fromSrc('utils/hexExpeditionSimulator.js').simulateHexExpeditions(options)
  : runSimulator.simulateRuns(options);
const resolveSimulationPlayerProfile = profilesData.resolveSimulationPlayerProfile;
const AVAILABLE_LOCATIONS = locationsData.AVAILABLE_LOCATIONS;
const ABILITY_LIBRARY = abilityData.ABILITY_LIBRARY;
const CLASS_PROGRESSION_DEFINITIONS = progressionData.CLASS_PROGRESSION_DEFINITIONS;
const ensureClassProgression = progressionData.ensureClassProgression;
const getPassiveSlotCount = progressionData.getPassiveSlotCount;
const CLASS_TALENT_SETS = talentData.CLASS_TALENT_SETS;
const equipment = equipmentData.equipment;
const ITEM_DATA = itemData.ITEM_DATA;
const getItemDefinition = itemData.getItemDefinition;
const validateClassEquipment = equipmentManager.validateClassEquipment;

const PROFILE_META = {
  fresh: { label: 'Новичок', description: 'Стартовый персонаж без специально собранного билда.' },
  established: { label: 'Освоившийся', description: 'Уже побегал по Бездне: средняя легальная сборка и базовая прокачка.' },
  prepared: { label: 'Прокачанный', description: 'Сильная контрольная сборка, но не оптимизированная специально под выбранную локацию.' }
};

const LOCATION_LABELS = {
  goblin: 'Гоблинские Норы',
  fungal: 'Грибные Пещеры',
  deserter: 'Лагерь Отступников',
  withering_forest: 'Лес Увядания',
  restless_ruins: 'Руины Неупокоенных',
  mines_of_decay: 'Шахты Тления'
};

const COMBAT_ITEM_TYPES = new Set(['heal', 'effects', 'cleanse', 'cleanseGuard', 'ability', 'tacticalScroll', 'preparedTrap', 'primeNextDirectAttack', 'entanglementScroll']);

const EQUIPMENT_SLOTS = [
  { id: 'helmet', label: 'Голова', types: ['Helmet'] },
  { id: 'armor', label: 'Тело', types: ['Armor'] },
  { id: 'legs', label: 'Ноги', types: ['Legs'] },
  { id: 'mainHand', label: 'Оружие', types: ['Weapon'] },
  { id: 'offHand', label: 'Левая рука', types: ['Shield', 'MagicOffHand'] },
  { id: 'ring1', label: 'Кольцо 1', types: ['Ring'] },
  { id: 'ring2', label: 'Кольцо 2', types: ['Ring'] },
  { id: 'amulet', label: 'Амулет', types: ['Amulet'] },
  { id: 'bag', label: 'Сумка', types: ['Bag'] }
];

function progress(payload) {
  parentPort.postMessage({ kind: 'progress', payload: payload });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(value, total) {
  return total ? value / total * 100 : 0;
}

function round(value, digits) {
  return Number(Number(value || 0).toFixed(digits == null ? 1 : digits));
}

function itemName(value) {
  if (typeof value === 'string') return value;
  return value && (value.itemId || value.name) || '';
}

const stableIdByAbilityName = Object.entries(ABILITY_LIBRARY).reduce(function(out, entry) {
  const name = entry[0];
  const ability = entry[1];
  out[name] = ability && ability.artId || name;
  return out;
}, {});

function classCatalog(classId) {
  const definition = CLASS_PROGRESSION_DEFINITIONS[classId];
  return {
    id: classId,
    label: definition && definition.name || classId,
    abilities: (definition && definition.skills || []).map(function(skill) {
      return {
        id: stableIdByAbilityName[skill.id] || skill.id,
        name: skill.id,
        requiredLevel: skill.requiredLevel,
        starting: Boolean(skill.starting)
      };
    }),
    passives: (definition && definition.passiveSkills || []).map(function(passive) {
      return {
        id: passive.id,
        name: passive.name,
        requiredLevel: passive.requiredLevel,
        description: passive.description
      };
    }),
    talents: CLASS_TALENT_SETS
      .filter(function(set) { return set.classId === classId; })
      .map(function(set) {
        return {
          abilityId: set.abilityId,
          abilityName: set.abilityName,
          requiredLevel: set.requiredLevel,
          talents: set.talents
            .filter(function(talent) { return talent.combatReady; })
            .map(function(talent) {
              return { id: talent.id, name: talent.name, description: talent.description };
            })
        };
      })
      .filter(function(set) { return set.talents.length > 0; })
  };
}

function legalEquipment(classId) {
  return equipment.filter(function(entry) {
    return validateClassEquipment(classId, entry).canEquip;
  });
}

function buildCatalog() {
  const classes = Object.keys(CLASS_PROGRESSION_DEFINITIONS).map(classCatalog);
  const profiles = Object.keys(PROFILE_META).map(function(id) {
    return { id: id, label: PROFILE_META[id].label, description: PROFILE_META[id].description };
  });

  const profileSnapshots = {};
  classes.forEach(function(classEntry) {
    profileSnapshots[classEntry.id] = {};
    profiles.forEach(function(profile) {
      try {
        profileSnapshots[classEntry.id][profile.id] = resolveSimulationPlayerProfile({
          profile: profile.id,
          classId: classEntry.id
        }).snapshot;
      } catch (error) {
        profileSnapshots[classEntry.id][profile.id] = { error: error.message };
      }
    });
  });

  const equipmentByClass = {};
  classes.forEach(function(classEntry) {
    equipmentByClass[classEntry.id] = legalEquipment(classEntry.id).map(function(entry) {
      return {
        name: entry.name,
        type: entry.type,
        rarity: entry.rarity,
        description: entry.description,
        stats: entry.stats || {},
        hands: entry.hands || 1,
        weaponType: entry.weaponType || null
      };
    });
  });

  const consumables = ITEM_DATA.map(function(entry) {
    return { item: entry, definition: getItemDefinition(entry.name) };
  }).filter(function(pair) {
    return COMBAT_ITEM_TYPES.has(pair.definition && pair.definition.type);
  }).map(function(pair) {
    return {
      id: pair.item.name,
      name: pair.item.name,
      description: pair.item.description || pair.definition.description || '',
      type: pair.definition.type
    };
  });

  return {
    hexLocations: fromSrc('utils/hexSimulationScenarios.js').getHexSimulationCatalog(),
    curses: fromSrc('data/curses.js').CURSE_POOL.map(curse => ({ id: curse.id, label: curse.shortName })),
    profiles: profiles,
    classes: classes,
    profileSnapshots: profileSnapshots,
    equipmentByClass: equipmentByClass,
    equipmentSlots: EQUIPMENT_SLOTS,
    consumables: consumables,
    locations: AVAILABLE_LOCATIONS.map(function(location) {
      return {
        id: location.id,
        label: LOCATION_LABELS[location.id] || location.name || location.id,
        name: location.name
      };
    }),
    policies: {
      route: ['balanced', 'cautious', 'combat_priority', 'greedy', 'random'],
      combat: ['competent', 'strategic', 'boss_aware', 'naive', 'random']
    }
  };
}

function normalizeEquipment(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(function(entry) {
    const name = itemName(entry[1]);
    if (name) out[entry[0]] = name;
  });
  return out;
}

function normalizeConsumables(raw) {
  return (raw || []).map(function(entry) {
    return {
      id: entry.id,
      quantity: Math.max(0, Math.floor(Number(entry.quantity) || 0))
    };
  }).filter(function(entry) {
    return entry.id && entry.quantity > 0;
  });
}

function progressionWithTalents(config) {
  const selections = config.talentSelections || {};
  if (!config.customTalents) return undefined;

  const resolved = resolveSimulationPlayerProfile({
    profile: config.profile,
    classId: config.classId,
    relicLevel: config.customRelic ? Number(config.relicLevel) : undefined,
    activeIds: config.customAbilities ? config.activeIds : undefined,
    passiveIds: config.customPassives ? config.passiveIds : undefined,
    equipment: config.customEquipment ? normalizeEquipment(config.equipment) : undefined,
    consumables: config.customConsumables ? normalizeConsumables(config.consumables) : undefined
  });

  const progression = ensureClassProgression();
  progression[config.classId] = Object.assign({}, resolved.snapshot.classProgression, {
    talentSelections: Object.assign({}, selections)
  });
  return progression;
}

function simulationOptions(config) {
  return {
    routeModel: config.routeModel || 'legacy',
    initialCurses: config.initialCurses || {},
    altarPolicy: config.altarPolicy || 'accept',
    preferredCurseId: config.preferredCurseId || null,
    templateId: config.templateId || undefined,
    sublocationSlot: Number(config.sublocationSlot || 0),
    location: config.location || 'goblin',
    runs: clamp(Math.floor(Number(config.runs) || 1000), 1, 1000000),
    seed: config.seed == null ? 1 : Number(config.seed) >>> 0,
    policy: config.routePolicy || 'balanced',
    maxWindows: 200,
    combatMode: 'simulated',
    combatPolicy: config.combatPolicy || 'competent',
    bossPolicy: config.bossPolicy || 'boss_aware',
    balanceVariant: 'production_baseline',
    lootPolicy: config.lootPolicy || 'balanced',
    gearPolicy: config.gearPolicy || 'smart',
    craftPolicy: config.routeModel === 'hex' ? (config.hexCraftPolicy || 'moderate') : (config.craftPolicy || 'balanced'),
    extractionPolicy: config.extractionPolicy || 'off',
    classId: config.classId || 'Archer',
    profile: config.profile || 'fresh',
    relicLevel: config.customRelic ? Number(config.relicLevel) : undefined,
    activeIds: config.customAbilities ? config.activeIds : undefined,
    passiveIds: config.customPassives ? config.passiveIds : undefined,
    consumables: config.customConsumables ? normalizeConsumables(config.consumables) : undefined,
    equipment: config.customEquipment ? normalizeEquipment(config.equipment) : undefined,
    progression: progressionWithTalents(config),
    tuning: 'production_7_14'
  };
}

function summarize(report) {
  const requested = report.runs.requested || report.config.runs;
  const strong = report.simulatedCombat && report.simulatedCombat.strongEncounters;
  return {
    routeWinRate: round(pct(report.runs.completed, requested), 2),
    deaths: report.runs.deaths,
    deathRate: round(pct(report.runs.deaths, requested), 2),
    bossReachRate: round(report.runs.bossReachRate, 2),
    bossConversion: round(report.runs.bossWinRateAmongReached, 2),
    extractionRate: round(report.runs.extractionRate, 2),
    avgCombatsSurvived: round(report.simulatedCombat && report.simulatedCombat.averageCombatsSurvived, 2),
    consumableUses: report.simulatedCombat && report.simulatedCombat.consumableUses || 0,
    strong: strong ? {
      strongFightsMean: round(strong.strongFightsBeforeBoss && strong.strongFightsBeforeBoss.mean, 2),
      noStrongToBossRate: round(strong.reachedBossWithoutStrongPercentage, 2),
      consecutiveStrongRate: round(strong.consecutiveStrongFightRunPercentage, 2),
      ordinaryDeathRate: round(strong.encounterClasses && strong.encounterClasses.ordinary && strong.encounterClasses.ordinary.deathRate, 2),
      strongDeathRate: round(strong.encounterClasses && strong.encounterClasses.strong && strong.encounterClasses.strong.deathRate, 2)
    } : null
  };
}

function markdownForReport(report) {
  const summary = summarize(report);
  const profile = report.resolvedProfile || {};
  const lines = [
    '# Ashen Abyss Balance Lab report',
    '',
    '- Локация: **' + (report.config.locationName || report.config.locationId) + '**',
    '- Класс: **' + report.config.classId + '**',
    '- Профиль: **' + (PROFILE_META[report.config.profile] && PROFILE_META[report.config.profile].label || report.config.profile) + '**',
    '- Прогонов: **' + report.runs.requested + '**',
    '- Seed: ' + report.config.seed,
    '- Политика маршрута / боя / босса: ' + report.config.policy + ' / ' + report.config.combatPolicy + ' / ' + report.config.bossPolicy,
    '',
    '## Итог',
    '',
    '- Победа маршрута: **' + summary.routeWinRate + '%**',
    '- Смерть: **' + summary.deathRate + '%** (' + summary.deaths + ')',
    '- Дошёл до босса: **' + summary.bossReachRate + '%**',
    '- Победа над боссом среди дошедших: **' + summary.bossConversion + '%**',
    '- Среднее число пережитых боёв: **' + summary.avgCombatsSurvived + '**',
    '- Использовано расходников: **' + summary.consumableUses + '**'
  ];

  if (summary.strong) {
    lines.push(
      '',
      '## Strong-встречи',
      '',
      '- Среднее strong-боёв до босса: **' + summary.strong.strongFightsMean + '**',
      '- Маршруты до босса без strong: **' + summary.strong.noStrongToBossRate + '%**',
      '- Два strong подряд: **' + summary.strong.consecutiveStrongRate + '%**',
      '- Смертность обычных / strong боёв: **' + summary.strong.ordinaryDeathRate + '% / ' + summary.strong.strongDeathRate + '%**'
    );
  }

  if (report.altars) lines.push('', '- Этаж: ' + report.config.abyssLevel + '; политика алтарей: ' + report.config.altarPolicy + '; приоритет: ' + (report.config.preferredCurseId || 'повышать уже взятое'), '- Проклятия на входе: ' + JSON.stringify(report.config.initialCurses), '- Алтари (предусмотрено / посещено / принято / пропущено): ' + [report.altars.planned, report.altars.visited, report.altars.accepted, report.altars.skipped].join(' / '));
  if (report.maps) lines.push('', '- Карты: ' + JSON.stringify(report.maps.templates), '- Ветка (1–3): ' + (report.config.sublocationSlot + 1), '', report.limitations);
  lines.push('', '## Сборка', '');
  const gear = Object.entries(profile.equipment || {}).filter(function(entry) { return itemName(entry[1]); });
  if (gear.length) {
    gear.forEach(function(entry) {
      lines.push('- ' + entry[0] + ': ' + itemName(entry[1]));
    });
  } else {
    lines.push('- Экипировка: стартовая/профильная');
  }
  lines.push(
    '- Активные способности: ' + ((profile.activeAbilityIds || []).join(', ') || 'по профилю'),
    '- Пассивки: ' + ((profile.passiveIds || []).join(', ') || 'нет/по профилю'),
    '- Реликвия: ' + (profile.relic && (profile.relic.name || profile.relic.id) || '—') + ' L' + (profile.relic && profile.relic.level || 0),
    '',
    '> Результаты получены синтетической политикой симулятора и не являются измеренным винрейтом живых игроков.'
  );
  return lines.join('\n');
}

function runSimulation(config) {
  progress({ phase: 'run', text: 'Симуляция маршрутов…', current: 0, total: Number(config.runs) || 1000 });
  const report = simulateRuns(simulationOptions(config));
  progress({ phase: 'run', text: 'Готово', current: Number(config.runs) || 1000, total: Number(config.runs) || 1000 });
  return { report: report, summary: summarize(report), markdown: markdownForReport(report) };
}

function combinations(values, count) {
  if (count <= 0) return [[]];
  const out = [];
  function visit(start, chosen) {
    if (chosen.length === count) {
      out.push(chosen.slice());
      return;
    }
    for (let i = start; i <= values.length - (count - chosen.length); i += 1) {
      chosen.push(values[i]);
      visit(i + 1, chosen);
      chosen.pop();
    }
  }
  visit(0, []);
  return out;
}

function talentCombinations(sets) {
  let rows = [{}];
  sets.forEach(function(set) {
    rows = rows.flatMap(function(row) {
      return set.talents.map(function(talent) {
        const next = Object.assign({}, row);
        next[set.abilityId] = talent.id;
        return next;
      });
    });
  });
  return rows.length ? rows : [{}];
}

function wilson(wins, total) {
  if (!total) return { low: 0, high: 0 };
  const z = 1.96;
  const p = wins / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return { low: Math.max(0, center - margin) * 100, high: Math.min(1, center + margin) * 100 };
}

function candidateKey(candidate) {
  return JSON.stringify({
    equipment: candidate.equipment || {},
    activeIds: candidate.activeIds || [],
    passiveIds: candidate.passiveIds || [],
    talentSelections: candidate.talentSelections || {}
  });
}

function evaluateCandidate(baseConfig, candidate, runs, seed) {
  const config = Object.assign({}, baseConfig, {
    runs: runs,
    seed: seed,
    customEquipment: Boolean(candidate.equipment),
    equipment: candidate.equipment,
    customAbilities: Boolean(candidate.activeIds),
    activeIds: candidate.activeIds,
    customPassives: Boolean(candidate.passiveIds),
    passiveIds: candidate.passiveIds,
    customTalents: candidate.talentSelections !== undefined,
    talentSelections: candidate.talentSelections
  });

  try {
    const report = simulateRuns(simulationOptions(config));
    const wins = report.runs.completed;
    return {
      candidate: candidate,
      score: pct(wins, report.runs.requested),
      bossReach: report.runs.bossReachRate,
      bossConversion: report.runs.bossWinRateAmongReached || 0,
      deaths: report.runs.deaths,
      // Keep only ranking inputs. Route traces from every screened candidate
      // otherwise remain alive until the entire stage finishes.
      report: {
        runs: { requested: report.runs.requested, completed: report.runs.completed },
        resolvedProfile: report.resolvedProfile,
        simulatedCombat: { consumableUses: report.simulatedCombat && report.simulatedCombat.consumableUses || 0 }
      }
    };
  } catch (error) {
    return { candidate: candidate, score: -Infinity, error: error.message };
  }
}

function keepBest(rows, limit) {
  const byKey = new Map();
  rows.forEach(function(row) {
    if (!Number.isFinite(row.score)) return;
    const key = candidateKey(row.candidate);
    const previous = byKey.get(key);
    if (!previous || row.score > previous.score) byKey.set(key, row);
  });
  return Array.from(byKey.values()).sort(function(a, b) {
    return b.score - a.score || b.bossReach - a.bossReach || b.bossConversion - a.bossConversion;
  }).slice(0, limit);
}

function presetEquipment(snapshot) {
  const out = {};
  Object.entries(snapshot && snapshot.equipment || {}).forEach(function(entry) {
    const name = itemName(entry[1]);
    if (name) out[entry[0]] = name;
  });
  return out;
}

let finderDiagnostics = null;

function evaluateStage(config, candidates, runs, seed, beamWidth, label) {
  const uniqueMap = new Map();
  candidates.forEach(function(candidate) {
    uniqueMap.set(candidateKey(candidate), candidate);
  });
  const unique = Array.from(uniqueMap.values());
  progress({ phase: 'finder', text: label, current: 0, total: unique.length });
  let best = [];
  unique.forEach(function(candidate, index) {
    if (index % 8 === 0) {
      progress({ phase: 'finder', text: label, current: index, total: unique.length });
    }
    const row = evaluateCandidate(config, candidate, runs, seed);
    finderDiagnostics.evaluations += 1;
    if (row.error) {
      finderDiagnostics.rejected += 1;
      if (finderDiagnostics.errorSamples.length < 3 && !finderDiagnostics.errorSamples.includes(row.error)) {
        finderDiagnostics.errorSamples.push(row.error);
      }
    }
    best = keepBest(best.concat(row), beamWidth);
  });
  if (!best.length) throw new Error('Нет допустимых кандидатов: ' + finderDiagnostics.errorSamples.join('; '));
  return best;
}

function findBuilds(config) {
  finderDiagnostics = { evaluations: 0, rejected: 0, errorSamples: [] };
  const resolved = resolveSimulationPlayerProfile(simulationOptions(config));
  const snapshot = resolved.snapshot;
  const classLevel = snapshot.classProgression && snapshot.classProgression.classLevel || 1;
  const definition = CLASS_PROGRESSION_DEFINITIONS[config.classId];
  const screeningRuns = clamp(Math.floor(Number(config.screeningRuns) || 30), 10, 500);
  const finalRuns = clamp(Math.floor(Number(config.finalRuns) || 500), 100, 20000);
  const topCount = clamp(Math.floor(Number(config.topCount) || 5), 3, 5);
  const beamWidth = clamp(Math.floor(Number(config.beamWidth) || 8), topCount, 30);
  const seed = config.seed == null ? 20260901 : Number(config.seed) >>> 0;
  // deriveRunSeed adds (index + 1) * 0x9e3779b9 before its bijective mix.
  // Advancing the batch base by the screening length gives a disjoint window.
  const validationSeed = (seed + Math.imul(screeningRuns, 0x9e3779b9)) >>> 0;
  const optimizeAbilities = config.optimizeAbilities !== false;
  const optimizePassives = config.optimizePassives !== false;
  const optimizeTalents = config.optimizeTalents !== false;
  const optimizeEquipment = config.optimizeEquipment !== false;

  const baseline = {
    equipment: presetEquipment(snapshot),
    activeIds: snapshot.activeAbilityIds || [],
    passiveIds: snapshot.passiveIds || [],
    talentSelections: snapshot.classProgression && snapshot.classProgression.talentSelections || {}
  };

  let beam = evaluateStage(config, [baseline], screeningRuns, seed, beamWidth, 'Проверка базового профиля');

  if (optimizeAbilities) {
    const eligibleAbilities = (definition.skills || []).filter(function(skill) {
      return skill.requiredLevel <= classLevel;
    }).map(function(skill) {
      return stableIdByAbilityName[skill.id] || skill.id;
    });
    const activeSets = combinations(eligibleAbilities, Math.min(4, eligibleAbilities.length));
    const variants = [];
    beam.forEach(function(row) {
      activeSets.forEach(function(activeIds) {
        variants.push(Object.assign({}, row.candidate, { activeIds: activeIds }));
      });
    });
    beam = evaluateStage(config, variants, screeningRuns, seed, beamWidth, 'Отбор активных способностей');
  }

  if (optimizePassives) {
    const passiveSlotCount = getPassiveSlotCount(config.classId, classLevel);
    const eligiblePassives = (definition.passiveSkills || []).filter(function(passive) {
      return passive.requiredLevel <= classLevel;
    }).map(function(passive) { return passive.id; });
    const passiveSets = [];
    for (let count = 0; count <= Math.min(passiveSlotCount, eligiblePassives.length); count += 1) {
      combinations(eligiblePassives, count).forEach(function(row) { passiveSets.push(row); });
    }
    const variants = [];
    beam.forEach(function(row) {
      passiveSets.forEach(function(passiveIds) {
        variants.push(Object.assign({}, row.candidate, { passiveIds: passiveIds }));
      });
    });
    beam = evaluateStage(config, variants, screeningRuns, seed, beamWidth, 'Отбор пассивов');
  }

  if (optimizeTalents) {
    const readyTalentSets = CLASS_TALENT_SETS.filter(function(set) {
      return set.classId === config.classId &&
        set.requiredLevel <= classLevel &&
        set.talents.some(function(talent) { return talent.combatReady; });
    }).map(function(set) {
      return Object.assign({}, set, {
        talents: set.talents.filter(function(talent) { return talent.combatReady; })
      });
    });

    readyTalentSets.forEach(function(set, setIndex) {
      const variants = [];
      beam.forEach(function(row) {
        const unchanged = Object.assign({}, row.candidate, {
          talentSelections: Object.assign({}, row.candidate.talentSelections || {})
        });
        delete unchanged.talentSelections[set.abilityId];
        variants.push(unchanged);
        set.talents.forEach(function(talent) {
          const selections = Object.assign({}, row.candidate.talentSelections || {});
          selections[set.abilityId] = talent.id;
          variants.push(Object.assign({}, row.candidate, { talentSelections: selections }));
        });
      });
      beam = evaluateStage(
        config,
        variants,
        screeningRuns,
        seed,
        beamWidth,
        'Таланты: ' + set.abilityName + ' (' + (setIndex + 1) + '/' + readyTalentSets.length + ')'
      );
    });
  }

  if (optimizeEquipment) {
    const legal = legalEquipment(config.classId);
    EQUIPMENT_SLOTS.forEach(function(slot, slotIndex) {
      const slotItems = legal.filter(function(entry) {
        return slot.types.indexOf(entry.type) >= 0;
      }).map(function(entry) { return entry.name; });
      if (!slotItems.length) return;

      const variants = [];
      beam.forEach(function(row) {
        variants.push(row.candidate);
        slotItems.forEach(function(name) {
          const nextGear = Object.assign({}, row.candidate.equipment || {});
          nextGear[slot.id] = name;
          variants.push(Object.assign({}, row.candidate, { equipment: nextGear }));
        });
      });
      beam = evaluateStage(
        config,
        variants,
        screeningRuns,
        seed,
        beamWidth,
        'Экипировка: ' + slot.label + ' (' + (slotIndex + 1) + '/' + EQUIPMENT_SLOTS.length + ')'
      );
    });
  }

  const finalists = keepBest(beam, beamWidth);
  if (!finalists.some(row => candidateKey(row.candidate) === candidateKey(baseline))) {
    finalists.push({ candidate: baseline });
  }
  progress({ phase: 'finder', text: 'Перепроверка на новых общих seed', current: 0, total: finalists.length });
  const finalRows = finalists.map(function(row, index) {
    progress({
      phase: 'finder',
      text: 'Перепроверка на новых общих seed',
      current: index,
      total: finalists.length
    });
    const result = evaluateCandidate(config, row.candidate, finalRuns, validationSeed);
    if (result.error) throw new Error('Finder validation failed: ' + result.error);
    return result;
  });

  const baselineRow = finalRows.find(row => candidateKey(row.candidate) === candidateKey(baseline));
  const ranked = keepBest(finalRows, topCount);
  const topScore = ranked.length ? ranked[0].score : 0;
  const resultRows = ranked.map(function(row, index) {
    const requested = row.report.runs.requested;
    const interval = wilson(row.report.runs.completed, requested);
    return {
      rank: index + 1,
      winRate: round(row.score, 2),
      deltaFromTop: round(row.score - topScore, 2),
      deltaFromBaseline: round(row.score - baselineRow.score, 2),
      consumablesPerRun: round(row.report.simulatedCombat.consumableUses / requested, 2),
      bossReachRate: round(row.bossReach, 2),
      bossConversion: round(row.bossConversion, 2),
      deathRate: round(pct(row.deaths, requested), 2),
      confidence95: { low: round(interval.low, 2), high: round(interval.high, 2) },
      build: row.candidate,
      resolvedProfile: row.report.resolvedProfile
    };
  });

  const markdown = [
    '# Ashen Abyss Balance Lab — Top ' + topCount + ' builds',
    '',
    '- Локация: **' + config.location + '**',
    '- Класс: **' + config.classId + '**',
    '- Базовый профиль: **' + (PROFILE_META[config.profile] && PROFILE_META[config.profile].label || config.profile) + '**',
    '- Screening / final: **' + screeningRuns + ' / ' + finalRuns + '** прогонов на кандидата',
    '- Beam width: **' + beamWidth + '**',
    '- Seed отбора / проверки: ' + seed + ' / ' + validationSeed,
    '- Исходная сборка на проверке: ' + round(baselineRow.score, 2) + '%',
    '- Проверок кандидатов / отклонено: ' + finderDiagnostics.evaluations + ' / ' + finderDiagnostics.rejected,
    '- Причины отклонения (до 3): ' + (finderDiagnostics.errorSamples.join('; ') || 'нет'),
    '',
    '> Finder использует ступенчатый beam-search. Это лучшие найденные кандидаты, а не математическая гарантия глобального оптимума.',
    '',
    '| # | Winrate | Δ к #1 | Boss reach | Boss conversion | Death | 95% CI | Δ к исходной | Расходников/поход |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  ];

  resultRows.forEach(function(row) {
    markdown.push(
      '| ' + row.rank +
      ' | ' + row.winRate + '%' +
      ' | ' + row.deltaFromTop + ' п.п.' +
      ' | ' + row.bossReachRate + '%' +
      ' | ' + row.bossConversion + '%' +
      ' | ' + row.deathRate + '%' +
      ' | ' + row.confidence95.low + '–' + row.confidence95.high + '% | ' + row.deltaFromBaseline + ' п.п. | ' + row.consumablesPerRun + ' |'
    );
  });

  resultRows.forEach(function(row) {
    markdown.push('', '## #' + row.rank + ' — ' + row.winRate + '%', '');
    markdown.push('Экипировка: ' + (Object.entries(row.build.equipment || {}).map(function(entry) {
      return entry[0] + ': ' + entry[1];
    }).join('; ') || 'по профилю'));
    markdown.push('', 'Активные: ' + ((row.build.activeIds || []).join(', ') || 'по профилю'));
    markdown.push('', 'Пассивки: ' + ((row.build.passiveIds || []).join(', ') || 'по профилю'));
    markdown.push('', 'Таланты: ' + (Object.values(row.build.talentSelections || {}).join(', ') || 'нет/по профилю'));
  });

  if (config.routeModel === 'hex') markdown.push('', '- Алтари: ' + (config.altarPolicy || 'accept') + '; приоритет: ' + (config.preferredCurseId || 'повышать уже взятое') + '; проклятия на входе: ' + JSON.stringify(config.initialCurses || {}));
  if (config.routeModel === 'hex') markdown.push('', '- Карта: ' + (config.templateId || 'случайная по seed') + '; ветка: ' + (Number(config.sublocationSlot || 0) + 1), fromSrc('utils/hexExpeditionSimulator.js').HEX_SIMULATION_LIMITATIONS);
  markdown.push(
    '',
    '> Финалисты и исходная сборка перепроверены на общей последовательности seed, не использованной при отборе. Разница процентов сама по себе не доказывает превосходство билда. Интервал показывает статистический шум симуляции, а не неопределённость поведения живых игроков.'
  );

  progress({ phase: 'finder', text: 'Готово', current: finalists.length, total: finalists.length });
  return {
    builds: resultRows,
    diagnostics: finderDiagnostics,
    markdown: markdown.join('\n'),
    config: {
      screeningRuns: screeningRuns,
      finalRuns: finalRuns,
      beamWidth: beamWidth,
      seed: seed,
      validationSeed: validationSeed,
      topCount: topCount,
      scenario: simulationOptions(config),
      limitations: config.routeModel === 'hex' ? fromSrc('utils/hexExpeditionSimulator.js').HEX_SIMULATION_LIMITATIONS : null,
      baselineWinRate: round(baselineRow.score, 2),
      searchMode: 'staged_beam',
      optimize: {
        abilities: optimizeAbilities,
        passives: optimizePassives,
        talents: optimizeTalents,
        equipment: optimizeEquipment
      }
    }
  };
}
try {
  let result;
  if (workerData.type === 'catalog') result = buildCatalog();
  else if (workerData.type === 'preview') result = fromSrc('utils/hexSimulationScenarios.js').previewHexSimulation(workerData.payload || {});
  else if (workerData.type === 'run') result = runSimulation(workerData.payload || {});
  else if (workerData.type === 'find-builds') result = findBuilds(workerData.payload || {});
  else throw new Error('Unknown Balance Lab operation: ' + workerData.type);
  parentPort.postMessage({ kind: 'result', payload: result });
} catch (error) {
  parentPort.postMessage({ kind: 'error', error: error && (error.stack || error.message) || String(error) });
}
