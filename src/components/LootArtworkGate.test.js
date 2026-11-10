import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import LootArtworkGate from './LootArtworkGate';
import { getPendingLootArtUrls } from '../utils/lootArtPreload';
import { createPendingLoot } from '../utils/pendingLoot';

test('resolve only unique icons for the actual drops, not entire item catalogue', () => {
  const pending = createPendingLoot({
    id: 'loot-art-unique',
    loot: { items: [
      { name: 'Простая ткань', quantity: 2 },
      { name: 'Простая ткань', quantity: 1 },
      { name: 'Металлические обломки' },
      { name: 'Неизвестный предмет без изображения' },
    ] },
  });
  const urls = getPendingLootArtUrls(pending);
  expect(urls).toHaveLength(2);
  expect(urls).toContainEqual(expect.stringContaining('/assets/items/materials/simple_cloth.png'));
  expect(urls).toContainEqual(expect.stringContaining('/assets/items/materials/metal_fragments.webp'));
});

test('reward content stays hidden until all of its actual drop icons have loaded', async () => {
  const previousImage = global.Image;
  const images = [];
  class ControlledImage {
    constructor() { images.push(this); }
    set src(url) { this.url = url; }
    get src() { return this.url; }
    decode() { return Promise.resolve(); }
  }
  global.Image = ControlledImage;
  try {
    const pending = createPendingLoot({
      id: 'gate-art',
      loot: { items: [{ name: 'Простая ткань' }, { name: 'Металлические обломки' }] },
    });
    render(<LootArtworkGate pendingLoot={pending}><div data-testid="reward-grid">Награды</div></LootArtworkGate>);
    expect(screen.getByRole('status')).toHaveTextContent('Подготавливаем добычу');
    expect(screen.queryByTestId('reward-grid')).not.toBeInTheDocument();
    expect(images).toHaveLength(2);

    await act(async () => { images[0].onload(); });
    expect(screen.queryByTestId('reward-grid')).not.toBeInTheDocument();

    await act(async () => { images[1].onload(); });
    await waitFor(() => expect(screen.getByTestId('reward-grid')).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  } finally {
    global.Image = previousImage;
  }
});
