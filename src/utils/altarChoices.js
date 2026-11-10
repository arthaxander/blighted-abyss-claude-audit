// Offers are generated with the room payload and saved there. Reading/reopening
// an altar never calls RNG; old saved single-curse altars keep their original offer.
export const getAltarCurseIds = altar => Array.from(new Set(
  Array.isArray(altar?.curseIds) ? altar.curseIds : altar?.curseId ? [altar.curseId] : []
)).filter(id => typeof id === 'string').slice(0, 2);

export const rollAltarChoices = (pool = [], rng = Math.random) => {
  const remaining = Array.from(new Map(pool.map(curse => [curse.id, curse])).values());
  const selected = [];
  while (remaining.length && selected.length < 2) {
    const index = Math.min(remaining.length - 1, Math.max(0, Math.floor(rng() * remaining.length)));
    selected.push(remaining.splice(index, 1)[0]);
  }
  return selected.length ? { curseIds: selected.map(curse => curse.id), curseId: selected[0].id, curseName: selected[0].shortName } : {};
};
