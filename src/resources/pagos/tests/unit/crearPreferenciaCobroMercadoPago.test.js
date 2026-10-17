import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockIntentSave } = vi.hoisted(() => ({ mockIntentSave: vi.fn() }));

vi.mock('../../../socios/models/Socio.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../models/MercadoPagoConfig.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../models/PagoOnlineIntent.js', () => {
  const PagoOnlineIntentMock = vi.fn().mockImplementation((data) => ({ ...data, save: mockIntentSave }));
  return { default: PagoOnlineIntentMock };
});

import Socio from '../../../socios/models/Socio.js';
import MercadoPagoConfig from '../../models/MercadoPagoConfig.js';
import PagoOnlineIntent from '../../models/PagoOnlineIntent.js';
import { crearPreferenciaCobroMercadoPago, BusinessError } from '../../services/crearPreferenciaCobroMercadoPago.service.js';

const CLUB_ID = 'CARC';
const SOCIO_ID = 'socio-1';
const SUSCRIPCION_ID = 'sus-1';

// "amount" en un item de suscripción ya es el TOTAL de ese item (mismo
// contrato que registrarCobro.service.js, que comparte estos mismos items
// armados en RegistrarCobroScreen) — acá 2 períodos por $3750 c/u = $7500
// en total, NO $7500 por período.
const baseArgs = () => ({
  clubId: CLUB_ID,
  requestedByUserId: 'user-1',
  requestedByEmail: 'secretaria@carc.test',
  socioId: SOCIO_ID,
  description: 'Cuota social',
  items: [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07', '2026-08'], amount: 7500 }],
});

const stubMpFetch = (body, ok = true, status = 200) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  MercadoPagoConfig.findOne = vi.fn().mockResolvedValue({ clubId: CLUB_ID, accessToken: 'TEST-token', active: true });
  Socio.find = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', correoElectronico: 'ana@test.com' }]) });
  mockIntentSave.mockResolvedValue(undefined);
  stubMpFetch({ id: 'pref-1', init_point: 'https://mp.test/checkout/pref-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('crearPreferenciaCobroMercadoPago', () => {
  it('genera la preferencia correctamente', async () => {
    const result = await crearPreferenciaCobroMercadoPago(baseArgs());

    expect(result).toEqual({ initPoint: 'https://mp.test/checkout/pref-1', preferenceId: 'pref-1', intentId: expect.any(String) });
    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({
      clubId: CLUB_ID,
      socioId: SOCIO_ID,
      totalAmount: 7500,
      preferenceId: 'pref-1',
    }));
    expect(mockIntentSave).toHaveBeenCalled();
  });

  it('BUG appcarc-backend#152: NO multiplica el amount de una suscripción por la cantidad de períodos — ya es el total', async () => {
    const args = baseArgs();
    // Caso real reportado: 8 cuotas de $6000 = $48.000 en total, mandado
    // como amount=48000 (mismo formato que RegistrarCobroScreen). Antes del
    // fix esto generaba una preferencia de $384.000 (48000 × 8).
    args.items = [{
      socioId: SOCIO_ID,
      suscripcionId: SUSCRIPCION_ID,
      periodos: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
      amount: 48000,
    }];

    await crearPreferenciaCobroMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 48000 }));
  });

  it('muro libre: sí multiplica el amount (importe por visita) por la cantidad real de visitas (asistenciaIds)', async () => {
    const args = baseArgs();
    args.items = [{
      socioId: SOCIO_ID,
      muroLibrePendiente: true,
      asistenciaIds: ['asist-1', 'asist-2', 'asist-3'],
      amount: 4000, // por visita
    }];

    await crearPreferenciaCobroMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 12000 }));
  });

  it('appcarc-backend#155 (parte 2): persiste asistenciaIds en el intent, para poder marcar las visitas exactas al confirmar el pago', async () => {
    const args = baseArgs();
    args.items = [{
      socioId: SOCIO_ID,
      muroLibrePendiente: true,
      asistenciaIds: ['asist-1', 'asist-2', 'asist-3'],
      amount: 4000,
    }];

    await crearPreferenciaCobroMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ asistenciaIds: ['asist-1', 'asist-2', 'asist-3'] })],
    }));
  });

  it('excluye tarjeta/efectivo/cajero de la preferencia — solo deja transferencia y saldo en cuenta', async () => {
    await crearPreferenciaCobroMercadoPago(baseArgs());

    const [, fetchOptions] = fetch.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body.payment_methods.excluded_payment_types).toEqual(expect.arrayContaining([
      { id: 'credit_card' },
      { id: 'debit_card' },
      { id: 'prepaid_card' },
      { id: 'ticket' },
      { id: 'atm' },
    ]));
  });

  it('suma el monto de varios items para el total, multiplicando por períodos/cantidad', async () => {
    const args = baseArgs();
    args.items = [
      { socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07'], amount: 7500 }, // 1 período × 7500 = 7500
      { socioId: SOCIO_ID, cargoPuntualId: 'cargo-1', amount: 3000 }, // 3000
      { socioId: SOCIO_ID, muroLibrePendiente: true, cantidad: 2, amount: 4000 }, // 2 visitas × 4000 = 8000
    ];

    await crearPreferenciaCobroMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 18500 }));
  });

  it('rechaza si el club no tiene Mercado Pago configurado', async () => {
    MercadoPagoConfig.findOne.mockResolvedValue(null);

    await expect(crearPreferenciaCobroMercadoPago(baseArgs())).rejects.toBeInstanceOf(BusinessError);
    await expect(crearPreferenciaCobroMercadoPago(baseArgs())).rejects.toMatchObject({ message: expect.stringContaining('no configuró Mercado Pago') });
  });

  it('rechaza si no hay socioId', async () => {
    const args = { ...baseArgs(), socioId: undefined };
    await expect(crearPreferenciaCobroMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('socioId') });
  });

  it('rechaza si items está vacío', async () => {
    const args = { ...baseArgs(), items: [] };
    await expect(crearPreferenciaCobroMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('ítem') });
  });

  it('rechaza si un item no tiene monto', async () => {
    const args = baseArgs();
    args.items = [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07'] }];

    await expect(crearPreferenciaCobroMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('monto asignado') });
  });

  it.each([[0], [-5], ['abc'], [1.5]])('#188: rechaza un item de muro libre con cantidad inválida (%s)', async (cantidad) => {
    const args = baseArgs();
    args.items = [{ socioId: SOCIO_ID, muroLibrePendiente: true, cantidad, amount: 4000 }];

    await expect(crearPreferenciaCobroMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('cantidad entera mayor que cero') });
  });

  it('rechaza si un item no indica suscripcionId, cargoPuntualId ni muroLibrePendiente', async () => {
    const args = baseArgs();
    args.items = [{ socioId: SOCIO_ID, amount: 1000 }];

    await expect(crearPreferenciaCobroMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('suscripcionId, cargoPuntualId o muroLibrePendiente') });
  });

  it('rechaza si un item pertenece a otro socio', async () => {
    const args = baseArgs();
    args.items = [{ socioId: 'otro-socio', suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07'], amount: 7500 }];

    await expect(crearPreferenciaCobroMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('no corresponde al socio') });
  });

  it('rechaza si el socio no existe', async () => {
    Socio.find = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });

    await expect(crearPreferenciaCobroMercadoPago(baseArgs())).rejects.toMatchObject({ status: 404 });
  });

  it('propaga error 502 si Mercado Pago rechaza la creación de la preferencia', async () => {
    stubMpFetch({ message: 'invalid token' }, false, 401);

    await expect(crearPreferenciaCobroMercadoPago(baseArgs())).rejects.toMatchObject({ status: 502 });
    expect(mockIntentSave).not.toHaveBeenCalled();
  });

  it('appcarc-backend#258: deduplica períodos repetidos dentro de un mismo item', async () => {
    const args = baseArgs();
    args.items = [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07', '2026-07', '2026-08'], amount: 7500 }];

    await crearPreferenciaCobroMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({ periodos: ['2026-07', '2026-08'] })],
    }));
  });
});
