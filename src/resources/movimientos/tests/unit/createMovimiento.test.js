import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMovimientoHandler } from '../../handlers/createMovimiento.handler.js';
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

const BASE_BODY = {
  type: 'Ingreso',
  amount: 1000,
  concept: 'Cuota mensual',
  categoria: 'Otros',
  responsable: 'Secretaría',
  paymentMethod: 'Efectivo',
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };

describe('createMovimientoHandler', () => {
  beforeEach(() => {
    vi.spyOn(Movimiento.prototype, 'save').mockResolvedValue(undefined);
    Evento.findOne.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 400 when type is invalid', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, type: 'Otro' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Tipo de movimiento inválido' });
  });

  it('should return 400 when amount is not a positive number', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, amount: -50 }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El importe debe ser un número mayor que cero' });
  });

  it('should return 400 when amount is a string', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, amount: '1000' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when concept is missing', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, concept: '' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El concepto es obligatorio' });
  });

  it('should return 400 when categoria is missing', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, categoria: undefined }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La categoría debe ser una de: Viajes, Ventas / Reventa, Subsidios / Donaciones, Otros' });
  });

  it('should return 400 when categoria no corresponde al type (Honorarios es de Egreso, no de Ingreso)', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, type: 'Ingreso', categoria: 'Honorarios' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should accept a valid Egreso categoria', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, type: 'Egreso', categoria: 'Honorarios' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 400 when responsable is missing', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, responsable: '' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El responsable es obligatorio' });
  });

  it('should return 400 when concept is only whitespace', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, concept: '   ' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El concepto es obligatorio' });
  });

  it('should return 400 when responsable is only whitespace', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, responsable: '   ' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El responsable es obligatorio' });
  });

  it('should trim concept and responsable before saving', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, concept: '  Cuota mensual  ', responsable: '  Secretaría  ' }, user: USER }, res);
    const created = res.json.mock.calls[0][0];
    expect(created.concept).toBe('Cuota mensual');
    expect(created.responsable).toBe('Secretaría');
  });

  it('should return 400 when paymentMethod is invalid', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, paymentMethod: 'Tarjeta' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La forma de pago debe ser Efectivo o Transferencia' });
  });

  it('should return 400 when date is invalid', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: { ...BASE_BODY, date: 'no-es-fecha' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La fecha del movimiento es inválida' });
  });

  it('should create movimiento and return 201', async () => {
    const res = mockRes();
    await createMovimientoHandler({ body: BASE_BODY, user: USER }, res);

    expect(Movimiento.prototype.save).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    const created = res.json.mock.calls[0][0];
    expect(created).toMatchObject({
      type: 'Ingreso',
      amount: 1000,
      concept: 'Cuota mensual',
      paymentMethod: 'Efectivo',
      clubId: 'club1',
    });
  });

  it('should return 500 on unexpected error', async () => {
    Movimiento.prototype.save.mockRejectedValueOnce(new Error('DB down'));
    const res = mockRes();
    await createMovimientoHandler({ body: BASE_BODY, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  describe('appcarc-backend#180: eventoId opcional', () => {
    it('acepta un eventoId válido y lo taguea', async () => {
      Evento.findOne.mockResolvedValue({ _id: EVENTO_ID });
      const res = mockRes();
      await createMovimientoHandler({ body: { ...BASE_BODY, eventoId: EVENTO_ID }, user: USER }, res);

      expect(Evento.findOne).toHaveBeenCalledWith({ _id: EVENTO_ID, clubId: 'club1', active: true });
      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0];
      expect(String(created.eventoId)).toBe(EVENTO_ID);
    });

    it('sin eventoId, queda null (no rompe el caso normal)', async () => {
      const res = mockRes();
      await createMovimientoHandler({ body: BASE_BODY, user: USER }, res);
      const created = res.json.mock.calls[0][0];
      expect(created.eventoId).toBeNull();
    });

    it('retorna 404 si el evento no existe o es de otro club', async () => {
      Evento.findOne.mockResolvedValue(null);
      const res = mockRes();
      await createMovimientoHandler({ body: { ...BASE_BODY, eventoId: EVENTO_ID }, user: USER }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('retorna 400 si eventoId no es un ObjectId válido', async () => {
      const res = mockRes();
      await createMovimientoHandler({ body: { ...BASE_BODY, eventoId: 'invalido' }, user: USER }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
