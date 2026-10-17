import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { excludePeriodoHandler } from '../../handlers/excludePeriodo.handler.js';

const { mockSave, mockFindOneSuscripcion } = vi.hoisted(() => ({
  mockSave: vi.fn(),
  mockFindOneSuscripcion: vi.fn(),
}));

vi.mock('../../models/Suscripcion.js', () => {
  const SuscripcionMock = vi.fn().mockImplementation((data) => ({
    ...data,
    save: mockSave,
    toObject: vi.fn().mockReturnValue(data),
  }));
  SuscripcionMock.findOne = mockFindOneSuscripcion;
  return { default: SuscripcionMock };
});

vi.mock('../../../cuotas/models/Cuota.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../escuelita/services/sincronizarSuscripcionPlan.service.js', () => ({
  sincronizarEscuelitaPorSuscripcionModificada: vi.fn(),
}));

import Suscripcion from '../../models/Suscripcion.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import { sincronizarEscuelitaPorSuscripcionModificada } from '../../../escuelita/services/sincronizarSuscripcionPlan.service.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildSuscripcion = (overrides = {}) => ({
  _id: 'sus123',
  socioId: 'socio123',
  etiquetaId: 'etiqueta456',
  planId: null,
  exento: false,
  fechaDesde: '2026-06',
  fechaHasta: null,
  active: true,
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

const mockSuscripcionFindOne = (result) => {
  mockFindOneSuscripcion.mockReturnValueOnce({ session: () => Promise.resolve(result) });
};

const mockExistenteFindOne = (result) => {
  mockFindOneSuscripcion.mockReturnValueOnce({ session: () => Promise.resolve(result) });
};

beforeEach(() => {
  vi.clearAllMocks();
  Cuota.findOne = vi.fn().mockReturnValue({ session: () => Promise.resolve(null) });
  mockSave.mockResolvedValue();
  sincronizarEscuelitaPorSuscripcionModificada.mockResolvedValue(undefined);
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: vi.fn(async (cb) => cb()),
    endSession: vi.fn(),
  });
});

describe('excludePeriodoHandler', () => {
  it('retorna 400 si falta periodo', async () => {
    const req = { user: mockUser, params: { id: 'sus123' }, body: {} };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFindOneSuscripcion).not.toHaveBeenCalled();
  });

  it('retorna 400 si el periodo tiene formato inválido', async () => {
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026/07' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 404 si la suscripción no existe', async () => {
    mockSuscripcionFindOne(null);
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-07' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 400 si el período es anterior al inicio de la suscripción', async () => {
    mockSuscripcionFindOne(buildSuscripcion({ fechaDesde: '2026-06' }));
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-05' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si el período es posterior al fin de la suscripción', async () => {
    mockSuscripcionFindOne(buildSuscripcion({ fechaDesde: '2026-06', fechaHasta: '2026-08' }));
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-09' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 409 si el período ya está pagado', async () => {
    mockSuscripcionFindOne(buildSuscripcion({ fechaDesde: '2026-06', fechaHasta: null }));
    Cuota.findOne = vi.fn().mockReturnValue({ session: () => Promise.resolve({ _id: 'cuota1', estado: 'pagada' }) });
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-07' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('caso split: excluye un mes en el medio, cierra el tramo actual y crea uno nuevo', async () => {
    const suscripcion = buildSuscripcion({ fechaDesde: '2026-06', fechaHasta: null });
    mockSuscripcionFindOne(suscripcion);
    mockExistenteFindOne(null);
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-07' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(suscripcion.fechaHasta).toBe('2026-06');
    expect(suscripcion.save).toHaveBeenCalled();
    expect(Suscripcion).toHaveBeenCalledWith(expect.objectContaining({ fechaDesde: '2026-08', fechaHasta: null }));
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('caso split: reactiva una suscripción existente inactiva en vez de crear una nueva', async () => {
    const suscripcion = buildSuscripcion({ fechaDesde: '2026-06', fechaHasta: null });
    const existente = {
      _id: 'sus-vieja-2026-08',
      active: false,
      fechaHasta: null,
      save: vi.fn().mockResolvedValue(undefined),
      toObject: vi.fn().mockReturnValue({}),
    };
    mockSuscripcionFindOne(suscripcion);
    mockExistenteFindOne(existente);
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-07' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(existente.active).toBe(true);
    expect(existente.save).toHaveBeenCalled();
    expect(Suscripcion).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('excluir el primer período mueve fechaDesde al siguiente, sin crear un segundo tramo', async () => {
    const suscripcion = buildSuscripcion({ fechaDesde: '2026-06', fechaHasta: null });
    mockSuscripcionFindOne(suscripcion);
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-06' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(suscripcion.fechaDesde).toBe('2026-07');
    expect(suscripcion.save).toHaveBeenCalledTimes(1);
    expect(Suscripcion).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('excluir el último período mueve fechaHasta al anterior, sin crear un segundo tramo', async () => {
    const suscripcion = buildSuscripcion({ fechaDesde: '2026-06', fechaHasta: '2026-08' });
    mockSuscripcionFindOne(suscripcion);
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-08' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(suscripcion.fechaHasta).toBe('2026-07');
    expect(Suscripcion).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('excluir el único período de una suscripción de un solo mes la desactiva entera', async () => {
    const suscripcion = buildSuscripcion({ fechaDesde: '2026-06', fechaHasta: '2026-06' });
    mockSuscripcionFindOne(suscripcion);
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-06' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(suscripcion.active).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#62: sincroniza la ficha de escuelita tras excluir un período', async () => {
    const suscripcion = buildSuscripcion({ fechaDesde: '2026-06', fechaHasta: '2026-06' });
    mockSuscripcionFindOne(suscripcion);
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-06' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(sincronizarEscuelitaPorSuscripcionModificada).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', socioId: suscripcion.socioId, etiquetaId: suscripcion.etiquetaId,
    }));
  });

  it('retorna 500 si hay error de base de datos', async () => {
    mockFindOneSuscripcion.mockImplementationOnce(() => { throw new Error('DB error'); });
    const req = { user: mockUser, params: { id: 'sus123' }, body: { periodo: '2026-07' } };
    const res = mockRes();

    await excludePeriodoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
