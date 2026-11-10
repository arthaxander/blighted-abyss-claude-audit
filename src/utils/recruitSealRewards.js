import { ITEM_DATA } from '../data/items';
import { COMMON_LEVEL_ONE_MATERIALS, LOCATION_LEVEL_ONE_MATERIALS } from '../data/levelOneLootOwnership';
import { DEFAULT_RELIC_ID, ensureRelicState, getRelicBonuses } from '../data/relics';
const EXCLUDED_SOURCES = new Set(['boss','relic','quest','purchase','craft','insurance','starting-loadout','system']);
export const getRecruitSealExtraLootPool = location => {
  if (!Object.prototype.hasOwnProperty.call(LOCATION_LEVEL_ONE_MATERIALS, location)) return [];
  const materials=[...COMMON_LEVEL_ONE_MATERIALS,...(LOCATION_LEVEL_ONE_MATERIALS[location]||[])];
  const consumables=ITEM_DATA.filter(item=>item.type==='consumable'&&!item.fieldUse?.special && (item.chestChance||item.enemyChance)).map(item=>item.name);
  return [...new Set([...materials,...consumables])];
};
export const rollRecruitSealExtraLoot = ({player,location,source='ordinary',rng=Math.random}={}) => {
  const relics=ensureRelicState(player?.relics);const level=relics.progress?.[DEFAULT_RELIC_ID]?.level||0;
  const chance=relics.activeRelicId===DEFAULT_RELIC_ID?getRelicBonuses(DEFAULT_RELIC_ID,level).extraLootChance:0;
  if(!chance||EXCLUDED_SOURCES.has(source)) return {triggered:false,item:null,reason:!chance?'relic-level':'excluded-source'};
  if(rng()>=chance)return {triggered:false,item:null,reason:'chance-failed'};
  const pool=getRecruitSealExtraLootPool(location);if(!pool.length)return {triggered:false,item:null,reason:'empty-pool'};
  return {triggered:true,item:{name:pool[Math.floor(rng()*pool.length)],quantity:1},reason:null};
};
