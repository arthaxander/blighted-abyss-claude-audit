import { reviveCombatSession, reviveUnit } from '../utils/combatHydration';
// src/components/CombatScreen.js
// Полностью исправленный боевой экран Ashen Abyss

import React, { useEffect, useState, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  initCombatSession,
  toggleBlackVeinLantern,
  checkBattleOutcome,
  resolveEncounterRewardsOnce,
  rollLootForEnemies,
  TURN_METER_THRESHOLD,
} from "../utils/combatUtils";
import { executeCombatCommand } from "../utils/combatExecution";
import { snapshotCombatSession } from "../utils/combatSnapshot";
import { useToast } from "../contexts/UIContext";
import { createAbilityByName } from "../data/abilityPresets";
import { equipmentByName } from "../data/equipment";
import { findItemData, getItemDefinition, combatItemConsumesTurn } from "../data/items";
import { getEffectDefinition } from "../utils/effects";
import { formatTurns } from "../utils/russianGrammar";
import {
  formatHealthWithShield,
  getCombatActionGridAbilities,
  getCooldownPresentationFraction,
  getHealthShieldSegments,
  getVisibleStatuses,
  presentCombatStatuses,
} from "../utils/combatPresentation";
import {
  createExecutionGate,
  executeValidCombatDrop,
  findValidCombatTarget,
  getCombatTargetId,
  getValidCombatTargets,
} from "../utils/combatTargeting";
import {
  getSelectedCombatItemGroup,
  reconcileCombatQuickItem,
  selectCombatQuickItem,
} from "../utils/combatQuickItem";
import { getEnemyBattlefieldLayout, getEnemyStatusPresentation } from "../utils/enemyBattlefield";
import { getAllyBattlefieldLayout } from "../utils/allyBattlefield";
import {
  COMBAT_PRESENTATION_TIMING,
  applyCombatPresentationEvent,
  beginCombatPresentation,
  buildCombatPresentationTimeline,
  consumeCombatPresentationEvents,
  createCombatPresentationView,
  getEnemyActionPresentationArtId,
  getCombatPresentationDuration,
  getCombatPositiveVfxKind,
  getCombatStatusVfxKind,
  setEnteringEnemyPhase,
} from "../utils/combatPresentationEvents";
import {
  COMBAT_ART_FALLBACKS,
  applyCombatArtFallback,
  resolveAbilityIcon,
  resolveAllyPortrait,
  resolveCombatItemIcon,
  resolveEnemyPortrait,
  preloadImage,
  preloadImages,
  getCombatCriticalImages,
  getCombatWarmImages,
  resolvePlayerPortrait,
} from "../data/combatAssets";
import { resolveItemArt } from "../data/itemArt";
import { getEquipmentInstanceItemId } from "../utils/runeSockets";
import EnemyDetailCard, { AbilityDescription } from "./EnemyDetailCard";
import ItemDetailsModal from "./ItemDetailsModal";
import PlayerCombatDetailsCard from "./PlayerCombatDetailsCard";
import ArtLoadingOverlay, { useArtLoadGate } from './ArtLoadingOverlay';
import { GAMEPLAY_DRAG_ACTIVATION_DISTANCE } from "../constants/interaction";
import { playSfx } from "../audio/sfxController";
import "./CombatScreen.css";

export const ACTION_DRAG_ACTIVATION_DISTANCE = GAMEPLAY_DRAG_ACTIVATION_DISTANCE;

// Keep inspect dialogs outside animated/scrolling combat stacking contexts.
const portalCombatDetail = content => typeof document === 'undefined' ? content : createPortal(content, document.body);

const RANGED_ACTION_PATTERN = /(стрел|выстрел|лук|болт|метатель|бросок|копь|arrow|shot|bolt|throw)/i;
const MAGIC_ACTION_PATTERN = /(маг|заклин|огн|плам|лед|лёд|мороз|молн|гроз|яд|спор|эхо|астрал|ритуал|magic|fire|ice|frost|lightning|poison|spell)/i;
const IMPACT_NUMBER_DELAY = 70;

const playCombatPresentationSfx = event => {
  if (!event) return;

  if (event.type === "actionStart") {
    const action = event.action || {};
    const name = action.name || "";
    const magical = action.type === "magical" || action.damageType === "magical" || action.magicSchool || MAGIC_ACTION_PATTERN.test(name);
    if (magical) playSfx("magicCast");
    else if (RANGED_ACTION_PATTERN.test(name)) playSfx("attackRanged");
    else playSfx("attackMelee");
    return;
  }

  if (event.type === "shieldAbsorbed") {
    playSfx(event.shieldBroken ? "shieldBreak" : "blockShield");
    return;
  }
  if (event.type === "damage" && Number(event.amount) > 0) {
    if (event.isPeriodic) {
      if (!event.sourceEffectId && !event.fromEffect) playSfx("statusTick", { relativeVolume: 0.38 });
      return;
    }
    if (event.lethal) {
      playSfx("critical");
      return;
    }
    if (event.damageType === "magical") {
      if (event.magicSchool === "fire") playSfx("fire", { relativeVolume: 0.7 });
      else if (event.magicSchool === "ice") playSfx("ice", { relativeVolume: 0.7 });
      else if (event.magicSchool === "lightning") playSfx("lightning", { relativeVolume: 0.7 });
      else playSfx("hitFlesh", { relativeVolume: 0.58 });
      return;
    }
    playSfx("hitFlesh");
    return;
  }
  if (event.type === "heal") {
    const maxHp = Number(event.targetAfter?.maxHp || event.target?.maxHp || 0);
    const minor = maxHp > 0 && Number(event.amount) / maxHp <= 0.06;
    playSfx("heal", { relativeVolume: minor ? 0.42 : 0.72 });
    return;
  }
  if (event.type === "shieldGain") {
    playSfx("buff", { relativeVolume: 0.65 });
    return;
  }
  if (event.type === "summon") {
    playSfx("summon");
    return;
  }
  if (event.type === "bossPhaseTransition") {
    playSfx("magicCast", { relativeVolume: 0.82 });
    return;
  }
  if (event.type === "death") {
    playSfx("death", { relativeVolume: event.targetAfter?.boss || event.targetAfter?.isBoss ? 1 : 0.82 });
    return;
  }
  if (event.type === "deathSaveResolved") {
    playSfx(event.deathSaveKind === "curse" ? "statusTick" : "heal", { relativeVolume: 0.72 });
    return;
  }
  if (event.type === "procTriggered") {
    playSfx(event.procKind === "curse" ? "statusTick" : "buff");
    return;
  }
  if (event.type === "turnIntercept") {
    playSfx("attackRanged", { relativeVolume: 0.68 });
    return;
  }
  if (event.type === "turnMeterSteal") {
    playSfx("statusTick", { relativeVolume: 0.48 });
    return;
  }
  if (event.type === "statusBlocked") {
    playSfx("blockShield");
    return;
  }
  if (event.type === "statusCleanse") {
    playSfx("buff", { relativeVolume: 0.48 });
    return;
  }
  if (event.type === "statusTriggered") {
    const effectId = event.effectId;
    if (effectId === "poison") playSfx("poison");
    else if (effectId === "bleed") playSfx("bleed");
    else if (effectId === "burn") playSfx("fire");
    else playSfx("statusTick");
    return;
  }
  if (event.type === "statusApplied") {
    if (event.statusOperation === "stack" || event.statusOperation === "refresh") {
      playSfx("statusTick");
      return;
    }
    const effectId = event.effectId;
    if (effectId === "poison") playSfx("poison");
    else if (effectId === "bleed") playSfx("bleed");
    else if (effectId === "burn") playSfx("fire");
    else if (effectId === "freeze" || effectId === "frozen") playSfx("ice");
    else if (effectId === "shock" || effectId === "charge") playSfx("lightning");
    else playSfx(getEffectDefinition(effectId)?.type === "buff" ? "buff" : "debuff");
  }
};

export const getCombatAuxiliaryStates = player => {
  const trap = player?._armedTrap;
  if (!trap) return { traps: [], temporarySummons: [] };
    const entry = trap.type === 'snake_trap'
    ? { id: 'snake_trap', abilityName: 'Змеиная ловушка', label: 'Ожидает', statusKind: 'waiting' }
    : trap.type === 'wolf_pit'
      ? { id: 'wolf_pit', abilityName: 'Волчья яма', label: 'Ожидает', statusKind: 'waiting' }
      : null;
  if (!entry) return { traps: [], temporarySummons: [] };
  return trap.type === 'snake_trap'
    ? { traps: [], temporarySummons: [entry] }
    : { traps: [entry], temporarySummons: [] };
};

const styles = {
  container: {
    fontFamily: "serif",
    color: "#eee",
    background: "#111",
    minHeight: "100vh",
    padding: 16,
  },
  inlineRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  row: { display: "flex", gap: 16, flexWrap: "wrap" },
  card: {
    border: "1px solid #444",
    borderRadius: 8,
    padding: 12,
    background: "#1a1a1a",
    width: 230,
  },
  button: {
    background: "#333",
    color: "#eee",
    padding: "6px 10px",
    border: "1px solid #555",
    borderRadius: 6,
    cursor: "pointer",
    margin: 4,
  },
  selected: { background: "#666" },
  effectList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  effectIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    border: "1px solid #444",
    cursor: "default",
    overflow: "hidden",
    position: "relative",
  },
  effectIconImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  effectFallback: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
  },
  turnMeterContainer: {
    marginTop: 6,
  },
  turnMeterBar: {
    width: "100%",
    height: 8,
    background: "#222",
    borderRadius: 4,
    overflow: "hidden",
    border: "1px solid #555",
  },
  turnMeterFill: {
    height: "100%",
    transition: "width 0.2s ease-out",
  },
  turnMeterLabel: {
    fontSize: 12,
    marginTop: 4,
    opacity: 0.8,
  },
  enemyPortraitWrapper: {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #333",
    background: "#050505",
    marginBottom: 8,
  },
  enemyPortraitImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  log: {
    marginTop: 20,
    background: "#000",
    padding: 10,
    borderRadius: 8,
    maxHeight: 250,
    overflowY: "auto",
    fontSize: 14,
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modalContent: {
    background: "#1f1f1f",
    color: "#fff",
    padding: 20,
    borderRadius: 8,
    maxWidth: 400,
    width: "90%",
    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
  },
  itemModalContent: {
    background: "#1f1f1f",
    color: "#fff",
    padding: 20,
    borderRadius: 8,
    maxWidth: 560,
    width: "92%",
    maxHeight: "80vh",
    overflowY: "auto",
    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
  },
  itemRow: {
    border: "1px solid #444",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    background: "#181818",
    textAlign: "left",
  },
  itemDescription: {
    fontSize: 13,
    opacity: 0.82,
    marginTop: 6,
    lineHeight: 1.35,
  },
  modalSection: { marginBottom: 12, lineHeight: 1.4 },
  pill: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 6,
    background: "#222",
    border: "1px solid #444",
    fontSize: 12,
    marginRight: 6,
    marginBottom: 4,
  },
  infoButton: {
    background: "#222",
    color: "#9dd2ff",
    border: "1px solid #355",
    borderRadius: 6,
    cursor: "pointer",
    padding: "4px 6px",
    fontSize: 12,
  },
};

const getCombatItemIdentity = (item) => {
  const definition = getItemDefinition(item?.name);
  return definition?.id || definition?.key || item?.id || item?.key || item?.name || "unknown-item";
};

const groupCombatItems = (items = [], combatAssignableOnly = false) => {
  const groups = new Map();
  items.forEach(item => {
    if (!item?.name) return;
    const definition = getItemDefinition(item.name);
    const itemData = findItemData(item.name);
    if (combatAssignableOnly && (!definition || itemData?.type !== 'consumable' || itemData.usableInCombat === false)) return;
    const key = getCombatItemIdentity(item);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += 1;
      return;
    }
    groups.set(key, {
      key,
      item,
      name: item.name,
      quantity: 1,
      description: item.description || definition?.description || definition?.effect || "",
      type: item.type || definition?.type || null,
    });
  });
  return Array.from(groups.values());
};

const getActiveCombatEquipmentGroups = (equipment = {}) =>
  Object.values(equipment || {}).reduce((groups, equipped) => {
    const itemId = getEquipmentInstanceItemId(equipped);
    const definition = equipmentByName[itemId];
    if (!definition?.mechanicTags?.includes('active_equipment')) return groups;
    groups.push({
      key: `equipment:${definition.id || definition.name}`,
      item: definition,
      name: definition.name,
      quantity: null,
      description: definition.description || '',
      type: definition.type || null,
      activeEquipment: true,
    });
    return groups;
  }, []);

const getCombatUnitKey = (unit, index = 0) => (
  unit?.id || unit?.runtimeId || unit?.combatId || unit?.name || `combat-unit-${index}`
);


const needsEnemyResolution = (session) => (
  Boolean(session?.state) &&
  session.state.initiative?.playerReady === false &&
  !checkBattleOutcome(session).victory &&
  !checkBattleOutcome(session).defeat
);

export const CombinedHealthBar = ({ unit, impactEvents = [] }) => {
  const currentHp = Math.max(0, Number(unit?.hp) || 0);
  const maxHp = Math.max(0, Number(unit?.maxHp) || 0);
  const shield = Math.max(0, Number(unit?.shield) || 0);
  const [trailingHp, setTrailingHp] = useState(currentHp);
  const segments = getHealthShieldSegments(currentHp, shield, maxHp);
  const preparation = unit?._preparation;
  const preparationMax = preparation?.maxDurability;
  const preparationPercent = preparation?.durability > 0 && preparationMax > 0
    ? Math.max(0, Math.min(100, preparation.durability / preparationMax * 100))
    : 0;

  useEffect(() => {
    if (currentHp >= trailingHp) {
      if (currentHp !== trailingHp) setTrailingHp(currentHp);
      return undefined;
    }
    const timeout = setTimeout(() => setTrailingHp(currentHp), COMBAT_PRESENTATION_TIMING.healthTrailDelay);
    return () => clearTimeout(timeout);
  }, [currentHp, trailingHp]);

  const visualTotal = Math.max(1, maxHp + shield);
  const trailingPercent = Math.max(0, Math.min(100, Math.min(trailingHp, maxHp) / visualTotal * 100));
  const trailWidth = shield <= 0 ? Math.max(0, trailingPercent - segments.hpPercent) : 0;
  const shieldEvents = impactEvents.filter(event => event?.type === "shieldAbsorbed");

  return (
    <div className={`combined-health${preparationPercent ? ' has-preparation' : ''}`} aria-label={`Здоровье: ${formatHealthWithShield(currentHp, shield, maxHp)}${preparationPercent ? `. Подготовка: ${preparation.durability} из ${preparationMax}` : ''}`}>
      <span className="health-segment hp" style={{ width: `${segments.hpPercent}%` }} />
      <span className="health-segment shield" style={{ width: `${segments.shieldPercent}%` }} />
      <span className="health-segment missing" style={{ width: `${segments.missingPercent}%` }} />
      {trailWidth > 0 ? (
        <span
          className="health-damage-trail"
          data-testid="health-damage-trail"
          style={{ left: `${segments.hpPercent}%`, width: `${trailWidth}%` }}
        />
      ) : null}
      {preparationPercent ? <span className="health-segment preparation" data-testid="preparation-health-layer" style={{ width: `${preparationPercent}%` }} /> : null}
      <span className="health-bar-impact-layer" aria-hidden="true">
        {shieldEvents.map(event => (
          <span
            key={event.id || `shield-${event.at}-${event.sequence}`}
            className={`health-shield-impact${event.shieldBroken ? ' is-break' : ''}${event.blocked ? ' is-blocked' : ''}`}
            style={{ animationDelay: `${event.at || 0}ms` }}
          />
        ))}
      </span>
      <span className="health-label">{formatHealthWithShield(currentHp, shield, maxHp)}</span>
    </div>
  );
};

export const VICTORY_SPLASH_DURATION = 1000;
const PRESENTATION_INTERACTION_SETTLE_TAIL = 760;
const PRESENTATION_INTERACTION_SETTLE_TYPES = new Set([
  "damage",
  "shieldAbsorbed",
  "heal",
  "shieldGain",
  "statusApplied",
  "statusTriggered",
  "statusBlocked",
  "statusCleanse",
]);

export default function CombatScreen({
  player,
  enemies,
  isBoss = false,
  onVictory,
  onDefeat,
  initialCombatSnapshot = null,
  onCombatSnapshot,
  onClearCombatSnapshot,
  onExit,
  onVictorySplashComplete,
}) {
  const [session, setSession] = useState(null);
  const [initialSceneImages, setInitialSceneImages] = useState(null);
  const warmArtStartedRef = useRef(false);
  const [selectedAbility, setSelectedAbility] = useState(null);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState(0);
  const [infoModal, setInfoModal] = useState(null);
  const [inspectedEnemyKey, setInspectedEnemyKey] = useState(null);
  const [isPlayerDetailsOpen, setIsPlayerDetailsOpen] = useState(false);
  const [inspectedAllyId, setInspectedAllyId] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [selectedQuickItemKey, setSelectedQuickItemKey] = useState(null);
  const [presentationTimeline, setPresentationTimeline] = useState([]);
  const [presentationLocked, setPresentationLocked] = useState(false);
  const [presentationView, setPresentationView] = useState(null);
  const [activeRosterTransition, setActiveRosterTransition] = useState(null);
  const [enteringEnemies, setEnteringEnemies] = useState({});
  const [pendingBattleResult, setPendingBattleResult] = useState(null);
  const logRef = useRef();
  const resolvingDropRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const onVictoryRef = useRef(onVictory);
  const onDefeatRef = useRef(onDefeat);
  const battleEndedRef = useRef(false);
  const battleResultRef = useRef(null);
  const battleResultContinuedRef = useRef(false);
  const combatInitializedRef = useRef(false);
  const presentationLockedRef = useRef(false);
  const presentationTimerRef = useRef(null);
  const presentationCleanupTimerRef = useRef(null);
  const presentationEventTimersRef = useRef([]);
  const presentationStartViewRef = useRef(null);
  const enemyCardRefs = useRef(new Map());
  const enemyGridBeforeRef = useRef(null);
  const entranceFrameRefs = useRef([]);
  const { pushToast } = useToast();

  useEffect(() => {
    const canSummonFireElemental = (player?.abilityNames || []).includes('Призыв элементаля')
      || (player?.abilities || []).some(ability => ability?.name === 'Призыв элементаля');
    if (canSummonFireElemental) preloadImage(resolveAllyPortrait({ allyPortraitKey: 'summons/elementalist/fire_elemental' }));
  }, [player?.abilities, player?.abilityNames]);

  const captureEnemyGridPositions = useCallback(() => {
    enemyGridBeforeRef.current = new Map(
      [...enemyCardRefs.current.entries()].map(([id, element]) => [id, element.getBoundingClientRect()])
    );
  }, []);

  useLayoutEffect(() => {
    const rosterTransition = activeRosterTransition;
    const before = enemyGridBeforeRef.current;
    if (!rosterTransition || !before) return;
    enemyGridBeforeRef.current = null;
    const moves = [];
    enemyCardRefs.current.forEach((element, id) => {
      if (rosterTransition.enteringIds?.includes(id) || !before.has(id)) return;
      const first = before.get(id);
      const last = element.getBoundingClientRect();
      const deltaX = first.left - last.left;
      const deltaY = first.top - last.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      if (typeof element.animate !== "function") return;
      moves.push({ element, deltaX, deltaY });
    });
    moves.forEach(({ element, deltaX, deltaY }) => {
      element.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: COMBAT_PRESENTATION_TIMING.summonGridTransition,
          delay: 0,
          easing: "cubic-bezier(.25,.46,.45,.94)",
          fill: "backwards",
        }
      );
    });
    if (rosterTransition.enteringIds?.length) {
      const firstFrame = requestAnimationFrame(() => {
        const secondFrame = requestAnimationFrame(() => {
          setEnteringEnemies(current => setEnteringEnemyPhase(
            current,
            rosterTransition.enteringIds.filter(id => current[id]),
            "active"
          ));
        });
        entranceFrameRefs.current.push(secondFrame);
      });
      entranceFrameRefs.current.push(firstFrame);
    }
    setActiveRosterTransition(null);
  }, [activeRosterTransition, presentationView]);

  const finishCombatPresentation = useCallback((resolvedSession, onComplete = () => {}, options = {}) => {
    const timeline = buildCombatPresentationTimeline(
      consumeCombatPresentationEvents(resolvedSession),
      options
    );
    const presentationOutcome = checkBattleOutcome(resolvedSession);
    const resultOutcome = presentationOutcome.defeat
      ? "defeat"
      : presentationOutcome.victory
      ? "victory"
      : null;
    const duration = getCombatPresentationDuration(timeline, { resultOutcome });
    const latestSettleAt = Math.max(0, ...timeline
      .filter(event => PRESENTATION_INTERACTION_SETTLE_TYPES.has(event.type))
      .map(event => (event.at || 0) + PRESENTATION_INTERACTION_SETTLE_TAIL));
    const interactionDuration = Math.max(duration, latestSettleAt);
    if (presentationTimerRef.current) clearTimeout(presentationTimerRef.current);
    if (presentationCleanupTimerRef.current) clearTimeout(presentationCleanupTimerRef.current);
    presentationEventTimersRef.current.forEach(clearTimeout);
    presentationEventTimersRef.current = [];
    if (!duration) {
      setPresentationTimeline([]);
      setPresentationView(null);
      presentationCleanupTimerRef.current = null;
      onComplete();
      return;
    }
    presentationLockedRef.current = true;
    setPresentationLocked(true);
    const identifiedTimeline = timeline.map((event, index) => ({ ...event, id: `${Date.now()}-${index}` }));
    setPresentationView(presentationStartViewRef.current);
    presentationStartViewRef.current = null;
    setPresentationTimeline(identifiedTimeline);
    const eventsByTime = new Map();
    identifiedTimeline.forEach(event => {
      if (!eventsByTime.has(event.at)) eventsByTime.set(event.at, []);
      eventsByTime.get(event.at).push(event);
    });
    eventsByTime.forEach((eventsAtTime, at) => {
      const timer = setTimeout(() => {
        eventsAtTime.forEach(playCombatPresentationSfx);
        const summonEvents = eventsAtTime.filter(event => event.type === "summon");
        const enemySummonEvents = summonEvents.filter(event => event.side === "enemy");
        const removalEvents = eventsAtTime.filter(event => event.type === "removeFromPresentationRoster");
        const enemyRemovalEvents = removalEvents.filter(event => event.side === "enemy");
        if (enemySummonEvents.length || enemyRemovalEvents.length) captureEnemyGridPositions();
        if (summonEvents.length) {
          setEnteringEnemies(current => setEnteringEnemyPhase(
            current,
            summonEvents.map(event => event.summonedUnitId),
            "initial"
          ));
        }
        setPresentationView(current => eventsAtTime.reduce(applyCombatPresentationEvent, current));
        if (enemySummonEvents.length || enemyRemovalEvents.length) {
          setActiveRosterTransition({
            enteringIds: enemySummonEvents.map(event => event.summonedUnitId),
          });
        } else if (summonEvents.length) {
          // Allied summons do not need enemy-grid FLIP, but they do need the
          // same two-frame entrance transition as enemy summons.
          const firstFrame = requestAnimationFrame(() => {
            const secondFrame = requestAnimationFrame(() => {
              setEnteringEnemies(current => setEnteringEnemyPhase(
                current,
                summonEvents.map(event => event.summonedUnitId).filter(id => current[id]),
                "active"
              ));
            });
            entranceFrameRefs.current.push(secondFrame);
          });
          entranceFrameRefs.current.push(firstFrame);
        }
        if (summonEvents.length) {
          const cleanup = setTimeout(() => {
            setEnteringEnemies(current => setEnteringEnemyPhase(
              current,
              summonEvents.map(event => event.summonedUnitId)
            ));
          }, COMBAT_PRESENTATION_TIMING.summonAccentDuration);
          presentationEventTimersRef.current.push(cleanup);
        }
      }, at);
      presentationEventTimersRef.current.push(timer);
    });
    presentationTimerRef.current = setTimeout(() => {
      setPresentationView(null);
      presentationLockedRef.current = false;
      setPresentationLocked(false);
      presentationTimerRef.current = null;
      onComplete();
    }, interactionDuration);
    const decorativeTail = Math.max(
      IMPACT_NUMBER_DELAY + COMBAT_PRESENTATION_TIMING.floatingDuration,
      COMBAT_PRESENTATION_TIMING.statusDuration,
      COMBAT_PRESENTATION_TIMING.statusVfxDuration,
      COMBAT_PRESENTATION_TIMING.positiveVfxDuration,
      COMBAT_PRESENTATION_TIMING.turnMeterFeedbackDuration,
      COMBAT_PRESENTATION_TIMING.procDuration,
      COMBAT_PRESENTATION_TIMING.deathSaveResolveDuration,
      COMBAT_PRESENTATION_TIMING.deathReactionDuration,
      COMBAT_PRESENTATION_TIMING.summonDeathReactionDuration,
      COMBAT_PRESENTATION_TIMING.bossPhaseDuration,
      COMBAT_PRESENTATION_TIMING.bossDeathReactionDuration,
      COMBAT_PRESENTATION_TIMING.summonGridTransition,
      COMBAT_PRESENTATION_TIMING.summonEntrance,
      COMBAT_PRESENTATION_TIMING.summonAccentDuration,
    );
    presentationCleanupTimerRef.current = setTimeout(() => {
      setPresentationTimeline([]);
      presentationCleanupTimerRef.current = null;
    }, Math.max(interactionDuration, Math.max(...timeline.map(event => event.at || 0)) + decorativeTail));
  }, [captureEnemyGridPositions]);

  useEffect(() => () => {
    if (presentationTimerRef.current) clearTimeout(presentationTimerRef.current);
    if (presentationCleanupTimerRef.current) clearTimeout(presentationCleanupTimerRef.current);
    presentationEventTimersRef.current.forEach(clearTimeout);
    entranceFrameRefs.current.forEach(cancelAnimationFrame);
  }, []);

  const persistCombatSnapshot = useCallback((nextSession, extra = {}) => {
    if (!onCombatSnapshot || !nextSession?.state || battleEndedRef.current) return;
    onCombatSnapshot(snapshotCombatSession(nextSession, {
      isBoss,
      ...extra,
    }));
  }, [isBoss, onCombatSnapshot]);

  const persistBattleResult = useCallback((currentSession, result) => {
    if (!onCombatSnapshot || !currentSession?.state || !result?.outcome) return;
    onCombatSnapshot(snapshotCombatSession(currentSession, {
      isBoss,
      battleResult: {
        id: result.id,
        outcome: result.outcome,
        ...(result.outcome === "victory" ? { loot: result.loot } : {}),
        isBoss: result.isBoss,
      },
    }));
  }, [isBoss, onCombatSnapshot]);

  const prepareBattleResult = useCallback((outcome, currentSession) => {
    if (battleResultRef.current) return battleResultRef.current;
    if (!currentSession?.state) return null;
    battleEndedRef.current = true;
    setDragState(null);
    const result = outcome === "victory"
      ? {
        id: `combat-result-${Date.now()}`,
        outcome,
        loot: currentSession.state.encounterReward
          ? resolveEncounterRewardsOnce(currentSession)
          : rollLootForEnemies(currentSession.state.enemies || []),
        isBoss,
        playerState: currentSession.state.players?.[0],
      }
      : { outcome };
    battleResultRef.current = result;
    persistBattleResult(currentSession, result);
    return result;
  }, [isBoss, persistBattleResult]);

  const restorePersistedBattleResult = useCallback((snapshotResult, currentSession) => {
    if (
      battleResultRef.current ||
      !["victory", "defeat"].includes(snapshotResult?.outcome) ||
      (snapshotResult.outcome === "victory" && !snapshotResult.loot) ||
      !currentSession?.state
    ) return null;
    battleEndedRef.current = true;
    setDragState(null);
    const result = {
      id: snapshotResult.id,
      outcome: snapshotResult.outcome,
      ...(snapshotResult.outcome === "victory" ? { loot: snapshotResult.loot } : {}),
      isBoss: snapshotResult.isBoss ?? isBoss,
      playerState: currentSession.state.players?.[0],
    };
    battleResultRef.current = result;
    return result;
  }, [isBoss]);

  const revealBattleResult = useCallback(result => {
    if (!result || battleResultRef.current !== result) return;
    playSfx(result.outcome === "victory" ? "victory" : "defeat");
    setPendingBattleResult(result);
  }, []);

  const showBattleResult = useCallback((outcome, currentSession) => {
    const result = prepareBattleResult(outcome, currentSession);
    revealBattleResult(result);
  }, [prepareBattleResult, revealBattleResult]);

  useEffect(() => {
    if (pendingBattleResult?.outcome !== "victory" || !onVictorySplashComplete) return undefined;
    const timeout = setTimeout(() => onVictorySplashComplete(pendingBattleResult), VICTORY_SPLASH_DURATION);
    return () => clearTimeout(timeout);
  }, [onVictorySplashComplete, pendingBattleResult]);

  const continueBattleResult = useCallback(() => {
    const result = battleResultRef.current;
    if (!result || battleResultContinuedRef.current) return;
    battleResultContinuedRef.current = true;
    if (result.outcome === "victory") {
      onVictoryRef.current?.(result.loot, result.isBoss, result.playerState);
    } else {
      onDefeatRef.current?.();
    }
  }, []);

  useEffect(() => {
    onVictoryRef.current = onVictory;
  }, [onVictory]);

  useEffect(() => {
    onDefeatRef.current = onDefeat;
  }, [onDefeat]);

  useEffect(() => {
    if (combatInitializedRef.current) return;
    combatInitializedRef.current = true;
    try {
      battleEndedRef.current = false;
      battleResultRef.current = null;
      battleResultContinuedRef.current = false;
      const restoredSession = reviveCombatSession(initialCombatSnapshot, player, enemies);
      if (restoredSession) {
        let finalRestoredSession = restoredSession;
        if (needsEnemyResolution(restoredSession)) {
          const afterEnemy = executeCombatCommand(restoredSession, { kind: "advance" });
          finalRestoredSession = afterEnemy.session || restoredSession;
        }
        setSession({ ...finalRestoredSession });
        setIsItemModalOpen(false);
        if (typeof initialCombatSnapshot?.selectedTarget === "number") {
          setSelectedTarget(initialCombatSnapshot.selectedTarget);
        }
        const restoredOutcome = checkBattleOutcome(finalRestoredSession);
        if (restoredOutcome.defeat) {
          const restoredResult = restorePersistedBattleResult(
            initialCombatSnapshot?.battleResult,
            finalRestoredSession
          );
          if (restoredResult) revealBattleResult(restoredResult);
          else showBattleResult("defeat", finalRestoredSession);
          return;
        }
        if (restoredOutcome.victory) {
          const restoredResult = restorePersistedBattleResult(
            initialCombatSnapshot?.battleResult,
            finalRestoredSession
          );
          if (restoredResult) revealBattleResult(restoredResult);
          else showBattleResult("victory", finalRestoredSession);
          return;
        }
        if (needsEnemyResolution(restoredSession)) {
          persistCombatSnapshot(finalRestoredSession, {
            selectedTarget: initialCombatSnapshot?.selectedTarget ?? 0,
          });
        }
        return;
      }

      const availableEnemies = Array.isArray(enemies) ? enemies.filter(Boolean) : [];
      if (availableEnemies.length === 0) {
        setSession({
          state: {
            players: player ? [reviveUnit(player)] : [],
            enemies: [],
            log: ["Не удалось восстановить бой: снимок боя отсутствует. Вернитесь в Гильдию или начните новый безопасный переход."],
          },
        });
        setIsItemModalOpen(false);
        return;
      }

      const sess = initCombatSession(player, availableEnemies);
      if (!sess) {
        setSession({ state: { players: [], enemies: [], log: ["Ошибка инициализации боя."] } });
        setIsItemModalOpen(false);
        return;
      }
      presentationStartViewRef.current = createCombatPresentationView(sess.state);
      beginCombatPresentation(sess);
      playSfx("encounterStart");
      const auto = executeCombatCommand(sess, { kind: "advance" });
      const finalSession = auto?.session || sess;
      setSession({ ...finalSession });
      setIsItemModalOpen(false);

      const outcome = checkBattleOutcome(finalSession);
      if (outcome.defeat) {
        const result = prepareBattleResult("defeat", finalSession);
        finishCombatPresentation(
          finalSession,
          () => revealBattleResult(result),
          { openingEnemyAnticipation: true }
        );
        return;
      }
      if (outcome.victory) {
        const result = prepareBattleResult("victory", finalSession);
        finishCombatPresentation(
          finalSession,
          () => revealBattleResult(result),
          { openingEnemyAnticipation: true }
        );
        return;
      }
      persistCombatSnapshot(finalSession);
      finishCombatPresentation(finalSession, () => {}, { openingEnemyAnticipation: true });
    } catch (e) {
      console.error("Ошибка инициализации боя:", e);
      if (onClearCombatSnapshot) onClearCombatSnapshot();
      setSession({ state: { players: [], enemies: [], log: ["Ошибка инициализации боя."] } });
    }
  }, [
    player,
    enemies,
    initialCombatSnapshot,
    onClearCombatSnapshot,
    persistCombatSnapshot,
    finishCombatPresentation,
    restorePersistedBattleResult,
    revealBattleResult,
    prepareBattleResult,
    showBattleResult,
  ]);

  useEffect(() => {
    const abilities = session?.state?.players?.[0]?.abilities || [];
    const usableAbilities = abilities.filter(ab => !ab.passive);
    if (usableAbilities.length > 0) {
      setSelectedAbility(prev =>
        prev && usableAbilities.some(ab => ab.name === prev.name) ? prev : usableAbilities[0]
      );
    } else {
      setSelectedAbility(null);
    }
  }, [session]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [session?.state?.log]);

  // Capture one initial art set: summons or ability changes during combat must
  // not interrupt the fight with a second loading screen.
  useEffect(() => {
    if (initialSceneImages !== null || !session?.state) return;
    setInitialSceneImages(getCombatCriticalImages(session.state));
  }, [initialSceneImages, session]);
  const combatArtReady = useArtLoadGate(initialSceneImages || [], 2400);
  useEffect(() => {
    if (warmArtStartedRef.current || !combatArtReady || initialSceneImages === null || !session?.state) return;
    warmArtStartedRef.current = true;
    // Warm up encounter animation icons once, without gating player interaction.
    preloadImages(getCombatWarmImages(session.state), 1800);
  }, [combatArtReady, initialSceneImages, session]);

  if (!session) return <div style={styles.container}>Загрузка боя...</div>;

  const s = session.state;
  const pl = s.players[0];
  if (!pl) return <div style={styles.container}>Ошибка данных игрока</div>;

  const visibleAbilities = getCombatActionGridAbilities(pl.abilities || []);
  const combatItemGroups = [
    ...groupCombatItems(pl.items || [], true),
    ...getActiveCombatEquipmentGroups(pl.equipment),
  ];
  const blackVeinLantern = Object.values(pl.equipment || {})
    .map(equipped => equipmentByName[getEquipmentInstanceItemId(equipped)])
    .find(definition => definition?.id === 'black_vein_lantern') || null;
  const resultLootItems = Array.isArray(pendingBattleResult?.loot)
    ? pendingBattleResult.loot
    : pendingBattleResult?.loot?.items || [];
  const resultLootGroups = pendingBattleResult?.outcome === "victory"
    ? groupCombatItems(resultLootItems)
    : [];
  const selectedQuickItem = getSelectedCombatItemGroup(combatItemGroups, selectedQuickItemKey);
  const displayedPlayers = presentationView?.players || s.players;
  const displayedEnemies = presentationView?.enemies || (s.enemies || []).filter(enemy => enemy.hp > 0);
  const displayedPlayer = displayedPlayers[0] || pl;
  const inspectedEnemy = inspectedEnemyKey
    ? (s.enemies || []).find((enemy, index) => getCombatUnitKey(enemy, index) === inspectedEnemyKey)
    : null;
  const enemyBattlefieldLayout = getEnemyBattlefieldLayout(displayedEnemies.length);
  const enemyStatusPresentation = getEnemyStatusPresentation(enemyBattlefieldLayout.mode);
  const visibleAllies = displayedPlayers.slice(1, 4);
  const allyBattlefieldLayout = getAllyBattlefieldLayout(visibleAllies.length);
  const combatActionsInactive = battleEndedRef.current || presentationLocked || session.state.initiative?.playerReady === false;
  const auxiliaryStates = getCombatAuxiliaryStates(pl);

  const handleAction = (ability = selectedAbility, targetIndex = selectedTarget) => {
    if (presentationLockedRef.current || battleEndedRef.current) return;
    if (!ability) {
      pushToast("Выберите способность перед действием", { tone: "warning" });
      return;
    }
    if (ability.passive) {
      pushToast("Эта способность срабатывает автоматически", { tone: "info" });
      return;
    }
    let resolvedTargetIndex = targetIndex;
    const targetMode = ability.targeting || ability.target || ability.targetType || "enemy";
    const requiresEnemyTarget = targetMode !== "self" && targetMode !== "ally" && targetMode !== "allAllies";
    const enemiesState = session.state.enemies || [];
    const chosenTarget = requiresEnemyTarget ? enemiesState[resolvedTargetIndex] : null;
    if (requiresEnemyTarget && (!chosenTarget || chosenTarget.hp <= 0)) {
      const nextIndex = enemiesState.findIndex(enemy => enemy && enemy.hp > 0);
      if (nextIndex === -1) {
        const outcome = checkBattleOutcome(session);
        if (outcome.defeat) {
          showBattleResult("defeat", session);
        } else if (outcome.victory) {
          showBattleResult("victory", session);
        } else {
          pushToast("Нет доступных целей", { tone: "warning" });
        }
        return;
      }
      resolvedTargetIndex = nextIndex;
      setSelectedTarget(nextIndex);
    }

    presentationStartViewRef.current = createCombatPresentationView(session.state);
    const result = executeCombatCommand(session, { kind: "ability", name: ability.name, targetIndex: resolvedTargetIndex });
    const updatedSession = result?.session || session;

    if (!result?.turnConsumed) {
      setSession({ ...updatedSession });
      finishCombatPresentation(updatedSession, () => {
        const immediateOutcome = checkBattleOutcome(updatedSession);
        if (immediateOutcome.defeat) showBattleResult("defeat", updatedSession);
        else if (immediateOutcome.victory) showBattleResult("victory", updatedSession);
      });
      return;
    }

    const outcome = checkBattleOutcome(updatedSession);
    if (outcome.defeat) {
      const result = prepareBattleResult("defeat", updatedSession);
      setSession({ ...updatedSession });
      finishCombatPresentation(updatedSession, () => revealBattleResult(result));
      return;
    }
    if (outcome.victory) {
      const result = prepareBattleResult("victory", updatedSession);
      setSession({ ...updatedSession });
      finishCombatPresentation(updatedSession, () => revealBattleResult(result));
      return;
    }

    captureEnemyGridPositions();
    const afterEnemy = executeCombatCommand(updatedSession, { kind: "advance" });
    const outcome2 = checkBattleOutcome(afterEnemy.session);
    const battleResult = outcome2.defeat
      ? prepareBattleResult("defeat", afterEnemy.session)
      : outcome2.victory ? prepareBattleResult("victory", afterEnemy.session) : null;
    setSession({ ...afterEnemy.session });
    if (!outcome2.defeat && !outcome2.victory) {
      persistCombatSnapshot(afterEnemy.session, { selectedTarget: resolvedTargetIndex });
    }
    finishCombatPresentation(afterEnemy.session, () => {
      if (battleResult) revealBattleResult(battleResult);
    });
  };

  const handleUseItem = (itemName, targetIndex = selectedTarget) => {
    if (presentationLockedRef.current || battleEndedRef.current) return;
    if (!itemName) {
      pushToast("Выберите предмет для использования", { tone: "warning" });
      return;
    }
    presentationStartViewRef.current = createCombatPresentationView(session.state);
    const result = executeCombatCommand(session, { kind: "item", name: itemName, targetIndex });
    const updatedSession = result?.session || session;
    setSession({ ...updatedSession });
    if (result?.itemUsed) {
      playSfx(result?.activeEquipment ? "itemEquip" : "consumableUse");
      setIsItemModalOpen(false);
      if (!result?.activeEquipment) {
        const remainingGroups = [
          ...groupCombatItems(updatedSession.state.players?.[0]?.items || [], true),
          ...getActiveCombatEquipmentGroups(updatedSession.state.players?.[0]?.equipment),
        ];
        setSelectedQuickItemKey(current => reconcileCombatQuickItem(remainingGroups, current));
      }
    }

    const outcome = checkBattleOutcome(updatedSession);
    if (outcome.defeat) {
      const result = prepareBattleResult("defeat", updatedSession);
      finishCombatPresentation(updatedSession, () => revealBattleResult(result));
      return;
    }
    if (outcome.victory) {
      const result = prepareBattleResult("victory", updatedSession);
      finishCombatPresentation(updatedSession, () => revealBattleResult(result));
      return;
    }
    if (!result?.turnConsumed) {
      persistCombatSnapshot(updatedSession, { selectedTarget: targetIndex });
      finishCombatPresentation(updatedSession);
      return;
    }

    captureEnemyGridPositions();
    const afterEnemy = executeCombatCommand(updatedSession, { kind: "advance" });
    const outcome2 = checkBattleOutcome(afterEnemy.session);
    const battleResult = outcome2.defeat
      ? prepareBattleResult("defeat", afterEnemy.session)
      : outcome2.victory ? prepareBattleResult("victory", afterEnemy.session) : null;
    setSession({ ...afterEnemy.session });
    if (!outcome2.defeat && !outcome2.victory) {
      persistCombatSnapshot(afterEnemy.session, { selectedTarget: targetIndex });
    }
    finishCombatPresentation(afterEnemy.session, () => {
      if (battleResult) revealBattleResult(battleResult);
    });
  };

  const handleToggleBlackVeinLantern = () => {
    if (
      presentationLockedRef.current ||
      battleEndedRef.current ||
      session.state.initiative?.playerReady === false ||
      !blackVeinLantern
    ) return;

    const result = toggleBlackVeinLantern(session);
    if (!result?.changed) return;
    setSession({ ...session });
    persistCombatSnapshot(session, { selectedTarget });
    pushToast(
      result.enabled ? 'Фонарь чёрной жилы включён' : 'Фонарь чёрной жилы выключен',
      { tone: 'info' }
    );
  };

  const executeDroppedAction = (drag, target) => {
    if (!drag || !target || resolvingDropRef.current || presentationLockedRef.current || battleEndedRef.current) return false;
    resolvingDropRef.current = true;
    try {
      if (target.side === "enemy") setSelectedTarget(target.index);
      if (drag.kind === "item") {
        handleUseItem(drag.itemName, target.side === "enemy" ? target.index : 0);
      } else {
        handleAction(drag.ability, target.side === "enemy" ? target.index : 0);
      }
      return true;
    } finally {
      resolvingDropRef.current = false;
    }
  };

  const beginActionDrag = (event, descriptor) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (descriptor.disabled || resolvingDropRef.current || presentationLockedRef.current || battleEndedRef.current) return;
    const validTargets = getValidCombatTargets({
      action: descriptor.action,
      players: session.state.players || [],
      enemies: session.state.enemies || [],
    });
    if (validTargets.length === 0) return;

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let hoveredId = null;
    const executeOnce = createExecutionGate();
    const nextDrag = { ...descriptor, validTargets, pointerId, x: startX, y: startY, moved: false };
    setDragState(nextDrag);

    const targetAtPoint = (x, y) => {
      const card = document.elementFromPoint(x, y)?.closest?.("[data-combat-target]");
      return findValidCombatTarget(validTargets, card?.dataset?.combatTarget);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onCancel);
      setDragState(null);
    };
    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) >= ACTION_DRAG_ACTIVATION_DISTANCE) moved = true;
      const target = moved ? targetAtPoint(moveEvent.clientX, moveEvent.clientY) : null;
      hoveredId = target?.id || null;
      if (moved) moveEvent.preventDefault();
      setDragState(current => current ? {
        ...current,
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        moved,
        hoveredId,
      } : current);
    };
    const onEnd = upEvent => {
      if (upEvent.pointerId !== pointerId) return;
      const target = moved ? targetAtPoint(upEvent.clientX, upEvent.clientY) : null;
      if (moved) {
        suppressClickUntilRef.current = Date.now() + 500;
        upEvent.preventDefault();
      }
      cleanup();
      executeValidCombatDrop({
        validTargets,
        targetId: target?.id,
        gate: executeOnce,
        execute: validTarget => executeDroppedAction(nextDrag, validTarget),
      });
    };
    const onCancel = cancelEvent => {
      if (cancelEvent.pointerId === pointerId) cleanup();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd, { passive: false });
    window.addEventListener("pointercancel", onCancel);
  };

  const beginKeyboardTargeting = descriptor => {
    if (descriptor.disabled || battleEndedRef.current) return;
    const validTargets = getValidCombatTargets({
      action: descriptor.action,
      players: session.state.players || [],
      enemies: session.state.enemies || [],
    });
    if (validTargets.length) setDragState({ ...descriptor, validTargets, keyboard: true });
  };

  const resolveEffectIconUrl = effect => {
    if (!effect) return null;
    if (effect.iconPath) return effect.iconPath;
    const rawIcon = typeof effect.icon === "string" ? effect.icon.trim() : "";
    if (!rawIcon) return null;
    if (/^https?:\/\//.test(rawIcon) || rawIcon.startsWith("/")) {
      return rawIcon;
    }
    if (rawIcon.startsWith("./") || rawIcon.startsWith("../")) {
      return rawIcon;
    }
    if (/\.(png|jpe?g|webp|svg)$/i.test(rawIcon)) {
      return rawIcon;
    }
    return null;
  };

  const normalizeEffectList = descriptor => {
    if (!descriptor) return [];
    const resolve = entry => {
      if (!entry) return null;
      if (typeof entry === "function") {
        try {
          const result = entry({ attacker: pl, target: null, primary: null, targets: [] });
          return result || null;
        } catch {
          return null;
        }
      }
      return entry;
    };
    const resolved = resolve(descriptor);
    if (!resolved) return [];
    return (Array.isArray(resolved) ? resolved : [resolved]).filter(Boolean);
  };

  const describeEffects = effects => {
    const effectList = normalizeEffectList(effects);
    if (effectList.length === 0) return "нет";
    return effectList
      .map(eff => {
        const name = eff.name || getEffectDefinition(eff.id)?.name || "Эффект";
        const turns = eff.duration ?? eff.remainingTurns;
        return turns ? `${name} (${formatTurns(turns)})` : name;
      })
      .join(", ");
  };

  const openAbilityInfo = ability => {
    if (!ability) return;
    const lines = [];
    const abilityType = ({ physical: 'Физическая', magical: 'Магическая', support: 'Поддержка' })[ability.type];
    if (abilityType) lines.push(`Тип: ${abilityType}`);
    if (ability.school) lines.push(`Школа: ${ability.school}`);
    if (ability.cooldown !== undefined) lines.push(`Перезарядка: ${formatTurns(ability.cooldown)}`);
    if (ability.damage)
      lines.push(`Базовый урон: ${typeof ability.damage === "function" ? "динамический" : ability.damage}`);
    const statusLines = [];
    const targetEffects = [...normalizeEffectList(ability.effect), ...normalizeEffectList(ability.effects)];
    const selfEffects = normalizeEffectList(ability.selfEffects);
    const allyEffects = normalizeEffectList(ability.allyEffects);
    if (targetEffects.length) statusLines.push(`Цель: ${describeEffects(targetEffects)}`);
    if (selfEffects.length) statusLines.push(`На себя: ${describeEffects(selfEffects)}`);
    if (allyEffects.length) statusLines.push(`Союзники: ${describeEffects(allyEffects)}`);
    if (statusLines.length) {
      lines.push(...statusLines);
    }

    setInfoModal({
      title: ability.name || "Способность",
      ability,
      bullets: lines,
    });
  };

  const openItemInfo = item => {
    if (!item) return;
    setInfoModal({ item });
  };

  const openEnemyInfo = (enemy, index) => {
    if (!enemy) return;
    setInspectedEnemyKey(getCombatUnitKey(enemy, index));
  };

  const renderEffectBadge = (effect, idx, ownerKey) => {
    const effectType = effect?.kind || effect?.type;
    const baseColor = effectType === "buff" ? "#1f4d2f" : effectType === 'debuff' ? "#4d1f1f" : '#252b30';
    const borderColor = effectType === "buff" ? "#2fa34d" : effectType === 'debuff' ? "#a33a3a" : '#66717a';
    const iconUrl = resolveEffectIconUrl(effect);
    const key = `${ownerKey}-${effect?.id || effect?.name || "effect"}-${idx}`;
    const duration = effect.remainingTurns;
    const title = [effect?.name || 'Эффект', effect.stacks > 1 ? `${effect.stacks} стака` : null,
      duration ? `осталось ${formatTurns(duration)}` : null, effect.unremovable ? 'Нельзя снять.' : null]
      .filter(Boolean).join(' — ');
    return (
      <span
        key={key}
        className={`status-icon status-icon--${effectType || 'resource'}${effect.unremovable ? ' status-icon--unremovable' : ''}${effectType === 'resource' ? ' status-icon--resource' : ''}`}
        style={{
          background: baseColor,
          borderColor,
          borderStyle: "solid",
          borderWidth: 1,
          color: "#fff",
        }}
        title={`${title}${effect?.description ? `\n${effect.description}` : ''}`}
        aria-label={title}
      >
        <span style={{ ...styles.effectFallback, opacity: iconUrl ? 0 : 1 }} data-fallback>
          {effect?.icon || "✨"}
        </span>
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={effect?.name || "Эффект"}
            style={styles.effectIconImage}
            onError={event => {
              const fallback = event.currentTarget.parentElement?.querySelector("[data-fallback]");
              if (fallback) fallback.style.opacity = 1;
              event.currentTarget.remove();
            }}
          />
        ) : null}
        {duration ? <b className="status-turn-count">{duration}</b> : null}
        {effect?.id?.startsWith("elemental_charge_") ? <b className="status-stack-count">{effect.stacks}/2</b> : effect?.stacks > 1 ? <b className="status-stack-count">{effect.stacks}</b> : null}
      </span>
    );
  };

  const renderEffectList = (effects, ownerKey, capacity, presentationMode) => {
    const presented = presentCombatStatuses(effects);
    if (presented.length === 0) return null;
    const { visible, hiddenCount } = getVisibleStatuses(presented, capacity);
    return (
      <div className={`status-overlay status-overlay--${presentationMode}`} aria-label={`${presented.length} активных эффектов`}>
        {visible.map((effect, idx) => renderEffectBadge(effect, idx, ownerKey))}
        {hiddenCount > 0 ? (
          <span className="status-overflow" title={`Ещё эффектов: ${hiddenCount}`}>+{hiddenCount}</span>
        ) : null}
      </div>
    );
  };

  const renderTurnMeter = (unit, variant = "player", unitPresentation = [], unitId = null) => {
    if (!unit) return null;
    const meter = Math.max(0, unit.turnMeter ?? 0);
    const percent = Math.max(0, Math.min(100, Math.round((meter / TURN_METER_THRESHOLD) * 100)));
    const fillColor = variant === "player" || variant === "ally" ? "#4da3ff" : "#d95959";
    const changes = unitPresentation.filter(event => event.type === "turnMeterChanged" && event.targetId === unitId);
    const tempoCues = unitPresentation.filter(event => (
      (event.type === "turnMeterSteal" || event.type === "turnIntercept") &&
      (event.actorId === unitId || event.targetId === unitId)
    ));
    return (
      <div className="compact-turn-meter">
        <div className="turn-track">
          <div
            className="turn-fill"
            style={{
              background: fillColor,
              width: `${percent}%`,
            }}
          />
          <span className="turn-meter-feedback-layer" aria-hidden="true">
            {changes.map(event => (
              <span
                key={event.id}
                className={`turn-meter-change is-${event.changeKind || (Number(event.delta) >= 0 ? "gain" : "loss")}`}
                style={{ animationDelay: `${event.at || 0}ms` }}
              >
                {Number(event.delta) >= 0 ? "+" : "−"}{Math.round(Math.abs(Number(event.delta) || 0) / 10)}%
              </span>
            ))}
            {tempoCues.map(event => {
              const acting = event.actorId === unitId;
              if (event.type === "turnIntercept" && !acting) {
                return <span key={event.id} className="turn-meter-special is-intercept-victim" style={{ animationDelay: `${event.at || 0}ms` }} />;
              }
              if (event.type === "turnMeterSteal" && !acting) {
                return <span key={event.id} className="turn-meter-special is-steal-victim" style={{ animationDelay: `${event.at || 0}ms` }} />;
              }
              return (
                <span
                  key={event.id}
                  className={`turn-meter-special ${event.type === "turnIntercept" ? "is-intercept" : "is-steal"}`}
                  style={{ animationDelay: `${event.at || 0}ms` }}
                >
                  {event.type === "turnIntercept" ? "ПЕРЕХВАТ" : `⇆ ${Math.round((Number(event.amount) || 0) / 10)}%`}
                </span>
              );
            })}
          </span>
        </div>
      </div>
    );
  };

  const renderUnitCard = ({ unit, index = 0, presentationIndex = index, side, logicalSlot, onSelect, onInspect }) => {
    const isPlayer = side === "player";
    const isEnemy = side === "enemy";
    const ownerKey = `${getCombatUnitKey(unit, index)}-effect`;
    const portrait = isEnemy
      ? resolveEnemyPortrait(unit)
      : isPlayer ? resolvePlayerPortrait(unit) : resolveAllyPortrait(unit);
    const portraitFallback = isEnemy
      ? COMBAT_ART_FALLBACKS.enemy
      : isPlayer ? COMBAT_ART_FALLBACKS.player : COMBAT_ART_FALLBACKS.ally;
    const statusCapacity = isEnemy ? enemyStatusPresentation.capacity : side === "ally" ? 6 : 10;
    const statusPresentationMode = isEnemy ? enemyStatusPresentation.mode : side;
    const targetSide = isEnemy ? "enemy" : "player";
    const targetId = getCombatTargetId(targetSide, index, unit);
    const unitId = getCombatUnitKey(unit, index);
    const dragTarget = findValidCombatTarget(dragState?.validTargets, targetId);
    const isValidTarget = Boolean(dragTarget);
    const isHoveredTarget = dragState?.hoveredId === targetId;
    const unitPresentation = presentationTimeline.filter(event => event.actorId === unitId || event.targetId === unitId);
    const entrancePhase = enteringEnemies[unitId];
    const isSummoning = Boolean(entrancePhase);
    const isOpeningEnemy = unitPresentation.some(event => (
      event.type === "openingEnemyAnticipation" && event.actorId === unitId
    ));
    const deathExit = unitPresentation.find(event => event.type === "removeFromPresentationRoster");
    const activateCard = () => {
      if (dragState?.keyboard && dragTarget) {
        setDragState(null);
        executeDroppedAction(dragState, dragTarget);
      } else if (onInspect) {
        onInspect();
      } else if (onSelect) {
        onSelect();
      }
    };
    const card = (
      <article
        key={!isEnemy ? targetId : undefined}
        className={`combat-unit-card is-${side}${unit.nonActingCombatObject ? " is-combat-object" : ""}${unit.hp <= 0 ? " is-defeated" : ""}${isValidTarget ? " is-valid-target" : ""}${isHoveredTarget ? " is-hovered-target" : ""}${isSummoning ? ` is-summoning is-entering-${entrancePhase}` : ""}${isOpeningEnemy ? " is-opening-enemy" : ""}${deathExit ? ` is-death-exiting${deathExit.boss ? " is-boss-death" : deathExit.summoned ? " is-summon-death" : ""}` : ""}`}
        style={deathExit ? {
          animationDelay: `${deathExit.exitAt}ms`,
          animationDuration: `${unit.nonActingCombatObject ? 180 : deathExit.exitDuration || COMBAT_PRESENTATION_TIMING.deathExit}ms`,
        } : undefined}
        data-combat-target={targetId}
        data-runtime-id={unitId}
        data-presentation-index={isEnemy ? presentationIndex : undefined}
        data-authoritative-index={isEnemy ? index : undefined}
        data-entrance-phase={entrancePhase || undefined}
        data-ally-slot={!isEnemy && side === "ally" ? logicalSlot : undefined}
        onClick={activateCard}
        onKeyDown={(isEnemy || isValidTarget || onInspect) ? event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activateCard();
          }
        } : undefined}
        role={(isEnemy || isValidTarget || onInspect) ? "button" : undefined}
        tabIndex={(isEnemy || isValidTarget || onInspect) ? 0 : undefined}
        aria-label={unit.name}
      >
        <div className="combat-presentation-layer" aria-hidden="true">
          {unitPresentation.map(event => {
            const delay = `${event.at}ms`;
            if (event.type === "actionStart" && event.actorId === unitId) {
              return (
                <span
                  key={event.id}
                  className={`combat-actor-focus is-${side}`}
                  style={{ animationDelay: delay }}
                />
              );
            }
            if (event.type === "procTriggered" && event.actorId === unitId) {
              if (event.procId === "undeath_echo") {
                return (
                  <React.Fragment key={event.id}>
                    <span className="combat-undeath-echo-vfx" style={{ animationDelay: delay }} />
                    <span className="combat-undeath-echo-cue" style={{ animationDelay: delay }}>
                      ◌ Эхо · {Math.round((Number(event.efficiency) || 0) * 100)}%
                    </span>
                  </React.Fragment>
                );
              }
              return (
                <span
                  key={event.id}
                  className={`combat-proc-cue is-${event.procKind || "passive"}`}
                  style={{ animationDelay: delay }}
                >
                  {event.label || "Срабатывание"}
                </span>
              );
            }
            if (event.type === "bossPhaseTransition" && event.targetId === unitId) {
              return (
                <span
                  key={event.id}
                  className="combat-boss-phase-cue"
                  style={{ animationDelay: delay }}
                >
                  <strong>{event.label || "Новая фаза"}</strong>
                  {event.subtitle ? <small>{event.subtitle}</small> : null}
                </span>
              );
            }
            if (event.targetId !== unitId) return null;
            if (event.type === "damage" || event.type === "shieldAbsorbed") {
              const sharesDamageImpact = event.type === "shieldAbsorbed" && presentationTimeline.some(candidate => (
                candidate.type === "damage" && candidate.targetId === unitId && candidate.at === event.at
              ));
              return (
                <React.Fragment key={event.id}>
                  {!sharesDamageImpact ? (
                    <span className={`combat-hit-reaction is-impact-${event.impactTier || "light"} is-flavor-${event.impactFlavor || "neutral"}${event.lethal ? " is-lethal" : ""}${event.deathSaveKind ? " is-death-save-threat" : ""}${event.blocked ? " is-blocked" : ""}`} style={{ animationDelay: delay }} />
                  ) : null}
                  {event.type === "damage" && Number(event.amount) > 0 ? (
                    <span
                      className={`combat-impact-vfx is-impact-${event.impactTier || "light"} is-${event.impactFlavor || "neutral"}${event.magicSchool ? ` is-school-${event.magicSchool}` : ""}`}
                      style={{ animationDelay: delay }}
                    />
                  ) : null}
                  <span className={`combat-float-number ${event.type === "damage" ? "is-damage" : "is-absorbed"} is-impact-${event.impactTier || "light"} is-flavor-${event.impactFlavor || "neutral"}${event.blocked ? " is-blocked" : ""}`} style={{ animationDelay: `${event.at + IMPACT_NUMBER_DELAY}ms` }}>
                    {event.blocked ? "Блок" : event.type === "damage" ? `-${event.amount}` : `-${event.amount} Щит`}
                  </span>
                </React.Fragment>
              );
            }
            if (event.type === "deathSaveResolved") {
              return (
                <span
                  key={event.id}
                  className={`combat-death-save-resolve is-${event.deathSaveKind || "passive"}`}
                  style={{ animationDelay: delay }}
                />
              );
            }
            if (event.type === "death") {
              return (
                <span
                  key={event.id}
                  className={`combat-death-reaction${event.targetAfter?.boss || event.targetAfter?.isBoss ? " is-boss" : event.targetAfter?.summoned ? " is-summon" : ""}`}
                  style={{
                    animationDelay: delay,
                    animationDuration: event.targetAfter?.boss || event.targetAfter?.isBoss
                      ? `${COMBAT_PRESENTATION_TIMING.bossDeathReactionDuration}ms`
                      : event.targetAfter?.summoned
                      ? `${COMBAT_PRESENTATION_TIMING.summonDeathReactionDuration}ms`
                      : `${COMBAT_PRESENTATION_TIMING.deathReactionDuration}ms`,
                  }}
                />
              );
            }
            if (event.type === "heal" || event.type === "shieldGain") {
              const positiveVfxKind = getCombatPositiveVfxKind(event);
              const maxHp = Number(event.targetAfter?.maxHp || event.target?.maxHp || 0);
              const minor = event.type === "heal" && maxHp > 0 && Number(event.amount) / maxHp <= 0.06;
              return (
                <React.Fragment key={event.id}>
                  {positiveVfxKind ? (
                    <span
                      className={`combat-positive-vfx is-${positiveVfxKind}${minor ? " is-minor" : ""}`}
                      style={{ animationDelay: delay }}
                    />
                  ) : null}
                  <span className={`combat-float-number ${event.type === "heal" ? "is-heal" : "is-shield"}`} style={{ animationDelay: delay }}>
                    {event.type === "heal" ? `+${event.amount}` : `+${event.amount} Щит`}
                  </span>
                </React.Fragment>
              );
            }
            if (
              event.type === "statusApplied" ||
              event.type === "statusTriggered" ||
              event.type === "statusBlocked" ||
              event.type === "statusCleanse"
            ) {
              const operation = event.statusOperation || (
                event.type === "statusTriggered" ? "trigger" :
                event.type === "statusBlocked" ? "blocked" :
                event.type === "statusCleanse" ? "cleanse" :
                "apply"
              );
              const label = event.label || "Эффект";
              const text = operation === "stack"
                ? `${label} +1`
                : operation === "refresh"
                ? `${label} ↻`
                : operation === "trigger"
                ? label
                : operation === "blocked"
                ? `Блок: ${label}`
                : operation === "cleanse"
                ? `Снято: ${label}`
                : label;
              const statusVfxKind = operation === "apply" || operation === "trigger"
                ? getCombatStatusVfxKind(event.effectId)
                : null;
              const positiveVfxKind = getCombatPositiveVfxKind({ ...event, statusOperation: operation });
              return (
                <React.Fragment key={event.id}>
                  {positiveVfxKind ? (
                    <span
                      className={`combat-positive-vfx is-${positiveVfxKind}`}
                      style={{ animationDelay: delay }}
                    />
                  ) : null}
                  {statusVfxKind ? (
                    <span
                      className={`combat-status-vfx is-${statusVfxKind} is-${operation}`}
                      style={{ animationDelay: delay }}
                    />
                  ) : null}
                  <span
                    className={`combat-status-applied is-${operation}${event.effectType ? ` is-${event.effectType}` : ""}`}
                    style={{ animationDelay: delay }}
                  >
                    {text}
                  </span>
                </React.Fragment>
              );
            }
            return null;
          })}
        </div>
        <div className="unit-portrait">
          {portrait ? (
            <img
              src={portrait}
              alt={unit.name}
              onError={event => applyCombatArtFallback(event, portraitFallback)}
            />
          ) : null}
          {portrait ? unitPresentation
            .filter(event => event.type === "actionStart" && event.actorId === unitId)
            .map(event => (
              <React.Fragment key={event.id}>
                <img
                  className={`combat-actor-portrait-zoom is-${side}`}
                  src={portrait}
                  alt=""
                  aria-hidden="true"
                  style={{ animationDelay: `${event.at}ms` }}
                  onError={errorEvent => { errorEvent.currentTarget.style.display = "none"; }}
                />
                {(isEnemy || side === 'ally') ? (
                  <span className="combat-enemy-action-icon" style={{ animationDelay: `${event.at}ms` }}>
                    <img
                      src={resolveAbilityIcon({ artId: getEnemyActionPresentationArtId(event.action) })}
                      alt=""
                      aria-hidden="true"
                      onError={errorEvent => { errorEvent.currentTarget.style.display = "none"; }}
                    />
                    <strong className="combat-presented-action-name">{event.action?.name || 'Действие'}</strong>
                  </span>
                ) : null}
              </React.Fragment>
            )) : null}
          <div className="unit-name-row">
            {isPlayer ? <strong className="unit-name" title={unit.name}>{unit.name}</strong> : null}
          </div>
          {renderEffectList(unit.effects, ownerKey, statusCapacity, statusPresentationMode)}
        </div>
        <CombinedHealthBar unit={unit} impactEvents={unitPresentation.filter(event => event.targetId === unitId)} />
        {renderTurnMeter(unit, side === 'ally' ? 'ally' : isPlayer ? "player" : "enemy", unitPresentation, unitId)}
      </article>
    );
    if (!isEnemy) return card;
    return (
      <div
        key={unitId}
        className="combat-unit-slot"
        ref={element => {
          if (element) enemyCardRefs.current.set(unitId, element);
          else enemyCardRefs.current.delete(unitId);
        }}
        data-runtime-id={unitId}
        data-presentation-index={presentationIndex}
        data-authoritative-index={index}
        data-enemy-slot={logicalSlot}
      >
        {card}
      </div>
    );
  };

  return (
    <div
      className="battle-screen"
      style={{
        "--combat-actor-focus-duration": `${COMBAT_PRESENTATION_TIMING.actorFocus}ms`,
        "--combat-actor-portrait-duration": `${COMBAT_PRESENTATION_TIMING.actorPortraitZoom}ms`,
        "--combat-health-segment-duration": `${COMBAT_PRESENTATION_TIMING.healthSegmentDuration}ms`,
        "--combat-health-trail-duration": `${COMBAT_PRESENTATION_TIMING.healthTrailDuration}ms`,
        "--combat-shield-impact-duration": `${COMBAT_PRESENTATION_TIMING.shieldImpactDuration}ms`,
        "--combat-shield-break-duration": `${COMBAT_PRESENTATION_TIMING.shieldBreakDuration}ms`,
        "--combat-floating-duration": `${COMBAT_PRESENTATION_TIMING.floatingDuration}ms`,
        "--combat-status-duration": `${COMBAT_PRESENTATION_TIMING.statusDuration}ms`,
        "--combat-status-vfx-duration": `${COMBAT_PRESENTATION_TIMING.statusVfxDuration}ms`,
        "--combat-positive-vfx-duration": `${COMBAT_PRESENTATION_TIMING.positiveVfxDuration}ms`,
        "--combat-turn-meter-feedback-duration": `${COMBAT_PRESENTATION_TIMING.turnMeterFeedbackDuration}ms`,
        "--combat-proc-duration": `${COMBAT_PRESENTATION_TIMING.procDuration}ms`,
        "--combat-death-save-duration": `${COMBAT_PRESENTATION_TIMING.deathSaveResolveDuration}ms`,
        "--combat-death-reaction-duration": `${COMBAT_PRESENTATION_TIMING.deathReactionDuration}ms`,
        "--combat-boss-phase-duration": `${COMBAT_PRESENTATION_TIMING.bossPhaseDuration}ms`,
        "--combat-boss-death-duration": `${COMBAT_PRESENTATION_TIMING.bossDeathReactionDuration}ms`,
        "--combat-enemy-icon-duration": `${COMBAT_PRESENTATION_TIMING.enemyActionIconDuration}ms`,
        "--combat-summon-accent-duration": `${COMBAT_PRESENTATION_TIMING.summonAccentDuration}ms`,
      }}
    >
      <ArtLoadingOverlay visible={initialSceneImages === null || !combatArtReady} label="Подготавливаем бой…" />
      <button type="button" className="combat-log-utility" onClick={() => setIsLogOpen(true)} aria-label="Открыть лог боя">☷</button>
      <main
        className={`battlefield${pendingBattleResult ? " has-battle-result" : ""}`}
        aria-hidden={pendingBattleResult ? true : undefined}
        inert={pendingBattleResult ? "" : undefined}
      >
        <section className="battle-region enemy-region" aria-label="Враги">
          <div className={`enemy-party enemy-party-${enemyBattlefieldLayout.mode} enemy-count-${displayedEnemies.length}`}>
            {displayedEnemies.map((en, i) => {
              const presentationIndex = en.presentationIndex ?? i;
              const runtimeId = getCombatUnitKey(en, presentationIndex);
              const authoritativeIndex = (s.enemies || []).findIndex((enemy, index) => (
                getCombatUnitKey(enemy, index) === runtimeId
              ));
              return renderUnitCard({
                unit: en,
                index: authoritativeIndex >= 0 ? authoritativeIndex : presentationIndex,
                presentationIndex,
                side: "enemy",
                logicalSlot: enemyBattlefieldLayout.slots[i],
                onSelect: () => {
                  if (!presentationLockedRef.current && !battleEndedRef.current && authoritativeIndex >= 0) {
                    setSelectedTarget(authoritativeIndex);
                  }
                },
                onInspect: () => openEnemyInfo(en, authoritativeIndex >= 0 ? authoritativeIndex : presentationIndex),
              });
            })}
          </div>
        </section>

        <section className="lower-combat-region" aria-label="Герой и боевые действия">
          <div className="player-action-row">
            <div className="player-party">
            {renderUnitCard({ unit: displayedPlayer, side: "player", onInspect: () => setIsPlayerDetailsOpen(true) })}

            </div>
      <section className="action-area" aria-label="Боевые действия">
        <div className="drag-instruction">Перетащите действие на подсвеченную цель</div>
        <div className={`combat-action-grid${combatActionsInactive ? " is-inactive" : ""}`}>
          {visibleAbilities.map((ab, i) => {
            const unavailable = typeof ab.canUse === "function" && !ab.canUse({ attacker: displayedPlayer, session });
            const disabled = battleEndedRef.current || presentationLocked || unavailable || (ab.currentCooldown ?? 0) > 0 || session.state.initiative?.playerReady === false;
            const abilityIcon = resolveAbilityIcon(ab);
            const cooldownFraction = getCooldownPresentationFraction(ab);
            const descriptor = {
              kind: "ability",
              ability: ab,
              action: ab,
              label: ab.name,
              previewIcon: abilityIcon,
              disabled,
            };
            return (
            <div key={i} className="ability-choice">
              <button
                type="button"
                className={`drag-action-button ability-action-button${dragState?.moved && dragState?.ability === ab ? " is-dragging" : ""}`}
                aria-label={`${ab.name}${unavailable ? `, ${ab.disabledReason || "Недоступно"}` : ""}${(ab.currentCooldown ?? 0) > 0 ? `, Перезарядка: ${ab.currentCooldown}` : ""}`}
                title={unavailable ? ab.disabledReason : undefined}
                style={selectedAbility?.name === ab.name ? styles.selected : undefined}
                aria-disabled={disabled}
                onPointerDown={event => {
                  setSelectedAbility(ab);
                  if (!disabled) beginActionDrag(event, descriptor);
                }}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (disabled) openAbilityInfo(ab);
                    else { setSelectedAbility(ab); beginKeyboardTargeting(descriptor); }
                  }
                }}
                onClick={() => {
                  if (Date.now() < suppressClickUntilRef.current) return;
                  openAbilityInfo(ab);
                }}
              >
                {abilityIcon ? (
                  <img
                    className="ability-action-art gameplay-drag-art"
                    src={abilityIcon}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    onDragStart={event => event.preventDefault()}
                    onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.ability)}
                  />
                ) : null}
                {cooldownFraction > 0 ? (
                  <span
                    className="ability-cooldown-mask"
                    style={{ "--cooldown-sweep": `${cooldownFraction}turn` }}
                    aria-hidden="true"
                  />
                ) : null}
                {ab.currentCooldown > 0 ? (
                  <span className="ability-cooldown-badge" aria-label={`Перезарядка: ${ab.currentCooldown}`}>
                    {ab.currentCooldown}
                  </span>
                ) : null}
              </button>
            </div>
          );})}
          {(() => {
            const definition = selectedQuickItem
              ? (selectedQuickItem.activeEquipment ? selectedQuickItem.item || {} : getItemDefinition(selectedQuickItem.name) || {})
              : {};
            const dragDisabled = battleEndedRef.current || presentationLocked || !selectedQuickItem || session.state.initiative?.playerReady === false;
            const itemIcon = selectedQuickItem
              ? (selectedQuickItem.activeEquipment
                ? resolveItemArt({ name: selectedQuickItem.name })
                : resolveCombatItemIcon(definition))
              : null;
            const descriptor = {
              kind: "item",
              itemName: selectedQuickItem?.name,
              action: { ...definition, target: definition.target || "self" },
              label: selectedQuickItem
                ? (selectedQuickItem.activeEquipment ? selectedQuickItem.name : `${selectedQuickItem.name} ×${selectedQuickItem.quantity}`)
                : "Пусто",
              previewIcon: itemIcon,
              disabled: dragDisabled,
            };
            return (
              <button
                type="button"
                className={`drag-action-button quick-item-button${selectedQuickItem ? " is-assigned" : " is-empty"}`}
                onPointerDown={event => beginActionDrag(event, descriptor)}
                onClick={() => {
                  if (Date.now() < suppressClickUntilRef.current) return;
                  setIsItemModalOpen(true);
                }}
                aria-label={selectedQuickItem
                  ? (selectedQuickItem.activeEquipment
                    ? `Активная экипировка: ${selectedQuickItem.name}`
                    : `Быстрый предмет: ${selectedQuickItem.name}, ${selectedQuickItem.quantity} шт.`)
                  : "Выбрать быстрый предмет"}
                aria-disabled={dragDisabled}
              >
                {itemIcon ? (
                  <img
                    className="quick-item-art gameplay-drag-art"
                    src={itemIcon}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    onDragStart={event => event.preventDefault()}
                    onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.item)}
                  />
                ) : (
                  <span className="quick-item-empty-art" aria-hidden="true">◇</span>
                )}
                {!selectedQuickItem && <span className="ability-action-label">Предмет</span>}
                {selectedQuickItem && !selectedQuickItem.activeEquipment ? (
                  <span className="quick-item-quantity-badge item-icon-quantity" aria-label={`Количество: ${selectedQuickItem.quantity}`}>
                    {selectedQuickItem.quantity}
                  </span>
                ) : null}
              </button>
            );
          })()}
        </div>
        {auxiliaryStates.traps.length > 0 ? <section className="combat-auxiliary-zone" aria-label="Активные ловушки">
          <h3>Активные ловушки</h3>
          <div className="combat-auxiliary-list">{auxiliaryStates.traps.map(entry => {
            const ability = createAbilityByName(entry.abilityName);
            return <button type="button" className="combat-auxiliary-card is-trap" key={entry.id} onClick={() => openAbilityInfo(ability)} aria-label={`${entry.abilityName}. ${entry.label}`}>
              <img src={resolveAbilityIcon(ability)} alt="" aria-hidden="true" onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.ability)} />
              <span className="temporary-entity-status" data-status-kind={entry.statusKind}><small>{entry.label}</small></span>
            </button>;
          })}</div>
        </section> : null}
        {auxiliaryStates.temporarySummons.length > 0 ? <section className="combat-auxiliary-zone is-temporary" aria-label="Временные призывы">
          <h3>Временные призывы</h3>
          <div className="combat-auxiliary-list">{auxiliaryStates.temporarySummons.map(entry => {
            const ability = createAbilityByName(entry.abilityName);
            const portrait = entry.id === 'snake_trap' ? resolveAllyPortrait({ allyPortraitKey: 'summons/archer/snake_trap_support' }) : resolveAbilityIcon(ability);
            return <button type="button" className="combat-auxiliary-card is-temporary" key={entry.id} onClick={() => openAbilityInfo(ability)} aria-label={`${entry.abilityName}. ${entry.label}`}>
              <img src={portrait} alt="" aria-hidden="true" onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.ally)} />
              <span className="temporary-entity-status" data-status-kind={entry.statusKind}><small>{entry.label}</small></span>
            </button>;
          })}</div>
        </section> : null}
        {onExit ? <div className="battle-action-row">
            <button style={styles.button} onClick={onExit}>Выйти из тестового боя</button>
        </div> : null}
      </section>
          </div>
        </section>
        <div className={`ally-party ally-party-${allyBattlefieldLayout.mode}`} aria-label="Союзники">
          {visibleAllies.map((ally, index) => renderUnitCard({
            unit: ally,
            index: index + 1,
            side: "ally",
            logicalSlot: allyBattlefieldLayout.slots[index],
            onInspect: () => setInspectedAllyId(ally.id),
          }))}
        </div>
      </main>
      {pendingBattleResult && typeof document !== "undefined" ? createPortal(
        <div className={`combat-result-overlay${pendingBattleResult.outcome === "victory" && onVictorySplashComplete ? " is-victory-splash" : ""}`} role="dialog" aria-modal="true" aria-labelledby="combat-result-title">
          <div className="combat-result-backdrop" aria-hidden="true" />
          {pendingBattleResult.outcome === "victory" && onVictorySplashComplete ?
            <h2 id="combat-result-title" className="combat-victory-splash-title">Победа</h2>
          : <section className={`combat-result-panel is-${pendingBattleResult.outcome}`}>
            <h2 id="combat-result-title" className="combat-result-title">
              {pendingBattleResult.outcome === "victory" ? "Победа" : "Поражение"}
            </h2>
            {pendingBattleResult.outcome === "victory" ? (
              <div className="combat-result-loot" aria-label="Награды">
                <h3>Награды</h3>
                {Number(pendingBattleResult.loot?.resonance) > 0 ? <p className="abyss-resonance-reward">+{pendingBattleResult.loot.resonance} Резонанса Бездны</p> : null}
                {resultLootGroups.length ? resultLootGroups.map(group => {
                  const icon = resolveItemArt({ name: group.name });
                  return (
                    <div key={group.key} className="combat-result-loot-item">
                      {icon ? (
                        <img
                          src={icon}
                          alt=""
                          aria-hidden="true"
                          onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.item)}
                        />
                      ) : null}
                      <span>{group.name}</span>
                      {group.quantity > 1 ? <strong>×{group.quantity}</strong> : null}
                    </div>
                  );
                }) : <p className="combat-result-empty">Награды нет</p>}
              </div>
            ) : (
              <p className="combat-result-message">Поход завершён.</p>
            )}
            <div className="combat-result-actions">
              <button type="button" onClick={continueBattleResult}>Продолжить</button>
            </div>
          </section>}
        </div>,
        document.body
      ) : null}
      {dragState?.moved ? (
        <div
          className={`action-drag-ghost${dragState.previewIcon ? " has-art" : ""}`}
          style={{ left: dragState.x, top: dragState.y }}
        >
          {dragState.previewIcon ? (
            <img
              src={dragState.previewIcon}
              alt=""
              aria-hidden="true"
              draggable={false}
              onError={event => {
                event.currentTarget.style.display = "none";
                setDragState(current => current ? { ...current, previewIcon: null } : current);
              }}
            />
          ) : dragState.label}
        </div>
      ) : null}

      {isLogOpen && (
        <div style={styles.modalOverlay} onClick={() => setIsLogOpen(false)}>
          <div className="combat-log-modal" onClick={event => event.stopPropagation()}>
            <div className="combat-log-header">
              <h3>Лог боя</h3>
              <button style={styles.button} onClick={() => setIsLogOpen(false)}>Закрыть</button>
            </div>
            <div ref={logRef} className="battle-log">
              {s.log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isItemModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setIsItemModalOpen(false)}>
          <div style={styles.itemModalContent} onClick={event => event.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Выберите предмет</h3>
            {blackVeinLantern ? (
              <div style={styles.itemRow}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <strong>{blackVeinLantern.name}</strong>
                    <div style={styles.itemDescription}>
                      Режим: {pl._blackVeinLanternEnabled ? 'включён' : 'выключен'}. Переключение бесплатное и не расходует использование предмета.
                    </div>
                  </div>
                  <button
                    type="button"
                    style={styles.button}
                    aria-pressed={Boolean(pl._blackVeinLanternEnabled)}
                    disabled={combatActionsInactive}
                    onClick={handleToggleBlackVeinLantern}
                  >
                    {pl._blackVeinLanternEnabled ? 'Выключить' : 'Включить'}
                  </button>
                </div>
              </div>
            ) : null}
            {combatItemGroups.length === 0 ? (
              blackVeinLantern ? null : <div style={styles.modalSection}>Нет предметов, доступных в бою.</div>
            ) : (
              <div className="combat-quick-item-picker" data-columns="3">
              {combatItemGroups.map(group => (
                <div key={group.key} className={`combat-quick-item-picker__entry${selectedQuickItemKey === group.key ? ' is-selected' : ''}`}>
                  <button
                    type="button"
                    className="combat-quick-item-picker__select"
                    aria-label={`Назначить: ${group.name}`}
                    title={`${group.name} — ${combatItemConsumesTurn(group.name) ? "Завершает ход" : "Без траты хода"}`}
                    aria-pressed={selectedQuickItemKey === group.key}
                    onClick={() => {
                      setSelectedQuickItemKey(current => selectCombatQuickItem(current, group.key));
                      setIsItemModalOpen(false);
                    }}
                  >
                    {(() => {
                      const icon = group.activeEquipment
                        ? resolveItemArt({ name: group.name })
                        : resolveCombatItemIcon(getItemDefinition(group.name));
                      return icon ? (
                        <img
                          className="combat-item-list-art"
                          src={icon}
                          alt=""
                          aria-hidden="true"
                          onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.item)}
                        />
                      ) : <span className="quick-item-empty-art" aria-hidden="true">◇</span>;
                    })()}
                    {!group.activeEquipment ? (
                      <strong className="combat-quick-item-picker__quantity item-icon-quantity">{group.quantity}</strong>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="compact-info-button combat-quick-item-picker__info item-icon-info"
                    aria-label={`Подробнее: ${group.name}`}
                    onClick={event => { event.stopPropagation(); openItemInfo(group.item); }}
                  >i</button>
                  {!group.activeEquipment && <small>{combatItemConsumesTurn(group.name) ? "За ход" : "Без траты хода"}</small>}
                </div>
              ))}
              </div>
            )}
            <button style={styles.button} onClick={() => setIsItemModalOpen(false)}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {inspectedEnemyKey && portalCombatDetail(
        <div
          className="enemy-detail-overlay"
          onMouseDown={event => { if (event.target === event.currentTarget) setInspectedEnemyKey(null); }}
        >
          <EnemyDetailCard
            key={inspectedEnemyKey}
            enemy={inspectedEnemy}
            onClose={() => setInspectedEnemyKey(null)}
          />
        </div>
      )}

      {isPlayerDetailsOpen && portalCombatDetail(
        <div className="enemy-detail-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setIsPlayerDetailsOpen(false); }}>
          <PlayerCombatDetailsCard player={pl} sourcePlayer={player} onClose={() => setIsPlayerDetailsOpen(false)} />
        </div>
      )}
      {inspectedAllyId && (() => {
        const ally = (s.players || []).find(unit => unit?.id === inspectedAllyId);
        return ally ? portalCombatDetail(<div className="enemy-detail-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setInspectedAllyId(null); }}>
          <PlayerCombatDetailsCard player={ally} sourcePlayer={ally} summon onClose={() => setInspectedAllyId(null)} />
        </div>) : null;
      })()}

      {infoModal?.item ? (
        <ItemDetailsModal item={infoModal.item} context={{ inCombat: true }} onClose={() => setInfoModal(null)} />
      ) : infoModal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>{infoModal.title}</h3>
            {infoModal.ability?.description ? (
              <AbilityDescription ability={infoModal.ability} compact showHeader />
            ) : null}
            {infoModal.bullets?.length ? (
              <div style={styles.modalSection}>
                {infoModal.bullets.map((line, idx) => (
                  <div key={idx} style={{ marginBottom: 6 }}>
                    {line}
                  </div>
                ))}
              </div>
            ) : null}
            {infoModal.extraList?.length ? (
              <div style={styles.modalSection}>
                <strong>Способности:</strong>
                <div style={{ marginTop: 6 }}>
                  {infoModal.extraList.map((name, idx) => (
                    <span key={idx} style={styles.pill}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <button style={styles.button} onClick={() => setInfoModal(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export { reviveCombatSession, reviveUnit, reviveAbility } from '../utils/combatHydration';
export { snapshotCombatSession } from "../utils/combatSnapshot";
