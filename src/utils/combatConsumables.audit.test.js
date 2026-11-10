import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { ITEM_DATA, ITEM_LIBRARY } from '../data/items';
import { FIELD_CONSUMABLES } from '../data/fieldConsumables';
import { addEffect } from './effects';
import { applyItemInCombat, initCombatSession } from './combatUtils';

const enemy = (name = 'Манекен') => ({ name, hp: 500, maxHp: 500, attack: 1, physDef: 0, magicDef: 0, boss: true });
const useItem = (itemName, setup = () => {}, options = {}) => {
  const session = initCombatSession({ name: 'Герой', hp: 50, maxHp: 100, attack: 20, magAtk: 20, critChance: 0, items: [itemName], abilities: [ABILITY_LIBRARY.Атака] }, [enemy(), enemy('Манекен 2')]);
  session.state.initiative.playerReady = true;
  setup(session.state.players[0], session);
  return applyItemInCombat(session, itemName, options).session;
};

const effect = (unit, id) => unit.effects.find(entry => entry.id === id);

describe('canonical consumable runtime audit', () => {
  test('canonical data enumerates every implemented consumable', () => {
    const canonical = ITEM_DATA.filter(item => item.type === 'consumable').map(item => item.name).sort();
    expect(new Set(canonical).size).toBe(canonical.length);
    expect(canonical).toEqual(expect.arrayContaining([
      'Зелье здоровья', 'Защитный настой', 'Очищающий состав', 'Кровяная повязка',
      'Кровяная припарка', 'Настой горькой живицы', 'Настой последней весны',
      'Свиток Конус льда', 'Свиток Ядовитого облака', 'Свиток цепких корней',
    ]));
    FIELD_CONSUMABLES.forEach(entry => {
      expect(canonical).toContain(entry.name);
      expect(ITEM_LIBRARY[entry.name]).toBeDefined();
    });
    expect(canonical).not.toContain('Усиленное зелье щита');
    ITEM_DATA
      .filter(item => item.type === 'consumable' && item.usableInCombat !== false)
      .forEach(item => expect(ITEM_LIBRARY[item.name]).toBeDefined());
  });

  test.each([
    ['Малое зелье защиты', 'phys_def_boost_minor', 2],
    ['Малое зелье регенерации', 'regeneration', 2],
    ['Малое зелье атаки', 'attack_boost_minor', 2],
    ['Малое зелье щита', 'shield', 2],
    ['Малое зелье магической силы', 'magic_attack_boost_minor', 2],
    ['Малое зелье скорости', 'speed_boost_minor', 2],
    ['Малое зелье антимагии', 'magic_def_boost_minor', 2],
  ])('%s applies its canonical status and duration', (itemName, effectId, duration) => {
    const session = useItem(itemName);
    expect(effect(session.state.players[0], effectId)).toMatchObject({ remainingTurns: duration });
  });

  test('health and healing scroll values execute exactly', () => {
    expect(useItem('Малое зелье здоровья').state.players[0].hp).toBe(85);
    const healing = useItem('Свиток Лечения');
    expect(healing.state.players[0].hp).toBe(90);
    expect(effect(healing.state.players[0], 'regeneration')).toMatchObject({ remainingTurns: 2 });
  });

  test('cleansing potion removes exactly one whole removable debuff', () => {
    const session = useItem('Малое зелье очищения', player => {
      addEffect(player, { id: 'bleed', duration: 3 });
      addEffect(player, { id: 'poison', duration: 3 });
      addEffect(player, { id: 'regeneration', duration: 3 });
    }, { rng: () => 0 });
    expect(session.state.players[0].effects.map(entry => entry.id)).toEqual(expect.arrayContaining(['poison', 'regeneration']));
    expect(session.state.players[0].effects.map(entry => entry.id)).not.toContain('bleed');
  });

  test('combat scrolls execute every documented target and status mechanic', () => {
    const fireball = useItem('Свиток Огненного шара');
    expect(fireball.state.enemies[0].hp).toBeLessThan(500);
    expect(effect(fireball.state.enemies[0], 'burn')).toMatchObject({ remainingTurns: 2 });
    expect(effect(fireball.state.players[0], 'magic_def_penalty_minor')).toBeUndefined();

    const ice = useItem('Свиток Конус льда');
    expect(ice.state.enemies[0].hp).toBeLessThan(500);
    expect(effect(ice.state.enemies[0], 'speed_penalty_major')).toMatchObject({ remainingTurns: 2 });
    expect(effect(ice.state.enemies[1], 'speed_penalty_minor')).toMatchObject({ remainingTurns: 2 });

    const poison = useItem('Свиток Ядовитого облака');
    poison.state.enemies.forEach(target => {
      expect(target.hp).toBeLessThan(500);
      expect(effect(target, 'poison')).toMatchObject({ remainingTurns: 2 });
    });

    const blood = useItem('Свиток Кровавого касания');
    expect(blood.state.enemies[0].hp).toBeLessThan(500);
    expect(effect(blood.state.enemies[0], 'vampire_mark')).toMatchObject({ remainingTurns: 2 });
    expect(effect(blood.state.enemies[0], 'bleed')).toMatchObject({ remainingTurns: 1 });
    expect(blood.state.players[0].hp).toBeGreaterThan(50);
  });
});
