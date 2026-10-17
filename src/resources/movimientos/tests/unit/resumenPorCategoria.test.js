import { afterEach, describe, expect, it, vi } from 'vitest';
import { resumenPorCategoriaHandler, resumenPorCategoriaMensualHandler, resumenPorCategoriaDetalleHandler } from '../../handlers/resumenPorCategoria.handler.js';
import * as categoriaMovimientoService from '../../services/categoriaMovimiento.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { clubId: 'club1' };

afterEach(() => vi.restoreAllMocks());

describe('resumenPorCategoriaHandler', () => {
  it('devuelve ingresos y egresos como listas {categoria, monto}', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
    vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({
      ingresos: [['Cuota Social', 50000], ['Muro Libre', 20000]],
      egresos: [['Costos Fijos', 15000]],
    });

    const res = mockRes();
    await resumenPorCategoriaHandler({ query: {}, user: USER }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.ingresosPorCategoria).toEqual([
      { categoria: 'Cuota Social', monto: 50000 },
      { categoria: 'Muro Libre', monto: 20000 },
    ]);
    expect(body.egresosPorCategoria).toEqual([{ categoria: 'Costos Fijos', monto: 15000 }]);
  });

  it('usa desde/hasta explícitos cuando vienen en la query', async () => {
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({ ingresos: [], egresos: [] });
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});

    const res = mockRes();
    await resumenPorCategoriaHandler({ query: { desde: '2026-01-01', hasta: '2026-01-31' }, user: USER }, res);

    expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({
      desde: new Date('2026-01-01T00:00:00.000-03:00'),
      hasta: new Date('2026-01-31T23:59:59.999-03:00'),
    }));
  });

  it('default: usa un rango de 365 días hasta ahora si no vienen desde/hasta', async () => {
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({ ingresos: [], egresos: [] });
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});

    const res = mockRes();
    await resumenPorCategoriaHandler({ query: {}, user: USER }, res);

    const { desde, hasta } = buildSpy.mock.calls[0][0];
    const dias = (hasta.getTime() - desde.getTime()) / (24 * 60 * 60 * 1000);
    expect(dias).toBeCloseTo(365, 0);
  });

  it('devuelve 500 ante un error inesperado', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockRejectedValue(new Error('DB down'));

    const res = mockRes();
    await resumenPorCategoriaHandler({ query: {}, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('resumenPorCategoriaMensualHandler', () => {
  it('devuelve un objeto por mes (default 6) con periodo, label e ingresos/egresos por categoría', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({
      ingresos: [['Cuota Social', 1000]],
      egresos: [['Varios', 500]],
    });

    const res = mockRes();
    await resumenPorCategoriaMensualHandler({ query: {}, user: USER }, res);

    expect(buildSpy).toHaveBeenCalledTimes(6);
    const body = res.json.mock.calls[0][0];
    expect(body.meses).toHaveLength(6);
    expect(body.meses[0]).toMatchObject({
      ingresosPorCategoria: [{ categoria: 'Cuota Social', monto: 1000 }],
      egresosPorCategoria: [{ categoria: 'Varios', monto: 500 }],
    });
    expect(body.meses[0].periodo).toMatch(/^\d{4}-\d{2}$/);
    expect(body.meses.at(-1).periodo > body.meses[0].periodo).toBe(true); // orden cronológico ascendente
  });

  it('respeta el query param meses, con un tope de 24', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({ ingresos: [], egresos: [] });

    const res = mockRes();
    await resumenPorCategoriaMensualHandler({ query: { meses: '3' }, user: USER }, res);
    expect(buildSpy).toHaveBeenCalledTimes(3);

    buildSpy.mockClear();
    await resumenPorCategoriaMensualHandler({ query: { meses: '999' }, user: USER }, res);
    expect(buildSpy).toHaveBeenCalledTimes(24);
  });

  it('cada mes cubre desde el día 1 hasta el último día de ese mes calendario', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({ ingresos: [], egresos: [] });

    const res = mockRes();
    await resumenPorCategoriaMensualHandler({ query: { meses: '2' }, user: USER }, res);

    const [primerMes, segundoMes] = buildSpy.mock.calls.map(([arg]) => arg);
    // 1° del mes a las 00:00 de Argentina = 03:00 UTC (appcarc-backend#283).
    expect(primerMes.desde.getUTCDate()).toBe(1);
    expect(primerMes.desde.getUTCHours()).toBe(3);
    // El desde del segundo mes tiene que ser justo el día siguiente al hasta del primero.
    expect(segundoMes.desde.getTime()).toBe(primerMes.hasta.getTime() + 1);
  });

  it('devuelve 500 ante un error inesperado', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockRejectedValue(new Error('DB down'));

    const res = mockRes();
    await resumenPorCategoriaMensualHandler({ query: {}, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  describe('appcarc-backend#172: rango explícito desde/hasta (YYYY-MM)', () => {
    it('enumera cada mes calendario entre desde y hasta, inclusive', async () => {
      vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
      const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({ ingresos: [], egresos: [] });

      const res = mockRes();
      await resumenPorCategoriaMensualHandler({ query: { desde: '2026-06', hasta: '2026-08' }, user: USER }, res);

      expect(buildSpy).toHaveBeenCalledTimes(3);
      const body = res.json.mock.calls[0][0];
      expect(body.meses.map((m) => m.periodo)).toEqual(['2026-06', '2026-07', '2026-08']);
    });

    it('cruza el fin de año correctamente', async () => {
      vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
      vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({ ingresos: [], egresos: [] });

      const res = mockRes();
      await resumenPorCategoriaMensualHandler({ query: { desde: '2025-11', hasta: '2026-02' }, user: USER }, res);

      const body = res.json.mock.calls[0][0];
      expect(body.meses.map((m) => m.periodo)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    it('ignora el parámetro meses cuando vienen desde/hasta', async () => {
      vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
      const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildIngresosEgresosPorCategoria').mockResolvedValue({ ingresos: [], egresos: [] });

      const res = mockRes();
      await resumenPorCategoriaMensualHandler({ query: { meses: '2', desde: '2026-01', hasta: '2026-04' }, user: USER }, res);

      expect(buildSpy).toHaveBeenCalledTimes(4);
    });

    it('devuelve 400 con formato inválido', async () => {
      const res = mockRes();
      await resumenPorCategoriaMensualHandler({ query: { desde: '2026-13', hasta: '2026-08' }, user: USER }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('devuelve 400 si desde es posterior a hasta', async () => {
      const res = mockRes();
      await resumenPorCategoriaMensualHandler({ query: { desde: '2026-08', hasta: '2026-01' }, user: USER }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('devuelve 400 si el rango supera los 36 meses', async () => {
      const res = mockRes();
      await resumenPorCategoriaMensualHandler({ query: { desde: '2020-01', hasta: '2026-08' }, user: USER }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});

describe('appcarc-backend#171: resumenPorCategoriaDetalleHandler', () => {
  it('devuelve el detalle y el total de la categoría pedida', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildDetalleCategoria').mockResolvedValue([
      { tipo: 'Ingreso', categoria: 'Otros', monto: 10000, concepto: 'Inscripcion', socioNombre: 'Ana Gómez', movimientoId: 'mov1', fecha: new Date('2026-08-05') },
      { tipo: 'Ingreso', categoria: 'Otros', monto: 66000, concepto: 'Cobro de cuotas', socioNombre: 'Julieta Tobar', movimientoId: 'mov3', fecha: new Date('2026-08-10') },
    ]);

    const res = mockRes();
    await resumenPorCategoriaDetalleHandler({ query: { categoria: 'Otros', desde: '2026-08-01', hasta: '2026-08-31' }, user: USER }, res);

    expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'Ingreso', categoria: 'Otros' }));
    const body = res.json.mock.calls[0][0];
    expect(body.total).toBe(76000);
    expect(body.detalle).toHaveLength(2);
  });

  it('devuelve 400 si falta categoria', async () => {
    const res = mockRes();
    await resumenPorCategoriaDetalleHandler({ query: {}, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('acepta tipo=Egreso', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildDetalleCategoria').mockResolvedValue([]);

    const res = mockRes();
    await resumenPorCategoriaDetalleHandler({ query: { categoria: 'Varios', tipo: 'Egreso' }, user: USER }, res);

    expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'Egreso', categoria: 'Varios' }));
  });

  it('con periodo=YYYY-MM, arma el rango del mes calendario completo', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildDetalleCategoria').mockResolvedValue([]);

    const res = mockRes();
    await resumenPorCategoriaDetalleHandler({ query: { categoria: 'Otros', periodo: '2026-08' }, user: USER }, res);

    // Mes calendario de Argentina (appcarc-backend#283).
    const { desde, hasta } = buildSpy.mock.calls[0][0];
    expect(desde.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-09-01T02:59:59.999Z');
  });

  it('devuelve 400 si periodo tiene formato inválido', async () => {
    const res = mockRes();
    await resumenPorCategoriaDetalleHandler({ query: { categoria: 'Otros', periodo: 'no-es-un-periodo' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('acepta desde/hasta ya con hora (ISO completo), como los que devuelve resumen-por-categoria', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockResolvedValue({});
    const buildSpy = vi.spyOn(categoriaMovimientoService, 'buildDetalleCategoria').mockResolvedValue([]);

    const res = mockRes();
    await resumenPorCategoriaDetalleHandler({
      query: { categoria: 'Otros', desde: '2026-01-01T00:00:00.000Z', hasta: '2026-08-31T23:59:59.999Z' },
      user: USER,
    }, res);

    const { desde, hasta } = buildSpy.mock.calls[0][0];
    expect(desde.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-08-31T23:59:59.999Z');
  });

  it('devuelve 500 ante un error inesperado', async () => {
    vi.spyOn(categoriaMovimientoService, 'getEtiquetaMap').mockRejectedValue(new Error('DB down'));

    const res = mockRes();
    await resumenPorCategoriaDetalleHandler({ query: { categoria: 'Otros' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
