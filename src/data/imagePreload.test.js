import { areImagesPreloaded, getCombatCriticalImages, preloadImage } from './combatAssets';

describe('image preloading reliability', () => {
  const OriginalImage = global.Image;
  let created;

  beforeEach(() => {
    created = [];
    class ControlledImage {
      constructor() { created.push(this); }
      set src(value) { this.url = value; }
      get src() { return this.url; }
    }
    global.Image = ControlledImage;
  });

  afterEach(() => { global.Image = OriginalImage; });

  test('empty and missing image lists need no network requests', () => {
    expect(areImagesPreloaded([])).toBe(true);
    expect(created).toHaveLength(0);
  });

  test('failed images can be retried instead of remaining permanently cached', async () => {
    const url = '/preload-test/retry-after-failure.webp';
    const failed = preloadImage(url, 1000);
    expect(created).toHaveLength(1);
    created[0].onerror();
    expect(await failed).toBe(false);
    expect(areImagesPreloaded([url])).toBe(false);

    const retried = preloadImage(url, 1000);
    expect(created).toHaveLength(2);
    created[1].onload();
    expect(await retried).toBe(true);
    expect(areImagesPreloaded([url])).toBe(true);

    expect(await preloadImage(url, 1000)).toBe(true);
    expect(created).toHaveLength(2);
  });

  test('concurrent requests for the same art share a single in-flight image', async () => {
    const url = '/preload-test/deduplicate.webp';
    const first = preloadImage(url, 1000);
    const second = preloadImage(url, 1000);
    expect(created).toHaveLength(1);
    created[0].onload();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });

  test('initial combat art includes visible units and skills, not unrelated enemy art', () => {
    const images = getCombatCriticalImages({
      players: [{
        class: 'Archer',
        abilities: [{ artId: 'serrated_arrow' }, { artId: 'initiative', passive: true }],
      }],
      enemies: [{ portraitKey: 'goblin_butcher' }],
    });
    expect(images).toContainEqual(expect.stringContaining('/portraits/player/archer.webp'));
    expect(images).toContainEqual(expect.stringContaining('/abilities/archer/serrated_arrow.webp'));
    expect(images.some(url => url.includes('/portraits/enemies/fungal/'))).toBe(false);
    expect(images.some(url => url.includes('/passives/'))).toBe(false);
  });
});
