import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { deleteMuroLibreHandler } from '../../handlers/deleteMuroLibre.handler.js';
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
const MOVIMIENTO_ID = new mongoose.Types.ObjectId();

const makeRegistro = (overrides = {}) => ({
  _id: 'reg1',
  active: true,
  updatedBy: '',
  movimientoId: null,
  tipoPase: 'diario',
  estadoPago: 'pendiente',
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

describe('deleteMuroLibreHandler', () => {
  let sessionMock;

  beforeEach(() => {
    sessionMock = {
      withTransaction: vi.fn(async (callback) => callback()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);
    Movimiento.findByIdAndUpdate = vi.fn().mockResolvedValue(null);
    Cuota.updateMany = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => vi.restoreAllMocks());

  it('devuelve 404 si el registro no existe', async () => {
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(null) });
    const res = mockRes();

    await deleteMuroLibreHandler({ params: { id: 'reg1' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('anula un check-in diario sin tocar Cuota (no tiene ninguna asociada)', async () => {
    const registro = makeRegistro();
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await deleteMuroLibreHandler({ params: { id: 'reg1' }, user: USER }, res);

    expect(registro.active).toBe(false);
    expect(Movimiento.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(Cuota.updateMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#153: al anular un check-in de pase mensual pagado, también anula la Cuota que generó', async () => {
    const registro = makeRegistro({ movimientoId: MOVIMIENTO_ID, tipoPase: 'mensual', estadoPago: 'pagado' });
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(registro) });
    const res = mockRes();

    await deleteMuroLibreHandler({ params: { id: 'reg1' }, user: USER }, res);

    expect(Movimiento.findByIdAndUpdate).toHaveBeenCalledWith(
      MOVIMIENTO_ID,
      { active: false, updatedBy: USER.email },
      { session: sessionMock },
    );
    expect(Cuota.updateMany).toHaveBeenCalledWith(
      { clubId: USER.clubId, movimientoId: MOVIMIENTO_ID },
      { estado: 'anulada', updatedBy: USER.email },
      { session: sessionMock },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('devuelve 500 ante un error inesperado', async () => {
    vi.spyOn(Asistencia, 'findOne').mockReturnValue({ session: vi.fn().mockRejectedValue(new Error('DB down')) });
    const res = mockRes();

    await deleteMuroLibreHandler({ params: { id: 'reg1' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
