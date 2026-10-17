import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deletePrecioHandler } from '../../handlers/deletePrecio.handler.js';

vi.mock('../../models/Precios.js', () => ({
  default: { findOne: vi.fn() },
}));

import Precios from '../../models/Precios.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('deletePrecioHandler', () => {
  it('soft delete correctamente', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const precio = { _id: '1', active: true, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Precios.findOne.mockResolvedValue(precio);

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deletePrecioHandler(req, res);

    expect(precio.active).toBe(false);
    expect(precio.deletedBy).toBe('admin@carc.com');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si no existe', async () => {
    Precios.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deletePrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error', async () => {
    Precios.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deletePrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
