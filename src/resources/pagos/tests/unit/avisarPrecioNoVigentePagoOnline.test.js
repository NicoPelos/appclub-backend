import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../notificaciones/models/Notification.js', () => ({
  default: { exists: vi.fn() },
}));
vi.mock('../../../socios/models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../../services/pushNotification.service.js', () => ({
  notifyRolesByPermiso: vi.fn().mockResolvedValue({ sent: 1 }),
}));

import Notification from '../../../notificaciones/models/Notification.js';
import Socio from '../../../socios/models/Socio.js';
import { notifyRolesByPermiso } from '../../../../services/pushNotification.service.js';
import { avisarPrecioNoVigentePagoOnline } from '../../services/avisarPrecioNoVigentePagoOnline.service.js';

const ARGS = { clubId: 'CARC', etiqueta: { _id: 'etq-1', nombre: 'Remeras' }, socioId: 'socio-1', periodo: '2026-12' };

const mockSocio = (socio) => {
  Socio.findOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(socio) }) });
};

describe('avisarPrecioNoVigentePagoOnline (#317)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-02T10:00:00.000-03:00'));
    Notification.exists.mockResolvedValue(null);
    mockSocio({ nombre: 'Ana', apellido: 'García' });
  });
  afterEach(() => vi.useRealTimers());

  it('avisa a quien tiene precios:read nombrando al socio, la etiqueta y el mes', async () => {
    const result = await avisarPrecioNoVigentePagoOnline(ARGS);

    expect(result).toEqual({ avisado: true });
    expect(Socio.findOne).toHaveBeenCalledWith({ _id: 'socio-1', clubId: 'CARC' });
    expect(notifyRolesByPermiso).toHaveBeenCalledWith('CARC', 'precios:read', {
      title: '⚠️ Un socio no pudo pagar online',
      body: 'Ana García quiso pagar con Mercado Pago y no pudo. No hay precio vigente para «Remeras» en diciembre 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.',
      data: { tipo: 'precio_no_vigente_pago_online', etiquetaId: 'etq-1', periodo: '2026-12', url: 'carc://precios' },
    });
  });

  it('busca avisos de hoy (horario argentino) para esa etiqueta y ese club', async () => {
    await avisarPrecioNoVigentePagoOnline(ARGS);

    expect(Notification.exists).toHaveBeenCalledWith({
      clubId: 'CARC',
      'data.tipo': 'precio_no_vigente_pago_online',
      'data.etiquetaId': 'etq-1',
      createdAt: { $gte: new Date('2026-12-02T03:00:00.000Z') },
    });
  });

  it('no repite el aviso si ya se mandó hoy para esa etiqueta', async () => {
    Notification.exists.mockResolvedValue({ _id: 'n1' });

    const result = await avisarPrecioNoVigentePagoOnline(ARGS);

    expect(result).toEqual({ avisado: false });
    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
    expect(Socio.findOne).not.toHaveBeenCalled();
  });

  it('si no encuentra al socio, avisa igual sin nombre', async () => {
    mockSocio(null);

    await avisarPrecioNoVigentePagoOnline(ARGS);

    expect(notifyRolesByPermiso).toHaveBeenCalledWith('CARC', 'precios:read', expect.objectContaining({
      body: expect.stringMatching(/^Un socio quiso pagar con Mercado Pago/),
    }));
  });
});
