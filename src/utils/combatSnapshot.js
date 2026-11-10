const sanitizeSourceSnapshotForSnapshot = (sourceSnapshot = {}) => {
  if (!sourceSnapshot || typeof sourceSnapshot !== "object") return null;
  const entity = sourceSnapshot.entity && typeof sourceSnapshot.entity === "object" ? sourceSnapshot.entity : null;
  return {
    attack: sourceSnapshot.attack ?? entity?.attack ?? entity?.baseAtk ?? 0,
    magAtk: sourceSnapshot.magAtk ?? entity?.magAtk ?? 0,
    scaling: sourceSnapshot.scaling ?? sourceSnapshot.magAtk ?? entity?.magAtk ?? 0,
    name: sourceSnapshot.name ?? entity?.name ?? "Источник",
    id: sourceSnapshot.id ?? entity?.id ?? entity?.runtimeId ?? null,
    type: sourceSnapshot.type ?? entity?.type ?? null,
    level: sourceSnapshot.level ?? entity?.level ?? null,
  };
};

export const sanitizeForCombatSnapshot = (value, seen = new WeakSet(), keyHint = "") => {
  if (value === null || typeof value !== "object") {
    return typeof value === "function" ? undefined : value;
  }

  if (keyHint === "sourceSnapshot") {
    return sanitizeSourceSnapshotForSnapshot(value);
  }

  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value
      .map(entry => sanitizeForCombatSnapshot(entry, seen))
      .filter(entry => entry !== undefined);
    seen.delete(value);
    return result;
  }

  const result = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (typeof entry === "function") return;
    // The expedition owns its map. Copying it into the initial combat, its
    // result and battleResult.playerState can exceed the API's 1 MB save limit.
    // This also compacts snapshots restored from older clients, without changing
    // the authoritative map on the persistent player.
    if (key === "expeditionMap") return;
    if (key === "sourceRef") return;
    if (key === "entity" && entry && typeof entry === "object") return;
    if (["source", "target", "owner", "context", "session"].includes(key) && entry && typeof entry === "object") return;

    const sanitized = sanitizeForCombatSnapshot(entry, seen, key);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  });
  seen.delete(value);
  return result;
};

export const snapshotCombatSession = (session, metadata = {}) => {
  if (!session?.state) return null;
  return sanitizeForCombatSnapshot({
    ...metadata,
    location: session.location ?? null,
    state: session.state,
    runtime: {
      summonSequence: session._summonSequence || 0,
      friendlySummonCopySequence: session._friendlySummonCopySequence || 0,
      royalExecutionerSequence: session._royalExecutionerSequence || 0,
      burialSealSequence: session._burialSealSequence || 0,
    },
    ...(session.rng?.getState ? { rngState: session.rng.getState() } : {}),
  });
};


