import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Movimiento from '../../models/Movimiento.js';

vi.mock('../../../audit/services/audit.service.js', () => ({ logAudit: vi.fn() }));
import { logAudit } from '../../../audit/services/audit.service.js';
import { actualizarPayerMercadopagoHandler } from '../../handlers/mercadopagoVinculo.handler.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'tesoreria@carc.test', clubId: 'club1' };

const makeMovimiento = (vinculos) => ({
  _id: 'mov1',
  paymentMethod: 'MercadoPago',
  amount: 52000,
  updatedBy: '',
  mercadopagoVinculos: vinculos,
  save: vi.fn().mockResolvedValue(undefined),
});

const makeReq = ({ id = 'mov1', paymentId = 'mp1', body = { payerName: 'Juan Pérez' } } = {}) => ({
  params: { id, paymentId }, body, user: USER, method: 'PATCH', originalUrl: `/api/movimientos/${id}/mercadopago-vinculo/${paymentId}`,
});

describe('actualizarPayerMercadopagoHandler', () => {
  beforeEach(() => {
    vi.mocked(logAudit).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completa el payerName del vínculo indicado y no toca nada más', async () => {
    const otro = { paymentId: 'mp2', payerName: '', monto: 10000 };
    const vinculo = { paymentId: 'mp1', payerName: '', payerEmail: 'club@test', monto: 52000 };
    const movimiento = makeMovimiento([vinculo, otro]);
    const findOne = vi.spyOn(Movimiento, 'findOne').mockResolvedValue(movimiento);
    const res = mockRes();

    await actualizarPayerMercadopagoHandler(makeReq({ body: { payerName: '  Juan Pérez  ' } }), res);

    expect(findOne).toHaveBeenCalledWith({ _id: 'mov1', clubId: 'club1', active: true });
    expect(vinculo.payerName).toBe('Juan Pérez');
    expect(vinculo.monto).toBe(52000);
    expect(otro.payerName).toBe('');
    expect(movimiento.paymentMethod).toBe('MercadoPago');
    expect(movimiento.amount).toBe(52000);
    expect(movimiento.updatedBy).toBe('tesoreria@carc.test');
    expect(movimiento.save).toHaveBeenCalledOnce();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      resource: 'Movimiento',
      before: { paymentId: 'mp1', payerName: '' },
      after: { paymentId: 'mp1', payerName: 'Juan Pérez' },
    }));
    expect(res.json).toHaveBeenCalledWith(movimiento);
  });

  it('corrige un payerName que ya tenía otro valor', async () => {
    const vinculo = { paymentId: 'mp1', payerName: 'Juan Perez', monto: 52000 };
    const movimiento = makeMovimiento([vinculo]);
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(movimiento);

    await actualizarPayerMercadopagoHandler(makeReq(), mockRes());

    expect(vinculo.payerName).toBe('Juan Pérez');
    expect(movimiento.save).toHaveBeenCalledOnce();
  });

  it('es idempotente: si ya tiene ese nombre no guarda ni audita', async () => {
    const movimiento = makeMovimiento([{ paymentId: 'mp1', payerName: 'Juan Pérez', monto: 52000 }]);
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(movimiento);
    const res = mockRes();

    await actualizarPayerMercadopagoHandler(makeReq(), res);

    expect(movimiento.save).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(movimiento);
  });

  it.each([
    [{}],
    [{ payerName: '' }],
    [{ payerName: '   ' }],
    [{ payerName: 123 }],
  ])('devuelve 400 si payerName falta o no es texto (%o)', async (body) => {
    const findOne = vi.spyOn(Movimiento, 'findOne');
    const res = mockRes();

    await actualizarPayerMercadopagoHandler(makeReq({ body }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('devuelve 400 si payerName es demasiado largo', async () => {
    const res = mockRes();

    await actualizarPayerMercadopagoHandler(makeReq({ body: { payerName: 'x'.repeat(121) } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 404 si el movimiento no existe o es de otro club', async () => {
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(null);
    const res = mockRes();

    await actualizarPayerMercadopagoHandler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('devuelve 404 si el movimiento no tiene ese vínculo', async () => {
    const movimiento = makeMovimiento([{ paymentId: 'mp2', payerName: '', monto: 10000 }]);
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(movimiento);
    const res = mockRes();

    await actualizarPayerMercadopagoHandler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(movimiento.save).not.toHaveBeenCalled();
  });

  it('devuelve 500 si falla el guardado', async () => {
    const movimiento = makeMovimiento([{ paymentId: 'mp1', payerName: '', monto: 52000 }]);
    movimiento.save.mockRejectedValue(new Error('boom'));
    vi.spyOn(Movimiento, 'findOne').mockResolvedValue(movimiento);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();

    await actualizarPayerMercadopagoHandler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
