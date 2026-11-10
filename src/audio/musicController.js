import {
  GUILD_DESCENT_FADE_OUT_MS,
  GUILD_FADE_IN_MS,
  GUILD_RESUME_FADE_IN_MS,
  GUILD_SILENCE_MAX_MS,
  GUILD_SILENCE_MIN_MS,
  LOCATION_FADE_IN_MS,
  LOCATION_FADE_OUT_MS,
  MUSIC_TRACKS,
  MUSIC_VOLUME,
  getLocationMusicTrack,
  isGuildMusicScreen,
} from './musicRegistry';

const noop = () => {};
const DIAGNOSTIC_EVENTS = ['loadstart', 'loadedmetadata', 'durationchange', 'canplay', 'playing', 'timeupdate', 'volumechange', 'pause', 'ended', 'error'];

export class MusicController {
  constructor(options = {}) {
    this.audio = options.audio || new Audio();
    this.document = options.document || document;
    const injectedRequestFrame = options.requestAnimationFrame;
    const injectedCancelFrame = options.cancelAnimationFrame;
    const injectedSetTimeout = options.setTimeout;
    const injectedClearTimeout = options.clearTimeout;
    // Do not retain native Window methods: Android WebView requires their receiver
    // to remain Window and otherwise throws an "Illegal invocation" error.
    this.requestFrame = callback => injectedRequestFrame
      ? injectedRequestFrame(callback)
      : window.requestAnimationFrame(callback);
    this.cancelFrame = id => injectedCancelFrame
      ? injectedCancelFrame(id)
      : window.cancelAnimationFrame(id);
    this.setTimer = (callback, delay) => injectedSetTimeout
      ? injectedSetTimeout(callback, delay)
      : window.setTimeout(callback, delay);
    this.clearTimer = id => injectedClearTimeout
      ? injectedClearTimeout(id)
      : window.clearTimeout(id);
    this.now = options.now || (() => performance.now());
    this.random = options.random || Math.random;
    this.screen = null; this.locationName = null; this.musicScope = null; this.currentTrack = null;
    this.inGuildScope = false; this.inLocationScope = false; this.destroyed = false;
    this.fadeFrame = null; this.fadeActive = false; this.fadeTarget = null; this.fadeStartVolume = null; this.lastFadeError = null;
    this.replayTimer = null; this.replayDeadline = null; this.silenceRemaining = null;
    this.gestureArmed = false; this.gestureAttemptPending = false; this.wasPlayingBeforeHidden = false; this.sessionToken = 0; this.attemptToken = 0;
    this.hasConfirmedPlaying = false; this.fadeDurationOnPlaying = GUILD_FADE_IN_MS; this.lastPlayRejection = null;
    this.diagnosticPlayback = false;
    this.lastMediaEvent = null; this.debugListeners = new Set(); this.debugSnapshot = null;
    this.boundEnded = () => this.handleEnded();
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundGesture = () => this.handleGesture();
    this.boundPlaying = () => this.handlePlaying();
    this.boundMediaError = () => this.handleMediaError();
    this.boundDiagnostics = {};
    this.audio.loop = false;
    this.audio.addEventListener('ended', this.boundEnded);
    this.audio.addEventListener('playing', this.boundPlaying);
    this.audio.addEventListener('error', this.boundMediaError);
    this.installDiagnostics();
    this.document.addEventListener('visibilitychange', this.boundVisibility);
  }

  installDiagnostics() {
    DIAGNOSTIC_EVENTS.forEach(type => {
      if (type === 'playing' || type === 'error' || type === 'ended') return;
      const listener = () => {
        this.lastMediaEvent = type;
        this.emitDebugSnapshot();
        if (process.env.NODE_ENV !== 'production' && type !== 'playing' && type !== 'error') console.debug(`[music] ${type}`, { src: this.audio.src, volume: this.audio.volume, muted: this.audio.muted });
      };
      this.boundDiagnostics[type] = listener;
      this.audio.addEventListener(type, listener);
    });
  }

  buildDebugSnapshot() {
    const rejection = this.lastPlayRejection;
    return Object.freeze({
      src: this.audio.currentSrc || this.audio.src || '', inGuildScope: this.inGuildScope,
      inLocationScope: this.inLocationScope, musicScope: this.musicScope || '', locationName: this.locationName || '',
      paused: Boolean(this.audio.paused), muted: Boolean(this.audio.muted), volume: this.audio.volume,
      currentTime: this.audio.currentTime, duration: this.audio.duration, readyState: this.audio.readyState,
      networkState: this.audio.networkState, errorCode: this.audio.error?.code ?? null,
      gestureArmed: this.gestureArmed, gestureAttemptPending: this.gestureAttemptPending,
      hasConfirmedPlaying: this.hasConfirmedPlaying, lastMediaEvent: this.lastMediaEvent,
      playRejectionName: rejection?.name || '', playRejectionMessage: rejection?.message || '',
      fadeActive: this.fadeActive, fadeTarget: this.fadeTarget, fadeStartVolume: this.fadeStartVolume,
      lastFadeError: this.lastFadeError?.message || '',
    });
  }
  getDebugSnapshot = () => this.debugSnapshot || (this.debugSnapshot = this.buildDebugSnapshot());
  subscribeDebug = listener => { this.debugListeners.add(listener); return () => this.debugListeners.delete(listener); };
  emitDebugSnapshot() { this.debugSnapshot = this.buildDebugSnapshot(); this.debugListeners.forEach(listener => listener()); }
  testGuildMusic() {
    if (this.destroyed) return;
    this.diagnosticPlayback = true;
    this.cancelFade(); this.audio.muted = false; this.audio.volume = 1; this.audio.currentTime = 0;
    this.lastPlayRejection = null; this.emitDebugSnapshot();
    let result;
    try { result = this.audio.play(); } catch (error) { this.lastPlayRejection = error; this.emitDebugSnapshot(); return; }
    Promise.resolve(result).catch(error => { this.lastPlayRejection = error; this.emitDebugSnapshot(); });
  }
  stopMusic() { this.stopAndReset(); this.emitDebugSnapshot(); }

  updateScreen(screen, locationName = null) {
    if (this.destroyed) return;
    const guildScope = isGuildMusicScreen(screen);
    const locationTrack = getLocationMusicTrack(screen, locationName);
    const nextScope = guildScope ? 'guild' : locationTrack ? 'location' : null;
    const nextTrack = guildScope ? MUSIC_TRACKS.guildHall : locationTrack;
    const sameTrack = nextScope === this.musicScope && nextTrack === this.currentTrack;

    this.screen = screen;
    this.locationName = locationName;

    if (sameTrack) {
      this.inGuildScope = nextScope === 'guild';
      this.inLocationScope = nextScope === 'location';
      this.emitDebugSnapshot();
      return;
    }

    if (!nextScope) {
      this.leaveMusicScope(this.musicScope);
      return;
    }

    this.startMusicSession(nextScope, nextTrack);
  }

  startGuildSession() {
    this.startMusicSession('guild', MUSIC_TRACKS.guildHall);
  }

  startMusicSession(scope, track) {
    this.sessionToken += 1;
    this.cancelReplay();
    this.cancelFade();
    this.disarmGesture();
    if (this.currentTrack || !this.audio.paused) this.stopAndReset();

    this.musicScope = scope;
    this.currentTrack = track;
    this.inGuildScope = scope === 'guild';
    this.inLocationScope = scope === 'location';
    this.diagnosticPlayback = false;
    this.hasConfirmedPlaying = false;
    this.gestureAttemptPending = false;
    this.lastPlayRejection = null;

    this.audio.preload = 'auto';
    this.audio.src = track;
    this.audio.loop = scope === 'location';
    this.audio.currentTime = 0;
    this.audio.volume = 0;
    this.audio.muted = false;
    if (typeof this.audio.load === 'function') this.audio.load();

    this.armGesture();
    const fadeIn = scope === 'guild' ? GUILD_FADE_IN_MS : LOCATION_FADE_IN_MS;
    if (!this.isHidden()) this.playWithFade(fadeIn);
    else this.wasPlayingBeforeHidden = true;
  }

  leaveGuildScope() {
    this.leaveMusicScope('guild');
  }

  leaveMusicScope(previousScope = this.musicScope) {
    if (!previousScope && !this.musicScope) {
      this.inGuildScope = false;
      this.inLocationScope = false;
      this.emitDebugSnapshot();
      return;
    }
    this.sessionToken += 1;
    this.disarmGesture();
    this.cancelReplay();
    this.silenceRemaining = null;
    this.diagnosticPlayback = false;
    const fadeOut = previousScope === 'guild' ? GUILD_DESCENT_FADE_OUT_MS : LOCATION_FADE_OUT_MS;
    this.musicScope = null;
    this.currentTrack = null;
    this.inGuildScope = false;
    this.inLocationScope = false;
    if (this.isHidden() || this.audio.paused) {
      this.stopAndReset();
      this.emitDebugSnapshot();
      return;
    }
    this.fadeTo(0, fadeOut, () => this.stopAndReset());
  }

  playWithFade(duration) {
    if (!this.musicScope || this.destroyed) return;
    const session = this.sessionToken; const attempt = ++this.attemptToken;
    this.fadeDurationOnPlaying = duration;
    let result;
    try { result = this.audio.play(); }
    catch (error) { this.handlePlayFailure(error, session, attempt); return; }
    Promise.resolve(result).catch(error => this.handlePlayFailure(error, session, attempt));
  }

  handlePlayFailure(error, session = this.sessionToken, attempt = this.attemptToken) {
    if (!this.musicScope || this.destroyed || session !== this.sessionToken || attempt !== this.attemptToken || this.hasConfirmedPlaying) return;
    this.lastPlayRejection = error;
    this.gestureAttemptPending = false;
    // WebViews use several DOMException names for policy/transient failures. A media
    // element error event, not a rejection name, is the authority for fatal assets.
    if (!this.audio.error) this.armGesture();
    this.emitDebugSnapshot();
    if (process.env.NODE_ENV !== 'production') console.warn('Music playback failed; keeping gesture playback pending.', error);
  }

  armGesture() {
    if (this.gestureArmed || this.hasConfirmedPlaying || this.audio.error) return;
    this.gestureArmed = true;
    ['pointerdown', 'touchstart', 'click'].forEach(type => this.document.addEventListener(type, this.boundGesture));
  }

  disarmGesture() {
    if (!this.gestureArmed) return;
    this.gestureArmed = false;
    ['pointerdown', 'touchstart', 'click'].forEach(type => this.document.removeEventListener(type, this.boundGesture));
  }

  handleGesture() {
    if (!this.gestureArmed || this.gestureAttemptPending || !this.musicScope) return;
    if (this.isHidden()) return;
    // Keep listeners until the media element confirms `playing`; play() is invoked
    // directly in the trusted event callback so Android WebView retains activation.
    this.gestureAttemptPending = true;
    this.playWithFade(this.musicScope === 'guild' ? GUILD_FADE_IN_MS : LOCATION_FADE_IN_MS);
  }

  handlePlaying() {
    if (!this.musicScope || this.destroyed) return;
    this.lastMediaEvent = 'playing';
    this.hasConfirmedPlaying = true; this.gestureAttemptPending = false; this.disarmGesture(); this.lastPlayRejection = null;
    if (this.diagnosticPlayback) {
      this.audio.muted = false; this.audio.volume = 1;
      this.emitDebugSnapshot();
      return;
    }
    this.audio.muted = false; this.audio.volume = 0;
    this.fadeTo(MUSIC_VOLUME, this.fadeDurationOnPlaying);
    this.emitDebugSnapshot();
    if (process.env.NODE_ENV !== 'production') console.debug('[music] playing', { src: this.audio.src, volume: this.audio.volume, muted: this.audio.muted });
  }

  handleMediaError() {
    this.lastMediaEvent = 'error';
    this.gestureAttemptPending = false; this.disarmGesture(); this.cancelFade();
    this.emitDebugSnapshot();
    if (process.env.NODE_ENV !== 'production') console.error('[music] media error', {
      src: this.audio.src, code: this.audio.error?.code, networkState: this.audio.networkState,
      readyState: this.audio.readyState, playRejectionName: this.lastPlayRejection?.name,
      playRejectionMessage: this.lastPlayRejection?.message,
    });
  }

  fadeTo(target, duration, onComplete = noop) {
    this.cancelFade(); const initial = this.audio.volume;
    this.fadeTarget = target; this.fadeStartVolume = initial; this.lastFadeError = null;
    if (duration <= 0) { this.audio.volume = target; onComplete(); this.emitDebugSnapshot(); return; }
    this.fadeActive = true;
    const started = this.now();
    let finished = false;
    const complete = () => {
      if (finished) return;
      finished = true; this.fadeFrame = null; this.fadeActive = false; onComplete(); this.emitDebugSnapshot();
    };
    const schedule = step => {
      try { this.fadeFrame = this.requestFrame(step); }
      catch (error) {
        this.lastFadeError = error; this.audio.volume = target;
        if (process.env.NODE_ENV !== 'production') console.error('[music] fade scheduling failed; applying target immediately.', error);
        complete();
      }
    };
    const step = timestamp => {
      const progress = Math.min(1, Math.max(0, (timestamp - started) / duration));
      this.audio.volume = initial + ((target - initial) * progress);
      if (progress < 1) schedule(step); else complete();
    };
    schedule(step);
  }
  cancelFade() { if (this.fadeFrame !== null) this.cancelFrame(this.fadeFrame); this.fadeFrame = null; this.fadeActive = false; }
  handleEnded() { this.lastMediaEvent = 'ended'; this.emitDebugSnapshot(); if (this.musicScope !== 'guild' || this.destroyed) return; this.cancelFade(); this.audio.volume = 0; const delay = GUILD_SILENCE_MIN_MS + this.random() * (GUILD_SILENCE_MAX_MS - GUILD_SILENCE_MIN_MS); this.scheduleReplay(delay); }
  scheduleReplay(delay) { this.cancelReplay(); this.silenceRemaining = delay; if (this.isHidden()) return; this.replayDeadline = this.now() + delay; this.replayTimer = this.setTimer(() => { this.replayTimer = null; this.replayDeadline = null; this.silenceRemaining = null; if (this.musicScope !== 'guild' || this.isHidden()) return; this.audio.currentTime = 0; this.audio.volume = 0; this.playWithFade(GUILD_FADE_IN_MS); }, delay); }
  cancelReplay() { if (this.replayTimer !== null) this.clearTimer(this.replayTimer); this.replayTimer = null; this.replayDeadline = null; }
  handleVisibilityChange() {
    if (this.destroyed) return;
    if (this.isHidden()) {
      this.cancelFade();
      this.wasPlayingBeforeHidden = Boolean(this.musicScope) && !this.audio.paused;
      if (this.wasPlayingBeforeHidden) this.audio.pause();
      if (this.musicScope === 'guild' && this.replayTimer !== null) {
        this.silenceRemaining = Math.max(0, this.replayDeadline - this.now());
        this.cancelReplay();
      }
      return;
    }
    if (!this.musicScope) return;
    if (this.musicScope === 'guild' && this.silenceRemaining !== null) {
      this.scheduleReplay(this.silenceRemaining);
    } else if (this.wasPlayingBeforeHidden) {
      this.wasPlayingBeforeHidden = false;
      this.audio.volume = 0;
      this.playWithFade(GUILD_RESUME_FADE_IN_MS);
    }
  }
  isHidden() { return this.document.visibilityState === 'hidden'; }
  stopAndReset() { this.diagnosticPlayback = false; this.cancelFade(); this.audio.pause(); this.audio.currentTime = 0; this.audio.volume = 0; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.musicScope = null; this.currentTrack = null; this.inGuildScope = false; this.inLocationScope = false; this.sessionToken += 1; this.cancelFade(); this.cancelReplay(); this.disarmGesture(); this.audio.pause(); this.audio.removeEventListener('ended', this.boundEnded); this.audio.removeEventListener('playing', this.boundPlaying); this.audio.removeEventListener('error', this.boundMediaError); Object.entries(this.boundDiagnostics).forEach(([type, listener]) => this.audio.removeEventListener(type, listener)); this.document.removeEventListener('visibilitychange', this.boundVisibility); }
}
