import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moverInicioHandler } from '../../handlers/moverInicio.handler.js';

vi.mock('../../models/Suscripcion.js', () => ({
  default: { findOne: vi.fn() },
}));

import Suscripcion from '../../models/Suscripcion.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('moverInicioHandler', () => {
  it('adelanta la fecha de inicio correctamente (200)', async () => {
    const mockSave = vi.fn().mockResolvedValue();
    const suscripcion = { _id: 'sus123', socioId: 's1', etiquetaId: 'e1', fechaDesde: '2026-06', save: mockSave, toObject: vi.fn().mockReturnValue({}) };
    Suscripcion.findOne
      .mockResolvedValueOnce(suscripcion) // busca la suscripción
      .mockResolvedValueOnce(null); // chequeo de solapamiento: nada

    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaDesde: '2026-04' } };
    const res = mockRes();

    await moverInicioHandler(req, res);

    expect(suscripcion.fechaDesde).toBe('2026-04');
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si la suscripción no existe', async () => {
    Suscripcion.findOne.mockResolvedValueOnce(null);

    const req = { user: mockUser, params: { id: 'noexiste' }, body: { fechaDesde: '2026-04' } };
    const res = mockRes();

    await moverInicioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si falta fechaDesde en el body', async () => {
    const req = { user: mockUser, params: { id: 'sus123' }, body: {} };
    const res = mockRes();

    await moverInicioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('YYYY-MM') }));
    expect(Suscripcion.findOne).not.toHaveBeenCalled();
  });

  it('retorna 400 si fechaDesde tiene formato inválido', async () => {
    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaDesde: '2026/04' } };
    const res = mockRes();

    await moverInicioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(Suscripcion.findOne).not.toHaveBeenCalled();
  });

  it('retorna 400 si la nueva fecha no es anterior a la actual', async () => {
    const suscripcion = { _id: 'sus123', fechaDesde: '2026-06', save: vi.fn() };
    Suscripcion.findOne.mockResolvedValueOnce(suscripcion);

    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaDesde: '2026-06' } };
    const res = mockRes();

    await moverInicioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('anterior') }));
    expect(suscripcion.save).not.toHaveBeenCalled();
  });

  it('retorna 409 si otra suscripción activa ya cubre parte del nuevo rango', async () => {
    const suscripcion = { _id: 'sus123', socioId: 's1', etiquetaId: 'e1', fechaDesde: '2026-06', save: vi.fn() };
    Suscripcion.findOne
      .mockResolvedValueOnce(suscripcion)
      .mockResolvedValueOnce({ _id: 'otra' }); // hay solapamiento

    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaDesde: '2026-04' } };
    const res = mockRes();

    await moverInicioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(suscripcion.save).not.toHaveBeenCalled();
  });

  it('retorna 500 si hay error de base de datos', async () => {
    Suscripcion.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: 'sus123' }, body: { fechaDesde: '2026-04' } };
    const res = mockRes();

    await moverInicioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
