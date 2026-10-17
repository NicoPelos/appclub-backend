import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteEtiquetaHandler } from '../../handlers/deleteEtiqueta.handler.js';

vi.mock('../../models/Etiqueta.js', () => ({
  default: { findOne: vi.fn() },
}));

import Etiqueta from '../../models/Etiqueta.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('deleteEtiquetaHandler', () => {
  it('soft delete correctamente (200)', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const etiqueta = { _id: '1', active: true, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Etiqueta.findOne.mockResolvedValue(etiqueta);

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deleteEtiquetaHandler(req, res);

    expect(etiqueta.active).toBe(false);
    expect(etiqueta.deletedBy).toBe('admin@carc.com');
    expect(etiqueta.deletedAt).toBeInstanceOf(Date);
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Etiqueta eliminada' });
  });

  it('retorna 404 si no existe', async () => {
    Etiqueta.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deleteEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Etiqueta no encontrada' }));
  });

  it('retorna 500 si hay error', async () => {
    Etiqueta.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deleteEtiquetaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
