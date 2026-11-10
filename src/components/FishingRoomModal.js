import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MINIGAME_PHASE, MINIGAME_RESULT } from '../minigames/lifecycle';
import {
  buildFishingConfig, createFishingState, evaluateDirectionalDrag, FISH_PHASE, updateFishingState,
} from '../minigames/fishingConfig';
import { resolveFishingVisuals } from '../minigames/fishingVisuals';
import {
  getDirectionalFx, getDirectionalTrajectory, resolveVisibleSurgeDirection, WAKE_FADE_MS,
} from '../minigames/fishingWaterFx';
import { drawFishingDirectionalFx, prepareHardWaterMask } from '../minigames/fishingDirectionalCanvas';
import {
  completeDirectionalSurge, createPersistentFishPosition, getFishRenderPosition, getIdleMotion,
} from '../minigames/fishingFishPosition';
import { nextSurgeHapticTime } from '../minigames/fishingHaptics';
import './FishingRoomModal.css';

const now = () => performance.now();
const percent = value => Math.round(value);

const FishingRoomModal = ({ challenge, onSuccess, onFail, onClose, config: configOverride, random = Math.random }) => {
  const config = useMemo(() => ({
    ...buildFishingConfig({
      difficulty: challenge?.fish?.difficulty,
      controlBonus: challenge?.controlBonus,
      calmDurationBonusMs: challenge?.calmDurationBonusMs,
    }),
    ...(configOverride || {}),
  }), [challenge, configOverride]);
  const visuals = resolveFishingVisuals(challenge?.location);
  const [artworkStatus, setArtworkStatus] = useState('loading');
  const [artworkAttempt, setArtworkAttempt] = useState(0);
  const artworkSource = artworkAttempt ? `${visuals.background}?retry=${artworkAttempt}` : visuals.background;
  const initialFishPosition = useMemo(() => {
    const index = Math.min(visuals.fishAnchors.length - 1, Math.floor(random() * visuals.fishAnchors.length));
    return visuals.fishAnchors[Math.max(0, index)];
  }, [random, visuals]);
  const [phase, setPhase] = useState(MINIGAME_PHASE.READY);
  const modelRef = useRef(null);
  if (!modelRef.current) modelRef.current = createFishingState(config, random);
  const [view, setView] = useState(modelRef.current);
  const phaseRef = useRef(MINIGAME_PHASE.READY);
  const lastFrameRef = useRef(0);
  const resolvedRef = useRef(false);
  const mountedRef = useRef(true);
  const timersRef = useRef(new Set());
  const criticalHapticRef = useRef(false);
  const surgeHapticTimeRef = useRef(null);
  const previousFishPhaseRef = useRef(FISH_PHASE.CALM);
  const pointerRef = useRef({ id: null, current: null, directionalStart: null });
  const sceneRef = useRef(null);
  const directionalCanvasRef = useRef(null);
  const hardMaskImageRef = useRef(null);
  const hardMaskCanvasRef = useRef(null);
  const fxTextureImagesRef = useRef({});
  const persistentFishPositionRef = useRef(createPersistentFishPosition(initialFishPosition));
  const activeTrajectoryRef = useRef(null);
  const lastDirectionalRef = useRef(null);
  const wakeFadeRef = useRef(0);
  const trailRef = useRef([]);
  const [sceneSize, setSceneSize] = useState(() => ({
    width: window.innerWidth || 360, height: window.innerHeight || 640,
  }));

  const schedule = useCallback((callback, delay) => {
    const id = setTimeout(() => { timersRef.current.delete(id); callback(); }, delay);
    timersRef.current.add(id);
  }, []);
  const changePhase = useCallback(next => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);
  const haptic = useCallback((kind) => {
    const api = window.Telegram?.WebApp?.HapticFeedback;
    try {
      if (kind === 'success' || kind === 'failure') api?.notificationOccurred?.(kind === 'success' ? 'success' : 'error');
      else api?.impactOccurred?.('light');
    } catch (_) { /* Unsupported haptics must not interrupt the game loop. */ }
  }, []);
  const finish = useCallback(result => {
    if (resolvedRef.current || phaseRef.current !== MINIGAME_PHASE.PLAYING) return;
    resolvedRef.current = true;
    modelRef.current = { ...modelRef.current, playerPulling: false, result };
    setView(modelRef.current);
    changePhase(result === MINIGAME_RESULT.SUCCESS ? MINIGAME_PHASE.SUCCESS : MINIGAME_PHASE.FAILURE);
    haptic(result);
    schedule(() => {
      changePhase(MINIGAME_PHASE.FINISHING);
      if (result === MINIGAME_RESULT.SUCCESS) onSuccess?.(result);
      else onFail?.(modelRef.current.failureReason === 'slack' ? 'Рыба сошла с крючка.' : 'Леска оборвалась.');
    }, config.resultFadeInMs + config.resultHoldMs + config.resultFadeOutMs);
  }, [changePhase, config, haptic, onFail, onSuccess, schedule]);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;
    const updateSize = () => {
      const bounds = scene.getBoundingClientRect();
      setSceneSize(current => ({
        width: bounds.width || current.width, height: bounds.height || current.height,
      }));
    };
    updateSize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize);
    observer?.observe(scene);
    window.addEventListener('resize', updateSize);
    return () => { observer?.disconnect(); window.removeEventListener('resize', updateSize); };
  }, []);

  useEffect(() => {
    const image = new Image();
    hardMaskImageRef.current = image;
    image.onload = () => { hardMaskCanvasRef.current = prepareHardWaterMask(image); };
    image.src = visuals.hardMask;
    return () => {
      image.onload = null;
      if (hardMaskImageRef.current === image) hardMaskImageRef.current = null;
      hardMaskCanvasRef.current = null;
    };
  }, [visuals.hardMask]);

  useEffect(() => {
    const sources = {
      ripple: visuals.rippleMask, wake: visuals.directionalWakeMask,
      drag: visuals.dragDistortionMask, streak: visuals.surgeStreakMask,
    };
    const images = Object.fromEntries(Object.entries(sources).map(([key, src]) => {
      const image = new Image();
      image.src = src;
      return [key, image];
    }));
    fxTextureImagesRef.current = images;
    return () => { if (fxTextureImagesRef.current === images) fxTextureImagesRef.current = {}; };
  }, [visuals]);

  useEffect(() => {
    const bounded = getFishRenderPosition({ persistentFishPosition: persistentFishPositionRef.current, sceneSize });
    persistentFishPositionRef.current = { x: bounded.x / sceneSize.width, y: bounded.y / sceneSize.height };
    if (activeTrajectoryRef.current && modelRef.current.surgeDirection) {
      activeTrajectoryRef.current = getDirectionalTrajectory({ sceneWidth: sceneSize.width, sceneHeight: sceneSize.height,
        anchor: persistentFishPositionRef.current, direction: modelRef.current.surgeDirection });
    }
    trailRef.current = [];
  }, [sceneSize]);

  useEffect(() => {
    if (phase !== MINIGAME_PHASE.PLAYING) return undefined;
    let frame;
    const tick = timestamp => {
      if (phaseRef.current !== MINIGAME_PHASE.PLAYING) return;
      const delta = timestamp - lastFrameRef.current;
      lastFrameRef.current = timestamp;
      const previous = modelRef.current;
      const bounded = getFishRenderPosition({ persistentFishPosition: persistentFishPositionRef.current, sceneSize });
      persistentFishPositionRef.current = { x: bounded.x / sceneSize.width, y: bounded.y / sceneSize.height };
      const next = updateFishingState(delta, previous, config, random);
      const directionalActive = next.surgeDirectional && (next.fishPhase === FISH_PHASE.SURGE_WARNING || next.fishPhase === FISH_PHASE.SURGE);
      if (directionalActive) {
        if (!activeTrajectoryRef.current) {
          next.surgeDirection = resolveVisibleSurgeDirection({ sceneWidth: sceneSize.width, sceneHeight: sceneSize.height,
            anchor: persistentFishPositionRef.current, direction: next.surgeDirection });
          activeTrajectoryRef.current = getDirectionalTrajectory({
          sceneWidth: sceneSize.width, sceneHeight: sceneSize.height,
          anchor: persistentFishPositionRef.current, direction: next.surgeDirection,
          });
        }
        lastDirectionalRef.current = { state: next, trajectory: activeTrajectoryRef.current, origin: persistentFishPositionRef.current };
        wakeFadeRef.current = WAKE_FADE_MS;
      } else {
        const previousDirectional = previous.surgeDirectional
          && (previous.fishPhase === FISH_PHASE.SURGE_WARNING || previous.fishPhase === FISH_PHASE.SURGE);
        if (previousDirectional && activeTrajectoryRef.current) {
          persistentFishPositionRef.current = completeDirectionalSurge(
            persistentFishPositionRef.current, activeTrajectoryRef.current, sceneSize,
          );
          activeTrajectoryRef.current = null;
        }
        if (lastDirectionalRef.current) wakeFadeRef.current = Math.max(0, wakeFadeRef.current - delta);
      }
      if (next.fishPhase === FISH_PHASE.SURGE_WARNING && next.surgeDirectional
        && previousFishPhaseRef.current !== FISH_PHASE.SURGE_WARNING) {
        pointerRef.current.directionalStart = pointerRef.current.current;
      }
      if (directionalActive) {
        const trajectory = activeTrajectoryRef.current;
        const fx = getDirectionalFx(next, trajectory);
        const head = { x: trajectory.start.x + fx.headX, y: trajectory.start.y + fx.headY, born: timestamp };
        const tail = trailRef.current[trailRef.current.length - 1];
        if (!tail || Math.hypot(head.x - tail.x, head.y - tail.y) > 12) trailRef.current.push(head);
      }
      trailRef.current = trailRef.current.filter(point => timestamp - point.born < 650);
      modelRef.current = next;
      setView(next);
      const pulseTime = nextSurgeHapticTime(next, timestamp, surgeHapticTimeRef.current, document.hidden);
      if (pulseTime !== null && pulseTime !== surgeHapticTimeRef.current) haptic('surge');
      surgeHapticTimeRef.current = pulseTime;
      if (!next.result && next.surgeDirectional && next.fishPhase === FISH_PHASE.SURGE
        && previousFishPhaseRef.current !== FISH_PHASE.SURGE) haptic('surge');
      previousFishPhaseRef.current = next.fishPhase;
      if (next.tension >= 80 && !criticalHapticRef.current) {
        criticalHapticRef.current = true;
        haptic('critical');
      } else if (next.tension < 72) criticalHapticRef.current = false;
      if (next.directionalResolved && !previous.directionalResolved && !next.directionalFollowed) haptic('failure');
      if (next.result) { finish(next.result); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [config, finish, haptic, phase, random, sceneSize]);

  const start = useCallback(event => {
    event.preventDefault();
    event.stopPropagation();
    if (phaseRef.current !== MINIGAME_PHASE.READY || artworkStatus !== 'ready') return;
    changePhase(MINIGAME_PHASE.STARTING);
    schedule(() => {
      lastFrameRef.current = now();
      changePhase(MINIGAME_PHASE.PLAYING);
    }, config.startingDelayMs);
  }, [artworkStatus, changePhase, config.startingDelayMs, schedule]);

  const setPulling = useCallback((pulling, event) => {
    event.preventDefault();
    if (phaseRef.current !== MINIGAME_PHASE.PLAYING || resolvedRef.current) return;
    if (pulling && pointerRef.current.id !== null) return;
    if (!pulling && pointerRef.current.id !== event.pointerId) return;
    if (pulling) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pointerRef.current = { id: event.pointerId, current: { x: event.clientX, y: event.clientY }, directionalStart: { x: event.clientX, y: event.clientY } };
    }
    else if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!pulling) {
      pointerRef.current = { id: null, current: null, directionalStart: null };
      surgeHapticTimeRef.current = null;
    }
    modelRef.current = { ...modelRef.current, playerPulling: pulling };
    setView(modelRef.current);
  }, []);

  const movePointer = useCallback(event => {
    if (phaseRef.current !== MINIGAME_PHASE.PLAYING || pointerRef.current.id !== event.pointerId) return;
    const current = { x: event.clientX, y: event.clientY };
    pointerRef.current.current = current;
    const model = modelRef.current;
    if (!model.playerPulling || !model.surgeDirectional
      || model.fishPhase !== FISH_PHASE.SURGE_WARNING || model.directionalResolved) return;
    const drag = evaluateDirectionalDrag(pointerRef.current.directionalStart, current, model.surgeDirection, config);
    if (drag.followed && !model.directionalFollowed) {
      modelRef.current = { ...model, directionalFollowed: true };
      setView(modelRef.current);
      haptic('directional');
    }
  }, [config, haptic]);

  const tensionClass = view.tension <= 15 ? 'slack' : view.tension >= 80 ? 'critical' : view.tension >= 55 ? 'high' : view.tension >= 30 ? 'medium' : 'low';
  const sag = Math.max(0, 18 - view.tension * 0.18);
  const resultVisible = phase === MINIGAME_PHASE.SUCCESS || phase === MINIGAME_PHASE.FAILURE;
  const directionalActive = view.surgeDirectional
    && (view.fishPhase === FISH_PHASE.SURGE_WARNING || view.fishPhase === FISH_PHASE.SURGE);
  const directionalSnapshot = directionalActive ? null : lastDirectionalRef.current;
  const directionalState = directionalActive ? view : directionalSnapshot?.state;
  const direction = directionalState?.surgeDirection || { x: 1, y: 0 };
  const trajectory = activeTrajectoryRef.current || directionalSnapshot?.trajectory || getDirectionalTrajectory({
    sceneWidth: sceneSize.width, sceneHeight: sceneSize.height, anchor: persistentFishPositionRef.current, direction,
  });
  const directionalOrigin = directionalActive ? persistentFishPositionRef.current : (directionalSnapshot?.origin || persistentFishPositionRef.current);
  const directionalFx = getDirectionalFx(directionalActive ? view : { ...directionalState, surgeDirectional: false }, trajectory,
    directionalActive ? WAKE_FADE_MS : wakeFadeRef.current);
  const surgeOffset = directionalActive ? { x: directionalFx.headX, y: directionalFx.headY } : { x: 0, y: 0 };
  const idleMotion = directionalActive ? { x: 0, y: 0 } : getIdleMotion(lastFrameRef.current);
  const renderPosition = getFishRenderPosition({ persistentFishPosition: persistentFishPositionRef.current, sceneSize, surgeOffset, idleMotion });
  const directionalLineX = renderPosition.x / sceneSize.width * 100;
  const directionalLineY = renderPosition.y / sceneSize.height * 100;
  const canvasOrigin = trajectory.start || { x: directionalOrigin.x * sceneSize.width, y: directionalOrigin.y * sceneSize.height };
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;
    drawFishingDirectionalFx({ canvas: directionalCanvasRef.current, maskImage: hardMaskCanvasRef.current,
      textures: fxTextureImagesRef.current, sceneSize, origin: canvasOrigin,
      renderFishPosition: renderPosition, direction, fx: directionalFx, trail: trailRef.current, fishPhase: view.fishPhase, phaseProgress: view.phaseElapsedMs / view.phaseDurationMs, calm: view.fishPhase === FISH_PHASE.CALM });
  });
  useEffect(() => {
    const release = () => {
      surgeHapticTimeRef.current = null;
      pointerRef.current = { id: null, current: null, directionalStart: null };
      modelRef.current = { ...modelRef.current, playerPulling: false };
      lastFrameRef.current = now();
    };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => { window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', release); };
  }, []);
  const directionalPrompt = view.surgeDirectional && view.fishPhase === FISH_PHASE.SURGE_WARNING;
  const gestureFailed = view.surgeDirectional && view.directionalResolved && !view.directionalFollowed;
  const instruction = directionalPrompt && !view.directionalFollowed ? 'ПРОВЕДИТЕ ПО СТРЕЛКЕ'
    : view.tension <= 15 ? 'ТЯНИТЕ — СЛАБИНА'
      : view.tension >= 80 ? 'ОСЛАБЬТЕ ЛЕСКУ — НА ПРЕДЕЛЕ'
        : gestureFailed ? `ПРОПУЩЕН РЫВОК: +${config.directionalMissTension}`
          : directionalActive && view.directionalFollowed ? 'ВЕРНО'
            : view.fishPhase !== FISH_PHASE.CALM && !view.surgeDirectional ? 'ОСЛАБЬТЕ ЛЕСКУ'
              : 'УДЕРЖИВАЙТЕ, ЧТОБЫ ТЯНУТЬ';
  const tensionProgress = Math.max(0, Math.min(1, view.tension / 100));
  // Same quadratic curve as the track: bottom (slack) to top (break).
  const tensionMarkerX = 70 - 176 * tensionProgress * (1 - tensionProgress);
  const tensionMarkerY = 305 - 270 * tensionProgress;
  const sceneStyle = {
    backgroundImage: `url(${visuals.background})`,
    '--result-ms': `${config.resultFadeInMs + config.resultHoldMs + config.resultFadeOutMs}ms`,
    '--hard-mask': `url(${visuals.hardMask})`, '--soft-mask': `url(${visuals.softMask})`,
    '--ripple-mask': `url(${visuals.rippleMask})`, '--shimmer-mask': `url(${visuals.shimmerMask})`,
    '--distortion-mask': `url(${visuals.distortionMask})`, '--depth-map': `url(${visuals.depthMap})`,
  };

  return <section className={`fishing fishing--${view.fishPhase.toLowerCase()} fishing--tension-${tensionClass} fishing--${phase.toLowerCase()}`}
    ref={sceneRef} style={sceneStyle} aria-label="Рыбалка" data-phase={phase} data-fish-phase={view.fishPhase}
    data-pulling={String(view.playerPulling)} data-directional={String(view.surgeDirectional)} data-directional-followed={String(view.directionalFollowed)} data-directional-renderer="canvas-2d" data-wake-visible={String(directionalFx.wakeVisible)} data-fish-x={renderPosition.x.toFixed(2)} data-fish-y={renderPosition.y.toFixed(2)} onPointerDown={event => setPulling(true, event)} onPointerMove={movePointer}
    onPointerUp={event => setPulling(false, event)} onPointerCancel={event => setPulling(false, event)}
    onLostPointerCapture={event => setPulling(false, event)}>
    <img className="fishing__artwork" src={artworkSource} alt="" aria-hidden="true" draggable="false"
      onLoad={() => setArtworkStatus('ready')} onError={() => setArtworkStatus('error')} />
    <div className="fishing__depth" aria-hidden="true" />
    <div className="fishing__ambient fishing__ambient--distortion" aria-hidden="true" />
    <div className="fishing__ambient fishing__ambient--shimmer" aria-hidden="true" />
    <div className="fishing__ambient fishing__ambient--shimmer-highlight" data-testid="shimmer-highlight" aria-hidden="true" />
    <canvas className="fishing__directional-canvas" data-testid="directional-canvas" ref={directionalCanvasRef} aria-hidden="true" />
    <svg className="fishing__line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={`M 88 -2 Q ${(88 + directionalLineX) / 2 + sag * 0.35} ${(directionalLineY - 2) / 2 + sag} ${directionalLineX} ${directionalLineY}`} />
    </svg>
    <header className="fishing__title">
      <span>РЫБОЛОВНАЯ ЗАВОДЬ</span><strong>{challenge?.fish?.name}</strong>
      <div className="fishing__catch">
        <span>ПОИМКА</span>
        <div role="progressbar" aria-label="Поимка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(view.catchProgress)}><i style={{ width: `${view.catchProgress}%` }} /></div>
        <em aria-label="Прогресс поимки">{percent(view.catchProgress)}%</em>
      </div>
    </header>
    <div className="fishing__phase-label" aria-live="polite">
      {view.fishPhase === FISH_PHASE.CALM ? 'СПОКОЙНО' : view.fishPhase === FISH_PHASE.SURGE_WARNING ? (view.surgeDirectional ? 'СЛЕДУЙТЕ ЗА РЫВКОМ' : 'ВОДА ВОЛНУЕТСЯ') : 'РЫВОК'}
    </div>
    {phase === MINIGAME_PHASE.PLAYING && directionalPrompt && !view.directionalFollowed && <div className="fishing__cue"
      style={{ left: `${Math.max(130, Math.min(sceneSize.width - 44, renderPosition.x - 25))}px`, top: `${Math.max(210, Math.min(sceneSize.height - 110, renderPosition.y - 50))}px` }}>
      <span className="fishing__arrow" style={{ transform: `rotate(${Math.atan2(direction.y, direction.x)}rad)` }}>➜</span>
      <svg className="fishing__reaction" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="25" className="fishing__reaction-track" />
        <circle cx="30" cy="30" r="25" pathLength="100" strokeDasharray={`${100 * Math.max(0, 1 - view.phaseElapsedMs / view.phaseDurationMs)} 100`} />
      </svg>
    </div>}
    {phase === MINIGAME_PHASE.PLAYING && <div className={`fishing__instruction${gestureFailed ? ' is-missed' : ''}${directionalActive && view.directionalFollowed ? ' is-followed' : ''}`} role="status">{instruction}</div>}
    {phase === MINIGAME_PHASE.PLAYING && onClose && <button type="button" className="fishing__quit" aria-label="Прекратить ловлю" onPointerDown={event => event.stopPropagation()} onClick={onClose}>×</button>}
    <div className={`fishing__tension is-${tensionClass}`} role="meter" aria-label="Натяжение лески" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(view.tension)}
      aria-valuetext={`${percent(view.tension)}% — ${view.tension <= 15 ? 'слабина' : view.tension >= 80 ? 'на пределе' : 'норма'}`}>
      <svg viewBox="0 0 110 340" aria-hidden="true">
        <text x="4" y="12" className="fishing__arc-title">НАТЯЖЕНИЕ</text>
        <text x="48" y="28" className="fishing__arc-end">Разрыв</text>
        <path className="fishing__arc-border" d="M70 305 Q-18 170 70 35" />
        <path className="fishing__arc-track" d="M70 305 Q-18 170 70 35" />
        <path className="fishing__arc-danger fishing__arc-danger--slack" d="M70 305 Q56.8 284.75 47.56 264.5" />
        <path className="fishing__arc-danger fishing__arc-danger--break" d="M41.84 89 Q52.4 62 70 35" />
        <path className="fishing__arc-marker" data-testid="tension-marker" d={`M${tensionMarkerX} ${tensionMarkerY - 8} l6 8 -6 8 -6 -8 Z`} />
        <text x={tensionMarkerX + 13} y={tensionMarkerY + 4} className="fishing__arc-value">{percent(view.tension)}%</text>
        <text x="48" y="327" className="fishing__arc-end">Слабина</text>
      </svg>
    </div>
    {phase === MINIGAME_PHASE.READY && <div className="fishing__ready" onPointerDown={event => event.stopPropagation()}>
      <div><h1>БОРЬБА С РЫБОЙ</h1><p>Удерживайте экран, чтобы тянуть. При обычном рывке отпускайте, при стрелке — проведите в её сторону. Держите натяжение между 0 и 100: на границах рыба срывается.</p>
        {artworkStatus === 'error' && <p role="alert">Не удалось загрузить водоём. Проверьте соединение и повторите загрузку.</p>}
        {artworkStatus === 'error'
          ? <button type="button" onClick={() => { setArtworkStatus('loading'); setArtworkAttempt(attempt => attempt + 1); }}>ПОВТОРИТЬ ЗАГРУЗКУ</button>
          : <button type="button" disabled={artworkStatus !== 'ready'} onPointerDown={start} onClick={start}>{artworkStatus === 'ready' ? 'НАЧАТЬ' : 'ЗАГРУЗКА ВОДОЁМА…'}</button>}
        {onClose && <button className="fishing__leave" type="button" onClick={onClose}>Уйти от водоёма</button>}</div>
    </div>}
    {phase === MINIGAME_PHASE.STARTING && <div className="fishing__starting" aria-hidden="true" />}
    {resultVisible && <div className={`fishing__result fishing__result--${phase.toLowerCase()}`} aria-live="assertive"><strong>{phase === MINIGAME_PHASE.SUCCESS ? 'РЫБА ПОЙМАНА' : view.failureReason === 'slack' ? 'РЫБА СОШЛА' : 'ЛЕСКА ОБОРВАЛАСЬ'}</strong></div>}
    {phase === MINIGAME_PHASE.FINISHING && <div className="fishing__blocker" />}
  </section>;
};

export default FishingRoomModal;


