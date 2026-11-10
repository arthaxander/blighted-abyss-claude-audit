import { ITEM_ART, resolveItemArt } from './itemArt';

const publicUrl = (process.env.PUBLIC_URL || "").replace(/\/$/, "");

export const COMBAT_ASSET_ROOT = `${publicUrl}/assets/combat`;

const assetUrl = path => `${COMBAT_ASSET_ROOT}/${path}`;

export const COMBAT_ART_FALLBACKS = {
  enemy: assetUrl("fallbacks/enemy.webp"),
  player: assetUrl("fallbacks/player.webp"),
  ally: assetUrl("fallbacks/ally.webp"),
  ability: assetUrl("fallbacks/ability.webp"),
  item: assetUrl("fallbacks/item.webp"),
};

const enemyGroup = (folder, keys) => Object.fromEntries(
  keys.map(key => [key, assetUrl(`portraits/enemies/${folder}/${key}.webp`)])
);

export const ENEMY_PORTRAITS = {
  ...enemyGroup("goblin_nests", [
    "burrow_ratmancer", "goblin_executioner", "goblin_ripper", "goblin_crossbowman",
    "goblin_weaver", "rat_matriarch", "rat_rider", "goblin_fire_worshipper",
    "warped_goblin_crystalbreaker", "corrupted_goblin_ratskinner", "ashen_cap_ragshnar",
    "plague_rat",
  ]),
  ...enemyGroup("fungal", [
    "troglodyte_spearman", "troglodyte_shaman", "two_headed_serpent",
    "corrupted_troglodyte_snakehead", "troglodyte_mycelium", "cave_snake",
  ]),
  troglodyte_snake_caller: assetUrl("portraits/enemies/fungal/troglodyte_snake_caster.webp"),
  infected_troglodyte: assetUrl("portraits/enemies/fungal/troglodyte_infected.webp"),
  spore_troglodyte: assetUrl("portraits/enemies/fungal/troglodyte_sporebearer.webp"),
  warped_troglodyte_totemist: assetUrl("portraits/enemies/fungal/distorted_troglodyte_totemist.webp"),
  feral_troglodyte: assetUrl("portraits/enemies/fungal/Troglodyte_Feral.webp"),
  boneguard: assetUrl("portraits/enemies/fungal/Troglodyte_Serpent_Bonewarden.webp"),
  ...enemyGroup("deserter_camp", [
    "deserter_brute", "deserter_warlock", "deserter_trickster", "deserter_duelist",
    "deserter_ranger", "deserter_apothecary", "deserter_stormcaller",
    "deserter_halberd_master", "corrupted_deserter_berserker", "warped_deserter_guard",
    "deserter_blade_master",
  ]),
  ...enemyGroup("restless_ruins", [
    "dead_march_herald", "twin_bastion", "two_soul_conjurer", "last_march_rider",
    "shattered_spearman", "twin_duelist", "fallen_cohort_standard_bearer",
    "soul_stitcher", "defiled_siege_abomination", "distorted_crystal_deadshot",
    "buried_legion", "buried_shieldbearer", "buried_swordsman", "fallen_cohort_banner",
  ]),
  ...enemyGroup("withering_forest", [
    "petal_witch", "elven_archer", "thorn_guard", "thicket_shadow", "gnat_sower",
    "amber_gnat", "forest_reaper", "owl_druid", "bear_druid", "crystal_splitter",
    "defiled_predator", "bloom_archon",
  ]),
  ...enemyGroup("mines_of_decay", [
    "mines_hook_brute", "mines_defiled_healer", "mines_warped_bomber",
    "mines_scorched_bull", "mines_forgotten_surveyor", "mines_shackled_guard",
    "mines_ore_porter", "mines_pickaxe_worker", "mines_support_master",
    "mines_overseer", "mines_zolotoplavets",
  ]),
};

export const PLAYER_PORTRAITS = {
  Warrior: assetUrl("portraits/player/defender.webp"),
  Defender: assetUrl("portraits/player/defender.webp"),
  Mage: assetUrl("portraits/player/elementalist.webp"),
  Archer: assetUrl("portraits/player/archer.webp"),
};

// Future files: public/assets/combat/portraits/allies/<allyPortraitKey>.webp.
// Export dedicated 576x384 WebP (3:2) artwork when friendly definitions are introduced.
export const ALLY_PORTRAITS = {
  'summons/elementalist/fire_elemental': assetUrl('portraits/allies/summons/elementalist/fire_elemental.webp'),
  'summons/archer/snake_trap_support': assetUrl('portraits/allies/summons/archer/snake_trap_support.webp'),
};

export const ABILITY_ICONS = {
  attack: assetUrl("abilities/shared/attack.webp"),
  // Goblin Nests
  rat_call: assetUrl("abilities/goblin_nests/rat_call.webp"),
  rat_race: assetUrl("abilities/goblin_nests/rat_race.webp"),
  execution_sentence: assetUrl("abilities/goblin_nests/execution_sentence.webp"),
  execution_strike: assetUrl("abilities/goblin_nests/execution_strike.webp"),
  meat_whirlwind: assetUrl("abilities/goblin_nests/meat_whirlwind.webp"),
  bloodlust: assetUrl("abilities/goblin_nests/bloodlust.webp"),
  poisoned_bolt: assetUrl("abilities/goblin_nests/poisoned_bolt.webp"),
  goblin_cover: assetUrl("abilities/goblin_nests/goblin_cover.webp"),
  entangling_net: assetUrl("abilities/goblin_nests/entangling_net.webp"),
  needle_sting: assetUrl("abilities/goblin_nests/needle_sting.webp"),
  litter_call: assetUrl("abilities/goblin_nests/litter_call.webp"),
  gnawing_maw: assetUrl("abilities/goblin_nests/gnawing_maw.webp"),
  feed_the_pack: assetUrl("abilities/goblin_nests/feed_the_pack.webp"),
  serrated_pike: assetUrl("abilities/goblin_nests/serrated_pike.webp"),
  burrow_charge: assetUrl("abilities/goblin_nests/burrow_charge.webp"),
  smoldering_throw: assetUrl("abilities/goblin_nests/smoldering_throw.webp"),
  tar_cloth: assetUrl("abilities/goblin_nests/tar_cloth.webp"),
  feed_the_fire: assetUrl("abilities/goblin_nests/feed_the_fire.webp"),
  crystalline_fracture: assetUrl("abilities/goblin_nests/crystalline_fracture.webp"),
  crystalline_breakaway: assetUrl("abilities/goblin_nests/crystalline_breakaway.webp"),
  crystal_strike: assetUrl("abilities/goblin_nests/crystal_strike.webp"),
  shard_dash: assetUrl("abilities/goblin_nests/shard_dash.webp"),
  crystal_carapace: assetUrl("abilities/goblin_nests/crystal_carapace.webp"),
  scent_of_open_wound: assetUrl("abilities/goblin_nests/scent_of_open_wound.webp"),
  fleshy_grip: assetUrl("abilities/goblin_nests/fleshy_grip.webp"),
  amber_frenzy: assetUrl("abilities/goblin_nests/amber_frenzy.webp"),
  inferno: assetUrl("abilities/goblin_nests/inferno.webp"),
  blazing_shield: assetUrl("abilities/goblin_nests/blazing_shield.webp"),
  fire_blast: assetUrl("abilities/goblin_nests/fire_blast.webp"),
  dirty_bite: assetUrl("abilities/goblin_nests/dirty_bite.webp"),
  // Fungal Caves
  restraining_thrust: assetUrl("abilities/fungal/restraining_thrust.webp"),
  spear_stance: assetUrl("abilities/fungal/spear_stance.webp"),
  serpent_call: assetUrl("abilities/fungal/serpent_call.webp"),
  venomous_serpent_dance: assetUrl("abilities/fungal/venomous_serpent_dance.webp"),
  plague_bite: assetUrl("abilities/fungal/plague_bite.webp"),
  bone_ritual: assetUrl("abilities/fungal/bone_ritual.webp"),
  curse_of_blind_eyes: assetUrl("abilities/fungal/curse_of_blind_eyes.webp"),
  infected_thrust: assetUrl("abilities/fungal/infected_thrust.webp"),
  parasitic_reflex: assetUrl("abilities/fungal/parasitic_reflex.webp"),
  spore_storm: assetUrl("abilities/fungal/spore_storm.webp"),
  death_spore_burst: assetUrl("abilities/fungal/death_spore_burst.webp"),
  rending_charge: assetUrl("abilities/fungal/rending_charge.webp"),
  pack_screech: assetUrl("abilities/fungal/pack_screech.webp"),
  bone_shroud: assetUrl("abilities/fungal/bone_shroud.webp"),
  guardian_retribution: assetUrl("abilities/fungal/guardian_retribution.webp"),
  last_guardian: assetUrl("abilities/fungal/last_guardian.webp"),
  double_bite: assetUrl("abilities/fungal/double_bite.webp"),
  serpent_evasion: assetUrl("abilities/fungal/serpent_evasion.webp"),
  bloody_bite: assetUrl("abilities/fungal/bloody_bite.webp"),
  corrupted_vampirism: assetUrl("abilities/fungal/corrupted_vampirism.webp"),
  bloody_molt: assetUrl("abilities/fungal/bloody_molt.webp"),
  shard_totem: assetUrl("abilities/fungal/shard_totem.webp"),
  totem_growth: assetUrl("abilities/fungal/totem_growth.webp"),
  prismatic_strike: assetUrl("abilities/fungal/prismatic_strike.webp"),
  spore_burst: assetUrl("abilities/fungal/spore_burst.webp"),
  fungal_network: assetUrl("abilities/fungal/fungal_network.webp"),
  spore_paralysis: assetUrl("abilities/fungal/spore_paralysis.webp"),
  mycelium_constriction: assetUrl("abilities/fungal/mycelium_constriction.webp"),
  mycelium_feeding: assetUrl("abilities/fungal/mycelium_feeding.webp"),
  // Elementalist summons
  fire_elemental_firebolt: assetUrl("abilities/summons/elementalist/fire_elemental_firebolt.webp"),
  fire_elemental_ignite: assetUrl("abilities/summons/elementalist/fire_elemental_ignite.webp"),
  fire_elemental_blazing_core: assetUrl("abilities/summons/elementalist/fire_elemental_blazing_core.webp"),
  endurance: assetUrl("abilities/defender/endurance.webp"),
  blood_ram: assetUrl("abilities/defender/blood_ram.webp"),
  intimidation: assetUrl("abilities/defender/intimidation.webp"),
  shield_bash: assetUrl("abilities/defender/shield_bash.webp"),
  iron_counter: assetUrl("abilities/defender/iron_counter.webp"),
  shield_wave: assetUrl("abilities/defender/shockwave.webp"),
  shockwave: assetUrl("abilities/defender/shockwave.webp"),
  ram: assetUrl("abilities/defender/ram.webp"),
  shield_throw: assetUrl("abilities/defender/shield_throw.webp"),
  blood_challenge: assetUrl("abilities/defender/blood_challenge.webp"),
  fireball: assetUrl("abilities/elementalist/fireball.webp"),
  chain_lightning: assetUrl("abilities/elementalist/chain_lightning.webp"),
  frost_shield: assetUrl("abilities/elementalist/frost_shield.webp"),
  ice_lance: assetUrl("abilities/elementalist/ice_lance.webp"),
  serrated_arrow: assetUrl("abilities/archer/serrated_arrow.webp"),
  aimed_shot: assetUrl("abilities/archer/aimed_shot.webp"),
  finishing_shot: assetUrl("abilities/archer/finishing_shot.webp"),
  quick_intercept: assetUrl("abilities/archer/quick_intercept.webp"),
  blizzard: assetUrl("abilities/elementalist/blizzard.webp"),
  storm_discharge: assetUrl("abilities/elementalist/storm_discharge.webp"),
  elemental_echo: assetUrl("abilities/elementalist/elemental_echo.webp"),
  elemental: assetUrl("abilities/elementalist/elemental.webp"),
  wolf_pit: assetUrl("abilities/archer/wolf_pit.webp"),
  redirect: assetUrl("abilities/archer/redirect.webp"),
  arrow_volley: assetUrl("abilities/archer/arrow_volley.webp"),
  snake_trap: assetUrl("abilities/archer/snake_trap.webp"),
};

export const PASSIVE_ICONS = {
  blood_pressure: assetUrl('passives/defender/blood_pressure.webp'), retaliatory_assault: assetUrl('passives/defender/retaliatory_assault.webp'),
  last_stand: assetUrl('passives/defender/last_stand.webp'), headlong: assetUrl('passives/defender/headlong.webp'),
  lightning_speed: assetUrl('passives/elementalist/lightning_speed.webp'), overheat: assetUrl('passives/elementalist/overheat.webp'),
  elemental_shell: assetUrl('passives/elementalist/elemental_shell.webp'), elemental_resonance: assetUrl('passives/elementalist/elemental_resonance.webp'),
  finish_the_prey: assetUrl('passives/archer/finish_the_prey.webp'), initiative: assetUrl('passives/archer/initiative.webp'),
  false_trail: assetUrl('passives/archer/false_trail.webp'), hunting_rhythm: assetUrl('passives/archer/hunting_rhythm.webp'),
};

export const COMBAT_ITEM_ICONS = Object.fromEntries([
  "minor_health_potion", "minor_defense_potion", "minor_regeneration_potion",
  "minor_shield_potion", "minor_magic_power_potion", "minor_attack_potion",
  "minor_speed_potion", "minor_antimagic_potion", "minor_cleanse_potion",
  "fireball_scroll", "healing_scroll", "blood_touch_scroll", "ice_cone_scroll",
  "poison_cloud_scroll",
].map(key => [key, ITEM_ART[key]]));

export const resolveEnemyPortrait = enemy => (
  enemy?.portraitUrl || ENEMY_PORTRAITS[enemy?.portraitKey || enemy?.portraitId] || null
);

export const resolvePlayerPortrait = player => (
  player?.portraitUrl || PLAYER_PORTRAITS[player?.class] || player?.portrait || null
);

export const resolveAllyPortrait = unit => (
  unit?.allyPortraitUrl || ALLY_PORTRAITS[unit?.allyPortraitKey] || (
    unit?.allyPortraitKey ? assetUrl(`portraits/allies/${unit.allyPortraitKey}.webp`) : null
  )
);

export const resolveAbilityIcon = ability => ABILITY_ICONS[ability?.artId] || null;
export const resolvePassiveIcon = passive => {
  const id = passive?.id || passive;
  const canonicalId = ({ catalyst: 'lightning_speed', polarization: 'overheat' })[id] || id;
  return PASSIVE_ICONS[canonicalId] || null;
};

export const resolveCombatItemIcon = item => resolveItemArt(item);

export const applyCombatArtFallback = (event, fallbackUrl = null) => {
  const image = event?.currentTarget;
  if (!image) return;
  if (fallbackUrl && image.dataset.fallbackApplied !== "true") {
    image.dataset.fallbackApplied = "true";
    image.src = fallbackUrl;
    return;
  }
  image.style.display = "none";
  image.setAttribute("aria-hidden", "true");
};

// Cache only successful or in-flight requests. Timeouts and broken URLs must be
// retryable on subsequent screens instead of remaining permanently "failed".
const preloadCache = new Map();
const loadedImages = new Set();

export const areImagesPreloaded = urls => (urls || [])
  .filter(Boolean)
  .every(url => loadedImages.has(url));

export const preloadImage = (url, timeoutMs = 3000) => {
  if (!url || typeof Image === 'undefined') return Promise.resolve(false);
  if (loadedImages.has(url)) return Promise.resolve(true);
  if (preloadCache.has(url)) return preloadCache.get(url);

  const request = new Promise(resolve => {
    const image = new Image();
    let settled = false;
    let timer;
    const settle = loaded => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (loaded) loadedImages.add(url);
      resolve(loaded);
    };
    timer = setTimeout(() => settle(false), Math.max(0, timeoutMs));
    image.onload = () => {
      // decode() allows the first painted frame to reuse decoded pixels when supported.
      if (typeof image.decode === 'function') {
        Promise.resolve().then(() => image.decode()).then(
          () => settle(true),
          () => settle(true) // Decode may reject despite a successfully loaded image.
        );
      } else settle(true);
    };
    image.onerror = () => settle(false);
    image.src = url;
  }).then(loaded => {
    if (!loaded) preloadCache.delete(url);
    return loaded;
  });

  preloadCache.set(url, request);
  return request;
};

export const preloadImages = (urls, timeoutMs) => Promise.all(
  [...new Set((Array.isArray(urls) ? urls : []).filter(Boolean))]
    .map(url => preloadImage(url, timeoutMs))
);

// The first combat frame should not contain empty unit portraits or ability
// buttons. Avoid preloading the entire game's enemy and ability catalog.
export const getCombatCriticalImages = state => {
  const players = state?.players || [];
  const enemies = state?.enemies || [];
  return [...new Set([
    resolvePlayerPortrait(players[0]),
    ...players.slice(1).map(resolveAllyPortrait),
    ...enemies.map(resolveEnemyPortrait),
    ...(players[0]?.abilities || []).filter(ability => !ability.passive).map(resolveAbilityIcon),
  ].filter(Boolean))];
};

// Nonblocking follow-up request: animation icons for the actual encounter only.
export const getCombatWarmImages = state => [...new Set(
  (state?.enemies || []).flatMap(enemy => (enemy.abilities || []).map(resolveAbilityIcon)).filter(Boolean)
)];
