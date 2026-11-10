import { getAppViewportOverride, isActiveCombatScreen, shouldShowAppHeader, shouldShowAppNavigation, shouldShowNewGame } from "./appShell";

describe("application shell visibility", () => {
  test.each(["combat", "arenaCombat"])("suppresses the app header on %s", screen => {
    expect(isActiveCombatScreen(screen)).toBe(true);
    expect(shouldShowAppHeader(screen)).toBe(false);
  });

  test.each(["character", "guild", "locationSelect", "arena"])(
    "keeps the app header on %s",
    screen => {
      expect(isActiveCombatScreen(screen)).toBe(false);
      expect(shouldShowAppHeader(screen)).toBe(true);
    }
  );

  test('suppresses the redundant app heading on the dungeon decision screen', () => {
    expect(shouldShowAppHeader('dungeon')).toBe(false);
    expect(shouldShowAppNavigation('dungeon')).toBe(false);
    expect(shouldShowAppNavigation('guild')).toBe(false);
    expect(shouldShowAppNavigation('locationSelect')).toBe(false);
    expect(shouldShowAppNavigation('arena')).toBe(true);
  });

  test('gives Guild a fullscreen root without outer padding or scrolling', () => {
    expect(getAppViewportOverride('guild')).toEqual({ padding: 0, height: '100dvh', overflow: 'hidden' });
    expect(getAppViewportOverride('character')).toEqual({});
    expect(getAppViewportOverride('combat')).toEqual({});
  });

  test("keeps the New Game control behind the development gate", () => {
    const visible = { hasPlayer: true, screen: "guild", environment: 'development' };
    expect(shouldShowNewGame(visible)).toBe(true);
    expect(shouldShowNewGame({ ...visible, screen: "locationSelect" })).toBe(true);
    expect(shouldShowNewGame({ ...visible, screen: "dungeon" })).toBe(true);
    expect(shouldShowNewGame({ ...visible, screen: "arena" })).toBe(true);
    expect(shouldShowNewGame({ ...visible, environment: "production" })).toBe(false);
    expect(shouldShowNewGame({ ...visible, environment: "development" })).toBe(true);
    expect(shouldShowNewGame({ ...visible, hasPlayer: false })).toBe(false);
    expect(shouldShowNewGame({ ...visible, screen: "combat" })).toBe(false);
    expect(shouldShowNewGame({ ...visible, screen: "arenaCombat" })).toBe(false);
    expect(shouldShowNewGame({ ...visible, customCombatView: "battle" })).toBe(false);
  });
});
