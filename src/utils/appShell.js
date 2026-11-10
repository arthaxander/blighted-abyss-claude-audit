export const isActiveCombatScreen = screen => screen === "combat" || screen === "arenaCombat";

export const shouldShowAppHeader = screen => screen !== 'dungeon' && !isActiveCombatScreen(screen);

export const shouldShowAppNavigation = screen => screen === 'arena';

export const getAppViewportOverride = screen => screen === 'guild'
  ? { padding: 0, height: '100dvh', overflow: 'hidden' }
  : {};

export const shouldShowNewGame = ({ hasPlayer, screen, customCombatView = null, environment = process.env.NODE_ENV }) => (
  Boolean(hasPlayer) &&
  environment === 'development' &&
  !isActiveCombatScreen(screen) &&
  customCombatView !== "battle"
);
