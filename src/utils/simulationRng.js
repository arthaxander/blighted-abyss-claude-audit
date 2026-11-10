const toUint32 = value => Number(value) >>> 0;

export const deriveSimulationSeed = (batchSeed, index) => {
  let value = (toUint32(batchSeed) + Math.imul(toUint32(index + 1), 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
  return (value ^ (value >>> 15)) >>> 0;
};

export const createSeededSimulationRng = seed => {
  let state = toUint32(seed) || 0x6d2b79f5;
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => state;
  rng.setState = next => {
    if (!Number.isInteger(next) || next < 0 || next > 0xffffffff) {
      throw new Error('Invalid simulation RNG state');
    }
    state = next;
  };
  return rng;
};
