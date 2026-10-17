import { describe, it, expect, vi, beforeEach } from 'vitest';

const { parseURLMock } = vi.hoisted(() => ({ parseURLMock: vi.fn() }));

vi.mock('rss-parser', () => ({
  default: vi.fn().mockImplementation(() => ({ parseURL: parseURLMock })),
}));

vi.mock('../../models/Novedad.js', () => ({
  default: { updateOne: vi.fn() },
}));

vi.mock('../../../clubs/models/Club.js', () => ({
  default: { find: vi.fn() },
}));

import { syncFaaFeed } from '../../services/syncFaaFeed.service.js';
import Novedad from '../../models/Novedad.js';
import Club from '../../../clubs/models/Club.js';

const buildClubQuery = (result) => ({ lean: vi.fn().mockResolvedValue(result) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncFaaFeed', () => {
  it('no hace nada si ningún club tiene el módulo de novedades habilitado', async () => {
    parseURLMock.mockResolvedValue({ items: [{ guid: 'g1', title: 'Curso', link: 'https://x.com/1' }] });
    Club.find.mockReturnValue(buildClubQuery([]));

    const result = await syncFaaFeed();

    expect(result).toEqual({ inserted: 0, skipped: 0, total: 0 });
    expect(Novedad.updateOne).not.toHaveBeenCalled();
  });

  it('inserta una novedad nueva por cada club habilitado', async () => {
    parseURLMock.mockResolvedValue({
      items: [{
        guid: 'https://federacionandinistasargentinos.ar/?p=123',
        title: 'Curso de escalada',
        link: 'https://federacionandinistasargentinos.ar/curso-escalada',
        contentSnippet: 'Resumen del curso',
        pubDate: '2026-07-01T00:00:00Z',
      }],
    });
    Club.find.mockReturnValue(buildClubQuery([{ slug: 'CARC' }]));
    Novedad.updateOne.mockResolvedValue({ upsertedCount: 1 });

    const result = await syncFaaFeed();

    expect(Novedad.updateOne).toHaveBeenCalledWith(
      { clubId: 'CARC', fuenteId: 'https://federacionandinistasargentinos.ar/?p=123' },
      { $setOnInsert: expect.objectContaining({
        clubId: 'CARC',
        fuente: 'rss',
        categoria: 'FAA',
        titulo: 'Curso de escalada',
        linkOriginal: 'https://federacionandinistasargentinos.ar/curso-escalada',
      }) },
      { upsert: true },
    );
    expect(result).toEqual({ inserted: 1, skipped: 0, total: 1 });
  });

  it('cuenta como skipped los items que ya existían (no insertados)', async () => {
    parseURLMock.mockResolvedValue({ items: [{ guid: 'g1', title: 'Curso', link: 'https://x.com/1' }] });
    Club.find.mockReturnValue(buildClubQuery([{ slug: 'CARC' }]));
    Novedad.updateOne.mockResolvedValue({ upsertedCount: 0 });

    const result = await syncFaaFeed();

    expect(result).toEqual({ inserted: 0, skipped: 1, total: 1 });
  });

  it('ignora items sin guid ni link', async () => {
    parseURLMock.mockResolvedValue({ items: [{ title: 'Sin id' }] });
    Club.find.mockReturnValue(buildClubQuery([{ slug: 'CARC' }]));

    const result = await syncFaaFeed();

    expect(Novedad.updateOne).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('sincroniza el mismo feed para múltiples clubes habilitados', async () => {
    parseURLMock.mockResolvedValue({ items: [{ guid: 'g1', title: 'Curso', link: 'https://x.com/1' }] });
    Club.find.mockReturnValue(buildClubQuery([{ slug: 'CARC' }, { slug: 'OTROCLUB' }]));
    Novedad.updateOne.mockResolvedValue({ upsertedCount: 1 });

    const result = await syncFaaFeed();

    expect(Novedad.updateOne).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ inserted: 2, skipped: 0, total: 2 });
  });
});
