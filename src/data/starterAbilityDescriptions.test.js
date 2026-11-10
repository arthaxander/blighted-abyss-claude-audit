import { ABILITY_LIBRARY } from './abilityPresets';

const auditedAbilities = {
  Defender: ['Стойкость', 'Кровавый таран', 'Устрашение', 'Удар щитом'],
  Elementalist: ['Заряд стихий', 'Огненный шар', 'Цепная молния', 'Морозный щит', 'Ледяное копьё'],
  Archer: ['Сквозные раны', 'Зазубренная стрела', 'Огненная стрела', 'Добивающий выстрел', 'Быстрый перехват'],
};

const statusIds = ability => (ability.descriptionParts || [])
  .filter(part => typeof part === 'object')
  .map(part => part.statusId);

describe('starter class player-facing ability descriptions', () => {
  test('all 14 audited descriptions are serializable, bracket-free, and reconstruct exactly', () => {
    expect(Object.values(auditedAbilities).flat()).toHaveLength(14);
    Object.values(auditedAbilities).flat().forEach(name => {
      const ability = ABILITY_LIBRARY[name];
      expect(ability.description).not.toMatch(/[\[\]]/);
      expect(ability.descriptionParts).toBeDefined();
      expect(ability.descriptionParts.map(part => typeof part === 'string' ? part : part.text).join(''))
        .toBe(ability.description);
      expect(() => JSON.stringify(ability.descriptionParts)).not.toThrow();
    });
  });

  test('Defender descriptions expose current shield, damage, control, and extension values', () => {
    const endurance = ABILITY_LIBRARY['Стойкость'];
    expect(endurance).toMatchObject({ cooldown: 3, targeting: 'self' });
    expect(endurance.description).toMatch(/35%.*3 хода.*Мощное укрепление.*3 хода/);
    expect(statusIds(endurance)).toEqual(['shield', 'phys_def_boost_major']);

    const ram = ABILITY_LIBRARY['Кровавый таран'];
    expect(ram.damage({ attacker: { attack: 100 } })).toBe(140);
    expect(ram.effect({ attacker: { shield: 0 } }).duration).toBe(1);
    expect(ram.effect({ attacker: { shield: 1 } }).duration).toBe(2);
    expect(ram.description).toContain('2 заряда, если перед атакой был Щит');
    expect(statusIds(ram)).toEqual(['bleed', 'shield']);

    expect(ABILITY_LIBRARY['Устрашение']).toMatchObject({ cooldown: 2, targeting: 'allEnemies' });
    expect(ABILITY_LIBRARY['Устрашение'].description).toMatch(/Ослабление.*2 хода.*кроме эффектов контроля и Сломленности.*1 ход/);

    const bash = ABILITY_LIBRARY['Удар щитом'];
    expect(bash.damage({ attacker: { attack: 100, shield: 50 } })).toBe(115);
    expect(bash.effect).toMatchObject({ id: 'stun', duration: 1, chance: 0.35 });
    expect(bash.selfEffects({ attacker: { maxHp: 100 } })).toMatchObject({ id: 'shield', duration: 3, value: 12 });
  });

  test('Elementalist descriptions expose current elemental formulas without duplicating status rules', () => {
    const fireball = ABILITY_LIBRARY['Огненный шар'];
    expect(fireball.damage({ attacker: { magAtk: 100 } })).toBe(140);
    expect(fireball.secondary.damage({ attacker: { magAtk: 100 } })).toBe(35);
    expect(fireball.secondary).toMatchObject({ target: 'otherEnemies', type: 'magical', school: 'fire' });
    expect(fireball.description).toContain('остальным врагам магический урон Огнём в размере 35% магической атаки');
    expect(fireball.effect).toMatchObject({ id: 'burn', duration: 2 });
    expect(fireball.selfEffects).toBeUndefined();

    const lightning = ABILITY_LIBRARY['Цепная молния'];
    expect(lightning.damage({ attacker: { magAtk: 100 } })).toBe(95);
    expect(lightning.secondary.damage({ attacker: { magAtk: 100 } })).toBe(95);
    expect(lightning.secondary.effects({ attacker: { magAtk: 100 } })).toMatchObject({ id: 'shock', duration: 2, chance: 0.55 });

    const frost = ABILITY_LIBRARY['Морозный щит'];
    expect(frost).toMatchObject({ cooldown: 3, targeting: 'self' });
    expect(frost.description).toMatch(/25 \+ 100%.*2 хода.*попадании.*прямой атакой.*35%.*Заморозку.*1 ход.*иначе — Замедление.*2 хода/);

    const rune = ABILITY_LIBRARY['Ледяное копьё'];
    expect(rune.damage({ attacker: { magAtk: 100 } })).toBe(120);
    expect(rune.description).toMatch(/120% магической атаки.*Льда.*Заморозку.*Ледяной осколок/);
    expect(statusIds(rune)).toEqual(['freeze', 'freeze', 'ice_shards']);
    const chaos = ABILITY_LIBRARY['Заряд стихий'];
    expect(chaos.description).toMatch(/1 заряд.*На втором заряде.*75%.*20%.*30%/);
    expect(statusIds(chaos)).toEqual(['shield']);
  });

  test('Archer descriptions expose current conditions without an Accuracy concept', () => {
    const serrated = ABILITY_LIBRARY['Зазубренная стрела'];
    expect(serrated.damage({ attacker: { attack: 100 } })).toBe(130);
    expect(serrated.effect).toMatchObject({ id: 'bleed', duration: 2 });

    const fireArrow = ABILITY_LIBRARY['Огненная стрела'];
    expect(fireArrow.damage({ attacker: { attack: 100 } })).toBe(100);
    expect(fireArrow.effect({ attacker: { attack: 100 } })).toMatchObject({ id: 'burn', duration: 2, sourceScaling: 100 });
    expect(fireArrow.description).toMatch(/100% атаки физическим уроном.*40% атаки магическим уроном Огнём.*Горение на 2 хода/);
    expect(statusIds(fireArrow)).toEqual(['burn']);

    const finishing = ABILITY_LIBRARY['Добивающий выстрел'];
    expect(finishing.damage({ attacker: { attack: 100 }, target: { hp: 51, maxHp: 100 } })).toBe(150);
    expect(finishing.damage({ attacker: { attack: 100 }, target: { hp: 50, maxHp: 100 } })).toBe(300);
    expect(finishing.damage({ attacker: { attack: 100 }, target: { hp: 49, maxHp: 100 } })).toBe(300);
    expect(finishing.description).toMatch(/150%.*50% здоровья или меньше.*урон удваивается/);
    expect(finishing.description).not.toContain('итоговый урон');

    const intercept = ABILITY_LIBRARY['Быстрый перехват'];
    expect(intercept.damage({ attacker: { attack: 100 }, target: { turnMeter: 499 } })).toBe(150);
    expect(intercept.damage({ attacker: { attack: 100 }, target: { turnMeter: 500 } })).toBe(120);
    expect(intercept.cooldown).toBe(3);
    expect(intercept.description).toMatch(/120% атаки.*25% шкалы.*меньше 50%.*150% атаки.*крадёт 15%/);
    const piercing = ABILITY_LIBRARY['Сквозные раны'];
    expect(piercing.description).toMatch(/прямая атака Лучника.*избыточный урон.*случайного живого врага/);
    expect(piercing.description).not.toMatch(/прицельные|открытое/);
    expect(statusIds(piercing)).toEqual([]);
  });
});
