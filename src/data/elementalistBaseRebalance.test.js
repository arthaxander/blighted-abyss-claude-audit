import { ABILITY_LIBRARY } from './abilityPresets';
import { createFireElemental } from '../utils/combatUtils';

describe('Elementalist agreed base rebalance', () => {
  test('Blizzard uses the agreed AoE coefficient', () => {
    const ability = ABILITY_LIBRARY['Буран'];
    expect(ability.cooldown).toBe(4);
    expect(ability.damage({ attacker: { magAtk: 100 }, target: { effects: [] } })).toBe(85);
    expect(ability.effect).toMatchObject({ id: 'speed_penalty_major', duration: 2 });
  });

  test.each(['shock', 'charge', 'conductivity'])(
    'Storm Discharge empowers from %s',
    statusId => {
      const ability = ABILITY_LIBRARY['Грозовой разряд'];
      const target = { effects: [{ id: statusId }], turnMeter: 500 };
      expect(ability.damage({ attacker: { magAtk: 100 }, target })).toBe(180);
      ability.apply({ target });
      expect(target.turnMeter).toBe(300);
    }
  );

  test('Storm Discharge stays at 140% without lightning setup', () => {
    const ability = ABILITY_LIBRARY['Грозовой разряд'];
    const target = { effects: [], turnMeter: 500 };
    expect(ability.damage({ attacker: { magAtk: 100 }, target })).toBe(140);
    ability.apply({ target });
    expect(target.turnMeter).toBe(500);
  });

  test('Elemental Echo keeps its base primary-target behavior in the final talent-capable implementation', () => {
    const ability = ABILITY_LIBRARY['Стихийное эхо'];
    expect(ability.damage({ attacker: { magAtk: 100 } })).toBe(130);
    expect(typeof ability.apply).toBe('function');
    expect(ability.effect({ attacker: { _lastElementalSchool: 'fire' } })).toMatchObject({ id: 'burn', duration: 2 });
    expect(ability.effect({ attacker: { _lastElementalSchool: 'ice' } })).toMatchObject({ id: 'freeze', duration: 1 });
    expect(ability.effect({ attacker: { _lastElementalSchool: 'lightning' } })).toMatchObject({ id: 'shock', duration: 1 });
  });
  test('Fire Elemental starts at 50% turn meter and preserves it in its summon template', () => {
    const owner = {
      id: 'elementalist',
      maxHp: 100,
      attack: 20,
      magAtk: 100,
      physDef: 10,
      magicDef: 20,
      speed: 120,
    };
    const elemental = createFireElemental(owner);

    expect(elemental.turnMeter).toBe(500);
    expect(elemental._summonTemplate?.startingTurnMeter).toBe(500);
    expect(elemental).toMatchObject({
      maxHp: 50,
      attack: 4,
      magAtk: 60,
      physDef: 5,
      magicDef: 12,
      speed: 108,
    });
  });

});
