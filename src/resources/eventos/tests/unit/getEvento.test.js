import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEventoHandler } from '../../handlers/getEvento.handler.js';

vi.mock('../../models/Evento.js', () => ({
  default: { findOne: vi.fn() },
}));

import Evento from '../../models/Evento.js';

const EVENTO_ID = '507f1f77bcf86cd799439011';
const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEventoHandler', () => {
  it('devuelve el evento encontrado', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: EVENTO_ID, nombre: 'Viaje' }) });

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await getEventoHandler(req, res);

    expect(Evento.findOne).toHaveBeenCalledWith({ _id: EVENTO_ID, clubId: 'CARC', active: true });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 400 si el id no es un ObjectId válido', async () => {
    const req = { user: mockUser, params: { id: 'invalido' } };
    const res = mockRes();
    await getEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Evento.findOne).not.toHaveBeenCalled();
  });

  it('retorna 404 si no se encuentra', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await getEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 ante un error inesperado', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error('DB down')) });

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await getEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
