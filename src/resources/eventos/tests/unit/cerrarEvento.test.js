import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cerrarEventoHandler } from '../../handlers/cerrarEvento.handler.js';

vi.mock('../../models/Evento.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import Evento from '../../models/Evento.js';

const EVENTO_ID = '507f1f77bcf86cd799439011';
const mockUser = { clubId: 'CARC', email: 'admin@test.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildEvento = (overrides = {}) => ({
  _id: EVENTO_ID,
  estado: 'abierto',
  updatedBy: '',
  save: vi.fn(async function () { return this; }),
  toObject: vi.fn(function () { return { ...this }; }),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cerrarEventoHandler', () => {
  it('cierra un evento abierto', async () => {
    const evento = buildEvento();
    Evento.findOne.mockResolvedValue(evento);

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await cerrarEventoHandler(req, res);

    expect(evento.estado).toBe('cerrado');
    expect(evento.save).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 409 si ya está cerrado', async () => {
    const evento = buildEvento({ estado: 'cerrado' });
    Evento.findOne.mockResolvedValue(evento);

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await cerrarEventoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(evento.save).not.toHaveBeenCalled();
  });

  it('retorna 404 si no existe', async () => {
    Evento.findOne.mockResolvedValue(null);
    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await cerrarEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si el id no es válido', async () => {
    const req = { user: mockUser, params: { id: 'invalido' } };
    const res = mockRes();
    await cerrarEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 ante un error inesperado', async () => {
    Evento.findOne.mockRejectedValue(new Error('DB down'));
    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await cerrarEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
