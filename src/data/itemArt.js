import { normalizeItemName } from './items';

const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const itemAsset = path => `${publicUrl}/assets/items/${path}`;

// The canonical registry is the only place where authored item paths are declared.
const ART_PATHS = {
  // Consumables (art IDs are retained for combat quick-item callers).
  minor_health_potion: 'consumables/minor_health_potion.webp', health_potion: 'consumables/health_potion.webp',
  reinforced_shield_potion: 'consumables/reinforced_shield_potion.webp', bitter_resin_infusion: 'consumables/bitter_resin_infusion.webp',
  last_spring_infusion: 'consumables/last_spring_infusion.webp',
  clinging_roots_scroll: 'consumables/clinging_roots_scroll.webp',
  minor_defense_potion: 'consumables/minor_defense_potion.webp',
  minor_regeneration_potion: 'consumables/minor_regeneration_potion.webp', minor_shield_potion: 'consumables/minor_shield_potion.webp',
  minor_magic_power_potion: 'consumables/minor_magic_power_potion.webp', minor_attack_potion: 'consumables/minor_attack_potion.webp',
  minor_speed_potion: 'consumables/minor_speed_potion.webp', minor_antimagic_potion: 'consumables/minor_antimagic_potion.webp',
  minor_cleanse_potion: 'consumables/minor_cleanse_potion.webp', fireball_scroll: 'consumables/fireball_scroll.webp',
  healing_scroll: 'consumables/healing_scroll.webp', blood_touch_scroll: 'consumables/blood_touch_scrol.webp',
  ice_cone_scroll: 'consumables/ice_cone_scroll.webp', poison_cloud_scroll: 'consumables/poison_cloud_scroll.webp',

  // Canonical equipment.
  'Походная сумка Гильдии': 'equipment/guild_bag.webp',
  'Ржавый меч новобранца': 'equipment/rusty_recruit_sword.webp', 'Щит Новобранца': 'equipment/recruit_shield.webp',
  'Треснувший учебный фокус': 'equipment/cracked_training_focus.webp', 'Старый короткий лук': 'equipment/old_short_bow.webp',
  'Натянутый охотничий лук': 'equipment/taut_hunting_bow.webp', 'Лук Спороносца': 'equipment/sporebearer_bow.webp',
  'Капюшон Следопыта': 'equipment/ranger_hood.webp', 'Плащ разведчика': 'equipment/scout_cloak.webp',
  'Кольцо Меткой Тетивы': 'equipment/marked_bowstring_ring.webp', 'Посох Украденной Искры': 'equipment/stolen_spark_staff.webp',
  'Жезл Закопчённого Стекла': 'equipment/sooted_glass_wand.webp', 'Фокус Ледяного Спора': 'equipment/frost_spore_focus.webp',
  'Молот Спорового Стража': 'equipment/spore_guardian_hammer.webp', 'Капюшон Искателя Знаков': 'equipment/sign_seeker_hood.webp',
  'Пепельная Маска Отступника': 'equipment/ashen_renegade_mask.webp', 'Мантия Погасшего Костра': 'equipment/faded_bonfire_mantle.webp',
  'Плащ Тусклого Оберега': 'equipment/dim_ward_cloak.webp', 'Кольцо Переменчивой Искры': 'equipment/shifting_spark_ring.webp',
  'Кольцо Тлеющего Отзвука': 'equipment/smoldering_echo_ring.webp', 'Амулет Трёх Искр': 'equipment/three_sparks_amulet.webp',
  'Красный Колпак Старшего Крысолова': 'equipment/senior_ratcatcher_red_cap.webp', 'Грибная Маска Споровика': 'equipment/spore_mask.webp',
  'Куртка Мародёра': 'equipment/marauder_jacket.webp', 'Хитиновый Панцирь Мясного Жука': 'equipment/chitin_carapace.webp',
  'Щит Дозорного Гильдии': 'equipment/guild_watch_shield.webp', 'Шипастый Щит Нор': 'equipment/spiked_warrens_shield.webp',
  'Тесак Гоблинского Мясника': 'equipment/goblin_butcher_cleaver.webp', 'Булава Старого Сотника': 'equipment/old_centurion_mace.webp',
  'Алебарда Пограничного Дозора': 'equipment/border_watch_halberd.webp', 'Кольцо Туманного Мха': 'equipment/fog_moss_ring.webp',
  'Железное Кольцо Караульного': 'equipment/iron_sentry_ring.webp', 'Амулет Ветерана Бездны': 'equipment/veteran_of_the_abyss_amulet.webp',
  'Амулет цепкой живицы': 'equipment/clinging_resin_amulet.webp',
  'Зеркало третьего голоса': 'equipment/third_voice_mirror.webp',
  'Щит тлеющей жилы': 'equipment/smoldering_vein_shield.webp',
  'Венец блуждающих спор': 'equipment/wandering_spore_crown.webp', 'Накидка Красного Костра': 'equipment/red_bonfire_cloak.webp',
  'Мерцающая оболочка': 'equipment/shimmering_shell.webp', 'Клятвопреступник': 'equipment/oathbreaker.webp',
  'Амулет Крысиной Жилы': 'equipment/rat_vein_amulet.webp', 'Полевой гримуар Отступника': 'equipment/renegade_field_grimoire.webp',
  'Костяная удочка': 'equipment/bone_fishing_rod.webp',
  'Кадило Отца Костров': 'equipment/father_of_bonfires_censer.webp',
  'Панцирь Змеиного Полубога': 'equipment/serpent_demigod_armor.webp',
  'Плащ Первого Предателя': 'equipment/first_traitor_cloak.webp',

  // Abyss Level 2 — common equipment.
  'Клинок должника': 'equipment/debtors_blade.webp',
  'Жезл встречных формул': 'equipment/counterformula_wand.webp',
  'Лук пристрелки': 'equipment/sighting_bow.webp',
  'Щит третьей заплаты': 'equipment/third_patch_shield.webp',
  'Шлем чужого сигнала': 'equipment/foreign_signal_helmet.webp',
  'Кираса последнего в строю': 'equipment/last_in_line_cuirass.webp',
  'Куртка сорванного ритуала': 'equipment/torn_ritual_jacket.webp',
  'Обруч незаконченного приказа': 'equipment/unfinished_order_circlet.webp',
  'Сапоги загонщика': 'equipment/pursuer_boots.webp',
  'Жетон интенданта': 'equipment/quartermaster_token.webp',

  // Abyss Level 2 — Withering Forest.
  'Лук вязких жил': 'equipment/viscous_vein_bow.webp',
  'Фокус остановленного сока': 'equipment/stilled_sap_focus.webp',
  'Покров поздней весны': 'equipment/late_spring_shroud.webp',
  'Амулет горькой росы': 'equipment/bitter_dew_amulet.webp',
  'Перстень цепкого плюща': 'equipment/clinging_ivy_ring.webp',
  'Перстень живых шрамов': 'equipment/living_scars_ring.webp',
  'Сосуд украденного прилива': 'equipment/stolen_tide_vessel.webp',
  'Маска лесного часового': 'equipment/forest_sentinel_mask.webp',
  'Щит цепких корней': 'equipment/clinging_roots_shield.webp',
  'Сапоги проросшей тропы': 'equipment/sprouted_path_boots.webp',
  'Кольцо опавшего часа': 'equipment/fallen_hour_ring.webp',
  'Лук последнего цветения': 'equipment/last_bloom_bow.webp',
  'Венец Раны Великого Корня': 'equipment/great_root_wound_crown.webp',

  // Materials and special items that currently have authored art.
  'Простая ткань': 'materials/simple_cloth.png', 'Обрывки кожи': 'materials/leather_scraps.png',
  'Металлические обломки': 'materials/metal_fragments.webp', 'Кровяной мох': 'materials/blood_moss.webp',
  'Крысиная шкура': 'materials/rat_hide.png', 'Лазурный мицелий': 'materials/azure_mycelium.png',
  'Блуждающие споры': 'materials/wandering_spores.png', 'Пепел гоблинского перца': 'materials/goblin_pepper_ash.png',
  'Спора светокапа': 'materials/lightcap_spore.png', 'Мерцающий узел': 'materials/shimmering_node.png',
  'Сломанная клятва': 'materials/broken_oath.png', 'Сердце костра': 'materials/bonfire_heart.png',
  'Сумеречный вереск': 'materials/twilight_heather.png', 'Черножильная руда': 'materials/blackvein_ore.png',
  'Сумрачный сплав': 'materials/gloom_alloy.webp',
  'Выделанная кожа Бездны': 'materials/abyss_treated_leather.webp',
  'Глубинное полотно': 'materials/deepweave_cloth.webp',
  'Чёрная сердцевина': 'materials/black_heartwood.webp',
  'Горькая живица': 'materials/bitter_resin.webp',
  'Цветок последней весны': 'materials/last_spring_flower.webp',
  'Ветвь Архонта': 'materials/archon_branch.webp',
  'Кровяная припарка': 'consumables/blood_poultice.png', 'Простая склянка': 'consumables/simple_flask.webp',
  'Зелье здоровья': 'consumables/health_potion.webp',
  'Усиленное зелье щита': 'consumables/reinforced_shield_potion.webp',
  'Кровяная повязка': 'consumables/blood_bandage.webp',
  'Настой горькой живицы': 'consumables/bitter_resin_infusion.webp',
  'Настой последней весны': 'consumables/last_spring_infusion.webp',
  'Свиток цепких корней': 'consumables/clinging_roots_scroll.webp',
  'Эссенция Проклятий': 'special/essence_of_corruption.webp', 'Серебро': 'special/silver.png',

  // Rune IDs and names share the same canonical assets.
  ember_heart: 'runes/ember_heart.webp', stone_vigil: 'runes/stone_vigil.webp', astral_focus: 'runes/astral_focus.webp',
  'Руна Пламенного сердца': 'runes/ember_heart.webp', 'Руна Стального Отпора': 'runes/stone_vigil.webp',
  'Руна Астрального эха': 'runes/astral_focus.webp',
};

const CONSUMABLE_NAMES = {
  'Малое зелье здоровья': 'minor_health_potion', 'Малое зелье защиты': 'minor_defense_potion',
  'Малое зелье регенерации': 'minor_regeneration_potion', 'Малое зелье щита': 'minor_shield_potion',
  'Малое зелье магической силы': 'minor_magic_power_potion', 'Малое зелье атаки': 'minor_attack_potion',
  'Малое зелье скорости': 'minor_speed_potion', 'Малое зелье антимагии': 'minor_antimagic_potion',
  'Малое зелье очищения': 'minor_cleanse_potion', 'Свиток Огненного шара': 'fireball_scroll',
  'Свиток Лечения': 'healing_scroll', 'Свиток лечения': 'healing_scroll', 'Свиток Кровавого касания': 'blood_touch_scroll',
  'Свиток Конус льда': 'ice_cone_scroll', 'Свиток Ядовитого облака': 'poison_cloud_scroll',
};
Object.entries(CONSUMABLE_NAMES).forEach(([name, id]) => { ART_PATHS[name] = ART_PATHS[id]; });

export const ITEM_ART_PATHS = Object.freeze({ ...ART_PATHS });
export const ITEM_ART = Object.freeze(Object.fromEntries(Object.entries(ART_PATHS).map(([key, path]) => [key, itemAsset(path)])));

export const resolveItemArt = item => {
  if (!item) return null;
  if (typeof item === 'string') return ITEM_ART[normalizeItemName(item)] || null;
  return ITEM_ART[item.artId] || ITEM_ART[normalizeItemName(item.itemId)] || ITEM_ART[item.id] || ITEM_ART[normalizeItemName(item.name)] || null;
};

export const hideMissingItemArt = event => {
  const image = event?.currentTarget;
  if (!image) return;
  image.style.display = 'none';
  image.setAttribute('aria-hidden', 'true');
};
