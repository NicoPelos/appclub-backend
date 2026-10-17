import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registrarPagoEventoParticipanteHandler } from '../../handlers/registrarPagoEventoParticipante.handler.js';
import { BusinessError } from '../../services/registrarPagoEventoParticipante.service.js';

vi.mock('../../services/registrarPagoEventoParticipante.service.js', async () => {
  const actual = await vi.importActual('../../services/registrarPagoEventoParticipante.service.js');
  return { ...actual, registrarPagoEventoParticipante: vi.fn() };
});
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import { registrarPagoEventoParticipante } from '../../services/registrarPagoEventoParticipante.service.js';

const EVENTO_ID = '507f1f77bcf86cd799439011';
const PARTICIPANTE_ID = '507f1f77bcf86cd799439013';
const mockUser = { clubId: 'CARC', email: 'admin@test.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registrarPagoEventoParticipanteHandler', () => {
  it('devuelve 201 con el resultado del servicio', async () => {
    registrarPagoEventoParticipante.mockResolvedValue({
      participante: { toObject: () => ({ estado: 'pagada' }) },
      movimiento: { _id: 'mov1' },
    });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { monto: 20000, paymentMethod: 'Efectivo' } };
    const res = mockRes();
    await registrarPagoEventoParticipanteHandler(req, res);

    expect(registrarPagoEventoParticipante).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, monto: 20000, paymentMethod: 'Efectivo',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('propaga el status de un BusinessError', async () => {
    registrarPagoEventoParticipante.mockRejectedValue(new BusinessError('El participante ya está pagada', 409));

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: {} };
    const res = mockRes();
    await registrarPagoEventoParticipanteHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('retorna 500 ante un error inesperado', async () => {
    registrarPagoEventoParticipante.mockRejectedValue(new Error('DB down'));

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: {} };
    const res = mockRes();
    await registrarPagoEventoParticipanteHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
