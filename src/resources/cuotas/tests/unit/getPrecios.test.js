import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPreciosHandler } from '../../handlers/getPrecios.handler.js';

vi.mock('../../models/Precios.js', () => ({
  default: { find: vi.fn() },
}));

import Precios from '../../models/Precios.js';

const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockFind = (result = []) => {
  Precios.find.mockReturnValue({
    populate: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }),
  });
};

beforeEach(() => vi.clearAllMocks());

describe('getPreciosHandler', () => {
  it('devuelve lista de precios activos', async () => {
    const precios = [{ nombre: 'Cuota Social', monto: 15000 }];
    mockFind(precios);

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getPreciosHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(precios);
  });

  it('filtra por etiquetaId', async () => {
    mockFind([]);

    const req = { user: mockUser, query: { etiquetaId: '6650000000000000000000aa' } };
    const res = mockRes();

    await getPreciosHandler(req, res);

    expect(Precios.find).toHaveBeenCalledWith(expect.objectContaining({ etiquetaId: '6650000000000000000000aa' }));
  });

  it('muestra eliminados con trash=true', async () => {
    mockFind([]);

    const req = { user: mockUser, query: { trash: 'true' } };
    const res = mockRes();

    await getPreciosHandler(req, res);

    expect(Precios.find).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it('retorna 500 si hay error', async () => {
    Precios.find.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error('DB error')) }),
    });

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getPreciosHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
