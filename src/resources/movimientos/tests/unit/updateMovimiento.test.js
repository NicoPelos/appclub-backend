import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateMovimientoHandler } from '../../handlers/updateMovimiento.handler.js';
import Movimiento from '../../models/Movimiento.js';
import Evento from '../../../eventos/models/Evento.js';

vi.mock('../../../eventos/models/Evento.js', () => ({
  default: { findOne: vi.fn() },
}));

const EVENTO_ID = '507f1f77bcf86cd799439055';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };

const makeMovimiento = (overrides = {}) => ({
  _id: 'mov1',
  type: 'Ingreso',
  amount: 1000,
  concept: 'Cuota mensual',
  paymentMethod: 'Efectivo',
  description: '',
  date: new Date(),
  active: true,
  sourceType: 'manual',
  mercadopagoVinculos: [],
  updatedBy: '',
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

describe('updateMovimientoHandler', () => {
  beforeEach(() => {
    Evento.findOne.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 404 when movimiento is not found', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(null);
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { amount: 500 }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Movimiento no encontrado' });
  });

  it('should return 400 when type is invalid', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(makeMovimiento());
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { type: 'Otro' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Tipo de movimiento inválido' });
  });

  it('should return 400 when amount is not positive', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(makeMovimiento());
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { amount: 0 }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El importe debe ser un número mayor que cero' });
  });

  it('should return 400 when concept is empty string', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(makeMovimiento());
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { concept: '   ' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El concepto no puede estar vacío' });
  });

  it('should return 400 when paymentMethod is invalid', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(makeMovimiento());
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { paymentMethod: 'Tarjeta' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La forma de pago debe ser Efectivo o Transferencia' });
  });

  it('should return 400 when date is invalid', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(makeMovimiento());
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { date: 'no-es-fecha' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La fecha del movimiento es inválida' });
  });

  it('should return 400 when categoria no corresponde al type efectivo', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(makeMovimiento());
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { categoria: 'Honorarios' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when se cambia el type de un movimiento con categoria sin indicar la nueva', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(makeMovimiento({ categoria: 'Viajes' }));
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { type: 'Egreso' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Al cambiar el tipo de un movimiento con categoría, indicá la nueva categoría' });
  });

  it('should update categoria along with type when both are provided', async () => {
    const mov = makeMovimiento({ categoria: 'Viajes' });
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { type: 'Egreso', categoria: 'Varios' }, user: USER }, res);
    expect(mov.categoria).toBe('Varios');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should update fields and return 200', async () => {
    const mov = makeMovimiento();
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
    const res = mockRes();
    await updateMovimientoHandler(
      { params: { id: 'mov1' }, body: { type: 'Egreso', amount: 500, concept: 'Gasto nuevo' }, user: USER },
      res,
    );
    expect(mov.type).toBe('Egreso');
    expect(mov.amount).toBe(500);
    expect(mov.concept).toBe('Gasto nuevo');
    expect(mov.updatedBy).toBe('admin@carc.test');
    expect(mov.save).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should reject changing amount/type/paymentMethod on a non-manual movimiento (cobro)', async () => {
    const mov = makeMovimiento({ sourceType: 'cobro' });
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { amount: 5000 }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mov.save).not.toHaveBeenCalled();
  });

  it('should still allow editing description/date on a non-manual movimiento (muro_libre)', async () => {
    const mov = makeMovimiento({ sourceType: 'muro_libre' });
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { description: 'nota' }, user: USER }, res);
    expect(mov.description).toBe('nota');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should reject changing type to Egreso when the movimiento has mercadopagoVinculos', async () => {
    const mov = makeMovimiento({ mercadopagoVinculos: [{ paymentId: 'p1', monto: 1000, fecha: new Date(), vinculadoPor: 'admin@carc.test' }] });
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { type: 'Egreso' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Este movimiento tiene pagos de Mercado Pago vinculados — no se puede cambiar el tipo ni pasar a Efectivo. Desvinculá los pagos primero.' });
    expect(mov.save).not.toHaveBeenCalled();
  });

  it('should allow editing description on an Egreso with mercadopagoVinculos', async () => {
    const mov = makeMovimiento({
      type: 'Egreso',
      paymentMethod: 'MercadoPago',
      mercadopagoVinculos: [{ paymentId: 'p1', monto: 1000, fecha: new Date(), vinculadoPor: 'admin@carc.test' }],
    });
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { description: 'nota' }, user: USER }, res);
    expect(mov.description).toBe('nota');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should reject changing paymentMethod to Efectivo when the movimiento has mercadopagoVinculos', async () => {
    const mov = makeMovimiento({
      paymentMethod: 'Transferencia',
      mercadopagoVinculos: [{ paymentId: 'p1', monto: 1000, fecha: new Date(), vinculadoPor: 'admin@carc.test' }],
    });
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { paymentMethod: 'Efectivo' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mov.save).not.toHaveBeenCalled();
  });

  it('should still allow editing description on a movimiento with mercadopagoVinculos when type/paymentMethod stay compatible', async () => {
    const mov = makeMovimiento({
      paymentMethod: 'Transferencia',
      mercadopagoVinculos: [{ paymentId: 'p1', monto: 1000, fecha: new Date(), vinculadoPor: 'admin@carc.test' }],
    });
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: { description: 'nota' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mov.save).toHaveBeenCalled();
  });

  it('should return 500 on unexpected error', async () => {
    vi.spyOn(Movimiento, 'findOne').mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await updateMovimientoHandler({ params: { id: 'mov1' }, body: {}, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  describe('appcarc-backend#180: eventoId', () => {
    it('taguea el evento aunque el movimiento no sea manual (independiente de sourceType)', async () => {
      const mov = makeMovimiento({ sourceType: 'cobro' });
      vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
      Evento.findOne.mockResolvedValue({ _id: EVENTO_ID });

      const res = mockRes();
      await updateMovimientoHandler({ params: { id: 'mov1' }, body: { eventoId: EVENTO_ID }, user: USER }, res);

      expect(String(mov.eventoId)).toBe(EVENTO_ID);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('permite destaguear mandando eventoId: null', async () => {
      const mov = makeMovimiento({ eventoId: EVENTO_ID });
      vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);

      const res = mockRes();
      await updateMovimientoHandler({ params: { id: 'mov1' }, body: { eventoId: null }, user: USER }, res);

      expect(mov.eventoId).toBeNull();
      expect(Evento.findOne).not.toHaveBeenCalled();
    });

    it('retorna 404 si el evento no existe', async () => {
      const mov = makeMovimiento();
      vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);
      Evento.findOne.mockResolvedValue(null);

      const res = mockRes();
      await updateMovimientoHandler({ params: { id: 'mov1' }, body: { eventoId: EVENTO_ID }, user: USER }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('retorna 400 si eventoId no es un ObjectId válido', async () => {
      const mov = makeMovimiento();
      vi.spyOn(Movimiento, 'findOne').mockResolvedValue(mov);

      const res = mockRes();
      await updateMovimientoHandler({ params: { id: 'mov1' }, body: { eventoId: 'invalido' }, user: USER }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
