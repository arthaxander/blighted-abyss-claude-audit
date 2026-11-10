import { abilities } from './abilities';
import { ABILITY_LIBRARY } from './abilityPresets';

const definition = name => abilities.find(ability => ability.name === name);

describe('Defender ability shield duration balance', () => {
  test('Endurance keeps its defensive package coherent at three turns', () => {
    const runtime = ABILITY_LIBRARY['Стойкость'];
    const attacker = { hp: 100, maxHp: 100, effects: [], shield: 0 };
    runtime.apply({ attacker, log: () => {} });
    expect(attacker.effects.map(effect => [effect.id, effect.remainingTurns])).toEqual([
      ['shield', 3],
      ['phys_def_boost_major', 3],
    ]);
    expect(attacker.shield).toBe(30);
    expect(runtime.cooldown).toBe(3);
    expect(runtime.damage).toBe(0);
    expect(definition('Стойкость').effects.map(effect => effect.duration)).toEqual([3, 3]);
  });

  test('Shield Bash increases only shield duration, preserving amount, cooldown, and damage formula', () => {
    const runtime = ABILITY_LIBRARY['Удар щитом'];
    expect(runtime.selfEffects({ attacker: { hp: 100, maxHp: 100 } })).toEqual({ id: 'shield', duration: 3, value: 10, target: 'self' });
    expect(runtime.cooldown).toBe(2);
    expect(runtime.damage({ attacker: { attack: 20, shield: 10 } })).toBe(23);
    expect(definition('Защитный удар').selfEffects[0]).toMatchObject({ duration: 3, value: '0.10 * maxHp' });
  });

  test('non-Defender Frost Shield remains unchanged', () => {
    expect(definition('Морозный щит').effects[0].duration).toBe(2);
    const attacker = { hp: 100, maxHp: 100, attack: 10, effects: [], shield: 0 };
    ABILITY_LIBRARY['Морозный щит'].apply({ attacker, log: () => {} });
    expect(attacker.effects.find(effect => effect.id === 'shield').remainingTurns).toBe(2);
  });
});
