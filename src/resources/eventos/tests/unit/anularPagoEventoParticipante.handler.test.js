import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { anularPagoEventoParticipanteHandler } from '../../handlers/anularPagoEventoParticipante.handler.js';

vi.mock('../../../movimientos/models/Movimiento.js', () => ({
  default: { findByIdAndUpdate: vi.fn() },
}));
vi.mock('../../models/EventoParticipante.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../services/anularPagoEventoParticipante.service.js', () => ({
  anularPagoEventoParticipante: vi.fn(),
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import Movimiento from '../../../movimientos/models/Movimiento.js';
import EventoParticipante from '../../models/EventoParticipante.js';
import { anularPagoEventoParticipante } from '../../services/anularPagoEventoParticipante.service.js';

const EVENTO_ID = '507f1f77bcf86cd799439011';
const PARTICIPANTE_ID = '507f1f77bcf86cd799439013';
const MOVIMIENTO_ID = '507f1f77bcf86cd799439014';
const mockUser = { clubId: 'CARC', email: 'admin@test.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

let sessionMock;

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock = {
    withTransaction: vi.fn(async (callback) => callback()),
    endSession: vi.fn(),
  };
  vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);
  Movimiento.findByIdAndUpdate.mockResolvedValue(null);
});

describe('anularPagoEventoParticipanteHandler', () => {
  it('anula el pago y desactiva el movimiento', async () => {
    EventoParticipante.findOne.mockReturnValue({
      session: vi.fn().mockResolvedValue({ pagos: [{ movimientoId: MOVIMIENTO_ID }] }),
    });
    anularPagoEventoParticipante.mockResolvedValue({ estado: 'pendiente' });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID } };
    const res = mockRes();
    await anularPagoEventoParticipanteHandler(req, res);

    expect(Movimiento.findByIdAndUpdate).toHaveBeenCalledWith(MOVIMIENTO_ID, { active: false, updatedBy: mockUser.email }, { session: sessionMock });
    expect(anularPagoEventoParticipante).toHaveBeenCalledWith({ clubId: 'CARC', movimientoId: MOVIMIENTO_ID, actor: mockUser.email, session: sessionMock });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si el participante no existe', async () => {
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(null) });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID } };
    const res = mockRes();
    await anularPagoEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 404 si el pago no pertenece a ese participante', async () => {
    EventoParticipante.findOne.mockReturnValue({
      session: vi.fn().mockResolvedValue({ pagos: [{ movimientoId: 'otro-movimiento' }] }),
    });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID } };
    const res = mockRes();
    await anularPagoEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(anularPagoEventoParticipante).not.toHaveBeenCalled();
  });

  it('retorna 400 si algún ID no es válido', async () => {
    const req = { user: mockUser, params: { eventoId: 'invalido', participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID } };
    const res = mockRes();
    await anularPagoEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 ante un error inesperado', async () => {
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockRejectedValue(new Error('DB down')) });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID } };
    const res = mockRes();
    await anularPagoEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
