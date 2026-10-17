import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { closeSuscripcionHandler } from '../../handlers/closeSuscripcion.handler.js';

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

describe('closeSuscripcionHandler', () => {
  it('cierra suscripción correctamente (200)', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const suscripcion = { _id: 'sus123', socioId: 'socio1', etiquetaId: 'etq1', fechaHasta: null, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Suscripcion.findOne.mockResolvedValue(suscripcion);

    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaHasta: '2026-06' } };
    const res = mockRes();

    await closeSuscripcionHandler(req, res);

    expect(suscripcion.fechaHasta).toBe('2026-06');
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('#197: devuelve 400 si fechaHasta es anterior a fechaDesde', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    Suscripcion.findOne.mockResolvedValue({ _id: 'sus123', fechaDesde: '2026-05', fechaHasta: null, save: mockSave, toObject: vi.fn().mockReturnValue({}) });

    const res = mockRes();
    await closeSuscripcionHandler({ user: mockUser, params: { id: 'sus123' }, body: { fechaHasta: '2026-04' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'fechaHasta no puede ser anterior a fechaDesde' });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('appcarc-backend#62: sincroniza la ficha de escuelita tras cerrar la suscripción', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const suscripcion = { _id: 'sus123', socioId: 'socio1', etiquetaId: 'etq-escuelita', fechaHasta: null, save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Suscripcion.findOne.mockResolvedValue(suscripcion);

    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaHasta: '2026-06' } };
    const res = mockRes();

    await closeSuscripcionHandler(req, res);

    expect(sincronizarEscuelitaPorSuscripcionModificada).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', socioId: 'socio1', etiquetaId: 'etq-escuelita',
    }));
  });

  it('retorna 404 si la suscripción no existe', async () => {
    Suscripcion.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: 'noexiste' }, body: { fechaHasta: '2026-06' } };
    const res = mockRes();

    await closeSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si ya tiene fechaHasta', async () => {
    const mockSave = vi.fn();
    const suscripcion = { _id: 'sus123', fechaHasta: '2026-03', save: mockSave };
    Suscripcion.findOne.mockResolvedValue(suscripcion);

    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaHasta: '2026-06' } };
    const res = mockRes();

    await closeSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('fecha de cierre') }));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('retorna 400 si falta fechaHasta en el body', async () => {
    const req = { user: mockUser, params: { id: 'sus123' }, body: {} };
    const res = mockRes();

    await closeSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('fechaHasta') }));
    expect(Suscripcion.findOne).not.toHaveBeenCalled();
  });

  it('retorna 400 si fechaHasta tiene formato inválido', async () => {
    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaHasta: '2026/06' } };
    const res = mockRes();

    await closeSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('YYYY-MM') }));
    expect(Suscripcion.findOne).not.toHaveBeenCalled();
  });

  it('retorna 500 si hay error de base de datos', async () => {
    Suscripcion.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaHasta: '2026-06' } };
    const res = mockRes();

    await closeSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
