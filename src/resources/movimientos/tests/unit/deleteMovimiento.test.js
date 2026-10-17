import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { deleteMovimientoHandler } from '../../handlers/deleteMovimiento.handler.js';
import Movimiento from '../../models/Movimiento.js';
import Cobro from '../../../cobros/models/Cobro.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import CargoPuntual from '../../../cargosPuntuales/models/CargoPuntual.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';

vi.mock('../../../eventos/services/anularPagoEventoParticipante.service.js', () => ({
  anularPagoEventoParticipante: vi.fn(),
}));
import { anularPagoEventoParticipante } from '../../../eventos/services/anularPagoEventoParticipante.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };
const COBRO_ID = new mongoose.Types.ObjectId();

const makeMovimiento = (overrides = {}) => ({
  _id: 'mov1',
  active: true,
  updatedBy: '',
  sourceType: 'manual',
  sourceModel: null,
  sourceId: null,
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

describe('deleteMovimientoHandler', () => {
  let sessionMock;

  beforeEach(() => {
    sessionMock = {
      withTransaction: vi.fn(async (callback) => callback()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);
    Cobro.findOne = vi.fn();
    Cuota.updateMany = vi.fn().mockResolvedValue(null);
    CargoPuntual.find = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) });
    Asistencia.updateMany = vi.fn().mockResolvedValue(null);
    Asistencia.findOneAndUpdate = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 404 when movimiento is not found', async () => {
    vi.spyOn(Movimiento, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(null) });
    const res = mockRes();
    await deleteMovimientoHandler({ params: { id: 'mov1' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Movimiento no encontrado' });
  });

  it('should soft delete a manual movimiento without touching cobro/cuota', async () => {
    const mov = makeMovimiento();
    vi.spyOn(Movimiento, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(mov) });
    const res = mockRes();
    await deleteMovimientoHandler({ params: { id: 'mov1' }, user: USER }, res);

    expect(mov.active).toBe(false);
    expect(mov.updatedBy).toBe('admin@carc.test');
    expect(mov.save).toHaveBeenCalledTimes(1);
    expect(Cobro.findOne).not.toHaveBeenCalled();
    expect(Asistencia.findOneAndUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Movimiento eliminado' });
  });

  it('should also anular the cobro, its cuotas, cargos puntuales and asistencias when the movimiento comes from a cobro', async () => {
    const mov = makeMovimiento({ sourceType: 'cobro', sourceModel: 'Cobro', sourceId: COBRO_ID });
    vi.spyOn(Movimiento, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(mov) });

    const cobro = {
      _id: COBRO_ID,
      active: true,
      anuladoAt: null,
      anuladoPor: null,
      motivoAnulacion: null,
      updatedBy: '',
      save: vi.fn().mockResolvedValue(undefined),
    };
    Cobro.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const res = mockRes();
    await deleteMovimientoHandler({ params: { id: 'mov1' }, user: USER }, res);

    expect(cobro.active).toBe(false);
    expect(cobro.anuladoPor).toBe(USER.email);
    expect(cobro.motivoAnulacion).toBe('Anulado al eliminar el movimiento asociado');
    expect(cobro.save).toHaveBeenCalledTimes(1);
    expect(Cuota.updateMany).toHaveBeenCalledWith(
      { cobroId: COBRO_ID, clubId: USER.clubId },
      { estado: 'anulada', updatedBy: USER.email },
      { session: sessionMock },
    );
    expect(CargoPuntual.find).toHaveBeenCalledWith({ clubId: USER.clubId, 'pagos.cobroId': COBRO_ID, active: true });
    expect(Asistencia.updateMany).toHaveBeenCalledWith(
      { cobroId: COBRO_ID, clubId: USER.clubId },
      expect.objectContaining({ estadoPago: 'pendiente', cobroId: null, movimientoId: null }),
      { session: sessionMock },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should also anular the asistencia when the movimiento comes from muro libre', async () => {
    const asistenciaId = new mongoose.Types.ObjectId();
    const mov = makeMovimiento({ sourceType: 'muro_libre', sourceModel: 'Asistencia', sourceId: asistenciaId });
    vi.spyOn(Movimiento, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(mov) });

    const res = mockRes();
    await deleteMovimientoHandler({ params: { id: 'mov1' }, user: USER }, res);

    expect(Asistencia.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: asistenciaId, clubId: USER.clubId, active: true },
      { active: false, updatedBy: USER.email },
      { session: sessionMock },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#153: should also anular the Cuota generated by a paid pase mensual, when deleting the movimiento directly', async () => {
    const asistenciaId = new mongoose.Types.ObjectId();
    const mov = makeMovimiento({ sourceType: 'muro_libre', sourceModel: 'Asistencia', sourceId: asistenciaId });
    vi.spyOn(Movimiento, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(mov) });

    const res = mockRes();
    await deleteMovimientoHandler({ params: { id: 'mov1' }, user: USER }, res);

    expect(Cuota.updateMany).toHaveBeenCalledWith(
      { clubId: USER.clubId, movimientoId: mov._id },
      { estado: 'anulada', updatedBy: USER.email },
      { session: sessionMock },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#175: should also revert the EventoParticipante payment, when deleting the movimiento directly', async () => {
    const participanteId = new mongoose.Types.ObjectId();
    const mov = makeMovimiento({ sourceType: 'evento_participante', sourceModel: 'EventoParticipante', sourceId: participanteId });
    vi.spyOn(Movimiento, 'findOne').mockReturnValue({ session: vi.fn().mockResolvedValue(mov) });
    anularPagoEventoParticipante.mockResolvedValue({ estado: 'pendiente' });

    const res = mockRes();
    await deleteMovimientoHandler({ params: { id: 'mov1' }, user: USER }, res);

    expect(anularPagoEventoParticipante).toHaveBeenCalledWith({
      clubId: USER.clubId, movimientoId: mov._id, actor: USER.email, session: sessionMock,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 500 on unexpected error', async () => {
    vi.spyOn(Movimiento, 'findOne').mockReturnValue({ session: vi.fn().mockRejectedValue(new Error('DB down')) });
    const res = mockRes();
    await deleteMovimientoHandler({ params: { id: 'mov1' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
