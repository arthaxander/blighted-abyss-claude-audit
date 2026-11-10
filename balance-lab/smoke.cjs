process.env.BABEL_ENV = process.env.BABEL_ENV || 'test';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const path = require('path');
const { Worker } = require('worker_threads');

function invoke(type, payload) {
  return new Promise(function(resolve, reject) {
    const worker = new Worker(path.join(__dirname, 'worker.cjs'), {
      workerData: {
        sourceRoot: path.resolve(__dirname, '..', 'src'),
        type: type,
        payload: payload || {}
      }
    });
    worker.on('message', function(message) {
      if (message && message.kind === 'result') {
        resolve(message.payload);
        worker.terminate();
      } else if (message && message.kind === 'error') {
        reject(new Error(message.error));
        worker.terminate();
      }
    });
    worker.on('error', reject);
  });
}

async function main() {
  const catalog = await invoke('catalog', {});
  if (!catalog.classes || catalog.classes.length < 3) throw new Error('Catalog did not load playable classes.');
  if (!catalog.profiles || catalog.profiles.length < 3) throw new Error('Catalog did not load preset profiles.');

  const result = await invoke('run', {
    classId: 'Archer',
    location: 'goblin',
    profile: 'fresh',
    runs: 2,
    seed: 20260901,
    routePolicy: 'balanced',
    combatPolicy: 'competent',
    bossPolicy: 'boss_aware'
  });
  if (!result.report || result.report.runs.requested !== 2) throw new Error('Simulation smoke run failed.');

  const finder = await invoke('find-builds', {
    classId: 'Archer',
    location: 'goblin',
    profile: 'fresh',
    seed: 20260901,
    screeningRuns: 10,
    finalRuns: 100,
    beamWidth: 3,
    optimizeEquipment: false,
    optimizeAbilities: false,
    optimizePassives: false,
    optimizeTalents: false
  });
  if (!finder.builds || finder.builds.length < 1) throw new Error('Build Finder smoke run failed.');
  if (finder.config.seed === finder.config.validationSeed) throw new Error('Validation reused screening seed.');
  if (finder.builds[0].deltaFromBaseline !== 0) throw new Error('Unchanged build differs from baseline.');
  if (!Number.isFinite(finder.builds[0].consumablesPerRun)) throw new Error('Missing consumable metric.');

  for (const location of catalog.hexLocations) {
    const preview = await invoke('preview', { location: location.id, templateId: location.templates[0].id, seed: 0 });
    if (preview.layout.templateId !== location.templates[0].id) throw new Error('Preview ignored selected map');
  }
  const hex = { routeModel: 'hex', location: 'fungal', templateId: 'fungal-03', sublocationSlot: 2,
    seed: 0, classId: 'Archer', profile: 'fresh', runs: 2, hexCraftPolicy: 'off', initialCurses: { withering: 1 }, altarPolicy: 'accept', preferredCurseId: 'decay' };
  const hexRun = await invoke('run', hex);
  if (hexRun.report.maps.templates['fungal-03'] !== 2) throw new Error('Hex run ignored selected map');
  await require('./renderer-smoke.cjs')(catalog, await invoke('preview', { location: 'restless_ruins', seed: 0 }), hexRun);
  if (hexRun.report.altars.planned !== 2) throw new Error('Floor altar budget missing');
  if (hexRun.report.config.initialCurses.withering !== 1) throw new Error('Starting curses lost');
  const forestRun = await invoke('run', { ...hex, location: 'withering_forest', templateId: 'withering-forest-02', runs: 1 });
  if (forestRun.report.runs.abnormal) throw new Error('Forest combat failed');
  const hexFinder = await invoke('find-builds', { ...hex, screeningRuns: 10, finalRuns: 100, beamWidth: 3,
    optimizeEquipment: false, optimizeAbilities: false, optimizePassives: false, optimizeTalents: false });
  if (hexFinder.config.scenario.preferredCurseId !== 'decay') throw new Error('Finder lost altar preference');
  if (hexFinder.config.scenario.initialCurses.withering !== 1 || hexFinder.config.scenario.altarPolicy !== 'accept') throw new Error('Finder lost altar conditions');
  if (hexFinder.config.scenario.templateId !== 'fungal-03' || hexFinder.builds[0].deltaFromBaseline !== 0)
    throw new Error('Hex finder did not preserve the common scenario');
  for (const location of ['restless_ruins', 'mines_of_decay']) {
    const scenario = catalog.hexLocations.find(entry => entry.id === location);
    if (!scenario?.combatSupported) throw new Error(`Missing combat-enabled location: ${location}`);
    const result = await invoke('run', { ...hex, location,
      templateId: scenario.templates[0].id, runs: 1, seed: 17 });
    if (result.report.runs.requested !== 1 || result.report.runs.abnormal) {
      throw new Error(`New Level-II location combat failed: ${location}`);
    }
  }

  process.stdout.write('Balance Lab smoke checks passed.\n');
}

main().catch(function(error) {
  process.stderr.write(String(error && (error.stack || error.message) || error) + '\n');
  process.exitCode = 1;
});
