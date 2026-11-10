// src/data/abilities.js
// Автоматически формализованные способности из таблицы

export const abilities = [
  {
    id: "torn_wound",
    name: "Рванная рана",
    type: "active",
    icon: "/assets/abilities_icons/torn_wound.webp",
    cooldown: 2,
    target: "enemy",
    damage: [{ type: "physical", formula: "1.5 * attack" }],
    effects: [{ id: "bleeding", duration: 2 }],
    description: "Наносит урон цели и накладывает на нее Кровотечение на 2 хода."
  },
  {
    id: "poison_arrow",
    name: "Ядовитая стрела",
    type: "active",
    icon: "/assets/abilities_icons/poison_arrow.webp",
    cooldown: 2,
    target: "enemy",
    damage: [{ type: "physical", formula: "2 * attack" }],
    effects: [{ id: "poison", duration: 2 }],
    description: "Наносит урон цели и накладывает на нее Отравление на 2 хода."
  },
  {
    id: "rat_call",
    name: "Крысиный зов",
    type: "active",
    icon: "/assets/abilities_icons/rat_call.webp",
    cooldown: 3,
    target: "self",
    summon: {
      unitId: "plague_rat",
      source: "https://www.notion.so/27e0dfbf690f809e9c0fc877dd450fea?pvs=21"
    },
    description: "Призывает Чумную крысу."
  },
  {
    id: "dirty_bite",
    name: "Грязный укус",
    type: "active",
    icon: "/assets/abilities_icons/dirty_bite.webp",
    cooldown: 2,
    target: "enemy",
    damage: [{ type: "physical", formula: "1 * attack" }],
    effects: [{ id: "poison", duration: 2 }],
    description: "Наносит урон цели и накладывает на нее Отравление на 2 хода."
  },
  {
    id: "corrupted_flesh",
    name: "Оскверненная плоть",
    type: "passive",
    icon: "/assets/abilities_icons/corrupted_flesh.webp",
    effects: [
      {
        trigger: "on_hit",
        apply: { id: "bleeding", duration: 2, target: "attacker" }
      },
      {
        id: "vampirism_bonus",
        value: 0.5,
        description: "Эффекты вампиризма действуют на 50% сильней."
      }
    ],
    description: "Когда владельца способности атакуют, он накладывает на атакующего Кровотечение. Эффекты вампиризма усиливаются на 50%."
  },
  {
    id: "corruption_gift",
    name: "Дар Осквернения",
    type: "active",
    icon: "/assets/abilities_icons/corruption_gift.webp",
    target: "enemy",
    damage: [{ type: "true", formula: "missingHp" }],
    selfDamage: "maxHp * 0.15",
    description: "Жертвует 15% максимального здоровья и наносит урон врагу, равный недостающему здоровью."
  },
  {
    id: "executioner_strike",
    name: "Казнящий удар",
    type: "active",
    icon: "/assets/abilities_icons/executioner_strike.webp",
    cooldown: 3,
    target: "enemy",
    damage: [{ type: "physical", formula: "1.6 * attack" }],
    effects: [{ id: "bleeding", duration: 2, chance: 0.5 }],
    description: "Наносит урон цели и с вероятностью 50% накладывает на нее Кровотечение на 2 хода."
  },
  {
    id: "intimidation",
    name: "Устрашение",
    type: "active",
    icon: "/assets/abilities_icons/intimidation.webp",
    cooldown: 2,
    target: "allEnemies",
    effects: [{ id: "attack_penalty_minor", duration: 2 }],
    extendsDebuffs: { amount: 1, excludeControl: true },
    classTags: ["defender"],
    unlockTier: 1,
    abilityRole: "control",
    description: "Накладывает Ослабление на всех живых врагов на 2 хода и продлевает уже действующие негативные эффекты, кроме эффектов контроля и Сломленности, на 1 ход."
  },
  {
    id: "meat_whirlwind",
    name: "Мясной вихрь",
    type: "active",
    icon: "/assets/abilities_icons/meat_whirlwind.webp",
    cooldown: 3,
    target: "allEnemies",
    damage: [{ type: "physical", formula: "1.5 * attack" }],
    effects: [{ id: "bleeding", duration: 2, chance: 0.5 }],
    description: "Наносит урон по области, с вероятностью 50% накладывает на всех врагов Кровотечение на 2 хода."
  },
  {
    id: "bloodlust",
    name: "Кровожадность",
    type: "passive",
    icon: "/assets/abilities_icons/bloodlust.webp",
    effects: [
      {
        id: "attack_bonus",
        condition: "targetHasBleeding",
        value: 0.15
      }
    ],
    description: "+15% атаки, если цель под эффектом Кровотечения."
  },
  {
    id: "entangling_net",
    name: "Запутывающая сеть",
    type: "active",
    icon: "/assets/abilities_icons/entangling_net.webp",
    cooldown: 3,
    target: "enemy",
    effects: [{ id: "small_speed_debuff", duration: 2 }],
    description: "Накладывает на противника Малый штраф скорости на 2 хода."
  },
  {
    id: "needle_stab",
    name: "Укол иглой",
    type: "active",
    icon: "/assets/abilities_icons/needle_stab.webp",
    cooldown: 2,
    target: "enemy",
    damage: [{ type: "physical", formula: "1.4 * attack" }],
    effects: [{ id: "small_attack_debuff", duration: 2 }],
    description: "Наносит урон цели и накладывает на нее Малый штраф атаки на 2 хода."
  },
  {
    id: "poisoned_bolt",
    name: "Отравленный болт",
    type: "active",
    icon: "/assets/abilities_icons/poisoned_bolt.webp",
    cooldown: 2,
    target: "enemy",
    damage: [{ type: "physical", formula: "1 * attack" }],
    effects: [
      { id: "poison", duration: 1 },
      { id: "bleeding", duration: 1 }
    ],
    description: "Наносит урон цели и накладывает на нее Отравление и Кровотечение на 1 ход."
  },
  {
    id: "shelter",
    name: "Укрытие",
    type: "passive",
    icon: "/assets/abilities_icons/shelter.webp",
    effects: [{ id: "evasion", duration: "startOfCombat" }],
    description: "В начале боя накладывает на себя благословение Уклонение."
  },
  {
    id: "fire_blast",
    name: "Огненный взрыв",
    type: "active",
    icon: "/assets/abilities_icons/fire_blast.webp",
    cooldown: 3,
    target: "allEnemies",
    damage: [{ type: "fire", formula: "1.5 * attack" }],
    effects: [
      { id: "burn", duration: 3 },
      { id: "blind", duration: 3 }
    ],
    description: "Наносит урон всем врагам и накладывает Горение и Слепоту на 3 хода."
  },
  {
    id: "flaming_shield",
    name: "Пылающий щит",
    type: "active",
    icon: "/assets/abilities_icons/flaming_shield.webp",
    cooldown: 4,
    target: "self",
    effects: [
      {
        id: "shield",
        duration: 2,
        value: 40
      }
    ],
    onShieldBreak: {
      damage: [{ type: "fire", formula: "0.75 * attack" }],
      effects: [{ id: "burn", duration: 2 }],
      target: "allEnemies"
    },
    description: "Накладывает на себя Щит на 2 хода. Когда щит сломается, наносит урон по всем врагам и накладывает Горение."
  },
  {
    id: "inferno",
    name: "Инферно",
    type: "passive",
    icon: "/assets/abilities_icons/inferno.webp",
    effects: [
      {
        trigger: "onLowHealth",
        threshold: 0.3,
        buffs: [
          { id: "attack_bonus", value: 0.3 },
          { id: "cooldown_reduction", value: 1 }
        ]
      }
    ],
    description: "Если здоровье опускается ниже 30%, +30% атаки и перезарядки уменьшаются на 1 ход."
  },
  {
    id: "blood_ritual",
    name: "Кровавый ритуал",
    type: "active",
    icon: "/assets/abilities_icons/blood_ritual.webp",
    cooldown: 3,
    target: "enemy",
    damage: [{ type: "physical", formula: "1.5 * attack" }],
    effects: [
      { id: "bleeding", duration: 3 },
      { id: "weakness", duration: 3 }
    ],
    selfEffects: [
      {
        id: "regeneration",
        value: 0.15,
        duration: 1
      }
    ],
    description: "Наносит урон цели, накладывает Кровотечение и Уязвимость на 3 хода. Накладывает на себя Регенерацию на 1 ход."
  },
  {
    id: "blood_sacrifice",
    name: "Кровавая жертва",
    type: "active",
    icon: "/assets/abilities_icons/blood_sacrifice.webp",
    cooldown: 4,
    target: "enemy",
    damage: [{ type: "physical", formula: "2 * attack" }],
    effects: [{ id: "bleeding", duration: 3 }],
    selfEffects: [{ id: "bleeding", duration: 3 }],
    extra: { stealInitiativePercent: 0.25 },
    description: "Наносит цели урон. Накладывает на себя и на цель Кровотечение на 3 хода. Крадет у цели 25% полоски хода."
  },
  {
    id: "endurance",
    name: "Стойкость",
    type: "active",
    icon: "/assets/abilities_icons/endurance.webp",
    cooldown: 3,
    target: "self",
    effects: [
      { id: "shield", value: "0.30 * maxHp", duration: 3 },
      { id: "phys_def_boost_major", duration: 3 }
    ],
    classTags: ["defender"],
    unlockTier: 1,
    abilityRole: "defense",
    description: "Получает Щит в размере 30% максимального здоровья на 3 хода и Мощное укрепление на 3 хода."
  },
  {
    id: "iron_counter",
    name: "Железный контрудар",
    type: "active",
    icon: "/assets/abilities_icons/iron_counter.webp",
    cooldown: 3,
    target: "self",
    effects: [
      { id: "phys_def_boost_major", duration: 2 },
      { id: "iron_counter", duration: 2 }
    ],
    classTags: ["defender"],
    unlockTier: 1,
    abilityRole: "counter",
    description: "Усиливает защиту и готовит физический контрудар на 2 хода."
  },
  {
    id: "blood_ram",
    name: "Ранящий удар",
    type: "active",
    icon: "/assets/abilities_icons/blood_ram.webp",
    cooldown: 2,
    target: "enemy",
    damage: [{ type: "physical", formula: "1.4 * attack" }],
    effects: [
      {
        id: "bleed",
        duration: 1,
        condition: "duration becomes 2 if caster has Shield"
      }
    ],
    classTags: ["defender"],
    unlockTier: 1,
    abilityRole: "damage",
    description: "Наносит физический урон в размере 140% атаки и накладывает Кровотечение на 1 ход. Если у Защитника есть Щит, длительность Кровотечения увеличивается до 2 ходов."
  },
  {
    id: "shield_bash",
    name: "Защитный удар",
    type: "active",
    icon: "/assets/abilities_icons/shield_bash.webp",
    cooldown: 2,
    target: "enemy",
    damage: [{ type: "physical", formula: "1.05 * attack + 0.2 * currentShield" }],
    effects: [{ id: "stun", duration: 1, chance: 0.35 }],
    selfEffects: [{ id: "shield", value: "0.10 * maxHp", duration: 3 }],
    classTags: ["defender"],
    unlockTier: 1,
    abilityRole: "control",
    description: "Наносит физический урон в размере 105% атаки + 20% текущего Щита. С вероятностью 35% накладывает Оглушение на 1 ход и получает Щит в размере 10% максимального здоровья на 3 хода."
  },
  {
    id: "shield_wave",
    name: "Щитовая волна",
    type: "active",
    icon: "/assets/abilities_icons/shield_wave.webp",
    cooldown: 4,
    target: "allEnemies",
    damage: [{ type: "physical", formula: "0.45 * attack + 0.4 * currentShield" }],
    shieldCost: "50% currentShield",
    classTags: ["defender"],
    unlockTier: 2,
    abilityRole: "damage",
    description: "Наносит всем врагам физический урон, зависящий от текущего Щита и атаки, затем тратит половину Щита."
  },
  {
    id: "arrow_barrage",
    name: "Шквал стрел",
    type: "active",
    icon: "/assets/abilities_icons/arrow_barrage.webp",
    cooldown: 2,
    target: "allEnemies",
    effects: [{ id: "small_speed_buff", target: "self", duration: 2 }],
    damage: [{ type: "physical", formula: "1.4 * attack" }],
    description: "Накладывает на себя Ускорение и затем атакует всех врагов."
  },
  {
    id: "fireball",
    name: "Огненный шар",
    type: "active",
    icon: "/assets/abilities_icons/fireball.webp",
    cooldown: 2,
    target: "enemy",
    damage: [{ type: "magical", school: "fire", formula: "1.7 * magic" }],
    extraDamage: {
      type: "magical",
      school: "fire",
      formula: "0.55 * magic",
      target: "otherEnemies",
      condition: "primary target has burn, shock, freeze, or flame_rune"
    },
    effects: [{ id: "burn", duration: 2 }],
    description: "Наносит выбранной цели магический урон Огнём в размере 190% магической атаки и накладывает Горение на 2 хода. Если цель уже под Горением, Шоком, Заморозкой или Горящей руной, наносит остальным врагам магический урон Огнём в размере 55% магической атаки. Накладывает на заклинателя Магическую слабость на 2 хода."
  },
  {
    id: "chain_lightning",
    name: "Цепная молния",
    type: "active",
    icon: "/assets/abilities_icons/chain_lightning.webp",
    cooldown: 3,
    target: "enemy",
    damage: [{ type: "magical", school: "lightning", formula: "0.85 * magic" }],
    effects: [{ id: "shock", duration: 2 }],
    extraDamage: {
      type: "magical",
      school: "lightning",
      formula: "0.85 * magic",
      target: "otherEnemies",
      effects: [{ id: "shock", duration: 2, chance: 0.55 }]
    },
    description: "Наносит выбранной цели и каждому остальному врагу магический урон Молнией в размере 95% магической атаки. Накладывает Шок на выбранную цель на 2 хода; на остальных — с вероятностью 55% на 2 хода."
  },
  {
    id: "frost_shield",
    name: "Морозный щит",
    type: "active",
    icon: "/assets/abilities_icons/frost_shield.webp",
    cooldown: 3,
    target: "self",
    effects: [{ id: "shield", duration: 2, formula: "25 + 1.0 * magic" }],
    retaliation: {
      trigger: "directAttackWhileShielded",
      chance: 0.35,
      effect: { id: "freeze", duration: 1 },
      fallbackEffect: { id: "speed_penalty_minor", duration: 2, when: "freeze does not apply" }
    },
    description: "Получает Щит прочностью 25 + 100% магической атаки на 2 хода. При попадании по владельцу прямой атакой атакующий с вероятностью 35% получает Заморозку на 1 ход, иначе — Замедление на 2 хода."
  },
  {
    id: "ice_shard",
    name: "Ледяной осколок",
    type: "active",
    icon: "/assets/abilities_icons/ice_shard.webp",
    cooldown: 3,
    target: "enemy",
    damage: [{ type: "magical", school: "ice", formula: "1.1 * magic" }],
    effects: [{ id: "freeze", duration: 1 }],
    fallbackEffect: { id: "speed_penalty_minor", duration: 2, when: "freeze blocked by control immunity" },
    description: "Наносит ледяной урон одной цели и пытается наложить Заморозку. Если контроль заблокирован, снижает скорость цели на 2 хода."
  }
];
