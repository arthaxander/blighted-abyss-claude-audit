import { compactExpeditionMapForSave } from './expeditionMapSnapshot';
import { createExpeditionMapRun, moveExpeditionRun, resolveCurrentExpeditionCell, cancelPendingExpeditionCell, setPendingExpeditionCellContent } from './expeditionMapRun';
import { buildPlayerSnapshot } from './playerState';

test('save compaction preserves current and cancelled encounters and all map progress', () => {
  const map = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'goblin-caverns-02' });
  const events = map.mainLayout.cells.filter(c => c.significant).slice(0, 3);
  const [cleared, pending, cancelled] = events;
  map.pendingCellId = pending.id;
  const payload = { enemies: [{ name: 'Already rolled enemy' }], loot: [{ name: 'Already rolled loot' }] };
  map.mainLayout.cells = map.mainLayout.cells.map(c => events.includes(c)
    ? { ...c, content: payload, resolved: c.id !== cancelled.id } : c);
  const save = buildPlayerSnapshot({ class: 'Defender', expeditionMap: map });
  const result = save.expeditionMap;
  expect(result.mainLayout.cells.find(c => c.id === cleared.id).content).toBeNull();
  expect(result.mainLayout.cells.find(c => c.id === pending.id).content).toBe(payload);
  expect(result.mainLayout.cells.find(c => c.id === cancelled.id).content).toBe(payload);
  expect(result.state).toBe(map.state);
  expect(result.mainLayout.edges).toBe(map.mainLayout.edges);
  expect(result.mainLayout.currentCellId).toBe(map.mainLayout.currentCellId);
  expect(map.mainLayout.cells.find(c => c.id === cleared.id).content).toBe(payload);
  expect(compactExpeditionMapForSave(result)).toBe(result);
});

test('resolving clears history while cancelling retains the rolled encounter', () => {
  let run = createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: 'goblin-caverns-02' });
  const edge = run.mainLayout.edges.find(e => e.from === run.mainLayout.currentCellId || e.to === run.mainLayout.currentCellId);
  const target = edge.from === run.mainLayout.currentCellId ? edge.to : edge.from;
  run.mainLayout.cells = run.mainLayout.cells.map(c => c.id === target ? { ...c, significant: true, resolved: false, previewRoomType: 'COMBAT' } : c);
  const moved = moveExpeditionRun(run, target);
  expect(moved.moved).toBe(true);
  const payload = { roomType: 'COMBAT', enemies: [{ name: 'Fixed enemy' }] };
  const entered = setPendingExpeditionCellContent(moved.run, payload);
  const cancelled = cancelPendingExpeditionCell(entered);
  expect(compactExpeditionMapForSave(cancelled).mainLayout.cells.find(c => c.id === target).content).toBe(payload);
  const resolved = resolveCurrentExpeditionCell(entered);
  expect(resolved.mainLayout.cells.find(c => c.id === target)).toMatchObject({ resolved: true, content: null });
  expect(resolved.pendingCellId).toBeNull();
});
