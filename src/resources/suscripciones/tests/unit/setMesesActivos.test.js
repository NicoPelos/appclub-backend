import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setMesesActivosHandler } from '../../handlers/setMesesActivos.handler.js';

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

vi.mock('../../../cuotas/models/Cuota.js', () => ({
  default: { find: vi.fn() },
}));

vi.mock('../../../socios/models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('../../../planes/models/Plan.js', () => ({
  default: { find: vi.fn() },
}));

vi.mock('../../../escuelita/services/sincronizarSuscripcionPlan.service.js', () => ({
  sincronizarEscuelitaPorSuscripcionModificada: vi.fn(),
}));

import Suscripcion from '../../models/Suscripcion.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import Socio from '../../../socios/models/Socio.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import Plan from '../../../planes/models/Plan.js';
import { sincronizarEscuelitaPorSuscripcionModificada } from '../../../escuelita/services/sincronizarSuscripcionPlan.service.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };
const SOCIO_ID = 'socio123';
const ETIQUETA_ID = 'etiqueta456';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildExistente = (overrides = {}) => ({
  _id: 'sus1',
  fechaDesde: '2026-06',
  fechaHasta: null,
  planId: 'plan1',
  exento: false,
  save: vi.fn().mockResolvedValue(),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  Socio.findOne.mockResolvedValue({ _id: SOCIO_ID, clubId: 'CARC' });
  Etiqueta.findOne.mockResolvedValue({ _id: ETIQUETA_ID, clubId: 'CARC' });
  Cuota.find.mockReturnValue({ select: () => ({ session: () => Promise.resolve([]) }) });
  mockFind.mockReturnValue({ session: () => Promise.resolve([]) });
  mockFindOne.mockReturnValue({ session: () => Promise.resolve(null) });
  Plan.find.mockReturnValue({ session: () => ({ lean: () => Promise.resolve([{ _id: 'plan1', noGeneraDeuda: false }]) }) });
  mockSave.mockResolvedValue();
  sincronizarEscuelitaPorSuscripcionModificada.mockResolvedValue(undefined);
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: vi.fn(async (cb) => cb()),
    endSession: vi.fn(),
  });
});

const req = (body, params = { socioId: SOCIO_ID, etiquetaId: ETIQUETA_ID }) => ({ user: mockUser, params, body });

describe('setMesesActivosHandler', () => {
  it('crea tramos nuevos cuando no había ninguna suscripción (200)', async () => {
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026-04', fechaHasta: null }] }), res);

    expect(Suscripcion).toHaveBeenCalledWith(expect.objectContaining({ fechaDesde: '2026-04', fechaHasta: null }));
    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#62: sincroniza la ficha de escuelita tras reemplazar los tramos', async () => {
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026-04', fechaHasta: null }] }), res);

    expect(sincronizarEscuelitaPorSuscripcionModificada).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', socioId: SOCIO_ID, etiquetaId: ETIQUETA_ID,
    }));
  });

  it('retorna 400 si tramos no es un array', async () => {
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: 'no-array' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si fechaDesde tiene formato inválido', async () => {
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026/04' }] }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si fechaHasta es anterior a fechaDesde', async () => {
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026-06', fechaHasta: '2026-04' }] }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si dos tramos se superponen', async () => {
    const res = mockRes();
    await setMesesActivosHandler(req({
      tramos: [
        { fechaDesde: '2026-01', fechaHasta: '2026-06' },
        { fechaDesde: '2026-05', fechaHasta: null },
      ],
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('superponerse') }));
  });

  it('#195: busca solo socios activos', async () => {
    Socio.findOne.mockResolvedValue(null);
    await setMesesActivosHandler(req({ tramos: [] }), mockRes());

    expect(Socio.findOne).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC', active: true }));
  });

  it('retorna 404 si el socio no existe', async () => {
    Socio.findOne.mockResolvedValue(null);
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: [] }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 404 si la etiqueta no existe', async () => {
    Etiqueta.findOne.mockResolvedValue(null);
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: [] }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('appcarc-backend#207: filtra por active:true al buscar la etiqueta (no opera contra una de baja)', async () => {
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: [] }), res);

    expect(Etiqueta.findOne).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it('retorna 409 si un período ya pagado y cubierto hoy queda sin cobertura', async () => {
    const existente = buildExistente({ fechaDesde: '2026-04', fechaHasta: null });
    mockFind.mockReturnValue({ session: () => Promise.resolve([existente]) });
    Cuota.find.mockReturnValue({ select: () => ({ session: () => Promise.resolve([{ periodo: '2026-05' }]) }) });
    const res = mockRes();
    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026-06', fechaHasta: null }] }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(existente.save).not.toHaveBeenCalled();
  });

  it('no rechaza si el período pagado pertenece a un tramo viejo ya cerrado, fuera del rango vigente', async () => {
    // El tramo activo actual arranca en 2026-06; un pago de 2023 (de un
    // tramo cerrado hace tiempo) no debe bloquear la edición del rango actual.
    const existente = buildExistente({ fechaDesde: '2026-06', fechaHasta: null });
    mockFind.mockReturnValue({ session: () => Promise.resolve([existente]) });
    Cuota.find.mockReturnValue({ select: () => ({ session: () => Promise.resolve([{ periodo: '2023-02' }]) }) });
    const res = mockRes();

    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026-04', fechaHasta: null }] }), res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('no toca un tramo existente que ya coincide exactamente con lo pedido', async () => {
    const existente = buildExistente({ fechaDesde: '2026-04', fechaHasta: null });
    mockFind.mockReturnValue({ session: () => Promise.resolve([existente]) });
    const res = mockRes();

    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026-04', fechaHasta: null }] }), res);

    expect(existente.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('desactiva un tramo que ya no está en la lista pedida', async () => {
    const existente = buildExistente({ fechaDesde: '2026-06', fechaHasta: null });
    mockFind.mockReturnValue({ session: () => Promise.resolve([existente]) });
    const res = mockRes();

    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026-04', fechaHasta: null }] }), res);

    expect(existente.active).toBe(false);
    expect(existente.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('reactiva un tramo soft-deleted en vez de chocar con el índice único', async () => {
    const inactivo = buildExistente({ fechaDesde: '2026-04', fechaHasta: null, active: false });
    mockFind.mockReturnValue({ session: () => Promise.resolve([]) });
    mockFindOne.mockReturnValue({ session: () => Promise.resolve(inactivo) });
    const res = mockRes();

    await setMesesActivosHandler(req({ tramos: [{ fechaDesde: '2026-04', fechaHasta: null }] }), res);

    expect(inactivo.active).toBe(true);
    expect(inactivo.save).toHaveBeenCalled();
    expect(Suscripcion).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('crea un tramo con un plan propio (exento) sin tocar los demás tramos', async () => {
    const existente = buildExistente({ fechaDesde: '2026-01', fechaHasta: null, planId: 'plan1' });
    mockFind.mockReturnValue({ session: () => Promise.resolve([existente]) });
    Plan.find.mockReturnValue({
      session: () => ({ lean: () => Promise.resolve([{ _id: 'plan1', noGeneraDeuda: false }, { _id: 'plan-staff', noGeneraDeuda: true }]) }),
    });
    const res = mockRes();

    await setMesesActivosHandler(req({
      tramos: [
        { fechaDesde: '2026-01', fechaHasta: '2026-03' },
        { fechaDesde: '2026-04', fechaHasta: '2026-06', planId: 'plan-staff' },
        { fechaDesde: '2026-07', fechaHasta: null },
      ],
    }), res);

    expect(Suscripcion).toHaveBeenCalledWith(expect.objectContaining({ fechaDesde: '2026-04', fechaHasta: '2026-06', planId: 'plan-staff', exento: true }));
    expect(Suscripcion).toHaveBeenCalledWith(expect.objectContaining({ fechaDesde: '2026-07', fechaHasta: null, planId: 'plan1', exento: false }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('cierra el tramo existente y crea uno nuevo si solo cambió el plan (mismas fechas)', async () => {
    const existente = buildExistente({ fechaDesde: '2026-04', fechaHasta: '2026-06', planId: 'plan1', exento: false });
    mockFind.mockReturnValue({ session: () => Promise.resolve([existente]) });
    Plan.find.mockReturnValue({
      session: () => ({ lean: () => Promise.resolve([{ _id: 'plan-staff', noGeneraDeuda: true }]) }),
    });
    const res = mockRes();

    await setMesesActivosHandler(req({
      tramos: [{ fechaDesde: '2026-04', fechaHasta: '2026-06', planId: 'plan-staff' }],
    }), res);

    // Mismo patrón que el resto del handler: no muta el tramo viejo in-place,
    // lo cierra y crea uno nuevo — el cambio de plan no es la excepción.
    expect(existente.active).toBe(false);
    expect(existente.save).toHaveBeenCalled();
    expect(Suscripcion).toHaveBeenCalledWith(expect.objectContaining({
      fechaDesde: '2026-04', fechaHasta: '2026-06', planId: 'plan-staff', exento: true,
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 400 si el planId no existe o no pertenece a esta etiqueta', async () => {
    Plan.find.mockReturnValue({ session: () => ({ lean: () => Promise.resolve([]) }) });
    const res = mockRes();

    await setMesesActivosHandler(req({
      tramos: [{ fechaDesde: '2026-04', fechaHasta: null, planId: 'plan-inexistente' }],
    }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('plan-inexistente') }));
  });

  it('retorna 500 si hay un error de base de datos', async () => {
    Socio.findOne.mockRejectedValue(new Error('DB error'));
    const res = mockRes();

    await setMesesActivosHandler(req({ tramos: [] }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
