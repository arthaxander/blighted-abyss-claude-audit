import { getImageBundle, getLocationImageBundleId, IMAGE_BUNDLES } from './imageBundles';

describe('scoped image bundles', () => {
  test.each([
    ['Гоблинские Норы', 'goblin', 'goblin_nests'],
    ['Грибные Пещеры', 'fungal', 'fungal'],
    ['Лагерь Отступников', 'deserter', 'deserter_camp'],
    ['Лес Увядания', 'withering_forest', 'withering_forest'],
    ['Руины Неупокоенных', 'restless_ruins', 'restless_ruins'],
  ])('%s preloads its own location art, not the rest of the floor', (name, id, directory) => {
    expect(getLocationImageBundleId(name)).toBe(id);
    const list = getImageBundle(id);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some(url => url.includes('/portraits/enemies/' + directory + '/'))).toBe(true);

    const different = ['goblin_nests', 'fungal', 'deserter_camp', 'withering_forest', 'restless_ruins', 'mines_of_decay']
      .filter(folder => folder !== directory);
    different.forEach(folder => {
      expect(list.some(url => url.includes('/portraits/enemies/' + folder + '/'))).toBe(false);
    });
    expect(new Set(list).size).toBe(list.length);
  });

  test('painted Goblin cavern tiles and decals load only with Goblin Burrows', () => {
    const mapRoot = '/assets/maps/goblin-cavern-v1/';
    const goblin = getImageBundle('goblin');
    expect(goblin).toContainEqual(expect.stringContaining(mapRoot + 'landscape/ground.webp'));
    expect(goblin).toContainEqual(expect.stringContaining(mapRoot + 'landscape/rock.webp'));
    expect(goblin.filter(url => url.includes(mapRoot))).toHaveLength(19);
    for (const other of ['fungal', 'deserter', 'withering_forest', 'restless_ruins']) {
      expect(getImageBundle(other).some(url => url.includes(mapRoot))).toBe(false);
    }
  });

  test('Guild has its own items and background, without location room art', () => {
    const guild = getImageBundle('guild');
    expect(guild.some(url => url.includes('/assets/guild/guild_hall_background.webp'))).toBe(true);
    expect(guild.some(url => url.includes('/assets/items/'))).toBe(true);
    expect(guild.some(url => url.includes('/assets/rooms/'))).toBe(false);
    expect(new Set(guild).size).toBe(guild.length);
  });

  test('shared combat art is part of each location without duplicating other location art', () => {
    const shared = getImageBundle('shared');
    expect(shared.some(url => url.includes('/combat/effects/'))).toBe(true);
    expect(shared.every(url => getImageBundle('goblin').includes(url))).toBe(true);
    expect(shared.every(url => getImageBundle('withering_forest').includes(url))).toBe(true);
    expect(getImageBundle('floor1')).toEqual([]);
    expect(getImageBundle('floor2')).toEqual([]);
    expect(IMAGE_BUNDLES.mines_of_decay.length).toBeGreaterThan(shared.length);
  });

  test('missing location falls back to shared resources without blocking on all levels', () => {
    expect(getLocationImageBundleId('Неизвестная область')).toBe('shared');
    expect(getLocationImageBundleId(null)).toBe('shared');
  });
});
