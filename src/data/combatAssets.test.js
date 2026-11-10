import { ABILITY_LIBRARY, createAbilityByName } from "./abilityPresets";
import { ITEM_LIBRARY, getItemDefinition } from "./items";
import { allEnemies, createEnemyInstanceByName, enemies } from "./enemies";
import { initCombatSession } from "../utils/combatUtils";
import { getEnemyActionPresentationArtId } from "../utils/combatPresentationEvents";
import {
  ABILITY_ICONS,
  PASSIVE_ICONS,
  COMBAT_ITEM_ICONS,
  ENEMY_PORTRAITS,
  PLAYER_PORTRAITS,
  resolveAbilityIcon,
  resolveCombatItemIcon,
  resolveEnemyPortrait,
  resolvePlayerPortrait,
} from "./combatAssets";

const obtainableActiveAbilityNames = [
  "Атака", "Стойкость", "Кровавый таран", "Устрашение", "Удар щитом",
  "Железный контрудар", "Щитовая волна", "Огненный шар", "Цепная молния",
  "Морозный щит", "Ледяное копьё", "Зазубренная стрела", "Прицельный выстрел",
  "Добивающий выстрел", "Быстрый перехват",
];

describe("combat art manifest", () => {
  test("all 47 combat-visible enemies have unique stable portrait keys", () => {
    expect(allEnemies).toHaveLength(47);
    const keys = allEnemies.map(enemy => enemy.portraitKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(key => /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key))).toBe(true);
    expect(keys.every(key => !/^enemy-\d+$/.test(key))).toBe(true);
    expect(keys.every(key => ENEMY_PORTRAITS[key]?.includes("/assets/combat/portraits/enemies/"))).toBe(true);
  });

  test("summon-only enemies stay out of encounter enemies and retain portrait identity", () => {
    ["Пещерная змея", "Чумная крыса"].forEach(name => {
      const definition = allEnemies.find(enemy => enemy.name === name);
      const summoned = createEnemyInstanceByName(name);
      expect(definition).toMatchObject({ summonOnly: true });
      expect(enemies.some(enemy => enemy.name === name)).toBe(false);
      expect(summoned.portraitKey).toBe(definition.portraitKey);
      expect(resolveEnemyPortrait(summoned)).toBe(resolveEnemyPortrait(definition));
    });
  });

  test("both summon-only definitions still instantiate through the real summon helper", () => {
    const session = initCombatSession(
      { name: "Hero", hp: 100, maxHp: 100, attack: 10 },
      [{ name: "Summoner", hp: 50, maxHp: 50, attack: 5, abilities: [] }]
    );
    expect(session.summonEnemy("Пещерная змея").success).toBe(true);
    expect(session.summonEnemy("Чумная крыса").success).toBe(true);
    expect(session.state.enemies.slice(-2).map(enemy => enemy.portraitKey))
      .toEqual(["cave_snake", "plague_rat"]);
  });

  test("all obtainable active player actions have stable art IDs and manifest entries", () => {
    expect(Object.keys(ABILITY_ICONS).length).toBeGreaterThanOrEqual(44);
    obtainableActiveAbilityNames.forEach(name => {
      const ability = createAbilityByName(name);
      expect(ability.passive).not.toBe(true);
      expect(ability.artId).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
      expect(resolveAbilityIcon(ability)).toContain("/assets/combat/abilities/");
    });
    expect(ABILITY_LIBRARY["Атака"].artId).toBe("attack");
  });

  test('uploaded progression passive art is mapped for all starter classes', () => {
    expect(Object.keys(PASSIVE_ICONS)).toHaveLength(12);
    Object.values(PASSIVE_ICONS).forEach(path => expect(path).toMatch(/\/assets\/combat\/passives\/.+\.webp$/));
  });

  test("all canonical combat items have art IDs and healing aliases share one icon", () => {
    expect(Object.keys(COMBAT_ITEM_ICONS)).toHaveLength(14);
    Object.values(ITEM_LIBRARY).forEach(definition => {
      expect(definition.artId).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
      expect(resolveCombatItemIcon(definition)).toContain("/assets/items/consumables/");
    });
    expect(getItemDefinition("Свиток Лечения").artId).toBe("healing_scroll");
    expect(resolveCombatItemIcon(getItemDefinition("Свиток лечения")))
      .toBe(resolveCombatItemIcon(getItemDefinition("Свиток Лечения")));
  });

  test("player portrait mapping covers current and legacy class keys", () => {
    expect(Object.keys(PLAYER_PORTRAITS)).toEqual(expect.arrayContaining(["Warrior", "Defender", "Mage", "Archer"]));
    ["Defender", "Mage", "Archer"].forEach(className => {
      expect(resolvePlayerPortrait({ class: className })).toContain("/assets/combat/portraits/player/");
    });
    expect(resolvePlayerPortrait({ class: "Warrior" })).toBe(resolvePlayerPortrait({ class: "Defender" }));
  });
});

test('Fungal live actions resolve authored enemy presentation art', () => {
  const ability = ABILITY_LIBRARY['Сдерживающий выпад'];
  expect(ability.enemyArtId).toBe('restraining_thrust');
  expect(getEnemyActionPresentationArtId(ability)).toBe('restraining_thrust');
  expect(resolveAbilityIcon({ artId: getEnemyActionPresentationArtId(ability) })).toContain('restraining_thrust.webp');
});
