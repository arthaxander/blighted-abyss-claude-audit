import { createProductionFreshCharacter } from './characterFactory';
import { CLASS_XP_THRESHOLDS, grantClassExperience } from '../data/classProgression';

test('a newly created character starts at full progressed class health',()=>{
 const progression=grantClassExperience({},'Defender',CLASS_XP_THRESHOLDS[19]).progression;
 const player=createProductionFreshCharacter({classId:'Defender',classProgression:progression});
 expect(player.maxHp).toBe(220);expect(player.hp).toBe(220);expect(player.attack).toBeGreaterThanOrEqual(20);
});
