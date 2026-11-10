// Simulator-only descriptions of visible authored mechanics. Production effects remain authoritative.
export const SIMULATION_BOSS_MECHANICS = Object.freeze({
  'Пепельный Колпак Рагшнар': Object.freeze({
    id: 'ragshnar', authoredAbilities: ['Инферно', 'Пылающий щит', 'Огненный взрыв'], controlImmune: true,
    phases: [{ hpAtOrBelow: 0.3, visibleEffect: 'attack_boost_minor' }], telegraphs: [], interrupt: null,
    defensiveLayers: [{ visibleEffect: 'shield', durability: 40, onBreak: 'fire-retaliation-and-burn' }], summons: [], dangerousStatuses: ['burn', 'blind'], vulnerabilityWindows: ['shield-expired'], reactions: ['burn-grants-speed', 'first-30%-hp-enrage'], reservationAdvice: ['defense-or-healing-for-visible-enrage'],
    mechanics: ['burn-speed-synergy', 'breakable-retaliating-shield', 'low-hp-enrage', 'aoe-burn-blind'], approximate: ['retaliating-shield expected damage'], unknown: [],
  }),
  'Троглодит-мицелий (босс)': Object.freeze({
    id: 'mycelium', authoredAbilities: ['Споровой выброс', 'Грибная сеть', 'Споровой паралич', 'Сжатие мицелия', 'Мицелиевое питание'], controlImmune: true,
    phases: [{ hpAtOrBelow: 0.5, visibleFlag: '_myceliumPhaseTwoTriggered' }], telegraphs: [], interrupt: null, defensiveLayers: [], summons: [], dangerousStatuses: ['poison'], vulnerabilityWindows: ['phase-two-disables-feeding'], reactions: ['poisoned-hero-heals-boss-in-phase-one', 'phase-two-speed-and-magic-power'], reservationAdvice: ['cleanse-for-visible-poison', 'defense-for-phase-two-burst'],
    mechanics: ['poison-fed-healing', 'phase-two-burst', 'turn-meter-loss', 'aoe-poison'], approximate: ['poison cleanse prevention value'], unknown: [],
  }),
  'Мастер клинков': Object.freeze({
    id: 'blade_master', authoredAbilities: ['Точный выпад', 'Серия клинков', 'Школа клинка', 'Нарушенная клятва'], controlImmune: true,
    phases: [{ hpAtOrBelow: 0.5, visiblePreparation: 'blade_dance' }], telegraphs: ['blade_dance'], interrupt: { visibleField: '_preparation', durability: 80, response: 'direct-damage' }, defensiveLayers: [], summons: [], dangerousStatuses: [], vulnerabilityWindows: ['preparation-broken'], reactions: ['three-attack-rhythm-starts-preparation', 'half-hp-forces-preparation'], reservationAdvice: ['save-high-damage-action-for-visible-preparation'],
    mechanics: ['attack-rhythm', 'telegraphed-blade-dance', '80-durability-interrupt', 'half-hp-forced-preparation'], approximate: [], unknown: [],
  }),
});

export const getVisibleBossMechanic = enemy => SIMULATION_BOSS_MECHANICS[enemy?.name] || null;

export const BOSS_EVALUATOR_COVERAGE = Object.freeze({
  authoredBosses: Object.keys(SIMULATION_BOSS_MECHANICS),
  fullyScoredPlayerAbilities: ['attack', 'fireball', 'ice_lance', 'storm_discharge', 'blizzard'],
  approximatePlayerAbilities: ['frost_shield', 'elemental_echo', 'endurance', 'redirect', 'shockwave', 'ram', 'shield_throw', 'serrated_arrow', 'wolf_pit', 'arrow_volley'],
  unknownFunctionAuthoredAbilities: ['summon and passive callbacks without visible numeric metadata'],
});
