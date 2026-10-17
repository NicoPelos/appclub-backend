import { describe, it, expect } from 'vitest';
import { estaExentoEnPeriodo } from '../../services/exencion.service.js';
import { calcularDeuda } from '../../services/calcularDeuda.service.js';
import {
  createSocio, createEtiqueta, createPrecio, createSuscripcion, CLUB_ID,
} from '../../../../testUtils/integrationHelpers.js';

// Caracterización contra Mongo real (appcarc-backend#263,
// docs/specs/cuotas-calcularDeuda.md §3). El doble cobro de D7 está corregido;
// lo de exento vs. no exento superpuestos sigue pendiente de decidir.

// Mismo cálculo que periodoHoy() en calcularDeuda (hora local del proceso).
const periodoActual = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const periodoAnterior = () => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const exento = (socio, etiqueta, periodo, extra = {}) => estaExentoEnPeriodo({
  clubId: CLUB_ID, socioId: socio._id, etiquetaId: etiqueta._id, periodo, ...extra,
});

describe('estaExentoEnPeriodo (integración, caracterización #263)', () => {
  it('C18: tramo exento 2026-03..2026-06 → bordes inclusivos, fuera del rango false', async () => {
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-03', fechaHasta: '2026-06', exento: true });

    expect(await exento(socio, etiqueta, '2026-02')).toBe(false);
    expect(await exento(socio, etiqueta, '2026-03')).toBe(true);
    expect(await exento(socio, etiqueta, '2026-06')).toBe(true);
    expect(await exento(socio, etiqueta, '2026-07')).toBe(false);
  });

  it('un tramo exento abierto (fechaHasta null) cubre cualquier período futuro', async () => {
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-03', exento: true });

    expect(await exento(socio, etiqueta, '2099-12')).toBe(true);
  });

  it('no cuentan tramos no exentos, inactivos, de otra etiqueta ni de otro club', async () => {
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const otraEtiqueta = await createEtiqueta({ nombre: 'Escuelita', uso_sistema: null });
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-01', exento: false });
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2025-12', exento: true, active: false });
    await createSuscripcion({ socioId: socio._id, etiquetaId: otraEtiqueta._id, fechaDesde: '2026-01', exento: true });
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-01', exento: true, clubId: 'OTRO' });

    expect(await exento(socio, etiqueta, '2026-10')).toBe(false);
    expect(await exento(socio, otraEtiqueta, '2026-10')).toBe(true);
  });

  it('C19: sin socioId devuelve false aunque exista un tramo exento', async () => {
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-01', exento: true });

    expect(await exento(socio, etiqueta, '2026-10', { socioId: null })).toBe(false);
  });

  it('D7: un tramo exento no anula la deuda de un tramo no exento superpuesto (el check-in sí lo considera exento) — comportamiento actual, pendiente de decidir', async () => {
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const hoy = periodoActual();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 15000, vigenteDesde: new Date('2020-01-01') });
    // Distinto fechaDesde: hay un índice único (club, socio, etiqueta, fechaDesde).
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: periodoAnterior(), exento: true });
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: hoy, exento: false });

    expect(await exento(socio, etiqueta, hoy)).toBe(true);

    const { suscripciones } = await calcularDeuda({ socioId: socio._id, clubId: CLUB_ID });
    const total = suscripciones.reduce((s, d) => s + (d.totalDeuda ?? 0), 0);
    expect(total).toBe(15000);
  });

  it('D7: dos tramos no exentos superpuestos de la misma etiqueta cobran el mes en común una sola vez', async () => {
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const hoy = periodoActual();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 15000, vigenteDesde: new Date('2020-01-01') });
    const anterior = periodoAnterior();
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: anterior });
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: hoy });

    const { suscripciones } = await calcularDeuda({ socioId: socio._id, clubId: CLUB_ID });

    expect(suscripciones).toHaveLength(2);
    const todos = suscripciones.flatMap((d) => d.periodos).sort();
    expect(todos).toEqual([anterior, hoy]);
    expect(suscripciones.reduce((s, d) => s + d.mesesDeuda, 0)).toBe(2);
    expect(suscripciones.reduce((s, d) => s + d.totalDeuda, 0)).toBe(2 * 15000);
  });
});
