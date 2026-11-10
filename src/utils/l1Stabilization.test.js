import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { createEnemyInstanceByName, getEnemyBlueprintByName } from '../data/enemies';
import { applyDamage } from './combatUtils';

describe('Level-1 stabilization tuning', () => {
  test.each([
    ['Одичавший троглодит', 106, 26],
    ['Костестраж', 142, 23],
    ['Змеиный двоеглав', 136, 25],
  ])('%s has exact authored and final Strong stats', (name, maxHp, attack) => {
    expect(getEnemyBlueprintByName(name)).toMatchObject({ maxHp, attack, encounterPhase: 'late' });
    expect(createEnemyInstanceByName(name)).toMatchObject({ maxHp, attack, difficultyTier: 'normal' });
  });

  test('both L1 Distortion enemies reach their final offense and exact named multipliers', () => {
    const breaker = createEnemyInstanceByName('Искажённый гоблин-кристаллолом');
    const totemist = createEnemyInstanceByName('Искажённый троглодит-тотемщик');
    expect(breaker.attack).toBe(42);
    expect(totemist.magAtk).toBe(40);
    expect(ABILITY_LIBRARY['Кристальный удар'].damage({ attacker: { attack: 100 } })).toBe(165);
    expect(ABILITY_LIBRARY['Осколочный рывок'].damage({ attacker: { attack: 100 } })).toBe(145);
    expect(ABILITY_LIBRARY['Призматический удар'].damage({ attacker: { magAtk: 100 } })).toBe(165);
    ['Кристальный удар', 'Осколочный рывок', 'Призматический удар'].forEach(name => {
      expect(ABILITY_LIBRARY[name].shieldDamageMultiplier).toBe(1.75);
      expect(ABILITY_LIBRARY[name].descriptionParts).toContainEqual(expect.objectContaining({ statusId: 'shield' }));
    });
  });

  test('1.75x Shield damage never overflows its bonus into HP', () => {
    const thickShield = { name: 'Цель', hp: 100, maxHp: 100, shield: 30, physDef: 0, magicDef: 0, effects: [] };
    applyDamage(thickShield, 20, 'physical', { shieldDamageMultiplier: 1.75 });
    expect(thickShield).toMatchObject({ hp: 100, shield: 0, lastShieldDamage: 30 });

    const thinShield = { name: 'Цель', hp: 100, maxHp: 100, shield: 10, physDef: 0, magicDef: 0, effects: [] };
    applyDamage(thinShield, 20, 'physical', { shieldDamageMultiplier: 1.75 });
    expect(thinShield).toMatchObject({ hp: 90, shield: 0, lastShieldDamage: 10 });

    const basic = { name: 'Цель', hp: 100, maxHp: 100, shield: 30, physDef: 0, magicDef: 0, effects: [] };
    applyDamage(basic, 20, 'physical');
    expect(basic).toMatchObject({ hp: 100, shield: 10, lastShieldDamage: 20 });
  });

  test('Mycelium remains at 700 HP while reaching 50 MagAtk and 110 Speed', () => {
    const blueprint = getEnemyBlueprintByName('Троглодит-мицелий (босс)');
    const boss = createEnemyInstanceByName('Троглодит-мицелий (босс)');
    expect(blueprint).toMatchObject({ maxHp: 400, magAtk: 37, speed: 100 });
    expect(boss).toMatchObject({ maxHp: 700, magAtk: 50, speed: 110 });
    expect(ABILITY_LIBRARY['Споровой выброс'].damage({ attacker: { magAtk: 100 } })).toBe(120);
    expect(ABILITY_LIBRARY['Грибная сеть'].damage({ attacker: { magAtk: 100 } })).toBe(120);
    expect(ABILITY_LIBRARY['Споровой паралич'].damage({ attacker: { magAtk: 100 } })).toBe(165);
    expect(boss.maxHp * 0.5).toBe(350);
    expect(Math.round(boss.maxHp * 0.08)).toBe(56);
  });
});
