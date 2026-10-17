import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../models/PagoOnlineIntent.js', () => ({
  default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));
vi.mock('../../../cobros/services/registrarCobro.service.js', () => ({
  registrarCobro: vi.fn(),
}));
vi.mock('../../../eventos/services/registrarPagoEventoParticipante.service.js', () => ({
  registrarPagoEventoParticipante: vi.fn(),
}));

import PagoOnlineIntent from '../../models/PagoOnlineIntent.js';
import { registrarCobro } from '../../../cobros/services/registrarCobro.service.js';
import { registrarPagoEventoParticipante } from '../../../eventos/services/registrarPagoEventoParticipante.service.js';
import { obtenerPagoMercadoPago, procesarPagoMercadoPago } from '../../services/procesarPagoMercadoPago.service.js';

const buildIntent = (overrides = {}) => ({
  _id: 'intent-1',
  clubId: 'CARC',
  requestedByUserId: 'user-1',
  requestedByEmail: 'socio@carc.test',
  items: [{ socioId: 'socio-1', suscripcionId: 'sus-1', periodos: ['2026-06'], amount: 15000 }],
  totalAmount: 15000,
  externalReference: 'ext-ref-1',
  preferenceId: 'pref-1',
  estado: 'pendiente',
  save: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

// La mayoría de los casos de "pago aprobado" disparan además el PUT que
// expira la preferencia — se stubea un default OK acá para no repetirlo en
// cada test; los que necesitan inspeccionar esa llamada la pisan puntualmente.
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => vi.unstubAllGlobals());

describe('obtenerPagoMercadoPago', () => {
  it('devuelve ok:false con el status si la API de Mercado Pago falla', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await obtenerPagoMercadoPago({ accessToken: 'token', dataId: '1' });

    expect(result).toEqual({ ok: false, status: 404 });
  });

  it('devuelve el payment cuando la API responde bien', async () => {
    const payment = { id: '1', status: 'approved' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(payment) }));

    const result = await obtenerPagoMercadoPago({ accessToken: 'token', dataId: '1' });

    expect(result).toEqual({ ok: true, payment });
  });
});

describe('procesarPagoMercadoPago', () => {
  it('ignora un pago sin external_reference', async () => {
    const result = await procesarPagoMercadoPago({ clubId: 'CARC', payment: { id: '1', status: 'approved' } });

    expect(result).toEqual({ resultado: 'ignorado', motivo: 'sin_external_reference' });
    expect(PagoOnlineIntent.findOne).not.toHaveBeenCalled();
  });

  it('ignora un pago cuyo external_reference no matchea ningún intent', async () => {
    PagoOnlineIntent.findOne.mockResolvedValue(null);

    const result = await procesarPagoMercadoPago({
      clubId: 'CARC',
      payment: { id: '1', status: 'approved', external_reference: 'no-existe', transaction_amount: 100 },
    });

    expect(result).toEqual({ resultado: 'ignorado', motivo: 'intent_no_encontrado' });
  });

  it('pago aprobado: transiciona el intent, llama registrarCobro y expira la preferencia', async () => {
    const intent = buildIntent();
    const movimiento = { mercadopagoVinculos: [], save: vi.fn().mockResolvedValue(undefined) };
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
    registrarCobro.mockResolvedValue({ cobro: { _id: 'cobro-1' }, movimiento });

    const result = await procesarPagoMercadoPago({
      clubId: 'CARC',
      accessToken: 'TEST-token',
      payment: {
        id: '999',
        status: 'approved',
        status_detail: 'accredited',
        transaction_amount: 15000,
        external_reference: 'ext-ref-1',
        date_approved: '2026-09-03T12:00:00.000Z',
        payer: { email: 'pagador@test.com' },
      },
    });

    expect(registrarCobro).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC',
      user: { id: 'user-1', email: 'socio@carc.test' },
      body: expect.objectContaining({ paymentMethod: 'MercadoPago' }),
    }));
    expect(result.resultado).toBe('aprobado');
    // El movimiento del cobro se autovincula al pago real de MP — no debe
    // quedar pendiente de vinculación manual en Reconciliación.
    expect(movimiento.mercadopagoVinculos).toEqual([
      expect.objectContaining({
        paymentId: '999',
        payerEmail: 'pagador@test.com',
        monto: 15000,
        fecha: '2026-09-03T12:00:00.000Z',
        vinculadoPor: 'Sistema (pago online)',
      }),
    ]);
    expect(movimiento.save).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.mercadopago.com/checkout/preferences/pref-1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer TEST-token' }),
      }),
    );
    const [, options] = global.fetch.mock.calls.find(([url]) => url.includes('/checkout/preferences/'));
    expect(JSON.parse(options.body)).toEqual(expect.objectContaining({ expires: true }));
  });

  it('appcarc-backend#155 (parte 2): reenvía asistenciaIds a registrarCobro, para marcar exactamente las visitas que el socio eligió', async () => {
    const intent = buildIntent({
      items: [{ socioId: 'socio-1', muroLibrePendiente: true, asistenciaIds: ['asist-1', 'asist-2'], amount: 4000 }],
      totalAmount: 8000,
    });
    const movimiento = { mercadopagoVinculos: [], save: vi.fn().mockResolvedValue(undefined) };
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
    registrarCobro.mockResolvedValue({ cobro: { _id: 'cobro-1' }, movimiento });

    await procesarPagoMercadoPago({
      clubId: 'CARC',
      accessToken: 'TEST-token',
      payment: { id: '999', status: 'approved', transaction_amount: 8000, external_reference: 'ext-ref-1' },
    });

    expect(registrarCobro).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        items: [expect.objectContaining({ muroLibrePendiente: true, asistenciaIds: ['asist-1', 'asist-2'] })],
      }),
    }));
  });

  it('pago rechazado: no intenta expirar la preferencia', async () => {
    const intent = buildIntent();
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'rechazado' });

    await procesarPagoMercadoPago({
      clubId: 'CARC',
      accessToken: 'TEST-token',
      payment: { id: '999', status: 'rejected', external_reference: 'ext-ref-1' },
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('si falla la expiración de la preferencia, el cobro se registra igual', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const intent = buildIntent();
    const movimiento = { mercadopagoVinculos: [], save: vi.fn().mockResolvedValue(undefined) };
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
    registrarCobro.mockResolvedValue({ cobro: { _id: 'cobro-1' }, movimiento });

    const result = await procesarPagoMercadoPago({
      clubId: 'CARC',
      accessToken: 'TEST-token',
      payment: { id: '999', status: 'approved', transaction_amount: 15000, external_reference: 'ext-ref-1' },
    });

    expect(result.resultado).toBe('aprobado');
    expect(registrarCobro).toHaveBeenCalled();
  });

  it('reintento duplicado (intent ya no pendiente): no reprocesa', async () => {
    const intent = buildIntent();
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue(null);

    const result = await procesarPagoMercadoPago({
      clubId: 'CARC',
      payment: { id: '999', status: 'approved', transaction_amount: 15000, external_reference: 'ext-ref-1' },
    });

    expect(registrarCobro).not.toHaveBeenCalled();
    expect(result.resultado).toBe('duplicado');
  });

  it('monto no coincide: marca rechazado y no llama registrarCobro', async () => {
    const intent = buildIntent({ totalAmount: 15000 });
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'rechazado' });

    const result = await procesarPagoMercadoPago({
      clubId: 'CARC',
      payment: { id: '999', status: 'approved', transaction_amount: 999, external_reference: 'ext-ref-1' },
    });

    expect(registrarCobro).not.toHaveBeenCalled();
    expect(result.resultado).toBe('rechazado');
    expect(PagoOnlineIntent.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: intent._id, estado: { $in: ['pendiente', 'rechazado'] } }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: 'rechazado' }) }),
    );
  });

  it('appcarc-backend#257: un pago aprobado llega después de que el mismo intent ya quedó rechazado (reintento de Checkout Pro) y sí se procesa', async () => {
    const intent = buildIntent({ estado: 'rechazado' });
    const movimiento = { mercadopagoVinculos: [], save: vi.fn().mockResolvedValue(undefined) };
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
    registrarCobro.mockResolvedValue({ cobro: { _id: 'cobro-1' }, movimiento });

    const result = await procesarPagoMercadoPago({
      clubId: 'CARC',
      accessToken: 'TEST-token',
      payment: { id: '999', status: 'approved', transaction_amount: 15000, external_reference: 'ext-ref-1' },
    });

    expect(result.resultado).toBe('aprobado');
    expect(registrarCobro).toHaveBeenCalled();
    expect(PagoOnlineIntent.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: intent._id, estado: { $in: ['pendiente', 'rechazado'] } }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: 'aprobado' }) }),
      expect.anything(),
    );
  });

  it('si registrarCobro falla (conflicto de negocio), igual deja el intent aprobado sin cobroId', async () => {
    const intent = buildIntent();
    const updatedIntent = buildIntent({ estado: 'aprobado' });
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue(updatedIntent);
    registrarCobro.mockRejectedValue(new Error('La cuota ya está pagada'));

    const result = await procesarPagoMercadoPago({
      clubId: 'CARC',
      payment: { id: '999', status: 'approved', transaction_amount: 15000, external_reference: 'ext-ref-1' },
    });

    expect(result.resultado).toBe('error_registrar_cobro');
    expect(updatedIntent.save).not.toHaveBeenCalled();
  });

  describe('autoservicio de pago de eventos', () => {
    it('un intent con solo un item de evento llama registrarPagoEventoParticipante, no registrarCobro', async () => {
      const intent = buildIntent({
        items: [{ socioId: 'socio-1', eventoId: 'evento-1', eventoParticipanteId: 'participante-1', amount: 20000 }],
        totalAmount: 20000,
      });
      const movimiento = { mercadopagoVinculos: [], save: vi.fn().mockResolvedValue(undefined) };
      PagoOnlineIntent.findOne.mockResolvedValue(intent);
      PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
      registrarPagoEventoParticipante.mockResolvedValue({ participante: {}, movimiento });

      const result = await procesarPagoMercadoPago({
        clubId: 'CARC',
        accessToken: 'TEST-token',
        payment: { id: '999', status: 'approved', transaction_amount: 20000, external_reference: 'ext-ref-1', payer: { email: 'pagador@test.com' } },
      });

      expect(registrarCobro).not.toHaveBeenCalled();
      expect(registrarPagoEventoParticipante).toHaveBeenCalledWith(expect.objectContaining({
        clubId: 'CARC', eventoId: 'evento-1', participanteId: 'participante-1', monto: 20000,
        paymentMethod: 'MercadoPago', esPagoParcial: false,
      }));
      expect(result.resultado).toBe('aprobado');
      expect(movimiento.mercadopagoVinculos).toEqual([
        expect.objectContaining({ paymentId: '999', payerEmail: 'pagador@test.com', monto: 20000 }),
      ]);
      expect(movimiento.save).toHaveBeenCalled();
    });

    it('un intent que combina una cuota y un evento llama a ambos y vincula los dos movimientos', async () => {
      const intent = buildIntent({
        items: [
          { socioId: 'socio-1', suscripcionId: 'sus-1', periodos: ['2026-06'], amount: 7500 },
          { socioId: 'socio-1', eventoId: 'evento-1', eventoParticipanteId: 'participante-1', amount: 20000 },
        ],
        totalAmount: 27500,
      });
      const movimientoCobro = { mercadopagoVinculos: [], save: vi.fn().mockResolvedValue(undefined) };
      const movimientoEvento = { mercadopagoVinculos: [], save: vi.fn().mockResolvedValue(undefined) };
      PagoOnlineIntent.findOne.mockResolvedValue(intent);
      PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
      registrarCobro.mockResolvedValue({ cobro: { _id: 'cobro-1' }, movimiento: movimientoCobro });
      registrarPagoEventoParticipante.mockResolvedValue({ participante: {}, movimiento: movimientoEvento });

      await procesarPagoMercadoPago({
        clubId: 'CARC',
        accessToken: 'TEST-token',
        payment: { id: '999', status: 'approved', transaction_amount: 27500, external_reference: 'ext-ref-1' },
      });

      // registrarCobro solo recibe el item de la cuota, nunca el de evento
      // (no entiende eventoParticipanteId).
      expect(registrarCobro).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({ items: [expect.objectContaining({ suscripcionId: 'sus-1' })] }),
      }));
      expect(registrarCobro.mock.calls[0][0].body.items).toHaveLength(1);
      expect(registrarPagoEventoParticipante).toHaveBeenCalledTimes(1);
      // "1 pago = varios movimientos": mismo monto TOTAL (27500, no 7500 ni
      // 20000) vinculado en cada uno de los dos movimientos resultantes —
      // así lo espera conciliacionMercadopago.handler.js.
      expect(movimientoCobro.mercadopagoVinculos[0]).toMatchObject({ monto: 27500 });
      expect(movimientoEvento.mercadopagoVinculos[0]).toMatchObject({ monto: 27500 });
    });

    it('si registrarPagoEventoParticipante falla, devuelve error_registrar_cobro', async () => {
      const intent = buildIntent({
        items: [{ socioId: 'socio-1', eventoId: 'evento-1', eventoParticipanteId: 'participante-1', amount: 20000 }],
        totalAmount: 20000,
      });
      PagoOnlineIntent.findOne.mockResolvedValue(intent);
      PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
      registrarPagoEventoParticipante.mockRejectedValue(new Error('El evento está cerrado'));

      const result = await procesarPagoMercadoPago({
        clubId: 'CARC',
        payment: { id: '999', status: 'approved', transaction_amount: 20000, external_reference: 'ext-ref-1' },
      });

      expect(result.resultado).toBe('error_registrar_cobro');
    });
  });
});
