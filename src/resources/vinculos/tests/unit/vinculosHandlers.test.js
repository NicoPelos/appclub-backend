import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/crearVinculoFamiliar.service.js', () => ({
  crearVinculoFamiliar: vi.fn(),
  BusinessError: class BusinessError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  },
}));
vi.mock('../../services/anularVinculoFamiliar.service.js', () => ({
  anularVinculoFamiliar: vi.fn(),
  BusinessError: class BusinessError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  },
}));
vi.mock('../../models/VinculoFamiliar.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import { crearVinculoHandler } from '../../handlers/crearVinculo.handler.js';
import { anularVinculoHandler } from '../../handlers/anularVinculo.handler.js';
import { getVinculosHandler } from '../../handlers/getVinculos.handler.js';
import { crearVinculoFamiliar } from '../../services/crearVinculoFamiliar.service.js';
import { anularVinculoFamiliar } from '../../services/anularVinculoFamiliar.service.js';
import VinculoFamiliar from '../../models/VinculoFamiliar.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const USER = { clubId: 'CARC', email: 'admin@carc.test' };
const VALID_ID = '507f1f77bcf86cd799439011';

beforeEach(() => vi.clearAllMocks());

describe('appcarc-backend#212: IDs con formato inválido devuelven 400, no 500', () => {
  it('crearVinculoHandler: 400 si hijoSocioId no es un ObjectId válido', async () => {
    const req = { user: USER, body: { hijoSocioId: 'no-es-un-id' } };
    const res = mockRes();
    await crearVinculoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(crearVinculoFamiliar).not.toHaveBeenCalled();
  });

  it('crearVinculoHandler: 400 si padreUserId no es un ObjectId válido', async () => {
    const req = { user: USER, body: { hijoSocioId: VALID_ID, padreUserId: 'no-es-un-id' } };
    const res = mockRes();
    await crearVinculoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(crearVinculoFamiliar).not.toHaveBeenCalled();
  });

  it('crearVinculoHandler: 400 si padreSocioId no es un ObjectId válido', async () => {
    const req = { user: USER, body: { hijoSocioId: VALID_ID, padreSocioId: 'no-es-un-id' } };
    const res = mockRes();
    await crearVinculoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(crearVinculoFamiliar).not.toHaveBeenCalled();
  });

  it('crearVinculoHandler: sigue de largo con ids válidos', async () => {
    crearVinculoFamiliar.mockResolvedValue({
      vinculo: { _id: VALID_ID, toObject: () => ({}) },
      padre: { _id: 'p1', email: 'p@test.com', nombre: 'P' },
      passwordTemporal: null,
    });
    const req = { user: USER, body: { hijoSocioId: VALID_ID, padreUserId: VALID_ID } };
    const res = mockRes();
    await crearVinculoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('anularVinculoHandler: 400 si el id del path no es un ObjectId válido', async () => {
    const req = { user: USER, params: { id: 'no-es-un-id' } };
    const res = mockRes();
    await anularVinculoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(anularVinculoFamiliar).not.toHaveBeenCalled();
  });

  it('anularVinculoHandler: sigue de largo con un id válido', async () => {
    anularVinculoFamiliar.mockResolvedValue({ _id: VALID_ID, toObject: () => ({}) });
    const req = { user: USER, params: { id: VALID_ID } };
    const res = mockRes();
    await anularVinculoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getVinculosHandler: 400 si hijoSocioId de query no es un ObjectId válido', async () => {
    const req = { user: USER, query: { hijoSocioId: 'no-es-un-id' } };
    const res = mockRes();
    await getVinculosHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(VinculoFamiliar.find).not.toHaveBeenCalled();
  });

  it('getVinculosHandler: 400 si padreUserId de query no es un ObjectId válido', async () => {
    const req = { user: USER, query: { padreUserId: 'no-es-un-id' } };
    const res = mockRes();
    await getVinculosHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(VinculoFamiliar.find).not.toHaveBeenCalled();
  });

  it('getVinculosHandler: sigue de largo sin filtros', async () => {
    VinculoFamiliar.find.mockReturnValue({
      sort: () => ({ populate: () => ({ populate: () => Promise.resolve([]) }) }),
    });
    const req = { user: USER, query: {} };
    const res = mockRes();
    await getVinculosHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
