import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateRecursoHandler } from '../../handlers/updateRecurso.handler.js';

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

describe('updateRecursoHandler', () => {
  it('actualiza recurso correctamente (200)', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const recurso = { _id: '1', nombre: 'Los Gigantes', save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    RecursoExterno.findOne.mockResolvedValue(recurso);

    const req = { user: mockUser, params: { id: '1' }, body: { nombre: 'Los Gigantes (sector Amboy)' } };
    const res = mockRes();

    await updateRecursoHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(recurso.nombre).toBe('Los Gigantes (sector Amboy)');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 400 si el tipo enviado es inválido', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const recurso = { _id: '1', tipo: 'topo', save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    RecursoExterno.findOne.mockResolvedValue(recurso);

    const req = { user: mockUser, params: { id: '1' }, body: { tipo: 'via-ferrata' } };
    const res = mockRes();

    await updateRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSave).not.toHaveBeenCalled();
    expect(recurso.tipo).toBe('topo');
  });

  it('normaliza urlProvincia vacío a null', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const recurso = { _id: '1', urlProvincia: 'https://old.example', save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    RecursoExterno.findOne.mockResolvedValue(recurso);

    const req = { user: mockUser, params: { id: '1' }, body: { urlProvincia: '' } };
    const res = mockRes();

    await updateRecursoHandler(req, res);

    expect(recurso.urlProvincia).toBeNull();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si no existe', async () => {
    RecursoExterno.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: '1' }, body: { nombre: 'Nuevo nombre' } };
    const res = mockRes();

    await updateRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Recurso no encontrado' }));
  });

  it('retorna 500 si hay error', async () => {
    RecursoExterno.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: '1' }, body: {} };
    const res = mockRes();

    await updateRecursoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
