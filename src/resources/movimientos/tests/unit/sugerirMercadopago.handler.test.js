import { afterEach, describe, expect, it, vi } from 'vitest';
import { sugerirMercadopagoHandler } from '../../handlers/sugerirMercadopago.handler.js';
import * as sugerirService from '../../services/sugerirMercadopago.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', clubId: 'club1' };

afterEach(() => vi.restoreAllMocks());

describe('sugerirMercadopagoHandler', () => {
  it('should return 400 when monto is missing', async () => {
    const res = mockRes();
    await sugerirMercadopagoHandler({ body: { fecha: '2026-10-05' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when fecha is missing', async () => {
    const res = mockRes();
    await sugerirMercadopagoHandler({ body: { monto: 1000 }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should pass the clubId and body through to the service and return its result', async () => {
    const spy = vi.spyOn(sugerirService, 'sugerirMovimientoParaPago').mockResolvedValue({ tipo: 'crear', datosSugeridos: {} });
    const res = mockRes();
    await sugerirMercadopagoHandler({
      body: { monto: 15000, fecha: '2026-10-05', payerName: 'Mama de Juan', direccion: 'ingreso' },
      user: USER,
    }, res);

    expect(spy).toHaveBeenCalledWith({
      clubId: 'club1', monto: 15000, fecha: '2026-10-05', payerEmail: '', payerName: 'Mama de Juan', direccion: 'ingreso',
    });
    expect(res.json).toHaveBeenCalledWith({ tipo: 'crear', datosSugeridos: {} });
  });
});
