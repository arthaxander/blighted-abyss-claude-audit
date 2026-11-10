export const MINIGAME_PHASE = Object.freeze({
  READY: 'READY',
  STARTING: 'STARTING',
  PLAYING: 'PLAYING',
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  FINISHING: 'FINISHING',
});

export const MINIGAME_RESULT = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
});

export const isMinigameInputLocked = phase => phase !== MINIGAME_PHASE.PLAYING;
