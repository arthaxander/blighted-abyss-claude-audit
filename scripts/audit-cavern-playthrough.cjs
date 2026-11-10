require('./register-expedition.cjs');
const fs = require('node:fs');
const { createHexCraftingRoute } = require('../src/utils/hexCraftingSimulator');
const { createExpeditionMapRun, getExpeditionKeyDropChance } = require('../src/utils/expeditionMapRun');
const { createSeededSimulationRng } = require('../src/utils/simulationRng');
const runtime = require('../src/utils/expeditionMapRun');
const resolveCell = runtime.resolveCurrentExpeditionCell;
let resolvedRun;
// Observe the actual final saved run without changing traversal or game code.
runtime.resolveCurrentExpeditionCell = (...args) => {
  resolvedRun = resolveCell(...args);
  return resolvedRun;
};
const cases = [];
for (const templateId of ['goblin-02', 'goblin-caverns-02']) for (const slot of [0, 1, 2]) {
  const run = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId, rng: createSeededSimulationRng(42) });
  const trip = createHexCraftingRoute({ location: 'goblin', seed: 42, templateId, sublocationSlot: slot, altarPolicy: 'skip' });
  const cells = run.mainLayout.cells.filter(c => c.walkable !== false && (c.region !== 'sublocation' || c.sublocationId === trip.selectedSublocationId));
  const phases = ['approach', 'sublocation', 'depth', 'boss'].map(phase => {
    const events = trip.route.filter(c => c.phase === phase);
    const authored = cells.filter(c => c.region === phase);
    const directFights = authored.filter(c => ['COMBAT', 'CURSED_ENEMY'].includes(c.previewRoomType)).length;
    const chances = Array.from({ length: directFights }, (_, i) => getExpeditionKeyDropChance(i + 1, directFights));
    return { phase, walkable: authored.length, events: authored.filter(c => c.significant).length,
      resolvedEvents: events.length, battlesIncludingSecrets: events.filter(c => c.enemies.length).length,
      directFights, keyFirstEligible: chances.findIndex(c => c > 0) + 1, keyGuaranteed: chances.findIndex(c => c === 1) + 1,
      directRewards: authored.filter(c => ['RESOURCE', 'TREASURE'].includes(c.previewRoomType)).length,
      resolvedTypes: events.reduce((out, c) => { out[c.roomType] = (out[c.roomType] || 0) + 1; return out; }, {}),
    };
  });
  const result = { templateId, slot, selected: trip.selectedSublocationId, walkable: cells.length,
    movementSteps: trip.movementSteps, events: trip.route.length, battles: trip.route.filter(c => c.enemies.length).length,
    finalMapBytes: Buffer.byteLength(JSON.stringify(resolvedRun)), phases };
  cases.push(result);
  console.log(JSON.stringify(result));
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ seed: 42, mode: 'full-clear, not mandatory route or victory simulation', cases }, null, 2) + '\n');
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(resolvedRun));
