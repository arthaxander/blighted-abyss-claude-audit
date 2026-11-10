import React, { useEffect, useMemo, useState } from 'react';
import {
  ACTIVE_SKILL_SLOT_COUNT,
  CLASS_PROGRESSION_DEFINITIONS,
  assignClassSkill,
  assignClassPassive,
  ensureClassProgression,
  getClassPassiveById,
  getPassiveSlotCount,
  getClassXpProgress,
  swapClassSkillSlots,
  setClassPassiveSlots,
  selectClassTalent,
} from '../data/classProgression';
import * as classTalents from '../data/classTalents.mjs';
import { createAbilityByName } from '../data/abilityPresets';
import {
  COMBAT_ART_FALLBACKS,
  applyCombatArtFallback,
  resolveAbilityIcon,
  resolvePassiveIcon,
  resolvePlayerPortrait,
} from '../data/combatAssets';
import NestedActionOverlay from './NestedActionOverlay';
import { GameTermText } from './GameTermHelp';
import PickerActionFooter from './PickerActionFooter';
import { GAMEPLAY_DRAG_ACTIVATION_DISTANCE } from '../constants/interaction';
import './ClassProgressionPanel.css';

const { CLASS_TALENT_SETS, TALENT_BY_ID } = classTalents;

export const getClassSkillDisplayName = skillId => createAbilityByName(skillId).name || skillId;

const SkillArt = ({ skillId, large = false }) => {
  const ability = createAbilityByName(skillId);
  return <img
    className={large ? 'class-skill-art is-large' : 'class-skill-art'}
    src={resolveAbilityIcon(ability) || COMBAT_ART_FALLBACKS.ability}
    alt=""
    draggable="false"
    onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.ability)}
  />;
};

const SkillTile = ({ skillId, slot, state, requirement, onClick, onPointerDown, dragClass = '', activeSlotIndex = null }) => {
  const name = getClassSkillDisplayName(skillId);
  const stateLabel = state === 'locked' ? `Закрыт до уровня ${requirement}` : state === 'active' ? `Активный слот ${slot}` : 'Открыт';
  return <button
    type="button"
    className={`class-skill-tile is-${state}${dragClass}`}
    aria-label={`${name}. ${stateLabel}`}
    aria-pressed={state === 'active'}
    onClick={onClick}
    onPointerDown={onPointerDown}
    data-active-slot-index={activeSlotIndex ?? undefined}
    data-skill-id={skillId}
    data-skill-state={state}
    data-loadout-draggable={Boolean(onPointerDown)}
  >
    <SkillArt skillId={skillId} />
    {state === 'locked' && <span className="class-skill-tile__state" aria-hidden="true">🔒 Ур. {requirement}</span>}
    <span className="class-skill-tile__name">{name}</span>
  </button>;
};

const PassiveArt = ({ passive, large = false }) => <img className={large ? 'class-skill-art is-large' : 'class-skill-art'} src={resolvePassiveIcon(passive) || COMBAT_ART_FALLBACKS.ability} alt="" draggable="false" onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.ability)} />;
const PassiveTile = ({ passive, state, requirement, onClick, onPointerDown, dragClass = '', slotIndex, loadoutSlot = false }) => <button type="button" className={`class-skill-tile class-passive-tile${loadoutSlot ? ' is-loadout-slot' : ''} is-${state}${dragClass}`} aria-label={`${passive.name}. ${state === 'locked' ? `Откроется на уровне ${requirement}` : state === 'active' ? 'Экипирован' : 'Открыт'}`} aria-pressed={state === 'active'} onClick={onClick} onPointerDown={onPointerDown} data-passive-drop-slot={slotIndex ?? undefined} data-passive-drag-source={Boolean(onPointerDown) || undefined} data-passive-id={passive.id} data-passive-state={state} data-loadout-draggable={Boolean(onPointerDown)}><PassiveArt passive={passive} />{!loadoutSlot && state === 'locked' && <span className="class-skill-tile__state" aria-hidden="true">🔒 Ур. {requirement}</span>}{!loadoutSlot && <span className="class-skill-tile__name">{passive.name}</span>}</button>;

const ClassProgressionPanel = ({ player, progression, onUpdateProgression, onMessage, mode: controlledMode, onModeChange, showModeSwitcher = true, talentSets = CLASS_TALENT_SETS, talentRegistry = TALENT_BY_ID }) => {
  const classId = player.class;
  const externalProgression = useMemo(() => ensureClassProgression(progression || player.classProgression, player), [progression, player]);
  const [viewProgression, setViewProgression] = useState(externalProgression);
  const [selectedSkillId, setSelectedSkillId] = useState(null);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [error, setError] = useState('');
  const [dragState, setDragState] = useState(null);
  const [internalMode, setInternalMode] = useState('active');
  const mode = controlledMode ?? internalMode;
  const [selectedPassiveId, setSelectedPassiveId] = useState(null);
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const pointerDragRef = React.useRef(null);
  const suppressClickRef = React.useRef(false);
  useEffect(() => setViewProgression(externalProgression), [externalProgression]);
  useEffect(() => {
    pointerDragRef.current = null;
    setDragState(null);
    setHoveredSlot(null);
  }, [mode]);

  const definition = CLASS_PROGRESSION_DEFINITIONS[classId];
  const record = viewProgression[classId];
  const xp = getClassXpProgress(record);
  const selectedDefinition = definition.skills.find(skill => skill.id === selectedSkillId);
  const selectedAbility = selectedSkillId ? createAbilityByName(selectedSkillId) : null;
  const selectedName = selectedSkillId ? getClassSkillDisplayName(selectedSkillId) : '';
  const selectedUnlocked = Boolean(selectedSkillId && record.unlockedSkillIds.includes(selectedSkillId));
  const selectedActiveSlot = selectedSkillId ? record.activeSkillIds.indexOf(selectedSkillId) : -1;
  const passiveSlotCount = getPassiveSlotCount(classId, record.classLevel);
  const selectedPassive = selectedPassiveId ? getClassPassiveById(classId, selectedPassiveId) : null;
  const selectedTalentSet = talentSets.find(entry => entry.classId === classId && entry.abilityName === selectedSkillId);
  const readyTalents = selectedTalentSet?.talents.filter(talent => talent.combatReady) || [];

  const commit = React.useCallback(nextProgression => {
    setViewProgression(nextProgression);
    onUpdateProgression?.(nextProgression);
  }, [onUpdateProgression]);

  useEffect(() => {
    const resolveSlot = (event, domain) => {
      const selector = domain === 'passive' ? '[data-passive-drop-slot]' : '[data-active-slot-index]';
      const atPoint = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(event.clientX, event.clientY)?.closest?.(selector) : null;
      const direct = domain === 'active' ? event.target?.closest?.(selector) : null;
      const node = atPoint || direct;
      const value = domain === 'passive' ? node?.dataset?.passiveDropSlot : node?.dataset?.activeSlotIndex;
      return value === undefined ? null : Number(value);
    };
    const commitDrop = (pending, targetSlot) => {
      if (targetSlot === null) return;
      let result;
      if (pending.domain === 'passive') {
        const slots = Array.from({ length: passiveSlotCount }, (_, index) => record.equippedPassiveIds[index] || null);
        if (pending.sourceSlot === targetSlot) result = { success: false };
        else if (pending.sourceSlot === null) slots[targetSlot] = pending.skillId;
        else [slots[pending.sourceSlot], slots[targetSlot]] = [slots[targetSlot], slots[pending.sourceSlot]];
        if (!result) result = setClassPassiveSlots(viewProgression, classId, slots);
      } else result = pending.sourceSlot === null ? assignClassSkill(viewProgression, classId, pending.skillId, targetSlot) : swapClassSkillSlots(viewProgression, classId, pending.sourceSlot, targetSlot);
      if (result.success) commit(result.progression);
    };
    const move = event => {
      const pending = pointerDragRef.current;
      if (!pending || (event.pointerId != null && pending.pointerId != null && event.pointerId !== pending.pointerId)) return;
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (!pending.active && distance < GAMEPLAY_DRAG_ACTIVATION_DISTANCE) return;
      if (!pending.active) {
        pending.active = true;
        suppressClickRef.current = true;
      }
      event.preventDefault();
      pending.lastTargetSlot = resolveSlot(event, pending.domain);
      setDragState({ skillId: pending.skillId, sourceSlot: pending.sourceSlot, domain: pending.domain, x: event.clientX, y: event.clientY });
      setHoveredSlot(pending.lastTargetSlot);
    };
    const finish = event => {
      const pending = pointerDragRef.current;
      if (!pending || (event.pointerId != null && pending.pointerId != null && event.pointerId !== pending.pointerId)) return;
      if (pending.active) {
        const targetSlot = resolveSlot(event, pending.domain) ?? pending.lastTargetSlot ?? null;
        commitDrop(pending, targetSlot);
        setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
      pointerDragRef.current = null;
      setDragState(null);
      setHoveredSlot(null);
    };
    const cancel = event => {
      const pending = pointerDragRef.current;
      if (!pending || (event.pointerId != null && pending.pointerId != null && event.pointerId !== pending.pointerId)) return;
      if (pending.active) commitDrop(pending, pending.lastTargetSlot ?? null);
      pointerDragRef.current = null;
      setDragState(null);
      setHoveredSlot(null);
      suppressClickRef.current = false;
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [classId, commit, passiveSlotCount, record.equippedPassiveIds, viewProgression]);

  const beginDrag = (event, skillId, sourceSlot, domain = 'active') => {
    if (event.button != null && event.button !== 0) return;
    pointerDragRef.current = { pointerId: event.pointerId, sourceElement: event.currentTarget, startX: event.clientX, startY: event.clientY, skillId, sourceSlot, domain, active: false };
  };

  const changeMode = nextMode => {
    pointerDragRef.current = null; setDragState(null); setHoveredSlot(null);
    if (controlledMode === undefined) setInternalMode(nextMode);
    onModeChange?.(nextMode);
  };
  const equipPassive = slot => { const result = assignClassPassive(viewProgression, classId, selectedPassiveId, slot); if (!result.success) { setError(result.reason); return; } commit(result.progression); };
  const removePassive = () => { const slots = Array.from({ length: passiveSlotCount }, (_, index) => record.equippedPassiveIds[index] || null); const index = slots.indexOf(selectedPassiveId); if (index >= 0) slots[index] = null; const result = setClassPassiveSlots(viewProgression, classId, slots); if (result.success) commit(result.progression); };

  const openDetails = skillId => {
    if (suppressClickRef.current) return;
    setSelectedSkillId(skillId);
    setError('');
  };
  const openPassiveDetails = passiveId => {
    if (suppressClickRef.current) return;
    setSelectedPassiveId(passiveId);
    setError('');
  };

  const confirmSlot = () => {
    const result = assignClassSkill(viewProgression, classId, selectedSkillId, selectedSlot);
    if (!result.success) { setError(result.reason); onMessage?.(result.reason); return; }
    setError('');
    commit(result.progression);
    setSlotPickerOpen(false);
    setSelectedSlot(null);
  };
  const chooseTalent = talentId => {
    const result = selectClassTalent(viewProgression, classId, selectedTalentSet.abilityId, talentId, { location:'guild', talentRegistry });
    if (!result.success) { setError(result.reason); onMessage?.(result.reason); return; }
    setError(''); commit(result.progression);
  };

  if (!definition || !record) return null;
  return <section className="guild-class-progression" aria-label="Прогресс класса">
    <header className="guild-class-progression__header">
      {resolvePlayerPortrait(player) && <img src={resolvePlayerPortrait(player)} alt="" />}
      <div className="guild-class-progression__identity"><h3>{definition.name}</h3><strong>Ур. {record.classLevel}</strong></div>
    </header>
    {xp.isMaxLevel ? <p className="guild-class-progression__xp-text">Макс. уровень</p> : <>
      <progress max={xp.required} value={xp.current} aria-label="Опыт класса" />
      <p className="guild-class-progression__xp-text">{xp.current} / {xp.required}</p>
    </>}

    {showModeSwitcher && <div className="class-loadout-modes" role="group" aria-label="Тип навыков"><button type="button" className={mode === 'active' ? 'is-selected' : ''} aria-pressed={mode === 'active'} onClick={() => changeMode('active')}>Активные</button><button type="button" className={mode === 'passive' ? 'is-selected' : ''} aria-pressed={mode === 'passive'} onClick={() => changeMode('passive')}>Пассивные</button></div>}

    {mode === 'active' && <div className="class-loadout-domain" data-loadout-domain="active">
    <div className={`guild-class-progression__active${dragState ? ' is-dragging' : ''}`}><h4>Активные навыки</h4>
    <div className="guild-class-progression__slots" aria-label="Активные навыки">
      {Array.from({ length: ACTIVE_SKILL_SLOT_COUNT }, (_, index) => {
        const skillId = record.activeSkillIds[index];
        const dragClass = dragState ? `${dragState.sourceSlot === index ? ' is-drag-source' : ' is-valid-drop-target'}${hoveredSlot === index ? ' is-hovered-drop-target' : ''}` : '';
        return skillId ? <SkillTile key={`${skillId}-${index}`} skillId={skillId} slot={index + 1} state="active" activeSlotIndex={index} dragClass={dragClass} onPointerDown={event => beginDrag(event, skillId, index)} onClick={() => openDetails(skillId)} /> : <div key={index} className={`class-skill-tile is-empty${dragClass}`} data-active-slot-index={index} aria-label={`Пустой активный слот ${index + 1}`} />;
      })}
    </div>
    </div>

    <h4>Навыки класса</h4>
    <div className={`guild-class-progression__skills${dragState?.sourceSlot === null ? ' is-dragging-inactive' : ''}`} aria-label="Навыки класса">
      {definition.skills.map(skill => {
        const unlocked = record.unlockedSkillIds.includes(skill.id);
        const activeSlot = record.activeSkillIds.indexOf(skill.id);
        const state = unlocked ? (activeSlot >= 0 ? 'active' : 'unlocked') : 'locked';
        const draggable = unlocked && activeSlot < 0;
        return <SkillTile key={skill.id} skillId={skill.id} slot={activeSlot >= 0 ? activeSlot + 1 : null} state={state} requirement={skill.requiredLevel} dragClass={dragState?.skillId === skill.id ? ' is-drag-source' : ''} onPointerDown={draggable ? event => beginDrag(event, skill.id, null) : undefined} onClick={() => openDetails(skill.id)} />;
      })}
    </div>

    </div>}

    {mode === 'passive' && <div className="class-loadout-domain class-passive-domain" data-loadout-domain="passive">
      <div className={`guild-class-progression__active${dragState ? ' is-dragging' : ''}`}><h4>Выбранные пассивные навыки</h4><div className="guild-class-progression__passive-slots" aria-label="Пассивные ячейки">
        {[0, 1].map(index => {
          const unlocked = index < passiveSlotCount; const passiveId = record.equippedPassiveIds[index]; const passive = getClassPassiveById(classId, passiveId);
          const dragClass = dragState?.domain === 'passive' && unlocked ? `${dragState.sourceSlot === index ? ' is-drag-source' : ' is-valid-drop-target'}${hoveredSlot === index ? ' is-hovered-drop-target' : ''}` : '';
          if (!unlocked) return <div key={index} className="class-passive-slot is-locked" aria-label={`Пассивная ячейка ${index + 1} закрыта до уровня ${definition.passiveSlotUnlockLevels[index]}`}>🔒 Ур. {definition.passiveSlotUnlockLevels[index]}</div>;
          return passive ? <PassiveTile key={index} passive={passive} state="active" slotIndex={index} loadoutSlot dragClass={dragClass} onPointerDown={event => beginDrag(event, passive.id, index, 'passive')} onClick={() => openPassiveDetails(passive.id)} /> : <div key={index} className={`class-passive-slot is-empty${dragClass}`} data-passive-drop-slot={index} aria-label={`Пустая пассивная ячейка ${index + 1}`}>◇</div>;
        })}
      </div></div>
      <h4>Пассивки класса</h4><div className="guild-class-progression__passives" aria-label="Пассивные навыки">
        {(definition.passiveSkills || []).map(passive => { const unlocked = record.purchasedPassiveIds.includes(passive.id); const activeIndex = record.equippedPassiveIds.indexOf(passive.id); const state = unlocked ? (activeIndex >= 0 ? 'active' : 'unlocked') : 'locked'; const draggable = unlocked && activeIndex < 0; return <PassiveTile key={passive.id} passive={passive} state={state} requirement={passive.requiredLevel} dragClass={dragState?.skillId === passive.id ? ' is-drag-source' : ''} onPointerDown={draggable ? event => beginDrag(event, passive.id, null, 'passive') : undefined} onClick={() => openPassiveDetails(passive.id)} />; })}
      </div>
    </div>}

    {dragState && <div className="class-skill-drag-preview" style={{ left: dragState.x, top: dragState.y }} aria-hidden="true">{dragState.domain === 'passive' ? <PassiveArt passive={getClassPassiveById(classId, dragState.skillId)} /> : <SkillArt skillId={dragState.skillId} />}</div>}

    {selectedPassive && <NestedActionOverlay label={`Пассивный навык: ${selectedPassive.name}`} onClose={() => setSelectedPassiveId(null)} showDefaultCancel={false}><div className="class-skill-details class-passive-details"><h3>{selectedPassive.name}</h3><PassiveArt passive={selectedPassive} large /><GameTermText parts={selectedPassive.descriptionParts} text={selectedPassive.description} /><p>{record.purchasedPassiveIds.includes(selectedPassive.id) ? record.equippedPassiveIds.includes(selectedPassive.id) ? 'Экипирован' : 'Открыт' : `Откроется на Ур. ${selectedPassive.requiredLevel}`}</p>{error && <p className="class-skill-details__error">{error}</p>}{record.purchasedPassiveIds.includes(selectedPassive.id) && !record.equippedPassiveIds.includes(selectedPassive.id) && Array.from({ length: passiveSlotCount }, (_, index) => <button type="button" key={index} className="class-skill-details__primary" onClick={() => equipPassive(index)}>Экипировать в ячейку {index + 1}</button>)}{record.equippedPassiveIds.includes(selectedPassive.id) && <button type="button" className="class-skill-details__primary" onClick={removePassive}>Снять</button>}<button type="button" onClick={() => setSelectedPassiveId(null)}>Закрыть</button></div></NestedActionOverlay>}

    {selectedDefinition && <NestedActionOverlay label={`Навык: ${selectedName}`} onClose={() => { setSelectedSkillId(null); setSlotPickerOpen(false); }} showDefaultCancel={false}>
      <div className="class-skill-details">
        <h3>{selectedName}</h3>
        <SkillArt skillId={selectedSkillId} large />
        <GameTermText parts={selectedAbility.descriptionParts} text={selectedAbility.description} />
        <dl><div><dt>Перезарядка</dt><dd>{selectedAbility.cooldown || 0}</dd></div><div><dt>Состояние</dt><dd>{selectedUnlocked ? (selectedActiveSlot >= 0 ? `Активный слот ${selectedActiveSlot + 1}` : 'Открыт') : `Требуется уровень класса ${selectedDefinition.requiredLevel}`}</dd></div></dl>
        {readyTalents.length > 0 && <section className="class-talent-picker" aria-label="Таланты способности"><h4>Талант · открытие на Ур. {selectedTalentSet.requiredLevel}</h4>{readyTalents.map(talent => { const selected = record.talentSelections?.[selectedTalentSet.abilityId] === talent.id; const available = selectedUnlocked && record.classLevel >= selectedTalentSet.requiredLevel; return <article key={talent.id} className={selected ? 'is-selected' : ''}><strong>{talent.name}</strong><GameTermText text={talent.description} /><p>{selected ? 'Выбранный вариант' : `Ур. ${selectedTalentSet.requiredLevel}`}</p>{available && !selected && <button type="button" onClick={() => chooseTalent(talent.id)}>Выбрать</button>}</article>; })}</section>}
        {error && <p className="class-skill-details__error" role="alert">{error}</p>}
        {selectedUnlocked && selectedActiveSlot < 0 && <button type="button" className="class-skill-details__primary" onClick={() => { setSlotPickerOpen(true); setSelectedSlot(null); setError(''); }}>Добавить в активные</button>}
        {selectedUnlocked && selectedActiveSlot >= 0 && <button type="button" disabled>Уже в активных · слот {selectedActiveSlot + 1}</button>}
        <button type="button" onClick={() => setSelectedSkillId(null)}>Закрыть</button>
      </div>
    </NestedActionOverlay>}

    {slotPickerOpen && <NestedActionOverlay label="Выберите слот" onClose={() => setSlotPickerOpen(false)} showDefaultCancel={false}>
      <div className="class-slot-picker game-picker">
        <h3>Выберите слот</h3>
        <div className="class-slot-picker__grid">
          {record.activeSkillIds.map((skillId, index) => <button type="button" key={`${skillId}-${index}`} className={`class-slot-picker__slot${selectedSlot === index ? ' is-selected' : ''}`} aria-pressed={selectedSlot === index} aria-label={`Слот ${index + 1}: ${getClassSkillDisplayName(skillId)}`} onClick={() => setSelectedSlot(index)}><span>{index + 1}</span><SkillArt skillId={skillId} /><small>{getClassSkillDisplayName(skillId)}</small></button>)}
        </div>
        <PickerActionFooter confirmLabel="Заменить" onConfirm={confirmSlot} confirmDisabled={selectedSlot === null} onCancel={() => setSlotPickerOpen(false)} />
      </div>
    </NestedActionOverlay>}
  </section>;
};

export default ClassProgressionPanel;
