import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRefsHandler } from '../../handlers/resolveRefs.handler.js';

vi.mock('../../../socios/models/Socio.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../planes/models/Plan.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../suscripciones/models/Suscripcion.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../usuarios/models/User.js', () => ({
  default: { find: vi.fn() },
}));

import Socio from '../../../socios/models/Socio.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import User from '../../../usuarios/models/User.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const SOCIO_ID = '507f1f77bcf86cd799439011';
const ETIQUETA_ID = '507f1f77bcf86cd799439012';

beforeEach(() => {
  vi.clearAllMocks();
  Socio.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García' }]) });
  Etiqueta.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: ETIQUETA_ID, nombre: 'Cuota Social' }]) });
  User.find.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
});

describe('resolveRefsHandler', () => {
  it('retorna 400 si falta refs', async () => {
    const req = { body: {} };
    const res = mockRes();
    await resolveRefsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si refs tiene más de 200 elementos', async () => {
    const req = { body: { refs: Array.from({ length: 201 }, (_, i) => ({ model: 'Socio', id: String(i) })) } };
    const res = mockRes();
    await resolveRefsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('resuelve un Socio a "nombre apellido"', async () => {
    const req = { body: { refs: [{ model: 'Socio', id: SOCIO_ID }] } };
    const res = mockRes();
    await resolveRefsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.results).toEqual([{ model: 'Socio', id: SOCIO_ID, label: 'Ana García' }]);
  });

  it('resuelve varios modelos en paralelo', async () => {
    const req = { body: { refs: [{ model: 'Socio', id: SOCIO_ID }, { model: 'Etiqueta', id: ETIQUETA_ID }] } };
    const res = mockRes();
    await resolveRefsHandler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.results).toHaveLength(2);
    expect(body.results.find((r) => r.model === 'Etiqueta').label).toBe('Cuota Social');
  });

  it('ignora modelos fuera del allowlist', async () => {
    const req = { body: { refs: [{ model: 'AuditLog', id: SOCIO_ID }] } };
    const res = mockRes();
    await resolveRefsHandler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.results).toEqual([]);
  });

  it('ignora IDs con formato inválido', async () => {
    const req = { body: { refs: [{ model: 'Socio', id: 'no-es-un-objectid' }] } };
    const res = mockRes();
    await resolveRefsHandler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.results).toEqual([]);
  });

  it('label null si el documento no existe', async () => {
    const req = { body: { refs: [{ model: 'User', id: SOCIO_ID }] } };
    const res = mockRes();
    await resolveRefsHandler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.results).toEqual([{ model: 'User', id: SOCIO_ID, label: null }]);
  });

  it('retorna 500 si hay error inesperado', async () => {
    Socio.find.mockImplementation(() => { throw new Error('DB error'); });
    const req = { body: { refs: [{ model: 'Socio', id: SOCIO_ID }] } };
    const res = mockRes();
    await resolveRefsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
