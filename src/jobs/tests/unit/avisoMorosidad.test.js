import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../resources/clubs/models/Club.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../resources/socios/models/Socio.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../resources/advertencias/models/Advertencia.js', () => ({
  default: { find: vi.fn(), create: vi.fn() },
}));
vi.mock('../../../resources/cuotas/services/calcularDeuda.service.js', () => ({
  calcularDeuda: vi.fn(),
}));
vi.mock('../../../services/pushNotification.service.js', () => ({
  notifyRolesByPermiso: vi.fn().mockResolvedValue({ sent: 1 }),
  notifyJobFailure: vi.fn().mockResolvedValue(undefined),
}));

import { revisarMorosidadCuotaSocial } from '../../avisoMorosidad.job.js';
import Club from '../../../resources/clubs/models/Club.js';
import Socio from '../../../resources/socios/models/Socio.js';
import Advertencia from '../../../resources/advertencias/models/Advertencia.js';
import { calcularDeuda } from '../../../resources/cuotas/services/calcularDeuda.service.js';
import { notifyRolesByPermiso, notifyJobFailure } from '../../../services/pushNotification.service.js';

const mockSelectLean = (result) => ({ select: () => ({ lean: () => Promise.resolve(result) }) });

// periodoActual fijo en un valor que NUNCA está en `periodos` — simula "el
// mes en curso ya está pagado, solo debe meses viejos". Así el resultado no
// depende de qué día sea hoy quien corra el test (la ventana de gracia solo
// afecta cuando periodoActual SÍ está entre los períodos adeudados).
const deudaCon = (mesesDeuda) => ({
  suscripciones: [{
    etiqueta: { uso_sistema: 'cuota_social' },
    mesesDeuda,
    periodos: Array.from({ length: mesesDeuda }, (_, i) => `2020-0${i + 1}`),
    periodoActual: '2099-12',
  }],
  otrosCargos: [],
});

const deudaSinSocial = () => ({ suscripciones: [], otrosCargos: [] });

beforeEach(() => {
  vi.clearAllMocks();
  Club.find.mockResolvedValue([{ slug: 'CARC' }]);
  Advertencia.find.mockResolvedValue([]);
  Advertencia.create.mockResolvedValue({});
});

describe('revisarMorosidadCuotaSocial', () => {
  it('crea una Advertencia nueva y notifica a staff cuando un socio lleva 3+ meses sin pagar', async () => {
    Socio.find.mockReturnValue(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]));
    calcularDeuda.mockResolvedValue(deudaCon(3));

    await revisarMorosidadCuotaSocial();

    expect(Advertencia.create).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', socioId: 'socio1', codigo: 'MOROSIDAD_CUOTA_SOCIAL',
      mensaje: 'Debe 3 meses de cuota social', estado: 'abierta',
    }));
    expect(notifyRolesByPermiso).toHaveBeenCalledWith('CARC', 'advertencias:read', expect.objectContaining({
      body: expect.stringContaining('1 socio lleva'),
    }));
  });

  it('no crea ni avisa si nadie llega a 3 meses de deuda', async () => {
    Socio.find.mockReturnValue(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]));
    calcularDeuda.mockResolvedValue(deudaCon(2));

    await revisarMorosidadCuotaSocial();

    expect(Advertencia.create).not.toHaveBeenCalled();
    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
  });

  it('actualiza (no duplica) la Advertencia si ya estaba abierta para ese socio', async () => {
    const existingSave = vi.fn().mockResolvedValue();
    Socio.find.mockReturnValue(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]));
    Advertencia.find.mockResolvedValue([{ socioId: 'socio1', mensaje: 'Debe 3 meses de cuota social', save: existingSave }]);
    calcularDeuda.mockResolvedValue(deudaCon(4));

    await revisarMorosidadCuotaSocial();

    expect(Advertencia.create).not.toHaveBeenCalled();
    expect(existingSave).toHaveBeenCalledTimes(1);
  });

  it('resuelve la Advertencia abierta de un socio que dejó de estar en mora', async () => {
    const existingSave = vi.fn().mockResolvedValue();
    const existing = { socioId: 'socio1', estado: 'abierta', save: existingSave };
    Socio.find.mockReturnValue(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]));
    Advertencia.find.mockResolvedValue([existing]);
    calcularDeuda.mockResolvedValue(deudaCon(0)); // ya pagó, no llega a 3 meses

    await revisarMorosidadCuotaSocial();

    expect(existing.estado).toBe('resuelta');
    expect(existing.resueltoEn).toBeInstanceOf(Date);
    expect(existingSave).toHaveBeenCalledTimes(1);
    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
  });

  it('ignora socios sin suscripción a cuota social', async () => {
    Socio.find.mockReturnValue(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]));
    calcularDeuda.mockResolvedValue(deudaSinSocial());

    await revisarMorosidadCuotaSocial();

    expect(Advertencia.create).not.toHaveBeenCalled();
    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
  });

  it('procesa cada club de forma independiente', async () => {
    Club.find.mockResolvedValue([{ slug: 'CARC' }, { slug: 'OTROCLUB' }]);
    Socio.find
      .mockReturnValueOnce(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]))
      .mockReturnValueOnce(mockSelectLean([]));
    calcularDeuda.mockResolvedValue(deudaCon(3));

    await revisarMorosidadCuotaSocial();

    expect(notifyRolesByPermiso).toHaveBeenCalledTimes(1);
    expect(notifyRolesByPermiso).toHaveBeenCalledWith('CARC', expect.anything(), expect.anything());
  });

  describe('ventana de gracia del mes en curso (día 10)', () => {
    afterEach(() => vi.useRealTimers());

    it('no cuenta el mes en curso todavía dentro de la ventana de gracia — 3 meses reales quedan en 2, no avisa', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-05T15:00:00.000Z')); // día 5 (ART) — dentro de la ventana

      Socio.find.mockReturnValue(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]));
      calcularDeuda.mockResolvedValue({
        suscripciones: [{
          etiqueta: { uso_sistema: 'cuota_social' },
          mesesDeuda: 3,
          periodos: ['2026-07', '2026-08', '2026-09'],
          periodoActual: '2026-09',
        }],
        otrosCargos: [],
      });

      await revisarMorosidadCuotaSocial();

      expect(Advertencia.create).not.toHaveBeenCalled();
    });

    it('pasado el día 10 el mes en curso ya cuenta — mismos 3 meses reales, avisa', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-15T15:00:00.000Z')); // día 15 (ART) — fuera de la ventana

      Socio.find.mockReturnValue(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]));
      calcularDeuda.mockResolvedValue({
        suscripciones: [{
          etiqueta: { uso_sistema: 'cuota_social' },
          mesesDeuda: 3,
          periodos: ['2026-07', '2026-08', '2026-09'],
          periodoActual: '2026-09',
        }],
        otrosCargos: [],
      });

      await revisarMorosidadCuotaSocial();

      expect(Advertencia.create).toHaveBeenCalledWith(expect.objectContaining({
        mensaje: 'Debe 3 meses de cuota social',
      }));
    });

    it('un socio ya crónicamente atrasado (4+ meses sin contar el actual) avisa igual dentro de la ventana', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-05T15:00:00.000Z')); // dentro de la ventana

      Socio.find.mockReturnValue(mockSelectLean([{ _id: 'socio1', nombre: 'Ana', apellido: 'García' }]));
      calcularDeuda.mockResolvedValue({
        suscripciones: [{
          etiqueta: { uso_sistema: 'cuota_social' },
          mesesDeuda: 5,
          periodos: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
          periodoActual: '2026-09',
        }],
        otrosCargos: [],
      });

      await revisarMorosidadCuotaSocial();

      // 5 - 1 (mes en curso, en ventana de gracia) = 4, sigue >= 3.
      expect(Advertencia.create).toHaveBeenCalledWith(expect.objectContaining({
        mensaje: 'Debe 4 meses de cuota social',
      }));
    });
  });

  it('no revienta si falla la revisión de un club, y avisa al admin de ese club', async () => {
    Club.find.mockResolvedValue([{ slug: 'CARC' }]);
    Socio.find.mockImplementation(() => { throw new Error('DB error'); });

    await expect(revisarMorosidadCuotaSocial()).resolves.not.toThrow();
    expect(notifyJobFailure).toHaveBeenCalledWith('CARC', 'Aviso de morosidad', 'DB error');
  });
});
