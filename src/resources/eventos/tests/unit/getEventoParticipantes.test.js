import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEventoParticipantesHandler } from '../../handlers/getEventoParticipantes.handler.js';

vi.mock('../../models/Evento.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../models/EventoParticipante.js', () => ({
  default: { find: vi.fn() },
}));

import Evento from '../../models/Evento.js';
import EventoParticipante from '../../models/EventoParticipante.js';

const EVENTO_ID = '507f1f77bcf86cd799439011';
const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const chainable = (result) => ({
  sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEventoParticipantesHandler', () => {
  it('lista los participantes activos del evento', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: EVENTO_ID }) });
    EventoParticipante.find.mockReturnValue(chainable([{ nombre: 'Juan' }]));

    const req = { user: mockUser, params: { eventoId: EVENTO_ID } };
    const res = mockRes();
    await getEventoParticipantesHandler(req, res);

    expect(EventoParticipante.find).toHaveBeenCalledWith({ eventoId: EVENTO_ID, active: true });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si el evento no existe', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID } };
    const res = mockRes();
    await getEventoParticipantesHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si el eventoId no es válido', async () => {
    const req = { user: mockUser, params: { eventoId: 'invalido' } };
    const res = mockRes();
    await getEventoParticipantesHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 ante un error inesperado', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error('DB down')) });
    const req = { user: mockUser, params: { eventoId: EVENTO_ID } };
    const res = mockRes();
    await getEventoParticipantesHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
