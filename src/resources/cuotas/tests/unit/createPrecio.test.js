import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { createPrecioHandler } from '../../handlers/createPrecio.handler.js';

const mockSave = vi.fn();
vi.mock('../../models/Precios.js', () => ({
  default: vi.fn(),
}));
vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { findOne: vi.fn(), findById: vi.fn() },
}));

import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import Precios from '../../models/Precios.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const validBody = {
  etiquetaId: '6650000000000000000000aa',
  unidad: 'mes',
  monto: 15000,
};

beforeEach(() => {
  vi.clearAllMocks();
  Etiqueta.findOne.mockResolvedValue({ _id: validBody.etiquetaId, nombre: 'Cuota Social' });
  Etiqueta.findById.mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ nombre: 'Cuota Social' }) }) });
  Precios.mockImplementation((data) => ({ ...data, save: mockSave, toObject: vi.fn().mockReturnValue(data) }));
  Precios.find = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }); // sin otros precios de la etiqueta por default
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: vi.fn(async (callback) => callback()),
    endSession: vi.fn(),
  });
});

describe('createPrecioHandler', () => {
  it('crea precio correctamente', async () => {
    mockSave.mockResolvedValue();
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 400 si falta etiquetaId', async () => {
    const req = { user: mockUser, body: { ...validBody, etiquetaId: undefined } };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si unidad es inválida', async () => {
    const req = { user: mockUser, body: { ...validBody, unidad: 'quincenal' } };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si monto es negativo', async () => {
    const req = { user: mockUser, body: { ...validBody, monto: -100 } };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si vigenteDesde es inválido', async () => {
    const req = { user: mockUser, body: { ...validBody, vigenteDesde: 'no-es-fecha' } };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'vigenteDesde inválido' });
  });

  it('retorna 400 si vigenteHasta es inválido', async () => {
    const req = { user: mockUser, body: { ...validBody, vigenteHasta: 'no-es-fecha' } };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'vigenteHasta inválido' });
  });

  it('retorna 404 si etiqueta no existe', async () => {
    Etiqueta.findOne.mockResolvedValue(null);
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error al guardar', async () => {
    mockSave.mockRejectedValue(new Error('DB error'));
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('retorna 409 con requiereConfirmacion si hay un precio anterior sin cerrar y no viene confirmarCierre', async () => {
    Precios.find = vi.fn().mockReturnValue({
      session: vi.fn().mockResolvedValue([
        { _id: 'p1', nombre: 'Cuota Social', vigenteDesde: new Date('2026-06-01'), vigenteHasta: null, save: vi.fn() },
      ]),
    });
    const req = { user: mockUser, body: { ...validBody, vigenteDesde: '2026-08-01' } };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requiereConfirmacion: true }));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('con confirmarCierre:true, cierra el anterior y crea el nuevo', async () => {
    const anteriorSave = vi.fn().mockResolvedValue(undefined);
    Precios.find = vi.fn().mockReturnValue({
      session: vi.fn().mockResolvedValue([
        { _id: 'p1', nombre: 'Cuota Social', vigenteDesde: new Date('2026-06-01'), vigenteHasta: null, save: anteriorSave },
      ]),
    });
    mockSave.mockResolvedValue();
    const req = { user: mockUser, body: { ...validBody, vigenteDesde: '2026-08-01', confirmarCierre: true } };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(anteriorSave).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 409 (sin requiereConfirmacion) si otro precio arranca el mismo día', async () => {
    Precios.find = vi.fn().mockReturnValue({
      session: vi.fn().mockResolvedValue([
        { _id: 'p1', nombre: 'Cuota Social Ago', vigenteDesde: new Date('2026-08-01'), vigenteHasta: null, save: vi.fn() },
      ]),
    });
    const req = { user: mockUser, body: { ...validBody, vigenteDesde: '2026-08-01' } };
    const res = mockRes();

    await createPrecioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.not.objectContaining({ requiereConfirmacion: true }));
  });
});
