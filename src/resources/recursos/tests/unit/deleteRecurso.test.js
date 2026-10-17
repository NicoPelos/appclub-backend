import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteRecursoHandler } from '../../handlers/deleteRecurso.handler.js';

vi.mock('../../models/RecursoExterno.js', () => ({
  default: { findOne: vi.fn() },
}));

import RecursoExterno from '../../models/RecursoExterno.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('deleteRecursoHandler', () => {
  it('soft delete correctamente (200)', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const recurso = { _id: '1', active: true, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    RecursoExterno.findOne.mockResolvedValue(recurso);

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deleteRecursoHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(recurso.active).toBe(false);
    expect(recurso.deletedAt).toBeInstanceOf(Date);
    expect(recurso.deletedBy).toBe('admin@carc.com');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si no existe', async () => {
    RecursoExterno.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deleteRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error', async () => {
    RecursoExterno.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: '1' } };
    const res = mockRes();

    await deleteRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
