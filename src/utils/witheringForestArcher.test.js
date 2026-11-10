import { createAbilityByName } from '../data/abilityPresets';
import { getEnemyBlueprintByName, createEnemyInstanceByName } from '../data/enemies';
import { addEffect } from './effects';
import { initCombatSession, selectEnemyAction, processEnemyAI } from './combatUtils';

const makeSession = () => {
  const hero = {
    name: 'Проверочный герой', hp: 2000, maxHp: 2000,
    attack: 15, physDef: 0, magicDef: 0, speed: 500,
    abilities: ['Атака'], currentLocation: 'Лес Увядания',
  };
  const archer = createEnemyInstanceByName('Эльфийская лучница');
  return initCombatSession(hero, [archer], { rng: () => 0 });
};

describe('Forest Archer recovery', () => {
  test('authored normal-tier stats, portrait and original ability names', () => {
    expect(getEnemyBlueprintByName('Эльфийская лучница')).toEqual(expect.objectContaining({
      location: 'Лес Увядания', maxHp: 272, hp: 272,
      attack: 19, magAtk: 1, physDef: 7, magicDef: 5,
      speed: 135, portraitKey: 'elven_archer',
      abilityNames: ['Уязвимый выстрел', 'Лес: Прицельный выстрел'],
    }));
    expect(createEnemyInstanceByName('Эльфийская лучница')).toEqual(expect.objectContaining({
      maxHp: 272, hp: 272, attack: 19, speed: 135,
      portraitKey: 'elven_archer', difficultyTier: 'normal',
    }));
  });

  test('vulnerable shot has correct cooldown, physical scaling and two-turn canonical debuff', () => {
    const ability = createAbilityByName('Уязвимый выстрел');
    expect(ability.name).toBe('Уязвимый выстрел');
    expect(ability.cooldown).toBe(2);
    expect(ability.type).toBe('physical');
    expect(ability.damage({ attacker: { attack: 20 } })).toBe(22);
    expect(ability.effect).toEqual({ id: 'vulnerability', duration: 2 });
  });

  test('Forest-only aimed shot does not override the hero ability', () => {
    const forest = createAbilityByName('Лес: Прицельный выстрел');
    const hero = createAbilityByName('Прицельный выстрел');
    expect(forest.name).toBe('Прицельный выстрел');
    expect(forest.cooldown).toBe(3);
    expect(forest.type).toBe('physical');
    expect(forest.damage({ attacker: { attack: 20 }, target: { effects: [] } })).toBe(31);
    expect(forest.damage({ attacker: { attack: 20 }, target: { effects: [{ id: 'vulnerability' }] } })).toBe(39);
    expect(hero).not.toBe(forest);
    expect(hero.damage({ attacker: { attack: 20 }, target: { effects: [] } })).not.toBe(31);
    expect(createAbilityByName('Прицельный выстрел').name).toBe('Прицельный выстрел');
  });

  test('AI applies vulnerability first, then prioritizes aimed shot while vulnerability is active', () => {
    const session = makeSession();
    const archer = session.state.enemies[0];
    const hero = session.state.players[0];
    expect(selectEnemyAction(archer, session)?.ability.name).toBe('Уязвимый выстрел');
    addEffect(hero, { id: 'vulnerability', duration: 2 }, () => {}, archer, { session });
    expect(selectEnemyAction(archer, session)?.ability.name).toBe('Прицельный выстрел');
    archer.abilities.find(ability => ability.name === 'Прицельный выстрел').currentCooldown = 2;
    expect(selectEnemyAction(archer, session)?.ability.name).toBe('Атака');
  });

  test('real enemy turn applies Vulnerability, assigns cooldown and keeps debuff after its own turn', () => {
    const session = makeSession();
    const enemy = session.state.enemies[0];
    const hero = session.state.players[0];
    enemy.turnMeter = 1000;
    processEnemyAI(session);
    expect(hero.effects.some(effect => effect.id === 'vulnerability')).toBe(true);
    expect(enemy.abilities.find(ability => ability.name === 'Уязвимый выстрел').currentCooldown).toBe(2);
  });
});
