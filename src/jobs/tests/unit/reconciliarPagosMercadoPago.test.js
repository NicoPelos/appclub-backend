import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../resources/pagos/models/MercadoPagoConfig.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../resources/pagos/services/reconciliarPagosMercadoPago.service.js', () => ({
  reconciliarPagosMercadoPagoClub: vi.fn(),
}));
vi.mock('../../../services/pushNotification.service.js', () => ({
  notifyJobFailure: vi.fn().mockResolvedValue(undefined),
}));

import { reconciliarPagosMercadoPago } from '../../reconciliarPagosMercadoPago.job.js';
import MercadoPagoConfig from '../../../resources/pagos/models/MercadoPagoConfig.js';
import { reconciliarPagosMercadoPagoClub } from '../../../resources/pagos/services/reconciliarPagosMercadoPago.service.js';
import { notifyJobFailure } from '../../../services/pushNotification.service.js';

beforeEach(() => vi.clearAllMocks());

describe('reconciliarPagosMercadoPago', () => {
  it('revisa cada club activo con Mercado Pago configurado', async () => {
    MercadoPagoConfig.find.mockResolvedValue([
      { clubId: 'CARC', accessToken: 'token-carc' },
      { clubId: 'OTROCLUB', accessToken: 'token-otro' },
    ]);
    reconciliarPagosMercadoPagoClub.mockResolvedValue({ revisados: 2, resueltos: 1, errores: 0, expirados: 0 });

    await reconciliarPagosMercadoPago();

    expect(reconciliarPagosMercadoPagoClub).toHaveBeenCalledWith({ clubId: 'CARC', accessToken: 'token-carc' });
    expect(reconciliarPagosMercadoPagoClub).toHaveBeenCalledWith({ clubId: 'OTROCLUB', accessToken: 'token-otro' });
  });

  it('no hace nada si no hay clubes con Mercado Pago activo', async () => {
    MercadoPagoConfig.find.mockResolvedValue([]);

    await reconciliarPagosMercadoPago();

    expect(reconciliarPagosMercadoPagoClub).not.toHaveBeenCalled();
  });

  it('no revienta si falla la revisión de un club, y avisa al admin de ese club', async () => {
    MercadoPagoConfig.find.mockResolvedValue([{ clubId: 'CARC', accessToken: 'token-carc' }]);
    reconciliarPagosMercadoPagoClub.mockRejectedValue(new Error('DB error'));

    await expect(reconciliarPagosMercadoPago()).resolves.not.toThrow();
    expect(notifyJobFailure).toHaveBeenCalledWith('CARC', 'Reconciliación Mercado Pago', 'DB error');
  });
});
