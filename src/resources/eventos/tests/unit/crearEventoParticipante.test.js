import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearEventoParticipanteHandler } from '../../handlers/crearEventoParticipante.handler.js';

vi.mock('../../models/Evento.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../models/EventoParticipante.js', () => ({
  default: vi.fn(),
}));
vi.mock('../../../socios/models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import Evento from '../../models/Evento.js';
import EventoParticipante from '../../models/EventoParticipante.js';
import Socio from '../../../socios/models/Socio.js';

const EVENTO_ID = '507f1f77bcf86cd799439011';
const SOCIO_ID = '507f1f77bcf86cd799439012';
const mockUser = { clubId: 'CARC', email: 'admin@test.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildEvento = (overrides = {}) => ({
  _id: EVENTO_ID,
  clubId: 'CARC',
  estado: 'abierto',
  precioSugerido: 15000,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  EventoParticipante.findOne = vi.fn().mockResolvedValue(null);
  const saveMock = vi.fn().mockResolvedValue(undefined);
  const toObjectMock = vi.fn().mockReturnValue({ _id: 'participante1' });
  EventoParticipante.mockImplementation(() => ({ save: saveMock, toObject: toObjectMock, _id: 'participante1' }));
});

describe('crearEventoParticipanteHandler', () => {
  it('agrega un socio existente, tomando nombre/apellido del Socio', async () => {
    Evento.findOne.mockResolvedValue(buildEvento());
    Socio.findOne.mockResolvedValue({ _id: SOCIO_ID, nombre: 'Nahuel', apellido: 'Nicolai' });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { socioId: SOCIO_ID } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);

    expect(EventoParticipante).toHaveBeenCalledWith(expect.objectContaining({
      socioId: SOCIO_ID, nombre: 'Nahuel', apellido: 'Nicolai', montoEsperadoSnapshot: 15000,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('agrega un participante no-socio con nombre/apellido sueltos', async () => {
    Evento.findOne.mockResolvedValue(buildEvento());

    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { nombre: 'Juan', apellido: 'Pérez', monto: 20000 } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);

    expect(EventoParticipante).toHaveBeenCalledWith(expect.objectContaining({
      socioId: null, nombre: 'Juan', apellido: 'Pérez', montoEsperadoSnapshot: 20000,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('guarda las notas si se mandan', async () => {
    Evento.findOne.mockResolvedValue(buildEvento());
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { nombre: 'Juan', monto: 20000, notas: '1 con imagen, talle M' } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(EventoParticipante).toHaveBeenCalledWith(expect.objectContaining({ notas: '1 con imagen, talle M' }));
  });

  it('usa el monto del body por sobre el precioSugerido del evento', async () => {
    Evento.findOne.mockResolvedValue(buildEvento({ precioSugerido: 15000 }));
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { nombre: 'Juan', monto: 12000 } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(EventoParticipante).toHaveBeenCalledWith(expect.objectContaining({ montoEsperadoSnapshot: 12000 }));
  });

  it('retorna 400 si no hay monto ni precioSugerido', async () => {
    Evento.findOne.mockResolvedValue(buildEvento({ precioSugerido: null }));
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { nombre: 'Juan' } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si se manda socioId y nombre a la vez', async () => {
    Evento.findOne.mockResolvedValue(buildEvento());
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { socioId: SOCIO_ID, nombre: 'Juan' } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si no se manda ni socioId ni nombre', async () => {
    Evento.findOne.mockResolvedValue(buildEvento());
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: {} };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 404 si el evento no existe', async () => {
    Evento.findOne.mockResolvedValue(null);
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { nombre: 'Juan' } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 409 si el evento está cerrado', async () => {
    Evento.findOne.mockResolvedValue(buildEvento({ estado: 'cerrado' }));
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { nombre: 'Juan' } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('retorna 404 si el socioId no existe', async () => {
    Evento.findOne.mockResolvedValue(buildEvento());
    Socio.findOne.mockResolvedValue(null);
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { socioId: SOCIO_ID } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 409 si el socio ya está en el roster', async () => {
    Evento.findOne.mockResolvedValue(buildEvento());
    Socio.findOne.mockResolvedValue({ _id: SOCIO_ID, nombre: 'Nahuel', apellido: 'Nicolai' });
    EventoParticipante.findOne.mockResolvedValue({ _id: 'existing' });

    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { socioId: SOCIO_ID } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('retorna 500 ante un error inesperado', async () => {
    Evento.findOne.mockRejectedValue(new Error('DB down'));
    const req = { user: mockUser, params: { eventoId: EVENTO_ID }, body: { nombre: 'Juan' } };
    const res = mockRes();
    await crearEventoParticipanteHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
