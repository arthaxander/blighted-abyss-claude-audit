// Resolved cells cannot be entered as encounters again. Their full enemy/loot
// payloads are dead history; retaining 60+ of them bloats every subsequent save.
// Keep pending and unresolved payloads verbatim, including cancelled encounters.
export const compactExpeditionMapForSave = run => {
  if (!(Number(run?.state?.version) >= 2) || !Array.isArray(run?.mainLayout?.cells)) return run;
  let changed = false;
  const cells = run.mainLayout.cells.map(cell => {
    if (!cell.resolved || cell.id === run.pendingCellId || !cell.content) return cell;
    changed = true;
    return { ...cell, content: null };
  });
  return changed ? { ...run, mainLayout: { ...run.mainLayout, cells } } : run;
};
