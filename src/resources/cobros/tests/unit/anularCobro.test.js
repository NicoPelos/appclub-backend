import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import { anularCobroHandler } from '../../handlers/anularCobro.handler.js';
import Cobro from '../../models/Cobro.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import CargoPuntual from '../../../cargosPuntuales/models/CargoPuntual.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';

const CLUB_ID = 'club1';
const COBRO_ID = '507f1f77bcf86cd799439011';
const MOVIMIENTO_ID = new mongoose.Types.ObjectId();
const USER = { id: '507f1f77bcf86cd799439012', email: 'admin@carc.test', clubId: CLUB_ID };

const buildReq = (overrides = {}) => ({
  params: { id: COBRO_ID },
  body: {},
  user: USER,
  ...overrides,
});

const buildRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildActiveCobro = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(COBRO_ID),
  clubId: CLUB_ID,
  active: true,
  movimientoId: MOVIMIENTO_ID,
  updatedBy: '',
  anuladoAt: null,
  anuladoPor: null,
  motivoAnulacion: null,
  save: vi.fn(async function () { return this; }),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

describe('anularCobro handler (unit)', () => {
  let sessionMock;

  beforeEach(() => {
    sessionMock = {
      withTransaction: vi.fn(async (callback) => callback()),
      endSession: vi.fn(),
    };

    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);
    Cobro.findOne = vi.fn();
    Movimiento.findByIdAndUpdate = vi.fn().mockResolvedValue(null);
    Cuota.updateMany = vi.fn().mockResolvedValue(null);
    CargoPuntual.find = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) });
    Asistencia.updateMany = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 400 when id is not a valid ObjectId', async () => {
    const req = buildReq({ params: { id: 'invalid-id' } });
    const res = buildRes();

    await anularCobroHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'ID de cobro inválido' });
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('should return 404 when cobro does not exist or belongs to another club', async () => {
    Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(null) });

    const req = buildReq();
    const res = buildRes();

    await anularCobroHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cobro no encontrado' });
    expect(Movimiento.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
  });

  it('should return 409 when cobro is already anulado', async () => {
    const cobro = buildActiveCobro({ active: false });
    Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const req = buildReq();
    const res = buildRes();

    await anularCobroHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'El cobro ya está anulado' });
    expect(cobro.save).not.toHaveBeenCalled();
    expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
  });

  it('should anular cobro, movimiento and cuotas in a transaction', async () => {
    const cobro = buildActiveCobro();
    Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const req = buildReq({ body: { motivo: 'Error de carga' } });
    const res = buildRes();

    await anularCobroHandler(req, res);

    expect(sessionMock.withTransaction).toHaveBeenCalledTimes(1);

    expect(cobro.active).toBe(false);
    expect(cobro.anuladoPor).toBe(USER.email);
    expect(cobro.motivoAnulacion).toBe('Error de carga');
    expect(cobro.anuladoAt).toBeInstanceOf(Date);
    expect(cobro.save).toHaveBeenCalledTimes(1);

    expect(Movimiento.findByIdAndUpdate).toHaveBeenCalledWith(
      MOVIMIENTO_ID,
      { active: false, updatedBy: USER.email },
      { session: sessionMock },
    );

    expect(Cuota.updateMany).toHaveBeenCalledWith(
      { cobroId: cobro._id, clubId: CLUB_ID },
      { estado: 'anulada', updatedBy: USER.email },
      { session: sessionMock },
    );

    expect(CargoPuntual.find).toHaveBeenCalledWith({ clubId: CLUB_ID, 'pagos.cobroId': cobro._id, active: true });

    expect(Asistencia.updateMany).toHaveBeenCalledWith(
      { cobroId: cobro._id, clubId: CLUB_ID },
      {
        estadoPago: 'pendiente',
        monto: 0,
        formaPago: 'Sin pago',
        cobroId: null,
        movimientoId: null,
        updatedBy: USER.email,
      },
      { session: sessionMock },
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Cobro anulado correctamente',
    }));
    expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
  });

  it('should anular cobro without motivo when none is provided', async () => {
    const cobro = buildActiveCobro();
    Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const req = buildReq({ body: {} });
    const res = buildRes();

    await anularCobroHandler(req, res);

    expect(cobro.motivoAnulacion).toBeNull();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should skip movimiento update when cobro has no movimientoId', async () => {
    const cobro = buildActiveCobro({ movimientoId: null });
    Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const req = buildReq();
    const res = buildRes();

    await anularCobroHandler(req, res);

    expect(Movimiento.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(Cuota.updateMany).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  describe('appcarc-backend#168: revertir un pago parcial de CargoPuntual', () => {
    const buildCargoConPagos = (pagos) => ({
      _id: 'cargo1',
      estado: 'pagada',
      montoEsperadoSnapshot: 30000,
      montoPagadoSnapshot: pagos.reduce((s, p) => s + p.monto, 0),
      pagos: [...pagos],
      save: vi.fn(async function () { return this; }),
    });

    it('vuelve a pendiente si el pago revertido era el único', async () => {
      const cobro = buildActiveCobro();
      Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

      const cargo = buildCargoConPagos([
        { monto: 30000, fecha: new Date(), paymentMethod: 'Efectivo', cobroId: cobro._id, movimientoId: MOVIMIENTO_ID },
      ]);
      CargoPuntual.find = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([cargo]) });

      await anularCobroHandler(buildReq(), buildRes());

      expect(cargo.estado).toBe('pendiente');
      expect(cargo.montoPagadoSnapshot).toBe(0);
      expect(cargo.pagos).toHaveLength(0);
      expect(cargo.cobroId).toBeNull();
      expect(cargo.save).toHaveBeenCalledTimes(1);
    });

    it('queda parcial (no pendiente) si revertir la seña deja el saldo pagado por otro cobro', async () => {
      const cobro = buildActiveCobro(); // este cobro es la SEÑA que se anula
      Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

      const otroMovimientoId = new mongoose.Types.ObjectId();
      const cargo = buildCargoConPagos([
        { monto: 15000, fecha: new Date('2026-07-01'), paymentMethod: 'Efectivo', cobroId: cobro._id, movimientoId: MOVIMIENTO_ID },
        { monto: 15000, fecha: new Date('2026-07-15'), paymentMethod: 'Transferencia', cobroId: 'cobro-saldo', movimientoId: otroMovimientoId },
      ]);
      CargoPuntual.find = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([cargo]) });

      await anularCobroHandler(buildReq(), buildRes());

      // Quedó solo el pago del saldo — la deuda ya no está completa
      // (montoEsperado 30000, pagado 15000), pero tampoco volvió a
      // "pendiente puro": hay un pago real vigente.
      expect(cargo.estado).toBe('parcial');
      expect(cargo.montoPagadoSnapshot).toBe(15000);
      expect(cargo.pagos).toHaveLength(1);
      expect(cargo.pagos[0].cobroId).toBe('cobro-saldo');
      expect(cargo.cobroId).toBe('cobro-saldo');
    });

    it('no toca cargos cuyo pago pertenece a otro cobro', async () => {
      const cobro = buildActiveCobro();
      Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });
      CargoPuntual.find = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) });

      await anularCobroHandler(buildReq(), buildRes());

      expect(CargoPuntual.find).toHaveBeenCalledWith({ clubId: CLUB_ID, 'pagos.cobroId': cobro._id, active: true });
    });
  });
});
