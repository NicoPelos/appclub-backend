import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { createSuscripcionHandler } from '../../handlers/createSuscripcion.handler.js';

const { mockSave, mockFind, mockFindOne } = vi.hoisted(() => ({
  mockSave: vi.fn(),
  mockFind: vi.fn(),
  mockFindOne: vi.fn(),
}));

vi.mock('../../models/Suscripcion.js', () => {
  const SuscripcionMock = vi.fn().mockImplementation((data) => ({ ...data, save: mockSave, toObject: vi.fn().mockReturnValue(data) }));
  SuscripcionMock.find = mockFind;
  SuscripcionMock.findOne = mockFindOne;
  return { default: SuscripcionMock };
});

vi.mock('../../../socios/models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('../../../planes/models/Plan.js', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('../../../escuelita/models/Escuelita.js', () => {
  const EscuelitaMock = vi.fn().mockImplementation((data) => ({ ...data, save: vi.fn().mockResolvedValue(undefined), toObject: vi.fn().mockReturnValue(data) }));
  EscuelitaMock.findOne = vi.fn();
  return { default: EscuelitaMock };
});

import Socio from '../../../socios/models/Socio.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import Plan from '../../../planes/models/Plan.js';
import Escuelita from '../../../escuelita/models/Escuelita.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const validBody = {
  socioId: 'socio123',
  etiquetaId: 'etiqueta456',
  fechaDesde: '2026-01',
};

const PLAN_ID = '507f1f77bcf86cd799439011';
const ETIQUETA_ID = 'etiqueta456';

beforeEach(() => {
  vi.clearAllMocks();
  Socio.findOne.mockResolvedValue({ _id: 'socio123', clubId: 'CARC' });
  Etiqueta.findOne.mockResolvedValue({ _id: ETIQUETA_ID, clubId: 'CARC', nombre: 'Cuota Social', unidad: 'mes' });
  Plan.findOne.mockResolvedValue({ _id: PLAN_ID, etiquetaId: ETIQUETA_ID, tipo: 'social', noGeneraDeuda: false });
  mockSave.mockResolvedValue();
  mockFind.mockReturnValue({ populate: () => ({ session: () => Promise.resolve([]) }) });
  mockFindOne.mockReturnValue({ session: () => Promise.resolve(null) });
  Escuelita.findOne.mockReturnValue({ session: () => Promise.resolve(null) });
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: vi.fn(async (cb) => cb()),
    endSession: vi.fn(),
  });
});

describe('createSuscripcionHandler', () => {
  it('crea suscripción correctamente (201)', async () => {
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 400 si falta socioId', async () => {
    const req = { user: mockUser, body: { ...validBody, socioId: undefined } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('socioId') }));
  });

  it('retorna 400 si falta etiquetaId y planId', async () => {
    const req = { user: mockUser, body: { ...validBody, etiquetaId: undefined } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('etiquetaId') }));
  });

  it('crea suscripción con planId (resuelve etiquetaId del plan)', async () => {
    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-01' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(Plan.findOne).toHaveBeenCalledWith(expect.objectContaining({ _id: PLAN_ID }));
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 404 si planId no existe', async () => {
    Plan.findOne.mockResolvedValue(null);
    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-01' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Plan') }));
  });

  it('retorna 400 si falta fechaDesde', async () => {
    const req = { user: mockUser, body: { ...validBody, fechaDesde: undefined } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('fechaDesde') }));
  });

  it('retorna 400 si fechaDesde tiene formato inválido', async () => {
    const req = { user: mockUser, body: { ...validBody, fechaDesde: '01-2026' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('YYYY-MM') }));
  });

  it('appcarc-backend#206: retorna 400 (no 500) si fechaHasta es anterior a fechaDesde', async () => {
    const req = { user: mockUser, body: { ...validBody, fechaDesde: '2026-06', fechaHasta: '2026-01' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('fechaHasta') }));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('permite fechaHasta igual a fechaDesde', async () => {
    const req = { user: mockUser, body: { ...validBody, fechaDesde: '2026-06', fechaHasta: '2026-06' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('#195: busca solo socios activos (un socio dado de baja/borrado no puede recibir una suscripción)', async () => {
    Socio.findOne.mockResolvedValue(null);
    await createSuscripcionHandler({ user: mockUser, body: validBody }, mockRes());

    expect(Socio.findOne).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC', active: true }));
  });

  it('retorna 404 si el socio no existe', async () => {
    Socio.findOne.mockResolvedValue(null);
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Socio') }));
  });

  it('retorna 404 si la etiqueta no existe', async () => {
    Etiqueta.findOne.mockResolvedValue(null);
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Etiqueta') }));
  });

  it('exento en el body se ignora: no se persiste si el plan no es noGeneraDeuda', async () => {
    const req = { user: mockUser, body: { ...validBody, exento: true } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    const SuscripcionMock = (await import('../../models/Suscripcion.js')).default;
    expect(SuscripcionMock).toHaveBeenCalledWith(expect.objectContaining({ exento: false }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('exento por defecto es false si no se envía', async () => {
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    const SuscripcionMock = (await import('../../models/Suscripcion.js')).default;
    expect(SuscripcionMock).toHaveBeenCalledWith(expect.objectContaining({ exento: false }));
  });

  it('fuerza exento:true si el Plan tiene noGeneraDeuda, aunque el body no lo pida', async () => {
    Plan.findOne.mockResolvedValue({ _id: PLAN_ID, etiquetaId: ETIQUETA_ID, noGeneraDeuda: true });
    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-01' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    const SuscripcionMock = (await import('../../models/Suscripcion.js')).default;
    expect(SuscripcionMock).toHaveBeenCalledWith(expect.objectContaining({ exento: true }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retorna 500 si hay error de base de datos', async () => {
    mockSave.mockRejectedValue(new Error('DB error'));
    const req = { user: mockUser, body: validBody };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('cierra la suscripción activa anterior del mismo tipo de plan antes de crear la nueva', async () => {
    const suscripcionVieja = {
      _id: 'sus-vieja',
      planId: { tipo: 'social' },
      etiquetaId: 'etiqueta-vieja',
      fechaHasta: null,
      save: vi.fn().mockResolvedValue(undefined),
      toObject: vi.fn().mockReturnValue({}),
    };
    mockFind.mockReturnValue({ populate: () => ({ session: () => Promise.resolve([suscripcionVieja]) }) });

    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-03' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(suscripcionVieja.save).toHaveBeenCalled();
    expect(suscripcionVieja.fechaHasta).toBe('2026-02');
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('cierra la suscripción activa anterior a la MISMA etiqueta aunque no tenga planId (appcarc-backend#31)', async () => {
    // Reproduce el caso Carreras: la suscripción vieja se creó por script,
    // sin Plan asociado, y la nueva se asigna con un Plan (planId presente).
    const suscripcionViejaSinPlan = {
      _id: 'sus-vieja-sin-plan',
      planId: null,
      etiquetaId: ETIQUETA_ID,
      fechaHasta: null,
      save: vi.fn().mockResolvedValue(undefined),
      toObject: vi.fn().mockReturnValue({}),
    };
    mockFind.mockReturnValue({ populate: () => ({ session: () => Promise.resolve([suscripcionViejaSinPlan]) }) });

    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-07' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(suscripcionViejaSinPlan.save).toHaveBeenCalled();
    expect(suscripcionViejaSinPlan.fechaHasta).toBe('2026-06');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('no cierra una suscripción activa de otra etiqueta y otro tipo de plan', async () => {
    const suscripcionNoRelacionada = {
      _id: 'sus-otra',
      planId: { tipo: 'escuelita' },
      etiquetaId: 'otra-etiqueta',
      fechaHasta: null,
      save: vi.fn().mockResolvedValue(undefined),
      toObject: vi.fn().mockReturnValue({}),
    };
    mockFind.mockReturnValue({ populate: () => ({ session: () => Promise.resolve([suscripcionNoRelacionada]) }) });

    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-03' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(suscripcionNoRelacionada.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('deriva exento de plan.noGeneraDeuda, ignorando lo que mande el body', async () => {
    Plan.findOne.mockResolvedValue({ _id: PLAN_ID, etiquetaId: ETIQUETA_ID, tipo: 'social', noGeneraDeuda: true });
    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-01', exento: false } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    const created = res.json.mock.calls[0][0];
    expect(created.exento).toBe(true);
  });

  it('no toca la ficha de Escuelita si el plan no es de tipo escuelita', async () => {
    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-01' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(Escuelita.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('crea la ficha de Escuelita si el plan es de escuelita y todavía no estaba inscripta (appcarc-backend#52)', async () => {
    Plan.findOne.mockResolvedValue({ _id: PLAN_ID, etiquetaId: ETIQUETA_ID, tipo: 'escuelita', noGeneraDeuda: false });
    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-01' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(Escuelita).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'socio123', estado: 'activo', planId: PLAN_ID }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('actualiza el planId de la ficha de Escuelita existente si difiere', async () => {
    Plan.findOne.mockResolvedValue({ _id: PLAN_ID, etiquetaId: ETIQUETA_ID, tipo: 'escuelita', noGeneraDeuda: false });
    const fichaExistente = {
      _id: 'escuelita1',
      planId: 'otro-plan-viejo',
      save: vi.fn().mockResolvedValue(undefined),
      toObject: vi.fn().mockReturnValue({}),
    };
    Escuelita.findOne.mockReturnValue({ session: () => Promise.resolve(fichaExistente) });

    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-01' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(fichaExistente.planId).toBe(PLAN_ID);
    expect(fichaExistente.save).toHaveBeenCalled();
    expect(Escuelita).not.toHaveBeenCalled();
  });

  it('no vuelve a guardar la ficha de Escuelita si ya tiene el mismo plan', async () => {
    Plan.findOne.mockResolvedValue({ _id: PLAN_ID, etiquetaId: ETIQUETA_ID, tipo: 'escuelita', noGeneraDeuda: false });
    const fichaExistente = {
      _id: 'escuelita1',
      planId: PLAN_ID,
      save: vi.fn().mockResolvedValue(undefined),
      toObject: vi.fn().mockReturnValue({}),
    };
    Escuelita.findOne.mockReturnValue({ session: () => Promise.resolve(fichaExistente) });

    const req = { user: mockUser, body: { socioId: 'socio123', planId: PLAN_ID, fechaDesde: '2026-01' } };
    const res = mockRes();

    await createSuscripcionHandler(req, res);

    expect(fichaExistente.save).not.toHaveBeenCalled();
  });
});
