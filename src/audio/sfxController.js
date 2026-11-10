import { COMMON_PRELOAD_SFX, SFX_LEVELS, SFX_MASTER_VOLUME, SFX_TRACKS } from './sfxRegistry';

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const noop = () => {};

export class SfxController {
  constructor(options = {}) {
    this.AudioCtor = options.AudioCtor || (typeof Audio !== 'undefined' ? Audio : null);
    this.masterVolume = options.masterVolume ?? SFX_MASTER_VOLUME;
    this.maxVoicesPerSound = options.maxVoicesPerSound ?? 4;
    this.pools = new Map();
  }

  createVoice(name) {
    const src = SFX_TRACKS[name];
    if (!src || !this.AudioCtor) return null;
    const audio = new this.AudioCtor(src);
    audio.preload = 'auto';
    audio.src = src;
    return audio;
  }

  getVoice(name) {
    if (!SFX_TRACKS[name] || !this.AudioCtor) return null;
    const pool = this.pools.get(name) || [];
    let voice = pool.find(entry => entry.audio.paused || entry.audio.ended);
    if (!voice && pool.length < this.maxVoicesPerSound) {
      voice = { audio: this.createVoice(name), usedAt: 0 };
      if (!voice.audio) return null;
      pool.push(voice);
      this.pools.set(name, pool);
    }
    if (!voice) {
      voice = pool.reduce((oldest, entry) => entry.usedAt < oldest.usedAt ? entry : oldest, pool[0]);
      try { voice.audio.pause(); } catch (_) {}
    }
    return voice;
  }

  play(name, options = {}) {
    if (!name || name === 'none' || !SFX_TRACKS[name]) return false;
    const voice = this.getVoice(name);
    if (!voice?.audio) return false;

    const relativeLevel = options.relativeVolume ?? SFX_LEVELS[name] ?? 1;
    voice.audio.volume = clamp01(this.masterVolume * relativeLevel);
    voice.usedAt = Date.now();

    try {
      voice.audio.currentTime = 0;
      const result = voice.audio.play();
      if (result && typeof result.catch === 'function') result.catch(noop);
      return true;
    } catch (_) {
      return false;
    }
  }

  preload(names = COMMON_PRELOAD_SFX) {
    names.forEach(name => {
      if (!SFX_TRACKS[name] || !this.AudioCtor) return;
      const pool = this.pools.get(name) || [];
      if (pool.length) return;
      const audio = this.createVoice(name);
      if (!audio) return;
      pool.push({ audio, usedAt: 0 });
      this.pools.set(name, pool);
      try { audio.load?.(); } catch (_) {}
    });
  }

  destroy() {
    this.pools.forEach(pool => pool.forEach(({ audio }) => {
      try { audio.pause(); } catch (_) {}
    }));
    this.pools.clear();
  }
}

export const sfxController = new SfxController();
export const playSfx = (name, options) => sfxController.play(name, options);

export const installGlobalUiSfx = (doc = typeof document !== 'undefined' ? document : null) => {
  if (!doc?.addEventListener) return noop;

  const handleClick = event => {
    const element = event.target?.closest?.('[data-sfx], button, [role="button"], [role="tab"], a[href]');
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true') return;

    const explicit = element.dataset?.sfx;
    if (explicit === 'none') return;
    if (explicit) {
      playSfx(explicit);
      return;
    }

    if (element.getAttribute?.('role') === 'tab') {
      playSfx('tabSwitch');
      return;
    }

    playSfx('click');
  };

  doc.addEventListener('click', handleClick);
  return () => doc.removeEventListener('click', handleClick);
};
