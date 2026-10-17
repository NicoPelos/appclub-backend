import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Rol.js', () => ({
  default: { find: vi.fn() },
}));

import Rol from '../../models/Rol.js';
import {
  obtenerRolIdsPorNombres,
  obtenerRolIdsPorSlugs,
  obtenerSlugsPorRolIds,
} from '../../services/resolverRoles.service.js';

const lean = (value) => ({ lean: vi.fn().mockResolvedValue(value) });
const select = (value) => ({ select: vi.fn().mockReturnValue(lean(value)) });

beforeEach(() => vi.clearAllMocks());

describe('obtenerRolIdsPorNombres', () => {
  it('devuelve [] sin consultar la BD si no hay nombres', async () => {
    const ids = await obtenerRolIdsPorNombres({ clubId: 'CARC', nombres: [] });
    expect(ids).toEqual([]);
    expect(Rol.find).not.toHaveBeenCalled();
  });

  it('resuelve nombres a ids del club', async () => {
    Rol.find.mockReturnValue(select([{ _id: 'id1' }, { _id: 'id2' }]));
    const ids = await obtenerRolIdsPorNombres({ clubId: 'CARC', nombres: ['admin', 'secretaria'] });
    expect(Rol.find).toHaveBeenCalledWith({ clubId: 'CARC', nombre: { $in: ['admin', 'secretaria'] }, active: true });
    expect(ids).toEqual(['id1', 'id2']);
  });
});

describe('obtenerRolIdsPorSlugs', () => {
  it('devuelve [] sin consultar la BD si no hay slugs', async () => {
    const ids = await obtenerRolIdsPorSlugs({ clubId: 'CARC', slugs: [] });
    expect(ids).toEqual([]);
    expect(Rol.find).not.toHaveBeenCalled();
  });

  it('resuelve slugs a ids del club', async () => {
    Rol.find.mockReturnValue(select([{ _id: 'id1' }]));
    const ids = await obtenerRolIdsPorSlugs({ clubId: 'CARC', slugs: ['socio'] });
    expect(Rol.find).toHaveBeenCalledWith({ clubId: 'CARC', slug: { $in: ['socio'] }, active: true });
    expect(ids).toEqual(['id1']);
  });
});

describe('obtenerSlugsPorRolIds', () => {
  it('devuelve [] sin consultar la BD si no hay ids', async () => {
    const slugs = await obtenerSlugsPorRolIds({ clubId: 'club1', rolIds: [] });
    expect(slugs).toEqual([]);
    expect(Rol.find).not.toHaveBeenCalled();
  });

  it('resuelve ids a slugs, filtrando por clubId (appcarc-backend#162)', async () => {
    Rol.find.mockReturnValue(select([{ slug: 'admin' }, { slug: 'socio' }]));
    const slugs = await obtenerSlugsPorRolIds({ clubId: 'club1', rolIds: ['id1', 'id2'] });
    expect(Rol.find).toHaveBeenCalledWith({ _id: { $in: ['id1', 'id2'] }, clubId: 'club1', active: true });
    expect(slugs).toEqual(['admin', 'socio']);
  });
});
