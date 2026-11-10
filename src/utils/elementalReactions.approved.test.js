import { ABILITY_LIBRARY } from '../data/abilityPresets';
import { addEffect } from './effects';
import { applyDamage, initCombatSession, performPlayerAction } from './combatUtils';

const unit = (name, maxHp=100) => ({ name, hp:maxHp, maxHp, physDef:0, magicDef:0, turnMeter:500, effects:[] });
const mage = (passives=[]) => ({ name:'Маг', class:'Mage', hp:100, maxHp:100, magAtk:100, attack:1, speed:100, critChance:0, abilities:[ABILITY_LIBRARY['Огненный шар'],ABILITY_LIBRARY['Цепная молния']], equippedClassPassiveIds:passives });
const sessionFor = (targets, passives=[]) => initCombatSession(mage(passives), targets);
const add = (target,id,source,session) => addEffect(target,{id,duration:2},jest.fn(),source,{session});
describe('Elementalist statuses after replacing reactions with charges',()=>{
  test.each([
    ['Огненный шар', 'shock'], ['Огненный шар', 'charge'],
    ['Цепная молния', 'burn'], ['Цепная молния', 'charring'],
  ])('%s preserves an existing %s instead of consuming another school', (abilityName, effectId) => {
    const session=sessionFor([unit('Main',1000)]);
    const source=session.state.players[0],target=session.state.enemies[0];
    add(target,effectId,source,session);
    session.state.initiative.playerReady=true;
    performPlayerAction(session,abilityName,0);
    expect(target.effects.some(effect=>effect.id===effectId)).toBe(true);
    expect(session.state.log.some(line=>line.includes('Реакция стихий'))).toBe(false);
  });

  test('Fireball secondary packet does not trigger a reaction on a secondary target', () => {
    const session = sessionFor([unit('Main', 1000), unit('Secondary', 1000)]);
    const source = session.state.players[0];
    const [main, secondary] = session.state.enemies;
    add(main, 'burn', source, session); // prepares the authored splash
    add(secondary, 'shock', source, session);
    session.state.initiative.playerReady = true;
    performPlayerAction(session, 'Огненный шар', 0);
    expect(secondary.effects.some(effect => effect.id === 'shock')).toBe(true);
    expect(secondary.effects.some(effect => effect.id === 'burn')).toBe(false);
  });

  test('normal Fireball and Fireball Scroll runtime never self-apply Magic Weakness',()=>{
    const run = () => { const session=sessionFor([unit('Target',500)]); session.state.initiative.playerReady=true; performPlayerAction(session,'Огненный шар',0); return session.state.players[0]; };
    expect(run().effects.some(e=>e.id==='magic_def_penalty_minor')).toBe(false);
    expect(ABILITY_LIBRARY['Огненный шар'].selfEffects).toBeUndefined();
  });
});
