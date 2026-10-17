import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { deleteSuscripcionHandler } from '../../handlers/deleteSuscripcion.handler.js';

vi.mock('../../models/Suscripcion.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../escuelita/services/sincronizarSuscripcionPlan.service.js', () => ({
  sincronizarEscuelitaPorSuscripcionModificada: vi.fn(),
}));

import Suscripcion from '../../models/Suscripcion.js';
import { sincronizarEscuelitaPorSuscripcionModificada } from '../../../escuelita/services/sincronizarSuscripcionPlan.service.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  sincronizarEscuelitaPorSuscripcionModificada.mockResolvedValue(undefined);
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: vi.fn(async (cb) => cb()),
    endSession: vi.fn(),
  });
});

describe('deleteSuscripcionHandler', () => {
  it('elimina suscripción correctamente (200)', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const suscripcion = { _id: 'sus123', socioId: 'socio1', etiquetaId: 'etq1', active: true, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Suscripcion.findOne.mockResolvedValue(suscripcion);

    const req = { user: mockUser, params: { id: 'sus123' } };
    const res = mockRes();

    await deleteSuscripcionHandler(req, res);

    expect(suscripcion.active).toBe(false);
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Suscripción eliminada' });
  });

  it('appcarc-backend#62: sincroniza la ficha de escuelita tras eliminar la suscripción', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const suscripcion = { _id: 'sus123', socioId: 'socio1', etiquetaId: 'etq-escuelita', active: true, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Suscripcion.findOne.mockResolvedValue(suscripcion);

    const req = { user: mockUser, params: { id: 'sus123' } };
    const res = mockRes();

    await deleteSuscripcionHandler(req, res);

    expect(sincronizarEscuelitaPorSuscripcionModificada).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', socioId: 'socio1', etiquetaId: 'etq-escuelita',
    }));
  });

  it('retorna 404 si la suscripción no existe', async () => {
    Suscripcion.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: 'noexiste' } };
    const res = mockRes();

    await deleteSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error de base de datos', async () => {
    Suscripcion.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: 'sus123' } };
    const res = mockRes();

    await deleteSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
