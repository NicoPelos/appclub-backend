import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlanHandler } from '../../handlers/createPlan.handler.js';

vi.mock('../../models/Plan.js', () => ({
  default: vi.fn(),
  TIPOS: ['social', 'escuelita', 'muro_libre', 'plan_deuda'],
  MODALIDADES: ['mensual', 'por_uso'],
}));
vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import Plan from '../../models/Plan.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';

const ETIQUETA_ID = '507f1f77bcf86cd799439011';
const mockUser = { clubId: 'CARC', email: 'admin@test.com', id: 'uid1' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const BASE_BODY = {
  nombre: 'Socio Activo',
  tipo: 'social',
  modalidad: 'mensual',
  etiquetaId: ETIQUETA_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  Etiqueta.findOne.mockResolvedValue({ _id: ETIQUETA_ID });
  const saveMock = vi.fn().mockResolvedValue(undefined);
  const toObjectMock = vi.fn().mockReturnValue({ ...BASE_BODY, _id: 'plan1' });
  Plan.mockImplementation(() => ({ save: saveMock, toObject: toObjectMock, _id: 'plan1' }));
});

describe('createPlanHandler', () => {
  it('crea un plan correctamente', async () => {
    const req = { user: mockUser, body: BASE_BODY };
    const res = mockRes();

    await createPlanHandler(req, res);

    expect(Plan).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC',
      nombre: 'Socio Activo',
      tipo: 'social',
      modalidad: 'mensual',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('crea un plan con noGeneraDeuda:true cuando se envía', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, noGeneraDeuda: true } };
    const res = mockRes();

    await createPlanHandler(req, res);

    expect(Plan).toHaveBeenCalledWith(expect.objectContaining({ noGeneraDeuda: true }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('noGeneraDeuda por defecto es false si no se envía', async () => {
    const req = { user: mockUser, body: BASE_BODY };
    const res = mockRes();

    await createPlanHandler(req, res);

    expect(Plan).toHaveBeenCalledWith(expect.objectContaining({ noGeneraDeuda: false }));
  });

  it('retorna 400 si falta nombre', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, nombre: '' } };
    const res = mockRes();
    await createPlanHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si tipo inválido', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, tipo: 'invalido' } };
    const res = mockRes();
    await createPlanHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si modalidad inválida', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, modalidad: 'invalida' } };
    const res = mockRes();
    await createPlanHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si falta etiquetaId', async () => {
    const req = { user: mockUser, body: { ...BASE_BODY, etiquetaId: undefined } };
    const res = mockRes();
    await createPlanHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 404 si la etiqueta no existe', async () => {
    Etiqueta.findOne.mockResolvedValue(null);
    const req = { user: mockUser, body: BASE_BODY };
    const res = mockRes();
    await createPlanHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 409 si nombre duplicado', async () => {
    const saveMock = vi.fn().mockRejectedValue({ code: 11000 });
    Plan.mockImplementation(() => ({ save: saveMock, toObject: vi.fn() }));

    const req = { user: mockUser, body: BASE_BODY };
    const res = mockRes();
    await createPlanHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('retorna 500 si hay error inesperado', async () => {
    const saveMock = vi.fn().mockRejectedValue(new Error('DB error'));
    Plan.mockImplementation(() => ({ save: saveMock, toObject: vi.fn() }));

    const req = { user: mockUser, body: BASE_BODY };
    const res = mockRes();
    await createPlanHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
