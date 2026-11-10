import { EFFECT_LIBRARY, getEffectDefinition } from './effects';

const renamedEffects = {
  attack_boost_minor: 'Натиск',
  attack_boost_major: 'Мощный натиск',
  attack_penalty_minor: 'Ослабление',
  attack_penalty_major: 'Сильное ослабление',
  phys_def_boost_minor: 'Укрепление',
  phys_def_boost_major: 'Мощное укрепление',
  phys_def_penalty_minor: 'Ослабление защиты',
  phys_def_penalty_major: 'Разрушение защиты',
  speed_boost_minor: 'Ускорение',
  speed_boost_major: 'Сильное ускорение',
  speed_penalty_minor: 'Замедление',
  speed_penalty_major: 'Сильное замедление',
  magic_def_boost_minor: 'Оберег',
  magic_def_boost_major: 'Сильный оберег',
  magic_def_penalty_minor: 'Магическая слабость',
  magic_def_penalty_major: 'Магическая беззащитность',
  magic_attack_boost_minor: 'Магическая мощь',
  magic_attack_boost_major: 'Великая магическая мощь',
  magic_attack_penalty_minor: 'Подавление магии',
  magic_attack_penalty_major: 'Сильное подавление магии',
  vulnerability: 'Уязвимость',
  burn: 'Горение',
  poison: 'Отравление',
  block_blessings: 'Отрицание усилений',
  block_curses: 'Невосприимчивость',
  healing_curse: 'Проклятие исцеления',
  searing_mark: 'Испепеляющее клеймо',
};

const modifierMechanics = {
  attack_boost_minor: ['attack', 1.25],
  attack_boost_major: ['attack', 1.5],
  attack_penalty_minor: ['attack', 0.75],
  attack_penalty_major: ['attack', 0.5],
  phys_def_boost_minor: ['physDef', 1.25],
  phys_def_boost_major: ['physDef', 1.5],
  phys_def_penalty_minor: ['physDef', 0.75],
  phys_def_penalty_major: ['physDef', 0.5],
  speed_boost_minor: ['speed', 1.15],
  speed_boost_major: ['speed', 1.3],
  speed_penalty_minor: ['speed', 0.8],
  speed_penalty_major: ['speed', 0.7],
  magic_def_boost_minor: ['magicDef', 1.25],
  magic_def_boost_major: ['magicDef', 1.5],
  magic_def_penalty_minor: ['magicDef', 0.75],
  magic_def_penalty_major: ['magicDef', 0.5],
  magic_attack_boost_minor: ['magAtk', 1.25],
  magic_attack_boost_major: ['magAtk', 1.5],
  magic_attack_penalty_minor: ['magAtk', 0.75],
  magic_attack_penalty_major: ['magAtk', 0.5],
};

describe('player-facing combat effect terminology', () => {
  test.each(Object.entries(renamedEffects))('%s keeps its ID and resolves as %s', (id, name) => {
    expect(EFFECT_LIBRARY[id]).toMatchObject({ id, name });
    expect(getEffectDefinition(id)).toBe(EFFECT_LIBRARY[id]);
    expect(getEffectDefinition(name)).toBe(EFFECT_LIBRARY[id]);
  });

  test.each(Object.entries(modifierMechanics))('%s keeps its stat multiplier', (id, [stat, value]) => {
    expect(EFFECT_LIBRARY[id].statMultipliers).toEqual({ [stat]: value });
  });

  test('legacy localized names remain input aliases without becoming displayed names', () => {
    expect(getEffectDefinition('Малое Благословение Атаки')).toBe(EFFECT_LIBRARY.attack_boost_minor);
    expect(getEffectDefinition('Слабость')).toBe(EFFECT_LIBRARY.vulnerability);
    expect(getEffectDefinition('Поджог')).toBe(EFFECT_LIBRARY.burn);
    expect(getEffectDefinition('Яд')).toBe(EFFECT_LIBRARY.poison);

    const visibleNames = Object.values(EFFECT_LIBRARY).map(effect => effect.name);
    expect(visibleNames).not.toEqual(expect.arrayContaining([
      'Малое Благословение Атаки',
      'Слабость',
      'Поджог',
      'Яд',
    ]));
  });

  test('corrected tooltips describe the current runtime triggers and exceptions', () => {
    expect(EFFECT_LIBRARY.shock.description).toMatch(/35%.*15%.*магией Молнии.*союзника/);
    expect(EFFECT_LIBRARY.gloom.description).toMatch(/В начале хода.*40%.*10%/);
    expect(EFFECT_LIBRARY.searing_mark.description).toMatch(/В начале хода.*30%.*10%.*игнорирует Щит/);
    expect(EFFECT_LIBRARY.echo.description).toMatch(/получении положительного урона.*25%.*повторно не срабатывает/);
    expect(EFFECT_LIBRARY.control_immunity.description).toMatch(/Оглушение.*Заморозку.*Шок.*Немоту.*Оцепенение/);
    expect(EFFECT_LIBRARY.immortality.description).toMatch(/ниже 1.*чистого типа/);
  });

  test('Blind and Evasion describe their additive hit modifiers without an Accuracy stat', () => {
    expect(EFFECT_LIBRARY.blind.statAdditives).toEqual({ accuracyPenalty: 0.3 });
    expect(EFFECT_LIBRARY.evasion.statAdditives).toEqual({ dodgeBonus: 0.3 });
    expect(EFFECT_LIBRARY.blind.description).toBe(
      'Снижает шанс попадания ослеплённого бойца на 30 процентных пунктов.'
    );
    expect(EFFECT_LIBRARY.evasion.description).toBe(
      'Повышает шанс бойца уклониться от атаки на 30 процентных пунктов.'
    );
    expect(EFFECT_LIBRARY.blind.description).not.toMatch(/Точност/);
    expect(EFFECT_LIBRARY.evasion.description).not.toMatch(/Точност/);
  });

  test('Vampire Mark and Decay explain their current damage rules', () => {
    expect(EFFECT_LIBRARY.vampire_mark.description).toBe(
      'Когда отмеченная цель получает урон, тот, кто нанёс этот урон, восстанавливает здоровье в размере 30% фактически нанесённого урона. Лечение усиливается бонусом вампиризма атакующего.'
    );
    expect(EFFECT_LIBRARY.decay.description).toBe(
      'Накапливает 35% полученного непериодического урона и в конце действия наносит накопленный урон магией смерти, игнорируя 30% магической защиты (до 50% от макс. HP).'
    );
  });
});
