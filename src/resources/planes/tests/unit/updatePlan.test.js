import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updatePlanHandler } from '../../handlers/updatePlan.handler.js';

vi.mock('../../models/Plan.js', () => ({
  default: { findOne: vi.fn() },
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

const PLAN_ID = '507f1f77bcf86cd799439011';
const mockUser = { clubId: 'CARC', email: 'admin@test.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const makePlan = (overrides = {}) => ({
  _id: PLAN_ID,
  nombre: 'Socio Activo',
  descripcion: '',
  tipo: 'social',
  modalidad: 'mensual',
  etiquetaId: '507f1f77bcf86cd799439022',
  atributos: {},
  updatedBy: '',
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({ _id: PLAN_ID }),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('updatePlanHandler', () => {
  it('actualiza nombre correctamente', async () => {
    const plan = makePlan();
    Plan.findOne.mockResolvedValue(plan);

    const req = { params: { id: PLAN_ID }, user: mockUser, body: { nombre: 'Nuevo Nombre' } };
    const res = mockRes();

    await updatePlanHandler(req, res);

    expect(plan.nombre).toBe('Nuevo Nombre');
    expect(plan.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('actualiza noGeneraDeuda correctamente', async () => {
    const plan = makePlan({ noGeneraDeuda: false });
    Plan.findOne.mockResolvedValue(plan);

    const req = { params: { id: PLAN_ID }, user: mockUser, body: { noGeneraDeuda: true } };
    const res = mockRes();

    await updatePlanHandler(req, res);

    expect(plan.noGeneraDeuda).toBe(true);
    expect(plan.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si el plan no existe', async () => {
    Plan.findOne.mockResolvedValue(null);

    const req = { params: { id: PLAN_ID }, user: mockUser, body: { nombre: 'X' } };
    const res = mockRes();

    await updatePlanHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si tipo inválido', async () => {
    Plan.findOne.mockResolvedValue(makePlan());

    const req = { params: { id: PLAN_ID }, user: mockUser, body: { tipo: 'invalido' } };
    const res = mockRes();

    await updatePlanHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('valida nueva etiquetaId', async () => {
    const plan = makePlan();
    Plan.findOne.mockResolvedValue(plan);
    Etiqueta.findOne.mockResolvedValue(null);

    const req = { params: { id: PLAN_ID }, user: mockUser, body: { etiquetaId: '507f1f77bcf86cd799439033' } };
    const res = mockRes();

    await updatePlanHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error', async () => {
    Plan.findOne.mockRejectedValue(new Error('DB'));

    const req = { params: { id: PLAN_ID }, user: mockUser, body: {} };
    const res = mockRes();

    await updatePlanHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
