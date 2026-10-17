import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deletePlanHandler } from '../../handlers/deletePlan.handler.js';

vi.mock('../../models/Plan.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../suscripciones/models/Suscripcion.js', () => ({
  default: { countDocuments: vi.fn() },
}));
vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

import Plan from '../../models/Plan.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';

const PLAN_ID = '507f1f77bcf86cd799439011';
const mockUser = { clubId: 'CARC', email: 'admin@test.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const makePlan = () => ({
  _id: PLAN_ID,
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({ _id: PLAN_ID }),
  active: true,
  deletedAt: null,
  deletedBy: null,
  updatedBy: '',
});

beforeEach(() => vi.clearAllMocks());

describe('deletePlanHandler', () => {
  it('elimina (soft delete) un plan sin suscripciones activas', async () => {
    const plan = makePlan();
    Plan.findOne.mockResolvedValue(plan);
    Suscripcion.countDocuments.mockResolvedValue(0);

    const req = { params: { id: PLAN_ID }, user: mockUser };
    const res = mockRes();

    await deletePlanHandler(req, res);

    expect(plan.active).toBe(false);
    expect(plan.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Plan eliminado' });
  });

  it('retorna 409 si hay suscripciones activas', async () => {
    Plan.findOne.mockResolvedValue(makePlan());
    Suscripcion.countDocuments.mockResolvedValue(3);

    const req = { params: { id: PLAN_ID }, user: mockUser };
    const res = mockRes();

    await deletePlanHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('cuenta solo suscripciones del club del usuario (appcarc-backend#268)', async () => {
    Plan.findOne.mockResolvedValue(makePlan());
    Suscripcion.countDocuments.mockResolvedValue(0);

    const req = { params: { id: PLAN_ID }, user: mockUser };
    const res = mockRes();

    await deletePlanHandler(req, res);

    expect(Plan.findOne).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC' }));
    expect(Suscripcion.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC', planId: PLAN_ID }));
  });

  it('retorna 404 si el plan no existe', async () => {
    Plan.findOne.mockResolvedValue(null);

    const req = { params: { id: PLAN_ID }, user: mockUser };
    const res = mockRes();

    await deletePlanHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error', async () => {
    Plan.findOne.mockRejectedValue(new Error('DB'));

    const req = { params: { id: PLAN_ID }, user: mockUser };
    const res = mockRes();

    await deletePlanHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
