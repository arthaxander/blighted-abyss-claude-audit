import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MINIGAME_PHASE, MINIGAME_RESULT } from '../minigames/lifecycle';
import {
  LOCKPICK_CONFIG, chooseTargetAngle, findHittableTarget, getTargetWidthAtTime, pointerAngleAt,
  removeExpiredTargets, reversePointerAt, spawnIntervalMs, stopAndRecoverPointerAt,
} from '../minigames/lockpickConfig';
import './LockpickMinigame.css';

const now = () => performance.now();

export const targetOpacityAt = (target, timestamp, fadeInMs, fadeOutMs) => {
  if (timestamp >= target.expiresAt) return 0;
  const age = timestamp - target.spawnTime;
  if (age < fadeInMs) return Math.max(0, age / fadeInMs);
  const remaining = target.expiresAt - timestamp;
  if (remaining < fadeOutMs) return 0.45 + 0.55 * Math.max(0, remaining / fadeOutMs);
  return 1;
};

export const targetArcRotation = (target, widthDegrees) => target.angle - widthDegrees / 2 - 90;

const LockpickMinigame = ({ onSuccess, onFail, config = LOCKPICK_CONFIG, random = Math.random }) => {
  const [phase, setPhase] = useState(MINIGAME_PHASE.READY);
  const [hits, setHits] = useState(0);
  const [timeLeft, setTimeLeft] = useState(config.timeLimitMs);
  const [activeTargets, setActiveTargets] = useState([]);
  const [pointerAngle, setPointerAngle] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [hitFx, setHitFx] = useState(null);
  const model = useRef({ baseAngle: 0, startedAt: 0, direction: 1, deadline: 0, nextSpawnAt: 0 });
  const phaseRef = useRef(MINIGAME_PHASE.READY);
  const hitsRef = useRef(0);
  const targetsRef = useRef([]);
  const nextTargetId = useRef(1);
  const resolvedRef = useRef(false);
  const mountedRef = useRef(true);
  const timersRef = useRef(new Set());
  const initialWidthDegrees = config.initialTargetWidthDeg;
  const lifetimeMs = config.targetLifetimeMs;

  const schedule = useCallback((callback, delay) => {
    const id = setTimeout(() => { timersRef.current.delete(id); callback(); }, delay);
    timersRef.current.add(id);
  }, []);
  const changePhase = useCallback(next => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);
  const publishTargets = useCallback(targets => {
    targetsRef.current = targets;
    if (mountedRef.current) setActiveTargets(targets);
  }, []);
  const finish = useCallback(result => {
    if (resolvedRef.current || phaseRef.current !== MINIGAME_PHASE.PLAYING) return;
    resolvedRef.current = true;
    changePhase(result === MINIGAME_RESULT.SUCCESS ? MINIGAME_PHASE.SUCCESS : MINIGAME_PHASE.FAILURE);
    schedule(() => {
      changePhase(MINIGAME_PHASE.FINISHING);
      if (result === MINIGAME_RESULT.SUCCESS) onSuccess?.(result);
      else onFail?.(result);
    }, config.resultFadeInMs + config.resultHoldMs + config.resultFadeOutMs);
  }, [changePhase, config, onFail, onSuccess, schedule]);

  useEffect(() => () => {
    mountedRef.current = false;
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  const trySpawn = useCallback((timestamp, angle) => {
    if (targetsRef.current.length >= config.maxActiveTargets) return;
    const targetAngle = chooseTargetAngle({
      activeTargets: targetsRef.current.map(target => ({
        ...target, widthDegrees: getTargetWidthAtTime(target, timestamp, config),
      })), pointerAngle: angle, arcDegrees: initialWidthDegrees,
      minGapDegrees: config.minTargetGapDegrees,
      pointerExclusionDegrees: config.spawnPointerExclusionDegrees,
      random, maxAttempts: config.spawnPositionAttempts,
    });
    if (targetAngle === null) return;
    publishTargets([...targetsRef.current, {
      id: nextTargetId.current++, angle: targetAngle,
      spawnTime: timestamp, expiresAt: timestamp + lifetimeMs, state: 'active',
    }]);
  }, [config, initialWidthDegrees, lifetimeMs, publishTargets, random]);

  useEffect(() => {
    if (phase !== MINIGAME_PHASE.PLAYING) return undefined;
    let frame;
    const tick = () => {
      if (phaseRef.current !== MINIGAME_PHASE.PLAYING) return;
      const timestamp = now();
      setFrameTime(timestamp);
      const remaining = Math.max(0, model.current.deadline - timestamp);
      setTimeLeft(remaining);
      if (remaining <= 0) { finish(MINIGAME_RESULT.FAILURE); return; }
      const angle = pointerAngleAt({ ...model.current, now: timestamp, rotationDurationMs: config.rotationDurationMs });
      setPointerAngle(angle);
      const liveTargets = removeExpiredTargets(targetsRef.current, timestamp);
      if (liveTargets.length !== targetsRef.current.length) publishTargets(liveTargets);
      if (timestamp >= model.current.nextSpawnAt) {
        trySpawn(timestamp, angle);
        model.current.nextSpawnAt = timestamp + spawnIntervalMs(config, random);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [config, finish, phase, publishTargets, random, trySpawn]);

  const start = useCallback(event => {
    event.preventDefault();
    event.stopPropagation();
    if (phaseRef.current !== MINIGAME_PHASE.READY) return;
    changePhase(MINIGAME_PHASE.STARTING);
    schedule(() => {
      const timestamp = now();
      model.current = {
        baseAngle: 0, startedAt: timestamp, direction: 1,
        deadline: timestamp + config.timeLimitMs, nextSpawnAt: timestamp,
      };
      changePhase(MINIGAME_PHASE.PLAYING);
    }, config.startingDelayMs);
  }, [changePhase, config, schedule]);

  const haptic = useCallback(type => {
    const api = window.Telegram?.WebApp?.HapticFeedback;
    if (type === 'hit') api?.impactOccurred?.('medium');
    else api?.notificationOccurred?.('error');
  }, []);

  const tap = useCallback(event => {
    event.preventDefault();
    if (phaseRef.current !== MINIGAME_PHASE.PLAYING || resolvedRef.current) return;
    const timestamp = now();
    if (timestamp >= model.current.deadline) { finish(MINIGAME_RESULT.FAILURE); return; }
    const angle = pointerAngleAt({ ...model.current, now: timestamp, rotationDurationMs: config.rotationDurationMs });
    setPointerAngle(angle);
    const liveTargets = removeExpiredTargets(targetsRef.current, timestamp);
    const target = findHittableTarget(liveTargets, angle, timestamp, config);
    if (!target) {
      if (liveTargets.length !== targetsRef.current.length) publishTargets(liveTargets);
      model.current.deadline -= config.missTimePenaltyMs;
      model.current = stopAndRecoverPointerAt(model.current, timestamp, config.rotationDurationMs, config);
      const remaining = Math.max(0, model.current.deadline - timestamp);
      setTimeLeft(remaining);
      setFeedback('miss');
      haptic('miss');
      schedule(() => setFeedback(''), 260);
      if (remaining <= 0) finish(MINIGAME_RESULT.FAILURE);
      return;
    }
    model.current = reversePointerAt(model.current, timestamp, config.rotationDurationMs);
    publishTargets(liveTargets.filter(item => item.id !== target.id));
    const nextHits = hitsRef.current + 1;
    hitsRef.current = nextHits;
    setHits(nextHits);
    setFeedback(nextHits === config.requiredHits ? 'final-hit' : 'hit');
    setHitFx({ id: target.id, angle: target.angle });
    haptic('hit');
    schedule(() => { setFeedback(''); setHitFx(null); }, 320);
    if (nextHits >= config.requiredHits) finish(MINIGAME_RESULT.SUCCESS);
  }, [config, finish, haptic, publishTargets, schedule]);

  const resultVisible = phase === MINIGAME_PHASE.SUCCESS || phase === MINIGAME_PHASE.FAILURE;
  return <section className={`lockpick lockpick--${feedback || 'idle'}`} aria-label="Взлом замка сокровищницы"
    data-phase={phase} data-direction={model.current.direction} onPointerDown={tap}>
    <div className="lockpick__decor" data-layer="lock_background/decor" />
    <header className="lockpick__hud">
      <div><span>ШТИФТЫ</span><strong>{hits} / {config.requiredHits}</strong></div>
      <div><span>ВРЕМЯ</span><strong aria-label="Оставшееся время">{(timeLeft / 1000).toFixed(1)}</strong></div>
    </header>
    <main className="lockpick__playfield" aria-label="Игровая область">
      <p className="lockpick__instruction">Коснитесь экрана, когда острие войдёт в любой светящийся сектор</p>
      <div className="lockpick__mechanism">
        <div className="lockpick__outer" data-layer="lock_outer_frame" />
        <svg className="lockpick__targets" data-layer="target_svg_overlay" viewBox="0 0 100 100"
          aria-hidden="true">
          {activeTargets.map(target => {
            const widthDegrees = getTargetWidthAtTime(target, frameTime, config);
            return <circle key={target.id} className="lockpick__sector"
            data-testid="active-target" data-id={target.id} data-center={target.angle}
            data-width={widthDegrees} data-spawn-time={target.spawnTime} data-expires-at={target.expiresAt}
            cx="50" cy="50" r="43" pathLength="360" fill="none"
            strokeDasharray={`${widthDegrees} ${360 - widthDegrees}`}
            strokeLinecap="butt"
            transform={`rotate(${targetArcRotation(target, widthDegrees)} 50 50)`}
            opacity={targetOpacityAt(target, frameTime, config.targetFadeInMs, config.targetFadeOutMs)} />;
          })}
        </svg>
        <div className="lockpick__inner" data-layer="lock_inner_ring" />
        <div className="lockpick__pointer" data-layer="lock_pointer" data-testid="lock-pointer" style={{ transform: `rotate(${pointerAngle}deg)` }}><i /></div>
        <div className="lockpick__center" data-layer="lock_center"><span>✦</span></div>
        {hitFx && <div key={hitFx.id} className="lockpick__hit-fx" style={{ '--hit-angle': `${hitFx.angle}deg` }} />}
        <div className="lockpick__flash" />
      </div>
    </main>
    {phase === MINIGAME_PHASE.READY && <div className="lockpick__ready" onPointerDown={event => event.stopPropagation()}>
      <div><h1>ЗАМОК СОКРОВИЩНИЦЫ</h1><p>Четыре точных движения откроют механизм</p>
        <button type="button" onPointerDown={start}>НАЧАТЬ</button></div>
    </div>}
    {phase === MINIGAME_PHASE.STARTING && <div className="lockpick__starting" aria-hidden="true" />}
    {resultVisible && <div className={`lockpick__result lockpick__result--${phase.toLowerCase()}`} aria-live="assertive">
      <strong>{phase === MINIGAME_PHASE.SUCCESS ? 'УСПЕХ' : 'ПРОВАЛ'}</strong>
    </div>}
    {phase === MINIGAME_PHASE.FINISHING && <div className="lockpick__blocker" />}
  </section>;
};

export default LockpickMinigame;
