import { describe, it, expect, vi } from 'vitest';
import Precios from '../../models/Precios.js';
import { findPrecioVigente } from '../../services/findPrecioVigente.service.js';
import { buscarPreciosVigentes, resolverPreciosPorPeriodo } from '../../services/resolverPreciosPorPeriodo.service.js';
import { inicioDePeriodoArgentino } from '../../../../services/fechaArgentina.js';
import { createEtiqueta, createPrecio, CLUB_ID } from '../../../../testUtils/integrationHelpers.js';

// resolverPreciosPorPeriodo trae los precios de una etiqueta en UNA consulta y
// resuelve cada fecha en memoria (#285). Tiene que dar exactamente lo mismo
// que findPrecioVigente fecha por fecha: si no, el precio de cada mes diverge
// del que muestra el resto del sistema.
const D = (iso) => new Date(iso);
const MS = 1;

// Escenario con todo lo que puede complicar la paridad: cierres a desde − 24 h
// (hueco D2), un precio inactivo, uno de otro club, uno de otra etiqueta, uno
// con cierre en un instante "raro", el último sin cierre, y dos superpuestos
// (cargados por fuera de resolverVigenciaPrecio) donde tiene que ganar el de
// vigenteDesde más reciente, en el orden que sea que vengan de la base.
const setupEscenario = async () => {
  const etiqueta = await createEtiqueta();
  const otraEtiqueta = await createEtiqueta({ nombre: 'Escuelita', uso_sistema: null });
  const precios = [
    await createPrecio({ etiquetaId: etiqueta._id, monto: 8000, vigenteDesde: D('2025-11-15T12:00:00.000Z'), vigenteHasta: D('2025-12-31T00:00:00.000Z') }),
    await createPrecio({ etiquetaId: etiqueta._id, monto: 10000, vigenteDesde: D('2026-01-01T00:00:00.000Z'), vigenteHasta: D('2026-06-30T00:00:00.000Z') }),
    await createPrecio({ etiquetaId: etiqueta._id, monto: 12000, vigenteDesde: D('2026-07-01T00:00:00.000Z'), vigenteHasta: D('2026-08-31T23:59:59.999Z') }),
    // Último precio, sin cierre.
    await createPrecio({ etiquetaId: etiqueta._id, monto: 15000, vigenteDesde: D('2026-09-01T03:00:00.000Z') }),
    // Superpuestos: uno abierto desde marzo de 2027 y otro, cargado después,
    // que arranca antes (enero) y termina después (mayo): gana el de marzo.
    await createPrecio({ etiquetaId: etiqueta._id, monto: 20000, vigenteDesde: D('2027-03-01T00:00:00.000Z') }),
    await createPrecio({ etiquetaId: etiqueta._id, monto: 18000, vigenteDesde: D('2027-01-01T00:00:00.000Z'), vigenteHasta: D('2027-05-31T00:00:00.000Z') }),
  ];
  await createPrecio({ etiquetaId: etiqueta._id, monto: 1, vigenteDesde: D('2020-01-01'), active: false });
  await createPrecio({ etiquetaId: etiqueta._id, monto: 2, vigenteDesde: D('2020-01-01'), clubId: 'OTRO' });
  await createPrecio({ etiquetaId: otraEtiqueta._id, monto: 3, vigenteDesde: D('2020-01-01') });
  return { etiqueta, precios };
};

// Bordes de cada precio (inicio y fin, exactos y a ±1 ms) más una grilla de
// fechas cada 5 días y medio a lo largo de dos años, que cruza todos los
// cambios de precio a distintas horas.
const fechasDePrueba = (precios) => {
  const bordes = precios.flatMap((p) => [p.vigenteDesde, p.vigenteHasta].filter(Boolean))
    .flatMap((f) => [new Date(f.getTime() - MS), f, new Date(f.getTime() + MS)]);
  const grilla = [];
  for (let t = D('2025-06-01T00:00:00.000Z').getTime(); t < D('2027-06-01').getTime(); t += 5.5 * 24 * 3600 * 1000) {
    grilla.push(new Date(t));
  }
  return [...bordes, ...grilla];
};

describe('resolverPreciosPorPeriodo (integración, paridad con findPrecioVigente, #285)', () => {
  it('buscarPreciosVigentes da el mismo precio que findPrecioVigente en cada fecha, incluidos los bordes', async () => {
    const { etiqueta, precios } = await setupEscenario();
    const fechas = fechasDePrueba(precios);
    expect(fechas.length).toBeGreaterThan(140);

    const enLote = await buscarPreciosVigentes({ clubId: CLUB_ID, etiquetaId: etiqueta._id, fechas });

    for (let i = 0; i < fechas.length; i++) {
      const unoPorUno = await findPrecioVigente({ clubId: CLUB_ID, etiquetaId: etiqueta._id, date: fechas[i] });
      expect(String(enLote[i]?._id ?? null), fechas[i].toISOString()).toBe(String(unoPorUno?._id ?? null));
    }
    // Sanidad: la grilla pasa por los cuatro precios y por huecos.
    const montos = new Set(enLote.map((p) => p?.monto ?? null));
    expect(montos).toEqual(new Set([null, 8000, 10000, 12000, 15000, 18000, 20000]));
  });

  it('resolverPreciosPorPeriodo usa el 1° del mes a las 00:00 de Argentina y coincide con findPrecioVigente en esa fecha', async () => {
    const { etiqueta } = await setupEscenario();
    const periodos = [];
    for (let m = 0; m < 24; m++) {
      const d = new Date(Date.UTC(2025, 6 + m, 1));
      periodos.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }

    const montos = await resolverPreciosPorPeriodo({ clubId: CLUB_ID, etiquetaId: etiqueta._id, periodos });

    for (const periodo of periodos) {
      const esperado = await findPrecioVigente({ clubId: CLUB_ID, etiquetaId: etiqueta._id, date: inicioDePeriodoArgentino(periodo) });
      expect(montos.get(periodo), periodo).toBe(esperado?.monto ?? null);
    }
    // Lo que importa del negocio: julio 2026 no cae en el hueco de los cierres
    // a desde − 24 h, y el último precio sin cierre cubre los meses futuros.
    expect(montos.get('2025-11')).toBeNull(); // el de $8.000 arranca el 15/11
    expect(montos.get('2025-12')).toBe(8000);
    expect(montos.get('2026-06')).toBe(10000);
    expect(montos.get('2026-07')).toBe(12000);
    expect(montos.get('2026-08')).toBe(12000);
    expect(montos.get('2026-09')).toBe(15000); // arranca justo a las 00:00 de Argentina
    // Desde enero de 2027 rige el de $18.000 (más reciente que el de $15.000);
    // desde marzo, el de $20.000 aunque el de $18.000 siga abierto.
    expect(montos.get('2027-02')).toBe(18000);
    expect(montos.get('2027-04')).toBe(20000);
    expect(montos.get('2027-06')).toBe(20000);
  });

  it('con el último precio sin cierre, todos los meses desde su inicio toman ese precio', async () => {
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 9000, vigenteDesde: D('2026-02-01') });

    const montos = await resolverPreciosPorPeriodo({
      clubId: CLUB_ID, etiquetaId: etiqueta._id, periodos: ['2026-01', '2026-02', '2026-10', '2028-12'],
    });

    expect([...montos.entries()]).toEqual([['2026-01', null], ['2026-02', 9000], ['2026-10', 9000], ['2028-12', 9000]]);
  });

  it('hace una sola consulta por etiqueta, no una por mes, y filtra por clubId', async () => {
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 9000, vigenteDesde: D('2020-01-01') });
    const spy = vi.spyOn(Precios, 'find');
    try {
      const periodos = Array.from({ length: 60 }, (_, i) => `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
      const montos = await resolverPreciosPorPeriodo({ clubId: CLUB_ID, etiquetaId: etiqueta._id, periodos });
      expect([...montos.values()].every((m) => m === 9000)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ clubId: CLUB_ID, etiquetaId: etiqueta._id, active: true });

      const deOtroClub = await resolverPreciosPorPeriodo({ clubId: 'OTRO', etiquetaId: etiqueta._id, periodos: ['2026-01'] });
      expect(deOtroClub.get('2026-01')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('sin períodos no consulta la base', async () => {
    const spy = vi.spyOn(Precios, 'find');
    try {
      const montos = await resolverPreciosPorPeriodo({ clubId: CLUB_ID, etiquetaId: 'x', periodos: [] });
      expect(montos.size).toBe(0);
      expect(await buscarPreciosVigentes({ clubId: CLUB_ID, etiquetaId: 'x', fechas: [] })).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
