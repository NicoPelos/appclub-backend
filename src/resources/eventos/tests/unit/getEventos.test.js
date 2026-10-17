import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEventosHandler } from '../../handlers/getEventos.handler.js';

vi.mock('../../models/Evento.js', () => ({
  default: { find: vi.fn() },
}));

import Evento from '../../models/Evento.js';

const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const chainable = (result) => ({
  sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEventosHandler', () => {
  it('lista los eventos activos del club, más recientes primero', async () => {
    Evento.find.mockReturnValue(chainable([{ nombre: 'Viaje 1' }]));

    const req = { user: mockUser, query: {} };
    const res = mockRes();
    await getEventosHandler(req, res);

    expect(Evento.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ nombre: 'Viaje 1' }]);
  });

  it('filtra por estado cuando se pasa por query', async () => {
    Evento.find.mockReturnValue(chainable([]));

    const req = { user: mockUser, query: { estado: 'cerrado' } };
    const res = mockRes();
    await getEventosHandler(req, res);

    expect(Evento.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true, estado: 'cerrado' });
  });

  it('retorna 500 ante un error inesperado', async () => {
    Evento.find.mockImplementation(() => { throw new Error('DB down'); });

    const req = { user: mockUser, query: {} };
    const res = mockRes();
    await getEventosHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
