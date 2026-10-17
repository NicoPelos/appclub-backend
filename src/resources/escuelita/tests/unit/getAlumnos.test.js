import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Escuelita.js', () => ({
  default: { find: vi.fn(), countDocuments: vi.fn() },
}));
vi.mock('../../../socios/models/Socio.js', () => ({
  default: { find: vi.fn() },
}));

import Escuelita from '../../models/Escuelita.js';
import Socio from '../../../socios/models/Socio.js';
import { getAlumnosHandler } from '../../handlers/getAlumnos.handler.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockEscuelitaQuery = (result) => {
  const query = {};
  query.populate = vi.fn().mockReturnValue(query);
  query.sort = vi.fn().mockReturnValue(query);
  query.skip = vi.fn().mockReturnValue(query);
  query.limit = vi.fn().mockResolvedValue(result);
  Escuelita.find.mockReturnValue(query);
  return query;
};

const USER = { clubId: 'CARC' };

beforeEach(() => {
  vi.clearAllMocks();
  Escuelita.countDocuments.mockResolvedValue(0);
  mockEscuelitaQuery([]);
});

describe('getAlumnosHandler', () => {
  it('por defecto solo trae alumnos activos', async () => {
    const req = { query: {}, user: USER };
    const res = mockRes();

    await getAlumnosHandler(req, res);

    expect(Escuelita.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC', active: true }));
  });

  it('trash=true trae los dados de baja', async () => {
    const req = { query: { trash: 'true' }, user: USER };
    const res = mockRes();

    await getAlumnosHandler(req, res);

    expect(Escuelita.find).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it('filtra por planId', async () => {
    const req = { query: { planId: 'plan1' }, user: USER };
    const res = mockRes();

    await getAlumnosHandler(req, res);

    expect(Escuelita.find).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan1' }));
  });

  it('search busca primero los Socio que matchean y filtra por sus ids', async () => {
    Socio.find.mockReturnValue({ select: vi.fn().mockResolvedValue([{ _id: 'socio1' }, { _id: 'socio2' }]) });
    const req = { query: { search: 'Perez' }, user: USER };
    const res = mockRes();

    await getAlumnosHandler(req, res);

    expect(Socio.find).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC',
      $or: [{ nombre: expect.any(RegExp) }, { apellido: expect.any(RegExp) }, { dni: expect.any(RegExp) }],
    }));
    expect(Escuelita.find).toHaveBeenCalledWith(expect.objectContaining({ socioId: { $in: ['socio1', 'socio2'] } }));
  });

  it('socioId explícito tiene prioridad sobre search', async () => {
    const req = { query: { search: 'Perez', socioId: 'socioDirecto' }, user: USER };
    const res = mockRes();

    await getAlumnosHandler(req, res);

    expect(Socio.find).not.toHaveBeenCalled();
    expect(Escuelita.find).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'socioDirecto' }));
  });
});
