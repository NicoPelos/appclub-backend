import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { updatePrecioHandler } from '../../handlers/updatePrecio.handler.js';

vi.mock('../../models/Precios.js', () => ({
  default: { findOne: vi.fn(), find: vi.fn() },
}));
vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { findById: vi.fn() },
}));

import Precios from '../../models/Precios.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  Precios.find.mockReturnValue({ session: vi.fn().mockResolvedValue([]) }); // sin otros precios de la etiqueta por default
  Etiqueta.findById.mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ nombre: 'Cuota Social' }) }) });
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: vi.fn(async (callback) => callback()),
    endSession: vi.fn(),
  });
});

describe('updatePrecioHandler', () => {
  it('actualiza monto correctamente', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    Precios.findOne.mockResolvedValue({ _id: '1', monto: 5000, save: mockSave, toObject: vi.fn().mockReturnValue({}) });

    const req = { user: mockUser, params: { id: '1' }, body: { monto: 6000 } };
    const res = mockRes();

    await updatePrecioHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si no existe', async () => {
    Precios.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: '1' }, body: { monto: 6000 } };
    const res = mockRes();

    await updatePrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si monto es inválido', async () => {
    Precios.findOne.mockResolvedValue({ _id: '1', save: vi.fn(), toObject: vi.fn().mockReturnValue({}) });

    const req = { user: mockUser, params: { id: '1' }, body: { monto: -50 } };
    const res = mockRes();

    await updatePrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si vigenteDesde es inválido', async () => {
    Precios.findOne.mockResolvedValue({ _id: '1', save: vi.fn(), toObject: vi.fn().mockReturnValue({}) });

    const req = { user: mockUser, params: { id: '1' }, body: { vigenteDesde: 'no-es-fecha' } };
    const res = mockRes();

    await updatePrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 si hay error', async () => {
    Precios.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: '1' }, body: {} };
    const res = mockRes();

    await updatePrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('no revisa superposición si no se tocan las fechas (solo monto/nombre)', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    Precios.findOne.mockResolvedValue({ _id: '1', etiquetaId: 'etq1', monto: 5000, save: mockSave, toObject: vi.fn().mockReturnValue({}) });

    const req = { user: mockUser, params: { id: '1' }, body: { monto: 6000 } };
    const res = mockRes();

    await updatePrecioHandler(req, res);

    expect(Precios.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 409 con requiereConfirmacion si mover vigenteDesde deja a otro precio sin cerrar', async () => {
    Precios.findOne.mockResolvedValue({ _id: '1', etiquetaId: 'etq1', vigenteDesde: new Date('2026-06-01'), vigenteHasta: null, save: vi.fn(), toObject: vi.fn().mockReturnValue({}) });
    Precios.find.mockReturnValue({
      session: vi.fn().mockResolvedValue([
        { _id: 'p2', nombre: 'Cuota Escuelita', vigenteDesde: new Date('2026-05-01'), vigenteHasta: null, save: vi.fn() },
      ]),
    });

    const req = { user: mockUser, params: { id: '1' }, body: { vigenteDesde: '2026-08-01' } };
    const res = mockRes();

    await updatePrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requiereConfirmacion: true }));
  });
});
