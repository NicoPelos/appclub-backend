import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { updateMuroLibreHandler } from '../../handlers/updateMuroLibre.handler.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';
import Cuota from '../../../cuotas/models/Cuota.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'secretaria@carc.test', clubId: 'club1' };

const makeRegistro = (overrides = {}) => ({
  _id: 'reg1',
  active: true,
  updatedBy: '',
  fecha: new Date('2026-08-01T12:00:00Z'),
  monto: 0,
  formaPago: null,
  observaciones: '',
  estadoPago: 'pendiente',
  movimientoId: null,
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

describe('updateMuroLibreHandler', () => {
  let sessionMock;

  beforeEach(() => {
    sessionMock = {
      withTransaction: vi.fn(async (callback) => callback()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);
    Movimiento.findByIdAndUpdate = vi.fn().mockResolvedValue(null);
    Cuota.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  });

  afterEach(() => vi.restoreAllMocks());

  it('devuelve 404 si el registro no existe', async () => {
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(null) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: {}, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('permite pasar un check-in pendiente a exento', async () => {
    const registro = makeRegistro({ estadoPago: 'pendiente' });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { estadoPago: 'exento' }, user: USER }, res);

    expect(registro.estadoPago).toBe('exento');
    expect(registro.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('permite pasar de exento a pendiente también (ida y vuelta)', async () => {
    const registro = makeRegistro({ estadoPago: 'exento' });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { estadoPago: 'pendiente' }, user: USER }, res);

    expect(registro.estadoPago).toBe('pendiente');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rechaza estadoPago inválido', async () => {
    const registro = makeRegistro({ estadoPago: 'pendiente' });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { estadoPago: 'gratis' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(registro.save).not.toHaveBeenCalled();
  });

  it('rechaza cambiar el estado de un check-in ya pagado (no pasa por el flujo de reversión de plata)', async () => {
    const registro = makeRegistro({ estadoPago: 'pagado' });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { estadoPago: 'exento' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(registro.estadoPago).toBe('pagado');
    expect(registro.save).not.toHaveBeenCalled();
  });

  it('rechaza intentar pasar A pagado desde acá', async () => {
    const registro = makeRegistro({ estadoPago: 'pendiente' });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { estadoPago: 'pagado' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(registro.estadoPago).toBe('pendiente');
  });

  it('sigue editando fecha/monto/formaPago/observaciones normalmente cuando no viene estadoPago', async () => {
    const registro = makeRegistro();
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({
      params: { id: 'reg1' },
      body: { fecha: '2026-08-05T12:00:00Z', monto: 5000, formaPago: 'Transferencia', observaciones: 'ok' },
      user: USER,
    }, res);

    expect(registro.monto).toBe(5000);
    expect(registro.formaPago).toBe('Transferencia');
    expect(registro.observaciones).toBe('ok');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#186: al editar monto de un pase con movimientoId, sincroniza la Cuota asociada', async () => {
    const registro = makeRegistro({ movimientoId: 'mov1' });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { monto: 3000 }, user: USER }, res);

    expect(Cuota.updateMany).toHaveBeenCalledWith(
      { clubId: 'club1', movimientoId: 'mov1' },
      { montoPagadoSnapshot: 3000, updatedBy: 'secretaria@carc.test' },
      { session: sessionMock },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#186: al editar formaPago de un pase con movimientoId, sincroniza la Cuota asociada', async () => {
    const registro = makeRegistro({ movimientoId: 'mov1' });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { formaPago: 'Transferencia' }, user: USER }, res);

    expect(Cuota.updateMany).toHaveBeenCalledWith(
      { clubId: 'club1', movimientoId: 'mov1' },
      { paymentMethod: 'Transferencia', updatedBy: 'secretaria@carc.test' },
      { session: sessionMock },
    );
  });

  it('appcarc-backend#186: sin movimientoId (pase diario/exento) no toca Cuota', async () => {
    const registro = makeRegistro({ movimientoId: null });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { monto: 3000, formaPago: 'Efectivo' }, user: USER }, res);

    expect(Cuota.updateMany).not.toHaveBeenCalled();
  });

  it('appcarc-backend#167: rechaza editar la fecha a una futura', async () => {
    const registro = makeRegistro();
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await updateMuroLibreHandler({ params: { id: 'reg1' }, body: { fecha: '2099-01-01T12:00:00.000Z' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La fecha de la asistencia no puede ser futura' });
    expect(registro.save).not.toHaveBeenCalled();
  });
});
