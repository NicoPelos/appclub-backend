import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRecursosHandler } from '../../handlers/getRecursos.handler.js';

vi.mock('../../models/RecursoExterno.js', () => ({
  default: { find: vi.fn() },
}));

import RecursoExterno from '../../models/RecursoExterno.js';

const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockFindChain = (result) => ({
  sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }),
});

beforeEach(() => vi.clearAllMocks());

describe('getRecursosHandler', () => {
  it('lista recursos activos del club (200)', async () => {
    RecursoExterno.find.mockReturnValue(mockFindChain([{ nombre: 'Los Gigantes' }]));

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getRecursosHandler(req, res);

    expect(RecursoExterno.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ nombre: 'Los Gigantes' }]);
  });

  it('filtra por tipo cuando se pasa como query param', async () => {
    RecursoExterno.find.mockReturnValue(mockFindChain([]));

    const req = { user: mockUser, query: { tipo: 'sendero' } };
    const res = mockRes();

    await getRecursosHandler(req, res);

    expect(RecursoExterno.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true, tipo: 'sendero' });
  });

  it('muestra eliminados cuando trash=true', async () => {
    RecursoExterno.find.mockReturnValue(mockFindChain([]));

    const req = { user: mockUser, query: { trash: 'true' } };
    const res = mockRes();

    await getRecursosHandler(req, res);

    expect(RecursoExterno.find).toHaveBeenCalledWith({ clubId: 'CARC', active: false });
  });

  it('retorna 500 si hay error', async () => {
    RecursoExterno.find.mockImplementation(() => { throw new Error('DB error'); });

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getRecursosHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
