import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateEventoHandler } from '../../handlers/updateEvento.handler.js';

vi.mock('../../models/Evento.js', () => ({
  default: { findOne: vi.fn() },
  CATEGORIAS_EVENTO: ['Viajes', 'Charla / Curso', 'Ventas / Reventa', 'Otros'],
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
  nombre: 'Trekking a Cerro Negro',
  descripcion: '',
  categoria: 'Viajes',
  fecha: new Date('2026-09-13'),
  precioSugerido: 15000,
  estado: 'abierto',
  active: true,
  updatedBy: '',
  save: vi.fn(async function () { return this; }),
  toObject: vi.fn(function () { return { ...this }; }),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateEventoHandler', () => {
  it('actualiza los campos enviados', async () => {
    const evento = buildEvento();
    Evento.findOne.mockResolvedValue(evento);

    const req = { user: mockUser, params: { id: EVENTO_ID }, body: { nombre: 'Trekking al Champaquí', precioSugerido: 18000 } };
    const res = mockRes();
    await updateEventoHandler(req, res);

    expect(evento.nombre).toBe('Trekking al Champaquí');
    expect(evento.precioSugerido).toBe(18000);
    expect(evento.save).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('permite dejar precioSugerido en null', async () => {
    const evento = buildEvento();
    Evento.findOne.mockResolvedValue(evento);

    const req = { user: mockUser, params: { id: EVENTO_ID }, body: { precioSugerido: null } };
    const res = mockRes();
    await updateEventoHandler(req, res);

    expect(evento.precioSugerido).toBeNull();
  });

  it('retorna 400 si el id no es válido', async () => {
    const req = { user: mockUser, params: { id: 'invalido' }, body: {} };
    const res = mockRes();
    await updateEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 404 si el evento no existe', async () => {
    Evento.findOne.mockResolvedValue(null);
    const req = { user: mockUser, params: { id: EVENTO_ID }, body: {} };
    const res = mockRes();
    await updateEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si categoria inválida', async () => {
    const evento = buildEvento();
    Evento.findOne.mockResolvedValue(evento);
    const req = { user: mockUser, params: { id: EVENTO_ID }, body: { categoria: 'Inventada' } };
    const res = mockRes();
    await updateEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si nombre queda vacío', async () => {
    const evento = buildEvento();
    Evento.findOne.mockResolvedValue(evento);
    const req = { user: mockUser, params: { id: EVENTO_ID }, body: { nombre: '   ' } };
    const res = mockRes();
    await updateEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 ante un error inesperado', async () => {
    Evento.findOne.mockRejectedValue(new Error('DB down'));
    const req = { user: mockUser, params: { id: EVENTO_ID }, body: {} };
    const res = mockRes();
    await updateEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
