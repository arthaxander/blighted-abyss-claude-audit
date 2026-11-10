import {
  applyPendingExpeditionKeyRoll,
  cancelPendingExpeditionCell,
  createExpeditionMapRun,
  dismissExpeditionKeyNotice,
  getExpeditionKeyDropChance,
  previewPendingExpeditionKeyRoll,
  reconcileExpeditionKeyGuarantees,
  getActiveExpeditionLayout,
  isExpeditionMapFeatureEnabled,
  moveExpeditionRun,
  resolveCurrentExpeditionCell,
  setExpeditionMapRuntimeEnabled,
  setPendingExpeditionCellContent,
} from './expeditionMapRun';
import { applyMapProgressLocks, getAdjacentCellIds } from './expeditionMapLayout';
import { ROOM_TYPES } from './roomGeneration';

const SUBLOCATIONS = ['a', 'b', 'c', 'd'];

const createRun = () => createExpeditionMapRun({
  locationId: 'test',
  sublocations: SUBLOCATIONS,
  rng: () => 0.42,
});

const resolvePending = run => run.pendingCellId
  ? resolveCurrentExpeditionCell(
      setPendingExpeditionCellContent(run, {
        id: 'content-' + run.pendingCellId,
        type: 'Ресурсы',
      })
    )
  : run;

const findPath = (layout, targetId) => {
  const queue = [[layout.currentCellId]];
  const seen = new Set([layout.currentCellId]);
  while (queue.length) {
    const path = queue.shift();
    const tail = path[path.length - 1];
    if (tail === targetId) return path.slice(1);
    getAdjacentCellIds(layout, tail).forEach(id => {
      const target = layout.cells.find(cell => cell.id === id);
      if (!seen.has(id) && !target?.locked) {
        seen.add(id);
        queue.push([...path, id]);
      }
    });
  }
  return [];
};

const travel = (initial, targetId) => {
  let run = resolvePending(initial);
  let safety = 0;
  while (getActiveExpeditionLayout(run).currentCellId !== targetId && safety < 300) {
    const path = findPath(applyMapProgressLocks(getActiveExpeditionLayout(run), run.state), targetId);
    if (!path.length) break;
    run = moveExpeditionRun(run, path[0], { rng: () => 0.42 }).run;
    run = resolvePending(run);
    safety += 1;
  }
  return run;
};

describe('persisted expedition map v2 run', () => {
  afterEach(() => {
    delete process.env.REACT_APP_EXPEDITION_MAP_V1;
    setExpeditionMapRuntimeEnabled(true);
  });

  test('feature flag defaults on and explicit opt-out still works', () => {
    delete process.env.REACT_APP_EXPEDITION_MAP_V1;
    expect(isExpeditionMapFeatureEnabled()).toBe(true);
    // An old build-time value must not override the default-on behavior.
    process.env.REACT_APP_EXPEDITION_MAP_V1 = 'false';
    expect(isExpeditionMapFeatureEnabled()).toBe(true);
    process.env.REACT_APP_EXPEDITION_MAP_V1 = 'true';
    expect(isExpeditionMapFeatureEnabled()).toBe(true);
  });

  test('runtime DEV toggle can return to the legacy route selector', () => {
    delete process.env.REACT_APP_EXPEDITION_MAP_V1;
    setExpeditionMapRuntimeEnabled(true);
    expect(isExpeditionMapFeatureEnabled()).toBe(true);
    setExpeditionMapRuntimeEnabled(false);
    expect(isExpeditionMapFeatureEnabled()).toBe(false);
  });

  test('a new run starts on one unified 120-hex physical board', () => {
    const run = createRun();
    expect(run.state.version).toBe(2);
    expect(run.mainLayout.topology).toBe('hex-board-v2');
    expect(run.mainLayout.cells.length).toBeGreaterThan(120);
    expect(run.sublocationLayouts).toEqual({});
    expect(run.activeSpace).toBe('main');
    expect(run.pendingCellId).toBeNull();

    run.state.availableSublocationIds.forEach(id => {
      expect(run.mainLayout.cells.some(cell =>
        cell.region === 'sublocation' && cell.sublocationId === id
      )).toBe(true);
    });
  });

  test('the active route contains 44 meaningful cells while all three sublocations exist', () => {
    const run = createRun();
    const chosen = run.state.availableSublocationIds[0];
    const approach = run.mainLayout.cells.filter(cell =>
      cell.region === 'approach' && cell.significant
    ).length;
    const sublocation = run.mainLayout.cells.filter(cell =>
      cell.region === 'sublocation'
      && cell.sublocationId === chosen
      && cell.significant
    ).length;
    const depth = run.mainLayout.cells.filter(cell =>
      cell.region === 'depth' && cell.significant
    ).length;
    const boss = run.mainLayout.cells.filter(cell =>
      cell.region === 'boss' && cell.significant
    ).length;
    expect(approach + sublocation + depth + boss).toBe(44);
  });

  test('key pity starts halfway through zone fights and guarantees before the last fight', () => {
    expect(getExpeditionKeyDropChance(3, 8)).toBe(0);
    expect(getExpeditionKeyDropChance(4, 8)).toBeGreaterThan(0);
    expect(getExpeditionKeyDropChance(7, 8)).toBe(1);
    expect(getExpeditionKeyDropChance(2, 3)).toBe(1);
  });

  test('combat key roll can be surfaced in loot and applied only after victory resolution', () => {
    let run = createRun();
    const combatCells = run.mainLayout.cells.filter(cell =>
      cell.region === 'approach'
      && [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY].includes(cell.previewRoomType)
    );
    const totalBattles = combatCells.length;
    let guaranteeBattle = 1;
    while (
      guaranteeBattle < totalBattles
      && getExpeditionKeyDropChance(guaranteeBattle, totalBattles) < 1
    ) {
      guaranteeBattle += 1;
    }

    const target = combatCells[0];
    expect(target).toBeTruthy();
    run = {
      ...run,
      pendingCellId: target.id,
      state: {
        ...run.state,
        keyProgress: {
          ...run.state.keyProgress,
          approach: Math.max(0, guaranteeBattle - 1),
        },
      },
    };

    const roll = previewPendingExpeditionKeyRoll(run, { rng: () => 0.999 });
    expect(roll).toMatchObject({
      keyType: 'sublocation',
      sourceCellId: target.id,
      battleNumber: guaranteeBattle,
      dropped: true,
    });

    run = applyPendingExpeditionKeyRoll(run, roll);
    expect(run.state.keys.sublocation.owned).toBe(true);
    expect(run.state.keyProgress.approach).toBe(guaranteeBattle);

    run = resolveCurrentExpeditionCell(run, { rng: () => 0.999 });
    expect(run.state.keys.sublocation.owned).toBe(true);
    expect(run.pendingCellId).toBeNull();
  });
  test('resolved fights repair a missed guaranteed key drop', () => {
    let run = createRun();
    const combatCells = run.mainLayout.cells.filter(cell =>
      cell.region === 'approach'
      && [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY].includes(cell.previewRoomType)
    );
    const guaranteeBattle = combatCells.findIndex((_, index) =>
      getExpeditionKeyDropChance(index + 1, combatCells.length) >= 1
    ) + 1;
    expect(guaranteeBattle).toBeGreaterThan(0);

    const completedIds = new Set(
      combatCells.slice(0, guaranteeBattle).map(cell => cell.id)
    );
    run = {
      ...run,
      state: {
        ...run.state,
        keys: {
          ...run.state.keys,
          sublocation: {
            ...run.state.keys.sublocation,
            owned: false,
            consumed: false,
          },
        },
        keyProgress: {
          ...run.state.keyProgress,
          approach: 0,
        },
      },
      mainLayout: {
        ...run.mainLayout,
        cells: run.mainLayout.cells.map(cell =>
          completedIds.has(cell.id) ? { ...cell, resolved: true } : cell
        ),
      },
    };

    run = reconcileExpeditionKeyGuarantees(run);
    expect(run.state.keys.sublocation.owned).toBe(true);
    expect(run.state.keyProgress.approach).toBeGreaterThanOrEqual(guaranteeBattle);
    expect(run.keyNotice).toMatchObject({ keyType: 'sublocation' });
  });

  test('key notice persists until explicitly dismissed', () => {
    const run = {
      ...createRun(),
      keyNotice: {
        keyType: 'sublocation',
        sourceCellId: 'fight-1',
        acquiredAtBattle: 4,
      },
    };
    const dismissed = dismissExpeditionKeyNotice(run);
    expect(dismissed.keyNotice).toBeNull();
    expect(dismissed.state).toBe(run.state);
  });

  test('all meaningful content is pre-rolled while unrevealed cells stay hidden', () => {
    const run = createRun();
    const meaningful = run.mainLayout.cells.filter(cell => cell.significant);
    expect(meaningful.every(cell => cell.previewRoomType)).toBe(true);
    expect(run.mainLayout.cells.some(cell => !cell.revealed && cell.previewRoomType)).toBe(true);
  });

  test('revealed meaningful cells expose stable pre-rolled content types', () => {
    let run = createRun();
    const initialVisible = run.mainLayout.cells.filter(cell =>
      cell.revealed && cell.significant
    );
    expect(initialVisible.every(cell =>
      Object.values(ROOM_TYPES).includes(cell.previewRoomType)
    )).toBe(true);

    const remembered = new Map(
      initialVisible.map(cell => [cell.id, cell.previewRoomType])
    );
    const next = getAdjacentCellIds(run.mainLayout, run.mainLayout.currentCellId)
      .find(id => !run.mainLayout.cells.find(cell => cell.id === id)?.locked);
    run = moveExpeditionRun(run, next, { rng: () => 0.999 }).run;
    run = resolvePending(run);

    remembered.forEach((roomType, id) => {
      expect(run.mainLayout.cells.find(cell => cell.id === id)?.previewRoomType)
        .toBe(roomType);
    });
  });

  test('movement, reveal and resolved state survive serialization', () => {
    let run = createRun();
    const next = getAdjacentCellIds(run.mainLayout, run.mainLayout.currentCellId)
      .find(id => !run.mainLayout.cells.find(cell => cell.id === id)?.locked);
    run = moveExpeditionRun(run, next).run;
    run = resolvePending(run);

    const restored = JSON.parse(JSON.stringify(run));
    expect(restored.mainLayout.currentCellId).toBe(next);
    expect(restored.mainLayout.cells.find(cell => cell.id === next).visited).toBe(true);
  });

  test('entering any one of the three entrances commits the run and locks the other two regions', () => {
    let run = createRun();
    const [chosen, second, third] = run.state.availableSublocationIds;
    const entrance = run.mainLayout.sublocationEntranceCellIds[chosen];
    run.state.keys.sublocation.owned = true;
    run = travel(run, entrance);

    expect(run.state.selectedSublocationId).toBe(chosen);
    expect(run.state.sublocationAccess.remaining).toBe(0);

    [second, third].forEach(id => {
      const cells = run.mainLayout.cells.filter(cell =>
        cell.region === 'sublocation' && cell.sublocationId === id
      );
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.every(cell => cell.locked)).toBe(true);
    });

    expect(run.mainLayout.cells.filter(cell =>
      cell.region === 'sublocation' && cell.sublocationId === chosen
    ).every(cell => !cell.locked)).toBe(true);
  });

  test('selected sublocation supports backtracking and free re-entry through the same entrance', () => {
    let run = createRun();
    run.state.keys.sublocation.owned = true;
    const chosen = run.state.availableSublocationIds[0];
    const entrance = run.mainLayout.sublocationEntranceCellIds[chosen];
    run = travel(run, entrance);

    const parent = getAdjacentCellIds(run.mainLayout, entrance)
      .find(id => run.mainLayout.cells.find(cell => cell.id === id)?.region === 'approach');
    run = travel(run, parent);
    run = travel(run, entrance);

    expect(run.state.selectedSublocationId).toBe(chosen);
    expect(run.mainLayout.currentCellId).toBe(entrance);
  });

  test('every sublocation has a working two-way bridge to Depth after spending its key', () => {
    createRun().state.availableSublocationIds.forEach(chosen => {
      let run = createRun();
      run.state.keys.sublocation.owned = true;
      run = travel(run, run.mainLayout.sublocationEntranceCellIds[chosen]);
      expect(run.state.selectedSublocationId).toBe(chosen);

      const exit = run.mainLayout.sublocationExitCellIds[chosen];
      run = travel(run, exit);
      expect(run.mainLayout.currentCellId).toBe(exit);
      expect(run.state.progress.depthUnlocked).toBe(false);
      run.state.keys.depth.owned = true;

      const depthEntry = run.mainLayout.depthEntryCellIds[chosen];
      run = travel(run, depthEntry);
      expect(run.mainLayout.currentCellId).toBe(depthEntry);
      expect(run.state.progress.depthUnlocked).toBe(true);

      const back = moveExpeditionRun(run, exit, { rng: () => 0.42 });
      expect(back.moved).toBe(true);
      run = resolvePending(back.run);
      expect(run.mainLayout.currentCellId).toBe(exit);
      expect(run.state.selectedSublocationId).toBe(chosen);
    });
  });

  test('sublocation, Depth and boss gates consume their keys and then allow backtracking', () => {
    let run = createRun();
    const chosen = run.state.availableSublocationIds[0];
    run.state.keys.sublocation.owned = true;
    run = travel(run, run.mainLayout.sublocationEntranceCellIds[chosen]);
    expect(run.state.selectedSublocationId).toBe(chosen);

    run.state.keys.depth.owned = true;
    const exit = run.mainLayout.sublocationExitCellIds[chosen];
    run = travel(run, exit);
    const depthEntry = run.mainLayout.depthEntryCellIds[chosen];
    run = travel(run, depthEntry);
    expect(run.state.progress.depthUnlocked).toBe(true);
    expect(run.state.keys.depth.consumed).toBe(true);

    run = travel(run, exit);
    expect(run.mainLayout.currentCellId).toBe(exit);
    run = travel(run, depthEntry);

    run.state.keys.boss.owned = true;
    run = travel(run, run.mainLayout.bossCellId);
    expect(run.state.progress.bossUnlocked).toBe(true);
    expect(run.state.keys.boss.consumed).toBe(true);
    expect(run.mainLayout.cells.find(cell => cell.id === run.mainLayout.bossCellId).resolved).toBe(true);
  });

  test('combat preview can retreat to the previous hex without resolving the encounter', () => {
    let run = createRun();
    const start = run.mainLayout.currentCellId;
    const combat = getAdjacentCellIds(run.mainLayout, start)
      .map(id => run.mainLayout.cells.find(cell => cell.id === id))
      .find(cell => !cell?.locked && [ROOM_TYPES.COMBAT, ROOM_TYPES.CURSED_ENEMY].includes(cell?.previewRoomType));
    if (!combat) return;

    const moved = moveExpeditionRun(run, combat.id, { rng: () => 0.42 });
    expect(moved.moved).toBe(true);
    expect(moved.run.pendingOriginCellId).toBe(start);
    expect(moved.run.pendingCellId).toBe(combat.id);

    run = cancelPendingExpeditionCell(moved.run, { rng: () => 0.42 });
    expect(run.mainLayout.currentCellId).toBe(start);
    expect(run.pendingCellId).toBeNull();
    expect(run.mainLayout.cells.find(cell => cell.id === combat.id)?.resolved).toBe(false);
  });

  test('retreat falls back to an adjacent visited cell for previews created by older saves', () => {
    let run = createRun();
    const start = run.mainLayout.currentCellId;
    const targetId = getAdjacentCellIds(run.mainLayout, start)
      .find(id => !run.mainLayout.cells.find(cell => cell.id === id)?.locked);
    const moved = moveExpeditionRun(run, targetId, { rng: () => 0.42 });
    if (!moved.moved) return;

    run = {
      ...moved.run,
      pendingOriginCellId: null,
      mainLayout: {
        ...moved.run.mainLayout,
        cells: moved.run.mainLayout.cells.map(cell =>
          cell.id === start ? { ...cell, visited: true, resolved: true } : cell
        ),
      },
    };
    const retreated = cancelPendingExpeditionCell(run, { rng: () => 0.42 });
    expect(retreated.mainLayout.currentCellId).toBe(start);
    expect(retreated.pendingCellId).toBeNull();
  });

  test('resolved ordinary cells can be backtracked through without repeating content', () => {
    let run = createRun();
    const start = run.mainLayout.currentCellId;
    const next = getAdjacentCellIds(run.mainLayout, start)
      .find(id => !run.mainLayout.cells.find(cell => cell.id === id)?.locked);
    run = moveExpeditionRun(run, next).run;
    run = resolvePending(run);
    run = moveExpeditionRun(run, start).run;
    expect(run.mainLayout.currentCellId).toBe(start);
    expect(run.pendingCellId).toBeNull();
  });
});
