import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../resources/cuotas/models/Precios.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), updateOne: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../../resources/suscripciones/models/Suscripcion.js', () => ({
  default: { distinct: vi.fn() },
}));
vi.mock('../../../resources/horarios/models/Horarios.js', () => ({
  default: { distinct: vi.fn() },
}));
vi.mock('../../../services/pushNotification.service.js', () => ({
  notifyRolesByPermiso: vi.fn().mockResolvedValue({ sent: 1 }),
  notifySocio: vi.fn().mockResolvedValue({ sent: 1 }),
  notifyJobFailure: vi.fn().mockResolvedValue(undefined),
}));

import cron from 'node-cron';

let cronCallback;
vi.mock('node-cron', () => ({
  default: { schedule: vi.fn((_expr, cb) => { cronCallback = cb; }) },
}));

import { revisarVencimientosSinReemplazo, revisarCambiosDePrecio, startAlertaPreciosJob, escalonAviso } from '../../alertaPrecios.job.js';
import Precios from '../../../resources/cuotas/models/Precios.js';
import Suscripcion from '../../../resources/suscripciones/models/Suscripcion.js';
import Horarios from '../../../resources/horarios/models/Horarios.js';
import { notifyRolesByPermiso, notifySocio, notifyJobFailure } from '../../../services/pushNotification.service.js';

const mockPopulateLean = (result) => ({ populate: () => ({ lean: () => Promise.resolve(result) }) });
const mockFindOneChain = (result) => ({
  populate: () => mockFindOneChain(result),
  sort: () => ({ lean: () => Promise.resolve(result) }),
  lean: () => Promise.resolve(result),
});

beforeEach(() => vi.clearAllMocks());

describe('revisarVencimientosSinReemplazo', () => {
  // Hoy: 29/07/2026 a las 8 hs de Argentina. El precio de los tests vence el 05/08 (faltan 7 días).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-29T08:00:00.000-03:00'));
  });
  afterEach(() => vi.useRealTimers());

  const precioQueVence = (vigenteHasta, extra = {}) => ({
    _id: 'p1', clubId: 'CARC',
    vigenteHasta: new Date(vigenteHasta),
    etiquetaId: { _id: 'etq1', nombre: 'Remeras' },
    ...extra,
  });

  const correr = async (precio) => {
    Precios.find.mockReturnValue(mockPopulateLean([precio]));
    Precios.findOne.mockReturnValue({ lean: () => Promise.resolve(null) }); // sin reemplazo
    await revisarVencimientosSinReemplazo();
  };

  it('#317: busca precios que vencen dentro de los próximos 30 días', async () => {
    Precios.find.mockReturnValue(mockPopulateLean([]));
    await revisarVencimientosSinReemplazo();
    expect(Precios.find).toHaveBeenCalledWith({
      active: true,
      vigenteHasta: { $ne: null, $gte: new Date('2026-07-29T00:00:00.000Z'), $lte: new Date('2026-08-28T00:00:00.000Z') },
    });
  });

  it('#317: a 30 días avisa y marca el escalón 30', async () => {
    await correr(precioQueVence('2026-08-28T00:00:00.000Z'));

    expect(notifyRolesByPermiso).toHaveBeenCalledWith('CARC', 'precios:read', expect.objectContaining({
      body: '"Remeras" vence el 28 de agosto (faltan 30 días) y no hay un precio nuevo cargado para después. Cargalo en Etiquetas → Precios para no dejar a nadie sin precio.',
      data: expect.objectContaining({ tipo: 'precio_por_vencer', diasRestantes: 30 }),
    }));
    expect(Precios.updateOne).toHaveBeenCalledWith(
      { _id: 'p1', clubId: 'CARC' },
      { $set: { avisoVencimiento: { vigenteHasta: new Date('2026-08-28T00:00:00.000Z'), diasAntes: 30 } } },
    );
  });

  it('#317: no repite el aviso dentro del mismo escalón', async () => {
    await correr(precioQueVence('2026-08-18T00:00:00.000Z', {
      avisoVencimiento: { vigenteHasta: new Date('2026-08-18T00:00:00.000Z'), diasAntes: 30 },
    }));

    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
    expect(Precios.findOne).not.toHaveBeenCalled();
    expect(Precios.updateOne).not.toHaveBeenCalled();
  });

  it('#317: al entrar en el escalón siguiente vuelve a avisar', async () => {
    await correr(precioQueVence('2026-08-12T00:00:00.000Z', {
      avisoVencimiento: { vigenteHasta: new Date('2026-08-12T00:00:00.000Z'), diasAntes: 30 },
    }));

    expect(notifyRolesByPermiso).toHaveBeenCalledTimes(1);
    expect(Precios.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: { avisoVencimiento: expect.objectContaining({ diasAntes: 14 }) } });
  });

  it('#317: si el job no corrió el día justo (Raspi caída), avisa igual al día siguiente', async () => {
    // Faltan 13 días y nunca se avisó: corresponde el escalón 14.
    await correr(precioQueVence('2026-08-11T00:00:00.000Z'));
    expect(Precios.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: { avisoVencimiento: expect.objectContaining({ diasAntes: 14 }) } });
  });

  it('#317: si cambió la fecha de fin, los avisos arrancan de nuevo', async () => {
    await correr(precioQueVence('2026-08-20T00:00:00.000Z', {
      avisoVencimiento: { vigenteHasta: new Date('2026-07-31T00:00:00.000Z'), diasAntes: 1 },
    }));
    expect(notifyRolesByPermiso).toHaveBeenCalledTimes(1);
  });

  it('#317: un día antes dice "vence mañana"', async () => {
    await correr(precioQueVence('2026-07-30T00:00:00.000Z'));
    expect(notifyRolesByPermiso).toHaveBeenCalledWith('CARC', 'precios:read', expect.objectContaining({
      body: expect.stringMatching(/^"Remeras" vence mañana y no hay/),
    }));
    expect(Precios.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: { avisoVencimiento: expect.objectContaining({ diasAntes: 1 }) } });
  });

  it('#317: si el aviso falla no lo marca, para reintentar mañana', async () => {
    notifyRolesByPermiso.mockRejectedValueOnce(new Error('Expo caído'));
    await correr(precioQueVence('2026-08-05T00:00:00.000Z'));
    expect(Precios.updateOne).not.toHaveBeenCalled();
  });

  it('avisa a staff cuando un precio vence pronto sin reemplazo', async () => {
    const precio = {
      _id: 'p1', clubId: 'CARC',
      vigenteHasta: new Date('2026-08-05T00:00:00.000Z'),
      etiquetaId: { _id: 'etq1', nombre: 'Cuota Social' },
    };
    Precios.find.mockReturnValue(mockPopulateLean([precio]));
    Precios.findOne.mockReturnValue({ lean: () => Promise.resolve(null) }); // sin reemplazo

    await revisarVencimientosSinReemplazo();

    expect(notifyRolesByPermiso).toHaveBeenCalledWith('CARC', 'precios:read', expect.objectContaining({
      title: expect.stringContaining('vencer'),
      body: expect.stringContaining('Cuota Social'),
    }));
  });

  it('no avisa si ya hay un precio que lo reemplaza', async () => {
    const precio = {
      _id: 'p1', clubId: 'CARC',
      vigenteHasta: new Date('2026-08-05T00:00:00.000Z'),
      etiquetaId: { _id: 'etq1', nombre: 'Cuota Social' },
    };
    Precios.find.mockReturnValue(mockPopulateLean([precio]));
    Precios.findOne.mockReturnValue({ lean: () => Promise.resolve({ _id: 'p2' }) }); // hay reemplazo

    await revisarVencimientosSinReemplazo();

    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
  });

  it('no revienta si no hay precios por vencer', async () => {
    Precios.find.mockReturnValue(mockPopulateLean([]));
    await expect(revisarVencimientosSinReemplazo()).resolves.not.toThrow();
    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
  });
});

describe('escalonAviso (#317)', () => {
  it('asigna el escalón más cercano que todavía no pasó', () => {
    expect([30, 20, 15, 14, 10, 8, 7, 3, 2, 1, 0].map(escalonAviso)).toEqual([30, 30, 30, 14, 14, 14, 7, 7, 7, 1, 1]);
  });
});

describe('revisarCambiosDePrecio', () => {
  it('avisa a staff y a los socios con suscripción activa cuando cambia una cuota mensual', async () => {
    const nuevo = {
      _id: 'nuevo1', clubId: 'CARC', monto: 6000,
      etiquetaId: { _id: 'etq1', nombre: 'Cuota Social', unidad: 'mes' },
    };
    Precios.find.mockReturnValue(mockPopulateLean([nuevo]));
    Precios.findOne.mockReturnValue(mockFindOneChain({ _id: 'viejo1', monto: 5000 }));
    Suscripcion.distinct.mockResolvedValue(['socioA', 'socioB']);

    await revisarCambiosDePrecio();

    expect(notifyRolesByPermiso).toHaveBeenCalledWith('CARC', 'precios:read', expect.objectContaining({
      body: expect.stringContaining('$5.000'),
    }));
    expect(notifySocio).toHaveBeenCalledTimes(2);
    expect(notifySocio).toHaveBeenCalledWith('socioA', expect.objectContaining({ body: expect.stringContaining('$6.000') }));
    expect(Horarios.distinct).not.toHaveBeenCalled();
  });

  it('para una tarifa por hora, busca afectados en Horarios en vez de Suscripcion', async () => {
    const nuevo = {
      _id: 'nuevo1', clubId: 'CARC', monto: 3000,
      etiquetaId: { _id: 'etq2', nombre: 'Hora Profesor', unidad: 'hora' },
    };
    Precios.find.mockReturnValue(mockPopulateLean([nuevo]));
    Precios.findOne.mockReturnValue(mockFindOneChain({ _id: 'viejo1', monto: 2500 }));
    Horarios.distinct.mockResolvedValue(['profesorA']);

    await revisarCambiosDePrecio();

    expect(Horarios.distinct).toHaveBeenCalledWith('socioId', expect.objectContaining({ etiquetaId: 'etq2' }));
    expect(Suscripcion.distinct).not.toHaveBeenCalled();
    expect(notifySocio).toHaveBeenCalledWith('profesorA', expect.anything());
  });

  it('no avisa si no había un precio anterior (etiqueta nueva)', async () => {
    const nuevo = { _id: 'nuevo1', clubId: 'CARC', monto: 6000, etiquetaId: { _id: 'etq1', nombre: 'Cuota Social', unidad: 'mes' } };
    Precios.find.mockReturnValue(mockPopulateLean([nuevo]));
    Precios.findOne.mockReturnValue(mockFindOneChain(null));

    await revisarCambiosDePrecio();

    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
    expect(notifySocio).not.toHaveBeenCalled();
  });

  it('no avisa si el monto no cambió realmente', async () => {
    const nuevo = { _id: 'nuevo1', clubId: 'CARC', monto: 5000, etiquetaId: { _id: 'etq1', nombre: 'Cuota Social', unidad: 'mes' } };
    Precios.find.mockReturnValue(mockPopulateLean([nuevo]));
    Precios.findOne.mockReturnValue(mockFindOneChain({ _id: 'viejo1', monto: 5000 }));

    await revisarCambiosDePrecio();

    expect(notifyRolesByPermiso).not.toHaveBeenCalled();
    expect(notifySocio).not.toHaveBeenCalled();
  });
});

describe('startAlertaPreciosJob', () => {
  it('se programa en hora argentina, no en la del container (appcarc-backend#283)', () => {
    cron.schedule.mockClear();
    startAlertaPreciosJob();
    expect(cron.schedule).toHaveBeenCalledWith('0 8 * * *', expect.any(Function), { timezone: 'America/Argentina/Cordoba' });
  });

  it('avisa al admin si el job entero falla inesperadamente', async () => {
    Precios.find.mockImplementation(() => { throw new Error('Mongo caído'); });
    startAlertaPreciosJob();

    await cronCallback();

    expect(notifyJobFailure).toHaveBeenCalledWith('CARC', 'Alerta de precios', 'Mongo caído');
  });
});
