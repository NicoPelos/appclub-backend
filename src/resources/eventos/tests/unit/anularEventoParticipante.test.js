import { describe, it, expect, vi, beforeEach } from 'vitest';
import { anularEventoParticipanteHandler } from '../../handlers/anularEventoParticipante.handler.js';

vi.mock('../../models/EventoParticipante.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import EventoParticipante from '../../models/EventoParticipante.js';

const EVENTO_ID = '507f1f77bcf86cd799439011';
const PARTICIPANTE_ID = '507f1f77bcf86cd799439013';
const mockUser = { clubId: 'CARC', email: 'admin@test.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildParticipante = (overrides = {}) => ({
  _id: PARTICIPANTE_ID,
  estado: 'pendiente',
  active: true,
  pagos: [],
  updatedBy: '',
  save: vi.fn(async function () { return this; }),
  toObject: vi.fn(function () { return { ...this }; }),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('anularEventoParticipanteHandler', () => {
  it('anula un participante sin pagos', async () => {
    const participante = buildParticipante();
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID } };
    const res = mockRes();
    await anularEventoParticipanteHandler(req, res);

    expect(participante.estado).toBe('anulada');
    expect(participante.active).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 409 si tiene pagos registrados', async () => {
    const participante = buildParticipante({ pagos: [{ monto: 5000 }] });
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID } };
    const res = mockRes();
    await anularEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(participante.save).not.toHaveBeenCalled();
  });

  it('retorna 409 si ya está anulado', async () => {
    const participante = buildParticipante({ estado: 'anulada' });
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID } };
    const res = mockRes();
    await anularEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('retorna 404 si no existe', async () => {
    EventoParticipante.findOne.mockResolvedValue(null);
    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID } };
    const res = mockRes();
    await anularEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si algún id no es válido', async () => {
    const req = { user: mockUser, params: { eventoId: 'invalido', participanteId: PARTICIPANTE_ID } };
    const res = mockRes();
    await anularEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 ante un error inesperado', async () => {
    EventoParticipante.findOne.mockRejectedValue(new Error('DB down'));
    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID } };
    const res = mockRes();
    await anularEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
