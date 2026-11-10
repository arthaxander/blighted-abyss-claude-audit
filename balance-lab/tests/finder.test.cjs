const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the real worker dispatcher and search against a small controlled simulator.
// These tests cover search orchestration; smoke.cjs covers the actual combat engine.
function invoke(payload, { failItem } = {}) {
  const calls = [];
  const messages = [];
  const sourceRoot = path.resolve(__dirname, '../../src');
  const gear = Array.from({ length: 7 }, (_, i) => ({ name: 'bow' + i, type: 'Weapon' }));
  function profile(options) {
    return { snapshot: {
      equipment: options.equipment || { mainHand: 'bow0' },
      activeAbilityIds: options.activeIds || ['shot'],
      passiveIds: options.passiveIds || ['steady'],
      classProgression: options.progression?.Archer || { classLevel: 1, talentSelections: {} }
    } };
  }
  const mocks = {
    'utils/runSimulator.js': { simulateRuns(options) {
      calls.push(options);
      if (options.equipment.mainHand === failItem) throw new Error('Invalid equipment');
      const n = Number(options.equipment.mainHand?.replace('bow', '')) || 0;
      const wins = Math.floor(options.runs * (0.2 + n / 10));
      return { runs: { requested: options.runs, completed: wins, deaths: options.runs - wins,
        bossReachRate: 90, bossWinRateAmongReached: 70 },
        resolvedProfile: profile(options).snapshot,
        simulatedCombat: { consumableUses: options.runs * 2 },
        giantTrace: 'do-not-export-screening-traces'
      };
    } },
    'utils/simulationPlayerProfiles.js': { resolveSimulationPlayerProfile: profile },
    'data/locations.js': { AVAILABLE_LOCATIONS: [] },
    'data/abilityPresets.js': { ABILITY_LIBRARY: { Shot: { artId: 'shot' } } },
    'data/classProgression.js': {
      CLASS_PROGRESSION_DEFINITIONS: { Archer: { skills: [{ id: 'Shot', requiredLevel: 1 }], passiveSkills: [] } },
      ensureClassProgression: () => ({}), getPassiveSlotCount: () => 0
    },
    'data/classTalents.mjs': { CLASS_TALENT_SETS: [] },
    'data/equipment.js': { equipment: gear },
    'data/items.js': { ITEM_DATA: [], getItemDefinition: () => ({}) },
    'utils/equipmentManager.js': { validateClassEquipment: () => ({ canEquip: true }) }
  };
  function mockRequire(name) {
    if (name === 'path') return path;
    if (name === '@babel/core') return {};
    if (name === 'worker_threads') return { workerData: { sourceRoot, type: 'find-builds', payload },
      parentPort: { postMessage: message => messages.push(message) } };
    const key = path.relative(sourceRoot, name).split(path.sep).join('/');
    assert.ok(mocks[key], 'Unexpected dependency ' + name);
    return mocks[key];
  }
  mockRequire.extensions = { '.js': () => {} };
  const context = vm.createContext({ require: mockRequire, process: { env: {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../worker.cjs'), 'utf8'), context);
  const error = messages.find(m => m.kind === 'error');
  if (error) throw new Error(error.error);
  return { result: JSON.parse(JSON.stringify(messages.find(m => m.kind === 'result').payload)), calls, context };
}
const base = { classId: 'Archer', profile: 'fresh', location: 'goblin', seed: 0,
  screeningRuns: 10, finalRuns: 100, beamWidth: 3,
  optimizeAbilities: false, optimizePassives: false, optimizeTalents: false, optimizeEquipment: false };

test('fixed custom build, relic, consumables and zero seed survive screening and validation', () => {
  const { result, calls } = invoke({ ...base,
    customAbilities: true, activeIds: [], customPassives: true, passiveIds: [],
    customEquipment: true, equipment: { mainHand: 'bow2' },
    customRelic: true, relicLevel: 7, customConsumables: true, consumables: [],
    customTalents: true, talentSelections: { shot: 'custom' }
  });
  assert.equal(result.config.seed, 0);
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.equipment.mainHand, 'bow2');
    assert.equal(c.activeIds.length, 0);
    assert.equal(c.passiveIds.length, 0);
    assert.equal(c.consumables.length, 0);
    assert.equal(c.relicLevel, 7);
    assert.equal(c.progression.Archer.talentSelections.shot, 'custom');
  }
  assert.equal(result.builds[0].deltaFromBaseline, 0);
  assert.equal(result.builds[0].consumablesPerRun, 2);
});

test('Top 3 and Top 5 use fresh common validation seeds and retain baseline comparison', () => {
  for (const topCount of [3, 5]) {
    const { result, calls } = invoke({ ...base, optimizeEquipment: true, topCount });
    assert.equal(result.builds.length, topCount);
    assert.equal(result.config.beamWidth, topCount);
    assert.equal(result.builds[0].build.equipment.mainHand, 'bow6');
    assert.equal(result.builds[0].deltaFromBaseline, 60);
    const finalCalls = calls.filter(c => c.runs === 100);
    assert.equal(new Set(finalCalls.map(c => c.seed)).size, 1);
    assert.notEqual(finalCalls[0].seed, 0);
    assert.ok(finalCalls.some(c => c.equipment.mainHand === 'bow0'));
    assert.ok(!JSON.stringify(result).includes('giantTrace'));
    assert.deepEqual(result, invoke({ ...base, optimizeEquipment: true, topCount }).result);
  }
});

test('screening and validation windows do not overlap under the production seed function', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/utils/simulationRng.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.replaceAll('export const ', 'var '), context);
  for (const seed of [0, 1, 0xffffffff]) {
    const { result } = invoke({ ...base, seed, screeningRuns: 500, finalRuns: 20000 });
    const screened = new Set(Array.from({ length: 500 }, (_, i) => context.deriveSimulationSeed(seed, i)));
    for (let i = 0; i < 20000; i++) {
      assert.ok(!screened.has(context.deriveSimulationSeed(result.config.validationSeed, i)));
    }
  }
});

test('screened reports are compact; invalid candidates are counted and sample errors bounded', () => {
  const { result, context } = invoke({ ...base, optimizeEquipment: true }, { failItem: 'bow3' });
  assert.ok(result.diagnostics.rejected > 0);
  assert.ok(result.diagnostics.errorSamples.includes('Invalid equipment'));
  assert.ok(result.diagnostics.errorSamples.length <= 3);
  const row = context.evaluateCandidate(base, { equipment: { mainHand: 'bow1' } }, 10, 0);
  assert.equal(row.report.giantTrace, undefined);
  assert.deepEqual(Object.keys(row.report).sort(), ['resolvedProfile', 'runs', 'simulatedCombat']);
});

test('no valid baseline fails explicitly instead of returning a misleading empty top', () => {
  assert.throws(() => invoke(base, { failItem: 'bow0' }), /Нет допустимых кандидатов/);
});
