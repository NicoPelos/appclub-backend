import { describe, it, expect, vi, beforeEach } from 'vitest';

// El link de pago no soporta precio de cada mes (#285): los dos endpoints que
// generan preferencias rechazan cualquier modoPrecio distinto de 'actual'
// antes de tocar el servicio. Ausente o 'actual' sigue igual que antes.
vi.mock('../../services/crearPreferenciaCobroMercadoPago.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  crearPreferenciaCobroMercadoPago: vi.fn(),
}));
vi.mock('../../services/crearPreferenciaCobroPropioMercadoPago.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  crearPreferenciaCobroPropioMercadoPago: vi.fn(),
}));

import { crearPreferenciaCobroMercadoPago } from '../../services/crearPreferenciaCobroMercadoPago.service.js';
import { crearPreferenciaCobroPropioMercadoPago } from '../../services/crearPreferenciaCobroPropioMercadoPago.service.js';
import { crearPreferenciaCobroMercadoPagoHandler } from '../../handlers/crearPreferenciaCobroMercadoPago.handler.js';
import { crearPreferenciaCobroPropioMercadoPagoHandler } from '../../handlers/crearPreferenciaCobroPropioMercadoPago.handler.js';

const MENSAJE = 'El link de pago siempre cobra al precio actual. Para cobrar a precio de cada mes, registrá el cobro como efectivo o transferencia.';
const USER = { id: 'user-1', email: 'secretaria@carc.test', clubId: 'CARC' };
const ITEMS = [{ socioId: 'socio-1', suscripcionId: 'sus-1', periodos: ['2026-07', '2026-08'], amount: 7500 }];
const RESULTADO = { preferenceId: 'pref-1', initPoint: 'https://mp.test/checkout/pref-1' };

const buildRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const endpoints = [
  {
    nombre: 'POST /api/pagos/mercadopago/preferencia-cobro',
    handler: crearPreferenciaCobroMercadoPagoHandler,
    servicio: crearPreferenciaCobroMercadoPago,
    body: { socioId: 'socio-1', description: 'Cuota social', items: ITEMS },
    argsEsperados: {
      clubId: 'CARC', requestedByUserId: 'user-1', requestedByEmail: 'secretaria@carc.test',
      socioId: 'socio-1', items: ITEMS, description: 'Cuota social',
    },
  },
  {
    nombre: 'POST /api/pagos/mercadopago/preferencia-propia',
    handler: crearPreferenciaCobroPropioMercadoPagoHandler,
    servicio: crearPreferenciaCobroPropioMercadoPago,
    body: { items: ITEMS },
    argsEsperados: {
      clubId: 'CARC', requestedByUserId: 'user-1', requestedByEmail: 'secretaria@carc.test', items: ITEMS,
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  crearPreferenciaCobroMercadoPago.mockResolvedValue(RESULTADO);
  crearPreferenciaCobroPropioMercadoPago.mockResolvedValue(RESULTADO);
});

describe.each(endpoints)('$nombre — modoPrecio (#285)', ({ handler, servicio, body, argsEsperados }) => {
  it("con modoPrecio 'historico' responde 400 con el mensaje exacto y no genera la preferencia", async () => {
    const res = buildRes();

    await handler({ user: USER, body: { ...body, modoPrecio: 'historico' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: MENSAJE });
    expect(servicio).not.toHaveBeenCalled();
  });

  it("cualquier otro valor distinto de 'actual' también da 400 (no se normaliza)", async () => {
    for (const modoPrecio of ['Historico', 'actual ', 'ACTUAL', '', 1, false]) {
      const res = buildRes();
      await handler({ user: USER, body: { ...body, modoPrecio } }, res);
      expect(res.status, JSON.stringify(modoPrecio)).toHaveBeenCalledWith(400);
    }
    expect(servicio).not.toHaveBeenCalled();
  });

  it("con modoPrecio 'actual' funciona igual que hoy", async () => {
    const res = buildRes();

    await handler({ user: USER, body: { ...body, modoPrecio: 'actual' } }, res);

    expect(servicio).toHaveBeenCalledWith(argsEsperados);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(RESULTADO);
  });

  it('sin modoPrecio (o null, como en POST /api/cobros) funciona igual que hoy', async () => {
    for (const cuerpo of [body, { ...body, modoPrecio: null }]) {
      vi.clearAllMocks();
      const res = buildRes();

      await handler({ user: USER, body: cuerpo }, res);

      expect(servicio).toHaveBeenCalledWith(argsEsperados);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(RESULTADO);
    }
  });
});
