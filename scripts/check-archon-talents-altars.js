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
  const transformed = babel.transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-react-app')],
    sourceMaps: 'inline',
  });
  module._compile(transformed.code, filename);
};



const assert = require('assert');
const { simulateCombat } = require('../src/utils/combatSimulator');
const { resolveSimulationPlayerProfile, snapshotSimulationPlayer } = require('../src/utils/simulationPlayerProfiles');
const { deriveSimulationSeed } = require('../src/utils/simulationRng');
const { selectClassTalent } = require('../src/data/classProgression');
const { resolveCurseOffering } = require('../src/data/curses');
const { enemies } = require('../src/data/enemies');
const { loadouts } = require('../docs/simulation/equipment-tier-tempo-20261014.json');
const boss = enemies.find(e => e.name === 'Архонт Цветения');
assert.equal(boss.maxHp, 2250);
const builds = {
  Defender: { activeIds: ['endurance','blood_ram','ram','shield_throw'], talents: {
    'defender.fortitude': 'defender.fortitude.unbroken_will',
    'defender.wounding_strike': 'defender.wounding_strike.open_wounds',
  } },
  Archer: { activeIds: ['serrated_arrow','fire_arrow','redirect','quick_intercept'], talents: {
    'archer.barbed_arrow': 'archer.barbed_arrow.designate_prey',
    'archer.fire_arrow': 'archer.fire_arrow.tar_arrow',
  } },
};
const scenarios = [
  { id: 'control', talents: false, offerings: [] },
  { id: 'talents', talents: true, offerings: [] },
  ...['corruption','distortion','withering','undeath','decay'].map(id => ({ id: `${id}_II`, talents: true, offerings: [[id,1],[id,2]] })),
  { id: 'corruption_II_distortion_I', talents: true, offerings: [['corruption',1],['corruption',2],['distortion',2]] },
];
const consumables = [{ id:'Зелье здоровья', quantity:3 }, { id:'Малое зелье очищения', quantity:3 }];
const results = [], snapshots = {};
for (const [classId, build] of Object.entries(builds)) {
  for (const scenario of scenarios) {
    const player = resolveSimulationPlayerProfile({ classId, profile:'prepared', equipment:loadouts[classId].floor2, relicLevel:1, activeIds:build.activeIds, consumables }).player;
    assert.equal(player.classProgression[classId].classLevel, 9);
    if (scenario.talents) {
      for (const [abilityId, talentId] of Object.entries(build.talents)) {
        const selection = selectClassTalent(player.classProgression, classId, abilityId, talentId, { location:'guild' });
        assert(selection.success, `${talentId}: ${selection.reason}`);
        player.classProgression = selection.progression;
      }
    }
    player.curses = {};
    for (const [curseId, abyssLevel] of scenario.offerings) {
      const offering = resolveCurseOffering(player.curses, curseId, null, { abyssLevel });
      assert(offering.accepted, `${curseId}: ${offering.blockedReason}`);
      player.curses = offering.nextState;
    }
    player.abyssLevel = 2;
    player.currentLocation = 'Лес Увядания';
    const selections = player.classProgression[classId].talentSelections;
    snapshots[`${classId}/${scenario.id}`] = { ...snapshotSimulationPlayer(player), talents:selections, curses:player.curses };
    for (let i = 0; i < 20; i++) {
      const seed = deriveSimulationSeed(20261015, i);
      const r = simulateCombat({ player, enemies:[boss], seed, policy:'competent' });
      assert(!r.abnormal, `${classId}/${scenario.id}/${seed}`);
      assert.deepEqual(r.player.classProgression[classId].talentSelections, selections, 'Talents must survive combat hydration');
      for (const [id, curse] of Object.entries(player.curses)) assert.equal(r.player.curses[id].tier, curse.tier);
      results.push({ classId, scenario:scenario.id, seed, outcome:r.outcome, bossHp:boss.hp-r.playerDamageDealt, playerTurns:r.playerTurns, enemyTurns:r.enemyTurns, hp:r.endingPlayerHpPercentage, abilityUsage:r.abilityUsage, consumableUsage:r.consumableUsage });
    }
    process.stderr.write(`${classId}/${scenario.id} done\n`);
  }
}
const report = { baseCommit:'cb3d2513a9034b7dd9a960b57eca8b44c45fd3b8', builds, scenarios, consumables, snapshots, results, limits:[
  'L9 remains a fixed assumption, not a measured arrival-level distribution. Full health and complete floor-II gear are favorable entry assumptions.',
  'Talents selected with the production guild API; offerings accepted with floor-specific production caps; verified retained in combat.',
  'Offering sequences are legal conditional preparations, not guaranteed generated routes or measured altar probabilities.',
  'One selected talent pair per class, not an exhaustive optimal-build search. Relic I, same passives as prior screen.',
  'No dedicated Archon policy, unchanged generic competent behavior. No gameplay changes, Mage or legends.',
] };
const output = JSON.stringify(report)+'\n';
fs.writeFileSync('docs/simulation/archon-talents-altars-20261015.json', output);
fs.writeFileSync('docs/simulation/archon-talents-altars-20261015.json.gz', require('zlib').gzipSync(output));
console.log(`Saved ${results.length} fights`);
