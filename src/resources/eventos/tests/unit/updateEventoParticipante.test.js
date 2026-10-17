import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateEventoParticipanteHandler } from '../../handlers/updateEventoParticipante.handler.js';

vi.mock('../../models/EventoParticipante.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../socios/models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import EventoParticipante from '../../models/EventoParticipante.js';
import Socio from '../../../socios/models/Socio.js';

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
  socioId: null,
  nombre: 'Juan',
  apellido: 'Pérez',
  montoEsperadoSnapshot: 20000,
  montoPagadoSnapshot: 0,
  estado: 'pendiente',
  updatedBy: '',
  save: vi.fn(async function () { return this; }),
  toObject: vi.fn(function () { return { ...this }; }),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateEventoParticipanteHandler', () => {
  it('actualiza el monto esperado', async () => {
    const participante = buildParticipante();
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { monto: 25000 } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);

    expect(participante.montoEsperadoSnapshot).toBe(25000);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('recalcula estado a pagada si el nuevo monto queda cubierto por lo ya pagado', async () => {
    const participante = buildParticipante({ montoPagadoSnapshot: 20000, estado: 'pendiente' });
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { monto: 20000 } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);

    expect(participante.estado).toBe('pagada');
  });

  it('actualiza nombre/apellido si no es socio', async () => {
    const participante = buildParticipante();
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { nombre: 'Juana' } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);

    expect(participante.nombre).toBe('Juana');
  });

  it('retorna 400 si intenta editar el nombre de un participante que es socio', async () => {
    const participante = buildParticipante({ socioId: 'socio1' });
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { nombre: 'Otro' } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si el nuevo monto es menor a lo ya pagado', async () => {
    const participante = buildParticipante({ montoPagadoSnapshot: 15000 });
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { monto: 10000 } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 404 si el participante no existe', async () => {
    EventoParticipante.findOne.mockResolvedValue(null);
    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: {} };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 409 si el participante ya está anulado', async () => {
    const participante = buildParticipante({ estado: 'anulada' });
    EventoParticipante.findOne.mockResolvedValue(participante);
    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { monto: 1 } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('actualiza las notas', async () => {
    const participante = buildParticipante();
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { notas: '1 con imagen, talle M' } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);

    expect(participante.notas).toBe('1 con imagen, talle M');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('vincula el participante a un socio existente', async () => {
    const participante = buildParticipante({ socioId: null });
    EventoParticipante.findOne
      .mockResolvedValueOnce(participante) // el propio participante
      .mockResolvedValueOnce(null); // nadie más del roster tiene ese socioId
    Socio.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439099', nombre: 'Ana', apellido: 'Gómez' });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { socioId: '507f1f77bcf86cd799439099' } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);

    expect(participante.socioId).toBe('507f1f77bcf86cd799439099');
    expect(participante.nombre).toBe('Ana');
    expect(participante.apellido).toBe('Gómez');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 400 si el participante ya es socio y se intenta vincular a otro', async () => {
    const participante = buildParticipante({ socioId: '507f1f77bcf86cd799439098' });
    EventoParticipante.findOne.mockResolvedValue(participante);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { socioId: '507f1f77bcf86cd799439097' } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 404 si el socio a vincular no existe', async () => {
    const participante = buildParticipante({ socioId: null });
    EventoParticipante.findOne.mockResolvedValueOnce(participante);
    Socio.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { socioId: '507f1f77bcf86cd799439096' } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 409 si el socio a vincular ya está en el roster', async () => {
    const participante = buildParticipante({ socioId: null });
    EventoParticipante.findOne
      .mockResolvedValueOnce(participante)
      .mockResolvedValueOnce({ _id: 'otroParticipante' });
    Socio.findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439099', nombre: 'Ana', apellido: 'Gómez' });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: { socioId: '507f1f77bcf86cd799439099' } };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('retorna 500 ante un error inesperado', async () => {
    EventoParticipante.findOne.mockRejectedValue(new Error('DB down'));
    const req = { user: mockUser, params: { eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID }, body: {} };
    const res = mockRes();
    await updateEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
