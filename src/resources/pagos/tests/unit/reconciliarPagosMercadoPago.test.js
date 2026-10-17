import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../models/PagoOnlineIntent.js', () => ({
  default: { find: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('../../services/procesarPagoMercadoPago.service.js', () => ({
  procesarPagoMercadoPago: vi.fn(),
}));

import PagoOnlineIntent from '../../models/PagoOnlineIntent.js';
import { procesarPagoMercadoPago } from '../../services/procesarPagoMercadoPago.service.js';
import { reconciliarPagosMercadoPagoClub } from '../../services/reconciliarPagosMercadoPago.service.js';

const stubSearchFetch = (payments, ok = true) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    json: vi.fn().mockResolvedValue({ results: payments }),
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  PagoOnlineIntent.updateMany.mockResolvedValue({ modifiedCount: 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe('reconciliarPagosMercadoPagoClub', () => {
  it('no hace nada si no hay intents pendientes', async () => {
    PagoOnlineIntent.find.mockResolvedValue([]);

    const result = await reconciliarPagosMercadoPagoClub({ clubId: 'CARC', accessToken: 'token' });

    expect(PagoOnlineIntent.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC', estado: 'pendiente' }));
    expect(procesarPagoMercadoPago).not.toHaveBeenCalled();
    expect(result).toEqual({ revisados: 0, resueltos: 0, errores: 0, expirados: 0 });
  });

  it('busca por external_reference y procesa el pago encontrado', async () => {
    PagoOnlineIntent.find.mockResolvedValue([{ _id: 'intent-1', externalReference: 'ext-1' }]);
    stubSearchFetch([{ id: '555', status: 'approved', external_reference: 'ext-1' }]);
    procesarPagoMercadoPago.mockResolvedValue({ resultado: 'aprobado' });

    const result = await reconciliarPagosMercadoPagoClub({ clubId: 'CARC', accessToken: 'TEST-token' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('external_reference=ext-1'),
      expect.objectContaining({ headers: { Authorization: 'Bearer TEST-token' } }),
    );
    expect(procesarPagoMercadoPago).toHaveBeenCalledWith({
      clubId: 'CARC',
      payment: expect.objectContaining({ id: '555', status: 'approved' }),
      accessToken: 'TEST-token',
    });
    expect(result).toEqual({ revisados: 1, resueltos: 1, errores: 0, expirados: 0 });
  });

  it('si Mercado Pago no devuelve resultados, no llama a procesarPagoMercadoPago', async () => {
    PagoOnlineIntent.find.mockResolvedValue([{ _id: 'intent-1', externalReference: 'ext-1' }]);
    stubSearchFetch([]);

    const result = await reconciliarPagosMercadoPagoClub({ clubId: 'CARC', accessToken: 'token' });

    expect(procesarPagoMercadoPago).not.toHaveBeenCalled();
    expect(result).toEqual({ revisados: 1, resueltos: 0, errores: 0, expirados: 0 });
  });

  it('prefiere el resultado aprobado si hay varios pagos para el mismo external_reference', async () => {
    PagoOnlineIntent.find.mockResolvedValue([{ _id: 'intent-1', externalReference: 'ext-1' }]);
    stubSearchFetch([
      { id: '1', status: 'rejected', external_reference: 'ext-1' },
      { id: '2', status: 'approved', external_reference: 'ext-1' },
    ]);
    procesarPagoMercadoPago.mockResolvedValue({ resultado: 'aprobado' });

    await reconciliarPagosMercadoPagoClub({ clubId: 'CARC', accessToken: 'token' });

    expect(procesarPagoMercadoPago).toHaveBeenCalledWith({
      clubId: 'CARC',
      payment: expect.objectContaining({ id: '2', status: 'approved' }),
      accessToken: 'token',
    });
  });

  it('no cuenta como resuelto un intent que sigue pendiente o duplicado', async () => {
    PagoOnlineIntent.find.mockResolvedValue([{ _id: 'intent-1', externalReference: 'ext-1' }]);
    stubSearchFetch([{ id: '1', status: 'in_process', external_reference: 'ext-1' }]);
    procesarPagoMercadoPago.mockResolvedValue({ resultado: 'pendiente' });

    const result = await reconciliarPagosMercadoPagoClub({ clubId: 'CARC', accessToken: 'token' });

    expect(result).toEqual({ revisados: 1, resueltos: 0, errores: 0, expirados: 0 });
  });

  it('appcarc-backend#259: si un intent falla, sigue procesando el resto del lote en vez de abortar', async () => {
    PagoOnlineIntent.find.mockResolvedValue([
      { _id: 'intent-1', externalReference: 'ext-1' },
      { _id: 'intent-2', externalReference: 'ext-2' },
    ]);
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('timeout de red'))
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ results: [{ id: '2', status: 'approved', external_reference: 'ext-2' }] }) }));
    procesarPagoMercadoPago.mockResolvedValue({ resultado: 'aprobado' });

    const result = await reconciliarPagosMercadoPagoClub({ clubId: 'CARC', accessToken: 'token' });

    // El primer intent explota buscando el pago, pero el segundo se procesa igual.
    expect(procesarPagoMercadoPago).toHaveBeenCalledTimes(1);
    expect(procesarPagoMercadoPago).toHaveBeenCalledWith(expect.objectContaining({
      payment: expect.objectContaining({ id: '2' }),
    }));
    expect(result).toEqual({ revisados: 2, resueltos: 1, errores: 1, expirados: 0 });
  });

  it('appcarc-backend#259: loguea el status cuando la búsqueda en Mercado Pago responde no-ok', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    PagoOnlineIntent.find.mockResolvedValue([{ _id: 'intent-1', externalReference: 'ext-1' }]);
    stubSearchFetch([], false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    const result = await reconciliarPagosMercadoPagoClub({ clubId: 'CARC', accessToken: 'token' });

    expect(result).toEqual({ revisados: 1, resueltos: 0, errores: 0, expirados: 0 });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('429'));
    consoleSpy.mockRestore();
  });

  it('appcarc-backend#260: marca como expirados los intents pendientes más viejos que la ventana de revisión', async () => {
    PagoOnlineIntent.find.mockResolvedValue([]);
    PagoOnlineIntent.updateMany.mockResolvedValue({ modifiedCount: 3 });

    const result = await reconciliarPagosMercadoPagoClub({ clubId: 'CARC', accessToken: 'token' });

    expect(PagoOnlineIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: 'CARC', estado: 'pendiente', createdAt: expect.objectContaining({ $lt: expect.any(Date) }) }),
      { $set: { estado: 'expirado' } },
    );
    expect(result).toEqual({ revisados: 0, resueltos: 0, errores: 0, expirados: 3 });
  });
});
