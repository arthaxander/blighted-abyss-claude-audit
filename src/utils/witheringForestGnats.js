// A Gnat's owner is a stable combat-unit ID, never a name or roster index.
// Resolve from the current session each time: saved games and multiple Sowers
// must not rely on stale object references or award another Sower healing.
export const BLOOD_BOND_RATIO = 0.5;
export const GNAT_BLOODSUCK_RATIO = 0.75;
export const GNAT_NAME = 'Янтарный Гнус';
export const SOWER_NAME = 'Сеятель Гнуса';

export function findLivingBloodBondOwner(session, gnat) {
  if (!session?.state || gnat?.name !== GNAT_NAME || gnat.summoned !== true || !gnat.ownerId) return null;
  if (!(session.state.enemies || []).includes(gnat)) return null;
  return (session.state.enemies || []).find(unit => unit?.id === gnat.ownerId &&
    unit.name === SOWER_NAME && unit.hp > 0 && !unit.passivesDisabled &&
    (unit.abilities || []).some(ability => ability?.passive && ability.name === 'Кровавая связь')) || null;
}
