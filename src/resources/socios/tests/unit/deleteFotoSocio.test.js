import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  promises: { unlink: vi.fn().mockResolvedValue() },
}));

vi.mock('../../models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));

import { deleteFotoSocioHandler } from '../../handlers/deleteFotoSocio.handler.js';
import Socio from '../../models/Socio.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockSave = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('deleteFotoSocioHandler', () => {
  it('quita la foto correctamente', async () => {
    const socio = { _id: 'socio1', fotoPerfil: '/uploads/fotos/socio_socio1.jpg', save: mockSave };
    Socio.findOne.mockResolvedValue(socio);
    mockSave.mockResolvedValue();

    const req = {
      user: { clubId: 'CARC', role: 'admin', email: 'admin@carc.com' },
      params: { id: 'socio1' },
    };
    const res = mockRes();
    await deleteFotoSocioHandler(req, res);

    expect(socio.fotoPerfil).toBeNull();
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si socio no existe', async () => {
    Socio.findOne.mockResolvedValue(null);

    const req = {
      user: { clubId: 'CARC', role: 'admin', email: 'admin@carc.com' },
      params: { id: 'socio1' },
    };
    const res = mockRes();
    await deleteFotoSocioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error al procesar', async () => {
    Socio.findOne.mockRejectedValue(new Error('DB'));

    const req = {
      user: { clubId: 'CARC', role: 'admin', email: 'admin@carc.com' },
      params: { id: 'socio1' },
    };
    const res = mockRes();
    await deleteFotoSocioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
