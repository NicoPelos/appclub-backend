import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearEventoHandler } from '../../handlers/crearEvento.handler.js';

vi.mock('../../models/Evento.js', () => ({
  default: vi.fn(),
  CATEGORIAS_EVENTO: ['Viajes', 'Charla / Curso', 'Ventas / Reventa', 'Otros'],
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import Evento from '../../models/Evento.js';

const mockUser = { clubId: 'CARC', email: 'admin@test.com', id: 'uid1' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const BASE_BODY = {
  nombre: 'Trekking a Cerro Negro',
  categoria: 'Viajes',
  fecha: '2026-09-13',
  precioSugerido: 15000,
};

beforeEach(() => {
  vi.clearAllMocks();
  const saveMock = vi.fn().mockResolvedValue(undefined);
  const toObjectMock = vi.fn().mockReturnValue({ ...BASE_BODY, _id: 'evento1' });
  Evento.mockImplementation(() => ({ save: saveMock, toObject: toObjectMock, _id: 'evento1' }));
});

describe('crearEventoHandler', () => {
  it('crea un evento correctamente', async () => {
    const req = { user: mockUser, body: BASE_BODY };
    const res = mockRes();

    await crearEventoHandler(req, res);

    expect(Evento).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC',
      nombre: 'Trekking a Cerro Negro',
      categoria: 'Viajes',
      precioSugerido: 15000,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('precioSugerido es opcional (queda null si no se envía)', async () => {
    const req = { user: mockUser, body: { nombre: 'Curso de nudos', categoria: 'Otros', fecha: '2026-10-01' } };
    const res = mockRes();

    await crearEventoHandler(req, res);

    expect(Evento).toHaveBeenCalledWith(expect.objectContaining({ precioSugerido: null }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 400 si falta nombre', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, nombre: '  ' } };
    const res = mockRes();
    await crearEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si categoria inválida', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, categoria: 'Inventada' } };
    const res = mockRes();
    await crearEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si falta fecha', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, fecha: undefined } };
    const res = mockRes();
    await crearEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si fecha es inválida', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, fecha: 'no-es-una-fecha' } };
    const res = mockRes();
    await crearEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si precioSugerido es negativo', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, precioSugerido: -100 } };
    const res = mockRes();
    await crearEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 si hay error inesperado', async () => {
    const saveMock = vi.fn().mockRejectedValue(new Error('DB error'));
    Evento.mockImplementation(() => ({ save: saveMock, toObject: vi.fn() }));

    const req = { user: mockUser, body: BASE_BODY };
    const res = mockRes();
    await crearEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
