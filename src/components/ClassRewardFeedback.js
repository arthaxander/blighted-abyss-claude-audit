import React, { useEffect, useRef, useState } from 'react';
import { createAbilityByName } from '../data/abilityPresets';
import { COMBAT_ART_FALLBACKS, applyCombatArtFallback, resolveAbilityIcon, resolvePassiveIcon } from '../data/combatAssets';
import './ClassRewardFeedback.css';
import { getClassPassiveById } from '../data/classProgression';

export const CLASS_REWARD_FEEDBACK_TIMING = Object.freeze({ appear: 250, holdEnd: 1700, lifetime: 2000 });

const pointWord = amount => amount === 1 ? 'очко' : amount >= 2 && amount <= 4 ? 'очка' : 'очков';

export const createClassRewardEvent = classResult => {
  if (!(classResult?.levelsGained > 0)) return null;
  const skills = (classResult.newlyAvailableSkills || []).filter(Boolean);
  const classPoints = Math.max(0, classResult.classPointsGained || 0);
  const passiveSkills = (classResult.newlyAvailablePassives || []).map(id => getClassPassiveById(classResult.classId || 'Defender', id)).filter(Boolean);
  const passiveSlots = [...new Set(classResult.newlyUnlockedPassiveSlots || [])];
  return skills.length || passiveSkills.length || passiveSlots.length || classPoints ? { skills, passiveSkills, passiveSlots, classPoints } : null;
};

const ClassRewardFeedback = ({ event, onClose }) => {
  const [phase, setPhase] = useState('appearing');
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const meaningful = Boolean(event?.skills?.length || event?.passiveSkills?.length || event?.passiveSlots?.length || event?.classPoints > 0);
  useEffect(() => {
    if (!meaningful) return undefined;
    setPhase('appearing');
    const timers = [
      setTimeout(() => setPhase('visible'), CLASS_REWARD_FEEDBACK_TIMING.appear),
      setTimeout(() => setPhase('exiting'), CLASS_REWARD_FEEDBACK_TIMING.holdEnd),
      setTimeout(() => onCloseRef.current?.(), CLASS_REWARD_FEEDBACK_TIMING.lifetime),
    ];
    const blockInput = inputEvent => {
      if (inputEvent.type === 'keydown' && !['Enter', ' '].includes(inputEvent.key)) return;
      inputEvent.preventDefault();
      inputEvent.stopPropagation();
    };
    document.addEventListener('click', blockInput, true);
    document.addEventListener('pointerdown', blockInput, true);
    document.addEventListener('keydown', blockInput, true);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('click', blockInput, true);
      document.removeEventListener('pointerdown', blockInput, true);
      document.removeEventListener('keydown', blockInput, true);
    };
  }, [event, meaningful]);
  if (!meaningful) return null;
  return <div className={`class-reward-feedback-layer is-${phase}`} role="status" data-phase={phase}>
    <section className="class-reward-feedback guild-accent-panel" aria-label="Новые возможности">
      <h2>{event.skills.length === 1 && !event.classPoints ? 'Новый навык' : 'Новые возможности'}</h2>
      {event.skills.map(skillId => {
        const ability = createAbilityByName(skillId);
        return <div className="class-reward-feedback__skill" key={skillId}>
          <img src={resolveAbilityIcon(ability) || COMBAT_ART_FALLBACKS.ability} alt="" draggable="false" onError={error => applyCombatArtFallback(error, COMBAT_ART_FALLBACKS.ability)} />
          <div><strong>{ability.name || skillId}</strong><small>Доступен для изучения в Гильдии</small></div>
        </div>;
      })}
      {event.passiveSlots?.map(slot => <div className="class-reward-feedback__points" key={`slot-${slot}`}>{slot === 1 ? 'Открыт слот пассивного навыка' : 'Открыт второй слот пассивного навыка'}</div>)}
      {event.passiveSkills?.map(passive => <div className="class-reward-feedback__skill is-passive" key={passive.id}>
        <img src={resolvePassiveIcon(passive) || COMBAT_ART_FALLBACKS.ability} alt="" draggable="false" onError={error => applyCombatArtFallback(error, COMBAT_ART_FALLBACKS.ability)} />
        <div><strong>{passive.name}</strong><small>Доступен для изучения в Гильдии</small></div>
      </div>)}
      {event.classPoints > 0 && <div className="class-reward-feedback__points">+{event.classPoints} {pointWord(event.classPoints)} класса</div>}
    </section>
  </div>;
};

export default ClassRewardFeedback;
